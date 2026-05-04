// ─── Convex hull, AABB, and SAT collision utilities for arrangement ──────
// Pure 2D geometry — no THREE.js dependency.

import type { Point2D } from './viewer-arrange';

export interface AABB {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  width: number;
  depth: number;
}

// ---- Convex hull (Andrew's monotone chain) --------------------------------

function cross(o: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}

export function computeConvexHull(points: Point2D[]): Point2D[] {
  if (points.length <= 2) return points.slice();
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.z - b.z);
  const n = sorted.length;
  const lower: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0
    )
      lower.pop();
    lower.push(sorted[i]);
  }
  const upper: Point2D[] = [];
  for (let i = n - 1; i >= 0; i--) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0
    )
      upper.pop();
    upper.push(sorted[i]);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// ---- Hull utilities -------------------------------------------------------

export function rotateHull(hull: Point2D[], angle: number): Point2D[] {
  if (Math.abs(angle) < 0.001) return hull;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return hull.map((p) => ({
    x: p.x * cos - p.z * sin,
    z: p.x * sin + p.z * cos,
  }));
}

export function hullAABB(hull: Point2D[]): AABB {
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (const p of hull) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, minZ, maxX, maxZ, width: maxX - minX, depth: maxZ - minZ };
}

export function hullArea(hull: Point2D[]): number {
  let area = 0;
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += hull[i].x * hull[j].z - hull[j].x * hull[i].z;
  }
  return Math.abs(area) / 2;
}

/** 12 rotation candidates at 15° steps — finds tight AABBs for hex/irregular shapes */
export const DEFAULT_ROTATION_ANGLES = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 12);

// ---- Separating Axis Theorem (SAT) for convex hull collision ---------------

function getAxes(hull: Point2D[]): Point2D[] {
  const axes: Point2D[] = [];
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length;
    const dx = hull[j].x - hull[i].x;
    const dz = hull[j].z - hull[i].z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-6) continue;
    axes.push({ x: -dz / len, z: dx / len });
  }
  return axes;
}

function projectHull(hull: Point2D[], axis: Point2D): [number, number] {
  let min = Infinity,
    max = -Infinity;
  for (const p of hull) {
    const d = p.x * axis.x + p.z * axis.z;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/** Returns true if two convex hulls are closer than `gap` mm. */
export function hullsTooClose(a: Point2D[], b: Point2D[], gap: number): boolean {
  const axes = getAxes(a).concat(getAxes(b));
  for (const axis of axes) {
    const [minA, maxA] = projectHull(a, axis);
    const [minB, maxB] = projectHull(b, axis);
    if (maxA + gap <= minB || maxB + gap <= minA) return false;
  }
  return true;
}

export function translateHull(hull: Point2D[], dx: number, dz: number): Point2D[] {
  return hull.map((p) => ({ x: p.x + dx, z: p.z + dz }));
}
