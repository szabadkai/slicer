// ─── Surface intent reactive store ──────────────────────────
// Per-model intent buffers and active brush state via Preact signals.

import { signal } from '@preact/signals-core';
import {
  type SurfaceIntent,
  type IntentPriority,
  type IntentBuffer,
  encodeIntent,
  createIntentBuffer,
} from './types';

// ─── Per-model intent storage ────────────────────────────────

export const intentsByModel = signal<Map<string, IntentBuffer>>(new Map());

/** Ensure a buffer exists for a model, creating one if needed */
export function ensureIntentBuffer(modelId: string, triangleCount: number): IntentBuffer {
  const existing = intentsByModel.value.get(modelId);
  if (existing && existing.length === triangleCount) return existing;

  const buffer = createIntentBuffer(triangleCount);
  // If there was a previous buffer with a different size, copy what fits
  if (existing) {
    const copyLen = Math.min(existing.length, buffer.length);
    buffer.set(existing.subarray(0, copyLen));
  }
  const next = new Map(intentsByModel.value);
  next.set(modelId, buffer);
  intentsByModel.value = next;
  return buffer;
}

/** Assign an intent + priority to a set of triangle indices */
export function setFaceIntents(
  modelId: string,
  triangleIndices: number[],
  intent: SurfaceIntent,
  priority: IntentPriority,
): void {
  const buffer = intentsByModel.value.get(modelId);
  if (!buffer) return;

  const encoded = encodeIntent(intent, priority);
  // Mutate buffer in place, then trigger signal update via new Map reference
  for (const idx of triangleIndices) {
    if (idx >= 0 && idx < buffer.length) {
      buffer[idx] = encoded;
    }
  }
  // New Map reference triggers reactive updates
  intentsByModel.value = new Map(intentsByModel.value);
}

/** Clear all intents for a model */
export function clearIntents(modelId: string): void {
  const buffer = intentsByModel.value.get(modelId);
  if (!buffer) return;
  buffer.fill(0);
  intentsByModel.value = new Map(intentsByModel.value);
}

/** Remove a model's intent buffer entirely */
export function removeIntentBuffer(modelId: string): void {
  const next = new Map(intentsByModel.value);
  next.delete(modelId);
  intentsByModel.value = next;
}

/** Get the intent buffer for a model (or undefined) */
export function getIntentBuffer(modelId: string): IntentBuffer | undefined {
  return intentsByModel.value.get(modelId);
}

// ─── Active brush state ──────────────────────────────────────

export const activeIntentBrush = signal<{
  intent: SurfaceIntent;
  priority: IntentPriority;
}>({
  intent: 'cosmetic',
  priority: 'medium',
});

// ─── Tradeoff sliders ────────────────────────────────────────

/** 0.0 = maximize appearance, 1.0 = maximize reliability */
export const appearanceReliabilityBalance = signal(0.5);

/** 0.0 = fast cleanup, 1.0 = minimal material */
export const cleanupMaterialBalance = signal(0.5);
