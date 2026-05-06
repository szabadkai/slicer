// ─── Auto-orientation candidate generation & scoring ────────
// Pure functions — no THREE.js, no DOM.

import type { IntentBuffer } from '@features/surface-intent/types';
import { decodeIntent } from '@features/surface-intent/types';

export type Strategy = 'print-speed' | 'minimal-supports' | 'surface-quality';

export interface StrategyWeights {
  height: number;
  overhangArea: number;
  staircaseMetric: number;
  flatBottomArea: number;
  /** Penalty weight for cosmetic faces that become overhang */
  cosmeticOverhangPenalty: number;
  /** Penalty for removal-sensitive faces that become overhang */
  removalSensitivePenalty: number;
  /** Bonus for hidden faces that become overhang (negative = good) */
  hiddenOverhangBonus: number;
}

export const STRATEGY_PRESETS: Record<Strategy, StrategyWeights> = {
  'print-speed': {
    height: 0.7,
    overhangArea: 0.1,
    staircaseMetric: 0.1,
    flatBottomArea: 0.1,
    cosmeticOverhangPenalty: 0.3,
    removalSensitivePenalty: 0.2,
    hiddenOverhangBonus: 0.1,
  },
  'minimal-supports': {
    height: 0.1,
    overhangArea: 0.6,
    staircaseMetric: 0.1,
    flatBottomArea: 0.2,
    cosmeticOverhangPenalty: 0.5,
    removalSensitivePenalty: 0.4,
    hiddenOverhangBonus: 0.15,
  },
  'surface-quality': {
    height: 0.1,
    overhangArea: 0.1,
    staircaseMetric: 0.6,
    flatBottomArea: 0.2,
    cosmeticOverhangPenalty: 0.8,
    removalSensitivePenalty: 0.6,
    hiddenOverhangBonus: 0.2,
  },
};

export interface Candidate {
  /** Unit up-vector for this orientation */
  upX: number;
  upY: number;
  upZ: number;
  /** Computed scores (lower is better) */
  score: number;
  metrics: CandidateMetrics;
}

export interface CandidateMetrics {
  height: number;
  overhangArea: number;
  staircaseMetric: number;
  flatBottomArea: number;
  /** Area of cosmetic-intent faces that become overhang in this orientation */
  cosmeticOverhangArea: number;
  /** Area of removal-sensitive faces that become overhang */
  removalSensitiveOverhangArea: number;
  /** Area of hidden-intent faces that become overhang (good — supports are acceptable here) */
  hiddenOverhangArea: number;
}

/**
 * Generate the 26 standard candidate up-vectors:
 * 6 face-aligned, 12 edge-aligned, 8 corner-aligned.
 */
export function generateCandidateUpVectors(): Array<{ x: number; y: number; z: number }> {
  const candidates: Array<{ x: number; y: number; z: number }> = [];

  // Face-aligned (6)
  for (const sign of [-1, 1]) {
    candidates.push({ x: sign, y: 0, z: 0 });
    candidates.push({ x: 0, y: sign, z: 0 });
    candidates.push({ x: 0, y: 0, z: sign });
  }

  // Edge-aligned (12)
  const s = Math.SQRT1_2;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      candidates.push({ x: sx * s, y: sy * s, z: 0 });
      candidates.push({ x: sx * s, y: 0, z: sy * s });
      candidates.push({ x: 0, y: sx * s, z: sy * s });
    }
  }

  // Corner-aligned (8)
  const c = 1 / Math.sqrt(3);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        candidates.push({ x: sx * c, y: sy * c, z: sz * c });
      }
    }
  }

  return candidates;
}

/**
 * Score all 26 candidates against a mesh and strategy.
 * Mesh is represented as non-indexed Float32Array positions.
 * When an intentBuffer is provided, cosmetic faces that become overhang
 * are penalized to avoid support placement on appearance-critical surfaces.
 */
export function scoreCandidates(
  positions: Float32Array,
  triangleCount: number,
  strategy: Strategy,
  intentBuffer?: IntentBuffer,
): Candidate[] {
  const upVectors = generateCandidateUpVectors();
  const weights = STRATEGY_PRESETS[strategy];
  const candidates: Candidate[] = [];

  for (const up of upVectors) {
    const metrics = computeMetrics(positions, triangleCount, up, intentBuffer);
    const score =
      weights.height * metrics.height +
      weights.overhangArea * metrics.overhangArea +
      weights.staircaseMetric * metrics.staircaseMetric -
      weights.flatBottomArea * metrics.flatBottomArea +
      weights.cosmeticOverhangPenalty * metrics.cosmeticOverhangArea +
      weights.removalSensitivePenalty * metrics.removalSensitiveOverhangArea -
      weights.hiddenOverhangBonus * metrics.hiddenOverhangArea;

    candidates.push({ upX: up.x, upY: up.y, upZ: up.z, score, metrics });
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates;
}

// ─── Metric computation ────────────────────────────────────

function computeMetrics(
  positions: Float32Array,
  triangleCount: number,
  up: { x: number; y: number; z: number },
  intentBuffer?: IntentBuffer,
): CandidateMetrics {
  let minProj = Infinity;
  let maxProj = -Infinity;
  let overhangArea = 0;
  let flatBottomArea = 0;
  let staircaseMetric = 0;
  let cosmeticOverhangArea = 0;
  let removalSensitiveOverhangArea = 0;
  let hiddenOverhangArea = 0;

  const overhangCos = Math.cos((60 * Math.PI) / 180); // 60° from up = 30° overhang

  for (let tri = 0; tri < triangleCount; tri++) {
    const base = tri * 9;

    // Vertex projections onto up-axis
    for (let v = 0; v < 3; v++) {
      const vBase = base + v * 3;
      const proj =
        positions[vBase] * up.x + positions[vBase + 1] * up.y + positions[vBase + 2] * up.z;
      if (proj < minProj) minProj = proj;
      if (proj > maxProj) maxProj = proj;
    }

    // Face normal
    const ax = positions[base + 3] - positions[base];
    const ay = positions[base + 4] - positions[base + 1];
    const az = positions[base + 5] - positions[base + 2];
    const bx = positions[base + 6] - positions[base];
    const by = positions[base + 7] - positions[base + 1];
    const bz = positions[base + 8] - positions[base + 2];

    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nLen < 1e-12) continue;

    const normNx = nx / nLen;
    const normNy = ny / nLen;
    const normNz = nz / nLen;

    const dotUp = normNx * up.x + normNy * up.y + normNz * up.z;
    const triArea = nLen * 0.5;

    // Overhang: normal points away from up (downward)
    if (-dotUp > overhangCos) {
      overhangArea += triArea;

      // Penalize cosmetic faces that become overhang
      if (intentBuffer && tri < intentBuffer.length) {
        const decoded = decodeIntent(intentBuffer[tri]);
        if (decoded?.intent === 'cosmetic') {
          cosmeticOverhangArea += triArea;
        } else if (decoded?.intent === 'removal-sensitive') {
          removalSensitiveOverhangArea += triArea;
        } else if (decoded?.intent === 'hidden') {
          hiddenOverhangArea += triArea;
        }
      }
    }

    // Flat bottom: normal points directly opposite to up (good for adhesion)
    if (dotUp < -0.99) {
      flatBottomArea += triArea;
    }

    // Staircase: faces nearly perpendicular to up get stepped
    const absDot = Math.abs(dotUp);
    if (absDot < 0.3) {
      staircaseMetric += triArea * (1 - absDot);
    }
  }

  const height = maxProj - minProj;
  return {
    height,
    overhangArea,
    staircaseMetric,
    flatBottomArea,
    cosmeticOverhangArea,
    removalSensitiveOverhangArea,
    hiddenOverhangArea,
  };
}
