import { describe, it, expect } from 'vitest';
import {
  generateCandidateUpVectors,
  scoreCandidates,
  STRATEGY_PRESETS,
} from './engine';
import type { Strategy } from './engine';

// A tall narrow box: 1×1×10 (Z-tall)
function makeTallBox(): { positions: Float32Array; triangleCount: number } {
  // 6 faces × 2 triangles = 12 triangles, 36 vertices
  const w = 1;
  const h = 1;
  const d = 10;
  // prettier-ignore
  const positions = new Float32Array([
    // Front (z=d)
    0,0,d, w,0,d, w,h,d,   0,0,d, w,h,d, 0,h,d,
    // Back (z=0)
    w,0,0, 0,0,0, 0,h,0,   w,0,0, 0,h,0, w,h,0,
    // Top (y=h)
    0,h,d, w,h,d, w,h,0,   0,h,d, w,h,0, 0,h,0,
    // Bottom (y=0)
    0,0,0, w,0,0, w,0,d,   0,0,0, w,0,d, 0,0,d,
    // Right (x=w)
    w,0,d, w,0,0, w,h,0,   w,0,d, w,h,0, w,h,d,
    // Left (x=0)
    0,0,0, 0,0,d, 0,h,d,   0,0,0, 0,h,d, 0,h,0,
  ]);
  return { positions, triangleCount: 12 };
}

describe('auto-orientation engine', () => {
  it('generates exactly 26 candidate up-vectors', () => {
    const candidates = generateCandidateUpVectors();
    expect(candidates).toHaveLength(26);
  });

  it('all candidate vectors are unit length', () => {
    for (const c of generateCandidateUpVectors()) {
      const len = Math.sqrt(c.x ** 2 + c.y ** 2 + c.z ** 2);
      expect(len).toBeCloseTo(1, 4);
    }
  });

  it('strategy presets have valid weights', () => {
    const strategies: Strategy[] = ['print-speed', 'minimal-supports', 'surface-quality'];
    for (const s of strategies) {
      const w = STRATEGY_PRESETS[s];
      expect(w.height + w.overhangArea + w.staircaseMetric + w.flatBottomArea).toBeCloseTo(1, 5);
    }
  });

  it('scoreCandidates returns results for 26 directions (no protected face)', () => {
    const { positions, triangleCount } = makeTallBox();
    const results = scoreCandidates(positions, triangleCount, 'print-speed');
    expect(results.length).toBe(26);
  });

  it('print-speed strategy prefers orientation with low height', () => {
    const { positions, triangleCount } = makeTallBox();
    const results = scoreCandidates(positions, triangleCount, 'print-speed');
    const best = results[0];
    // Z-tall box: laying on side (up=Z) gives height=10, up=X or Y gives height=1
    // Best should have low height
    expect(best.metrics.height).toBeLessThanOrEqual(1.01);
  });

  it('protected face constraint filters orientations', () => {
    const { positions, triangleCount } = makeTallBox();
    const protectedNormal = { x: 0, y: 1, z: 0 }; // top face must stay up
    const results = scoreCandidates(positions, triangleCount, 'print-speed', protectedNormal);
    // Some orientations filtered out
    expect(results.length).toBeLessThan(26);
    // All remaining have upY dot protectedNormal >= 0
    for (const c of results) {
      const dot = c.upX * protectedNormal.x + c.upY * protectedNormal.y + c.upZ * protectedNormal.z;
      expect(dot).toBeGreaterThanOrEqual(0);
    }
  });
});
