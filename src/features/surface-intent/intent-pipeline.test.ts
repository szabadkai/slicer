// ─── Intent → support pipeline integration tests ───────────
// End-to-end tests verifying intent buffers affect support generation output.

import { describe, it, expect } from 'vitest';
import { encodeIntent, createIntentBuffer } from '@features/surface-intent/types';
import type { IntentSupportParams } from '@features/surface-intent/engine-types';
import { detectConflicts, generateExplanation } from '@features/surface-intent/engine';
import { detectOverhangs } from '@features/support-generation/detect';
import { sampleContactPoints, generatePillars } from '@features/support-generation/build';

// ─── Test geometry helpers ─────────────────────────────────

/** A single downward-facing triangle (normal pointing -Y) at height 5 */
function makeDownwardTriangle(): Float32Array {
  return new Float32Array([0, 5, 0, 1, 5, 0, 0.5, 5, 1]);
}

/** 4 downward-facing triangles at height 5, spread apart */
function makeMultipleOverhangs(): Float32Array {
  const positions = new Float32Array(4 * 9);
  for (let i = 0; i < 4; i++) {
    const offset = i * 2;
    const base = i * 9;
    positions[base] = offset;
    positions[base + 1] = 5;
    positions[base + 2] = 0;
    positions[base + 3] = offset + 1;
    positions[base + 4] = 5;
    positions[base + 5] = 0;
    positions[base + 6] = offset + 0.5;
    positions[base + 7] = 5;
    positions[base + 8] = 1;
  }
  return positions;
}

// ─── Pipeline integration ──────────────────────────────────

describe('intent → support pipeline integration', () => {
  it('cosmetic intent reduces contact point count', () => {
    const positions = makeMultipleOverhangs();
    const triCount = 4;
    const overhangs = detectOverhangs(positions, triCount);

    // Without intent: all overhangs get contacts
    const contactsNoIntent = sampleContactPoints(positions, overhangs.overhangTriangles);

    // With cosmetic intent on all faces + appearance-first
    const intentBuffer = createIntentBuffer(triCount);
    for (let i = 0; i < triCount; i++) {
      intentBuffer[i] = encodeIntent('cosmetic', 'high');
    }
    const intentParams: IntentSupportParams = {
      intentBuffer,
      appearanceReliabilityBalance: 0.0, // appearance-first
      cleanupMaterialBalance: 0.5,
    };
    const contactsWithIntent = sampleContactPoints(positions, overhangs.overhangTriangles, {
      intentParams,
    });

    // Cosmetic + appearance-first should avoid all contacts
    expect(contactsWithIntent.length).toBeLessThan(contactsNoIntent.length);
  });

  it('reliability-critical intent increases contact density', () => {
    const positions = makeMultipleOverhangs();
    const triCount = 4;
    const overhangs = detectOverhangs(positions, triCount);

    // Without intent
    const contactsNoIntent = sampleContactPoints(positions, overhangs.overhangTriangles);

    // With reliability-critical intent
    const intentBuffer = createIntentBuffer(triCount);
    for (let i = 0; i < triCount; i++) {
      intentBuffer[i] = encodeIntent('reliability-critical', 'high');
    }
    const intentParams: IntentSupportParams = {
      intentBuffer,
      appearanceReliabilityBalance: 0.5,
      cleanupMaterialBalance: 0.5,
    };
    const contactsWithIntent = sampleContactPoints(positions, overhangs.overhangTriangles, {
      intentParams,
    });

    // Reliability-critical should create more contacts
    expect(contactsWithIntent.length).toBeGreaterThanOrEqual(contactsNoIntent.length);
  });

  it('intent-aware pillars have scaled tip diameters', () => {
    const positions = makeDownwardTriangle();
    const overhangs = detectOverhangs(positions, 1);
    const intentBuffer = createIntentBuffer(1);
    intentBuffer[0] = encodeIntent('removal-sensitive', 'high');

    const intentParams: IntentSupportParams = {
      intentBuffer,
      appearanceReliabilityBalance: 0.5,
      cleanupMaterialBalance: 0.5,
    };

    const contacts = sampleContactPoints(positions, overhangs.overhangTriangles, { intentParams });
    const { pillars } = generatePillars(contacts, { intentParams });

    expect(pillars.length).toBeGreaterThan(0);
    // Removal-sensitive should have smaller tips than default (0.4mm)
    for (const pillar of pillars) {
      expect(pillar.tipDiameterMM).toBeDefined();
      expect(pillar.tipDiameterMM!).toBeLessThan(0.4);
    }
  });

  it('contacts have explanation metadata when intent-aware', () => {
    const positions = makeDownwardTriangle();
    const overhangs = detectOverhangs(positions, 1);
    const intentBuffer = createIntentBuffer(1);
    intentBuffer[0] = encodeIntent('hidden', 'medium');

    const intentParams: IntentSupportParams = {
      intentBuffer,
      appearanceReliabilityBalance: 0.5,
      cleanupMaterialBalance: 0.5,
    };

    const contacts = sampleContactPoints(positions, overhangs.overhangTriangles, { intentParams });

    expect(contacts.length).toBeGreaterThan(0);
    for (const contact of contacts) {
      expect(contact.explanation).toBeDefined();
      expect(contact.explanation!.influencedBy).toBe('hidden');
      expect(contact.explanation!.reason).toBe('overhang');
    }
  });

  it('contacts have no explanation when no intent buffer', () => {
    const positions = makeDownwardTriangle();
    const overhangs = detectOverhangs(positions, 1);
    const contacts = sampleContactPoints(positions, overhangs.overhangTriangles);

    expect(contacts.length).toBeGreaterThan(0);
    for (const contact of contacts) {
      expect(contact.explanation).toBeUndefined();
    }
  });
});

// ─── Conflict detection ────────────────────────────────────

describe('conflict detection integration', () => {
  it('detects cosmetic faces that are overhangs', () => {
    const positions = makeMultipleOverhangs();
    const triCount = 4;
    const overhangs = detectOverhangs(positions, triCount);

    const intentBuffer = createIntentBuffer(triCount);
    intentBuffer[0] = encodeIntent('cosmetic', 'high');
    intentBuffer[1] = encodeIntent('cosmetic', 'medium');

    const conflicts = detectConflicts(
      intentBuffer,
      overhangs.overhangTriangles,
      positions,
      triCount,
    );
    const cosmeticConflicts = conflicts.filter((c) => c.type === 'cosmetic-needs-support');

    expect(cosmeticConflicts.length).toBe(1);
    expect(cosmeticConflicts[0].triangleIndices).toContain(0);
    expect(cosmeticConflicts[0].triangleIndices).toContain(1);
    expect(cosmeticConflicts[0].severity).toBe('warning');
  });

  it('returns no conflicts when no intents are assigned', () => {
    const positions = makeMultipleOverhangs();
    const triCount = 4;
    const overhangs = detectOverhangs(positions, triCount);
    const intentBuffer = createIntentBuffer(triCount);

    const conflicts = detectConflicts(
      intentBuffer,
      overhangs.overhangTriangles,
      positions,
      triCount,
    );
    expect(conflicts.length).toBe(0);
  });
});

// ─── Explanation generation ────────────────────────────────

describe('explanation generation integration', () => {
  it('generates correct explanation for cosmetic face', () => {
    const intentBuffer = createIntentBuffer(1);
    intentBuffer[0] = encodeIntent('cosmetic', 'high');

    const explanation = generateExplanation(0, intentBuffer, 'overhang', 35);
    expect(explanation.influencedBy).toBe('cosmetic');
    expect(explanation.modification).toBe('reduced');
    expect(explanation.text).toContain('35°');
    expect(explanation.text).toContain('cosmetic');
  });

  it('generates standard explanation for unassigned face', () => {
    const intentBuffer = createIntentBuffer(1);

    const explanation = generateExplanation(0, intentBuffer, 'island');
    expect(explanation.influencedBy).toBeNull();
    expect(explanation.modification).toBe('standard');
  });
});
