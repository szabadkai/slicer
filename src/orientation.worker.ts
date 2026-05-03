/**
 * Orientation optimization worker — genetic algorithm.
 * Pure math, no THREE.js dependency.
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

// --- Vector math ---

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function len3(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function norm3(v: Vec3): Vec3 {
  const l = len3(v);
  return l > 0 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 0 };
}

// sub3 removed — currently unused but available if needed for future orientation calculations

// --- Quaternion math ---

function quatIdentity(): Quat {
  return { x: 0, y: 0, z: 0, w: 1 };
}

function quatFromUnitVectors(from: Vec3, to: Vec3): Quat {
  const d = dot3(from, to);
  if (d >= 1.0) return quatIdentity();
  if (d <= -1.0) {
    let perp = cross3(from, { x: 1, y: 0, z: 0 });
    if (len3(perp) < 1e-6) perp = cross3(from, { x: 0, y: 1, z: 0 });
    perp = norm3(perp);
    return { x: perp.x, y: perp.y, z: perp.z, w: 0 };
  }
  const c = cross3(from, to);
  const w = 1 + d;
  const l = Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z + w * w);
  return { x: c.x / l, y: c.y / l, z: c.z / l, w: w / l };
}

function quatInvert(q: Quat): Quat {
  const d = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
  return { x: -q.x / d, y: -q.y / d, z: -q.z / d, w: q.w / d };
}

function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function quatNormalize(q: Quat): Quat {
  const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const half = angle / 2;
  const s = Math.sin(half);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
}

function quatApplyToVec3(q: Quat, v: Vec3): Vec3 {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  let cosHalf = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cosHalf < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; cosHalf = -cosHalf; }
  if (cosHalf >= 1.0) return { ...a };
  const half = Math.acos(cosHalf);
  const sinHalf = Math.sqrt(1 - cosHalf * cosHalf);
  if (Math.abs(sinHalf) < 0.001) {
    return {
      x: a.x * 0.5 + bx * 0.5,
      y: a.y * 0.5 + by * 0.5,
      z: a.z * 0.5 + bz * 0.5,
      w: a.w * 0.5 + bw * 0.5,
    };
  }
  const ra = Math.sin((1 - t) * half) / sinHalf;
  const rb = Math.sin(t * half) / sinHalf;
  return {
    x: a.x * ra + bx * rb,
    y: a.y * ra + by * rb,
    z: a.z * ra + bz * rb,
    w: a.w * ra + bw * rb,
  };
}

// --- Constants ---

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const DEG30_COS = Math.cos((30 * Math.PI) / 180);

function generateCandidates(): Quat[] {
  const dirs: Quat[] = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        const dir = norm3({ x, y, z });
        dirs.push(quatFromUnitVectors(UP, dir));
      }
    }
  }
  return dirs;
}

const BASE_CANDIDATES = generateCandidates();

function randomRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomOrientation(): Quat {
  const u1 = Math.random();
  const u2 = Math.random();
  const u3 = Math.random();
  const sqrt1u1 = Math.sqrt(1 - u1);
  const sqrtu1 = Math.sqrt(u1);
  return {
    x: sqrt1u1 * Math.sin(2.0 * Math.PI * u2),
    y: sqrt1u1 * Math.cos(2.0 * Math.PI * u2),
    z: sqrtu1 * Math.sin(2.0 * Math.PI * u3),
    w: sqrtu1 * Math.cos(2.0 * Math.PI * u3),
  };
}

// --- Fitness ---

interface FitnessResult {
  overhangArea: number;
  totalHeight: number;
  staircaseMetric: number;
  flatBottomArea: number;
}

function evaluateFitness(
  posArr: Float32Array,
  normArr: Float32Array | null,
  triCount: number,
  q: Quat,
  overhangThreshold: number,
): FitnessResult {
  const invQ = quatInvert(q);
  const localUp = quatApplyToVec3(invQ, UP);

  let overhangArea = 0;
  let staircaseMetric = 0;
  let flatBottomArea = 0;

  let minProj = Infinity;
  let maxProj = -Infinity;
  for (let i = 0; i < posArr.length; i += 3) {
    const proj = posArr[i] * localUp.x + posArr[i + 1] * localUp.y + posArr[i + 2] * localUp.z;
    if (proj < minProj) minProj = proj;
    if (proj > maxProj) maxProj = proj;
  }
  const totalHeight = maxProj - minProj;

  for (let i = 0; i < triCount; i++) {
    const idx = i * 9;
    const ax = posArr[idx], ay = posArr[idx + 1], az = posArr[idx + 2];
    const bx = posArr[idx + 3], by = posArr[idx + 4], bz = posArr[idx + 5];
    const cx = posArr[idx + 6], cy = posArr[idx + 7], cz = posArr[idx + 8];

    let nx: number, ny: number, nz: number;
    if (normArr) {
      nx = normArr[idx]; ny = normArr[idx + 1]; nz = normArr[idx + 2];
    } else {
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      nx = e1y * e2z - e1z * e2y;
      ny = e1z * e2x - e1x * e2z;
      nz = e1x * e2y - e1y * e2x;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl > 0) { nx /= nl; ny /= nl; nz /= nl; }
    }

    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const crx = e1y * e2z - e1z * e2y;
    const cry = e1z * e2x - e1x * e2z;
    const crz = e1x * e2y - e1y * e2x;
    const area = Math.sqrt(crx * crx + cry * cry + crz * crz) * 0.5;

    const d = nx * localUp.x + ny * localUp.y + nz * localUp.z;

    if (d < -overhangThreshold) {
      const mx = (ax + bx + cx) / 3;
      const my = (ay + by + cy) / 3;
      const mz = (az + bz + cz) / 3;
      const heightFromBottom = mx * localUp.x + my * localUp.y + mz * localUp.z - minProj;
      overhangArea += area * heightFromBottom * Math.abs(d);
    }

    if (d < -0.99) flatBottomArea += area;

    const absDot = Math.abs(d);
    if (absDot > 0.1 && absDot < 0.5) {
      staircaseMetric += area * (0.5 - absDot);
    }
  }

  return { overhangArea, totalHeight, staircaseMetric, flatBottomArea };
}

function calculateScore(metrics: FitnessResult, preset: string): number {
  const { overhangArea, totalHeight, staircaseMetric, flatBottomArea } = metrics;
  switch (preset) {
    case 'fastest':
      return -(totalHeight * 1000) - overhangArea + flatBottomArea * 10;
    case 'least-support':
      return -(overhangArea * 1000) - totalHeight + flatBottomArea * 500;
    case 'best-quality':
      return -(overhangArea * 500) - staircaseMetric * 5000 - totalHeight + flatBottomArea * 500;
    default:
      return -overhangArea;
  }
}

// --- GA ---

interface Individual {
  q: Quat;
  score: number;
}

function runGA(
  posArr: Float32Array,
  normArr: Float32Array | null,
  triCount: number,
  preset: string,
  popSize: number,
  generations: number,
): Quat {
  const overhangThreshold = DEG30_COS;

  postMessage({ type: 'progress', progress: 0.05, message: 'Evaluating base orientations...' });

  let bestBase: Individual = { q: quatIdentity(), score: -Infinity };
  for (const baseQ of BASE_CANDIDATES) {
    const metrics = evaluateFitness(posArr, normArr, triCount, baseQ, overhangThreshold);
    const score = calculateScore(metrics, preset);
    if (score > bestBase.score) bestBase = { q: { ...baseQ }, score };
  }

  let population: Individual[] = [bestBase, { q: quatIdentity(), score: -Infinity }];
  while (population.length < popSize) {
    population.push({ q: randomOrientation(), score: -Infinity });
  }

  let globalBest = -Infinity;
  let staleGens = 0;
  const PATIENCE = 5;

  for (let gen = 0; gen < generations; gen++) {
    for (const ind of population) {
      if (ind.score === -Infinity) {
        const m = evaluateFitness(posArr, normArr, triCount, ind.q, overhangThreshold);
        ind.score = calculateScore(m, preset);
      }
    }

    population.sort((a, b) => b.score - a.score);

    if (population[0].score > globalBest + 0.001) {
      globalBest = population[0].score;
      staleGens = 0;
    } else {
      staleGens++;
    }

    postMessage({
      type: 'progress',
      progress: (gen + 1) / generations,
      message: `GA Generation ${gen + 1}/${generations}`,
    });

    if (staleGens >= PATIENCE) {
      postMessage({ type: 'progress', progress: 1.0, message: `Early stopping at gen ${gen + 1}` });
      break;
    }

    const eliteCount = Math.max(2, Math.floor(popSize * 0.1));
    const next: Individual[] = population.slice(0, eliteCount);

    const selectParent = (): Individual => {
      let best = population[Math.floor(Math.random() * popSize)];
      for (let i = 1; i < 3; i++) {
        const c = population[Math.floor(Math.random() * popSize)];
        if (c.score > best.score) best = c;
      }
      return best;
    };

    while (next.length < popSize) {
      const pA = selectParent();
      let pB = selectParent();
      let attempts = 0;
      while (pA === pB && popSize > 1 && attempts++ < 10) pB = selectParent();

      let childQ = quatSlerp(pA.q, pB.q, Math.random());

      if (Math.random() < 0.2) {
        const axis = norm3({ x: randomRange(-1, 1), y: randomRange(-1, 1), z: randomRange(-1, 1) });
        const angle = randomRange(-0.26, 0.26);
        childQ = quatNormalize(quatMultiply(childQ, quatFromAxisAngle(axis, angle)));
      }

      next.push({ q: childQ, score: -Infinity });
    }

    population = next;
  }

  for (const ind of population) {
    if (ind.score === -Infinity) {
      const m = evaluateFitness(posArr, normArr, triCount, ind.q, overhangThreshold);
      ind.score = calculateScore(m, preset);
    }
  }
  population.sort((a, b) => b.score - a.score);

  const bestQ = population[0].q;
  const bestLocalUp = quatApplyToVec3(quatInvert(bestQ), UP);
  return quatFromUnitVectors(bestLocalUp, UP);
}

// --- Worker message handler ---

onmessage = function (e: MessageEvent): void {
  const { type } = e.data as { type: string };
  if (type === 'optimize') {
    const { positionArray, normalArray, preset, triCount } = e.data as {
      positionArray: Float32Array;
      normalArray: Float32Array | null;
      preset: string;
      triCount: number;
    };

    postMessage({ type: 'progress', progress: 0, message: 'Initializing GA...' });

    const bestQ = runGA(positionArray, normalArray, triCount, preset, 50, 20);

    postMessage({
      type: 'complete',
      quaternion: [bestQ.x, bestQ.y, bestQ.z, bestQ.w],
    });
  }
};
