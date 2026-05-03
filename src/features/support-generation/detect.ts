// ─── Overhang detection for support generation ─────────────
// Pure functions operating on flat Float32Array geometry.

export interface OverhangParams {
  /** Overhang angle threshold in degrees (10–80, default 30) */
  angleDeg: number;
}

export const DEFAULT_OVERHANG_PARAMS: OverhangParams = {
  angleDeg: 30,
};

export interface OverhangResult {
  /** Indices of triangles classified as overhang */
  overhangTriangles: number[];
  /** Total count of overhang faces */
  count: number;
}

/**
 * Detect overhang triangles whose downward-facing normal exceeds the
 * angle threshold relative to the build axis (negative Y = down).
 *
 * @param positions Non-indexed triangle positions (3 verts × 3 floats per tri)
 * @param triangleCount Number of triangles
 * @param params Overhang parameters
 */
export function detectOverhangs(
  positions: Float32Array,
  triangleCount: number,
  params?: Partial<OverhangParams>,
): OverhangResult {
  const opts: OverhangParams = { ...DEFAULT_OVERHANG_PARAMS, ...params };
  const cosThreshold = Math.cos(((90 - opts.angleDeg) * Math.PI) / 180);
  // cosThreshold = cos(90° - angle). A face is overhang if
  // dot(faceNormal, -Y) > cosThreshold  (i.e. normal points down enough).

  const overhangTriangles: number[] = [];

  for (let tri = 0; tri < triangleCount; tri++) {
    const base = tri * 9;
    // Edge vectors
    const ax = positions[base + 3] - positions[base];
    const ay = positions[base + 4] - positions[base + 1];
    const az = positions[base + 5] - positions[base + 2];
    const bx = positions[base + 6] - positions[base];
    const by = positions[base + 7] - positions[base + 1];
    const bz = positions[base + 8] - positions[base + 2];

    // Cross product → face normal (not normalized yet)
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-12) continue; // degenerate

    // Normalized normal's Y component
    const normY = ny / len;

    // Downward facing: normY < 0. The angle from -Y axis:
    // cos(angle) = dot(normal, [0,-1,0]) = -normY
    if (-normY > cosThreshold) {
      overhangTriangles.push(tri);
    }
  }

  return { overhangTriangles, count: overhangTriangles.length };
}
