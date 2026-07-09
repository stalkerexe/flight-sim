import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
/**
 * Держит все активные чанки ОДНОГО LOD-уровня как один THREE.Mesh вместо
 * отдельного меша на чанк. LOD0 намеренно НЕ проходит через этот класс —
 * он меняется чаще всего (самая мелкая сетка чанков вокруг игрока) и на
 * нём в будущем понадобится точная физика/коллизии по отдельным чанкам;
 * пересобирать общий меш на каждое движение было бы дороже, чем просто
 * рисовать его как есть. А вот LOD1-3 меняются редко (крупные чанки,
 * игрок пересекает их границу нечасто) — там слияние того стоит: 320
 * отдельных draw call'ов превращаются в ~4 (LOD0 отдельно + 1 слитый меш
 * на каждый из LOD1/2/3).
 *
 * Позиции вершин ожидаются УЖЕ ЗАПЕЧЁННЫМИ в истинных мировых координатах
 * (buildChunkArrays(..., bakeWorldOffset=true)) — тогда единственная нужная
 * трансформация меша целиком — это компенсация текущего floating origin
 * (mesh.position = -origin), точно так же, как это делает Sky/Water.
 *
 * Пересборка (`rebuildIfDirty`) должна вызываться ChunkManager'ом ТОЛЬКО
 * когда для этого LOD прямо сейчас не идёт активная догрузка чанков —
 * иначе при потоковом прилёте 50-120 чанков подряд мы пересобирали бы
 * геометрию на каждый чанк (O(n²) суммарной работы). ChunkManager это
 * учитывает через проверку "settled" (нет ни в очереди, ни в полёте).
 */
export class MergedLodLayer {
    lod;
    material;
    parent;
    mesh = null;
    chunks = new Map();
    dirty = false;
    constructor(lod, material, parent) {
        this.lod = lod;
        this.material = material;
        this.parent = parent;
    }
    hasChunk(key) {
        return this.chunks.has(key);
    }
    get chunkCount() {
        return this.chunks.size;
    }
    setChunk(key, arrays) {
        this.chunks.set(key, arrays);
        this.dirty = true;
    }
    /** Убирает все чанки, которых больше нет в желаемом наборе. Возвращает true, если что-то реально удалилось. */
    pruneToDesired(desiredKeys) {
        let changed = false;
        for (const key of this.chunks.keys()) {
            if (!desiredKeys.has(key)) {
                this.chunks.delete(key);
                changed = true;
            }
        }
        if (changed)
            this.dirty = true;
        return changed;
    }
    rebuildIfDirty() {
        if (!this.dirty)
            return;
        this.dirty = false;
        const oldGeometry = this.mesh?.geometry ?? null;
        if (this.chunks.size === 0) {
            if (this.mesh) {
                this.parent.remove(this.mesh);
                oldGeometry?.dispose();
                this.mesh = null;
            }
            return;
        }
        const geometries = [];
        for (const arrays of this.chunks.values()) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
            geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(arrays.colors, 3));
            geometry.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
            geometries.push(geometry);
        }
        const merged = mergeGeometries(geometries, false);
        for (const g of geometries)
            g.dispose(); // временные геометрии больше не нужны — данные уже скопированы в merged
        if (!merged) {
            console.error(`[MergedLodLayer] mergeGeometries failed for LOD ${this.lod}`);
            return;
        }
        merged.computeBoundingSphere();
        if (this.mesh) {
            this.mesh.geometry = merged;
            oldGeometry?.dispose();
        }
        else {
            this.mesh = new THREE.Mesh(merged, this.material);
            this.mesh.matrixAutoUpdate = false;
            this.mesh.castShadow = false; // тени только у LOD0 (см. TerrainChunk)
            this.mesh.receiveShadow = false;
            this.parent.add(this.mesh);
        }
    }
    /** Компенсирует текущий floating origin — вызывать при каждом ребейзе и после rebuildIfDirty(). */
    updatePosition(origin) {
        if (!this.mesh)
            return;
        this.mesh.position.set(-origin.x, -origin.y, -origin.z);
        this.mesh.updateMatrix();
    }
    dispose() {
        if (this.mesh) {
            this.parent.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh = null;
        }
        this.chunks.clear();
    }
}
