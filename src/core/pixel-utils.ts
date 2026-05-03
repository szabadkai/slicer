/**
 * Shared pixel-counting utilities for slice layer analysis.
 */

/**
 * Count white (filled) pixels in an RGBA layer buffer.
 * Monochrome slice output uses R channel > 128 as "filled".
 * Uses Uint32Array view for ~4× fewer loop iterations on aligned buffers.
 */
export function countWhitePixels(layerData: Uint8Array): number {
  let count = 0;

  // Fast path: interpret as packed 32-bit words (RGBA as single uint32).
  // On little-endian the R channel occupies the lowest byte.
  // We extract R via bitmask and compare > 128.
  if (layerData.byteOffset % 4 === 0 && layerData.byteLength % 4 === 0) {
    const u32 = new Uint32Array(layerData.buffer, layerData.byteOffset, layerData.byteLength / 4);
    for (let i = 0; i < u32.length; i++) {
      if ((u32[i] & 0xFF) > 128) count++;
    }
    return count;
  }

  // Fallback: byte-by-byte stride
  for (let i = 0; i < layerData.length; i += 4) {
    if (layerData[i] > 128) count++;
  }
  return count;
}
