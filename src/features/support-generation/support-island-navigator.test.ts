import { describe, expect, it } from 'vitest';
import { detectSupportIslands } from './support-island-navigator';

describe('support island navigator', () => {
  it('clusters uncovered overhang triangles', () => {
    const positions = new Float32Array([
      0, 1, 0, 1, 1, 0, 0, 1, 1, 1.2, 1, 0, 2.2, 1, 0, 1.2, 1, 1, 30, 1, 0, 31, 1, 0, 30, 1, 1,
    ]);

    const islands = detectSupportIslands(positions, 3, [], { clusterDistance: 3 });

    expect(islands).toHaveLength(2);
    expect(islands[0].triangleCount).toBe(2);
    expect(islands[1].triangleCount).toBe(1);
  });

  it('excludes overhang triangles covered by support contacts', () => {
    const positions = new Float32Array([0, 1, 0, 1, 1, 0, 0, 1, 1]);

    const islands = detectSupportIslands(positions, 1, [{ x: 0.33, y: 1, z: 0.33 }], {
      coverageRadius: 1,
    });

    expect(islands).toHaveLength(0);
  });
});
