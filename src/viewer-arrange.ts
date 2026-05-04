/**
 * Fast deterministic plate arrangement using Bottom-Left Fill (BLF) packing.
 *
 * Algorithm (same as most resin slicers):
 * 1. Compute 2D convex hull of each body's XZ footprint
 * 2. Sort bodies by bounding area (largest → smallest)
 * 3. For each body try candidate rotations (0°, 90°, 180°, 270°)
 * 4. Place using BLF — find the lowest-leftmost position that fits without overlap
 * 5. Enforce minimum spacing (padding) between parts
 * 6. Centre the final layout on the plate
 *
 * Bodies with `canRotate: false` (e.g. those with supports) skip rotation candidates.
 */

// ---- Public types --------------------------------------------------------

export interface Point2D {
  x: number;
  z: number;
}

export interface BodyFootprint {
  id: string;
  hull: Point2D[];
  canRotate: boolean;
  candidateAngles?: number[];
}

export interface ArrangePlacement {
  id: string;
  x: number;
  z: number;
  angle: number;
  overflow?: boolean;
}

export interface DistributePlacement extends ArrangePlacement {
  plateId: string;
}

export interface PlateLayout {
  plateId: string;
  originX: number;
  originZ: number;
}

export interface FillResult {
  countX: number;
  countZ: number;
  startX: number;
  startZ: number;
  itemW: number;
  itemD: number;
}

export interface ArrangeOptions {
  padding?: number;
}

import {
  type AABB,
  computeConvexHull,
  rotateHull,
  hullAABB,
  hullArea,
  DEFAULT_ROTATION_ANGLES,
  hullsTooClose,
  translateHull,
} from './viewer-arrange-hull';

export { computeConvexHull };

// ---- BLF placement --------------------------------------------------------

interface PlacedRect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

interface PlacedBody {
  hull: Point2D[];
  aabb: PlacedRect;
}

interface RotationVariant {
  angle: number;
  hull: Point2D[]; // rotated hull (centred)
  aabb: AABB; // AABB of the rotated hull
  width: number; // aabb.width (no padding — padding handled in SAT gap)
  depth: number; // aabb.depth
}

function prepareRotations(hull: Point2D[], angles: number[]): RotationVariant[] {
  return angles.map((angle) => {
    const rotated = rotateHull(hull, angle);
    const aabb = hullAABB(rotated);
    return { angle, hull: rotated, aabb, width: aabb.width, depth: aabb.depth };
  });
}

/**
 * Hull-aware BLF: find the lowest-leftmost position where a body's convex hull
 * fits without being closer than `gap` to any placed hull, within plate bounds.
 *
 * Tries all rotation variants at each candidate position and picks the first
 * valid placement (lowest Z, then leftmost X, then smallest AABB area).
 */
function hullBlfPlace(
  variants: RotationVariant[],
  placedBodies: PlacedBody[],
  boundsW: number,
  boundsD: number,
  gap: number,
): { x: number; z: number; angle: number; variant: RotationVariant } | null {
  // Sort variants by area (prefer tighter ones first)
  const sortedVariants = variants.slice().sort((a, b) => a.width * a.depth - b.width * b.depth);

  // For each variant, generate candidate positions derived from hull-to-hull contact
  // This is a simplified NFP approach: for each placed hull vertex and each new hull vertex,
  // compute the translation that would make them touch (with gap).
  interface Candidate {
    x: number;
    z: number;
    score: number;
  }
  const candidates: Candidate[] = [{ x: 0, z: 0, score: 0 }];

  for (const pb of placedBodies) {
    const r = pb.aabb;
    // AABB-derived candidates (coarse grid)
    candidates.push({ x: r.maxX + gap, z: r.minZ, score: r.minZ });
    candidates.push({ x: r.minX, z: r.maxZ + gap, score: r.maxZ + gap });
    candidates.push({ x: r.maxX + gap, z: r.maxZ + gap, score: r.maxZ + gap });
    candidates.push({ x: r.maxX + gap, z: 0, score: 0 });
    candidates.push({ x: 0, z: r.maxZ + gap, score: r.maxZ + gap });

    // Hull-vertex-derived candidates: for each placed hull vertex, try placing
    // the new body so its AABB min is near that vertex (with gap offset)
    for (const hv of pb.hull) {
      candidates.push({ x: hv.x + gap, z: hv.z + gap, score: hv.z + gap });
      candidates.push({ x: hv.x + gap, z: hv.z - gap, score: hv.z - gap });
      candidates.push({ x: hv.x - gap, z: hv.z + gap, score: hv.z + gap });
      // Align with hull vertex on each axis
      candidates.push({ x: hv.x + gap, z: 0, score: 0 });
      candidates.push({ x: 0, z: hv.z + gap, score: hv.z + gap });
    }
  }
  // Cross-product hull positions: hull vertex from A × hull vertex from B
  if (placedBodies.length >= 2) {
    for (let i = 0; i < placedBodies.length; i++) {
      for (let j = i + 1; j < placedBodies.length; j++) {
        for (const hi of placedBodies[i].hull) {
          for (const hj of placedBodies[j].hull) {
            candidates.push({ x: hi.x + gap, z: hj.z + gap, score: hj.z + gap });
            candidates.push({ x: hj.x + gap, z: hi.z + gap, score: hi.z + gap });
          }
        }
      }
    }
  }

  // Deduplicate (snap to 0.1mm grid)
  const seen = new Set<string>();
  const unique: Candidate[] = [];
  for (const c of candidates) {
    const key = `${Math.round(c.x * 10)},${Math.round(c.z * 10)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }
  // Sort by Z (bottom-first) then X (left-first)
  unique.sort((a, b) => a.z - b.z || a.x - b.x);

  for (const c of unique) {
    if (c.x < -0.01 || c.z < -0.01) continue;

    for (const v of sortedVariants) {
      // Anchor: the hull AABB's min corner is at the candidate position
      const dx = c.x - v.aabb.minX;
      const dz = c.z - v.aabb.minZ;
      const maxX = c.x + v.width;
      const maxZ = c.z + v.depth;

      if (maxX > boundsW + 0.01 || maxZ > boundsD + 0.01) continue;

      // Quick AABB pre-check (skip SAT if AABBs don't even intersect with gap)
      const candidateAABB: PlacedRect = { minX: c.x, minZ: c.z, maxX, maxZ };
      let aabbClear = true;
      for (const pb of placedBodies) {
        const r = pb.aabb;
        if (
          candidateAABB.minX < r.maxX + gap &&
          candidateAABB.maxX > r.minX - gap &&
          candidateAABB.minZ < r.maxZ + gap &&
          candidateAABB.maxZ > r.minZ - gap
        ) {
          aabbClear = false;
          break;
        }
      }
      if (aabbClear) {
        return { x: c.x, z: c.z, angle: v.angle, variant: v };
      }

      // Full SAT hull collision check
      const translated = translateHull(v.hull, dx, dz);
      let tooClose = false;
      for (const pb of placedBodies) {
        if (hullsTooClose(translated, pb.hull, gap)) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) {
        return { x: c.x, z: c.z, angle: v.angle, variant: v };
      }
    }
  }
  return null;
}

/** AABB-only BLF fallback (used for overflow region) */
function blfPlace(
  w: number,
  d: number,
  placed: PlacedRect[],
  bW: number,
  bD: number,
): { x: number; z: number } | null {
  const cands: Point2D[] = [{ x: 0, z: 0 }];
  for (const r of placed) {
    cands.push({ x: r.maxX, z: r.minZ }, { x: r.minX, z: r.maxZ }, { x: r.maxX, z: r.maxZ });
    cands.push({ x: r.maxX, z: 0 }, { x: 0, z: r.maxZ });
  }
  for (let i = 0; i < placed.length; i++)
    for (let j = 0; j < placed.length; j++)
      if (i !== j) cands.push({ x: placed[i].maxX, z: placed[j].maxZ });
  const seen = new Set<string>();
  const uniq = cands.filter((c) => {
    const k = `${Math.round(c.x * 100)},${Math.round(c.z * 100)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  uniq.sort((a, b) => a.z - b.z || a.x - b.x);
  for (const c of uniq) {
    if (c.x < -0.01 || c.z < -0.01) continue;
    const mx = c.x + w,
      mz = c.z + d;
    if (mx > bW + 0.01 || mz > bD + 0.01) continue;
    if (!placed.some((r) => c.x < r.maxX && mx > r.minX && c.z < r.maxZ && mz > r.minZ))
      return { x: c.x, z: c.z };
  }
  return null;
}

// ---- Main arrange function ------------------------------------------------

/**
 * Arrange bodies on a single plate using hull-aware BLF with SAT collision.
 * Tries all rotation candidates at placement time (not pre-selected).
 * Returns placements in plate-centred coordinates (0,0 = plate centre).
 */
export function arrange(
  bodies: BodyFootprint[],
  plateWidth: number,
  plateDepth: number,
  options: ArrangeOptions = {},
): ArrangePlacement[] {
  const padding = options.padding ?? 0.5;

  if (bodies.length === 0) return [];

  // Prepare rotation variants for each body
  interface PreparedBody {
    id: string;
    hull: Point2D[];
    variants: RotationVariant[];
    bestArea: number; // smallest AABB area across rotations (for sort order)
  }

  const prepared: PreparedBody[] = bodies.map((body) => {
    const angles = body.canRotate ? (body.candidateAngles ?? DEFAULT_ROTATION_ANGLES) : [0];
    const variants = prepareRotations(body.hull, angles);
    const bestArea = Math.min(...variants.map((v) => v.width * v.depth));
    return { id: body.id, hull: body.hull, variants, bestArea };
  });

  // Sort largest first (greedy heuristic)
  prepared.sort((a, b) => b.bestArea - a.bestArea);

  // Hull-aware BLF placement
  const placedBodies: PlacedBody[] = [];
  const placedIdToIndex = new Map<string, number>();
  const results: ArrangePlacement[] = [];
  const overflowBodies: PreparedBody[] = [];

  for (const body of prepared) {
    const result = hullBlfPlace(body.variants, placedBodies, plateWidth, plateDepth, padding);
    if (!result) {
      overflowBodies.push(body);
      continue;
    }

    const { x, z, angle, variant } = result;
    const dx = x - variant.aabb.minX;
    const dz = z - variant.aabb.minZ;
    const placedHull = translateHull(variant.hull, dx, dz);
    const placedAABB: PlacedRect = {
      minX: x,
      minZ: z,
      maxX: x + variant.width,
      maxZ: z + variant.depth,
    };
    placedIdToIndex.set(body.id, placedBodies.length);
    placedBodies.push({ hull: placedHull, aabb: placedAABB });

    // Convert to plate-centred coordinates
    const packCenterX = x + variant.width / 2;
    const packCenterZ = z + variant.depth / 2;

    results.push({
      id: body.id,
      x: packCenterX - plateWidth / 2,
      z: packCenterZ - plateDepth / 2,
      angle,
    });
  }

  // Second pass: place overflow bodies outside the build volume (+X side)
  if (overflowBodies.length > 0) {
    const overflowPlaced: PlacedRect[] = [];
    const overflowBoundsW = plateWidth * 4;
    const overflowBoundsD = plateDepth * 4;

    for (const body of overflowBodies) {
      // Use tightest rotation for overflow
      const best = body.variants.reduce((a, b) => (a.width * a.depth < b.width * b.depth ? a : b));
      const w = best.width + padding;
      const d = best.depth + padding;
      const pos = blfPlace(w, d, overflowPlaced, overflowBoundsW, overflowBoundsD);
      if (pos) {
        overflowPlaced.push({ minX: pos.x, minZ: pos.z, maxX: pos.x + w, maxZ: pos.z + d });
        results.push({
          id: body.id,
          x: plateWidth / 2 + padding + pos.x + w / 2,
          z: pos.z + d / 2 - plateDepth / 2,
          angle: best.angle,
          overflow: true,
        });
      } else {
        results.push({
          id: body.id,
          x: plateWidth + padding,
          z: 0,
          angle: best.angle,
          overflow: true,
        });
      }
    }
  }

  // Centre the group: shift only in-bounds placements
  const inBounds = results.filter((r) => !r.overflow);
  if (inBounds.length > 0) {
    let groupMinX = Infinity,
      groupMaxX = -Infinity;
    let groupMinZ = Infinity,
      groupMaxZ = -Infinity;
    for (const r of inBounds) {
      const idx = placedIdToIndex.get(r.id);
      if (idx === undefined) continue;
      const pa = placedBodies[idx].aabb;
      const hw = (pa.maxX - pa.minX) / 2;
      const hd = (pa.maxZ - pa.minZ) / 2;
      groupMinX = Math.min(groupMinX, r.x - hw);
      groupMaxX = Math.max(groupMaxX, r.x + hw);
      groupMinZ = Math.min(groupMinZ, r.z - hd);
      groupMaxZ = Math.max(groupMaxZ, r.z + hd);
    }
    const groupCenterX = (groupMinX + groupMaxX) / 2;
    const groupCenterZ = (groupMinZ + groupMaxZ) / 2;
    for (const r of inBounds) {
      r.x -= groupCenterX;
      r.z -= groupCenterZ;
    }
  }

  return results;
}

// ---- Legacy API aliases (consumed by viewer.ts) ---------------------------

/** @deprecated Use `arrange` directly. Kept for backward compat with viewer.ts */
export function gaArrange(
  bodies: BodyFootprint[],
  plateWidth: number,
  plateDepth: number,
  options: ArrangeOptions = {},
): ArrangePlacement[] {
  return arrange(bodies, plateWidth, plateDepth, options);
}

// ---- Distribute across multiple plates ------------------------------------

export function distributeAcrossPlates(
  bodies: BodyFootprint[],
  plates: PlateLayout[],
  plateWidth: number,
  plateDepth: number,
  options: ArrangeOptions = {},
): DistributePlacement[] {
  const padding = options.padding ?? 0.5;
  if (bodies.length === 0 || plates.length === 0) return [];

  // Prepare rotation variants and sort largest first
  const sorted = bodies.slice().sort((a, b) => hullArea(b.hull) - hullArea(a.hull));

  // Per-plate placed body lists for hull-aware BLF
  const plateBodies: PlacedBody[][] = plates.map(() => []);
  const results: DistributePlacement[] = [];
  const overflowList: { body: BodyFootprint; variants: RotationVariant[] }[] = [];

  for (const body of sorted) {
    const angles = body.canRotate ? (body.candidateAngles ?? DEFAULT_ROTATION_ANGLES) : [0];
    const variants = prepareRotations(body.hull, angles);

    let placed = false;
    for (let pi = 0; pi < plates.length; pi++) {
      const result = hullBlfPlace(variants, plateBodies[pi], plateWidth, plateDepth, padding);
      if (result) {
        const { x, z, angle, variant } = result;
        const dx = x - variant.aabb.minX;
        const dz = z - variant.aabb.minZ;
        const placedHull = translateHull(variant.hull, dx, dz);
        const placedAABB: PlacedRect = {
          minX: x,
          minZ: z,
          maxX: x + variant.width,
          maxZ: z + variant.depth,
        };
        plateBodies[pi].push({ hull: placedHull, aabb: placedAABB });

        results.push({
          id: body.id,
          plateId: plates[pi].plateId,
          x: x + variant.width / 2 - plateWidth / 2,
          z: z + variant.depth / 2 - plateDepth / 2,
          angle,
        });
        placed = true;
        break;
      }
    }

    if (!placed) {
      overflowList.push({ body, variants });
    }
  }

  // Place overflow bodies outside the last plate's build volume (+X side)
  if (overflowList.length > 0) {
    const lastPlateId = plates[plates.length - 1].plateId;
    const overflowPlaced: PlacedRect[] = [];
    const overflowBoundsW = plateWidth * 4;
    const overflowBoundsD = plateDepth * 4;

    for (const { body, variants } of overflowList) {
      const best = variants.reduce((a, b) => (a.width * a.depth < b.width * b.depth ? a : b));
      const w = best.width + padding;
      const d = best.depth + padding;
      const pos = blfPlace(w, d, overflowPlaced, overflowBoundsW, overflowBoundsD);
      if (pos) {
        overflowPlaced.push({ minX: pos.x, minZ: pos.z, maxX: pos.x + w, maxZ: pos.z + d });
        results.push({
          id: body.id,
          plateId: lastPlateId,
          x: plateWidth / 2 + padding + pos.x + w / 2,
          z: pos.z + d / 2 - plateDepth / 2,
          angle: best.angle,
          overflow: true,
        });
      } else {
        results.push({
          id: body.id,
          plateId: lastPlateId,
          x: plateWidth + padding,
          z: 0,
          angle: 0,
          overflow: true,
        });
      }
    }
  }

  return results;
}

// ---- Fill platform --------------------------------------------------------

export function computeFillLayout(
  itemW: number,
  itemD: number,
  plateW: number,
  plateD: number,
  padding = 5,
): FillResult | null {
  const gapW = itemW + padding;
  const gapD = itemD + padding;
  const countX = Math.max(1, Math.floor((plateW - padding) / gapW));
  const countZ = Math.max(1, Math.floor((plateD - padding) / gapD));
  if (countX <= 0 || countZ <= 0) return null;
  const totalW = countX * gapW - padding;
  const totalD = countZ * gapD - padding;
  const startX = -totalW / 2 + itemW / 2;
  const startZ = -totalD / 2 + itemD / 2;
  return { countX, countZ, startX, startZ, itemW: gapW, itemD: gapD };
}
