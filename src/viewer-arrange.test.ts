import { describe, it, expect } from 'vitest';
import { arrange, distributeAcrossPlates, computeConvexHull } from './viewer-arrange';
import type { BodyFootprint, PlateLayout } from './viewer-arrange';

function makeSquareBody(id: string, size: number, canRotate = true): BodyFootprint {
  const half = size / 2;
  return {
    id,
    hull: [
      { x: -half, z: -half },
      { x: half, z: -half },
      { x: half, z: half },
      { x: -half, z: half },
    ],
    canRotate,
  };
}

describe('arrange — BLF with overflow placement', () => {
  it('places all models when they fit', () => {
    const bodies = [makeSquareBody('a', 20), makeSquareBody('b', 20), makeSquareBody('c', 20)];
    const results = arrange(bodies, 100, 100, { padding: 5 });

    expect(results.length).toBe(3);
    expect(results.every((r) => !r.overflow)).toBe(true);
  });

  it('places overflow models outside build volume', () => {
    // Each body is 60mm — two cannot fit on a 100mm plate with 5mm padding
    const bodies = [makeSquareBody('a', 60), makeSquareBody('b', 60), makeSquareBody('c', 60)];
    const results = arrange(bodies, 100, 100, { padding: 5 });

    const inBounds = results.filter((r) => !r.overflow);
    const overflow = results.filter((r) => r.overflow);

    // At least some fit, some overflow
    expect(inBounds.length).toBeGreaterThan(0);
    expect(overflow.length).toBeGreaterThan(0);
    // All bodies accounted for
    expect(results.length).toBe(3);
  });

  it('overflow models are positioned to the +X side of the plate', () => {
    // Single body too large for the plate
    const bodies = [makeSquareBody('big', 150)];
    const results = arrange(bodies, 100, 100, { padding: 5 });

    expect(results.length).toBe(1);
    expect(results[0].overflow).toBe(true);
    // Should be placed to the right of the plate (plate centre is 0, half-width is 50)
    expect(results[0].x).toBeGreaterThan(50);
  });

  it('multiple overflow models do not overlap each other', () => {
    const bodies = [makeSquareBody('a', 120), makeSquareBody('b', 80), makeSquareBody('c', 90)];
    const results = arrange(bodies, 100, 100, { padding: 5 });
    const overflow = results.filter((r) => r.overflow);

    // Verify no pair of overflow models overlap (using their padded AABB centres)
    for (let i = 0; i < overflow.length; i++) {
      for (let j = i + 1; j < overflow.length; j++) {
        const dist = Math.sqrt(
          (overflow[i].x - overflow[j].x) ** 2 + (overflow[i].z - overflow[j].z) ** 2,
        );
        // Minimum separation should be at least some positive value (not stacked at same point)
        expect(dist).toBeGreaterThan(1);
      }
    }
  });

  it('group centering only considers in-bounds models', () => {
    // One model fits, one does not
    const bodies = [makeSquareBody('fits', 30), makeSquareBody('big', 200)];
    const results = arrange(bodies, 100, 100, { padding: 5 });

    const inBounds = results.filter((r) => !r.overflow);
    // In-bounds model should be centred near plate centre (0,0)
    expect(inBounds.length).toBe(1);
    expect(Math.abs(inBounds[0].x)).toBeLessThan(1);
    expect(Math.abs(inBounds[0].z)).toBeLessThan(1);
  });

  it('respects canRotate: false for overflow models', () => {
    const body: BodyFootprint = {
      id: 'norot',
      hull: [
        { x: -100, z: -20 },
        { x: 100, z: -20 },
        { x: 100, z: 20 },
        { x: -100, z: 20 },
      ],
      canRotate: false,
    };
    const results = arrange([body], 50, 50, { padding: 5 });

    expect(results.length).toBe(1);
    expect(results[0].overflow).toBe(true);
    expect(results[0].angle).toBe(0);
  });
});

describe('distributeAcrossPlates — overflow placement', () => {
  it('places overflow models outside last plate instead of at origin', () => {
    const bodies = [makeSquareBody('a', 80), makeSquareBody('b', 80), makeSquareBody('c', 80)];
    const plates: PlateLayout[] = [{ plateId: 'p1', originX: 0, originZ: 0 }];
    const results = distributeAcrossPlates(bodies, plates, 100, 100, { padding: 5 });

    expect(results.length).toBe(3);
    const overflow = results.filter((r) => r.overflow);
    // Some models should overflow (not enough room for three 80mm+padding bodies on 100mm plate)
    expect(overflow.length).toBeGreaterThan(0);
    // Overflow should be on the last (only) plate
    for (const r of overflow) {
      expect(r.plateId).toBe('p1');
      // Positioned outside the plate boundary
      expect(r.x).toBeGreaterThan(50);
    }
  });
});

describe('computeConvexHull', () => {
  it('computes hull of a square', () => {
    const points = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
      { x: 0, z: 10 },
      { x: 5, z: 5 }, // interior point
    ];
    const hull = computeConvexHull(points);

    // Hull should have 4 vertices (the square corners)
    expect(hull.length).toBe(4);
  });
});
