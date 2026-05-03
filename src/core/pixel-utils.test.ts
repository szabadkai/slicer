import { describe, it, expect } from 'vitest';
import { countWhitePixels } from './pixel-utils';

describe('countWhitePixels', () => {
  it('counts pixels with R channel above 128', () => {
    // 3 pixels: white(255), grey(200), black(0) — RGBA format
    const data = new Uint8Array([
      255, 255, 255, 255, // white → counted
      200, 200, 200, 255, // grey above threshold → counted
      0, 0, 0, 255,       // black → not counted
    ]);
    expect(countWhitePixels(data)).toBe(2);
  });

  it('returns 0 for empty buffer', () => {
    expect(countWhitePixels(new Uint8Array(0))).toBe(0);
  });

  it('returns 0 for all-black layer', () => {
    const data = new Uint8Array(400); // 100 pixels, all zeros
    expect(countWhitePixels(data)).toBe(0);
  });

  it('counts all pixels when all are white', () => {
    const pixelCount = 50;
    const data = new Uint8Array(pixelCount * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;     // R
      data[i + 1] = 255; // G
      data[i + 2] = 255; // B
      data[i + 3] = 255; // A
    }
    expect(countWhitePixels(data)).toBe(pixelCount);
  });

  it('only checks R channel, ignores G/B/A', () => {
    // R=0 but G/B/A are 255 — should NOT be counted
    const data = new Uint8Array([0, 255, 255, 255]);
    expect(countWhitePixels(data)).toBe(0);
  });

  it('threshold is exclusive at 128', () => {
    const data = new Uint8Array([
      128, 0, 0, 255, // exactly 128 → NOT counted (> 128 required)
      129, 0, 0, 255, // 129 → counted
    ]);
    expect(countWhitePixels(data)).toBe(1);
  });
});
