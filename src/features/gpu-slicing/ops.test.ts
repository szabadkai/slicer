import { beforeEach, describe, it, expect, vi } from 'vitest';
import { executeSlice, type SliceProgress } from './ops';
import { exportCacheMode, slicedCompactLayers, slicedLayerPngs } from '@features/layer-preview/ops';
import type { LegacyViewer, LegacySlicer } from '@core/legacy-types';
import type { PrinterSpec } from '@core/types';

const pngEncodeMock = vi.hoisted(() => ({
  encode: vi.fn(() => Promise.resolve(new Uint8Array(8))),
}));

vi.mock('../../png-encode-pool', () => ({
  makeCompactGrayLayer: (rgba: Uint8Array, width?: number) => {
    const pixelCount = Math.floor(rgba.length / 4);
    const layerWidth = Math.max(1, width ?? pixelCount);
    let nonBlack = 0;
    let filledPixels = 0;
    let binary = true;
    for (let src = 0; src < rgba.length; src += 4) {
      const value = rgba[src];
      if (value !== 0) nonBlack++;
      if (value > 128) filledPixels++;
      if (value !== 0 && value !== 255) binary = false;
    }
    if (nonBlack === 0) return { kind: 'empty', filledPixels: 0 };

    let rleRuns = 0;
    for (let rowStart = 0; rowStart < pixelCount; rowStart += layerWidth) {
      const rowEnd = Math.min(rowStart + layerWidth, pixelCount);
      let pixel = rowStart;
      while (pixel < rowEnd) {
        const value = rgba[pixel * 4];
        if (value === 0) {
          pixel++;
          continue;
        }
        rleRuns++;
        pixel++;
        while (pixel < rowEnd && rgba[pixel * 4] === value) pixel++;
      }
    }

    const sparseBytes = nonBlack * 5;
    const bitsetBytes = Math.ceil(pixelCount / 8);
    const rleBytes = rleRuns * 9;
    if (rleBytes < sparseBytes && rleBytes < pixelCount && (!binary || rleBytes < bitsetBytes)) {
      const starts = new Uint32Array(rleRuns);
      const lengths = new Uint32Array(rleRuns);
      const values = new Uint8Array(rleRuns);
      let dst = 0;
      for (let rowStart = 0; rowStart < pixelCount; rowStart += layerWidth) {
        const rowEnd = Math.min(rowStart + layerWidth, pixelCount);
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

    if (binary && bitsetBytes < sparseBytes && bitsetBytes < pixelCount) {
      const bits = new Uint8Array(bitsetBytes);
      for (let pixel = 0, src = 0; pixel < pixelCount; pixel++, src += 4) {
        if (rgba[src] === 0) continue;
        bits[pixel >> 3] |= 1 << (pixel & 7);
      }
      return { kind: 'bitset', bits, filledPixels };
    }

    if (nonBlack * 5 >= pixelCount) {
      const values = new Uint8Array(pixelCount);
      for (let pixel = 0, src = 0; pixel < pixelCount; pixel++, src += 4) {
        values[pixel] = rgba[src];
      }
      return { kind: 'dense-gray', values, filledPixels };
    }

    const indices: number[] = [];
    const values: number[] = [];
    for (let pixel = 0, src = 0; src < rgba.length; pixel++, src += 4) {
      const value = rgba[src];
      if (value === 0) continue;
      indices.push(pixel);
      values.push(value);
    }
    return {
      kind: 'sparse-gray',
      indices: new Uint32Array(indices),
      values: new Uint8Array(values),
      filledPixels,
    };
  },
  getCompactGrayLayerByteLength: (layer: {
    kind: string;
    indices?: Uint32Array;
    bits?: Uint8Array;
    starts?: Uint32Array;
    lengths?: Uint32Array;
    values?: Uint8Array;
  }) => {
    if (layer.kind === 'empty') return 0;
    if (layer.kind === 'dense-gray') return layer.values!.byteLength;
    if (layer.kind === 'bitset') return layer.bits!.byteLength;
    if (layer.kind === 'rle-gray') {
      return layer.starts!.byteLength + layer.lengths!.byteLength + layer.values!.byteLength;
    }
    return layer.indices!.byteLength + layer.values!.byteLength;
  },
  withCompactGrayLayerCrop: (layer: object, crop?: object | null) =>
    crop ? { ...layer, crop } : layer,
  cloneCompactGrayLayer: (layer: object) => {
    if ('values' in layer && layer.values instanceof Uint8Array) {
      return { ...layer, values: layer.values.slice() };
    }
    if ('bits' in layer && layer.bits instanceof Uint8Array) {
      return { ...layer, bits: layer.bits.slice() };
    }
    if (
      'starts' in layer &&
      layer.starts instanceof Uint32Array &&
      'lengths' in layer &&
      layer.lengths instanceof Uint32Array &&
      'values' in layer &&
      layer.values instanceof Uint8Array
    ) {
      return {
        ...layer,
        starts: layer.starts.slice(),
        lengths: layer.lengths.slice(),
        values: layer.values.slice(),
      };
    }
    if (
      'indices' in layer &&
      layer.indices instanceof Uint32Array &&
      'values' in layer &&
      layer.values instanceof Uint8Array
    ) {
      return { ...layer, indices: layer.indices.slice(), values: layer.values.slice() };
    }
    return { ...layer };
  },
  getSharedPngEncodePool: () => ({
    encode: pngEncodeMock.encode,
  }),
}));

const PRINTER_SPEC: PrinterSpec = {
  name: 'Test Printer',
  resolutionX: 100,
  resolutionY: 100,
  buildWidthMM: 50,
  buildDepthMM: 50,
  buildHeightMM: 100,
};

function makeViewer(overrides: Partial<LegacyViewer> = {}): LegacyViewer {
  return {
    getMergedModelGeometry: vi.fn(() => ({ fake: 'geometry' })),
    getMergedSupportGeometry: vi.fn(() => null),
    getOverallInfo: vi.fn(() => ({
      count: 1,
      triangles: 100,
      width: 20,
      depth: 20,
      height: 10,
      modelVolume: 500,
      supportVolume: 0,
    })),
    objects: [],
    ...overrides,
  } as unknown as LegacyViewer;
}

function makeSlicer(layers: Uint8Array[], printerSpec: PrinterSpec = PRINTER_SPEC): LegacySlicer {
  return {
    uploadGeometry: vi.fn(),
    setInstances: vi.fn(),
    getPrinterSpec: vi.fn(() => printerSpec),
    slice: vi.fn(async (_lh, _onProgress, opts) => {
      for (let i = 0; i < layers.length; i++) {
        opts?.onLayer?.(layers[i], i);
      }
      return layers;
    }),
  } as unknown as LegacySlicer;
}

function makeProgress(): SliceProgress {
  return {
    showProgress: vi.fn(),
    updateProgress: vi.fn(),
  };
}

function makeWhiteLayer(pixelCount: number): Uint8Array {
  const data = new Uint8Array(pixelCount * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255; // R above threshold
  }
  return data;
}

function makeMostlyBlackLayer(pixelCount: number, whitePixels: number[]): Uint8Array {
  const data = new Uint8Array(pixelCount * 4);
  for (const pixel of whitePixels) {
    const offset = pixel * 4;
    data[offset] = 255;
  }
  return data;
}

async function flushBackgroundCache(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('executeSlice', () => {
  beforeEach(() => {
    pngEncodeMock.encode.mockReset();
    pngEncodeMock.encode.mockResolvedValue(new Uint8Array(8));
    exportCacheMode.value = 'balanced';
    slicedCompactLayers.value = [];
    slicedLayerPngs.value = [];
  });

  it('returns null when no model geometry', async () => {
    const viewer = makeViewer({ getMergedModelGeometry: vi.fn(() => null) });
    const slicer = makeSlicer([]);
    const result = await executeSlice(viewer, slicer, 0.05, makeProgress());
    expect(result).toBeNull();
  });

  it('uploads geometry to slicer', async () => {
    const viewer = makeViewer();
    const slicer = makeSlicer([new Uint8Array(4)]);
    await executeSlice(viewer, slicer, 0.05, makeProgress());
    expect(slicer.uploadGeometry).toHaveBeenCalledWith({ fake: 'geometry' }, null);
  });

  it('forwards paint marks to the slicer', async () => {
    const marks = [
      {
        x: 1,
        y: 2,
        z: 3,
        radiusMM: 4,
        depthMM: 0.5,
      },
    ];
    const viewer = makeViewer({ getPaintSliceMarks: vi.fn(() => marks) });
    const slicer = {
      ...makeSlicer([new Uint8Array(4)]),
      setPaintSliceMarks: vi.fn(),
    };

    await executeSlice(viewer, slicer, 0.05, makeProgress());

    expect(slicer.setPaintSliceMarks).toHaveBeenCalledWith(marks);
  });

  it('forwards procedural texture config separately from paint presence', async () => {
    const config = { strength: 0.7, pattern: 2, patternScaleMM: 1.5 };
    const viewer = makeViewer({ getPaintTextureConfig: vi.fn(() => config) });
    const slicer = {
      ...makeSlicer([new Uint8Array(4)]),
      setPaintTextureConfig: vi.fn(),
    };

    await executeSlice(viewer, slicer, 0.05, makeProgress());

    expect(slicer.setPaintTextureConfig).toHaveBeenCalledWith(config);
  });

  it('returns layerCount from slicer', async () => {
    const layer = makeWhiteLayer(10);
    const viewer = makeViewer();
    const slicer = makeSlicer([layer]);
    const result = await executeSlice(viewer, slicer, 0.05, makeProgress());
    expect(result).not.toBeNull();
    expect(result!.layerCount).toBe(1);
  });

  it('computes total volume from pixel counts', async () => {
    // 10 white pixels per layer, 2 layers
    const layer = makeWhiteLayer(10);
    const viewer = makeViewer();
    const slicer = makeSlicer([layer, layer]);

    const result = await executeSlice(viewer, slicer, 0.05, makeProgress());
    expect(result).not.toBeNull();

    // pxArea = (50/100) * (50/100) = 0.5 * 0.5 = 0.25 mm²
    // filledPx = 10 + 10 = 20
    // totalVol = 20 * 0.25 * 0.05 = 0.25 mm³
    expect(result!.volumes.total).toBeCloseTo(0.25);
    expect(result!.volumes.exactTotal).toBe(true);
    expect(result!.volumes.exactBreakdown).toBe(true);
  });

  it('splits model/support volume when supports exist', async () => {
    const layer = makeWhiteLayer(10);
    const viewer = makeViewer({
      getMergedSupportGeometry: vi.fn(() => ({ fake: 'supports' })),
      getOverallInfo: vi.fn(() => ({
        count: 1,
        triangles: 100,
        width: 20,
        depth: 20,
        height: 10,
        modelVolume: 400,
        supportVolume: 100,
      })),
      objects: [],
    });
    const slicer = makeSlicer([layer]);
    const result = await executeSlice(viewer, slicer, 0.05, makeProgress());

    expect(result).not.toBeNull();
    expect(result!.volumes.exactBreakdown).toBe(false);
    // model = total * (400/500) = 80%, support = 20%
    expect(result!.volumes.model).toBeCloseTo(result!.volumes.total * 0.8);
    expect(result!.volumes.supports).toBeCloseTo(result!.volumes.total * 0.2);
  });

  it('tracks per-layer white pixel counts', async () => {
    const layer1 = makeWhiteLayer(5);
    const layer2 = makeWhiteLayer(15);
    const viewer = makeViewer();
    const slicer = makeSlicer([layer1, layer2]);

    const result = await executeSlice(viewer, slicer, 0.05, makeProgress());
    expect(result!.perLayerWhitePixels).toEqual(new Float64Array([5, 15]));
  });

  it('reports progress during slicing', async () => {
    const viewer = makeViewer();
    const slicer = makeSlicer([makeWhiteLayer(1)]);
    const progress = makeProgress();

    await executeSlice(viewer, slicer, 0.05, progress);
    expect(progress.showProgress).toHaveBeenCalledWith('Merging & Uploading geometry...');
    expect(progress.showProgress).toHaveBeenCalledWith('Slicing...');
  });

  it('caches PNG bytes in slicedLayerPngs after slice', async () => {
    const layer = makeWhiteLayer(10);
    layer[0] = 200;
    const slicer = makeSlicer([layer]);
    await executeSlice(makeViewer(), slicer, 0.05, makeProgress());
    await flushBackgroundCache();
    expect(slicedLayerPngs.value).toHaveLength(1);
    expect(slicedLayerPngs.value[0]).toBeInstanceOf(Uint8Array);
    expect(pngEncodeMock.encode).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'dense-gray',
        values: expect.any(Uint8Array),
        filledPixels: 10,
      }),
      PRINTER_SPEC.resolutionX,
      PRINTER_SPEC.resolutionY,
    );
  });

  it('caches mostly-black layer buffers using sparse pixels', async () => {
    const slicer = makeSlicer([makeMostlyBlackLayer(1000, [42])]);

    const result = await executeSlice(makeViewer(), slicer, 0.05, makeProgress());
    await flushBackgroundCache();

    expect(result!.layerCount).toBe(1);
    expect(pngEncodeMock.encode).toHaveBeenCalledOnce();
    expect(pngEncodeMock.encode).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'sparse-gray',
        indices: expect.any(Uint32Array),
        values: expect.any(Uint8Array),
        filledPixels: 1,
      }),
      PRINTER_SPEC.resolutionX,
      PRINTER_SPEC.resolutionY,
    );
    expect(slicedLayerPngs.value).toHaveLength(1);
  });

  it('caches binary layers using bitsets when smaller', async () => {
    const layer = makeMostlyBlackLayer(
      100,
      Array.from({ length: 20 }, (_, i) => i * 5),
    );
    const slicer = makeSlicer([layer]);

    const result = await executeSlice(makeViewer(), slicer, 0.05, makeProgress());

    expect(result!.perLayerWhitePixels).toEqual(new Float64Array([20]));
    expect(pngEncodeMock.encode).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'bitset',
        bits: expect.any(Uint8Array),
        filledPixels: 20,
      }),
      PRINTER_SPEC.resolutionX,
      PRINTER_SPEC.resolutionY,
    );
  });

  it('caches long row spans using RLE when smaller', async () => {
    const layer = makeWhiteLayer(1000);
    const slicer = makeSlicer([layer]);

    const result = await executeSlice(makeViewer(), slicer, 0.05, makeProgress());

    expect(result!.perLayerWhitePixels).toEqual(new Float64Array([1000]));
    expect(pngEncodeMock.encode).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'rle-gray',
        starts: expect.any(Uint32Array),
        lengths: expect.any(Uint32Array),
        values: expect.any(Uint8Array),
        filledPixels: 1000,
      }),
      PRINTER_SPEC.resolutionX,
      PRINTER_SPEC.resolutionY,
    );
  });

  it('abandons PNG caching when layer encoding falls behind', async () => {
    const resolvers: Array<(png: Uint8Array<ArrayBuffer>) => void> = [];
    pngEncodeMock.encode.mockImplementation(
      () =>
        new Promise<Uint8Array<ArrayBuffer>>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const layers = Array.from({ length: 26 }, () => makeWhiteLayer(1));
    const pendingSlice = executeSlice(makeViewer(), makeSlicer(layers), 0.05, makeProgress());
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(pngEncodeMock.encode).toHaveBeenCalledTimes(24);
    resolvers.forEach((resolve) => resolve(new Uint8Array(new ArrayBuffer(8))));

    const result = await pendingSlice;
    expect(result!.layerCount).toBe(26);
    expect(slicedLayerPngs.value).toEqual([]);
  });
});
