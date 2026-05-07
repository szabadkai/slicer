/**
 * Worker pool for PNG encoding. Spawns a small set of workers and round-robins
 * encode requests across them, transferring the RGBA buffer in zero-copy.
 *
 * Used by the slice pass (to cache PNG bytes as layers are produced) and by
 * the exporter fallback path (when the cache is empty).
 */

interface EncodeJob {
  id: number;
  resolve: (png: Uint8Array) => void;
  reject: (err: unknown) => void;
}

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
}

export class PngEncodePool {
  private slots: WorkerSlot[] = [];
  private nextId = 0;
  private pending = new Map<number, EncodeJob>();
  private queue: Array<() => void> = [];

  constructor(size?: number) {
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    const poolSize = Math.max(1, Math.min(size ?? cores - 1, 4));
    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(new URL('./png-encode.worker.ts', import.meta.url), {
        type: 'module',
      });
      const slot: WorkerSlot = { worker, busy: false };
      worker.onmessage = (e: MessageEvent<{ id: number; png: Uint8Array }>): void => {
        const { id, png } = e.data;
        const job = this.pending.get(id);
        if (job) {
          this.pending.delete(id);
          job.resolve(png);
        }
        slot.busy = false;
        const next = this.queue.shift();
        if (next) next();
      };
      worker.onerror = (err): void => {
        for (const [id, job] of this.pending) {
          job.reject(err);
          this.pending.delete(id);
        }
      };
      this.slots.push(slot);
    }
  }

  encode(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { id, resolve, reject });
      const dispatch = (): void => {
        const slot = this.slots.find((s) => !s.busy);
        if (!slot) {
          this.queue.push(dispatch);
          return;
        }
        slot.busy = true;
        slot.worker.postMessage({ id, rgba, width, height }, [rgba.buffer]);
      };
      dispatch();
    });
  }

  terminate(): void {
    for (const slot of this.slots) slot.worker.terminate();
    this.slots = [];
    this.pending.clear();
    this.queue = [];
  }
}

let shared: PngEncodePool | null = null;

export function getSharedPngEncodePool(): PngEncodePool {
  if (!shared) shared = new PngEncodePool();
  return shared;
}
