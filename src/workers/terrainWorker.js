import { TerrainNoise } from '@/procedural/Noise';
import { buildChunkArrays } from '@/procedural/TerrainGeometryBuilder';
import { NOISE } from '@/config/Constants';
/**
 * Терраин-воркер: живёт в отдельном потоке, считает heightmap/normals/colors/indices
 * для одного чанка и отправляет результат обратно через postMessage с transfer list —
 * это ПЕРЕДАЧА владения буфером (zero-copy), а не копирование, поэтому большие
 * Float32Array/Uint32Array не блокируют главный поток на сериализации.
 *
 * TerrainNoise создаётся один раз на воркер (не на чанк) — seed фиксирован,
 * поэтому instance можно переиспользовать для всех запросов этого воркера.
 */
const noise = new TerrainNoise(NOISE.SEED);
self.onmessage = (event) => {
    const { requestId, coord, bakeWorldOffset } = event.data;
    const arrays = buildChunkArrays(coord, noise, bakeWorldOffset);
    const response = {
        requestId,
        coord,
        positions: arrays.positions,
        normals: arrays.normals,
        colors: arrays.colors,
        indices: arrays.indices,
    };
    // Transfer list: передаём владение буферами напрямую, без копирования.
    self.postMessage(response, [
        arrays.positions.buffer,
        arrays.normals.buffer,
        arrays.colors.buffer,
        arrays.indices.buffer,
    ]);
};
