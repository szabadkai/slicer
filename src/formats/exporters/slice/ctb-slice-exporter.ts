/**
 * CTB v4 slice exporter.
 *
 * CTB is the de facto standard binary format for consumer resin printers.
 * Compatible with Elegoo, Creality, Phrozen, Epax, QIDI, and many others
 * using ChiTu mainboards.
 *
 * File layout (v4):
 *   [FILE HEADER]     68 bytes — magic, version, dimensions, print params
 *   [PRINT HEADER]    variable — lift/retract, exposure details
 *   [SLICER HEADER]   variable — slicer info, encryption flag, preview offsets
 *   [LARGE PREVIEW]   RGB565 400×300 with RLE16 encoding
 *   [SMALL PREVIEW]   RGB565 200×125 with RLE16 encoding
 *   [LAYER TABLE]     36-byte entries, one per layer
 *   [LAYER DATA]      RLE-encoded 8-bit antialiased pixel data per layer
 *
 * References:
 *   - UVtools format documentation
 *   - catibo CTB parser (github.com/catibo/catibo)
 */
import type {
  SliceExporter,
  LayerSource,
  SliceSettings,
  ProgressCallback,
} from '@core/format-registry';
import type { PrinterSpec } from '@core/types';
import { yieldToBrowser } from './export-helpers';

// ─── RLE Encoding ──────────────────────────────────────────

/**
 * Encode RGBA pixels as CTB RLE-compressed 8-bit grayscale data.
 *
 * CTB RLE format:
 *   Byte value encodes both the color (1 bit) and run length:
 *   - Bit 7: 1 = run-length encoded
 *   - Bits 0-6: grayscale value (0x00 or 0xFF for 1-bit; 0-255 for AA)
 *   When bit 7 is set, the next 1-2 bytes encode the run length.
 *
 * For CTB v4 we use the simpler RLE7 encoding (1-bit per pixel):
 *   - High bit (0x80) indicates this is a run-length byte
 *   - Bit 6 (0x40) indicates the pixel value (on/off)
 *   - Bits 0-5: run length minus 1 (so 1-64 pixels per byte)
 *   - If run > 64, use additional continuation bytes
 */
function encodeCtbRle(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const totalPixels = width * height;
  const result: number[] = [];

  let i = 0;
  while (i < totalPixels) {
    const srcIdx = i * 4;
    const on = pixels[srcIdx] > 128 || pixels[srcIdx + 1] > 128 || pixels[srcIdx + 2] > 128;
    const color = on ? 1 : 0;

    let runLen = 1;
    while (i + runLen < totalPixels && runLen < 0xfffff) {
      const nextIdx = (i + runLen) * 4;
      const nextOn =
        pixels[nextIdx] > 128 || pixels[nextIdx + 1] > 128 || pixels[nextIdx + 2] > 128;
      if ((nextOn ? 1 : 0) !== color) break;
      runLen++;
    }

    // Emit RLE bytes
    // First byte: 0x80 (RLE flag) | (color << 6) | (length bits)
    let remaining = runLen;
    while (remaining > 0) {
      const chunk = Math.min(remaining, 0x1fff); // 13 bits max per entry
      if (chunk <= 0x1f) {
        // Single byte: 0x80 | color<<6 | (chunk & 0x1F)
        result.push(0x80 | (color << 6) | (chunk & 0x1f));
      } else if (chunk <= 0x1fff) {
        // Two bytes: first has 0x80 | color<<6 | 0x20 (continuation flag) | high bits
        // second byte has low 8 bits
        result.push(0x80 | (color << 6) | 0x20 | ((chunk >> 8) & 0x1f));
        result.push(chunk & 0xff);
      }
      remaining -= chunk;
    }

    i += runLen;
  }

  return new Uint8Array(result);
}

// ─── RGB565 Preview ────────────────────────────────────────

function renderPreviewRle16(
  getLayerRGBA: (index: number) => Uint8Array,
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number,
  layerIndex: number,
): Uint8Array {
  const src = getLayerRGBA(layerIndex);
  const result: number[] = [];

  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.floor((y / targetHeight) * srcHeight);
    let x = 0;
    while (x < targetWidth) {
      const sx = Math.floor((x / targetWidth) * srcWidth);
      const idx = (sy * srcWidth + sx) * 4;
      const r5 = (src[idx] >> 3) & 0x1f;
      const g6 = (src[idx + 1] >> 2) & 0x3f;
      const b5 = (src[idx + 2] >> 3) & 0x1f;
      const rgb565 = (r5 << 11) | (g6 << 5) | b5;

      // Count run of identical pixels
      let runLen = 1;
      while (x + runLen < targetWidth && runLen < 0xfff) {
        const nx = Math.floor(((x + runLen) / targetWidth) * srcWidth);
        const ni = (sy * srcWidth + nx) * 4;
        const nr5 = (src[ni] >> 3) & 0x1f;
        const ng6 = (src[ni + 1] >> 2) & 0x3f;
        const nb5 = (src[ni + 2] >> 3) & 0x1f;
        const nrgb = (nr5 << 11) | (ng6 << 5) | nb5;
        if (nrgb !== rgb565) break;
        runLen++;
      }

      if (runLen > 1) {
        // RLE: set bit 13 of the color, then emit run length
        result.push(((rgb565 | 0x2000) >> 8) & 0xff);
        result.push((rgb565 | 0x2000) & 0xff);
        result.push((runLen >> 8) & 0xff);
        result.push(runLen & 0xff);
      } else {
        result.push((rgb565 >> 8) & 0xff);
        result.push(rgb565 & 0xff);
      }
      x += runLen;
    }
  }

  return new Uint8Array(result);
}

// ─── CTB File Assembly ─────────────────────────────────────

const CTB_MAGIC = 0x12fd0086;
const CTB_VERSION = 4;

async function buildCtbBlob(
  source: LayerSource,
  settings: SliceSettings,
  printer: PrinterSpec,
  onProgress?: ProgressCallback,
): Promise<Blob> {
  const { resolutionX, resolutionY } = printer;
  const layerCount = source.kind === 'pixels' ? source.layers.length : source.pngs.length;

  // Decode PNGs to RGBA if needed
  const rgbas: Uint8Array[] =
    source.kind === 'pixels'
      ? source.layers
      : await Promise.all(
          source.pngs.map(async (png) => {
            const blob = new Blob([png.slice(0).buffer as ArrayBuffer], { type: 'image/png' });
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement('canvas');
            canvas.width = resolutionX;
            canvas.height = resolutionY;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Failed to get 2D context for image decoding');
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            const imgData = ctx.getImageData(0, 0, resolutionX, resolutionY);
            return new Uint8Array(imgData.data);
          }),
        );
  const getLayerRGBA = (i: number): Uint8Array => rgbas[i];

  // ── Sizes ──────────────────────────────────────────────
  const FILE_HEADER_SIZE = 68;
  const PRINT_HEADER_SIZE = 56;
  const SLICER_HEADER_SIZE = 78;

  const PREVIEW_LARGE_W = 400;
  const PREVIEW_LARGE_H = 300;
  const PREVIEW_SMALL_W = 200;
  const PREVIEW_SMALL_H = 125;

  const LAYER_ENTRY_SIZE = 36;

  // Pre-encode previews
  const previewLayer = Math.min(2, layerCount - 1);
  const largePrev = renderPreviewRle16(
    getLayerRGBA,
    resolutionX,
    resolutionY,
    PREVIEW_LARGE_W,
    PREVIEW_LARGE_H,
    previewLayer,
  );
  const smallPrev = renderPreviewRle16(
    getLayerRGBA,
    resolutionX,
    resolutionY,
    PREVIEW_SMALL_W,
    PREVIEW_SMALL_H,
    previewLayer,
  );

  // Preview image header is 16 bytes: width(4) + height(4) + dataLength(4) + padding(4)
  const PREVIEW_HEADER = 16;
  const largePreviewTotalSize = PREVIEW_HEADER + largePrev.byteLength;
  const smallPreviewTotalSize = PREVIEW_HEADER + smallPrev.byteLength;

  // Layout offsets
  const printHeaderOffset = FILE_HEADER_SIZE;
  const slicerHeaderOffset = printHeaderOffset + PRINT_HEADER_SIZE;
  const largePreviewOffset = slicerHeaderOffset + SLICER_HEADER_SIZE;
  const smallPreviewOffset = largePreviewOffset + largePreviewTotalSize;
  const layerTableOffset = smallPreviewOffset + smallPreviewTotalSize;
  const layerDataStart = layerTableOffset + layerCount * LAYER_ENTRY_SIZE;

  // ── Pre-encode all layers ──────────────────────────────
  const encodedLayers: Uint8Array[] = [];
  for (let i = 0; i < layerCount; i++) {
    onProgress?.(i + 1, layerCount, `Encoding layer ${i + 1} / ${layerCount}`);
    await yieldToBrowser();
    const rgba = getLayerRGBA(i);
    encodedLayers.push(encodeCtbRle(rgba, resolutionX, resolutionY));
  }

  // ── Calculate total file size ──────────────────────────
  let layerDataTotalSize = 0;
  for (const enc of encodedLayers) layerDataTotalSize += enc.byteLength;
  const totalFileSize = layerDataStart + layerDataTotalSize;

  const buf = new ArrayBuffer(totalFileSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // ── File header (68 bytes) ─────────────────────────────
  const pixelSizeMm = (printer.buildWidthMM ?? 192) / resolutionX;

  view.setUint32(0, CTB_MAGIC, true);
  view.setUint32(4, CTB_VERSION, true);
  view.setFloat32(8, printer.buildWidthMM ?? 192, true); // bed X mm
  view.setFloat32(12, printer.buildDepthMM ?? 120, true); // bed Y mm
  view.setFloat32(16, printer.buildHeightMM ?? 200, true); // bed Z mm
  view.setUint32(20, 0, true); // padding
  view.setUint32(24, 0, true); // padding
  view.setFloat32(28, settings.layerHeight, true); // layer height mm
  view.setFloat32(32, settings.normalExposure, true); // exposure time s
  view.setFloat32(36, settings.bottomExposure, true); // bottom exposure s
  view.setFloat32(40, 0, true); // off time (deprecated)
  view.setUint32(44, settings.bottomLayers, true); // bottom layer count
  view.setUint32(48, resolutionX, true);
  view.setUint32(52, resolutionY, true);
  view.setUint32(56, largePreviewOffset, true); // large preview offset
  view.setUint32(60, layerTableOffset, true); // layer table offset
  view.setUint32(64, layerCount, true); // total layers

  // ── Print header (56 bytes at offset 68) ───────────────
  let o = printHeaderOffset;
  view.setFloat32(o, settings.bottomExposure, true);
  o += 4; // bottom exposure
  view.setFloat32(o, 0, true);
  o += 4; // bottom off time (deprecated)
  view.setFloat32(o, settings.normalExposure, true);
  o += 4; // normal exposure
  view.setFloat32(o, 0, true);
  o += 4; // normal off time (deprecated)
  view.setFloat32(o, settings.bottomLayers, true);
  o += 4; // bottom layer count (float)
  // Lift / retract settings
  const liftH = settings.liftHeight ?? 8;
  const liftS = settings.liftSpeed ?? 3;
  view.setFloat32(o, liftH, true);
  o += 4; // bottom lift height mm
  view.setFloat32(o, liftS * 60, true);
  o += 4; // bottom lift speed mm/min
  view.setFloat32(o, liftH, true);
  o += 4; // lift height mm
  view.setFloat32(o, liftS * 60, true);
  o += 4; // lift speed mm/min
  view.setFloat32(o, liftS * 60, true);
  o += 4; // retract speed mm/min
  // Volume estimate (if available)
  const volumeMl = settings.totalVolumeMm3 !== undefined ? settings.totalVolumeMm3 / 1000 : 0;
  view.setFloat32(o, volumeMl, true);
  o += 4; // volume ml
  view.setFloat32(o, 0, true);
  o += 4; // mirror mode (0=none)
  view.setFloat32(o, 0, true);
  o += 4; // print time estimate (0=unset)

  // ── Slicer header (78 bytes) ───────────────────────────
  o = slicerHeaderOffset;
  view.setFloat32(o, 0, true);
  o += 4; // bottom lift height 2
  view.setFloat32(o, 0, true);
  o += 4; // bottom lift speed 2
  view.setFloat32(o, 0, true);
  o += 4; // lift height 2
  view.setFloat32(o, 0, true);
  o += 4; // lift speed 2
  view.setFloat32(o, 0, true);
  o += 4; // retract height 2
  view.setFloat32(o, 0, true);
  o += 4; // retract speed 2
  view.setFloat32(o, 0, true);
  o += 4; // rest after lift
  view.setUint32(o, 0, true);
  o += 4; // machine name offset (0 = none)
  view.setUint32(o, 0, true);
  o += 4; // machine name length
  view.setUint32(o, 0, true);
  o += 4; // encryption key (0 = unencrypted)
  view.setUint32(o, 0, true);
  o += 4; // per-layer settings flag
  view.setUint32(o, 0, true);
  o += 4; // modification timestamp
  view.setUint32(o, 0, true);
  o += 4; // anti-alias info offset
  view.setFloat32(o, pixelSizeMm, true);
  o += 4; // pixel size mm
  view.setUint32(o, smallPreviewOffset, true);
  o += 4; // small preview offset
  view.setUint32(o, 0, true);
  o += 4; // print params v4 offset
  view.setUint32(o, 0, true);
  o += 4; // disclaimer offset
  view.setUint16(o, 0, true); // reserved

  // ── Large preview ──────────────────────────────────────
  o = largePreviewOffset;
  view.setUint32(o, PREVIEW_LARGE_W, true);
  o += 4;
  view.setUint32(o, PREVIEW_LARGE_H, true);
  o += 4;
  view.setUint32(o, largePrev.byteLength, true);
  o += 4;
  view.setUint32(o, 0, true);
  o += 4; // padding
  bytes.set(largePrev, o);

  // ── Small preview ──────────────────────────────────────
  o = smallPreviewOffset;
  view.setUint32(o, PREVIEW_SMALL_W, true);
  o += 4;
  view.setUint32(o, PREVIEW_SMALL_H, true);
  o += 4;
  view.setUint32(o, smallPrev.byteLength, true);
  o += 4;
  view.setUint32(o, 0, true);
  o += 4; // padding
  bytes.set(smallPrev, o);

  // ── Layer table + data ─────────────────────────────────
  let dataOffset = 0;
  for (let i = 0; i < layerCount; i++) {
    const rle = encodedLayers[i];
    const isBottom = i < settings.bottomLayers;
    const zPos = (i + 1) * settings.layerHeight;
    const exposure = isBottom ? settings.bottomExposure : settings.normalExposure;

    // Layer entry (36 bytes)
    const entryOff = layerTableOffset + i * LAYER_ENTRY_SIZE;
    view.setFloat32(entryOff, zPos, true); // z position mm
    view.setUint32(entryOff + 4, layerDataStart + dataOffset, true); // data offset
    view.setUint32(entryOff + 8, rle.byteLength, true); // data length
    view.setUint32(entryOff + 12, 0, true); // padding
    view.setUint32(entryOff + 16, 0, true); // table size (0 = no per-layer)
    view.setFloat32(entryOff + 20, exposure, true); // exposure time
    view.setFloat32(entryOff + 24, 0, true); // off time
    view.setUint32(entryOff + 28, 0, true); // encryption seed
    view.setUint32(entryOff + 32, 0, true); // padding

    // Copy RLE data
    bytes.set(rle, layerDataStart + dataOffset);
    dataOffset += rle.byteLength;
    if (i % 10 === 0) await yieldToBrowser();
  }

  onProgress?.(layerCount, layerCount, 'Building .ctb file...');
  await yieldToBrowser();

  return new Blob([buf], { type: 'application/octet-stream' });
}

// ─── Registry entry ────────────────────────────────────────

export const ctbSliceExporter: SliceExporter = {
  id: 'ctb',
  name: 'CTB (ChiTuBox Universal)',
  extension: 'ctb',
  isAvailable(): boolean {
    return true;
  },
  async export(
    source: LayerSource,
    settings: SliceSettings,
    printer: PrinterSpec,
    onProgress?: ProgressCallback,
  ): Promise<Blob> {
    return buildCtbBlob(source, settings, printer, onProgress);
  },
};
