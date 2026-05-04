import { describe, it, expect, beforeEach } from 'vitest';
import {
  encodeIntent,
  decodeIntent,
  createIntentBuffer,
  hasAnyIntent,
  countIntent,
  type SurfaceIntent,
  type IntentPriority,
} from './types';
import {
  intentsByModel,
  ensureIntentBuffer,
  setFaceIntents,
  clearIntents,
  removeIntentBuffer,
  getIntentBuffer,
  activeIntentBrush,
  appearanceReliabilityBalance,
  cleanupMaterialBalance,
} from './store';

// ─── Encoding / Decoding ─────────────────────────────────────

describe('encodeIntent / decodeIntent', () => {
  const cases: Array<[SurfaceIntent, IntentPriority]> = [
    ['cosmetic', 'low'],
    ['cosmetic', 'medium'],
    ['cosmetic', 'high'],
    ['hidden', 'low'],
    ['hidden', 'medium'],
    ['hidden', 'high'],
    ['reliability-critical', 'low'],
    ['reliability-critical', 'medium'],
    ['reliability-critical', 'high'],
    ['removal-sensitive', 'low'],
    ['removal-sensitive', 'medium'],
    ['removal-sensitive', 'high'],
  ];

  it.each(cases)('roundtrips %s / %s', (intent, priority) => {
    const encoded = encodeIntent(intent, priority);
    expect(encoded).toBeGreaterThan(0);
    expect(encoded).toBeLessThan(256);
    const decoded = decodeIntent(encoded);
    expect(decoded).toEqual({ intent, priority });
  });

  it('decodes 0 as null (unassigned)', () => {
    expect(decodeIntent(0)).toBeNull();
  });

  it('produces unique bytes for every intent/priority combo', () => {
    const seen = new Set<number>();
    for (const [intent, priority] of cases) {
      const val = encodeIntent(intent, priority);
      expect(seen.has(val)).toBe(false);
      seen.add(val);
    }
  });
});

// ─── IntentBuffer helpers ────────────────────────────────────

describe('IntentBuffer helpers', () => {
  it('createIntentBuffer creates a zeroed Uint8Array', () => {
    const buf = createIntentBuffer(100);
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(buf.length).toBe(100);
    expect(buf.every((v) => v === 0)).toBe(true);
  });

  it('hasAnyIntent returns false for empty buffer', () => {
    expect(hasAnyIntent(createIntentBuffer(50))).toBe(false);
  });

  it('hasAnyIntent returns true when at least one face is assigned', () => {
    const buf = createIntentBuffer(50);
    buf[25] = encodeIntent('hidden', 'low');
    expect(hasAnyIntent(buf)).toBe(true);
  });

  it('countIntent counts matching faces', () => {
    const buf = createIntentBuffer(10);
    buf[0] = encodeIntent('cosmetic', 'high');
    buf[3] = encodeIntent('cosmetic', 'low');
    buf[5] = encodeIntent('hidden', 'medium');
    buf[7] = encodeIntent('cosmetic', 'medium');
    expect(countIntent(buf, 'cosmetic')).toBe(3);
    expect(countIntent(buf, 'hidden')).toBe(1);
    expect(countIntent(buf, 'reliability-critical')).toBe(0);
  });
});

// ─── Store operations ────────────────────────────────────────

describe('intent store', () => {
  beforeEach(() => {
    // Reset store state
    intentsByModel.value = new Map();
    activeIntentBrush.value = { intent: 'cosmetic', priority: 'medium' };
    appearanceReliabilityBalance.value = 0.5;
    cleanupMaterialBalance.value = 0.5;
  });

  it('ensureIntentBuffer creates a buffer for a new model', () => {
    const buf = ensureIntentBuffer('model-1', 200);
    expect(buf.length).toBe(200);
    expect(getIntentBuffer('model-1')).toBe(buf);
  });

  it('ensureIntentBuffer returns existing buffer if size matches', () => {
    const buf1 = ensureIntentBuffer('model-1', 200);
    const buf2 = ensureIntentBuffer('model-1', 200);
    expect(buf2).toBe(buf1);
  });

  it('ensureIntentBuffer copies data when resizing', () => {
    const buf1 = ensureIntentBuffer('model-1', 100);
    buf1[50] = encodeIntent('hidden', 'high');
    const buf2 = ensureIntentBuffer('model-1', 200);
    expect(buf2.length).toBe(200);
    expect(buf2[50]).toBe(encodeIntent('hidden', 'high'));
  });

  it('setFaceIntents writes to specific triangles', () => {
    ensureIntentBuffer('model-1', 100);
    setFaceIntents('model-1', [10, 20, 30], 'cosmetic', 'high');
    const buf = getIntentBuffer('model-1')!;
    const expected = encodeIntent('cosmetic', 'high');
    expect(buf[10]).toBe(expected);
    expect(buf[20]).toBe(expected);
    expect(buf[30]).toBe(expected);
    expect(buf[0]).toBe(0); // untouched
  });

  it('setFaceIntents ignores out-of-range indices', () => {
    ensureIntentBuffer('model-1', 10);
    // Should not throw
    setFaceIntents('model-1', [-1, 10, 100], 'hidden', 'low');
    const buf = getIntentBuffer('model-1')!;
    expect(buf.every((v) => v === 0)).toBe(true);
  });

  it('setFaceIntents triggers a new Map reference', () => {
    ensureIntentBuffer('model-1', 50);
    const mapBefore = intentsByModel.value;
    setFaceIntents('model-1', [5], 'cosmetic', 'low');
    expect(intentsByModel.value).not.toBe(mapBefore);
  });

  it('clearIntents zeroes all faces', () => {
    ensureIntentBuffer('model-1', 50);
    setFaceIntents('model-1', [0, 10, 20], 'reliability-critical', 'high');
    clearIntents('model-1');
    const buf = getIntentBuffer('model-1')!;
    expect(buf.every((v) => v === 0)).toBe(true);
  });

  it('removeIntentBuffer deletes the model entry', () => {
    ensureIntentBuffer('model-1', 50);
    removeIntentBuffer('model-1');
    expect(getIntentBuffer('model-1')).toBeUndefined();
  });

  it('operations on non-existent model are safe no-ops', () => {
    // Should not throw
    setFaceIntents('ghost', [0], 'cosmetic', 'low');
    clearIntents('ghost');
    removeIntentBuffer('ghost');
    expect(getIntentBuffer('ghost')).toBeUndefined();
  });
});
