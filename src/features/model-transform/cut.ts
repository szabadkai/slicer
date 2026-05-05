export type CutAxis = 'x' | 'y' | 'z';
export type Vec3Tuple = [number, number, number];

export interface PlaneCutResult {
  negative: Float32Array | null;
  positive: Float32Array | null;
  negativeTriangleCount: number;
  positiveTriangleCount: number;
}

type Vec = [number, number, number];
type Side = 'negative' | 'positive';

const EPSILON = 1e-6;
const KEY_SCALE = 1e5;

const AXIS_INDEX: Record<CutAxis, number> = { x: 0, y: 1, z: 2 };

export function cutGeometryByAxisPlane(
  positions: Float32Array,
  axis: CutAxis,
  offset: number,
): PlaneCutResult {
  const normal: Vec = [0, 0, 0];
  normal[AXIS_INDEX[axis]] = 1;
  return cutGeometryByPlane(positions, normal, offset);
}

export function cutGeometryByPlane(
  positions: Float32Array,
  normalInput: Vec3Tuple,
  constant: number,
): PlaneCutResult {
  if (positions.length < 9 || positions.length % 9 !== 0) {
    return {
      negative: null,
      positive: null,
      negativeTriangleCount: 0,
      positiveTriangleCount: 0,
    };
  }

  const normal = normalize(normalInput);
  if (length(normal) <= EPSILON || !Number.isFinite(constant)) {
    return {
      negative: null,
      positive: null,
      negativeTriangleCount: 0,
      positiveTriangleCount: 0,
    };
  }

  const negativePositions: number[] = [];
  const positivePositions: number[] = [];
  const cutSegments: [Vec, Vec][] = [];

  for (let i = 0; i < positions.length; i += 9) {
    const tri: Vec[] = [
      [positions[i], positions[i + 1], positions[i + 2]],
      [positions[i + 3], positions[i + 4], positions[i + 5]],
      [positions[i + 6], positions[i + 7], positions[i + 8]],
    ];
    const distances = tri.map((v) => dot(v, normal) - constant);

    appendClippedTriangle(tri, distances, 'negative', negativePositions);
    appendClippedTriangle(tri, distances, 'positive', positivePositions);

    const intersections = trianglePlaneIntersections(tri, distances);
    if (intersections.length === 2 && !samePoint(intersections[0], intersections[1])) {
      cutSegments.push([intersections[0], intersections[1]]);
    }
  }

  appendCaps(cutSegments, normal, negativePositions, positivePositions);

  return {
    negative: buildPositions(negativePositions),
    positive: buildPositions(positivePositions),
    negativeTriangleCount: negativePositions.length / 9,
    positiveTriangleCount: positivePositions.length / 9,
  };
}

export function cleanPlaneCutResult(result: PlaneCutResult): PlaneCutResult | null {
  if (!result.negative || !result.positive) return null;
  const negative = removeDegenerateTriangles(result.negative);
  const positive = removeDegenerateTriangles(result.positive);
  if (negative.length < 9 || positive.length < 9) return null;
  return {
    negative,
    positive,
    negativeTriangleCount: negative.length / 9,
    positiveTriangleCount: positive.length / 9,
  };
}

function appendClippedTriangle(
  triangle: Vec[],
  distances: number[],
  side: Side,
  output: number[],
): void {
  const clipped = clipPolygon(triangle, distances, side);
  appendTriangulatedPolygon(clipped, output);
}

function clipPolygon(vertices: Vec[], distances: number[], side: Side): Vec[] {
  const output: Vec[] = [];

  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    const previous = vertices[(i + vertices.length - 1) % vertices.length];
    const currentDistance = distances[i];
    const previousDistance = distances[(i + vertices.length - 1) % vertices.length];
    const currentInside = isInside(currentDistance, side);
    const previousInside = isInside(previousDistance, side);

    if (currentInside) {
      if (!previousInside)
        output.push(interpolatePlanePoint(previous, current, previousDistance, currentDistance));
      output.push([...current]);
    } else if (previousInside) {
      output.push(interpolatePlanePoint(previous, current, previousDistance, currentDistance));
    }
  }

  return dedupeSequential(output);
}

function isInside(distance: number, side: Side): boolean {
  return side === 'negative' ? distance <= EPSILON : distance >= -EPSILON;
}

function interpolatePlanePoint(a: Vec, b: Vec, da: number, db: number): Vec {
  const denom = da - db;
  const t = Math.abs(denom) <= EPSILON ? 0 : da / denom;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function appendTriangulatedPolygon(poly: Vec[], output: number[]): void {
  if (poly.length < 3) return;
  for (let i = 1; i < poly.length - 1; i++) {
    appendTriangle(output, poly[0], poly[i], poly[i + 1]);
  }
}

function trianglePlaneIntersections(triangle: Vec[], distances: number[]): Vec[] {
  const points: Vec[] = [];

  for (let i = 0; i < 3; i++) {
    const a = triangle[i];
    const b = triangle[(i + 1) % 3];
    const da = distances[i];
    const db = distances[(i + 1) % 3];

    if (Math.abs(da) <= EPSILON) addUniquePoint(points, a);
    if (da * db < -EPSILON * EPSILON) {
      addUniquePoint(points, interpolatePlanePoint(a, b, da, db));
    }
    if (Math.abs(db) <= EPSILON) addUniquePoint(points, b);
  }

  return points;
}

function appendCaps(
  segments: [Vec, Vec][],
  normal: Vec,
  negativePositions: number[],
  positivePositions: number[],
): void {
  const loops = buildSegmentLoops(segments);
  for (const loop of loops) {
    if (loop.length < 3) continue;
    appendCap(loop, normal, 'negative', negativePositions);
    appendCap(loop, normal, 'positive', positivePositions);
  }
}

function buildSegmentLoops(segments: [Vec, Vec][]): Vec[][] {
  const adjacency = new Map<string, Set<string>>();
  const points = new Map<string, Vec>();

  for (const [a, b] of segments) {
    const ka = pointKey(a);
    const kb = pointKey(b);
    if (ka === kb) continue;
    points.set(ka, a);
    points.set(kb, b);
    addNeighbor(adjacency, ka, kb);
    addNeighbor(adjacency, kb, ka);
  }

  const loops: Vec[][] = [];
  const usedEdges = new Set<string>();

  for (const start of adjacency.keys()) {
    for (const next of adjacency.get(start) ?? []) {
      const initialEdge = edgeKey(start, next);
      if (usedEdges.has(initialEdge)) continue;

      const loopKeys = [start];
      let prev = start;
      let cur = next;
      usedEdges.add(initialEdge);

      for (let guard = 0; guard < adjacency.size + 2; guard++) {
        if (cur === start) break;
        loopKeys.push(cur);
        const candidates = [...(adjacency.get(cur) ?? [])].filter(
          (candidate) => candidate !== prev && !usedEdges.has(edgeKey(cur, candidate)),
        );
        const candidate =
          candidates[0] ?? [...(adjacency.get(cur) ?? [])].find((key) => key !== prev);
        if (!candidate) break;
        usedEdges.add(edgeKey(cur, candidate));
        prev = cur;
        cur = candidate;
      }

      if (cur === start && loopKeys.length >= 3) {
        loops.push(loopKeys.map((key) => points.get(key)).filter((p): p is Vec => !!p));
      }
    }
  }

  return loops;
}

function appendCap(loop: Vec[], normal: Vec, side: Side, output: number[]): void {
  const center = centroid(loop);
  const ordered = orderLoop(loop, normal);
  const desiredNormal: Vec = side === 'negative' ? normal : [-normal[0], -normal[1], -normal[2]];

  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    const normal = triangleNormal(center, a, b);
    if (dot(normal, desiredNormal) >= 0) appendTriangle(output, center, a, b);
    else appendTriangle(output, center, b, a);
  }
}

function orderLoop(loop: Vec[], normal: Vec): Vec[] {
  const center = centroid(loop);
  const [u, v] = planeBasis(normal);
  return [...loop].sort((a, b) => {
    const da: Vec = [a[0] - center[0], a[1] - center[1], a[2] - center[2]];
    const db: Vec = [b[0] - center[0], b[1] - center[1], b[2] - center[2]];
    const aa = Math.atan2(dot(da, v), dot(da, u));
    const bb = Math.atan2(dot(db, v), dot(db, u));
    return aa - bb;
  });
}

function planeBasis(normal: Vec): [Vec, Vec] {
  const helper: Vec = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(helper, normal));
  const v = normalize(cross(normal, u));
  return [u, v];
}

function triangleNormal(a: Vec, b: Vec, c: Vec): Vec {
  const ab: Vec = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Vec = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
}

function centroid(points: Vec[]): Vec {
  const sum: Vec = [0, 0, 0];
  for (const point of points) {
    sum[0] += point[0];
    sum[1] += point[1];
    sum[2] += point[2];
  }
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
}

function buildPositions(positions: number[]): Float32Array | null {
  if (positions.length < 9) return null;
  return new Float32Array(positions);
}

function removeDegenerateTriangles(positions: Float32Array): Float32Array {
  const cleaned: number[] = [];
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i];
    const ay = positions[i + 1];
    const az = positions[i + 2];
    const bx = positions[i + 3];
    const by = positions[i + 4];
    const bz = positions[i + 5];
    const cx = positions[i + 6];
    const cy = positions[i + 7];
    const cz = positions[i + 8];
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    if (nx * nx + ny * ny + nz * nz > 1e-12) {
      cleaned.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    }
  }
  return cleaned.length === positions.length ? positions : new Float32Array(cleaned);
}

function appendTriangle(output: number[], a: Vec, b: Vec, c: Vec): void {
  output.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

function dedupeSequential(points: Vec[]): Vec[] {
  const result: Vec[] = [];
  for (const point of points) {
    if (result.length === 0 || !samePoint(result[result.length - 1], point)) result.push(point);
  }
  if (result.length > 1 && samePoint(result[0], result[result.length - 1])) result.pop();
  return result;
}

function addUniquePoint(points: Vec[], point: Vec): void {
  if (!points.some((existing) => samePoint(existing, point))) points.push([...point]);
}

function samePoint(a: Vec, b: Vec): boolean {
  return (
    Math.abs(a[0] - b[0]) <= EPSILON &&
    Math.abs(a[1] - b[1]) <= EPSILON &&
    Math.abs(a[2] - b[2]) <= EPSILON
  );
}

function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec, b: Vec): Vec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function length(a: Vec): number {
  return Math.sqrt(dot(a, a));
}

function normalize(a: Vec): Vec {
  const len = length(a);
  if (len <= EPSILON) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

function addNeighbor(adjacency: Map<string, Set<string>>, a: string, b: string): void {
  let neighbors = adjacency.get(a);
  if (!neighbors) {
    neighbors = new Set();
    adjacency.set(a, neighbors);
  }
  neighbors.add(b);
}

function pointKey(point: Vec): string {
  return `${Math.round(point[0] * KEY_SCALE)},${Math.round(point[1] * KEY_SCALE)},${Math.round(point[2] * KEY_SCALE)}`;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
