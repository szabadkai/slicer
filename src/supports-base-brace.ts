import * as THREE from 'three';
import type { RouteWaypoint } from './supports-geometry';
import { convexHull2D } from './supports-base-pan';

export const DEFAULT_BASE_BRACE_HEIGHT = 0.15;

interface BraceEdge {
  a: number;
  b: number;
}

export function createBaseBraceGeometry(
  routes: RouteWaypoint[][],
  geometries: THREE.BufferGeometry[],
  radius = 0.8,
  maxDistance = 28,
  floorY = 0,
  height = DEFAULT_BASE_BRACE_HEIGHT,
): void {
  const bases = routes
    .map((route) => route[route.length - 1])
    .filter((point): point is RouteWaypoint => Boolean(point) && !point.internalResting);
  if (bases.length < 2) return;

  const safeRadius = Number.isFinite(radius) ? Math.max(0.2, radius) : 0.8;
  const safeMaxDistance = Number.isFinite(maxDistance) ? Math.max(4, maxDistance) : 28;
  const safeHeight = Number.isFinite(height) ? Math.max(0.05, height) : DEFAULT_BASE_BRACE_HEIGHT;
  for (const edge of collectBraceEdges(bases, safeRadius, safeMaxDistance)) {
    addBrace(bases[edge.a], bases[edge.b], geometries, safeRadius, floorY, safeHeight);
  }
}

export function estimateBaseBraceVolume(
  routes: RouteWaypoint[][],
  radius = 0.8,
  maxDistance = 28,
  endpointRadii: number[] = [],
  height = DEFAULT_BASE_BRACE_HEIGHT,
): number {
  const entries = routes
    .map((route, index) => ({
      base: route[route.length - 1],
      endpointRadius: Math.max(0, endpointRadii[index] ?? 0),
    }))
    .filter(
      (entry): entry is { base: RouteWaypoint; endpointRadius: number } =>
        Boolean(entry.base) && !entry.base.internalResting,
    );
  const bases = entries.map((entry) => entry.base);
  if (bases.length < 2) return 0;

  const safeRadius = Number.isFinite(radius) ? Math.max(0.2, radius) : 0.8;
  const safeMaxDistance = Number.isFinite(maxDistance) ? Math.max(4, maxDistance) : 28;
  const safeHeight = Number.isFinite(height) ? Math.max(0.05, height) : DEFAULT_BASE_BRACE_HEIGHT;
  const crossSectionArea = safeRadius * 2 * safeHeight;
  return collectBraceEdges(bases, safeRadius, safeMaxDistance).reduce((sum, edge) => {
    const a = bases[edge.a];
    const b = bases[edge.b];
    const exposedLength = Math.max(
      0,
      Math.hypot(a.x - b.x, a.z - b.z) -
        entries[edge.a].endpointRadius -
        entries[edge.b].endpointRadius,
    );
    return sum + crossSectionArea * exposedLength;
  }, 0);
}

function collectBraceEdges(
  bases: RouteWaypoint[],
  radius: number,
  maxDistance: number,
): BraceEdge[] {
  const outlineEdges = continuousOutlineEdges(bases);
  const outlineEdgeKeys = new Set(outlineEdges.map((edge) => edgeKey(edge.a, edge.b)));
  const edges = [...outlineEdges];
  const maxConnections = 3;
  const connections = new Map<number, number>();
  for (let i = 0; i < bases.length; i++) connections.set(i, 0);
  for (const edge of outlineEdges) {
    connections.set(edge.a, (connections.get(edge.a) ?? 0) + 1);
    connections.set(edge.b, (connections.get(edge.b) ?? 0) + 1);
  }

  for (const edge of candidateEdges(bases, radius, maxDistance)) {
    if (outlineEdgeKeys.has(edgeKey(edge.a, edge.b))) continue;
    if ((connections.get(edge.a) ?? 0) >= maxConnections) continue;
    if ((connections.get(edge.b) ?? 0) >= maxConnections) continue;
    edges.push(edge);
    connections.set(edge.a, (connections.get(edge.a) ?? 0) + 1);
    connections.set(edge.b, (connections.get(edge.b) ?? 0) + 1);
  }
  return edges;
}

function continuousOutlineEdges(bases: RouteWaypoint[]): BraceEdge[] {
  const hullPoints = convexHull2D(bases.map((base) => new THREE.Vector2(base.x, base.z)));
  if (hullPoints.length < 3) return [];

  const outline: Array<{ index: number; point: THREE.Vector2 }> = [];
  const used = new Set<number>();
  for (const hullPoint of hullPoints) {
    const index = findMatchingBaseIndex(bases, hullPoint, used);
    if (index === -1) continue;
    used.add(index);
    outline.push({ index, point: hullPoint });
  }
  if (outline.length < 3) return [];

  const edges: BraceEdge[] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    edges.push({ a: a.index, b: b.index });
  }
  return edges;
}

function findMatchingBaseIndex(
  bases: RouteWaypoint[],
  point: THREE.Vector2,
  used: Set<number>,
): number {
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < bases.length; i++) {
    if (used.has(i)) continue;
    const distance = Math.hypot(bases[i].x - point.x, bases[i].z - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function candidateEdges(
  bases: RouteWaypoint[],
  radius: number,
  maxDistance: number,
): Array<{ a: number; b: number; dist: number }> {
  const edges: Array<{ a: number; b: number; dist: number }> = [];
  for (let i = 0; i < bases.length; i++) {
    for (let j = i + 1; j < bases.length; j++) {
      const dist = Math.hypot(bases[i].x - bases[j].x, bases[i].z - bases[j].z);
      if (dist <= radius * 2.5 || dist > maxDistance) continue;
      edges.push({ a: i, b: j, dist });
    }
  }
  edges.sort((a, b) => a.dist - b.dist || a.a - b.a || a.b - b.b);
  return edges;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function addBrace(
  a: RouteWaypoint,
  b: RouteWaypoint,
  geometries: THREE.BufferGeometry[],
  radius: number,
  floorY: number,
  height: number,
): void {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.1) return;

  const braceGeo = new THREE.BoxGeometry(length, height, radius * 2);
  braceGeo.rotateY(-Math.atan2(dz, dx));
  braceGeo.translate((a.x + b.x) / 2, floorY + height / 2, (a.z + b.z) / 2);
  geometries.push(braceGeo);
}
