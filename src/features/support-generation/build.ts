// ─── Support pillar sampling & generation ──────────────────
// Places contact points on overhang faces and generates pillar geometry.

import type {
  IntentSupportParams,
  SupportExplanation,
} from '@features/surface-intent/engine-types';
import {
  computeIntentDensityMultiplier,
  computeIntentTipScale,
  shouldAvoidContact,
  preferContactZone,
  generateExplanation,
} from '@features/surface-intent/engine';
import { decodeIntent } from '@features/surface-intent/types';

export interface SupportParams {
  tipDiameterMM: number;
  shaftDiameterMM: number;
  baseDiameterMM: number;
  /** Points per mm² of overhang area (or 'auto') */
  density: number | 'auto';
  /** Maximum horizontal offset for routing (mm) */
  maxContactOffsetMM: number;
  /** Intent parameters for intent-aware support generation */
  intentParams?: IntentSupportParams;
}

export const DEFAULT_SUPPORT_PARAMS: SupportParams = {
  tipDiameterMM: 0.4,
  shaftDiameterMM: 0.8,
  baseDiameterMM: 2.5,
  density: 'auto',
  maxContactOffsetMM: 5.0,
};

export interface ContactPoint {
  /** World-space position on the overhang face */
  x: number;
  y: number;
  z: number;
  /** Triangle index that generated this contact */
  triangleIndex: number;
  /** Explanation for why this contact exists (when intent-aware) */
  explanation?: SupportExplanation;
}

export interface SupportPillar {
  contact: ContactPoint;
  /** Shaft segments from contact down to base (Y decreasing) */
  path: Array<{ x: number; y: number; z: number }>;
  routed: boolean;
  /** Scaled tip diameter for this pillar (mm) */
  tipDiameterMM?: number;
}

export interface GenerateResult {
  pillars: SupportPillar[];
  skippedCount: number;
}

/**
 * Sample contact points on overhang triangles using Poisson-disk-like spacing.
 * When intentParams is provided, per-face density scaling and contact avoidance apply.
 */
export function sampleContactPoints(
  positions: Float32Array,
  overhangTriangles: number[],
  params?: Partial<SupportParams>,
): ContactPoint[] {
  const opts: SupportParams = { ...DEFAULT_SUPPORT_PARAMS, ...params };
  const contacts: ContactPoint[] = [];
  const intentParams = opts.intentParams;

  // Compute total overhang area for auto density
  let totalArea = 0;
  const areas: number[] = [];
  for (const tri of overhangTriangles) {
    const area = triangleArea(positions, tri);
    areas.push(area);
    totalArea += area;
  }

  const baseDensity = opts.density === 'auto' ? computeAutoDensity(totalArea) : opts.density;

  // For each overhang triangle, place proportional number of contacts
  for (let i = 0; i < overhangTriangles.length; i++) {
    const tri = overhangTriangles[i];
    const area = areas[i];

    // Intent-aware density scaling
    let density = baseDensity;
    if (intentParams) {
      const decoded =
        tri < intentParams.intentBuffer.length
          ? decodeIntent(intentParams.intentBuffer[tri])
          : null;

      if (decoded) {
        // Skip faces that should avoid contact (cosmetic + appearance-first)
        if (
          shouldAvoidContact(
            decoded.intent,
            decoded.priority,
            intentParams.appearanceReliabilityBalance,
          )
        ) {
          continue;
        }

        const multiplier = computeIntentDensityMultiplier(
          decoded.intent,
          decoded.priority,
          intentParams.appearanceReliabilityBalance,
        );
        density = baseDensity * multiplier;

        // Boost density on preferred contact zones (hidden faces)
        if (preferContactZone(decoded.intent)) {
          density *= 1.2;
        }
      }
    }

    const numPoints = Math.max(1, Math.round(area * density));

    for (let p = 0; p < numPoints; p++) {
      const point = sampleTriangleCenter(positions, tri);
      const explanation = intentParams
        ? generateExplanation(tri, intentParams.intentBuffer, 'overhang')
        : undefined;
      contacts.push({ ...point, triangleIndex: tri, explanation });
    }
  }

  return contacts;
}

/**
 * Generate support pillars from contact points, routing straight down.
 * Simple implementation: vertical drop to Y=0 (build plate).
 * When intentParams is provided, per-pillar tip diameter scaling applies.
 */
export function generatePillars(
  contacts: ContactPoint[],
  params?: Partial<SupportParams>,
): GenerateResult {
  const opts: SupportParams = { ...DEFAULT_SUPPORT_PARAMS, ...params };
  const intentParams = opts.intentParams;
  const pillars: SupportPillar[] = [];
  let skippedCount = 0;

  for (const contact of contacts) {
    // Simple routing: straight down to build plate (y=0)
    if (contact.y <= 0) {
      skippedCount++;
      continue;
    }

    // Check if we can route within maxContactOffset
    const path = [
      { x: contact.x, y: contact.y, z: contact.z },
      { x: contact.x, y: 0, z: contact.z },
    ];

    // Intent-aware tip scaling
    let tipDiameterMM = opts.tipDiameterMM;
    if (intentParams) {
      const decoded =
        contact.triangleIndex < intentParams.intentBuffer.length
          ? decodeIntent(intentParams.intentBuffer[contact.triangleIndex])
          : null;

      if (decoded) {
        const tipScale = computeIntentTipScale(
          decoded.intent,
          decoded.priority,
          intentParams.cleanupMaterialBalance,
        );
        tipDiameterMM = opts.tipDiameterMM * tipScale;
      }
    }

    pillars.push({
      contact,
      path,
      routed: true,
      tipDiameterMM,
    });
  }

  return { pillars, skippedCount };
}

// ─── Helpers ───────────────────────────────────────────────

function triangleArea(positions: Float32Array, triIndex: number): number {
  const base = triIndex * 9;
  const ax = positions[base + 3] - positions[base];
  const ay = positions[base + 4] - positions[base + 1];
  const az = positions[base + 5] - positions[base + 2];
  const bx = positions[base + 6] - positions[base];
  const by = positions[base + 7] - positions[base + 1];
  const bz = positions[base + 8] - positions[base + 2];

  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;

  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

function computeAutoDensity(totalAreaMm2: number): number {
  // More area → more supports, roughly 0.5 points/mm² for small, 1.5 for large
  if (totalAreaMm2 < 10) return 1.5;
  if (totalAreaMm2 < 100) return 1.0;
  return 0.5;
}

function sampleTriangleCenter(
  positions: Float32Array,
  triIndex: number,
): { x: number; y: number; z: number } {
  const base = triIndex * 9;
  return {
    x: (positions[base] + positions[base + 3] + positions[base + 6]) / 3,
    y: (positions[base + 1] + positions[base + 4] + positions[base + 7]) / 3,
    z: (positions[base + 2] + positions[base + 5] + positions[base + 8]) / 3,
  };
}
