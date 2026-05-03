/**
 * Support generation – geometry building, collision checks, and merging.
 * Extracted from supports.ts to keep files ≤ 600 LOC.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface RouteWaypoint {
  x: number;
  y: number;
  z: number;
  internalResting?: boolean;
}

export interface ContactPoint {
  position: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface RouteContext {
  mesh: THREE.Mesh;
  raycaster: THREE.Raycaster;
  modelBounds: THREE.Box3;
  modelCenter: THREE.Vector3;
}

export interface RouteOptions {
  allowInternalSupports: boolean;
  allowCavityContacts: boolean;
  approachMode: 'prefer-angled' | 'vertical';
  maxPillarAngle: number;
  modelClearance: number;
  supportCollisionRadius: number;
  maxContactOffset: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const SUPPORT_SEGMENTS = 6;

// ---------------------------------------------------------------------------
// Collision helpers (used by both route planning and cross-bracing)
// ---------------------------------------------------------------------------

export function segmentCollides(
  from: THREE.Vector3,
  to: THREE.Vector3,
  context: RouteContext,
  clearance: number,
): boolean {
  const dir = new THREE.Vector3().subVectors(to, from);
  const length = dir.length();
  if (length < 0.1) return false;
  dir.normalize();
  for (const start of clearanceSampleStarts(from, dir, clearance)) {
    context.raycaster.set(start, dir);
    context.raycaster.far = length;
    const hits = context.raycaster.intersectObject(context.mesh);
    if (hits.some((hit) => hit.distance > 0.05 && hit.distance < length - 0.05)) return true;
  }
  return false;
}

function clearanceSampleStarts(origin: THREE.Vector3, axis: THREE.Vector3, clearance: number): THREE.Vector3[] {
  const radius = Math.max(0, clearance * 0.5);
  if (radius === 0) return [origin];
  const tangent = Math.abs(axis.dot(UP)) < 0.9
    ? new THREE.Vector3().crossVectors(axis, UP).normalize()
    : new THREE.Vector3(1, 0, 0);
  const bitangent = new THREE.Vector3().crossVectors(axis, tangent).normalize();
  return [
    origin,
    origin.clone().addScaledVector(tangent, radius),
    origin.clone().addScaledVector(tangent, -radius),
    origin.clone().addScaledVector(bitangent, radius),
    origin.clone().addScaledVector(bitangent, -radius),
  ];
}

export function routeCollides(
  route: RouteWaypoint[],
  context: RouteContext,
  tipHeight: number,
  baseHeight: number,
  clearance: number,
): boolean {
  const top = route[0];
  const tipBottom = { x: top.x, y: top.y - tipHeight, z: top.z };
  for (let i = 0; i < route.length - 1; i++) {
    const from = i === 0 ? tipBottom : route[i];
    const to = route[i + 1];
    const isLast = i === route.length - 2;
    const targetY = isLast ? (to.internalResting ? to.y + tipHeight : baseHeight) : to.y;
    const fromVec = new THREE.Vector3(from.x, from.y, from.z);
    const toVec = new THREE.Vector3(to.x, targetY, to.z);
    if (segmentCollides(fromVec, toVec, context, clearance)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Profile & swept-geometry building
// ---------------------------------------------------------------------------

interface ProfileRing {
  center: THREE.Vector3;
  radius: number;
}

function toVector3(point: RouteWaypoint): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.y, point.z);
}

function routeTargetPoint(
  route: RouteWaypoint[],
  segmentIndex: number,
  baseHeight: number,
  tipHeight: number,
  floorY = 0,
): THREE.Vector3 {
  const to = route[segmentIndex + 1];
  const isLast = segmentIndex === route.length - 2;
  const y = isLast ? (to.internalResting ? to.y + tipHeight : floorY + baseHeight) : to.y;
  return new THREE.Vector3(to.x, y, to.z);
}

function addProfileRing(profile: ProfileRing[], center: THREE.Vector3, radius: number): void {
  const prev = profile[profile.length - 1];
  if (prev && prev.center.distanceToSquared(center) < 1e-6) {
    prev.radius = Math.max(prev.radius, radius);
    return;
  }
  profile.push({ center, radius });
}

function buildSupportProfile(
  route: RouteWaypoint[],
  tipRadius: number,
  tipHeight: number,
  pillarRadius: number,
  baseRadius: number,
  baseHeight: number,
  floorY: number,
): ProfileRing[] {
  const profile: ProfileRing[] = [];
  const top = toVector3(route[0]);
  const firstTarget = routeTargetPoint(route, 0, baseHeight, tipHeight, floorY);
  const firstDir = new THREE.Vector3().subVectors(firstTarget, top);
  const firstLength = firstDir.length();
  if (firstLength < 0.1) return profile;
  firstDir.normalize();
  addProfileRing(profile, top, 0);
  addProfileRing(profile, top.clone().addScaledVector(firstDir, Math.min(tipHeight, firstLength * 0.8)), tipRadius);

  const lastPoint = route[route.length - 1];
  const lastIsInternal = Boolean(lastPoint.internalResting);
  const bodyEndIndex = lastIsInternal ? route.length - 2 : route.length - 1;

  for (let i = 1; i <= bodyEndIndex; i++) {
    addProfileRing(profile, routeTargetPoint(route, i - 1, baseHeight, tipHeight, floorY), pillarRadius);
  }

  if (lastIsInternal) {
    addProfileRing(profile, routeTargetPoint(route, route.length - 2, baseHeight, tipHeight, floorY), pillarRadius);
    const bottomContact = toVector3(lastPoint);
    const previous = profile[profile.length - 1]?.center || top;
    const bottomDir = new THREE.Vector3().subVectors(bottomContact, previous);
    const bottomLength = bottomDir.length();
    if (bottomLength >= 0.1) {
      bottomDir.normalize();
      addProfileRing(profile, bottomContact.clone().addScaledVector(bottomDir, -Math.min(tipHeight, bottomLength * 0.8)), tipRadius);
      addProfileRing(profile, bottomContact, 0);
    }
  } else {
    const base = route[route.length - 1];
    addProfileRing(profile, new THREE.Vector3(base.x, Math.max(baseHeight, floorY + baseHeight), base.z), pillarRadius);
    addProfileRing(profile, new THREE.Vector3(base.x, floorY, base.z), baseRadius);
  }
  return profile;
}

function computeProfileFrames(profile: ProfileRing[]): { tangent: THREE.Vector3; normal: THREE.Vector3; binormal: THREE.Vector3 }[] {
  const DOWN = new THREE.Vector3(0, -1, 0);
  const frames: { tangent: THREE.Vector3; normal: THREE.Vector3; binormal: THREE.Vector3 }[] = [];
  let previousNormal: THREE.Vector3 | null = null;
  for (let i = 0; i < profile.length; i++) {
    const prev = profile[Math.max(0, i - 1)].center;
    const next = profile[Math.min(profile.length - 1, i + 1)].center;
    const tangent = new THREE.Vector3().subVectors(next, prev);
    if (tangent.lengthSq() < 1e-6) tangent.copy(DOWN);
    tangent.normalize();
    let normal: THREE.Vector3 | null = null;
    if (previousNormal) {
      normal = previousNormal.clone().sub(tangent.clone().multiplyScalar(previousNormal.dot(tangent)));
      if (normal.lengthSq() < 1e-6) normal = null;
    }
    if (!normal) {
      normal = Math.abs(tangent.dot(UP)) < 0.95
        ? new THREE.Vector3().crossVectors(tangent, UP)
        : new THREE.Vector3(1, 0, 0);
    }
    normal.normalize();
    const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
    frames.push({ tangent, normal, binormal });
    previousNormal = normal;
  }
  return frames;
}

function connectProfileRings(
  indices: number[],
  ringA: { start: number; count: number },
  ringB: { start: number; count: number },
  segments: number,
): void {
  if (ringA.count === 1 && ringB.count === 1) return;
  if (ringA.count === 1) {
    for (let s = 0; s < segments; s++) indices.push(ringA.start, ringB.start + s, ringB.start + ((s + 1) % segments));
    return;
  }
  if (ringB.count === 1) {
    for (let s = 0; s < segments; s++) indices.push(ringA.start + s, ringB.start, ringA.start + ((s + 1) % segments));
    return;
  }
  for (let s = 0; s < segments; s++) {
    const next = (s + 1) % segments;
    indices.push(ringA.start + s, ringB.start + s, ringB.start + next);
    indices.push(ringA.start + s, ringB.start + next, ringA.start + next);
  }
}

function addCap(
  indices: number[],
  positions: number[],
  ring: ProfileRing,
  segments: number,
  ringStart: number,
  reverse: boolean,
): void {
  if (ring.radius <= 1e-5) return;
  const centerIndex = positions.length / 3;
  positions.push(ring.center.x, ring.center.y, ring.center.z);
  for (let s = 0; s < segments; s++) {
    const next = (s + 1) % segments;
    if (reverse) indices.push(centerIndex, ringStart + next, ringStart + s);
    else indices.push(centerIndex, ringStart + s, ringStart + next);
  }
}

function createSweptSupportGeometry(profile: ProfileRing[], segments: number): THREE.BufferGeometry | null {
  if (profile.length < 2) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  const frames = computeProfileFrames(profile);
  const rings: { start: number; count: number }[] = [];

  for (let i = 0; i < profile.length; i++) {
    const { center, radius } = profile[i];
    const start = positions.length / 3;
    if (radius <= 1e-5) {
      positions.push(center.x, center.y, center.z);
      rings.push({ start, count: 1 });
      continue;
    }
    const { normal, binormal } = frames[i];
    for (let s = 0; s < segments; s++) {
      const angle = (s / segments) * Math.PI * 2;
      const offset = normal.clone().multiplyScalar(Math.cos(angle) * radius).addScaledVector(binormal, Math.sin(angle) * radius);
      positions.push(center.x + offset.x, center.y + offset.y, center.z + offset.z);
    }
    rings.push({ start, count: segments });
  }

  for (let i = 0; i < profile.length - 1; i++) connectProfileRings(indices, rings[i], rings[i + 1], segments);
  addCap(indices, positions, profile[0], segments, rings[0].start, true);
  addCap(indices, positions, profile[profile.length - 1], segments, rings[rings.length - 1].start, false);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildSupportGeometry(
  route: RouteWaypoint[],
  geometries: THREE.BufferGeometry[],
  tipDiameter: number,
  tipHeight: number,
  pillarRadius: number,
  baseRadius: number,
  baseHeight: number,
  floorY = 0,
): void {
  const profile = buildSupportProfile(route, tipDiameter / 2, tipHeight, pillarRadius, baseRadius, baseHeight, floorY);
  const supportGeo = createSweptSupportGeometry(profile, SUPPORT_SEGMENTS);
  if (supportGeo) geometries.push(supportGeo);
}

// ---------------------------------------------------------------------------
// Cross-bracing
// ---------------------------------------------------------------------------

export function generateCrossBracing(
  routes: RouteWaypoint[][],
  geometries: THREE.BufferGeometry[],
  pillarRadius: number,
  baseHeight: number,
  tipHeight: number,
  context: RouteContext,
  clearance: number,
  floorY = 0,
): void {
  interface Shaft { x: number; z: number; topY: number; bottomY: number }
  const shafts: Shaft[] = [];
  for (const route of routes) {
    for (let i = 0; i < route.length - 1; i++) {
      const from = route[i], to = route[i + 1];
      const actualFromY = i === 0 ? from.y - tipHeight : from.y;
      const isLast = i === route.length - 2;
      const actualToY = isLast ? (to.internalResting ? to.y + tipHeight : floorY + baseHeight) : to.y;
      const dx = to.x - from.x, dz = to.z - from.z;
      if (Math.sqrt(dx * dx + dz * dz) < 0.01) {
        shafts.push({ x: from.x, z: from.z, topY: Math.max(actualFromY, actualToY), bottomY: Math.min(actualFromY, actualToY) });
      }
    }
  }
  if (shafts.length < 2) return;

  const maxBraceDist = 24;
  const braceRadius = pillarRadius * 0.7;
  const zInterval = 12;
  const maxConns = 2;
  const conns = new Map<number, number>();
  for (let i = 0; i < shafts.length; i++) conns.set(i, 0);

  for (let i = 0; i < shafts.length; i++) {
    if ((conns.get(i) ?? 0) >= maxConns) continue;
    const s1 = shafts[i];
    const neighbors: { shaft: Shaft; dist: number; index: number }[] = [];
    for (let j = 0; j < shafts.length; j++) {
      if (i === j) continue;
      const s2 = shafts[j];
      const dist = Math.sqrt((s2.x - s1.x) ** 2 + (s2.z - s1.z) ** 2);
      if (dist >= pillarRadius * 2.5) neighbors.push({ shaft: s2, dist, index: j });
    }
    neighbors.sort((a, b) => a.dist - b.dist || a.shaft.x - b.shaft.x || a.shaft.z - b.shaft.z || a.index - b.index);

    for (const neighbor of neighbors) {
      if ((conns.get(i) ?? 0) >= maxConns || (conns.get(neighbor.index) ?? 0) >= maxConns) continue;
      if (neighbor.dist > maxBraceDist || i > neighbor.index) continue;
      const s2 = neighbor.shaft;
      const overlapTop = Math.min(s1.topY, s2.topY);
      const overlapBottom = Math.max(s1.bottomY, s2.bottomY);
      if (overlapTop - overlapBottom <= zInterval) continue;

      let yStart = overlapBottom + zInterval / 3;
      let dir = 1;
      let added = false;
      while (yStart + zInterval < overlapTop) {
        const yEnd = yStart + zInterval;
        const p1 = new THREE.Vector3(s1.x, dir === 1 ? yStart : yEnd, s1.z);
        const p2 = new THREE.Vector3(s2.x, dir === 1 ? yEnd : yStart, s2.z);
        if (segmentCollides(p1, p2, context, Math.max(clearance, pillarRadius * 2))) {
          yStart += zInterval; dir *= -1; continue;
        }
        const braceLength = p1.distanceTo(p2);
        const braceGeo = new THREE.CylinderGeometry(braceRadius, braceRadius, braceLength, Math.max(3, SUPPORT_SEGMENTS));
        const bDir = new THREE.Vector3().subVectors(p2, p1).normalize();
        braceGeo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, bDir));
        braceGeo.translate((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, (p1.z + p2.z) / 2);
        geometries.push(braceGeo);
        added = true;
        yStart += zInterval; dir *= -1;
      }
      if (added) {
        conns.set(i, (conns.get(i) ?? 0) + 1);
        conns.set(neighbor.index, (conns.get(neighbor.index) ?? 0) + 1);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Base pan
// ---------------------------------------------------------------------------

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
      outlineSamples.push(new THREE.Vector2(point.x + Math.cos(angle) * sampleRadius, point.y + Math.sin(angle) * sampleRadius));
    }
  }
  const outline = convexHull2D(outlineSamples);
  if (outline.length < 3) return new THREE.BufferGeometry();

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

  // Bottom face: triangulated fan at Y=0 (layer 0, normal down)
  for (let i = 1; i < n - 1; i++) {
    indices.push(0, i, i + 1);
  }

  // Floor face: triangulated fan at Y=safeThickness (layer 2, normal up)
  for (let i = 1; i < n - 1; i++) {
    indices.push(layer2, layer2 + i + 1, layer2 + i);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function convexHull2D(points: THREE.Vector2[]): THREE.Vector2[] {
  const unique: THREE.Vector2[] = [];
  const seen = new Set<string>();
  for (const p of points) {
    const key = `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
    if (!seen.has(key)) { seen.add(key); unique.push(p); }
  }
  unique.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (unique.length <= 3) return unique;
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: THREE.Vector2[] = [];
  for (const p of unique) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper: THREE.Vector2[] = [];
  for (let i = unique.length - 1; i >= 0; i--) { const p = unique[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = geometries.map((g) => {
    const ni = g.index ? g.toNonIndexed() : g;
    ni.computeVertexNormals();
    return ni;
  });
  let totalVerts = 0;
  for (const g of nonIndexed) totalVerts += g.attributes.position.count;

  const positions = new Float32Array(totalVerts * 3);
  const normalsArr = new Float32Array(totalVerts * 3);
  let offset = 0;
  for (const g of nonIndexed) {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const idx = (offset + i) * 3;
      positions[idx] = pos.getX(i);
      positions[idx + 1] = pos.getY(i);
      positions[idx + 2] = pos.getZ(i);
      if (norm) { normalsArr[idx] = norm.getX(i); normalsArr[idx + 1] = norm.getY(i); normalsArr[idx + 2] = norm.getZ(i); }
    }
    offset += pos.count;
  }
  for (const g of geometries) g.dispose();
  for (const g of nonIndexed) { if (!geometries.includes(g)) g.dispose(); }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normalsArr, 3));
  return merged;
}
