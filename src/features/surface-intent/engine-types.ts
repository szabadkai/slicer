// ─── Intent engine types ────────────────────────────────────
// Shared types for intent-aware support generation and orientation.
// No DOM, no THREE.js dependencies — pure data contracts.

import type { SurfaceIntent, IntentPriority, IntentBuffer } from './types';

/** Parameters passed to the support generation pipeline for intent-awareness */
export interface IntentSupportParams {
  /** Per-triangle intent buffer */
  intentBuffer: IntentBuffer;
  /** 0.0 = maximize appearance, 1.0 = maximize reliability */
  appearanceReliabilityBalance: number;
  /** 0.0 = fast cleanup, 1.0 = minimal material */
  cleanupMaterialBalance: number;
}

/** Explanation attached to a generated support pillar */
export interface SupportExplanation {
  /** Why this support exists */
  reason: 'overhang' | 'island' | 'suction-risk' | 'trap-prevention' | 'structural';
  /** What intent influenced this support's parameters */
  influencedBy: SurfaceIntent | null;
  /** Priority of the influencing intent */
  priority: IntentPriority | null;
  /** Human-readable explanation */
  text: string;
  /** Whether the support was modified due to intent */
  modification: 'enhanced' | 'reduced' | 'standard' | 'avoided';
}

/** A detected conflict between intents and physical requirements */
export interface IntentConflict {
  /** Affected triangle indices */
  triangleIndices: number[];
  /** Conflict category */
  type:
    | 'cosmetic-needs-support'
    | 'cosmetic-reliability-overlap'
    | 'removal-sensitive-island';
  /** How serious the conflict is */
  severity: 'warning' | 'error';
  /** Human-readable description */
  description: string;
  /** Suggested resolution */
  suggestion: string;
}
