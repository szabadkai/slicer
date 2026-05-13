/**
 * Additional support contact-point detectors: minima, stabilization, reinforcement.
 * Each returns ContactPoint[] tagged with the appropriate reason.
 */

import * as THREE from 'three';
import type { ContactPoint, RouteContext } from './supports-geometry';
import { deduplicatePoints, yieldThread } from './supports-utils';
import { convexHull2D } from './supports-base-pan';

const DOWN = new THREE.Vector3(0, -1, 0);

// ---------------------------------------------------------------------------
// Shared geometry helpers
// ---------------------------------------------------------------------------

function buildVertexAdjacency(
  pos: THREE.BufferAttribute,
  index: THREE.BufferAttribute | null,
): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>();
  const ensure = (i: number) => {
    let set = adj.get(i);
    if (!set) {
      set = new Set();
      adj.set(i, set);
    }
    return set;
  };
  const triCount = index ? index.count / 3 : pos.count / 3;
  for (let t = 0; t < triCount; t++) {
    const [a, b, c] = index
      ? [index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)]
      : [t * 3, t * 3 + 1, t * 3 + 2];
    ensure(a).add(b);
    ensure(a).add(c);
    ensure(b).add(a);
    ensure(b).add(c);
    ensure(c).add(a);
    ensure(c).add(b);
  }
  return adj;
}

// Accumulated (area-weighted) per-vertex normals as flat Float32Array [x,y,z, x,y,z, ...]
function accumulateVertexNormals(
  pos: THREE.BufferAttribute,
  index: THREE.BufferAttribute | null,
): Float32Array {
  const vertCount = pos.count;
  const out = new Float32Array(vertCount * 3);
  const triCount = index ? index.count / 3 : pos.count / 3;
  const av = new THREE.Vector3(),
    bv = new THREE.Vector3(),
    cv = new THREE.Vector3();
  const e1 = new THREE.Vector3(),
    e2 = new THREE.Vector3(),
    cross = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const [a, b, c] = index
      ? [index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)]
      : [t * 3, t * 3 + 1, t * 3 + 2];
    av.set(pos.getX(a), pos.getY(a), pos.getZ(a));
    bv.set(pos.getX(b), pos.getY(b), pos.getZ(b));
    cv.set(pos.getX(c), pos.getY(c), pos.getZ(c));
    e1.subVectors(bv, av);
    e2.subVectors(cv, av);
    cross.crossVectors(e1, e2); // magnitude = 2 * area (area-weighted normal)
    for (const i of [a, b, c]) {
      out[i * 3] += cross.x;
      out[i * 3 + 1] += cross.y;
      out[i * 3 + 2] += cross.z;
    }
  }
  // Normalize each
  for (let i = 0; i < vertCount; i++) {
    const x = out[i * 3],
      y = out[i * 3 + 1],
      z = out[i * 3 + 2];
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len > 0) {
      out[i * 3] /= len;
      out[i * 3 + 1] /= len;
      out[i * 3 + 2] /= len;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Detector 1: Minima
// ---------------------------------------------------------------------------

export interface MinimaOptions {
  minSupportHeight: number;
  normalDotThreshold?: number; // default 0.7
}

/**
 * Detect local geometric minima: vertices lower than all their direct neighbors,
 * plus downward-pointing tips (strong downward normal in a small neighborhood).
 */
export function detectMinima(
  geometry: THREE.BufferGeometry,
  options: MinimaOptions,
): ContactPoint[] {
  const { minSupportHeight, normalDotThreshold = 0.7 } = options;

  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const index = geometry.index;
  const adj = buildVertexAdjacency(pos, index);
  const vertNormals = accumulateVertexNormals(pos, index);
  const vertCount = pos.count;

  const points: ContactPoint[] = [];

  for (let v = 0; v < vertCount; v++) {
    const vy = pos.getY(v);
    // Must be above the minimum support height.
    if (vy < minSupportHeight) continue;

    const neighbors = adj.get(v);
    if (!neighbors || neighbors.size === 0) continue;

    // Local Y-minimum: no neighbor is strictly lower AND at least one neighbor
    // is strictly higher (to exclude flat regions where all vertices share the same Y).
    let hasLowerNeighbor = false;
    let hasHigherNeighbor = false;
    for (const n of neighbors) {
      const ny = pos.getY(n);
      if (ny < vy) {
        hasLowerNeighbor = true;
        break;
      }
      if (ny > vy) hasHigherNeighbor = true;
    }
    const isLocalMin = !hasLowerNeighbor && hasHigherNeighbor;

    // Downward-pointing tip: accumulated normal points strongly downward
    // and the neighborhood has a small spatial radius
    const normalY = vertNormals[v * 3 + 1];
    let isDownTip = false;
    if (normalY < -normalDotThreshold) {
      // Measure neighborhood radius
      const vx = pos.getX(v),
        vz = pos.getZ(v);
      let maxDist2 = 0;
      for (const n of neighbors) {
        const dx = pos.getX(n) - vx,
          dz = pos.getZ(n) - vz;
        maxDist2 = Math.max(maxDist2, dx * dx + dz * dz);
      }
      if (maxDist2 < 9) isDownTip = true; // neighborhood radius < 3mm
    }

    if (isLocalMin || isDownTip) {
      points.push({
        position: new THREE.Vector3(pos.getX(v), vy, pos.getZ(v)),
        normal: DOWN.clone(),
        reason: 'minima',
      });
    }
  }

  return deduplicatePoints(points, 2.0);
}

// ---------------------------------------------------------------------------
// Detector 2: Stabilization
// ---------------------------------------------------------------------------

export interface StabilizationOptions {
  density: number;
  minSupportHeight: number;
  footprintFraction?: number; // default 0.1
  aspectRatioThreshold?: number; // default 3.0
  instabilityMargin?: number; // default 0.15
}

/**
 * Detect models at risk of tipping (off-centre CoM or tall/narrow aspect ratio)
 * and place contacts at the base perimeter.
 */
export function detectStabilization(
  geometry: THREE.BufferGeometry,
  options: StabilizationOptions,
): ContactPoint[] {
  const {
    density,
    minSupportHeight,
    footprintFraction = 0.1,
    aspectRatioThreshold = 3.0,
    instabilityMargin = 0.15,
  } = options;

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return [];
  const height = bb.max.y - bb.min.y;
  if (height < 1) return []; // degenerate

  const bottomThresholdY = bb.min.y + height * footprintFraction;

  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const vertCount = pos.count;

  // Collect bottom vertices (XZ) and compute CoM XZ (all vertices)
  const bottomXZ: THREE.Vector2[] = [];
  let comX = 0,
    comZ = 0;
  for (let v = 0; v < vertCount; v++) {
    const vx = pos.getX(v),
      vy = pos.getY(v),
      vz = pos.getZ(v);
    comX += vx;
    comZ += vz;
    if (vy <= bottomThresholdY) {
      bottomXZ.push(new THREE.Vector2(vx, vz));
    }
  }
  comX /= vertCount;
  comZ /= vertCount;

  if (bottomXZ.length < 3) return [];

  const hull = convexHull2D(bottomXZ);
  if (hull.length < 3) return [];

  // Footprint diameter: max distance between hull vertices
  let footprintDiameter = 0;
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      footprintDiameter = Math.max(footprintDiameter, hull[i].distanceTo(hull[j]));
    }
  }

  // Hull area via shoelace; sign tells us winding direction
  let signedHullArea = 0;
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length;
    signedHullArea += hull[i].x * hull[j].y - hull[j].x * hull[i].y;
  }
  const hullArea = Math.abs(signedHullArea) * 0.5;
  // winding: +1 if CCW (positive signed area), -1 if CW
  const winding = signedHullArea >= 0 ? 1 : -1;

  // Signed distance from CoM to each hull edge.
  // The left-side formula gives positive when "inside" for CCW hull.
  // Multiply by winding to normalise so positive always means inside.
  const com2D = new THREE.Vector2(comX, comZ);
  let minSignedDist = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length;
    const ex = hull[j].x - hull[i].x,
      ey = hull[j].y - hull[i].y;
    const len = Math.sqrt(ex * ex + ey * ey);
    if (len < 0.001) continue;
    // 2D cross: edge × (point - edgeStart), positive = left of edge = inside for CCW
    const d = (winding * (ex * (com2D.y - hull[i].y) - ey * (com2D.x - hull[i].x))) / len;
    minSignedDist = Math.min(minSignedDist, d);
  }

  const hullSize = Math.sqrt(hullArea);
  const isUnstable = minSignedDist < instabilityMargin * hullSize;
  const isTallNarrow = footprintDiameter > 0 && height / footprintDiameter > aspectRatioThreshold;

  if (!isUnstable && !isTallNarrow) return [];

  // Place contacts at hull perimeter, subsampled by density
  const step = Math.max(1, Math.round(hull.length / Math.max(density, 1)));
  const contactY = Math.max(bottomThresholdY + 0.1, minSupportHeight);
  const points: ContactPoint[] = [];

  for (let i = 0; i < hull.length; i += step) {
    points.push({
      position: new THREE.Vector3(hull[i].x, contactY, hull[i].y),
      normal: DOWN.clone(),
      reason: 'stabilization',
    });
  }

  // For tall/narrow: also add contacts at the 4 extreme extents of the full bounding box
  if (isTallNarrow) {
    const extremes: THREE.Vector2[] = [
      new THREE.Vector2(bb.min.x, (bb.min.z + bb.max.z) / 2),
      new THREE.Vector2(bb.max.x, (bb.min.z + bb.max.z) / 2),
      new THREE.Vector2((bb.min.x + bb.max.x) / 2, bb.min.z),
      new THREE.Vector2((bb.min.x + bb.max.x) / 2, bb.max.z),
    ];
    for (const e of extremes) {
      points.push({
        position: new THREE.Vector3(e.x, contactY, e.y),
        normal: DOWN.clone(),
        reason: 'stabilization',
      });
    }
  }

  return deduplicatePoints(points, 3.0);
}

// ---------------------------------------------------------------------------
// Detector 3: Reinforcements (thin sections)
// ---------------------------------------------------------------------------

export interface ReinforcementOptions {
  thresholdMM: number;
  minSupportHeight: number;
}

/**
 * Detect thin/fragile sections by ray-casting each downward-facing triangle's
 * centroid in the opposite-normal direction. If the opposite surface is within
 * thresholdMM, the section needs reinforcement support.
 */
export async function detectReinforcements(
  geometry: THREE.BufferGeometry,
  context: RouteContext,
  options: ReinforcementOptions,
): Promise<ContactPoint[]> {
  const { thresholdMM, minSupportHeight } = options;

  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;

  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;
  // Skip hits very close to the origin (back-face of same triangle with DoubleSide material)
  raycaster.near = 0.05;

  const av = new THREE.Vector3(),
    bv = new THREE.Vector3(),
    cv = new THREE.Vector3();
  const e1 = new THREE.Vector3(),
    e2 = new THREE.Vector3(),
    cross = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();

  const points: ContactPoint[] = [];

  for (let t = 0; t < triCount; t++) {
    if (t % 5000 === 0 && t !== 0) await yieldThread();

    const [a, b, c] = index
      ? [index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)]
      : [t * 3, t * 3 + 1, t * 3 + 2];

    av.set(pos.getX(a), pos.getY(a), pos.getZ(a));
    bv.set(pos.getX(b), pos.getY(b), pos.getZ(b));
    cv.set(pos.getX(c), pos.getY(c), pos.getZ(c));
    e1.subVectors(bv, av);
    e2.subVectors(cv, av);
    cross.crossVectors(e1, e2).normalize();

    // Skip strongly upward-facing surfaces (top caps don't need support)
    const upDot = -cross.y; // dot(cross, DOWN)
    if (upDot < -0.7) continue; // normal points strongly upward → skip

    centroid.set((av.x + bv.x + cv.x) / 3, (av.y + bv.y + cv.y) / 3, (av.z + bv.z + cv.z) / 3);

    if (centroid.y < minSupportHeight) continue;

    // Ray from centroid offset slightly along face normal, cast in -normal direction
    origin.copy(centroid).addScaledVector(cross, 0.01);
    dir.copy(cross).negate();

    raycaster.set(origin, dir);
    raycaster.far = thresholdMM;
    const hits = raycaster.intersectObject(context.mesh);

    if (hits.length > 0 && hits[0].distance < thresholdMM) {
      points.push({
        position: centroid.clone(),
        normal: DOWN.clone(),
        reason: 'reinforcement',
      });
    }
  }

  return deduplicatePoints(points, thresholdMM * 0.5);
}
