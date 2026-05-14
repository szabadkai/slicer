/**
 * Base-pan geometry — a flat disc with a raised lip beneath the supports.
 * Extracted from supports-geometry.ts to keep that file under 600 LOC.
 */

import * as THREE from 'three';
import type { RouteWaypoint } from './supports-geometry';

export function createBasePanGeometry(
  modelBounds: THREE.Box3,
  routes: RouteWaypoint[][],
  margin: number,
  thickness: number,
  lipWidth: number,
  lipHeight: number,
): THREE.BufferGeometry {
  const safeMargin = Number.isFinite(margin) ? Math.max(0, margin) : 4;
  const safeThickness = Number.isFinite(thickness) ? Math.max(0.2, thickness) : 0.8;
  const safeLipWidth = Number.isFinite(lipWidth) ? Math.max(0, lipWidth) : 1.2;
  const safeLipHeight = Number.isFinite(lipHeight) ? Math.max(0, lipHeight) : 1;
  const basePoints: THREE.Vector2[] = [];
  for (const route of routes) {
    const base = route[route.length - 1];
    if (!base || base.internalResting) continue;
    basePoints.push(new THREE.Vector2(base.x, base.z));
  }
  if (basePoints.length < 3) {
    basePoints.push(
      new THREE.Vector2(modelBounds.min.x, modelBounds.min.z),
      new THREE.Vector2(modelBounds.max.x, modelBounds.min.z),
      new THREE.Vector2(modelBounds.max.x, modelBounds.max.z),
      new THREE.Vector2(modelBounds.min.x, modelBounds.max.z),
    );
  }
  const outlineSamples: THREE.Vector2[] = [];
  const sampleRadius = Math.max(safeMargin, safeLipWidth * 1.2, 0.5);
  for (const point of basePoints) {
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      outlineSamples.push(
        new THREE.Vector2(
          point.x + Math.cos(angle) * sampleRadius,
          point.y + Math.sin(angle) * sampleRadius,
        ),
      );
    }
  }
  const convex = convexHull2D(outlineSamples);
  if (convex.length < 3) return new THREE.BufferGeometry();

  // Dent the convex hull inward wherever it's far from any support base,
  // so the pan follows the support footprint (e.g. horseshoe shape).
  const outline = dentConvexHull(convex, basePoints, sampleRadius);

  const center = new THREE.Vector3();
  modelBounds.getCenter(center);
  const innerOutline = outline.map((p) => {
    const radial = new THREE.Vector2(p.x - center.x, p.y - center.z);
    radial.normalize();
    return new THREE.Vector2(p.x - radial.x * safeLipWidth, p.y - radial.y * safeLipWidth);
  });

  const topY = safeThickness + safeLipHeight;
  const vertices: number[] = [];
  const indices: number[] = [];
  const n = outline.length;

  // Layer 0: outer outline at Y=0 (bottom of pan)
  for (let i = 0; i < n; i++) vertices.push(outline[i].x, 0, outline[i].y);
  // Layer 1: outer outline at Y=safeThickness (top of base slab / base of lip)
  for (let i = 0; i < n; i++) vertices.push(outline[i].x, safeThickness, outline[i].y);
  // Layer 2: inner outline at Y=safeThickness (floor level, inside lip)
  for (let i = 0; i < n; i++) vertices.push(innerOutline[i].x, safeThickness, innerOutline[i].y);
  // Layer 3: outer outline at Y=topY (top of lip outer edge)
  for (let i = 0; i < n; i++) vertices.push(outline[i].x, topY, outline[i].y);
  // Layer 4: inner outline at Y=topY (top of lip inner edge)
  for (let i = 0; i < n; i++) vertices.push(innerOutline[i].x, topY, innerOutline[i].y);

  const layer1 = n;
  const layer2 = n * 2;
  const layer3 = n * 3;
  const layer4 = n * 4;

  // Base outer wall: layer 0 (Y=0) to layer 1 (Y=safeThickness)
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    indices.push(i, layer1 + i, next);
    indices.push(next, layer1 + i, layer1 + next);
  }

  // Lip outer wall: layer 1 (Y=safeThickness) to layer 3 (Y=topY)
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    indices.push(layer1 + i, layer3 + i, layer1 + next);
    indices.push(layer1 + next, layer3 + i, layer3 + next);
  }

  // Lip top: ring from layer 3 (outer@topY) to layer 4 (inner@topY)
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    indices.push(layer3 + i, layer4 + i, layer3 + next);
    indices.push(layer3 + next, layer4 + i, layer4 + next);
  }

  // Lip inner wall: layer 4 (inner@topY) down to layer 2 (inner@safeThickness)
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    indices.push(layer4 + i, layer2 + i, layer4 + next);
    indices.push(layer4 + next, layer2 + i, layer2 + next);
  }

  // Base top ring: annular face at Y=safeThickness from layer 1 (outer) to layer 2 (inner)
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    indices.push(layer2 + i, layer1 + i, layer2 + next);
    indices.push(layer2 + next, layer1 + i, layer1 + next);
  }

  // Bottom face: concave-safe triangulation at Y=0 (normal down)
  const bottomTris = THREE.ShapeUtils.triangulateShape(
    outline.map((p) => new THREE.Vector2(p.x, p.y)),
    [],
  );
  for (const [a, b, c] of bottomTris) {
    indices.push(a, b, c);
  }

  // Floor face: concave-safe triangulation at Y=safeThickness (normal up)
  const floorTris = THREE.ShapeUtils.triangulateShape(
    innerOutline.map((p) => new THREE.Vector2(p.x, p.y)),
    [],
  );
  for (const [a, b, c] of floorTris) {
    indices.push(layer2 + a, layer2 + c, layer2 + b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Walk the convex hull and recursively pull midpoints inward wherever the
 * hull edge is far from any support base point. This carves concavities
 * (e.g. the open center of a horseshoe) while keeping the outline convex
 * near actual supports.
 */
function dentConvexHull(
  hull: THREE.Vector2[],
  basePoints: THREE.Vector2[],
  sampleRadius: number,
): THREE.Vector2[] {
  const threshold = sampleRadius * 1.8;
  const result: THREE.Vector2[] = [];

  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    result.push(a);
    subdivideEdge(a, b, basePoints, threshold, sampleRadius, result, 0);
  }

  return result;
}

function subdivideEdge(
  a: THREE.Vector2,
  b: THREE.Vector2,
  basePoints: THREE.Vector2[],
  threshold: number,
  sampleRadius: number,
  out: THREE.Vector2[],
  depth: number,
): void {
  if (depth > 6) return;
  const mid = new THREE.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2);
  const distToNearest = nearestDist(mid, basePoints);
  if (distToNearest <= threshold) return;

  // Pull midpoint toward the nearest base point, stopping at sampleRadius
  const nearest = nearestPoint(mid, basePoints);
  const dx = mid.x - nearest.x;
  const dy = mid.y - nearest.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const pulled = new THREE.Vector2(
    nearest.x + (dx / d) * sampleRadius,
    nearest.y + (dy / d) * sampleRadius,
  );

  subdivideEdge(a, pulled, basePoints, threshold, sampleRadius, out, depth + 1);
  out.push(pulled);
  subdivideEdge(pulled, b, basePoints, threshold, sampleRadius, out, depth + 1);
}

function nearestDist(p: THREE.Vector2, points: THREE.Vector2[]): number {
  let min = Infinity;
  for (const q of points) {
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    const d = dx * dx + dy * dy;
    if (d < min) min = d;
  }
  return Math.sqrt(min);
}

function nearestPoint(p: THREE.Vector2, points: THREE.Vector2[]): THREE.Vector2 {
  let min = Infinity;
  let best = points[0];
  for (const q of points) {
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    const d = dx * dx + dy * dy;
    if (d < min) {
      min = d;
      best = q;
    }
  }
  return best;
}

export function convexHull2D(points: THREE.Vector2[]): THREE.Vector2[] {
  const unique: THREE.Vector2[] = [];
  const seen = new Set<string>();
  for (const p of points) {
    const key = `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }
  unique.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (unique.length <= 3) return unique;
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: THREE.Vector2[] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: THREE.Vector2[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
