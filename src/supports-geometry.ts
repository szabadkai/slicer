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
  reason?: 'overhang' | 'minima' | 'stabilization' | 'reinforcement';
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
  // Radius of the flared tip at the contact end (≥ supportCollisionRadius
  // when the user picks a fat tip with a thin shaft).
  supportTipRadius: number;
  maxContactOffset: number;
  // When true and no plate-reaching route is found, search for a nearby
  // model surface to bridge to instead of returning null.
  allowBridgeSupports: boolean;
  // Maximum distance (mm) to search for a bridge target surface.
  maxBridgeSearchRadius: number;
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
  radius: number,
): boolean {
  const dir = new THREE.Vector3().subVectors(to, from);
  const length = dir.length();
  if (length < 0.1) return false;
  dir.normalize();
  for (const start of clearanceSampleStarts(from, dir, radius)) {
    context.raycaster.set(start, dir);
    context.raycaster.far = length;
    const hits = context.raycaster.intersectObject(context.mesh);
    if (hits.some((hit) => hit.distance > 0.05 && hit.distance < length - 0.05)) return true;
  }
  return false;
}

// Returns ray-origin samples spaced around `axis` at the full pillar radius.
// The samples form a 5-point cross (center + 4 cardinal offsets) that
// approximates the swept cylinder of the pillar shaft.
function clearanceSampleStarts(
  origin: THREE.Vector3,
  axis: THREE.Vector3,
  radius: number,
): THREE.Vector3[] {
  const r = Math.max(0, radius);
  if (r === 0) return [origin];
  const tangent =
    Math.abs(axis.dot(UP)) < 0.9
      ? new THREE.Vector3().crossVectors(axis, UP).normalize()
      : new THREE.Vector3(1, 0, 0);
  const bitangent = new THREE.Vector3().crossVectors(axis, tangent).normalize();
  return [
    origin,
    origin.clone().addScaledVector(tangent, r),
    origin.clone().addScaledVector(tangent, -r),
    origin.clone().addScaledVector(bitangent, r),
    origin.clone().addScaledVector(bitangent, -r),
  ];
}

export function routeCollides(
  route: RouteWaypoint[],
  context: RouteContext,
  tipHeight: number,
  baseHeight: number,
  shaftRadius: number,
  tipRadius: number = shaftRadius,
): boolean {
  const top = route[0];
  const tipBottom = { x: top.x, y: top.y - tipHeight, z: top.z };
  // Top segment widens to tipRadius; use whichever is larger for collision sampling.
  const topSegmentRadius = Math.max(shaftRadius, tipRadius);
  for (let i = 0; i < route.length - 1; i++) {
    const from = i === 0 ? tipBottom : route[i];
    const to = route[i + 1];
    const isLast = i === route.length - 2;
    const targetY = isLast ? (to.internalResting ? to.y + tipHeight : baseHeight) : to.y;
    const fromVec = new THREE.Vector3(from.x, from.y, from.z);
    const toVec = new THREE.Vector3(to.x, targetY, to.z);
    const segmentRadius = i === 0 ? topSegmentRadius : shaftRadius;
    if (segmentCollides(fromVec, toVec, context, segmentRadius)) return true;
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
  sphereRadius = 0,
): ProfileRing[] {
  const profile: ProfileRing[] = [];
  const top = toVector3(route[0]);
  const firstTarget = routeTargetPoint(route, 0, baseHeight, tipHeight, floorY);
  const firstDir = new THREE.Vector3().subVectors(firstTarget, top);
  const firstLength = firstDir.length();
  if (firstLength < 0.1) return profile;
  firstDir.normalize();
  // When using a spherical connection, shift the shaft start down by sphereRadius
  // so the shaft cap aligns with the sphere's equator for a seamless join.
  const tipPos = sphereRadius > 0 ? top.clone().addScaledVector(firstDir, sphereRadius) : top;
  addProfileRing(profile, tipPos, sphereRadius);
  addProfileRing(
    profile,
    top.clone().addScaledVector(firstDir, Math.min(tipHeight, firstLength * 0.8)),
    tipRadius,
  );

  const lastPoint = route[route.length - 1];
  const lastIsInternal = Boolean(lastPoint.internalResting);
  const bodyEndIndex = lastIsInternal ? route.length - 2 : route.length - 1;

  for (let i = 1; i <= bodyEndIndex; i++) {
    addProfileRing(
      profile,
      routeTargetPoint(route, i - 1, baseHeight, tipHeight, floorY),
      pillarRadius,
    );
  }

  if (lastIsInternal) {
    addProfileRing(
      profile,
      routeTargetPoint(route, route.length - 2, baseHeight, tipHeight, floorY),
      pillarRadius,
    );
    const bottomContact = toVector3(lastPoint);
    const previous = profile[profile.length - 1]?.center || top;
    const bottomDir = new THREE.Vector3().subVectors(bottomContact, previous);
    const bottomLength = bottomDir.length();
    if (bottomLength >= 0.1) {
      bottomDir.normalize();
      addProfileRing(
        profile,
        bottomContact.clone().addScaledVector(bottomDir, -Math.min(tipHeight, bottomLength * 0.8)),
        tipRadius,
      );
      addProfileRing(profile, bottomContact, 0);
    }
  } else {
    const base = route[route.length - 1];
    addProfileRing(
      profile,
      new THREE.Vector3(base.x, Math.max(baseHeight, floorY + baseHeight), base.z),
      pillarRadius,
    );
    addProfileRing(profile, new THREE.Vector3(base.x, floorY, base.z), baseRadius);
  }
  return profile;
}

function computeProfileFrames(
  profile: ProfileRing[],
): { tangent: THREE.Vector3; normal: THREE.Vector3; binormal: THREE.Vector3 }[] {
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
      normal = previousNormal
        .clone()
        .sub(tangent.clone().multiplyScalar(previousNormal.dot(tangent)));
      if (normal.lengthSq() < 1e-6) normal = null;
    }
    if (!normal) {
      normal =
        Math.abs(tangent.dot(UP)) < 0.95
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
    for (let s = 0; s < segments; s++)
      indices.push(ringA.start, ringB.start + s, ringB.start + ((s + 1) % segments));
    return;
  }
  if (ringB.count === 1) {
    for (let s = 0; s < segments; s++)
      indices.push(ringA.start + s, ringB.start, ringA.start + ((s + 1) % segments));
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

function createSweptSupportGeometry(
  profile: ProfileRing[],
  segments: number,
): THREE.BufferGeometry | null {
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
      const offset = normal
        .clone()
        .multiplyScalar(Math.cos(angle) * radius)
        .addScaledVector(binormal, Math.sin(angle) * radius);
      positions.push(center.x + offset.x, center.y + offset.y, center.z + offset.z);
    }
    rings.push({ start, count: segments });
  }

  for (let i = 0; i < profile.length - 1; i++)
    connectProfileRings(indices, rings[i], rings[i + 1], segments);
  addCap(indices, positions, profile[0], segments, rings[0].start, true);
  addCap(
    indices,
    positions,
    profile[profile.length - 1],
    segments,
    rings[rings.length - 1].start,
    false,
  );

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
  sphereRadius = 0,
): void {
  const profile = buildSupportProfile(
    route,
    tipDiameter / 2,
    tipHeight,
    pillarRadius,
    baseRadius,
    baseHeight,
    floorY,
    sphereRadius,
  );
  const supportGeo = createSweptSupportGeometry(profile, SUPPORT_SEGMENTS);
  if (supportGeo) geometries.push(supportGeo);

  // Attach a sphere at the contact point for spherical connection.
  // Offset downward along the shaft direction by sphereRadius so the sphere
  // just kisses the model surface instead of embedding halfway into it.
  if (sphereRadius > 0) {
    const top = toVector3(route[0]);
    const firstTarget = routeTargetPoint(route, 0, baseHeight, tipHeight, floorY);
    const offsetDir = new THREE.Vector3().subVectors(firstTarget, top).normalize();
    const sphereCenter = top.clone().addScaledVector(offsetDir, sphereRadius);
    const sphereGeo = new THREE.SphereGeometry(sphereRadius, 6, 4);
    sphereGeo.translate(sphereCenter.x, sphereCenter.y, sphereCenter.z);
    geometries.push(sphereGeo);
  }
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
  interface Shaft {
    x: number;
    z: number;
    topY: number;
    bottomY: number;
  }
  const shafts: Shaft[] = [];
  for (const route of routes) {
    for (let i = 0; i < route.length - 1; i++) {
      const from = route[i],
        to = route[i + 1];
      const actualFromY = i === 0 ? from.y - tipHeight : from.y;
      const isLast = i === route.length - 2;
      const actualToY = isLast
        ? to.internalResting
          ? to.y + tipHeight
          : floorY + baseHeight
        : to.y;
      const dx = to.x - from.x,
        dz = to.z - from.z;
      if (Math.sqrt(dx * dx + dz * dz) < 0.01) {
        shafts.push({
          x: from.x,
          z: from.z,
          topY: Math.max(actualFromY, actualToY),
          bottomY: Math.min(actualFromY, actualToY),
        });
      }
    }
  }
  if (shafts.length < 2) return;

  const maxBraceDist = 24;
  const braceRadius = pillarRadius * 0.5;
  const maxConns = 2;
  const conns = new Map<number, number>();
  for (let i = 0; i < shafts.length; i++) conns.set(i, 0);

  const pairKey = (a: number, b: number): string => `${Math.min(a, b)}-${Math.max(a, b)}`;
  const visited = new Set<string>();

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
    neighbors.sort(
      (a, b) =>
        a.dist - b.dist || a.shaft.x - b.shaft.x || a.shaft.z - b.shaft.z || a.index - b.index,
    );

    for (const neighbor of neighbors) {
      if ((conns.get(i) ?? 0) >= maxConns || (conns.get(neighbor.index) ?? 0) >= maxConns) continue;
      if (neighbor.dist > maxBraceDist) continue;
      const key = pairKey(i, neighbor.index);
      if (visited.has(key)) continue;
      visited.add(key);

      const s2 = neighbor.shaft;
      const overlapTop = Math.min(s1.topY, s2.topY);
      const overlapBottom = Math.max(s1.bottomY, s2.bottomY);
      const hDist = neighbor.dist;
      // vertical rise = horizontal distance → 45° angle
      const vRise = hDist;
      const margin = pillarRadius * 2;
      if (overlapTop - overlapBottom <= vRise + margin) continue;

      let added = false;
      let y = overlapBottom + margin;
      while (y + vRise <= overlapTop - margin) {
        // Cross pair: two diagonals forming an X
        const a1 = new THREE.Vector3(s1.x, y, s1.z);
        const a2 = new THREE.Vector3(s2.x, y + vRise, s2.z);
        const b1 = new THREE.Vector3(s1.x, y + vRise, s1.z);
        const b2 = new THREE.Vector3(s2.x, y, s2.z);
        const minClearance = Math.max(clearance, pillarRadius * 2);
        const aOk = !segmentCollides(a1, a2, context, minClearance);
        const bOk = !segmentCollides(b1, b2, context, minClearance);
        if (aOk || bOk) {
          if (aOk) geometries.push(makeBraceCylinder(a1, a2, braceRadius));
          if (bOk) geometries.push(makeBraceCylinder(b1, b2, braceRadius));
          added = true;
        }
        y += (vRise + margin) * 2;
      }
      if (added) {
        conns.set(i, (conns.get(i) ?? 0) + 1);
        conns.set(neighbor.index, (conns.get(neighbor.index) ?? 0) + 1);
      }
    }
  }
}

function makeBraceCylinder(
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  radius: number,
): THREE.BufferGeometry {
  const length = p1.distanceTo(p2);
  const geo = new THREE.CylinderGeometry(radius, radius, length, Math.max(3, SUPPORT_SEGMENTS));
  const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
  geo.translate((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, (p1.z + p2.z) / 2);
  return geo;
}

// ---------------------------------------------------------------------------
// Base pan (re-exported for back-compat — the implementation lives in
// supports-base-pan.ts to keep this file under 600 LOC).
// ---------------------------------------------------------------------------

export { createBasePanGeometry } from './supports-base-pan';
export { createBaseBraceGeometry, estimateBaseBraceVolume } from './supports-base-brace';

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
      if (norm) {
        normalsArr[idx] = norm.getX(i);
        normalsArr[idx + 1] = norm.getY(i);
        normalsArr[idx + 2] = norm.getZ(i);
      }
    }
    offset += pos.count;
  }
  for (const g of geometries) g.dispose();
  for (const g of nonIndexed) {
    if (!geometries.includes(g)) g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normalsArr, 3));
  return merged;
}
