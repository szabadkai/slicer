import { describe, it, expect } from 'vitest';
import {
  computeIntentDensityMultiplier,
  computeIntentTipScale,
  shouldAvoidContact,
  preferContactZone,
  generateExplanation,
  detectConflicts,
} from './engine';
import { encodeIntent, createIntentBuffer } from './types';

// ─── Density multiplier ──────────────────────────────────────

describe('computeIntentDensityMultiplier', () => {
  it('cosmetic + high priority + appearance-first → very low density', () => {
    const result = computeIntentDensityMultiplier('cosmetic', 'high', 0.0);
    expect(result).toBeLessThan(0.3);
  });

  it('cosmetic + high priority + reliability-first → approaches normal', () => {
    const result = computeIntentDensityMultiplier('cosmetic', 'high', 1.0);
    expect(result).toBeGreaterThan(0.8);
  });

  it('reliability-critical + high → much higher than 1', () => {
    const result = computeIntentDensityMultiplier('reliability-critical', 'high', 0.5);
    expect(result).toBeGreaterThan(1.5);
  });

  it('reliability-critical + low → modest increase', () => {
    const result = computeIntentDensityMultiplier('reliability-critical', 'low', 0.5);
    expect(result).toBeGreaterThan(1.0);
    expect(result).toBeLessThan(1.5);
  });

  it('hidden increases density', () => {
    const result = computeIntentDensityMultiplier('hidden', 'medium', 0.5);
    expect(result).toBeGreaterThan(1.0);
  });

  it('removal-sensitive slightly reduces density', () => {
    const result = computeIntentDensityMultiplier('removal-sensitive', 'medium', 0.5);
    expect(result).toBeLessThan(1.0);
  });
});

// ─── Tip scale ───────────────────────────────────────────────

describe('computeIntentTipScale', () => {
  it('cosmetic reduces tip size', () => {
    const result = computeIntentTipScale('cosmetic', 'high', 0.5);
    expect(result).toBeLessThan(0.7);
  });

  it('reliability-critical increases tip size', () => {
    const result = computeIntentTipScale('reliability-critical', 'high', 0.5);
    expect(result).toBeGreaterThan(1.2);
  });

  it('removal-sensitive has small tips', () => {
    const result = computeIntentTipScale('removal-sensitive', 'high', 0.5);
    expect(result).toBeLessThan(0.6);
  });

  it('hidden is neutral', () => {
    const result = computeIntentTipScale('hidden', 'medium', 0.5);
    expect(result).toBe(1.0);
  });
});

// ─── Contact avoidance ───────────────────────────────────────

describe('shouldAvoidContact', () => {
  it('cosmetic + high + appearance-first → avoid', () => {
    expect(shouldAvoidContact('cosmetic', 'high', 0.0)).toBe(true);
  });

  it('cosmetic + high + reliability-first → do not avoid', () => {
    expect(shouldAvoidContact('cosmetic', 'high', 0.9)).toBe(false);
  });

  it('cosmetic + low + moderate balance → do not avoid', () => {
    expect(shouldAvoidContact('cosmetic', 'low', 0.5)).toBe(false);
  });

  it('hidden never avoided', () => {
    expect(shouldAvoidContact('hidden', 'high', 0.0)).toBe(false);
  });

  it('reliability-critical never avoided', () => {
    expect(shouldAvoidContact('reliability-critical', 'high', 0.0)).toBe(false);
  });

  it('removal-sensitive never avoided', () => {
    expect(shouldAvoidContact('removal-sensitive', 'high', 0.0)).toBe(false);
  });
});

// ─── Prefer contact zone ─────────────────────────────────────

describe('preferContactZone', () => {
  it('hidden is preferred', () => {
    expect(preferContactZone('hidden')).toBe(true);
  });

  it('cosmetic is not preferred', () => {
    expect(preferContactZone('cosmetic')).toBe(false);
  });

  it('reliability-critical is not preferred (just enhanced)', () => {
    expect(preferContactZone('reliability-critical')).toBe(false);
  });
});

// ─── Explanation generation ──────────────────────────────────

describe('generateExplanation', () => {
  it('returns standard explanation for unassigned face', () => {
    const buffer = createIntentBuffer(10);
    const result = generateExplanation(5, buffer, 'overhang');
    expect(result.influencedBy).toBeNull();
    expect(result.modification).toBe('standard');
    expect(result.text).toContain('overhang');
  });

  it('returns enhanced explanation for reliability-critical face', () => {
    const buffer = createIntentBuffer(10);
    buffer[3] = encodeIntent('reliability-critical', 'high');
    const result = generateExplanation(3, buffer, 'overhang', 42);
    expect(result.influencedBy).toBe('reliability-critical');
    expect(result.priority).toBe('high');
    expect(result.modification).toBe('enhanced');
    expect(result.text).toContain('42°');
    expect(result.text).toContain('reliability-critical');
  });

  it('returns reduced explanation for cosmetic face', () => {
    const buffer = createIntentBuffer(10);
    buffer[0] = encodeIntent('cosmetic', 'medium');
    const result = generateExplanation(0, buffer, 'overhang');
    expect(result.modification).toBe('reduced');
    expect(result.text).toContain('cosmetic');
  });

  it('returns reduced explanation for removal-sensitive face', () => {
    const buffer = createIntentBuffer(10);
    buffer[7] = encodeIntent('removal-sensitive', 'high');
    const result = generateExplanation(7, buffer, 'island');
    expect(result.modification).toBe('reduced');
    expect(result.text).toContain('removal-sensitive');
    expect(result.text).toContain('island');
  });
});

// ─── Conflict detection ──────────────────────────────────────

describe('detectConflicts', () => {
  // Build a simple triangle for testing: equilateral on XZ at Y=10
  function makeTriPositions(count: number): Float32Array {
    const arr = new Float32Array(count * 9);
    for (let i = 0; i < count; i++) {
      const b = i * 9;
      // Simple triangle pointing down (overhang)
      arr[b + 0] = i; arr[b + 1] = 10; arr[b + 2] = 0;  // v0
      arr[b + 3] = i + 1; arr[b + 4] = 10; arr[b + 5] = 0; // v1
      arr[b + 6] = i; arr[b + 7] = 10; arr[b + 8] = 1;  // v2
    }
    return arr;
  }

  it('detects cosmetic face needing support', () => {
    const buffer = createIntentBuffer(5);
    buffer[0] = encodeIntent('cosmetic', 'high');
    buffer[2] = encodeIntent('cosmetic', 'medium');
    const positions = makeTriPositions(5);

    const conflicts = detectConflicts(buffer, [0, 1, 2], positions, 5);
    const cosmConflict = conflicts.find((c) => c.type === 'cosmetic-needs-support');
    expect(cosmConflict).toBeDefined();
    expect(cosmConflict!.triangleIndices).toContain(0);
    expect(cosmConflict!.triangleIndices).toContain(2);
    // face 1 is overhang but not cosmetic → not in conflict
    expect(cosmConflict!.triangleIndices).not.toContain(1);
  });

  it('returns no conflicts when no intents assigned', () => {
    const buffer = createIntentBuffer(5);
    const positions = makeTriPositions(5);
    const conflicts = detectConflicts(buffer, [0, 1, 2], positions, 5);
    expect(conflicts).toHaveLength(0);
  });

  it('detects cosmetic-reliability proximity conflict', () => {
    // Two adjacent triangles with conflicting intents
    const buffer = createIntentBuffer(3);
    buffer[0] = encodeIntent('cosmetic', 'high');
    buffer[1] = encodeIntent('reliability-critical', 'high');

    // Make triangles very close together (centroids within 2mm)
    const positions = new Float32Array(3 * 9);
    // Tri 0: centroid at (0.33, 10, 0.33)
    positions.set([0, 10, 0, 1, 10, 0, 0, 10, 1], 0);
    // Tri 1: centroid at (1.33, 10, 0.33) — ~1mm away
    positions.set([1, 10, 0, 2, 10, 0, 1, 10, 1], 9);
    // Tri 2: unassigned, far away
    positions.set([50, 10, 50, 51, 10, 50, 50, 10, 51], 18);

    const conflicts = detectConflicts(buffer, [], positions, 3);
    const overlapConflict = conflicts.find((c) => c.type === 'cosmetic-reliability-overlap');
    expect(overlapConflict).toBeDefined();
    expect(overlapConflict!.triangleIndices).toContain(0);
    expect(overlapConflict!.triangleIndices).toContain(1);
  });
});
