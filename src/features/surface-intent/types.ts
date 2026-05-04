// ─── Surface intent types & encoding ────────────────────────
// Per-face intent system for intent-based support generation.

/** The four MVP surface intents */
export type SurfaceIntent = 'cosmetic' | 'hidden' | 'reliability-critical' | 'removal-sensitive';

/** Priority levels that weight how strongly an intent affects optimization */
export type IntentPriority = 'low' | 'medium' | 'high';

/** Compact per-face storage: one byte per triangle */
export type IntentBuffer = Uint8Array;

// ─── Encoding ────────────────────────────────────────────────
// Byte layout: bits 0-2 = intent id (1-4), bits 3-4 = priority (0-2)
// Value 0 = unassigned

const INTENT_IDS: Record<SurfaceIntent, number> = {
  'cosmetic': 1,
  'hidden': 2,
  'reliability-critical': 3,
  'removal-sensitive': 4,
};

const ID_TO_INTENT: Record<number, SurfaceIntent> = {
  1: 'cosmetic',
  2: 'hidden',
  3: 'reliability-critical',
  4: 'removal-sensitive',
};

const PRIORITY_IDS: Record<IntentPriority, number> = {
  'low': 0,
  'medium': 1,
  'high': 2,
};

const ID_TO_PRIORITY: Record<number, IntentPriority> = {
  0: 'low',
  1: 'medium',
  2: 'high',
};

/** Encode an intent + priority into a single byte */
export function encodeIntent(intent: SurfaceIntent, priority: IntentPriority): number {
  return (PRIORITY_IDS[priority] << 3) | INTENT_IDS[intent];
}

/** Decode a byte back into intent + priority, or null if unassigned */
export function decodeIntent(byte: number): { intent: SurfaceIntent; priority: IntentPriority } | null {
  if (byte === 0) return null;
  const intentId = byte & 0b111;
  const priorityId = (byte >> 3) & 0b11;
  const intent = ID_TO_INTENT[intentId];
  const priority = ID_TO_PRIORITY[priorityId];
  if (!intent || priority === undefined) return null;
  return { intent, priority };
}

/** Create a zeroed intent buffer for a given triangle count */
export function createIntentBuffer(triangleCount: number): IntentBuffer {
  return new Uint8Array(triangleCount);
}

/** Check if any triangle in the buffer has an intent assigned */
export function hasAnyIntent(buffer: IntentBuffer): boolean {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] !== 0) return true;
  }
  return false;
}

/** Count triangles with a specific intent */
export function countIntent(buffer: IntentBuffer, intent: SurfaceIntent): number {
  const id = INTENT_IDS[intent];
  let count = 0;
  for (let i = 0; i < buffer.length; i++) {
    if ((buffer[i] & 0b111) === id) count++;
  }
  return count;
}

/** All valid intent values */
export const ALL_INTENTS: readonly SurfaceIntent[] = [
  'cosmetic',
  'hidden',
  'reliability-critical',
  'removal-sensitive',
] as const;

/** Human-readable names for display */
export const INTENT_NAMES: Record<SurfaceIntent, string> = {
  'cosmetic': 'Cosmetic',
  'hidden': 'Hidden',
  'reliability-critical': 'Reliability-Critical',
  'removal-sensitive': 'Removal-Sensitive',
};

export const PRIORITY_NAMES: Record<IntentPriority, string> = {
  'low': 'Low',
  'medium': 'Medium',
  'high': 'High',
};

/** Color coding for intent overlay visualization (hex) */
export const INTENT_COLORS: Record<SurfaceIntent, number> = {
  'cosmetic': 0x3b82f6,            // blue
  'hidden': 0x6b7280,              // gray
  'reliability-critical': 0xef4444, // red
  'removal-sensitive': 0xf59e0b,   // amber
};
