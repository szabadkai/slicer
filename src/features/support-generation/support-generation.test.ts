import { describe, it, expect, beforeEach } from 'vitest';
import { detectOverhangs } from './detect';
import { sampleContactPoints, generatePillars } from './build';
import { supportsByModel, setSupports, clearSupports, toggleSupportVisibility } from './store';

// ─── Test geometry helpers ─────────────────────────────────

/** A single downward-facing triangle (normal pointing -Y) at height 5 */
function makeDownwardTriangle(): Float32Array {
  // prettier-ignore
  return new Float32Array([
    0, 5, 0,
    1, 5, 0,
    0.5, 5, 1,
  ]);
}

/** A single upward-facing triangle (normal pointing +Y) */
function makeUpwardTriangle(): Float32Array {
  // prettier-ignore
  return new Float32Array([
    0, 0, 0,
    0.5, 0, 1,
    1, 0, 0,
  ]);
}

/** 2 triangles: one facing down, one facing up */
function makeMixedTriangles(): Float32Array {
  const down = makeDownwardTriangle();
  const up = makeUpwardTriangle();
  const combined = new Float32Array(18);
  combined.set(down, 0);
  combined.set(up, 9);
  return combined;
}

// ─── Detection tests ───────────────────────────────────────

describe('support-generation detect', () => {
  it('detects downward-facing triangle as overhang', () => {
    const positions = makeDownwardTriangle();
    const result = detectOverhangs(positions, 1);
    expect(result.count).toBe(1);
    expect(result.overhangTriangles).toContain(0);
  });

  it('does not detect upward-facing triangle as overhang', () => {
    const positions = makeUpwardTriangle();
    const result = detectOverhangs(positions, 1);
    expect(result.count).toBe(0);
  });

  it('respects angle threshold parameter', () => {
    const positions = makeDownwardTriangle();
    // With angle 80° almost nothing qualifies as overhang
    const result = detectOverhangs(positions, 1, { angleDeg: 80 });
    // The triangle is flat horizontal (facing pure -Y) → angle from -Y is 0°
    // cos(90-80) = cos(10°) ≈ 0.985. dot(normal, -Y) = 1 > 0.985 → still overhang
    expect(result.count).toBe(1);
  });

  it('mixed triangles: only overhang detected', () => {
    const positions = makeMixedTriangles();
    const result = detectOverhangs(positions, 2);
    expect(result.count).toBe(1);
    expect(result.overhangTriangles).toContain(0);
  });
});

// ─── Build / sampling tests ────────────────────────────────

describe('support-generation build', () => {
  it('sampleContactPoints produces at least one point per overhang triangle', () => {
    const positions = makeDownwardTriangle();
    const contacts = sampleContactPoints(positions, [0]);
    expect(contacts.length).toBeGreaterThanOrEqual(1);
    expect(contacts[0].triangleIndex).toBe(0);
  });

  it('contact point is at triangle centroid', () => {
    const positions = makeDownwardTriangle();
    const contacts = sampleContactPoints(positions, [0]);
    const c = contacts[0];
    expect(c.x).toBeCloseTo(0.5, 4);
    expect(c.y).toBeCloseTo(5, 4);
    expect(c.z).toBeCloseTo(1 / 3, 4);
  });

  it('generatePillars creates a straight-down path', () => {
    const positions = makeDownwardTriangle();
    const contacts = sampleContactPoints(positions, [0]);
    const result = generatePillars(contacts);
    expect(result.pillars.length).toBeGreaterThanOrEqual(1);
    const pillar = result.pillars[0];
    expect(pillar.path[0].y).toBeCloseTo(5, 4);
    expect(pillar.path[1].y).toBe(0);
    expect(pillar.routed).toBe(true);
  });

  it('skips contacts at or below build plate', () => {
    const contacts = [{ x: 0, y: 0, z: 0, triangleIndex: 0 }];
    const result = generatePillars(contacts);
    expect(result.skippedCount).toBe(1);
    expect(result.pillars).toHaveLength(0);
  });
});

// ─── Store tests ───────────────────────────────────────────

describe('support-generation store', () => {
  beforeEach(() => {
    supportsByModel.value = new Map();
  });

  it('setSupports stores result for model', () => {
    const result = { pillars: [], skippedCount: 0 };
    setSupports('model-1', result);
    expect(supportsByModel.value.get('model-1')).toBeDefined();
    expect(supportsByModel.value.get('model-1')!.visible).toBe(true);
  });

  it('clearSupports removes only specified model', () => {
    setSupports('model-1', { pillars: [], skippedCount: 0 });
    setSupports('model-2', { pillars: [], skippedCount: 0 });
    clearSupports('model-1');
    expect(supportsByModel.value.has('model-1')).toBe(false);
    expect(supportsByModel.value.has('model-2')).toBe(true);
  });

  it('toggleSupportVisibility flips visibility', () => {
    setSupports('model-1', { pillars: [], skippedCount: 0 });
    expect(supportsByModel.value.get('model-1')!.visible).toBe(true);
    toggleSupportVisibility('model-1');
    expect(supportsByModel.value.get('model-1')!.visible).toBe(false);
    toggleSupportVisibility('model-1');
    expect(supportsByModel.value.get('model-1')!.visible).toBe(true);
  });
});
