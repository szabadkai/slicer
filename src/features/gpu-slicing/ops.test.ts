import { describe, it, expect, vi } from 'vitest';
import { executeSlice, type SliceProgress } from './ops';
import type { LegacyViewer, LegacySlicer } from '@core/legacy-types';
import type { PrinterSpec } from '@core/types';

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
    ...overrides,
  } as unknown as LegacyViewer;
}

function makeSlicer(layers: Uint8Array[]): LegacySlicer {
  return {
    uploadGeometry: vi.fn(),
    setInstances: vi.fn(),
    getPrinterSpec: vi.fn(() => PRINTER_SPEC),
    slice: vi.fn(async (_lh, _onProgress, opts) => {
      for (const layer of layers) {
        opts?.onLayer?.(layer);
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

describe('executeSlice', () => {
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
});
