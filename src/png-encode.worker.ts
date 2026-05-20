/**
 * PNG encode worker.
 * Receives an RGBA buffer (bottom-up from gl.readPixels), flips it and reduces
 * to a single grayscale channel (R), then encodes as PNG. Returns the PNG bytes
 * via transferable so there is no copy on the way back.
 *
 * The flip + grayscale fold matches what the main thread used to do in
 * exporter.ts so output bytes are identical.
 */
import { encode as encodePng } from 'fast-png';

interface EncodeRequest {
  id: number;
  rgba?: Uint8Array;
  compact?: CompactGrayLayer;
  width: number;
  height: number;
}

type CompactGrayLayer =
  | { kind: 'empty'; filledPixels: 0; crop?: CompactGrayLayerCrop }
  | {
      kind: 'sparse-gray';
      indices: Uint32Array;
      values: Uint8Array;
      filledPixels: number;
      crop?: CompactGrayLayerCrop;
    }
  | { kind: 'dense-gray'; values: Uint8Array; filledPixels: number; crop?: CompactGrayLayerCrop }
  | { kind: 'bitset'; bits: Uint8Array; filledPixels: number; crop?: CompactGrayLayerCrop }
  | {
      kind: 'rle-gray';
      starts: Uint32Array;
      lengths: Uint32Array;
      values: Uint8Array;
      filledPixels: number;
      crop?: CompactGrayLayerCrop;
    };

interface CompactGrayLayerCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EncodeResponse {
  id: number;
  png: Uint8Array;
}

function flipAndGray(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * rowBytes;
    const dstRow = y * width;
    for (let x = 0; x < width; x++) {
      gray[dstRow + x] = rgba[srcRow + x * 4];
    }
  }
  return gray;
}

function sparseToFlippedGray(
  sparse: Extract<CompactGrayLayer, { kind: 'sparse-gray' }>,
  width: number,
  height: number,
): Uint8Array {
  const gray = new Uint8Array(width * height);
  const { indices, values } = sparse;
  const crop = sparse.crop;
  const sourceWidth = crop?.width ?? width;
  for (let i = 0; i < indices.length; i++) {
    const srcIndex = indices[i];
    const localSrcY = Math.floor(srcIndex / sourceWidth);
    const localX = srcIndex - localSrcY * sourceWidth;
    const fullSrcY = (crop?.y ?? 0) + localSrcY;
    const fullX = (crop?.x ?? 0) + localX;
    const dstY = height - 1 - fullSrcY;
    gray[dstY * width + fullX] = values[i];
  }
  return gray;
}

function denseToFlippedGray(
  dense: Extract<CompactGrayLayer, { kind: 'dense-gray' }>,
  width: number,
  height: number,
): Uint8Array {
  const gray = new Uint8Array(width * height);
  const crop = dense.crop;
  const sourceWidth = crop?.width ?? width;
  const sourceHeight = crop?.height ?? height;
  const cropX = crop?.x ?? 0;
  const cropY = crop?.y ?? 0;
  for (let srcY = 0; srcY < sourceHeight; srcY++) {
    const srcRow = srcY * sourceWidth;
    const dstY = height - 1 - (cropY + srcY);
    const dstRow = dstY * width + cropX;
    gray.set(dense.values.subarray(srcRow, srcRow + sourceWidth), dstRow);
  }
  return gray;
}

function bitsetToFlippedGray(
  bitset: Extract<CompactGrayLayer, { kind: 'bitset' }>,
  width: number,
  height: number,
): Uint8Array {
  const gray = new Uint8Array(width * height);
  const crop = bitset.crop;
  const sourceWidth = crop?.width ?? width;
  const sourceHeight = crop?.height ?? height;
  for (let srcIndex = 0; srcIndex < sourceWidth * sourceHeight; srcIndex++) {
    if ((bitset.bits[srcIndex >> 3] & (1 << (srcIndex & 7))) === 0) continue;
    const localSrcY = Math.floor(srcIndex / sourceWidth);
    const localX = srcIndex - localSrcY * sourceWidth;
    const fullSrcY = (crop?.y ?? 0) + localSrcY;
    const fullX = (crop?.x ?? 0) + localX;
    const dstY = height - 1 - fullSrcY;
    gray[dstY * width + fullX] = 255;
  }
  return gray;
}

function rleToFlippedGray(
  rle: Extract<CompactGrayLayer, { kind: 'rle-gray' }>,
  width: number,
  height: number,
): Uint8Array {
  const gray = new Uint8Array(width * height);
  const { starts, lengths, values } = rle;
  const crop = rle.crop;
  const sourceWidth = crop?.width ?? width;
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const length = lengths[i];
    const value = values[i];
    for (let offset = 0; offset < length; offset++) {
      const srcIndex = start + offset;
      const localSrcY = Math.floor(srcIndex / sourceWidth);
      const localX = srcIndex - localSrcY * sourceWidth;
      const fullSrcY = (crop?.y ?? 0) + localSrcY;
      const fullX = (crop?.x ?? 0) + localX;
      const dstY = height - 1 - fullSrcY;
      gray[dstY * width + fullX] = value;
    }
  }
  return gray;
}

function compactToFlippedGray(
  compact: CompactGrayLayer,
  width: number,
  height: number,
): Uint8Array {
  if (compact.kind === 'empty') return new Uint8Array(width * height);
  if (compact.kind === 'dense-gray') return denseToFlippedGray(compact, width, height);
  if (compact.kind === 'bitset') return bitsetToFlippedGray(compact, width, height);
  if (compact.kind === 'rle-gray') return rleToFlippedGray(compact, width, height);
  return sparseToFlippedGray(compact, width, height);
}

self.onmessage = (e: MessageEvent<EncodeRequest>): void => {
  const { id, rgba, compact, width, height } = e.data;
  let gray: Uint8Array;
  if (compact) {
    gray = compactToFlippedGray(compact, width, height);
  } else {
    if (!rgba) throw new Error('PNG encode request is missing pixel data');
    gray = flipAndGray(rgba, width, height);
  }
  const png = encodePng({ data: gray, width, height, channels: 1 });
  const response: EncodeResponse = { id, png };
  (self as unknown as Worker).postMessage(response, [png.buffer]);
};
