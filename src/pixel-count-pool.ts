interface CountJob {
  id: number;
  resolve: (count: number) => void;
  reject: (err: unknown) => void;
}

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
}

const MAX_PIXEL_COUNT_WORKERS = 4;

export function getDefaultPixelCountWorkerCount(): number {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(Math.floor(cores / 2), MAX_PIXEL_COUNT_WORKERS));
}

export class PixelCountPool {
  private slots: WorkerSlot[] = [];
  private nextId = 0;
  private pending = new Map<number, CountJob>();
  private queue: Array<() => void> = [];
  readonly size: number;

  constructor(size?: number) {
    const poolSize = Math.max(1, size ?? getDefaultPixelCountWorkerCount());
    this.size = poolSize;
    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(new URL('./pixel-count.worker.ts', import.meta.url), {
        type: 'module',
      });
      const slot: WorkerSlot = { worker, busy: false };
      worker.onmessage = (e: MessageEvent<{ id: number; count: number }>): void => {
        const { id, count } = e.data;
        const job = this.pending.get(id);
        if (job) {
          this.pending.delete(id);
          job.resolve(count);
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

  count(rgba: Uint8Array): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { id, resolve, reject });
      const dispatch = (): void => {
        const slot = this.slots.find((s) => !s.busy);
        if (!slot) {
          this.queue.push(dispatch);
          return;
        }
        slot.busy = true;
        slot.worker.postMessage({ id, rgba }, [rgba.buffer]);
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

let shared: PixelCountPool | null = null;

export function getSharedPixelCountPool(): PixelCountPool {
  if (!shared) shared = new PixelCountPool();
  return shared;
}
