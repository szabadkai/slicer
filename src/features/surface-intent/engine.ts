// ─── Intent engine — pure scoring & decision functions ──────
// No DOM, no THREE.js. Operates on typed arrays and plain objects.

import { type IntentBuffer, type SurfaceIntent, type IntentPriority, decodeIntent } from './types';
import type { SupportExplanation, IntentConflict } from './engine-types';

// ─── Density multiplier ──────────────────────────────────────
// Returns a scale factor applied to support density for a given face.

const DENSITY_BASE: Record<SurfaceIntent, { low: number; medium: number; high: number }> = {
  cosmetic: { low: 0.6, medium: 0.35, high: 0.15 },
  hidden: { low: 1.1, medium: 1.3, high: 1.5 },
  'reliability-critical': { low: 1.3, medium: 1.8, high: 2.5 },
  'removal-sensitive': { low: 0.9, medium: 0.85, high: 0.8 },
};

/**
 * Compute how much to scale support density for a face with a given intent.
 * The `appearanceBalance` slider interpolates: 0 = favor appearance, 1 = favor reliability.
 * At balance=1, even cosmetic faces get near-normal density.
 */
export function computeIntentDensityMultiplier(
  intent: SurfaceIntent,
  priority: IntentPriority,
  appearanceBalance: number,
): number {
  const base = DENSITY_BASE[intent][priority];
  // Blend toward 1.0 (neutral) as balance moves toward the "opposite" direction
  if (intent === 'cosmetic' || intent === 'removal-sensitive') {
    // These reduce density; at high reliability balance, reduce the reduction
    return base + (1.0 - base) * appearanceBalance;
  }
  // reliability-critical / hidden increase density; at low balance, reduce the increase
  return 1.0 + (base - 1.0) * (0.3 + 0.7 * appearanceBalance);
}

// ─── Tip size scaling ────────────────────────────────────────

const TIP_SCALE: Record<SurfaceIntent, { low: number; medium: number; high: number }> = {
  cosmetic: { low: 0.85, medium: 0.7, high: 0.6 },
  hidden: { low: 1.0, medium: 1.0, high: 1.0 },
  'reliability-critical': { low: 1.1, medium: 1.3, high: 1.5 },
  'removal-sensitive': { low: 0.8, medium: 0.65, high: 0.5 },
};

/**
 * Compute how much to scale tip diameter for a face.
 * `cleanupBalance`: 0 = fast cleanup (smaller tips), 1 = minimal material (also smaller).
 * Reliability overrides both directions.
 */
export function computeIntentTipScale(
  intent: SurfaceIntent,
  priority: IntentPriority,
  cleanupBalance: number,
): number {
  const base = TIP_SCALE[intent][priority];
  if (intent === 'removal-sensitive' || intent === 'cosmetic') {
    // Fast cleanup (low balance) pushes tips even smaller
    return base * (1.0 - 0.15 * (1.0 - cleanupBalance));
  }
  if (intent === 'reliability-critical') {
    // Always enhanced, slightly modulated by cleanup preference
    return base * (0.9 + 0.1 * cleanupBalance);
  }
  return base;
}

// ─── Contact avoidance ───────────────────────────────────────

/**
 * Should the support generator avoid placing contact points on this face?
 * Returns true if the face should be skipped (unless physically required).
 */
export function shouldAvoidContact(
  intent: SurfaceIntent,
  priority: IntentPriority,
  appearanceBalance: number,
): boolean {
  if (intent === 'cosmetic') {
    // At high reliability balance, don't avoid even cosmetic faces
    if (priority === 'high') return appearanceBalance < 0.7;
    if (priority === 'medium') return appearanceBalance < 0.5;
    return appearanceBalance < 0.3;
  }
  return false;
}

/**
 * Is this face a preferred zone for support contacts?
 * Hidden faces are always preferred as support zones.
 */
export function preferContactZone(intent: SurfaceIntent): boolean {
  return intent === 'hidden';
}

// ─── Explanation generation ──────────────────────────────────

/**
 * Generate a human-readable explanation for why a support exists and how
 * intent influenced its parameters.
 */
export function generateExplanation(
  triangleIndex: number,
  intentBuffer: IntentBuffer,
  reason: SupportExplanation['reason'],
  overhangAngle?: number,
): SupportExplanation {
  const decoded =
    triangleIndex < intentBuffer.length ? decodeIntent(intentBuffer[triangleIndex]) : null;

  if (!decoded) {
    const reasonText = REASON_TEXTS[reason];
    return {
      reason,
      influencedBy: null,
      priority: null,
      text: `${reasonText}.`,
      modification: 'standard',
    };
  }

  const { intent, priority } = decoded;
  const reasonText = REASON_TEXTS[reason];
  const intentLabel = INTENT_LABELS[intent];
  const priorityLabel = priority.charAt(0).toUpperCase() + priority.slice(1);

  let modification: SupportExplanation['modification'] = 'standard';
  let modText = '';

  if (intent === 'cosmetic') {
    modification = 'reduced';
    modText = `Tip and density reduced — ${intentLabel} surface (${priorityLabel}).`;
  } else if (intent === 'hidden') {
    modification = 'standard';
    modText = `Preferred contact zone — ${intentLabel} surface.`;
  } else if (intent === 'reliability-critical') {
    modification = 'enhanced';
    modText = `Density and tip enhanced — ${intentLabel} (${priorityLabel}).`;
  } else if (intent === 'removal-sensitive') {
    modification = 'reduced';
    modText = `Thin tips for easy removal — ${intentLabel} (${priorityLabel}).`;
  }

  const angleText = overhangAngle !== undefined ? ` (${overhangAngle.toFixed(0)}° overhang)` : '';

  return {
    reason,
    influencedBy: intent,
    priority,
    text: `${reasonText}${angleText}. ${modText}`,
    modification,
  };
}

const REASON_TEXTS: Record<SupportExplanation['reason'], string> = {
  overhang: 'Placed due to overhang angle',
  island: 'Required to prevent unsupported island',
  'suction-risk': 'Added to mitigate suction/cupping risk',
  'trap-prevention': 'Placed to assist resin drainage',
  structural: 'Added for structural reinforcement',
};

const INTENT_LABELS: Record<SurfaceIntent, string> = {
  cosmetic: 'cosmetic',
  hidden: 'hidden',
  'reliability-critical': 'reliability-critical',
  'removal-sensitive': 'removal-sensitive',
};

// ─── Conflict detection ──────────────────────────────────────

/**
 * Detect conflicts between surface intents and physical support requirements.
 * Call after overhang detection but before support generation.
 */
export function detectConflicts(
  intentBuffer: IntentBuffer,
  overhangTriangles: number[],
  positions: Float32Array,
  triangleCount: number,
): IntentConflict[] {
  const conflicts: IntentConflict[] = [];

  // 1. Cosmetic faces that need support
  const cosmeticOverhangs: number[] = [];
  for (const tri of overhangTriangles) {
    if (tri >= intentBuffer.length) continue;
    const decoded = decodeIntent(intentBuffer[tri]);
    if (decoded?.intent === 'cosmetic') {
      cosmeticOverhangs.push(tri);
    }
  }
  if (cosmeticOverhangs.length > 0) {
    conflicts.push({
      triangleIndices: cosmeticOverhangs,
      type: 'cosmetic-needs-support',
      severity: 'warning',
      description: `${cosmeticOverhangs.length} cosmetic face(s) are overhang and may need supports.`,
      suggestion:
        'Consider reorienting the model, marking as hidden, or increasing the reliability slider.',
    });
  }

  // 2. Adjacent cosmetic + reliability-critical overlap
  // Check for triangles that share edges but have contradictory intents
  const reliabilityTris: number[] = [];
  const cosmeticTris: number[] = [];
  for (let i = 0; i < Math.min(intentBuffer.length, triangleCount); i++) {
    const decoded = decodeIntent(intentBuffer[i]);
    if (!decoded) continue;
    if (decoded.intent === 'reliability-critical') reliabilityTris.push(i);
    if (decoded.intent === 'cosmetic') cosmeticTris.push(i);
  }

  if (reliabilityTris.length > 0 && cosmeticTris.length > 0) {
    // Simple proximity check: find cosmetic & reliability triangles that share centroid proximity
    const overlapTris = _findProximateConflicts(
      positions,
      cosmeticTris,
      reliabilityTris,
      triangleCount,
    );
    if (overlapTris.length > 0) {
      conflicts.push({
        triangleIndices: overlapTris,
        type: 'cosmetic-reliability-overlap',
        severity: 'warning',
        description: `${overlapTris.length} face(s) are near both cosmetic and reliability-critical zones.`,
        suggestion:
          'Review intent boundaries — adjacent cosmetic and reliability zones may conflict.',
      });
    }
  }

  // 3. Removal-sensitive faces that are islands (overhang but disconnected from plate)
  const removalSensitiveIslands: number[] = [];
  for (const tri of overhangTriangles) {
    if (tri >= intentBuffer.length) continue;
    const decoded = decodeIntent(intentBuffer[tri]);
    if (decoded?.intent === 'removal-sensitive') {
      removalSensitiveIslands.push(tri);
    }
  }
  if (removalSensitiveIslands.length > 0) {
    conflicts.push({
      triangleIndices: removalSensitiveIslands,
      type: 'removal-sensitive-island',
      severity: 'error',
      description: `${removalSensitiveIslands.length} removal-sensitive face(s) are overhang and will require supports that may damage the surface.`,
      suggestion:
        'Reorient the model so removal-sensitive faces are self-supporting, or reduce intent priority.',
    });
  }

  return conflicts;
}

/**
 * Find triangles from setA and setB whose centroids are within a threshold distance.
 * Returns the union of conflicting indices.
 */
function _findProximateConflicts(
  positions: Float32Array,
  setA: number[],
  setB: number[],
  _triangleCount: number,
  thresholdMM: number = 2.0,
): number[] {
  if (setA.length === 0 || setB.length === 0) return [];

  const getCentroid = (tri: number): [number, number, number] => {
    const b = tri * 9;
    return [
      (positions[b] + positions[b + 3] + positions[b + 6]) / 3,
      (positions[b + 1] + positions[b + 4] + positions[b + 7]) / 3,
      (positions[b + 2] + positions[b + 5] + positions[b + 8]) / 3,
    ];
  };

  const thresh2 = thresholdMM * thresholdMM;
  const result = new Set<number>();

  // For small sets, brute force is fine. For large sets, spatial hashing could be added.
  for (const a of setA) {
    const [ax, ay, az] = getCentroid(a);
    for (const bTri of setB) {
      const [bx, by, bz] = getCentroid(bTri);
      const d2 = (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2;
      if (d2 < thresh2) {
        result.add(a);
        result.add(bTri);
      }
    }
  }

  return Array.from(result);
}
