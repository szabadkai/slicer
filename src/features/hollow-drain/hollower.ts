import * as THREE from 'three';

export interface HollowResult {
  hollowGeo: THREE.BufferGeometry;    // outer + inner merged — replaces mesh.geometry
  wallThickness: number;
}

export interface ThinWallWarning {
  hasThinWalls: boolean;
  minThickness: number;               // mm, sampled estimate
}

/**
 * Estimate smart default wall thickness from geometry bounding box.
 * Formula: max(1.5, cbrt(bbox_volume) * 0.04), clamped to [1.5, 6].
 */
export function estimateWallThickness(geometry: THREE.BufferGeometry): number {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const size = new THREE.Vector3();
  bb.getSize(size);
  const bboxVol = size.x * size.y * size.z;
  return Math.min(6, Math.max(1.5, Math.cbrt(bboxVol) * 0.04));
}

/**
 * Hollow a closed mesh by creating an inward-offset inner shell.
 *
 * Algorithm:
 * 1. Convert to non-indexed geometry
 * 2. Compute per-vertex normals, then smooth them by averaging across
 *    coincident positions (spatial hash key = round(x*1000),round(y*1000),round(z*1000))
 * 3. Offset each vertex inward by wallThickness along its smoothed normal
 * 4. Flip inner shell winding (swap v1↔v2 per triangle)
 * 5. Manually merge outer + inner-flipped into one BufferGeometry
 *    by concatenating position arrays and recomputing normals
 *
 * The resulting mesh slices correctly with the stencil-buffer slicer:
 * outer front faces increment stencil, inner (flipped) back faces
 * decrement it — hollow interior stays stencil=0.
 */
export function hollowMesh(
  geometry: THREE.BufferGeometry,
  wallThickness: number,
): HollowResult {
  // Work on a non-indexed copy
  const geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  geo.computeVertexNormals();

  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const normAttr = geo.attributes.normal as THREE.BufferAttribute;
  const vertCount = posAttr.count;

  // --- Step 1: smooth normals at shared positions ---
  // Map: "rx,ry,rz" -> accumulated normal
  const normMap = new Map<string, { nx: number; ny: number; nz: number; indices: number[] }>();
  const P = 1000;
  for (let i = 0; i < vertCount; i++) {
    const key = `${Math.round(posAttr.getX(i) * P)},${Math.round(posAttr.getY(i) * P)},${Math.round(posAttr.getZ(i) * P)}`;
    const entry = normMap.get(key);
    if (entry) {
      entry.nx += normAttr.getX(i);
      entry.ny += normAttr.getY(i);
      entry.nz += normAttr.getZ(i);
      entry.indices.push(i);
    } else {
      normMap.set(key, { nx: normAttr.getX(i), ny: normAttr.getY(i), nz: normAttr.getZ(i), indices: [i] });
    }
  }

  const smoothNx = new Float32Array(vertCount);
  const smoothNy = new Float32Array(vertCount);
  const smoothNz = new Float32Array(vertCount);
  for (const e of normMap.values()) {
    const len = Math.sqrt(e.nx * e.nx + e.ny * e.ny + e.nz * e.nz) || 1;
    const nx = e.nx / len; const ny = e.ny / len; const nz = e.nz / len;
    for (const i of e.indices) { smoothNx[i] = nx; smoothNy[i] = ny; smoothNz[i] = nz; }
  }

  // --- Step 2: build inner shell positions (offset inward) ---
  const innerPos = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    innerPos[i * 3]     = posAttr.getX(i) - smoothNx[i] * wallThickness;
    innerPos[i * 3 + 1] = posAttr.getY(i) - smoothNy[i] * wallThickness;
    innerPos[i * 3 + 2] = posAttr.getZ(i) - smoothNz[i] * wallThickness;
  }

  // --- Step 3: flip winding of inner shell (swap v1 <-> v2 per triangle) ---
  const innerPosFlipped = new Float32Array(innerPos.length);
  const triCount = vertCount / 3;
  for (let t = 0; t < triCount; t++) {
    const v0 = t * 3, v1 = t * 3 + 1, v2 = t * 3 + 2;
    // v0 unchanged
    innerPosFlipped[v0 * 3]     = innerPos[v0 * 3];
    innerPosFlipped[v0 * 3 + 1] = innerPos[v0 * 3 + 1];
    innerPosFlipped[v0 * 3 + 2] = innerPos[v0 * 3 + 2];
    // v1 gets v2's position
    innerPosFlipped[v1 * 3]     = innerPos[v2 * 3];
    innerPosFlipped[v1 * 3 + 1] = innerPos[v2 * 3 + 1];
    innerPosFlipped[v1 * 3 + 2] = innerPos[v2 * 3 + 2];
    // v2 gets v1's position
    innerPosFlipped[v2 * 3]     = innerPos[v1 * 3];
    innerPosFlipped[v2 * 3 + 1] = innerPos[v1 * 3 + 1];
    innerPosFlipped[v2 * 3 + 2] = innerPos[v1 * 3 + 2];
  }

  // --- Step 4: merge outer + inner-flipped ---
  const outerPos = posAttr.array as Float32Array;
  const merged = new Float32Array(outerPos.length + innerPosFlipped.length);
  merged.set(outerPos, 0);
  merged.set(innerPosFlipped, outerPos.length);

  const hollowGeo = new THREE.BufferGeometry();
  hollowGeo.setAttribute('position', new THREE.BufferAttribute(merged, 3));
  hollowGeo.computeVertexNormals();

  return { hollowGeo, wallThickness };
}

/**
 * Lightweight thin-wall check: samples 80 surface points, casts rays inward
 * along vertex normals and measures the distance to the inner surface.
 * Returns whether any sampled wall thickness < wallThickness * 0.7.
 */
export function checkThinWalls(
  outerGeo: THREE.BufferGeometry,
  wallThickness: number,
): ThinWallWarning {
  const geo = outerGeo.index ? outerGeo.toNonIndexed() : outerGeo;
  geo.computeVertexNormals();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const norm = geo.attributes.normal as THREE.BufferAttribute;
  const total = pos.count;
  const SAMPLES = Math.min(80, total);
  const step = Math.max(1, Math.floor(total / SAMPLES));
  let minThickness = Infinity;

  const ray = new THREE.Raycaster();
  const tempMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.BackSide }));
  (tempMesh.geometry as unknown as { computeBoundsTree?: () => void }).computeBoundsTree?.();

  for (let i = 0; i < total; i += step) {
    const origin = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const dir = new THREE.Vector3(-norm.getX(i), -norm.getY(i), -norm.getZ(i)).normalize();
    ray.set(origin, dir);
    ray.near = 0.01;
    ray.far = wallThickness * 3;
    const hits = ray.intersectObject(tempMesh);
    if (hits.length > 0) {
      minThickness = Math.min(minThickness, hits[0].distance);
    }
  }

  (tempMesh.geometry as unknown as { disposeBoundsTree?: () => void }).disposeBoundsTree?.();

  return {
    hasThinWalls: minThickness < wallThickness * 0.7,
    minThickness: minThickness === Infinity ? wallThickness : minThickness,
  };
}
