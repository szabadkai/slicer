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

const FILLED_PIXEL_THRESHOLD = 128;

export interface CompactGrayLayerCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CompactGrayLayerBase {
  crop?: CompactGrayLayerCrop;
}

export interface EmptyGrayLayer {
  kind: 'empty';
  filledPixels: 0;
  crop?: CompactGrayLayerCrop;
}

export interface SparseGrayLayer extends CompactGrayLayerBase {
  kind: 'sparse-gray';
  indices: Uint32Array;
  values: Uint8Array;
  filledPixels: number;
}

export interface DenseGrayLayer extends CompactGrayLayerBase {
  kind: 'dense-gray';
  values: Uint8Array;
  filledPixels: number;
}

export interface BitsetGrayLayer extends CompactGrayLayerBase {
  kind: 'bitset';
  bits: Uint8Array;
  filledPixels: number;
}

export interface RleGrayLayer extends CompactGrayLayerBase {
  kind: 'rle-gray';
  starts: Uint32Array;
  lengths: Uint32Array;
  values: Uint8Array;
  filledPixels: number;
}

export type CompactGrayLayer =
  | EmptyGrayLayer
  | SparseGrayLayer
  | DenseGrayLayer
  | BitsetGrayLayer
  | RleGrayLayer;

const MAX_PNG_ENCODE_WORKERS = 12;

export function getDefaultPngEncodeWorkerCount(): number {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(cores - 1, MAX_PNG_ENCODE_WORKERS));
}

interface CompactGrayAnalysis {
  nonBlack: number;
  filledPixels: number;
  binary: boolean;
  rleRunCount: number;
}

function analyzeCompactGrayLayer(
  rgba: Uint8Array,
  pixelCount: number,
  width: number,
): CompactGrayAnalysis {
  let nonBlack = 0;
  let filledPixels = 0;
  let binary = true;
  let rleRunCount = 0;

  for (let rowStart = 0; rowStart < pixelCount; rowStart += width) {
    const rowEnd = Math.min(rowStart + width, pixelCount);
    let pixel = rowStart;
    let src = pixel * 4;

    while (pixel < rowEnd) {
      const value = rgba[src];
      if (value === 0) {
        pixel++;
        src += 4;
        continue;
      }

      rleRunCount++;
      do {
        nonBlack++;
        if (value > FILLED_PIXEL_THRESHOLD) filledPixels++;
        if (value !== 255) binary = false;
        pixel++;
        src += 4;
      } while (pixel < rowEnd && rgba[src] === value);
    }
  }

  return { nonBlack, filledPixels, binary, rleRunCount };
}

function makeRleGrayLayer(
  rgba: Uint8Array,
  pixelCount: number,
  width: number,
  runCount: number,
  filledPixels: number,
): RleGrayLayer {
  const starts = new Uint32Array(runCount);
  const lengths = new Uint32Array(runCount);
  const values = new Uint8Array(runCount);
  let dst = 0;

  for (let rowStart = 0; rowStart < pixelCount; rowStart += width) {
    const rowEnd = Math.min(rowStart + width, pixelCount);
    let pixel = rowStart;
    while (pixel < rowEnd) {
      const value = rgba[pixel * 4];
      if (value === 0) {
        pixel++;
        continue;
      }

      const start = pixel;
      pixel++;
      while (pixel < rowEnd && rgba[pixel * 4] === value) pixel++;

      starts[dst] = start;
      lengths[dst] = pixel - start;
      values[dst] = value;
      dst++;
    }
  }

  return { kind: 'rle-gray', starts, lengths, values, filledPixels };
}

export function makeCompactGrayLayer(rgba: Uint8Array, width?: number): CompactGrayLayer {
  const pixelCount = Math.floor(rgba.length / 4);
  const layerWidth = Math.max(1, width ?? pixelCount);
  const { nonBlack, filledPixels, binary, rleRunCount } = analyzeCompactGrayLayer(
    rgba,
    pixelCount,
    layerWidth,
  );

  if (nonBlack === 0) return { kind: 'empty', filledPixels: 0 };

  const sparseByteLength =
    nonBlack * (Uint32Array.BYTES_PER_ELEMENT + Uint8Array.BYTES_PER_ELEMENT);
  const denseByteLength = pixelCount * Uint8Array.BYTES_PER_ELEMENT;
  const bitsetByteLength = binary ? Math.ceil(pixelCount / 8) : Number.POSITIVE_INFINITY;
  const rleByteLength =
    rleRunCount *
    (Uint32Array.BYTES_PER_ELEMENT + Uint32Array.BYTES_PER_ELEMENT + Uint8Array.BYTES_PER_ELEMENT);

  if (
    rleByteLength < sparseByteLength &&
    rleByteLength < denseByteLength &&
    rleByteLength < bitsetByteLength
  ) {
    return makeRleGrayLayer(rgba, pixelCount, layerWidth, rleRunCount, filledPixels);
  }

  if (bitsetByteLength < sparseByteLength && bitsetByteLength < denseByteLength) {
    const bits = new Uint8Array(bitsetByteLength);
    for (let pixel = 0, src = 0; pixel < pixelCount; pixel++, src += 4) {
      if (rgba[src] === 0) continue;
      bits[pixel >> 3] |= 1 << (pixel & 7);
    }
    return { kind: 'bitset', bits, filledPixels };
  }

  if (sparseByteLength >= denseByteLength) {
    const values = new Uint8Array(pixelCount);
    for (let pixel = 0, src = 0; pixel < pixelCount; pixel++, src += 4) {
      values[pixel] = rgba[src];
    }
    return { kind: 'dense-gray', values, filledPixels };
  }

  const indices = new Uint32Array(nonBlack);
  const values = new Uint8Array(nonBlack);
  let dst = 0;
  for (let pixel = 0, src = 0; pixel < pixelCount; pixel++, src += 4) {
    const value = rgba[src];
    if (value === 0) continue;
    indices[dst] = pixel;
    values[dst] = value;
    dst++;
  }

  return { kind: 'sparse-gray', indices, values, filledPixels };
}

export function getCompactGrayLayerByteLength(layer: CompactGrayLayer): number {
  if (layer.kind === 'empty') return 0;
  if (layer.kind === 'dense-gray') return layer.values.byteLength;
  if (layer.kind === 'bitset') return layer.bits.byteLength;
  if (layer.kind === 'rle-gray') {
    return layer.starts.byteLength + layer.lengths.byteLength + layer.values.byteLength;
  }
  return layer.indices.byteLength + layer.values.byteLength;
}

export function cloneCompactGrayLayer(layer: CompactGrayLayer): CompactGrayLayer {
  const crop = layer.crop ? { ...layer.crop } : undefined;
  if (layer.kind === 'empty') return { kind: 'empty', filledPixels: 0, crop };
  if (layer.kind === 'dense-gray') {
    return {
      kind: 'dense-gray',
      values: layer.values.slice(),
      filledPixels: layer.filledPixels,
      crop,
    };
  }
  if (layer.kind === 'bitset') {
    return {
      kind: 'bitset',
      bits: layer.bits.slice(),
      filledPixels: layer.filledPixels,
      crop,
    };
  }
  if (layer.kind === 'rle-gray') {
    return {
      kind: 'rle-gray',
      starts: layer.starts.slice(),
      lengths: layer.lengths.slice(),
      values: layer.values.slice(),
      filledPixels: layer.filledPixels,
      crop,
    };
  }
  return {
    kind: 'sparse-gray',
    indices: layer.indices.slice(),
    values: layer.values.slice(),
    filledPixels: layer.filledPixels,
    crop,
  };
}

export function withCompactGrayLayerCrop<T extends CompactGrayLayer>(
  layer: T,
  crop?: CompactGrayLayerCrop | null,
): T {
  if (!crop) return layer;
  return { ...layer, crop } as T;
}

export class PngEncodePool {
  private slots: WorkerSlot[] = [];
  private nextId = 0;
  private pending = new Map<number, EncodeJob>();
  private queue: Array<() => void> = [];
  private emptyPngCache = new Map<string, Promise<Uint8Array>>();
  readonly size: number;

  constructor(size?: number) {
    const poolSize = Math.max(1, size ?? getDefaultPngEncodeWorkerCount());
    this.size = poolSize;
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

  encode(
    source: Uint8Array | CompactGrayLayer,
    width: number,
    height: number,
  ): Promise<Uint8Array> {
    if (!(source instanceof Uint8Array) && source.kind === 'empty') {
      const key = `${width}x${height}`;
      let cached = this.emptyPngCache.get(key);
      if (!cached) {
        cached = this.dispatchEncode(source, width, height).catch((error: unknown) => {
          this.emptyPngCache.delete(key);
          throw error;
        });
        this.emptyPngCache.set(key, cached);
      }
      return cached;
    }

    return this.dispatchEncode(source, width, height);
  }

  private dispatchEncode(
    source: Uint8Array | CompactGrayLayer,
    width: number,
    height: number,
  ): Promise<Uint8Array> {
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
        if (source instanceof Uint8Array) {
          slot.worker.postMessage({ id, rgba: source, width, height }, [source.buffer]);
        } else if (source.kind === 'empty') {
          slot.worker.postMessage({ id, compact: source, width, height });
        } else if (source.kind === 'dense-gray') {
          slot.worker.postMessage({ id, compact: source, width, height }, [source.values.buffer]);
        } else if (source.kind === 'bitset') {
          slot.worker.postMessage({ id, compact: source, width, height }, [source.bits.buffer]);
        } else if (source.kind === 'rle-gray') {
          slot.worker.postMessage({ id, compact: source, width, height }, [
            source.starts.buffer,
            source.lengths.buffer,
            source.values.buffer,
          ]);
        } else {
          slot.worker.postMessage({ id, compact: source, width, height }, [
            source.indices.buffer,
            source.values.buffer,
          ]);
        }
      };
      dispatch();
    });
  }

  terminate(): void {
    for (const slot of this.slots) slot.worker.terminate();
    this.slots = [];
    this.pending.clear();
    this.queue = [];
    this.emptyPngCache.clear();
  }
}

let shared: PngEncodePool | null = null;

export function getSharedPngEncodePool(): PngEncodePool {
  if (!shared) shared = new PngEncodePool();
  return shared;
}
