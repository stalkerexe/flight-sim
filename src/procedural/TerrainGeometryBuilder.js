import { WORLD } from '@/config/Constants';
/** Разрешение сетки падает вдвое на каждый уровень LOD (129 → 65 → 33 → 17). */
export function resolutionForLod(lod) {
    const base = WORLD.CHUNK_RESOLUTION_LOD0;
    const steps = Math.min(lod, WORLD.LOD_LEVELS - 1);
    return Math.max(5, Math.floor((base - 1) / 2 ** steps) + 1);
}
/**
 * Физический размер чанка данного LOD, метры. Удваивается на каждом уровне —
 * это clipmap-схема (см. комментарий у world/ChunkManager.ts и QUALITY_TIERS):
 * дальние чанки одновременно крупнее и грубее, поэтому для покрытия того же
 * радиуса обзора нужно на порядок меньше отдельных мешей/draw call'ов.
 */
export function chunkSizeForLod(lod) {
    return WORLD.CHUNK_SIZE * 2 ** lod;
}
/**
 * Строит геометрию одного чанка рельефа как плоские типизированные массивы.
 *
 * Включает skirt-геометрию (юбку по периметру, опущенную вниз на
 * WORLD.SKIRT_DEPTH) — прячет микро-щели между соседними чанками разных LOD.
 *
 * Частота Найквиста сетки этого конкретного чанка (`1 / (2 * step)`)
 * передаётся в `noise.getHeight()`, чтобы detail-слой не генерировал
 * октавы, которые эта сетка физически не может корректно отобразить —
 * без этого дальние грубые чанки покрывались бы острыми "иглами"
 * (aliasing высокочастотного шума на редкой сетке).
 *
 * Функция ЧИСТАЯ (не зависит от THREE/DOM) — вызывается и на главном потоке,
 * и внутри workers/terrainWorker.ts.
 */
export function buildChunkArrays(coord, noise, bakeWorldOffset = false) {
    const resolution = resolutionForLod(coord.lod);
    const size = chunkSizeForLod(coord.lod);
    const segments = resolution - 1;
    const step = size / segments;
    const nyquistFrequency = 1 / (2 * step);
    const originX = coord.cx * size;
    const originZ = coord.cz * size;
    const mainVertexCount = resolution * resolution;
    const skirtVertexCount = resolution * 4;
    const totalVertices = mainVertexCount + skirtVertexCount;
    const positions = new Float32Array(totalVertices * 3);
    const normals = new Float32Array(totalVertices * 3);
    const colors = new Float32Array(totalVertices * 3);
    const heights = new Float32Array(mainVertexCount);
    for (let iz = 0; iz < resolution; iz++) {
        for (let ix = 0; ix < resolution; ix++) {
            const worldX = originX + ix * step;
            const worldZ = originZ + iz * step;
            const h = noise.getHeight(worldX, worldZ, nyquistFrequency);
            const idx = iz * resolution + ix;
            heights[idx] = h;
            const vi = idx * 3;
            positions[vi] = bakeWorldOffset ? worldX : ix * step;
            positions[vi + 1] = h;
            positions[vi + 2] = bakeWorldOffset ? worldZ : iz * step;
            const [r, g, b] = biomeColor(h);
            colors[vi] = r;
            colors[vi + 1] = g;
            colors[vi + 2] = b;
        }
    }
    for (let iz = 0; iz < resolution; iz++) {
        for (let ix = 0; ix < resolution; ix++) {
            const idx = iz * resolution + ix;
            const hL = heights[Math.max(0, ix - 1) + iz * resolution];
            const hR = heights[Math.min(resolution - 1, ix + 1) + iz * resolution];
            const hD = heights[ix + Math.max(0, iz - 1) * resolution];
            const hU = heights[ix + Math.min(resolution - 1, iz + 1) * resolution];
            const nx = (hL - hR) / (2 * step);
            const nz = (hD - hU) / (2 * step);
            const len = Math.hypot(nx, 1, nz);
            const ni = idx * 3;
            normals[ni] = nx / len;
            normals[ni + 1] = 1 / len;
            normals[ni + 2] = nz / len;
        }
    }
    const indices = [];
    for (let iz = 0; iz < segments; iz++) {
        for (let ix = 0; ix < segments; ix++) {
            const a = iz * resolution + ix;
            const b = a + 1;
            const c = a + resolution;
            const d = c + 1;
            indices.push(a, c, b, b, c, d);
        }
    }
    const skirtDepth = WORLD.SKIRT_DEPTH;
    let skirtCursor = mainVertexCount;
    const edgeStart = {
        left: skirtCursor,
        right: (skirtCursor += resolution),
        bottom: (skirtCursor += resolution),
        top: (skirtCursor += resolution),
    };
    const copyDown = (mainIdx, skirtIdx) => {
        const mi = mainIdx * 3;
        const si = skirtIdx * 3;
        positions[si] = positions[mi];
        positions[si + 1] = positions[mi + 1] - skirtDepth;
        positions[si + 2] = positions[mi + 2];
        normals[si] = normals[mi];
        normals[si + 1] = normals[mi + 1];
        normals[si + 2] = normals[mi + 2];
        colors[si] = colors[mi];
        colors[si + 1] = colors[mi + 1];
        colors[si + 2] = colors[mi + 2];
    };
    for (let iz = 0; iz < resolution; iz++) {
        copyDown(iz * resolution + 0, edgeStart.left + iz);
        copyDown(iz * resolution + (resolution - 1), edgeStart.right + iz);
    }
    for (let ix = 0; ix < resolution; ix++) {
        copyDown(0 * resolution + ix, edgeStart.bottom + ix);
        copyDown((resolution - 1) * resolution + ix, edgeStart.top + ix);
    }
    for (let iz = 0; iz < segments; iz++) {
        const mA = iz * resolution + 0;
        const mB = (iz + 1) * resolution + 0;
        const sA = edgeStart.left + iz;
        const sB = edgeStart.left + iz + 1;
        indices.push(mA, sA, mB, mB, sA, sB);
        const mC = iz * resolution + (resolution - 1);
        const mD = (iz + 1) * resolution + (resolution - 1);
        const sC = edgeStart.right + iz;
        const sD = edgeStart.right + iz + 1;
        indices.push(mC, mD, sC, mD, sD, sC);
    }
    for (let ix = 0; ix < segments; ix++) {
        const mA = 0 * resolution + ix;
        const mB = 0 * resolution + ix + 1;
        const sA = edgeStart.bottom + ix;
        const sB = edgeStart.bottom + ix + 1;
        indices.push(mA, mB, sA, mB, sB, sA);
        const mC = (resolution - 1) * resolution + ix;
        const mD = (resolution - 1) * resolution + ix + 1;
        const sC = edgeStart.top + ix;
        const sD = edgeStart.top + ix + 1;
        indices.push(mC, sC, mD, mD, sC, sD);
    }
    return {
        positions,
        normals,
        colors,
        indices: Uint32Array.from(indices),
    };
}
/** Процедурная раскраска по высоте (плейсхолдер для будущей biome-системы с текстурами). */
function biomeColor(height) {
    if (height < WORLD.SEA_LEVEL)
        return [0.09, 0.24, 0.32];
    if (height < WORLD.SEA_LEVEL + 15)
        return [0.62, 0.58, 0.4];
    if (height < WORLD.MAX_TERRAIN_HEIGHT * 0.35)
        return [0.18, 0.32, 0.14];
    if (height < WORLD.MAX_TERRAIN_HEIGHT * 0.7)
        return [0.32, 0.28, 0.22];
    return [0.85, 0.85, 0.88];
}
