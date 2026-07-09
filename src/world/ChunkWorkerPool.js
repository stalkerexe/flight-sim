import { WORKER_POOL } from '@/config/Constants';
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
    workers = [];
    pending = new Map();
    nextWorkerIndex = 0;
    nextRequestId = 0;
    constructor() {
        const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
        const workerCount = Math.max(1, Math.min(WORKER_POOL.MAX_WORKERS, hc - 1));
        for (let i = 0; i < workerCount; i++) {
            const worker = new Worker(new URL('@/workers/terrainWorker.ts', import.meta.url), {
                type: 'module',
            });
            worker.onmessage = (event) => {
                const { requestId, positions, normals, colors, indices } = event.data;
                const request = this.pending.get(requestId);
                if (!request)
                    return; // ответ на уже отменённый/устаревший запрос — игнорируем
                this.pending.delete(requestId);
                request.resolve({ positions, normals, colors, indices });
            };
            worker.onerror = (err) => {
                console.error('[ChunkWorkerPool] worker error:', err.message);
            };
            this.workers.push(worker);
        }
    }
    get workerCount() {
        return this.workers.length;
    }
    requestChunk(coord, bakeWorldOffset) {
        const requestId = this.nextRequestId++;
        const worker = this.workers[this.nextWorkerIndex];
        this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
        return new Promise((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
            const message = { requestId, coord, bakeWorldOffset };
            worker.postMessage(message);
        });
    }
    dispose() {
        for (const worker of this.workers)
            worker.terminate();
        this.workers.length = 0;
        this.pending.clear();
    }
}
