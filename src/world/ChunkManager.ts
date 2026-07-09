import * as THREE from 'three';
import { TerrainChunk, chunkKey, type ChunkCoord } from './TerrainChunk';
import { ChunkWorkerPool } from './ChunkWorkerPool';
import { MergedLodLayer } from './MergedLodLayer';
import { chunkSizeForLod } from '@/procedural/TerrainGeometryBuilder';
import { FloatingOrigin } from '@/core/FloatingOrigin';
import { WORLD, WORKER_POOL } from '@/config/Constants';

function lodFromKey(key: string): number {
  const lastUnderscore = key.lastIndexOf('_');
  return Number(key.slice(lastUnderscore + 1));
}

/**
 * ChunkManager: потоковая подгрузка бесконечного рельефа по clipmap-схеме
 * (физический размер чанка удваивается на каждом LOD). Границы колец заданы
 * в метрах и НЕ статичны — приходят из QUALITY_TIERS через QualityManager
 * и могут меняться в рантайме (`setRingRadiusMeters`) в зависимости от
 * измеренного FPS.
 *
 * Draw-call бюджет: LOD0 (ближние, часто меняющиеся чанки) рендерится как
 * отдельные THREE.Mesh — по одному на чанк, как и раньше; на этом уровне их
 * немного (~48) и они нужны отдельно для будущей точной физики/коллизий.
 * LOD1-3 (дальние, редко меняющиеся) объединяются в ОДИН меш на уровень
 * через MergedLodLayer — вместо ~270 draw call'ов получаем 3.
 *
 * Слияние — операция не бесплатная, поэтому она НЕ вызывается на каждый
 * прилетевший из воркера чанк: `maybeRebuildMergedLayers()` пересобирает
 * геометрию слоя только когда для его LOD прямо сейчас нет ни отправленных,
 * ни ожидающих в очереди запросов ("settled") — то есть один раз после того,
 * как весь текущий батч чанков этого уровня догрузился, а не n раз подряд.
 */
export class ChunkManager {
  private readonly scene: THREE.Group;
  private readonly material: THREE.Material;
  private readonly floatingOrigin: FloatingOrigin;
  private readonly workerPool: ChunkWorkerPool;

  /** Только LOD0 — индивидуальные чанки. */
  private readonly active = new Map<string, TerrainChunk>();
  private readonly mergedLayers = new Map<number, MergedLodLayer>();

  private readonly dispatchQueue: ChunkCoord[] = [];
  private readonly inFlight = new Set<string>();
  private desiredKeys = new Set<string>();

  private lastAnchorCellX = Number.NaN;
  private lastAnchorCellZ = Number.NaN;
  private lastAnchorWorldX = 0;
  private lastAnchorWorldZ = 0;

  /** Текущие радиусы LOD-колец в метрах — меняются QualityManager'ом в рантайме. */
  private ringRadiusMeters: readonly number[];

  private readonly lastMergeRebuildAt = new Map<number, number>();
  /** Даже если LOD ещё догружается, пересобираем его слитый меш не реже этого интервала —
   *  иначе дальний террейн появился бы одним рывком после полной догрузки всех чанков уровня. */
  private static readonly MERGE_REBUILD_STALE_MS = 400;

  constructor(
    parentScene: THREE.Scene,
    floatingOrigin: FloatingOrigin,
    initialRingRadiusMeters: readonly number[],
  ) {
    this.ringRadiusMeters = initialRingRadiusMeters;
    this.scene = new THREE.Group();
    this.scene.name = 'TerrainChunks';
    parentScene.add(this.scene);

    this.floatingOrigin = floatingOrigin;
    this.workerPool = new ChunkWorkerPool();

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: false,
    });

    for (let lod = 1; lod < WORLD.LOD_LEVELS; lod++) {
      this.mergedLayers.set(lod, new MergedLodLayer(lod, this.material, this.scene));
    }

    floatingOrigin.onRebase(() => this.repositionAll());
  }

  update(anchorWorldPos: THREE.Vector3): void {
    this.lastAnchorWorldX = anchorWorldPos.x;
    this.lastAnchorWorldZ = anchorWorldPos.z;

    const cellSize = WORLD.CHUNK_SIZE;
    const cellX = Math.floor(anchorWorldPos.x / cellSize);
    const cellZ = Math.floor(anchorWorldPos.z / cellSize);

    if (cellX !== this.lastAnchorCellX || cellZ !== this.lastAnchorCellZ) {
      this.lastAnchorCellX = cellX;
      this.lastAnchorCellZ = cellZ;
      this.rebuildDesiredSet(anchorWorldPos.x, anchorWorldPos.z);
    }

    this.processDispatchQueue();
    this.maybeRebuildMergedLayers();
  }

  /** Меняет радиусы LOD-колец (вызывается QualityManager'ом) и немедленно пересчитывает желаемый набор чанков. */
  setRingRadiusMeters(radii: readonly number[]): void {
    this.ringRadiusMeters = radii;
    this.rebuildDesiredSet(this.lastAnchorWorldX, this.lastAnchorWorldZ);
  }

  private isActive(key: string, lod: number): boolean {
    if (lod === 0) return this.active.has(key);
    return this.mergedLayers.get(lod)!.hasChunk(key);
  }

  private rebuildDesiredSet(anchorWorldX: number, anchorWorldZ: number): void {
    const desired = new Map<string, ChunkCoord>();

    for (let lod = 0; lod < WORLD.LOD_LEVELS; lod++) {
      const chunkSize = chunkSizeForLod(lod);
      const anchorChunkX = Math.floor(anchorWorldX / chunkSize);
      const anchorChunkZ = Math.floor(anchorWorldZ / chunkSize);

      const outerMeters = this.ringRadiusMeters[lod]!;
      const innerMeters = lod === 0 ? 0 : this.ringRadiusMeters[lod - 1]!;
      const outerRadius = Math.ceil(outerMeters / chunkSize);
      const innerRadius = lod === 0 ? 0 : Math.ceil(innerMeters / chunkSize);

      for (let dz = -outerRadius; dz <= outerRadius; dz++) {
        for (let dx = -outerRadius; dx <= outerRadius; dx++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dz));
          if (dist > innerRadius && dist <= outerRadius) {
            const coord: ChunkCoord = { cx: anchorChunkX + dx, cz: anchorChunkZ + dz, lod };
            desired.set(chunkKey(coord), coord);
          }
        }
      }
    }

    this.desiredKeys = new Set(desired.keys());

    // LOD0: выгружаем индивидуальные чанки, которых больше нет в наборе.
    for (const [key, chunk] of this.active) {
      if (!desired.has(key)) {
        this.scene.remove(chunk.mesh);
        chunk.dispose();
        this.active.delete(key);
      }
    }
    // LOD1-3: подрезаем слитые слои до желаемого набора (сами решают, стали ли они "грязными").
    for (const layer of this.mergedLayers.values()) {
      layer.pruneToDesired(this.desiredKeys);
    }

    const toDispatch: ChunkCoord[] = [];
    for (const [key, coord] of desired) {
      if (!this.isActive(key, coord.lod) && !this.inFlight.has(key)) {
        toDispatch.push(coord);
      }
    }
    toDispatch.sort((a, b) => {
      const da = worldDistToChunkCenter(a, anchorWorldX, anchorWorldZ);
      const db = worldDistToChunkCenter(b, anchorWorldX, anchorWorldZ);
      return da - db;
    });

    this.dispatchQueue.length = 0;
    this.dispatchQueue.push(...toDispatch);
  }

  private processDispatchQueue(): void {
    let dispatched = 0;
    while (dispatched < WORKER_POOL.MAX_DISPATCH_PER_FRAME && this.dispatchQueue.length > 0) {
      const coord = this.dispatchQueue.shift()!;
      const key = chunkKey(coord);
      if (this.isActive(key, coord.lod) || this.inFlight.has(key)) continue;

      this.inFlight.add(key);
      const bakeWorldOffset = coord.lod !== 0; // LOD0 остаётся локальным (индивидуальный mesh.position), LOD1-3 — абсолютные мировые координаты для слияния

      this.workerPool
        .requestChunk(coord, bakeWorldOffset)
        .then((arrays) => {
          this.inFlight.delete(key);
          if (!this.desiredKeys.has(key) || this.isActive(key, coord.lod)) return;

          if (coord.lod === 0) {
            const chunk = new TerrainChunk(coord, arrays, this.material);
            this.positionIndividualChunk(chunk);
            this.scene.add(chunk.mesh);
            this.active.set(key, chunk);
          } else {
            this.mergedLayers.get(coord.lod)!.setChunk(key, arrays);
          }
        })
        .catch((err) => {
          this.inFlight.delete(key);
          console.error('[ChunkManager] chunk generation failed:', err);
        });

      dispatched++;
    }
  }

  /** Пересобирает слитый меш LOD-уровня, если он не занят догрузкой ИЛИ давно не пересобирался. */
  private maybeRebuildMergedLayers(): void {
    const busyLods = new Set<number>();
    for (const coord of this.dispatchQueue) busyLods.add(coord.lod);
    for (const key of this.inFlight) busyLods.add(lodFromKey(key));

    const now = performance.now();
    for (const [lod, layer] of this.mergedLayers) {
      const lastRebuild = this.lastMergeRebuildAt.get(lod) ?? 0;
      const stale = now - lastRebuild > ChunkManager.MERGE_REBUILD_STALE_MS;
      if (busyLods.has(lod) && !stale) continue;

      layer.rebuildIfDirty();
      layer.updatePosition(this.floatingOrigin.getOrigin());
      this.lastMergeRebuildAt.set(lod, now);
    }
  }

  private positionIndividualChunk(chunk: TerrainChunk): void {
    const origin = this.floatingOrigin.getOrigin();
    chunk.mesh.position.set(
      chunk.worldOriginX - origin.x,
      -origin.y,
      chunk.worldOriginZ - origin.z,
    );
    chunk.mesh.updateMatrix();
  }

  private repositionAll(): void {
    for (const chunk of this.active.values()) {
      this.positionIndividualChunk(chunk);
    }
    const origin = this.floatingOrigin.getOrigin();
    for (const layer of this.mergedLayers.values()) {
      layer.updatePosition(origin);
    }
  }

  get activeChunkCount(): number {
    let total = this.active.size;
    for (const layer of this.mergedLayers.values()) total += layer.chunkCount;
    return total;
  }

  /** Реальное число draw call'ов, которые тратит террейн: LOD0 по отдельности + 1 на каждый непустой слитый слой. */
  get drawCallCount(): number {
    let total = this.active.size;
    for (const layer of this.mergedLayers.values()) {
      if (layer.chunkCount > 0) total += 1;
    }
    return total;
  }

  get pendingBuildCount(): number {
    return this.dispatchQueue.length + this.inFlight.size;
  }

  get workerCount(): number {
    return this.workerPool.workerCount;
  }

  dispose(): void {
    for (const chunk of this.active.values()) chunk.dispose();
    this.active.clear();
    for (const layer of this.mergedLayers.values()) layer.dispose();
    this.dispatchQueue.length = 0;
    this.inFlight.clear();
    this.material.dispose();
    this.workerPool.dispose();
  }
}

function worldDistToChunkCenter(coord: ChunkCoord, worldX: number, worldZ: number): number {
  const size = chunkSizeForLod(coord.lod);
  const centerX = coord.cx * size + size / 2;
  const centerZ = coord.cz * size + size / 2;
  const dx = centerX - worldX;
  const dz = centerZ - worldZ;
  return dx * dx + dz * dz;
}
