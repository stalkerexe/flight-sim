import * as THREE from 'three';
import type { ChunkArrays } from '@/procedural/TerrainGeometryBuilder';
import { chunkSizeForLod } from '@/procedural/TerrainGeometryBuilder';

export interface ChunkCoord {
  readonly cx: number;
  readonly cz: number;
  readonly lod: number;
}

/** Ключ для Map/кэша — детерминированная строка из координат + LOD. */
export function chunkKey(coord: ChunkCoord): string {
  return `${coord.cx}_${coord.cz}_${coord.lod}`;
}

/**
 * Один чанк рельефа в сцене. Тяжёлая часть (расчёт heightmap, normals, skirt-геометрии)
 * выполняется в Web Worker — этот класс только собирает THREE.BufferGeometry
 * из уже готовых типизированных массивов.
 *
 * Тени (`castShadow`/`receiveShadow`) включены только для LOD0 — единственного
 * уровня, который этот класс теперь обслуживает напрямую (LOD1-3 объединены
 * в MergedLodLayer, см. world/MergedLodLayer.ts). Дальние чанки в любом случае
 * почти всегда вне frustum shadow-камеры (диапазон ограничен ~1500 м вокруг
 * игрока в Engine.ts).
 */
export class TerrainChunk {
  readonly coord: ChunkCoord;
  readonly mesh: THREE.Mesh;
  readonly worldOriginX: number;
  readonly worldOriginZ: number;
  private disposed = false;

  constructor(coord: ChunkCoord, arrays: ChunkArrays, material: THREE.Material) {
    this.coord = coord;
    const size = chunkSizeForLod(coord.lod);
    this.worldOriginX = coord.cx * size;
    this.worldOriginZ = coord.cz * size;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(arrays.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.mesh.geometry.dispose();
    this.disposed = true;
  }
}
