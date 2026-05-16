import { describe, expect, it } from 'vitest';
import { buildSliceQaIssues, summarizeQaIssues } from './qa-detector';
import type { PeelForceProfile } from './peel-force';

function layer(width: number, height: number, filled: Array<[number, number]>): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (const [x, y] of filled) {
    const index = (y * width + x) * 4;
    pixels[index] = 255;
    pixels[index + 1] = 255;
    pixels[index + 2] = 255;
    pixels[index + 3] = 255;
  }
  return pixels;
}

describe('slice qa detector', () => {
  it('detects empty layers between printable layers', () => {
    const layers = [layer(4, 4, [[1, 1]]), layer(4, 4, []), layer(4, 4, [[1, 1]])];

    const issues = buildSliceQaIssues(layers, 4, []);

    expect(issues.map((issue) => issue.type)).toContain('empty-layer');
  });

  it('detects pixels near print bounds', () => {
    const layers = [layer(4, 4, [[0, 2]])];

    const issues = buildSliceQaIssues(layers, 4, [], null, { boundsMarginPx: 1 });

    expect(issues[0]).toMatchObject({ type: 'touching-bounds', layerIndex: 0 });
  });

  it('aggregates islands and peel spikes into one sorted issue list', () => {
    const peelProfile: PeelForceProfile = {
      areaPerLayer: new Float64Array([10, 90, 100]),
      maxAreaMM2: 100,
      peakLayerIndex: 2,
      pixelAreaMM2: 1,
    };

    const issues = buildSliceQaIssues(
      [layer(4, 4, []), layer(4, 4, []), layer(4, 4, [])],
      4,
      [{ layerIndex: 1, islandCount: 2, floatingPixels: 12 }],
      peelProfile,
    );

    expect(issues.map((issue) => issue.type)).toEqual(['island', 'peel-spike', 'peel-spike']);
    expect(summarizeQaIssues(issues)).toContain('1 error');
  });
});
