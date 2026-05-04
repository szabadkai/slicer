// eslint-disable-next-line no-restricted-imports -- trap detection requires direct THREE geometry access
import * as THREE from 'three';
import type { DrainHole } from './drain';

export interface TrapPocket {
  center: THREE.Vector3;
  volumeMM3: number;
  suggestedHolePos: THREE.Vector3; // highest point of the pocket (where a hole would help)
  suggestedHoleNormal: THREE.Vector3;
}

export interface TrapResult {
  trappedVolumeMM3: number;
  drainableVolumeMM3: number;
  totalInteriorMM3: number;
  pockets: TrapPocket[];
}

/**
 * Detect resin traps inside a hollow mesh using a voxel flood-fill.
 *
 * Algorithm:
 * 1. Build a voxel grid covering the mesh bounding box
 * 2. For each voxel, use ray-parity testing (cast ray upward, count intersections)
 *    to classify as INTERIOR or EXTERIOR
 * 3. Flood-fill from drain hole voxel positions → REACHABLE interior
 * 4. Unreachable interior voxels form trapped pockets
 * 5. Find connected components → each is a TrapPocket
 */
export function detectTraps(
  geometry: THREE.BufferGeometry,
  modelMesh: THREE.Mesh,
  drainHoles: DrainHole[],
  options: { voxelSizeMM?: number; onProgress?: (f: number) => void } = {},
): TrapResult {
  const voxelSize = options.voxelSizeMM ?? 2.0;
  const onProgress = options.onProgress ?? (() => {});

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox ?? new THREE.Box3();
  const pad = voxelSize;
  const minX = bb.min.x - pad,
    minY = bb.min.y - pad,
    minZ = bb.min.z - pad;
  const nx = Math.ceil((bb.max.x - bb.min.x + 2 * pad) / voxelSize) + 1;
  const ny = Math.ceil((bb.max.y - bb.min.y + 2 * pad) / voxelSize) + 1;
  const nz = Math.ceil((bb.max.z - bb.min.z + 2 * pad) / voxelSize) + 1;

  const INTERIOR = 1,
    REACHABLE = 2;
  const grid = new Uint8Array(nx * ny * nz); // default = 0 (EXTERIOR)

  function idx(xi: number, yi: number, zi: number): number {
    return xi + yi * nx + zi * nx * ny;
  }
  function voxelCenter(xi: number, yi: number, zi: number): THREE.Vector3 {
    return new THREE.Vector3(
      minX + (xi + 0.5) * voxelSize,
      minY + (yi + 0.5) * voxelSize,
      minZ + (zi + 0.5) * voxelSize,
    );
  }

  // Step 1: classify voxels using ray-parity (cast ray in +Y direction)
  const raycaster = new THREE.Raycaster();
  raycaster.near = 0;

  for (let xi = 0; xi < nx; xi++) {
    for (let zi = 0; zi < nz; zi++) {
      for (let yi = 0; yi < ny; yi++) {
        const center = voxelCenter(xi, yi, zi);
        raycaster.set(center, new THREE.Vector3(0, 1, 0));
        raycaster.far = bb.max.y - center.y + 1;
        const hits = raycaster.intersectObject(modelMesh);
        if (hits.length % 2 === 1) {
          // Odd intersections above → inside the mesh
          grid[idx(xi, yi, zi)] = INTERIOR;
        }
      }
    }
    onProgress((xi / nx) * 0.6);
  }

  // Step 2: seed flood-fill from drain hole positions
  const queue: number[] = [];
  for (const hole of drainHoles) {
    const xi = Math.floor((hole.position.x - minX) / voxelSize);
    const yi = Math.floor((hole.position.y - minY) / voxelSize);
    const zi = Math.floor((hole.position.z - minZ) / voxelSize);
    if (xi >= 0 && xi < nx && yi >= 0 && yi < ny && zi >= 0 && zi < nz) {
      const i = idx(xi, yi, zi);
      if (grid[i] === INTERIOR) {
        grid[i] = REACHABLE;
        queue.push(i);
      }
    }
  }

  // BFS flood fill through interior voxels
  const dx = [1, -1, 0, 0, 0, 0];
  const dy = [0, 0, 1, -1, 0, 0];
  const dz = [0, 0, 0, 0, 1, -1];
  while (queue.length > 0) {
    const cur = queue.shift() as number;
    const zi = Math.floor(cur / (nx * ny));
    const yi = Math.floor((cur % (nx * ny)) / nx);
    const xi = cur % nx;
    for (let d = 0; d < 6; d++) {
      const nx2 = xi + dx[d],
        ny2 = yi + dy[d],
        nz2 = zi + dz[d];
      if (nx2 < 0 || nx2 >= nx || ny2 < 0 || ny2 >= ny || nz2 < 0 || nz2 >= nz) continue;
      const ni = idx(nx2, ny2, nz2);
      if (grid[ni] === INTERIOR) {
        grid[ni] = REACHABLE;
        queue.push(ni);
      }
    }
  }
  onProgress(0.8);

  // Step 3: find connected components of INTERIOR (unreachable) voxels
  const visited = new Uint8Array(nx * ny * nz);
  const pockets: TrapPocket[] = [];

  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== INTERIOR || visited[i]) continue;
    // BFS this component
    const component: number[] = [];
    const q2 = [i];
    visited[i] = 1;
    while (q2.length > 0) {
      const cur2 = q2.shift() as number;
      component.push(cur2);
      const zi = Math.floor(cur2 / (nx * ny));
      const yi = Math.floor((cur2 % (nx * ny)) / nx);
      const xi = cur2 % nx;
      for (let d = 0; d < 6; d++) {
        const nx2 = xi + dx[d],
          ny2 = yi + dy[d],
          nz2 = zi + dz[d];
        if (nx2 < 0 || nx2 >= nx || ny2 < 0 || ny2 >= ny || nz2 < 0 || nz2 >= nz) continue;
        const ni = idx(nx2, ny2, nz2);
        if (grid[ni] === INTERIOR && !visited[ni]) {
          visited[ni] = 1;
          q2.push(ni);
        }
      }
    }
    // Compute pocket stats
    let sumX = 0,
      sumY = 0,
      sumZ = 0,
      maxY = -Infinity;
    let maxI = component[0];
    for (const ci of component) {
      const czi = Math.floor(ci / (nx * ny));
      const cyi = Math.floor((ci % (nx * ny)) / nx);
      const cxi = ci % nx;
      const center = voxelCenter(cxi, cyi, czi);
      sumX += center.x;
      sumY += center.y;
      sumZ += center.z;
      if (center.y > maxY) {
        maxY = center.y;
        maxI = ci;
      }
    }
    const n = component.length;
    const centerMass = new THREE.Vector3(sumX / n, sumY / n, sumZ / n);
    const maxZI = Math.floor(maxI / (nx * ny));
    const maxYI = Math.floor((maxI % (nx * ny)) / nx);
    const maxXI = maxI % nx;
    const topPos = voxelCenter(maxXI, maxYI, maxZI);

    pockets.push({
      center: centerMass,
      volumeMM3: n * voxelSize * voxelSize * voxelSize,
      suggestedHolePos: topPos,
      suggestedHoleNormal: new THREE.Vector3(0, 1, 0), // pointing up (drill from top)
    });
  }

  onProgress(1.0);

  // Tally volumes
  let reachable = 0,
    trapped = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === REACHABLE) reachable++;
    else if (grid[i] === INTERIOR) trapped++;
  }
  const v3 = voxelSize * voxelSize * voxelSize;

  return {
    trappedVolumeMM3: trapped * v3,
    drainableVolumeMM3: reachable * v3,
    totalInteriorMM3: (reachable + trapped) * v3,
    pockets,
  };
}

/**
 * Filter trap results to prioritize pockets near faces with 'trap-prevention' intent.
 * Returns pockets sorted by priority: intent-tagged pockets first, then by volume.
 */
export function prioritizePocketsByIntent(
  pockets: TrapPocket[],
  intentBuffer: Uint8Array | undefined,
  positions: Float32Array | undefined,
  triangleCount: number,
): TrapPocket[] {
  if (!intentBuffer || !positions || pockets.length === 0) {
    return [...pockets].sort((a, b) => b.volumeMM3 - a.volumeMM3);
  }

  // Find centroids of trap-prevention triangles
  const trapCentroids: Array<{ x: number; y: number; z: number }> = [];
  for (let tri = 0; tri < Math.min(intentBuffer.length, triangleCount); tri++) {
    // Intent id 4 = removal-sensitive (used as trap-prevention proxy)
    const intentId = intentBuffer[tri] & 0b111;
    if (intentId === 4) {
      const base = tri * 9;
      trapCentroids.push({
        x: (positions[base] + positions[base + 3] + positions[base + 6]) / 3,
        y: (positions[base + 1] + positions[base + 4] + positions[base + 7]) / 3,
        z: (positions[base + 2] + positions[base + 5] + positions[base + 8]) / 3,
      });
    }
  }

  if (trapCentroids.length === 0) {
    return [...pockets].sort((a, b) => b.volumeMM3 - a.volumeMM3);
  }

  // Score pockets by proximity to trap-prevention faces
  const scored = pockets.map((pocket) => {
    let minDist = Infinity;
    for (const c of trapCentroids) {
      const dx = pocket.center.x - c.x;
      const dy = pocket.center.y - c.y;
      const dz = pocket.center.z - c.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < minDist) minDist = dist;
    }
    // Pockets near intent-tagged faces get priority
    const priority = minDist < 10 ? 0 : 1;
    return { pocket, priority, volume: pocket.volumeMM3 };
  });

  scored.sort((a, b) => a.priority - b.priority || b.volume - a.volume);
  return scored.map((s) => s.pocket);
}
