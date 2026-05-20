import { existsSync, readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { decode, encode } from 'fast-png';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegacySlicer, LegacyViewer } from '@core/legacy-types';
import type { PrinterSpec } from '@core/types';
import type { CompactGrayLayer, CompactGrayLayerCrop } from '../../png-encode-pool';
import { parseStl } from '@features/model-io/load';
import { exportZipToBlob } from '../../exporter';
import { executeSlice } from './ops';
import { exportCacheMode, slicedCompactLayers, slicedLayerPngs } from '@features/layer-preview/ops';

vi.mock('../../png-encode-pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../png-encode-pool')>();

  function sparseToGray(
    layer: Extract<CompactGrayLayer, { kind: 'sparse-gray' }>,
    width: number,
    height: number,
  ): Uint8Array {
    const gray = new Uint8Array(width * height);
    const crop = layer.crop;
    const sourceWidth = crop?.width ?? width;
    for (let i = 0; i < layer.indices.length; i++) {
      const sourceIndex = layer.indices[i];
      const localY = Math.floor(sourceIndex / sourceWidth);
      const localX = sourceIndex - localY * sourceWidth;
      const fullY = (crop?.y ?? 0) + localY;
      const fullX = (crop?.x ?? 0) + localX;
      gray[(height - 1 - fullY) * width + fullX] = layer.values[i];
    }
    return gray;
  }

  function denseToGray(
    layer: Extract<CompactGrayLayer, { kind: 'dense-gray' }>,
    width: number,
    height: number,
  ): Uint8Array {
    const gray = new Uint8Array(width * height);
    const crop = layer.crop;
    const sourceWidth = crop?.width ?? width;
    const sourceHeight = crop?.height ?? height;
    for (let y = 0; y < sourceHeight; y++) {
      const dstY = height - 1 - ((crop?.y ?? 0) + y);
      gray.set(
        layer.values.subarray(y * sourceWidth, (y + 1) * sourceWidth),
        dstY * width + (crop?.x ?? 0),
      );
    }
    return gray;
  }

  function bitsetToGray(
    layer: Extract<CompactGrayLayer, { kind: 'bitset' }>,
    width: number,
    height: number,
  ): Uint8Array {
    const gray = new Uint8Array(width * height);
    const crop = layer.crop;
    const sourceWidth = crop?.width ?? width;
    const sourceHeight = crop?.height ?? height;
    for (let sourceIndex = 0; sourceIndex < sourceWidth * sourceHeight; sourceIndex++) {
      if ((layer.bits[sourceIndex >> 3] & (1 << (sourceIndex & 7))) === 0) continue;
      const localY = Math.floor(sourceIndex / sourceWidth);
      const localX = sourceIndex - localY * sourceWidth;
      const fullY = (crop?.y ?? 0) + localY;
      const fullX = (crop?.x ?? 0) + localX;
      gray[(height - 1 - fullY) * width + fullX] = 255;
    }
    return gray;
  }

  function rleToGray(
    layer: Extract<CompactGrayLayer, { kind: 'rle-gray' }>,
    width: number,
    height: number,
  ): Uint8Array {
    const gray = new Uint8Array(width * height);
    const crop = layer.crop;
    const sourceWidth = crop?.width ?? width;
    for (let run = 0; run < layer.starts.length; run++) {
      for (let offset = 0; offset < layer.lengths[run]; offset++) {
        const sourceIndex = layer.starts[run] + offset;
        const localY = Math.floor(sourceIndex / sourceWidth);
        const localX = sourceIndex - localY * sourceWidth;
        const fullY = (crop?.y ?? 0) + localY;
        const fullX = (crop?.x ?? 0) + localX;
        gray[(height - 1 - fullY) * width + fullX] = layer.values[run];
      }
    }
    return gray;
  }

  function compactToGray(layer: CompactGrayLayer, width: number, height: number): Uint8Array {
    if (layer.kind === 'empty') return new Uint8Array(width * height);
    if (layer.kind === 'dense-gray') return denseToGray(layer, width, height);
    if (layer.kind === 'bitset') return bitsetToGray(layer, width, height);
    if (layer.kind === 'rle-gray') return rleToGray(layer, width, height);
    return sparseToGray(layer, width, height);
  }

  return {
    ...actual,
    getSharedPngEncodePool: () => ({
      size: 4,
      encode: async (source: Uint8Array | CompactGrayLayer, width: number, height: number) => {
        const data =
          source instanceof Uint8Array
            ? new Uint8Array(width * height)
            : compactToGray(source, width, height);
        return encode({ data, width, height, channels: 1 });
      },
    }),
  };
});

const VENOM_STL_PATH =
  '/Users/lszabadkai/Downloads/NextLv3D/venom-free-modular-figure/Fig_Venom_STL/Fig_Venom_Head_01/Fig_Venom_Head_01_Black.stl';
const VENOM_TRIANGLE_COUNT = 68_270;
const LAYER_COUNT = 64;
const PRINTER: PrinterSpec = {
  name: 'Cycle Test Printer',
  resolutionX: 256,
  resolutionY: 144,
  buildWidthMM: 100,
  buildDepthMM: 56.25,
  buildHeightMM: 120,
};

function makeLargeBinaryStl(triangleCount: number): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangleCount, true);
  let offset = 84;
  for (let i = 0; i < triangleCount; i++) {
    view.setFloat32(offset + 8, 1, true);
    offset += 12;
    const baseX = i % 257;
    const baseY = Math.floor(i / 257) % 257;
    for (let vertex = 0; vertex < 3; vertex++) {
      view.setFloat32(offset, baseX + vertex * 0.1, true);
      view.setFloat32(offset + 4, baseY + vertex * 0.2, true);
      view.setFloat32(offset + 8, (i % 127) * 0.01, true);
      offset += 12;
    }
    offset += 2;
  }
  return buffer;
}

function loadLargeModelBuffer(): ArrayBuffer {
  if (!existsSync(VENOM_STL_PATH)) return makeLargeBinaryStl(VENOM_TRIANGLE_COUNT);
  const bytes = readFileSync(VENOM_STL_PATH);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function makeLayer(index: number, crop: CompactGrayLayerCrop, triangleCount: number): Uint8Array {
  const rgba = new Uint8Array(crop.width * crop.height * 4);
  const stride = 5 + (triangleCount % 7);
  for (let y = 0; y < crop.height; y++) {
    const x = (index * 13 + y * stride) % crop.width;
    rgba[(y * crop.width + x) * 4] = 255;
  }
  return rgba;
}

function makeCrop(index: number): CompactGrayLayerCrop {
  const width = 40 + (index % 9);
  const height = 24 + (index % 7);
  return {
    x: 8 + ((index * 11) % (PRINTER.resolutionX - width - 16)),
    y: 6 + ((index * 7) % (PRINTER.resolutionY - height - 12)),
    width,
    height,
  };
}

function makeViewer(triangleCount: number): LegacyViewer {
  return {
    getMergedModelGeometry: vi.fn(() => ({ triangleCount })),
    getMergedSupportGeometry: vi.fn(() => null),
    getOverallInfo: vi.fn(() => ({
      count: 1,
      triangles: triangleCount,
      width: 60,
      depth: 40,
      height: LAYER_COUNT * 0.05,
      modelVolume: 1000,
      supportVolume: 0,
    })),
    objects: [],
  } as unknown as LegacyViewer;
}

function makeSlicer(triangleCount: number): LegacySlicer {
  return {
    uploadGeometry: vi.fn(),
    setInstances: vi.fn(),
    getPrinterSpec: vi.fn(() => PRINTER),
    slice: vi.fn(async (_layerHeight, onProgress, options) => {
      for (let i = 0; i < LAYER_COUNT; i++) {
        const crop = makeCrop(i);
        options?.onLayer?.(makeLayer(i, crop, triangleCount), i, {
          ...crop,
          fullWidth: PRINTER.resolutionX,
          fullHeight: PRINTER.resolutionY,
        });
        onProgress(i + 1, LAYER_COUNT);
      }
      options?.onTiming?.({
        layerCount: LAYER_COUNT,
        renderMs: 1,
        readbackMs: 1,
        paintMs: 0,
        totalMs: 2,
        asyncReadback: true,
        croppedReadback: true,
        readbackPixels: LAYER_COUNT * 48 * 30,
      });
      return null;
    }),
  } as unknown as LegacySlicer;
}

async function expectLayerPngIntact(
  zip: JSZip,
  layerIndex: number,
  expectedWhitePixels: number,
  triangleCount: number,
): Promise<void> {
  const file = zip.file(`layer_${String(layerIndex).padStart(5, '0')}.png`);
  expect(file).toBeTruthy();
  if (!file) throw new Error(`Missing layer ${layerIndex}`);
  const bytes = await file.async('uint8array');
  const decoded = decode(bytes) as {
    width: number;
    height: number;
    channels: number;
    data: Uint8Array;
  };
  expect(decoded.width).toBe(PRINTER.resolutionX);
  expect(decoded.height).toBe(PRINTER.resolutionY);
  expect(decoded.channels).toBe(1);

  const crop = makeCrop(layerIndex);
  const stride = 5 + (triangleCount % 7);
  let whitePixels = 0;
  for (const value of decoded.data) {
    if (value > 128) whitePixels++;
  }
  expect(whitePixels).toBe(expectedWhitePixels);

  for (let y = 0; y < crop.height; y++) {
    const x = (layerIndex * 13 + y * stride) % crop.width;
    const pngY = PRINTER.resolutionY - 1 - (crop.y + y);
    expect(decoded.data[pngY * PRINTER.resolutionX + crop.x + x]).toBe(255);
  }
  expect(decoded.data[0]).toBe(0);
}

describe('large model slice/export cycle', () => {
  beforeEach(() => {
    exportCacheMode.value = 'fast-slice';
    slicedCompactLayers.value = [];
    slicedLayerPngs.value = [];
  });

  it('keeps compact cropped layers intact through PNG ZIP export', async () => {
    const parsed = parseStl(loadLargeModelBuffer());
    expect(parsed.triangleCount).toBeGreaterThanOrEqual(VENOM_TRIANGLE_COUNT);

    const result = await executeSlice(
      makeViewer(parsed.triangleCount),
      makeSlicer(parsed.triangleCount),
      0.05,
      {
        showProgress: vi.fn(),
        updateProgress: vi.fn(),
      },
    );

    expect(result).not.toBeNull();
    if (!result) throw new Error('Expected slice result');
    expect(result.layerCount).toBe(LAYER_COUNT);
    expect(slicedCompactLayers.value).toHaveLength(LAYER_COUNT);
    expect(slicedCompactLayers.value.every((layer) => !!layer.crop)).toBe(true);

    const blob = await exportZipToBlob(
      { kind: 'compact', layers: slicedCompactLayers.value },
      {
        layerHeight: 0.05,
        normalExposure: 2,
        bottomLayers: 6,
        bottomExposure: 60,
        liftHeight: 5,
        liftSpeed: 1,
        totalVolumeMm3: result.volumes.total,
      },
      PRINTER,
    );

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file(/layer_\d{5}\.png$/)).toHaveLength(LAYER_COUNT);
    const metadataFile = zip.file('metadata.json');
    expect(metadataFile).toBeTruthy();
    if (!metadataFile) throw new Error('Missing metadata.json');
    const metadata = JSON.parse(await metadataFile.async('string')) as {
      layerCount: number;
      resolutionX: number;
      resolutionY: number;
    };
    expect(metadata).toMatchObject({
      layerCount: LAYER_COUNT,
      resolutionX: PRINTER.resolutionX,
      resolutionY: PRINTER.resolutionY,
    });

    await expectLayerPngIntact(zip, 0, result.perLayerWhitePixels[0], parsed.triangleCount);
    await expectLayerPngIntact(
      zip,
      Math.floor(LAYER_COUNT / 2),
      result.perLayerWhitePixels[Math.floor(LAYER_COUNT / 2)],
      parsed.triangleCount,
    );
    await expectLayerPngIntact(
      zip,
      LAYER_COUNT - 1,
      result.perLayerWhitePixels[LAYER_COUNT - 1],
      parsed.triangleCount,
    );
  });
});
