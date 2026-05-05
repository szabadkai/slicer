import { describe, expect, it } from 'vitest';
import { cleanPlaneCutResult, cutGeometryByAxisPlane, cutGeometryByPlane } from './cut';
import { cutGeometryByManifoldPlane } from './manifold-cut';

function expectBounds(
  positions: Float32Array | null,
  expectedMin: [number, number, number],
  expectedMax: [number, number, number],
): void {
  expect(positions).not.toBeNull();
  const box = bounds(positions ?? new Float32Array());
  expect(box.min[0]).toBeCloseTo(expectedMin[0], 5);
  expect(box.min[1]).toBeCloseTo(expectedMin[1], 5);
  expect(box.min[2]).toBeCloseTo(expectedMin[2], 5);
  expect(box.max[0]).toBeCloseTo(expectedMax[0], 5);
  expect(box.max[1]).toBeCloseTo(expectedMax[1], 5);
  expect(box.max[2]).toBeCloseTo(expectedMax[2], 5);
}

describe('cutGeometryByAxisPlane', () => {
  it('cuts a box into two closed halves on X', () => {
    const result = cutGeometryByAxisPlane(boxPositions(10), 'x', 0);

    expect(result.negativeTriangleCount).toBeGreaterThan(12);
    expect(result.positiveTriangleCount).toBeGreaterThan(12);
    expectBounds(result.negative, [-5, -5, -5], [0, 5, 5]);
    expectBounds(result.positive, [0, -5, -5], [5, 5, 5]);
  });

  it('returns only one side when the plane misses the model', () => {
    const result = cutGeometryByAxisPlane(boxPositions(10), 'z', 20);

    expect(result.negative).not.toBeNull();
    expect(result.positive).toBeNull();
    expect(result.positiveTriangleCount).toBe(0);
  });

  it('cuts with an arbitrary diagonal plane', () => {
    const result = cutGeometryByPlane(boxPositions(10), [1, 1, 0], 1);

    expect(result.negative).not.toBeNull();
    expect(result.positive).not.toBeNull();
    expect(result.negativeTriangleCount).toBeGreaterThan(12);
    expect(result.positiveTriangleCount).toBeGreaterThan(12);
  });

  it('keeps usable cut halves when the source has unrelated non-manifold faces', () => {
    const box = boxPositions(10);
    const nonManifold = new Float32Array(box.length + 9);
    nonManifold.set(box);
    nonManifold.set(box.slice(0, 9), box.length);

    const result = cleanPlaneCutResult(cutGeometryByAxisPlane(nonManifold, 'x', 0));

    expect(result).not.toBeNull();
    expect(result?.negative).not.toBeNull();
    expect(result?.positive).not.toBeNull();
    expect(result?.negativeTriangleCount).toBeGreaterThan(0);
    expect(result?.positiveTriangleCount).toBeGreaterThan(0);
  });

  // Vitest's happy-dom server does not reliably serve third-party WASM assets as binaries.
  it.skip('cuts a box through manifold splitByPlane', async () => {
    const result = await cutGeometryByManifoldPlane(boxPositions(10), [1, 0, 0], 0);

    expect(result).not.toBeNull();
    expect(result?.negative).not.toBeNull();
    expect(result?.positive).not.toBeNull();
    expectBounds(result?.negative ?? null, [-5, -5, -5], [0, 5, 5]);
    expectBounds(result?.positive ?? null, [0, -5, -5], [5, 5, 5]);
  });
});

function bounds(positions: Float32Array): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    min[0] = Math.min(min[0], positions[i]);
    min[1] = Math.min(min[1], positions[i + 1]);
    min[2] = Math.min(min[2], positions[i + 2]);
    max[0] = Math.max(max[0], positions[i]);
    max[1] = Math.max(max[1], positions[i + 1]);
    max[2] = Math.max(max[2], positions[i + 2]);
  }
  return { min, max };
}

function boxPositions(size: number): Float32Array {
  const h = size / 2;
  const p = [
    // +x
    h,
    -h,
    -h,
    h,
    h,
    -h,
    h,
    h,
    h,
    h,
    -h,
    -h,
    h,
    h,
    h,
    h,
    -h,
    h,
    // -x
    -h,
    -h,
    h,
    -h,
    h,
    h,
    -h,
    h,
    -h,
    -h,
    -h,
    h,
    -h,
    h,
    -h,
    -h,
    -h,
    -h,
    // +y
    -h,
    h,
    -h,
    -h,
    h,
    h,
    h,
    h,
    h,
    -h,
    h,
    -h,
    h,
    h,
    h,
    h,
    h,
    -h,
    // -y
    -h,
    -h,
    h,
    -h,
    -h,
    -h,
    h,
    -h,
    -h,
    -h,
    -h,
    h,
    h,
    -h,
    -h,
    h,
    -h,
    h,
    // +z
    -h,
    -h,
    h,
    h,
    -h,
    h,
    h,
    h,
    h,
    -h,
    -h,
    h,
    h,
    h,
    h,
    -h,
    h,
    h,
    // -z
    h,
    -h,
    -h,
    -h,
    -h,
    -h,
    -h,
    h,
    -h,
    h,
    -h,
    -h,
    -h,
    h,
    -h,
    h,
    h,
    -h,
  ];
  return new Float32Array(p);
}
