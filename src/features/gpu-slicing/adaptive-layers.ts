/**
 * Adaptive layer heights — vary layer thickness based on model geometry.
 *
 * Thin layers where the surface is nearly horizontal (high detail needed),
 * thick layers where the surface is steep (staircase effect invisible).
 *
 * Algorithm: for each Z-height, sample the minimum angle between the surface
 * normal and the Z-axis across all triangles intersecting that band. If the
 * surface is nearly flat (angle near 0°/180°), use the minimum layer height.
 * If steep (angle near 90°), use the maximum layer height.
 */

export interface AdaptiveLayerProfile {
  /** Minimum layer height in mm (used for nearly-flat regions) */
  minHeightMM: number;
  /** Maximum layer height in mm (used for steep regions) */
  maxHeightMM: number;
  /** Angle threshold in degrees — surfaces steeper than this get max height */
  steepAngleDeg: number;
}

export interface AdaptiveLayerResult {
  /** Per-layer Z positions (bottom of each layer) */
  layerZPositions: Float64Array;
  /** Per-layer heights */
  layerHeights: Float64Array;
  /** Total layer count */
  layerCount: number;
  /** Average layer height */
  averageHeightMM: number;
}

/**
 * Compute adaptive layer heights from the triangle normals of a mesh.
 *
 * @param positions - flat Float32Array of vertex positions (x,y,z repeating)
 * @param normals - flat Float32Array of vertex normals (x,y,z repeating)
 * @param modelHeight - total model height in mm
 * @param profile - adaptive layer profile settings
 */
export function computeAdaptiveLayers(
  positions: Float32Array,
  normals: Float32Array,
  modelHeight: number,
  profile: AdaptiveLayerProfile,
): AdaptiveLayerResult {
  const { minHeightMM, maxHeightMM, steepAngleDeg } = profile;
  const steepAngleRad = (steepAngleDeg * Math.PI) / 180;

  // Build a lookup of minimum surface angle per Z-band
  // Sample at the minimum layer height resolution
  const bandCount = Math.ceil(modelHeight / minHeightMM);
  const bandAngles = new Float64Array(bandCount).fill(Math.PI / 2); // default: steep

  const triCount = positions.length / 9;
  for (let t = 0; t < triCount; t++) {
    const base = t * 9;
    // Triangle Z range
    const z0 = positions[base + 1];
    const z1 = positions[base + 4];
    const z2 = positions[base + 7];
    const minZ = Math.min(z0, z1, z2);
    const maxZ = Math.max(z0, z1, z2);

    // Average face normal (Y is up)
    const ny = (normals[base + 1] + normals[base + 4] + normals[base + 7]) / 3;
    const angleFromVertical = Math.acos(Math.min(1, Math.abs(ny)));

    // Mark bands this triangle spans
    const bandStart = Math.max(0, Math.floor(minZ / minHeightMM));
    const bandEnd = Math.min(bandCount - 1, Math.ceil(maxZ / minHeightMM));
    for (let b = bandStart; b <= bandEnd; b++) {
      if (angleFromVertical < bandAngles[b]) {
        bandAngles[b] = angleFromVertical;
      }
    }
  }

  // Generate layer heights from band angles
  const zPositions: number[] = [];
  const heights: number[] = [];
  let z = 0;

  while (z < modelHeight) {
    const bandIdx = Math.min(bandCount - 1, Math.floor(z / minHeightMM));
    const angle = bandAngles[bandIdx];

    // Interpolate: flat surface → min height, steep surface → max height
    const t = Math.min(1, angle / steepAngleRad);
    const layerH = Math.min(
      maxHeightMM,
      Math.max(minHeightMM, minHeightMM + t * (maxHeightMM - minHeightMM)),
    );

    // Don't exceed model height
    const actualH = Math.min(layerH, modelHeight - z);
    zPositions.push(z);
    heights.push(actualH);
    z += actualH;
  }

  const layerCount = heights.length;
  const totalHeight = heights.reduce((a, b) => a + b, 0);

  return {
    layerZPositions: new Float64Array(zPositions),
    layerHeights: new Float64Array(heights),
    layerCount,
    averageHeightMM: layerCount > 0 ? totalHeight / layerCount : minHeightMM,
  };
}

/**
 * Format an adaptive layer result summary.
 */
export function formatAdaptiveSummary(result: AdaptiveLayerResult): string {
  const minH = Math.min(...result.layerHeights);
  const maxH = Math.max(...result.layerHeights);
  return (
    `${result.layerCount} layers ` +
    `(${minH.toFixed(3)}–${maxH.toFixed(3)} mm, ` +
    `avg ${result.averageHeightMM.toFixed(3)} mm)`
  );
}
