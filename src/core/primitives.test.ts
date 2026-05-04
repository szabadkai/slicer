import { describe, it, expect } from 'vitest';
import {
  createBoxPositions,
  createSpherePositions,
  createCylinderPositions,
  createConePositions,
  createPositions,
  applyTransform,
  containsPointLocal,
  containsPoint,
  trianglesInsidePrimitive,
  identityTransform,
  defaultParams,
  type PrimitiveTransform,
} from './primitives';

// ─── Helpers ───────────────────────────────────────────────

function triangleCount(positions: Float32Array): number {
  return positions.length / 9;
}

/** Count non-degenerate triangles (some are expected at poles/apex). */
function validTriangleCount(positions: Float32Array): number {
  let count = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i + 3] - positions[i];
    const ay = positions[i + 4] - positions[i + 1];
    const az = positions[i + 5] - positions[i + 2];
    const bx = positions[i + 6] - positions[i];
    const by = positions[i + 7] - positions[i + 1];
    const bz = positions[i + 8] - positions[i + 2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    if (cx * cx + cy * cy + cz * cz >= 1e-12) count++;
  }
  return count;
}

/** Check that every triangle has non-zero area. */
function hasNoDegenerateTriangles(positions: Float32Array): boolean {
  return validTriangleCount(positions) === triangleCount(positions);
}

// ─── Box ───────────────────────────────────────────────────

describe('createBoxPositions', () => {
  it('produces 12 triangles for a box', () => {
    const pos = createBoxPositions(10, 10, 10);
    expect(triangleCount(pos)).toBe(12);
  });

  it('contains no degenerate triangles', () => {
    const pos = createBoxPositions(5, 8, 3);
    expect(hasNoDegenerateTriangles(pos)).toBe(true);
  });

  it('vertices stay within half-extents', () => {
    const pos = createBoxPositions(4, 6, 2);
    for (let i = 0; i < pos.length; i += 3) {
      expect(Math.abs(pos[i])).toBeLessThanOrEqual(2 + 1e-6);
      expect(Math.abs(pos[i + 1])).toBeLessThanOrEqual(3 + 1e-6);
      expect(Math.abs(pos[i + 2])).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
});

// ─── Sphere ────────────────────────────────────────────────

describe('createSpherePositions', () => {
  it('produces triangles for the given segment count', () => {
    const pos = createSpherePositions(5, 8);
    expect(triangleCount(pos)).toBeGreaterThan(0);
    // Polar triangles are degenerate (UV sphere artifact) — most should be valid
    expect(validTriangleCount(pos)).toBeGreaterThan(triangleCount(pos) * 0.8);
  });

  it('all vertices lie on the sphere surface', () => {
    const r = 7;
    const pos = createSpherePositions(r, 12);
    for (let i = 0; i < pos.length; i += 3) {
      const dist = Math.sqrt(pos[i] ** 2 + pos[i + 1] ** 2 + pos[i + 2] ** 2);
      expect(dist).toBeCloseTo(r, 4);
    }
  });
});

// ─── Cylinder ──────────────────────────────────────────────

describe('createCylinderPositions', () => {
  it('produces valid geometry', () => {
    const pos = createCylinderPositions(3, 3, 10, 12);
    expect(triangleCount(pos)).toBeGreaterThan(0);
    expect(hasNoDegenerateTriangles(pos)).toBe(true);
  });

  it('side vertices stay within radii bounds', () => {
    const pos = createCylinderPositions(4, 6, 10, 16);
    const maxR = 6;
    for (let i = 0; i < pos.length; i += 3) {
      const r = Math.sqrt(pos[i] ** 2 + pos[i + 2] ** 2);
      expect(r).toBeLessThanOrEqual(maxR + 0.01);
    }
  });
});

// ─── Cone ──────────────────────────────────────────────────

describe('createConePositions', () => {
  it('produces valid geometry with apex at top', () => {
    const pos = createConePositions(5, 10, 12);
    expect(triangleCount(pos)).toBeGreaterThan(0);
    // Apex triangles are degenerate (zero-radius top) — most should be valid
    expect(validTriangleCount(pos)).toBeGreaterThan(triangleCount(pos) * 0.5);
  });
});

// ─── createPositions (dispatch) ────────────────────────────

describe('createPositions', () => {
  it('dispatches to box', () => {
    const pos = createPositions({ type: 'box', width: 2, height: 2, depth: 2 });
    expect(triangleCount(pos)).toBe(12);
  });

  it('dispatches to sphere', () => {
    const pos = createPositions({ type: 'sphere', radius: 3, segments: 6 });
    expect(triangleCount(pos)).toBeGreaterThan(0);
  });

  it('dispatches to cylinder', () => {
    const pos = createPositions({
      type: 'cylinder',
      radiusTop: 2,
      radiusBottom: 2,
      height: 5,
      segments: 8,
    });
    expect(triangleCount(pos)).toBeGreaterThan(0);
  });

  it('dispatches to cone', () => {
    const pos = createPositions({ type: 'cone', radius: 3, height: 6, segments: 8 });
    expect(triangleCount(pos)).toBeGreaterThan(0);
  });
});

// ─── Transform ─────────────────────────────────────────────

describe('applyTransform', () => {
  it('translates vertices', () => {
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const t: PrimitiveTransform = { position: [10, 20, 30], rotation: [0, 0, 0], scale: [1, 1, 1] };
    const result = applyTransform(pos, t);
    expect(result[0]).toBeCloseTo(10);
    expect(result[1]).toBeCloseTo(20);
    expect(result[2]).toBeCloseTo(30);
  });

  it('scales vertices', () => {
    const pos = new Float32Array([1, 1, 1]);
    const t: PrimitiveTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 3, 4] };
    const result = applyTransform(pos, t);
    expect(result[0]).toBeCloseTo(2);
    expect(result[1]).toBeCloseTo(3);
    expect(result[2]).toBeCloseTo(4);
  });
});

// ─── Containment ───────────────────────────────────────────

describe('containsPointLocal', () => {
  it('box: inside', () => {
    expect(containsPointLocal({ type: 'box', width: 10, height: 10, depth: 10 }, 0, 0, 0)).toBe(
      true,
    );
  });

  it('box: outside', () => {
    expect(containsPointLocal({ type: 'box', width: 10, height: 10, depth: 10 }, 6, 0, 0)).toBe(
      false,
    );
  });

  it('sphere: inside', () => {
    expect(containsPointLocal({ type: 'sphere', radius: 5, segments: 12 }, 3, 0, 0)).toBe(true);
  });

  it('sphere: outside', () => {
    expect(containsPointLocal({ type: 'sphere', radius: 5, segments: 12 }, 6, 0, 0)).toBe(false);
  });

  it('cylinder: inside', () => {
    expect(
      containsPointLocal(
        { type: 'cylinder', radiusTop: 3, radiusBottom: 3, height: 10, segments: 12 },
        2,
        0,
        0,
      ),
    ).toBe(true);
  });

  it('cylinder: outside (radial)', () => {
    expect(
      containsPointLocal(
        { type: 'cylinder', radiusTop: 3, radiusBottom: 3, height: 10, segments: 12 },
        4,
        0,
        0,
      ),
    ).toBe(false);
  });

  it('cone: inside at base', () => {
    expect(
      containsPointLocal({ type: 'cone', radius: 5, height: 10, segments: 12 }, 2, -4, 0),
    ).toBe(true);
  });

  it('cone: outside at top', () => {
    expect(containsPointLocal({ type: 'cone', radius: 5, height: 10, segments: 12 }, 3, 4, 0)).toBe(
      false,
    );
  });
});

describe('containsPoint', () => {
  it('respects translation', () => {
    const params = { type: 'box' as const, width: 2, height: 2, depth: 2 };
    const t: PrimitiveTransform = { position: [10, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    expect(containsPoint(params, t, 10, 0, 0)).toBe(true);
    expect(containsPoint(params, t, 0, 0, 0)).toBe(false);
  });

  it('respects scale', () => {
    const params = { type: 'sphere' as const, radius: 1, segments: 8 };
    const t: PrimitiveTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [5, 5, 5] };
    expect(containsPoint(params, t, 4, 0, 0)).toBe(true);
    expect(containsPoint(params, t, 6, 0, 0)).toBe(false);
  });
});

describe('trianglesInsidePrimitive', () => {
  it('returns indices of triangles inside a box', () => {
    // Two triangles: one at origin, one far away
    const positions = new Float32Array([
      // Triangle 0: centroid ~(0,0,0)
      -1, -1, 0, 1, -1, 0, 0, 2, 0,
      // Triangle 1: centroid ~(100,0,0)
      99, -1, 0, 101, -1, 0, 100, 2, 0,
    ]);
    const params = { type: 'box' as const, width: 20, height: 20, depth: 20 };
    const indices = trianglesInsidePrimitive(positions, params, identityTransform());
    expect(indices).toEqual([0]);
  });
});

// ─── Defaults ──────────────────────────────────────────────

describe('defaultParams', () => {
  it('returns valid params for each type', () => {
    expect(defaultParams('box').type).toBe('box');
    expect(defaultParams('sphere').type).toBe('sphere');
    expect(defaultParams('cylinder').type).toBe('cylinder');
    expect(defaultParams('cone').type).toBe('cone');
  });
});
