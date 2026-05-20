/**
 * .goo file exporter for Elegoo / Chitu-based resin printers.
 *
 * The .goo format is the native binary format used by Chitu Systems
 * mainboards (Elegoo Saturn, Mars series, Anycubic, etc.).
 *
 * File layout:
 *   [HEADER]  – 0x98 (152) bytes with magic, printer settings, layout offsets
 *   [PREVIEW] – Two RGB565 thumbnails (large 400×250, small 200×125)
 *   [LAYER TABLE] – 16-byte entries, one per layer, pointing into the data section
 *   [LAYER DATA]  – RLE-compressed 1-bit pixel data per layer
 */
import {
  getLayerSourceCount,
  resolveLayerSourcePngs,
  yieldToBrowser,
} from './formats/exporters/slice/export-helpers';
import type { LayerSource } from './core/format-registry';

// ─── Types ──────────────────────────────────────────────────

interface SliceSettings {
  layerHeight: number;
  normalExposure: number;
  bottomLayers: number;
  bottomExposure: number;
  liftHeight: number;
  liftSpeed: number;
  modelVolumeMm3?: number;
  supportVolumeMm3?: number;
  totalVolumeMm3?: number;
  volumeBreakdownExact?: boolean;
  [key: string]: unknown;
}

interface PrinterSpecLike {
  name: string;
  resolutionX: number;
  resolutionY: number;
  buildWidthMM?: number;
  buildDepthMM?: number;
  buildHeightMM?: number;
}

type ProgressCallback = (current: number, total: number, extra?: string) => void;

// ─── Helpers ────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Convert an RGBA pixel buffer to 1-bit RLE encoding (run-length encoded).
 *
 * Each pixel > 128 luminosity is "on" (1), otherwise "off" (0).
 * Bits are packed MSB-first per byte row, then consecutive identical
 * bytes are grouped into (count, value) pairs.
 */
function encodeGooRle(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const bytesPerRow = Math.ceil(width / 8);
  const totalBytes = bytesPerRow * height;
  const mono = new Uint8Array(totalBytes);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const on = pixels[srcIdx] > 128 || pixels[srcIdx + 1] > 128 || pixels[srcIdx + 2] > 128;
      if (on) {
        const byteIdx = y * bytesPerRow + (x >> 3);
        mono[byteIdx] |= 1 << (7 - (x & 7));
      }
    }
  }

  // RLE encode: (count, value) pairs, max count 255
  const rle: number[] = [];
  let i = 0;
  while (i < totalBytes) {
    let count = 1;
    while (i + count < totalBytes && count < 255 && mono[i + count] === mono[i]) {
      count++;
    }
    rle.push(count, mono[i]);
    i += count;
  }

  return new Uint8Array(rle);
}

/**
 * Downscale a full-resolution layer to an RGB565 preview thumbnail.
 */
function renderPreview(
  getLayerRGBA: (index: number) => Uint8Array,
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number,
  layerIndex: number,
): Uint8Array {
  const src = getLayerRGBA(layerIndex);
  const pixelCount = targetWidth * targetHeight;
  const out = new Uint8Array(pixelCount * 2);
  const scaleX = srcWidth / targetWidth;
  const scaleY = srcHeight / targetHeight;

  for (let ty = 0; ty < targetHeight; ty++) {
    for (let tx = 0; tx < targetWidth; tx++) {
      const sx = Math.floor(tx * scaleX);
      const sy = Math.floor(ty * scaleY);
      const srcIdx = (sy * srcWidth + sx) * 4;
      const r = src[srcIdx] >> 3;
      const g = src[srcIdx + 1] >> 2;
      const b = src[srcIdx + 2] >> 3;
      const rgb565 = (r << 11) | (g << 5) | b;
      const dstIdx = (ty * targetWidth + tx) * 2;
      out[dstIdx] = rgb565 & 0xff;
      out[dstIdx + 1] = (rgb565 >> 8) & 0xff;
    }
  }

  return out;
}

// ─── Main export function ───────────────────────────────────

export async function exportGooToBlob(
  source: LayerSource,
  settings: SliceSettings,
  printerSpec: PrinterSpecLike,
  onProgress?: ProgressCallback,
): Promise<Blob> {
  const { resolutionX, resolutionY } = printerSpec;
  const layerCount = getLayerSourceCount(source);

  // ── Obtain synchronous RGBA layer accessor ─────────────────
  // Pre-decode PNGs to RGBA upfront so the remainder can be synchronous.
  const rgbas: Uint8Array[] =
    source.kind === 'pixels'
      ? source.layers
      : await Promise.all(
          (await resolveLayerSourcePngs(source, resolutionX, resolutionY, onProgress)).map(
            async (png) => {
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
            },
          ),
        );
  const getLayerRGBA = (i: number): Uint8Array => rgbas[i];

  // ── Layout constants ────────────────────────────────────
  const HEADER_SIZE = 0x98; // 152 bytes, version 4 header
  const PREVIEW_LARGE_W = 400;
  const PREVIEW_LARGE_H = 250;
  const PREVIEW_SMALL_W = 200;
  const PREVIEW_SMALL_H = 125;
  const previewLargeBytes = PREVIEW_LARGE_W * PREVIEW_LARGE_H * 2; // RGB565
  const previewSmallBytes = PREVIEW_SMALL_W * PREVIEW_SMALL_H * 2; // RGB565
  const layerEntrySize = 16;

  const layerTableOffset = HEADER_SIZE + previewLargeBytes + previewSmallBytes;
  const layerTableSize = layerCount * layerEntrySize;
  const layerDataStart = layerTableOffset + layerTableSize;

  // ── Write binary header ─────────────────────────────────
  const parts: Uint8Array[] = [];

  const header = new ArrayBuffer(HEADER_SIZE);
  const h = new DataView(header);
  const magic = new TextEncoder().encode('goo!');
  new Uint8Array(header, 0, 4).set(magic);
  parts.push(new Uint8Array(header));

  h.setUint32(0x04, HEADER_SIZE, true); // headerSize
  h.setUint32(0x08, 4, true); // version
  h.setFloat32(0x0c, resolutionX, true); // pixel width
  h.setFloat32(0x10, resolutionY, true); // pixel height
  h.setFloat32(0x14, printerSpec.buildHeightMM ?? 200, true);
  h.setUint32(0x18, layerCount, true); // total layers
  h.setFloat32(0x1c, settings.layerHeight, true);

  // Exposure
  h.setFloat32(0x20, settings.bottomExposure ?? settings.normalExposure, true);
  h.setFloat32(0x24, settings.normalExposure, true);
  h.setFloat32(
    0x28,
    (settings.bottomExposure ?? settings.normalExposure) / settings.normalExposure,
    true,
  );
  h.setUint32(0x2c, settings.bottomLayers ?? 0, true);

  // Lift / retract
  const liftH = settings.liftHeight ?? 8;
  const liftS = settings.liftSpeed ?? 3;
  h.setFloat32(0x30, liftH, true);
  h.setFloat32(0x34, liftS * 60, true); // mm/min
  h.setFloat32(0x38, liftS * 60, true); // retract mm/min
  h.setFloat32(0x3c, liftH, true); // bottom lift
  h.setFloat32(0x40, liftS * 60, true); // bottom lift speed
  h.setFloat32(0x44, liftH, true); // retract height
  h.setFloat32(0x48, 0, true);
  h.setFloat32(0x4c, 0, true);

  // Build volume (mm)
  h.setFloat32(0x50, printerSpec.buildWidthMM ?? 192, true);
  h.setFloat32(0x54, printerSpec.buildDepthMM ?? 120, true);
  h.setFloat32(0x58, printerSpec.buildHeightMM ?? 200, true);

  h.setUint32(0x5c, 0, true); // anti-alias level
  h.setUint32(0x60, 255, true); // light PWM

  // Padding
  for (let i = 0x64; i < 0x74; i += 4) h.setUint32(i, 0, true);

  // Preview dimensions
  h.setUint32(0x74, PREVIEW_LARGE_W, true);
  h.setUint32(0x78, PREVIEW_LARGE_H, true);
  h.setUint32(0x7c, PREVIEW_SMALL_W, true);
  h.setUint32(0x80, PREVIEW_SMALL_H, true);

  // Layer table offset
  h.setUint32(0x84, layerTableOffset, true);
  h.setUint32(0x88, 0, true);
  h.setUint32(0x8c, 0, true);
  h.setUint32(0x90, 0, true);
  h.setUint32(0x94, 0, true);

  // ── Previews (from a representative layer) ──────────────
  const previewLayer = Math.min(2, layerCount - 1);
  parts.push(
    renderPreview(
      getLayerRGBA,
      resolutionX,
      resolutionY,
      PREVIEW_LARGE_W,
      PREVIEW_LARGE_H,
      previewLayer,
    ),
  );
  parts.push(
    renderPreview(
      getLayerRGBA,
      resolutionX,
      resolutionY,
      PREVIEW_SMALL_W,
      PREVIEW_SMALL_H,
      previewLayer,
    ),
  );

  // ── Encode layers ───────────────────────────────────────
  let dataOffset = 0;
  for (let i = 0; i < layerCount; i++) {
    onProgress?.(i + 1, layerCount, `Encoding layer ${i + 1} / ${layerCount}`);
    await yieldToBrowser();
    const rgba = getLayerRGBA(i);
    const rle = encodeGooRle(rgba, resolutionX, resolutionY);
    const rleSize = rle.length;

    // 16-byte layer entry
    const entry = new ArrayBuffer(layerEntrySize);
    const ev = new DataView(entry);
    ev.setUint32(0, layerDataStart + dataOffset, true);
    ev.setUint32(4, 0, true);
    ev.setUint32(8, rleSize, true);
    ev.setUint16(12, resolutionX, true);
    ev.setUint16(14, resolutionY, true);
    parts.push(new Uint8Array(entry));

    parts.push(rle);
    dataOffset += rleSize;
  }

  // ── Assemble final blob ─────────────────────────────────
  onProgress?.(layerCount, layerCount, 'Building .goo file...');
  await yieldToBrowser();

  const totalSize = parts.reduce((s, b) => s + b.byteLength, 0);
  const finalBuf = new Uint8Array(totalSize);
  let off = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    finalBuf.set(part, off);
    off += part.byteLength;
    if (i % 20 === 0) await yieldToBrowser();
  }

  return new Blob([finalBuf], { type: 'application/octet-stream' });
}

export async function exportGoo(
  source: LayerSource,
  settings: SliceSettings,
  printerSpec: PrinterSpecLike,
  onProgress?: ProgressCallback,
): Promise<void> {
  const blob = await exportGooToBlob(source, settings, printerSpec, onProgress);
  const layerCount = getLayerSourceCount(source);
  const safeName = printerSpec.name.replace(/\s+/g, '-').toLowerCase();
  downloadBlob(blob, `${safeName}_${layerCount}layers.goo`);
}
