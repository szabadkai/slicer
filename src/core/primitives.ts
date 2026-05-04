/**
 * Pure geometry generators for primitive shapes.
 * Returns raw Float32Array positions (non-indexed, 3 floats per vertex, 9 per triangle).
 * No THREE.js dependency — reusable by paint/intent features for volume selection.
 */

// ─── Types ─────────────────────────────────────────────────

export type PrimitiveType = 'box' | 'sphere' | 'cylinder' | 'cone';

export interface BoxParams {
  type: 'box';
  width: number;
  height: number;
  depth: number;
}

export interface SphereParams {
  type: 'sphere';
  radius: number;
  segments: number;
}

export interface CylinderParams {
  type: 'cylinder';
  radiusTop: number;
  radiusBottom: number;
  height: number;
  segments: number;
}

export interface ConeParams {
  type: 'cone';
  radius: number;
  height: number;
  segments: number;
}

export type PrimitiveParams = BoxParams | SphereParams | CylinderParams | ConeParams;

export interface PrimitiveTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

// ─── Defaults ──────────────────────────────────────────────

export function defaultParams(type: PrimitiveType): PrimitiveParams {
  switch (type) {
    case 'box':
      return { type: 'box', width: 10, height: 10, depth: 10 };
    case 'sphere':
      return { type: 'sphere', radius: 5, segments: 24 };
    case 'cylinder':
      return { type: 'cylinder', radiusTop: 5, radiusBottom: 5, height: 10, segments: 24 };
    case 'cone':
      return { type: 'cone', radius: 5, height: 10, segments: 24 };
  }
}

export function identityTransform(): PrimitiveTransform {
  return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

// ─── Box ───────────────────────────────────────────────────

export function createBoxPositions(width: number, height: number, depth: number): Float32Array {
  const hw = width / 2;
  const hh = height / 2;
  const hd = depth / 2;

  // 6 faces × 2 triangles × 3 vertices × 3 floats
  const positions = new Float32Array(108);
  let i = 0;

  function tri(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
  ): void {
    positions[i++] = ax;
    positions[i++] = ay;
    positions[i++] = az;
    positions[i++] = bx;
    positions[i++] = by;
    positions[i++] = bz;
    positions[i++] = cx;
    positions[i++] = cy;
    positions[i++] = cz;
  }

  // +Z face
  tri(-hw, -hh, hd, hw, -hh, hd, hw, hh, hd);
  tri(-hw, -hh, hd, hw, hh, hd, -hw, hh, hd);
  // -Z face
  tri(hw, -hh, -hd, -hw, -hh, -hd, -hw, hh, -hd);
  tri(hw, -hh, -hd, -hw, hh, -hd, hw, hh, -hd);
  // +X face
  tri(hw, -hh, hd, hw, -hh, -hd, hw, hh, -hd);
  tri(hw, -hh, hd, hw, hh, -hd, hw, hh, hd);
  // -X face
  tri(-hw, -hh, -hd, -hw, -hh, hd, -hw, hh, hd);
  tri(-hw, -hh, -hd, -hw, hh, hd, -hw, hh, -hd);
  // +Y face
  tri(-hw, hh, hd, hw, hh, hd, hw, hh, -hd);
  tri(-hw, hh, hd, hw, hh, -hd, -hw, hh, -hd);
  // -Y face
  tri(-hw, -hh, -hd, hw, -hh, -hd, hw, -hh, hd);
  tri(-hw, -hh, -hd, hw, -hh, hd, -hw, -hh, hd);

  return positions;
}

// ─── Sphere ────────────────────────────────────────────────

export function createSpherePositions(radius: number, segments: number): Float32Array {
  const rings = Math.max(segments, 4);
  const slices = rings * 2;
  const triangles: number[] = [];

  for (let ring = 0; ring < rings; ring++) {
    const theta0 = (Math.PI * ring) / rings;
    const theta1 = (Math.PI * (ring + 1)) / rings;
    const sinT0 = Math.sin(theta0);
    const cosT0 = Math.cos(theta0);
    const sinT1 = Math.sin(theta1);
    const cosT1 = Math.cos(theta1);

    for (let slice = 0; slice < slices; slice++) {
      const phi0 = (2 * Math.PI * slice) / slices;
      const phi1 = (2 * Math.PI * (slice + 1)) / slices;
      const sinP0 = Math.sin(phi0);
      const cosP0 = Math.cos(phi0);
      const sinP1 = Math.sin(phi1);
      const cosP1 = Math.cos(phi1);

      const x00 = radius * sinT0 * cosP0;
      const y00 = radius * cosT0;
      const z00 = radius * sinT0 * sinP0;

      const x10 = radius * sinT1 * cosP0;
      const y10 = radius * cosT1;
      const z10 = radius * sinT1 * sinP0;

      const x01 = radius * sinT0 * cosP1;
      const y01 = radius * cosT0;
      const z01 = radius * sinT0 * sinP1;

      const x11 = radius * sinT1 * cosP1;
      const y11 = radius * cosT1;
      const z11 = radius * sinT1 * sinP1;

      if (ring !== 0) {
        triangles.push(x00, y00, z00, x10, y10, z10, x11, y11, z11);
      }
      if (ring !== rings - 1) {
        triangles.push(x00, y00, z00, x11, y11, z11, x01, y01, z01);
      }
    }
  }

  return new Float32Array(triangles);
}

// ─── Cylinder ──────────────────────────────────────────────

export function createCylinderPositions(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments: number,
): Float32Array {
  const segs = Math.max(segments, 3);
  const hh = height / 2;
  const triangles: number[] = [];

  for (let i = 0; i < segs; i++) {
    const a0 = (2 * Math.PI * i) / segs;
    const a1 = (2 * Math.PI * (i + 1)) / segs;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);

    // Side quad (2 triangles)
    const tx0 = radiusTop * c0,
      tz0 = radiusTop * s0;
    const tx1 = radiusTop * c1,
      tz1 = radiusTop * s1;
    const bx0 = radiusBottom * c0,
      bz0 = radiusBottom * s0;
    const bx1 = radiusBottom * c1,
      bz1 = radiusBottom * s1;

    triangles.push(tx0, hh, tz0, bx0, -hh, bz0, bx1, -hh, bz1);
    triangles.push(tx0, hh, tz0, bx1, -hh, bz1, tx1, hh, tz1);

    // Top cap
    if (radiusTop > 0) {
      triangles.push(0, hh, 0, tx0, hh, tz0, tx1, hh, tz1);
    }
    // Bottom cap
    if (radiusBottom > 0) {
      triangles.push(0, -hh, 0, bx1, -hh, bz1, bx0, -hh, bz0);
    }
  }

  return new Float32Array(triangles);
}

// ─── Cone ──────────────────────────────────────────────────

export function createConePositions(
  radius: number,
  height: number,
  segments: number,
): Float32Array {
  return createCylinderPositions(0, radius, height, segments);
}

// ─── Generate from params ──────────────────────────────────

export function createPositions(params: PrimitiveParams): Float32Array {
  switch (params.type) {
    case 'box':
      return createBoxPositions(params.width, params.height, params.depth);
    case 'sphere':
      return createSpherePositions(params.radius, params.segments);
    case 'cylinder':
      return createCylinderPositions(
        params.radiusTop,
        params.radiusBottom,
        params.height,
        params.segments,
      );
    case 'cone':
      return createConePositions(params.radius, params.height, params.segments);
  }
}

// ─── Transform application ─────────────────────────────────

/**
 * Applies position/rotation/scale transform to a flat positions array.
 * Rotation order: XYZ (Euler angles in radians).
 * Returns a new Float32Array with transformed positions.
 */
export function applyTransform(
  positions: Float32Array,
  transform: PrimitiveTransform,
): Float32Array {
  const [sx, sy, sz] = transform.scale;
  const [rx, ry, rz] = transform.rotation;
  const [tx, ty, tz] = transform.position;

  // Precompute rotation matrix (XYZ order)
  const cx = Math.cos(rx),
    sx_ = Math.sin(rx);
  const cy = Math.cos(ry),
    sy_ = Math.sin(ry);
  const cz = Math.cos(rz),
    sz_ = Math.sin(rz);

  const m00 = cy * cz;
  const m01 = -cy * sz_;
  const m02 = sy_;
  const m10 = sx_ * sy_ * cz + cx * sz_;
  const m11 = -sx_ * sy_ * sz_ + cx * cz;
  const m12 = -sx_ * cy;
  const m20 = -cx * sy_ * cz + sx_ * sz_;
  const m21 = cx * sy_ * sz_ + sx_ * cz;
  const m22 = cx * cy;

  const result = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] * sx;
    const y = positions[i + 1] * sy;
    const z = positions[i + 2] * sz;

    result[i] = m00 * x + m01 * y + m02 * z + tx;
    result[i + 1] = m10 * x + m11 * y + m12 * z + ty;
    result[i + 2] = m20 * x + m21 * y + m22 * z + tz;
  }

  return result;
}

// ─── Containment tests (for future paint/intent use) ───────

/**
 * Tests whether a point lies inside a primitive volume (in primitive local space).
 * The point should be in the same coordinate space as the primitive (pre-inverse-transform).
 */
export function containsPointLocal(
  params: PrimitiveParams,
  x: number,
  y: number,
  z: number,
): boolean {
  switch (params.type) {
    case 'box': {
      const hw = params.width / 2;
      const hh = params.height / 2;
      const hd = params.depth / 2;
      return Math.abs(x) <= hw && Math.abs(y) <= hh && Math.abs(z) <= hd;
    }
    case 'sphere':
      return x * x + y * y + z * z <= params.radius * params.radius;
    case 'cylinder': {
      const hh = params.height / 2;
      if (Math.abs(y) > hh) return false;
      const t = (y + hh) / params.height;
      const r = params.radiusBottom + t * (params.radiusTop - params.radiusBottom);
      return x * x + z * z <= r * r;
    }
    case 'cone': {
      const hh = params.height / 2;
      if (Math.abs(y) > hh) return false;
      const t = (y + hh) / params.height;
      const r = params.radius * (1 - t);
      return x * x + z * z <= r * r;
    }
  }
}

/**
 * Computes the inverse transform matrix and tests whether a world-space point
 * lies inside the primitive.
 */
export function containsPoint(
  params: PrimitiveParams,
  transform: PrimitiveTransform,
  px: number,
  py: number,
  pz: number,
): boolean {
  // Translate to primitive origin
  const dx = px - transform.position[0];
  const dy = py - transform.position[1];
  const dz = pz - transform.position[2];

  // Inverse rotation (transpose of rotation matrix, negated angles)
  const [rx, ry, rz] = transform.rotation;
  const cx = Math.cos(rx),
    sx_ = Math.sin(rx);
  const cy = Math.cos(ry),
    sy_ = Math.sin(ry);
  const cz = Math.cos(rz),
    sz_ = Math.sin(rz);

  // Transpose of XYZ rotation matrix = inverse
  const m00 = cy * cz;
  const m10 = -cy * sz_;
  const m20 = sy_;
  const m01 = sx_ * sy_ * cz + cx * sz_;
  const m11 = -sx_ * sy_ * sz_ + cx * cz;
  const m21 = -sx_ * cy;
  const m02 = -cx * sy_ * cz + sx_ * sz_;
  const m12 = cx * sy_ * sz_ + sx_ * cz;
  const m22 = cx * cy;

  const rx2 = m00 * dx + m01 * dy + m02 * dz;
  const ry2 = m10 * dx + m11 * dy + m12 * dz;
  const rz2 = m20 * dx + m21 * dy + m22 * dz;

  // Inverse scale
  const lx = rx2 / transform.scale[0];
  const ly = ry2 / transform.scale[1];
  const lz = rz2 / transform.scale[2];

  return containsPointLocal(params, lx, ly, lz);
}

/**
 * Returns indices of triangles whose centroids lie inside the primitive volume.
 * Positions is a flat Float32Array (non-indexed), 9 floats per triangle.
 */
export function trianglesInsidePrimitive(
  positions: Float32Array,
  params: PrimitiveParams,
  transform: PrimitiveTransform,
): number[] {
  const indices: number[] = [];
  const triCount = positions.length / 9;

  for (let t = 0; t < triCount; t++) {
    const base = t * 9;
    const cx = (positions[base] + positions[base + 3] + positions[base + 6]) / 3;
    const cy = (positions[base + 1] + positions[base + 4] + positions[base + 7]) / 3;
    const cz = (positions[base + 2] + positions[base + 5] + positions[base + 8]) / 3;

    if (containsPoint(params, transform, cx, cy, cz)) {
      indices.push(t);
    }
  }

  return indices;
}

/**
 * Filters triangle indices to only exterior-facing triangles.
 * Uses a centroid dot-product test: keeps triangles whose normal points
 * outward from the mesh center (positive dot with centroid→triangle vector).
 * This removes internal geometry (inner shells, boolean artifacts, etc.).
 */
export function filterExteriorTriangles(positions: Float32Array, candidates: number[]): number[] {
  if (candidates.length === 0) return candidates;

  // Mesh centroid (average of all vertices)
  const vertCount = positions.length / 3;
  let mcx = 0,
    mcy = 0,
    mcz = 0;
  for (let i = 0; i < positions.length; i += 3) {
    mcx += positions[i];
    mcy += positions[i + 1];
    mcz += positions[i + 2];
  }
  mcx /= vertCount;
  mcy /= vertCount;
  mcz /= vertCount;

  const result: number[] = [];
  for (const tri of candidates) {
    const b = tri * 9;
    // Vertices
    const ax = positions[b],
      ay = positions[b + 1],
      az = positions[b + 2];
    const bx = positions[b + 3],
      by = positions[b + 4],
      bz = positions[b + 5];
    const cx = positions[b + 6],
      cy = positions[b + 7],
      cz = positions[b + 8];

    // Triangle centroid
    const tcx = (ax + bx + cx) / 3;
    const tcy = (ay + by + cy) / 3;
    const tcz = (az + bz + cz) / 3;

    // Normal via cross product of edges
    const e1x = bx - ax,
      e1y = by - ay,
      e1z = bz - az;
    const e2x = cx - ax,
      e2y = cy - ay,
      e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    // Vector from mesh centroid to triangle centroid
    const dx = tcx - mcx;
    const dy = tcy - mcy;
    const dz = tcz - mcz;

    // Keep if normal faces outward (positive dot product)
    if (nx * dx + ny * dy + nz * dz > 0) {
      result.push(tri);
    }
  }

  return result;
}
