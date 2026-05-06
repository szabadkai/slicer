/**
 * Per-region exposure — variable exposure times based on surface intent.
 *
 * Maps surface intents to exposure multipliers:
 * - Cosmetic faces: slightly higher exposure for better surface finish
 * - Hidden faces: lower exposure (faster, surface quality doesn't matter)
 * - Reliability-critical: higher exposure for maximum adhesion
 * - Removal-sensitive: lower exposure for easier support removal
 *
 * During export, the exposure map modulates per-layer exposure time.
 * Printers that support per-pixel grayscale can use pixel intensity
 * as a direct exposure proxy.
 */
import { signal } from '@preact/signals-core';

/** Surface intent types (mirrored from surface-intent for encapsulation) */
type SurfaceIntent = 'cosmetic' | 'hidden' | 'reliability-critical' | 'removal-sensitive';

const ID_TO_INTENT: Record<number, SurfaceIntent> = {
  1: 'cosmetic',
  2: 'hidden',
  3: 'reliability-critical',
  4: 'removal-sensitive',
};

function decodeIntentByte(byte: number): SurfaceIntent | null {
  if (byte === 0) return null;
  return ID_TO_INTENT[byte & 0x07] ?? null;
}

export interface ExposureProfile {
  /** Multiplier for each intent (1.0 = normal exposure) */
  multipliers: Record<SurfaceIntent, number>;
  /** Whether per-region exposure is enabled */
  enabled: boolean;
}

const DEFAULT_MULTIPLIERS: Record<SurfaceIntent, number> = {
  cosmetic: 1.15,
  hidden: 0.85,
  'reliability-critical': 1.25,
  'removal-sensitive': 0.75,
};

const STORAGE_KEY = 'slicelab-exposure-profile';

function loadProfile(): ExposureProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { multipliers: { ...DEFAULT_MULTIPLIERS }, enabled: false };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'multipliers' in parsed) {
      return parsed as ExposureProfile;
    }
    return { multipliers: { ...DEFAULT_MULTIPLIERS }, enabled: false };
  } catch {
    return { multipliers: { ...DEFAULT_MULTIPLIERS }, enabled: false };
  }
}

/** Current exposure profile */
export const exposureProfile = signal<ExposureProfile>(loadProfile());

/**
 * Update the exposure profile and persist.
 */
export function setExposureProfile(profile: ExposureProfile): void {
  exposureProfile.value = { ...profile };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

/**
 * Get the exposure multiplier for a given intent.
 * Returns 1.0 if per-region exposure is disabled or intent is unassigned.
 */
export function getExposureMultiplier(intent: SurfaceIntent | null): number {
  const profile = exposureProfile.value;
  if (!profile.enabled || !intent) return 1.0;
  return profile.multipliers[intent] ?? 1.0;
}

/**
 * Compute a per-layer exposure map from intent buffers.
 *
 * For each layer, determines the dominant intent based on the
 * triangle faces intersecting that layer, then returns the
 * corresponding exposure multiplier.
 */
export function computeLayerExposureMap(
  intentBuffer: Uint8Array | null,
  layerCount: number,
  triangleCount: number,
): Float32Array {
  const map = new Float32Array(layerCount).fill(1.0);
  if (!intentBuffer || triangleCount === 0) return map;

  const profile = exposureProfile.value;
  if (!profile.enabled) return map;

  // Count intents per layer band (approximate: uniform distribution of triangles)
  const trisPerLayer = Math.ceil(triangleCount / layerCount);

  for (let layer = 0; layer < layerCount; layer++) {
    const startTri = layer * trisPerLayer;
    const endTri = Math.min(startTri + trisPerLayer, triangleCount);

    let maxMultiplier = 1.0;
    let hasIntent = false;

    for (let t = startTri; t < endTri; t++) {
      if (t >= intentBuffer.length) break;
      const intent = decodeIntentByte(intentBuffer[t]);
      if (intent) {
        const mult = profile.multipliers[intent] ?? 1.0;
        if (mult > maxMultiplier) maxMultiplier = mult;
        hasIntent = true;
      }
    }

    if (hasIntent) map[layer] = maxMultiplier;
  }

  return map;
}

/**
 * Format an exposure multiplier as a human-readable string.
 */
export function formatExposureMultiplier(mult: number): string {
  const pct = Math.round((mult - 1) * 100);
  if (pct === 0) return 'Normal';
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}
