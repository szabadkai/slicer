import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCompactGrayLayerByteLength,
  getDefaultPngEncodeWorkerCount,
  makeCompactGrayLayer,
  PngEncodePool,
} from './png-encode-pool';

describe('getDefaultPngEncodeWorkerCount', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses up to twelve workers while leaving one core free', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 16 });
    expect(getDefaultPngEncodeWorkerCount()).toBe(12);
  });

  it('keeps at least one worker on low-core devices', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 1 });
    expect(getDefaultPngEncodeWorkerCount()).toBe(1);
  });
});

describe('makeCompactGrayLayer', () => {
  it('returns an empty marker for all-black pixels', () => {
    const compact = makeCompactGrayLayer(new Uint8Array(16));

    expect(compact).toEqual({ kind: 'empty', filledPixels: 0 });
    expect(getCompactGrayLayerByteLength(compact)).toBe(0);
  });

  it('stores only non-black red-channel pixels when sparse is smaller', () => {
    const rgba = new Uint8Array(100 * 4);
    rgba[1 * 4] = 128;
    rgba[42 * 4] = 255;

    const compact = makeCompactGrayLayer(rgba);

    expect(compact.kind).toBe('sparse-gray');
    if (compact.kind !== 'sparse-gray') throw new Error('Expected sparse-gray layer');
    expect([...compact.indices]).toEqual([1, 42]);
    expect([...compact.values]).toEqual([128, 255]);
    expect(compact.filledPixels).toBe(1);
    expect(getCompactGrayLayerByteLength(compact)).toBe(10);
  });

  it('stores dense grayscale when sparse would be larger', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 200, 0, 0, 255, 150, 0, 0, 255, 20, 0, 0, 255]);

    const compact = makeCompactGrayLayer(rgba);

    expect(compact.kind).toBe('dense-gray');
    if (compact.kind !== 'dense-gray') throw new Error('Expected dense-gray layer');
    expect([...compact.values]).toEqual([255, 200, 150, 20]);
    expect(compact.filledPixels).toBe(3);
    expect(getCompactGrayLayerByteLength(compact)).toBe(4);
  });

  it('stores binary layers as bitsets when smaller than sparse and dense', () => {
    const rgba = new Uint8Array(100 * 4);
    for (let pixel = 0; pixel < 100; pixel += 5) {
      rgba[pixel * 4] = 255;
    }

    const compact = makeCompactGrayLayer(rgba);

    expect(compact.kind).toBe('bitset');
    if (compact.kind !== 'bitset') throw new Error('Expected bitset layer');
    expect(compact.filledPixels).toBe(20);
    expect(getCompactGrayLayerByteLength(compact)).toBe(13);
    for (let pixel = 0; pixel < 100; pixel += 5) {
      expect(compact.bits[pixel >> 3] & (1 << (pixel & 7))).not.toBe(0);
    }
    expect(compact.bits[1 >> 3] & (1 << (1 & 7))).toBe(0);
  });

  it('does not use bitsets for partial grayscale values', () => {
    const rgba = new Uint8Array(100 * 4);
    for (let pixel = 0; pixel < 100; pixel += 5) {
      rgba[pixel * 4] = 200;
    }

    const compact = makeCompactGrayLayer(rgba);

    expect(compact.kind).toBe('dense-gray');
    if (compact.kind !== 'dense-gray') throw new Error('Expected dense-gray layer');
    expect(compact.filledPixels).toBe(20);
    expect(compact.values[0]).toBe(200);
  });

  it('stores long binary row spans as RLE when smaller than bitset', () => {
    const width = 1000;
    const height = 10;
    const rgba = new Uint8Array(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++) {
      rgba[pixel * 4] = 255;
    }

    const compact = makeCompactGrayLayer(rgba, width);

    expect(compact.kind).toBe('rle-gray');
    if (compact.kind !== 'rle-gray') throw new Error('Expected rle-gray layer');
    expect(compact.filledPixels).toBe(width * height);
    expect(compact.starts.length).toBe(height);
    expect([...compact.starts.slice(0, 3)]).toEqual([0, 1000, 2000]);
    expect([...compact.lengths.slice(0, 3)]).toEqual([1000, 1000, 1000]);
    expect(compact.values.every((value) => value === 255)).toBe(true);
    expect(getCompactGrayLayerByteLength(compact)).toBe(90);
  });

  it('keeps RLE runs row-local', () => {
    const width = 1000;
    const height = 2;
    const rgba = new Uint8Array(width * height * 4);
    for (let pixel = 990; pixel < 1010; pixel++) {
      rgba[pixel * 4] = 200;
    }

    const compact = makeCompactGrayLayer(rgba, width);

    expect(compact.kind).toBe('rle-gray');
    if (compact.kind !== 'rle-gray') throw new Error('Expected rle-gray layer');
    expect([...compact.starts]).toEqual([990, 1000]);
    expect([...compact.lengths]).toEqual([10, 10]);
    expect([...compact.values]).toEqual([200, 200]);
    expect(compact.filledPixels).toBe(20);
  });
});

describe('PngEncodePool empty layer cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reuses one encoded empty PNG for repeated empty layers at the same resolution', async () => {
    const postMessage = vi.fn();
    class FakeWorker {
      onmessage: ((e: MessageEvent<{ id: number; png: Uint8Array }>) => void) | null = null;
      onerror: ((err: ErrorEvent) => void) | null = null;

      postMessage(message: { id: number; width: number; height: number }): void {
        postMessage(message);
        queueMicrotask(() => {
          this.onmessage?.({
            data: { id: message.id, png: new Uint8Array([message.width, message.height]) },
          } as MessageEvent<{ id: number; png: Uint8Array }>);
        });
      }

      terminate(): void {}
    }
    vi.stubGlobal('Worker', FakeWorker);

    const pool = new PngEncodePool(1);
    const empty = { kind: 'empty', filledPixels: 0 } as const;
    const first = pool.encode(empty, 10, 20);
    const second = pool.encode(empty, 10, 20);

    await expect(first).resolves.toEqual(new Uint8Array([10, 20]));
    await expect(second).resolves.toEqual(new Uint8Array([10, 20]));
    expect(postMessage).toHaveBeenCalledOnce();

    pool.terminate();
  });

  it('does not reuse empty PNGs across different resolutions', async () => {
    const postMessage = vi.fn();
    class FakeWorker {
      onmessage: ((e: MessageEvent<{ id: number; png: Uint8Array }>) => void) | null = null;
      onerror: ((err: ErrorEvent) => void) | null = null;

      postMessage(message: { id: number; width: number; height: number }): void {
        postMessage(message);
        queueMicrotask(() => {
          this.onmessage?.({
            data: { id: message.id, png: new Uint8Array([message.width, message.height]) },
          } as MessageEvent<{ id: number; png: Uint8Array }>);
        });
      }

      terminate(): void {}
    }
    vi.stubGlobal('Worker', FakeWorker);

    const pool = new PngEncodePool(1);
    const empty = { kind: 'empty', filledPixels: 0 } as const;

    await pool.encode(empty, 10, 20);
    await pool.encode(empty, 20, 10);

    expect(postMessage).toHaveBeenCalledTimes(2);
    pool.terminate();
  });
});
