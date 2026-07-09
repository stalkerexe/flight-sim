import type { ChunkArrays, ChunkCoordPlain } from '@/procedural/TerrainGeometryBuilder';
import type { TerrainWorkerRequest, TerrainWorkerResponse } from '@/workers/terrainWorker';
import { WORKER_POOL } from '@/config/Constants';

interface PendingRequest {
  resolve: (arrays: ChunkArrays) => void;
  reject: (err: Error) => void;
}

/**
 * Пул Web Worker'ов для генерации геометрии чанков.
 *
 * Почему пул, а не один воркер: генерация одного чанка (129×129 + skirts,
 * fBm 6 октав на вершину) занимает несколько миллисекунд — при облёте на
 * высокой скорости в очередь могут одновременно попасть больше 10 чанков.
 * Один воркер обработает их последовательно и создаст задержку прогрузки;
 * несколько воркеров (по числу ядер CPU) распараллеливают генерацию.
 *
 * API — promise-based поверх сырого postMessage/onmessage: `requestChunk()`
 * возвращает Promise, который резолвится, когда воркер прислал ответ
 * с совпадающим requestId. requestId уникален во всём пуле (общий счётчик),
 * поэтому конфликтов между воркерами нет.
 */
export class ChunkWorkerPool {
  private readonly workers: Worker[] = [];
  private readonly pending = new Map<number, PendingRequest>();
  private nextWorkerIndex = 0;
  private nextRequestId = 0;

  constructor() {
    const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    const workerCount = Math.max(1, Math.min(WORKER_POOL.MAX_WORKERS, hc - 1));

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(new URL('@/workers/terrainWorker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<TerrainWorkerResponse>) => {
        const { requestId, positions, normals, colors, indices } = event.data;
        const request = this.pending.get(requestId);
        if (!request) return; // ответ на уже отменённый/устаревший запрос — игнорируем
        this.pending.delete(requestId);
        request.resolve({ positions, normals, colors, indices });
      };
      worker.onerror = (err) => {
        console.error('[ChunkWorkerPool] worker error:', err.message);
      };
      this.workers.push(worker);
    }
  }

  get workerCount(): number {
    return this.workers.length;
  }

  requestChunk(coord: ChunkCoordPlain, bakeWorldOffset: boolean): Promise<ChunkArrays> {
    const requestId = this.nextRequestId++;
    const worker = this.workers[this.nextWorkerIndex]!;
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;

    return new Promise<ChunkArrays>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const message: TerrainWorkerRequest = { requestId, coord, bakeWorldOffset };
      worker.postMessage(message);
    });
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    this.pending.clear();
  }
}
