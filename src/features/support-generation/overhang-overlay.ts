// ─── Overhang overlay visualization ─────────────────────────
// Builds a color-coded mesh overlay highlighting unsupported overhang faces.
// Red = unsupported, green = covered by a support contact. Follows the same
// pattern as intent-overlay.ts (vertex colors, normal offset, semi-transparent).

import { detectOverhangs, type OverhangParams } from './detect';

const OVERLAY_OFFSET = 0.05; // mm — prevent z-fighting

const UNSUPPORTED_R = 0.94;
const UNSUPPORTED_G = 0.27;
const UNSUPPORTED_B = 0.27;

const SUPPORTED_R = 0.2;
const SUPPORTED_G = 0.78;
const SUPPORTED_B = 0.35;

export interface SupportContact {
  x: number;
  y: number;
  z: number;
}

export interface OverhangOverlayResult {
  /** Flat Float32Array of vertex positions (3 per vertex, 9 per triangle) */
  positions: Float32Array;
  /** Flat Float32Array of vertex colors (3 per vertex, 9 per triangle) */
  colors: Float32Array;
  /** Number of unsupported overhang triangles */
  unsupportedCount: number;
  /** Total number of overhang triangles */
  totalOverhangCount: number;
}

/**
 * Build vertex-colored overlay data for overhang triangles.
 * Triangles within `coverageRadius` of a support contact are green; others red.
 *
 * @param positions Non-indexed triangle positions (Float32Array, 9 floats per tri)
 * @param triangleCount Total triangle count in the model
 * @param supportContacts Existing support contact points (world-space)
 * @param overhangParams Overhang detection parameters
 * @param coverageRadius Distance within which a contact "covers" a triangle (mm)
 */
export function buildOverhangOverlayData(
  positions: Float32Array,
  triangleCount: number,
  supportContacts: SupportContact[],
  overhangParams?: Partial<OverhangParams>,
  coverageRadius = 3.0,
): OverhangOverlayResult | null {
  const { overhangTriangles, count } = detectOverhangs(positions, triangleCount, overhangParams);
  if (count === 0) return null;

  const coverageRadiusSq = coverageRadius * coverageRadius;

  const outPositions: number[] = [];
  const outColors: number[] = [];
  let unsupportedCount = 0;

  for (const tri of overhangTriangles) {
    const base = tri * 9;

    // Triangle centroid
    const cx = (positions[base] + positions[base + 3] + positions[base + 6]) / 3;
    const cy = (positions[base + 1] + positions[base + 4] + positions[base + 7]) / 3;
    const cz = (positions[base + 2] + positions[base + 5] + positions[base + 8]) / 3;

    // Check if any support contact covers this triangle
    let covered = false;
    for (const contact of supportContacts) {
      const dx = contact.x - cx;
      const dy = contact.y - cy;
      const dz = contact.z - cz;
      if (dx * dx + dy * dy + dz * dz <= coverageRadiusSq) {
        covered = true;
        break;
      }
    }

    if (!covered) unsupportedCount++;

    const r = covered ? SUPPORTED_R : UNSUPPORTED_R;
    const g = covered ? SUPPORTED_G : UNSUPPORTED_G;
    const b = covered ? SUPPORTED_B : UNSUPPORTED_B;

    // Compute face normal for offset
    const ax = positions[base + 3] - positions[base];
    const ay = positions[base + 4] - positions[base + 1];
    const az = positions[base + 5] - positions[base + 2];
    const bx = positions[base + 6] - positions[base];
    const by = positions[base + 7] - positions[base + 1];
    const bz = positions[base + 8] - positions[base + 2];

    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-12) continue;

    const ox = (nx / len) * OVERLAY_OFFSET;
    const oy = (ny / len) * OVERLAY_OFFSET;
    const oz = (nz / len) * OVERLAY_OFFSET;

    // 3 vertices per triangle
    for (let v = 0; v < 3; v++) {
      const vi = base + v * 3;
      outPositions.push(positions[vi] + ox, positions[vi + 1] + oy, positions[vi + 2] + oz);
      outColors.push(r, g, b);
    }
  }

  if (outPositions.length === 0) return null;

  return {
    positions: new Float32Array(outPositions),
    colors: new Float32Array(outColors),
    unsupportedCount,
    totalOverhangCount: count,
  };
}
