/**
 * Dimensional compensation — XY/Z shrinkage correction for resin printing.
 *
 * Resin prints shrink during UV curing. Compensation pre-scales the slice
 * images and layer heights so the final cured part matches intended dimensions.
 *
 * Factors are stored per-profile and applied during export.
 */
import { signal } from '@preact/signals-core';

export interface CompensationFactors {
  /** XY scale factor — 1.0 = no compensation, 1.005 = +0.5% expansion */
  xyFactor: number;
  /** Z scale factor — 1.0 = no compensation, 1.002 = +0.2% expansion */
  zFactor: number;
}

const STORAGE_KEY = 'slicelab-compensation';

function loadFactors(): CompensationFactors {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { xyFactor: 1.0, zFactor: 1.0 };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'xyFactor' in parsed) {
      return parsed as CompensationFactors;
    }
    return { xyFactor: 1.0, zFactor: 1.0 };
  } catch {
    return { xyFactor: 1.0, zFactor: 1.0 };
  }
}

/** Current compensation factors */
export const compensationFactors = signal<CompensationFactors>(loadFactors());

/**
 * Update compensation factors and persist.
 */
export function setCompensation(factors: CompensationFactors): void {
  compensationFactors.value = { ...factors };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(factors));
}

/**
 * Apply XY compensation to a slice image pixel coordinate.
 * Scales from center of the image outward.
 */
export function compensateXY(
  pixelX: number,
  pixelY: number,
  resX: number,
  resY: number,
  factor: number,
): { x: number; y: number } {
  const cx = resX / 2;
  const cy = resY / 2;
  return {
    x: cx + (pixelX - cx) * factor,
    y: cy + (pixelY - cy) * factor,
  };
}

/**
 * Apply Z compensation to a layer height.
 */
export function compensateZ(layerHeightMM: number, factor: number): number {
  return layerHeightMM * factor;
}

/**
 * Get compensated slice settings for export.
 */
export function getCompensatedSettings(settings: { layerHeight: number; [key: string]: unknown }): {
  layerHeight: number;
  [key: string]: unknown;
} {
  const factors = compensationFactors.value;
  return {
    ...settings,
    layerHeight: compensateZ(settings.layerHeight, factors.zFactor),
    xyCompensation: factors.xyFactor,
    zCompensation: factors.zFactor,
  };
}

/**
 * Format compensation as percentage string.
 */
export function formatCompensation(factor: number): string {
  const pct = (factor - 1) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}
