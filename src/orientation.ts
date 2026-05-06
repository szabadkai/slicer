/**
 * Auto-orientation engine.
 *
 * Evaluates candidate orientations and scores them based on preset strategy.
 * Inspired by STL-Tweaker (Salzburg Research) and PrusaSlicer.
 *
 * Candidate orientations: 26 directions
 *   6 face-aligned (cube faces)
 *   12 edge-aligned (cube edges)
 *   8 corner-aligned (cube corners)
 */

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

interface BufferAttribute {
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
  count: number;
}

interface GeometryLike {
  attributes: {
    position: BufferAttribute;
    normal?: BufferAttribute;
  };
}

type OrientPreset = 'fastest' | 'least-support' | 'best-quality';

interface OrientationMetrics {
  overhangArea: number;
  totalHeight: number;
  staircaseMetric: number;
  flatBottomArea: number;
}

interface SignificantFace {
  normal: Vec3;
  area: number;
  centroid: Vec3;
  triangleCount: number;
}

const UP: Vec3 = { x: 0, y: 1, z: 0 };

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function generateCandidates(): Vec3[] {
  const dirs: Vec3[] = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        dirs.push(normalize({ x, y, z }));
      }
    }
  }
  return dirs;
}

const CANDIDATES = generateCandidates();

function analyzeOrientation(geometry: GeometryLike, upDir: Vec3): OrientationMetrics {
  const pos = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const triCount = pos.count / 3;

  let overhangArea = 0;
  let totalHeight = 0;
  let staircaseMetric = 0;
  let flatBottomArea = 0;

  let minProj = Infinity;
  let maxProj = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const v: Vec3 = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
    const proj = dot(v, upDir);
    if (proj < minProj) minProj = proj;
    if (proj > maxProj) maxProj = proj;
  }
  totalHeight = maxProj - minProj;

  const overhangThreshold = Math.cos((30 * Math.PI) / 180);

  for (let i = 0; i < triCount; i++) {
    const idx = i * 3;
    const a: Vec3 = { x: pos.getX(idx), y: pos.getY(idx), z: pos.getZ(idx) };
    const b: Vec3 = { x: pos.getX(idx + 1), y: pos.getY(idx + 1), z: pos.getZ(idx + 1) };
    const c: Vec3 = { x: pos.getX(idx + 2), y: pos.getY(idx + 2), z: pos.getZ(idx + 2) };

    let n: Vec3;
    if (normal) {
      n = { x: normal.getX(idx), y: normal.getY(idx), z: normal.getZ(idx) };
    } else {
      const edge1 = sub(b, a);
      const edge2 = sub(c, a);
      n = normalize(cross(edge1, edge2));
    }

    const edge1 = sub(b, a);
    const edge2 = sub(c, a);
    const cr = cross(edge1, edge2);
    const area = length(cr) * 0.5;

    const d = dot(n, upDir);

    if (d < -overhangThreshold) overhangArea += area;
    if (d < -0.99) flatBottomArea += area;

    const absDot = Math.abs(d);
    if (absDot > 0.1 && absDot < 0.5) {
      staircaseMetric += area * (0.5 - absDot);
    }
  }

  return { overhangArea, totalHeight, staircaseMetric, flatBottomArea };
}

export interface CustomOrientWeights {
  height: number;
  overhang: number;
  staircase: number;
  flatBottom: number;
}

function scoreOrientation(
  metrics: OrientationMetrics,
  preset: OrientPreset,
  customWeights?: CustomOrientWeights,
): number {
  if (customWeights) {
    return (
      customWeights.height * -metrics.totalHeight +
      customWeights.overhang * -metrics.overhangArea +
      customWeights.staircase * -metrics.staircaseMetric +
      customWeights.flatBottom * metrics.flatBottomArea
    );
  }

  const { overhangArea, totalHeight, staircaseMetric, flatBottomArea } = metrics;
  switch (preset) {
    case 'fastest':
      return -totalHeight;
    case 'least-support':
      return -overhangArea + flatBottomArea * 0.5;
    case 'best-quality':
      return -overhangArea - staircaseMetric * 2 + flatBottomArea * 0.3;
    default:
      return -overhangArea;
  }
}

/** Quaternion that rotates `from` to align with `to` (unit vectors). */
function quatFromUnitVectors(from: Vec3, to: Vec3): Quat {
  const d = dot(from, to);
  if (d >= 1.0) return { x: 0, y: 0, z: 0, w: 1 };
  if (d <= -1.0) {
    // 180° rotation — pick an arbitrary perpendicular axis
    let perp: Vec3 = cross(from, { x: 1, y: 0, z: 0 });
    if (length(perp) < 1e-6) perp = cross(from, { x: 0, y: 1, z: 0 });
    perp = normalize(perp);
    return { x: perp.x, y: perp.y, z: perp.z, w: 0 };
  }
  const c = cross(from, to);
  const w = 1 + d;
  const len = Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z + w * w);
  return { x: c.x / len, y: c.y / len, z: c.z / len, w: w / len };
}

/**
 * Find optimal orientation using a Web Worker (genetic algorithm).
 * Returns a plain quaternion {x,y,z,w}.
 */
export function optimizeOrientationAsync(
  geometry: GeometryLike,
  preset: OrientPreset,
  onProgress?: (progress: number, message: string) => void,
): Promise<Quat> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./orientation.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (e: MessageEvent): void => {
      const { type, progress, message, quaternion } = e.data as {
        type: string;
        progress?: number;
        message?: string;
        quaternion?: [number, number, number, number];
      };
      if (type === 'progress') {
        onProgress?.(progress ?? 0, message ?? '');
      } else if (type === 'complete' && quaternion) {
        worker.terminate();
        resolve({ x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] });
      }
    };

    worker.onerror = (err): void => {
      worker.terminate();
      reject(err);
    };

    const positionArray = geometry.attributes.position;
    const normalAttr = geometry.attributes.normal;
    const posArr = new Float32Array(positionArray.count * 3);
    for (let i = 0; i < positionArray.count; i++) {
      posArr[i * 3] = positionArray.getX(i);
      posArr[i * 3 + 1] = positionArray.getY(i);
      posArr[i * 3 + 2] = positionArray.getZ(i);
    }
    let normalArr: Float32Array | null = null;
    if (normalAttr) {
      normalArr = new Float32Array(normalAttr.count * 3);
      for (let i = 0; i < normalAttr.count; i++) {
        normalArr[i * 3] = normalAttr.getX(i);
        normalArr[i * 3 + 1] = normalAttr.getY(i);
        normalArr[i * 3 + 2] = normalAttr.getZ(i);
      }
    }

    worker.postMessage({
      type: 'optimize',
      positionArray: posArr,
      normalArray: normalArr,
      triCount: positionArray.count / 3,
      preset,
    });
  });
}

/**
 * Find optimal orientation using brute-force over 26 candidates.
 * Returns a plain quaternion {x,y,z,w}.
 */
export function findOptimalOrientation(
  geometry: GeometryLike,
  preset: OrientPreset,
  customWeights?: CustomOrientWeights,
): Quat {
  let bestScore = -Infinity;
  let bestDir: Vec3 = { ...UP };

  for (const candidate of CANDIDATES) {
    const metrics = analyzeOrientation(geometry, candidate);
    const score = scoreOrientation(metrics, preset, customWeights);
    if (score > bestScore) {
      bestScore = score;
      bestDir = { ...candidate };
    }
  }

  return quatFromUnitVectors(bestDir, UP);
}

/** Get analysis metrics for the current orientation (up = Y). */
export function analyzeCurrentOrientation(geometry: GeometryLike): OrientationMetrics {
  return analyzeOrientation(geometry, UP);
}

/**
 * Find significant (large flat) faces on the model.
 */
export function findSignificantFaces(geometry: GeometryLike, minArea = 10): SignificantFace[] {
  const pos = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const triCount = pos.count / 3;

  const faceGroups = new Map<
    string,
    { normal: Vec3; triangles: { area: number; centroid: Vec3 }[] }
  >();

  for (let i = 0; i < triCount; i++) {
    const idx = i * 3;
    const a: Vec3 = { x: pos.getX(idx), y: pos.getY(idx), z: pos.getZ(idx) };
    const b: Vec3 = { x: pos.getX(idx + 1), y: pos.getY(idx + 1), z: pos.getZ(idx + 1) };
    const c: Vec3 = { x: pos.getX(idx + 2), y: pos.getY(idx + 2), z: pos.getZ(idx + 2) };

    let faceNormal: Vec3;
    if (normal) {
      faceNormal = normalize({ x: normal.getX(idx), y: normal.getY(idx), z: normal.getZ(idx) });
    } else {
      const cr = cross(sub(b, a), sub(c, a));
      if (length(cr) < 1e-10) continue;
      faceNormal = normalize(cr);
    }

    const edge1 = sub(b, a);
    const edge2 = sub(c, a);
    const area = length(cross(edge1, edge2)) * 0.5;
    if (area < 0.001) continue;

    const centroid: Vec3 = {
      x: (a.x + b.x + c.x) / 3,
      y: (a.y + b.y + c.y) / 3,
      z: (a.z + b.z + c.z) / 3,
    };

    const nx = Math.round(faceNormal.x * 10) / 10;
    const ny = Math.round(faceNormal.y * 10) / 10;
    const nz = Math.round(faceNormal.z * 10) / 10;
    const key = `${nx},${ny},${nz}`;

    if (!faceGroups.has(key)) {
      faceGroups.set(key, { normal: faceNormal, triangles: [] });
    }
    const faceGroup = faceGroups.get(key);
    if (faceGroup) faceGroup.triangles.push({ area, centroid });
  }

  const significantFaces: SignificantFace[] = [];

  for (const [, group] of faceGroups) {
    const totalArea = group.triangles.reduce((sum, t) => sum + t.area, 0);
    if (totalArea < minArea) continue;

    const weightedCentroid: Vec3 = { x: 0, y: 0, z: 0 };
    for (const t of group.triangles) {
      weightedCentroid.x += t.centroid.x * t.area;
      weightedCentroid.y += t.centroid.y * t.area;
      weightedCentroid.z += t.centroid.z * t.area;
    }
    weightedCentroid.x /= totalArea;
    weightedCentroid.y /= totalArea;
    weightedCentroid.z /= totalArea;

    let maxDeviation = 0;
    for (const t of group.triangles) {
      const dist = length(sub(weightedCentroid, t.centroid));
      maxDeviation = Math.max(maxDeviation, dist * 0.1);
    }

    if (maxDeviation < 2) {
      significantFaces.push({
        normal: { ...group.normal },
        area: totalArea,
        centroid: weightedCentroid,
        triangleCount: group.triangles.length,
      });
    }
  }

  significantFaces.sort((a, b) => b.area - a.area);
  return significantFaces.slice(0, 6);
}
