// ─── Mesh repair pipeline ──────────────────────────────────
// Pure functions operating on raw Float32Array geometry.
// Does NOT import THREE.js.

import type { MeshData } from './detect';

export interface RepairOptions {
  weldTolerance: number;
  removeDegenerate: boolean;
  fixWinding: boolean;
}

export const DEFAULT_REPAIR_OPTIONS: RepairOptions = {
  weldTolerance: 0.001,
  removeDegenerate: true,
  fixWinding: true,
};

export interface RepairResult {
  positions: Float32Array;
  normals: Float32Array;
  triangleCount: number;
  removedTriangles: number;
  fixedNormals: number;
}

/**
 * Run the full repair pipeline on raw mesh data.
 * Returns new buffers — does not mutate input.
 */
export function repairMesh(mesh: MeshData, options?: Partial<RepairOptions>): RepairResult {
  const opts: RepairOptions = { ...DEFAULT_REPAIR_OPTIONS, ...options };
  let positions: Float32Array = new Float32Array(mesh.positions);
  let triangleCount = mesh.triangleCount;
  let removedTriangles = 0;
  let fixedNormals = 0;

  // Step 1: Weld near-duplicate vertices
  positions = weldVertices(positions, triangleCount, opts.weldTolerance) as Float32Array;

  // Step 2: Remove degenerate triangles
  if (opts.removeDegenerate) {
    const result = removeDegenerateTriangles(positions, triangleCount);
    positions = result.positions as Float32Array;
    removedTriangles = triangleCount - result.triangleCount;
    triangleCount = result.triangleCount;
  }

  // Step 3: Fix winding / recompute normals
  const normals = new Float32Array(triangleCount * 9);
  if (opts.fixWinding) {
    fixedNormals = recomputeNormals(positions, normals, triangleCount);
  } else {
    recomputeNormals(positions, normals, triangleCount);
  }

  return {
    positions,
    normals,
    triangleCount,
    removedTriangles,
    fixedNormals,
  };
}

// ─── Weld vertices ─────────────────────────────────────────

function weldVertices(
  positions: Float32Array,
  triangleCount: number,
  tolerance: number,
): Float32Array {
  const scale = 1 / tolerance;
  const canonMap = new Map<string, number[]>();

  // Build a position → canonical-index lookup
  const vertexCount = triangleCount * 3;
  for (let i = 0; i < vertexCount; i++) {
    const base = i * 3;
    const key = `${Math.round(positions[base] * scale)},${Math.round(positions[base + 1] * scale)},${Math.round(positions[base + 2] * scale)}`;
    const bucket = canonMap.get(key);
    if (bucket) {
      bucket.push(i);
    } else {
      canonMap.set(key, [i]);
    }
  }

  // Snap all vertices in same bucket to same position (average)
  const result = new Float32Array(positions.length);
  for (const indices of canonMap.values()) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const idx of indices) {
      const base = idx * 3;
      sx += positions[base];
      sy += positions[base + 1];
      sz += positions[base + 2];
    }
    const n = indices.length;
    const ax = sx / n;
    const ay = sy / n;
    const az = sz / n;
    for (const idx of indices) {
      const base = idx * 3;
      result[base] = ax;
      result[base + 1] = ay;
      result[base + 2] = az;
    }
  }

  return result;
}

// ─── Remove degenerate triangles ───────────────────────────

interface FilterResult {
  positions: Float32Array;
  triangleCount: number;
}

function removeDegenerateTriangles(
  positions: Float32Array,
  triangleCount: number,
): FilterResult {
  const AREA_THRESHOLD = 1e-10;
  const validTriangles: number[] = [];

  for (let tri = 0; tri < triangleCount; tri++) {
    const base = tri * 9;
    const ax = positions[base + 3] - positions[base];
    const ay = positions[base + 4] - positions[base + 1];
    const az = positions[base + 5] - positions[base + 2];
    const bx = positions[base + 6] - positions[base];
    const by = positions[base + 7] - positions[base + 1];
    const bz = positions[base + 8] - positions[base + 2];

    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const areaSq = cx * cx + cy * cy + cz * cz;

    if (areaSq >= AREA_THRESHOLD) {
      validTriangles.push(tri);
    }
  }

  const newPositions = new Float32Array(validTriangles.length * 9);
  for (let i = 0; i < validTriangles.length; i++) {
    const srcBase = validTriangles[i] * 9;
    const dstBase = i * 9;
    for (let j = 0; j < 9; j++) {
      newPositions[dstBase + j] = positions[srcBase + j];
    }
  }

  return { positions: newPositions, triangleCount: validTriangles.length };
}

// ─── Recompute normals (outward-consistent) ────────────────

function recomputeNormals(
  positions: Float32Array,
  normals: Float32Array,
  triangleCount: number,
): number {
  let fixedCount = 0;

  for (let tri = 0; tri < triangleCount; tri++) {
    const base = tri * 9;
    const ax = positions[base + 3] - positions[base];
    const ay = positions[base + 4] - positions[base + 1];
    const az = positions[base + 5] - positions[base + 2];
    const bx = positions[base + 6] - positions[base];
    const by = positions[base + 7] - positions[base + 1];
    const bz = positions[base + 8] - positions[base + 2];

    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }

    // Use centroid-pointing-outward heuristic for consistent winding:
    // If normal dot centroid is negative, flip it.
    const cx = (positions[base] + positions[base + 3] + positions[base + 6]) / 3;
    const cy = (positions[base + 1] + positions[base + 4] + positions[base + 7]) / 3;
    const cz = (positions[base + 2] + positions[base + 5] + positions[base + 8]) / 3;
    const dot = nx * cx + ny * cy + nz * cz;
    if (dot < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
      fixedCount++;
    }

    // Assign same normal to all 3 vertices of this face
    const nBase = tri * 9;
    normals[nBase] = nx;
    normals[nBase + 1] = ny;
    normals[nBase + 2] = nz;
    normals[nBase + 3] = nx;
    normals[nBase + 4] = ny;
    normals[nBase + 5] = nz;
    normals[nBase + 6] = nx;
    normals[nBase + 7] = ny;
    normals[nBase + 8] = nz;
  }

  return fixedCount;
}
