import { TerrainNoise } from '@/procedural/Noise';
import { buildChunkArrays, type ChunkCoordPlain } from '@/procedural/TerrainGeometryBuilder';
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

export interface TerrainWorkerRequest {
  requestId: number;
  coord: ChunkCoordPlain;
  /** true для чанков, которые пойдут в слияние (MergedLodLayer) — позиции запекаются в мировых координатах. */
  bakeWorldOffset: boolean;
}

export interface TerrainWorkerResponse {
  requestId: number;
  coord: ChunkCoordPlain;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

self.onmessage = (event: MessageEvent<TerrainWorkerRequest>) => {
  const { requestId, coord, bakeWorldOffset } = event.data;
  const arrays = buildChunkArrays(coord, noise, bakeWorldOffset);

  const response: TerrainWorkerResponse = {
    requestId,
    coord,
    positions: arrays.positions,
    normals: arrays.normals,
    colors: arrays.colors,
    indices: arrays.indices,
  };

  // Transfer list: передаём владение буферами напрямую, без копирования.
  (self as unknown as Worker).postMessage(response, [
    arrays.positions.buffer,
    arrays.normals.buffer,
    arrays.colors.buffer,
    arrays.indices.buffer,
  ]);
};
