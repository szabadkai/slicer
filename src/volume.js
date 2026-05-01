/**
 * Compute the volume of a closed mesh using the signed-tetrahedron method.
 * For each triangle, sum (v0 · (v1 × v2)) / 6. Takes Math.abs to be robust to
 * inverted winding and partially-open meshes.
 *
 * @param {THREE.BufferGeometry} geometry - position attribute is required;
 *   vertices are read in their current local space, so the caller must apply
 *   any world transform before calling (e.g. via geometry.applyMatrix4).
 * @returns {number} volume in the geometry's units cubed (mm³ for this app).
 */
export function computeMeshVolume(geometry) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return 0;
  const pos = geometry.attributes.position;
  const index = geometry.index;
  let sum = 0;

  const ax = (i) => pos.getX(i);
  const ay = (i) => pos.getY(i);
  const az = (i) => pos.getZ(i);

  if (index) {
    const idx = index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      sum += signedTetVolume(
        ax(a), ay(a), az(a),
        ax(b), ay(b), az(b),
        ax(c), ay(c), az(c),
      );
    }
  } else {
    const n = pos.count;
    for (let i = 0; i < n; i += 3) {
      sum += signedTetVolume(
        ax(i), ay(i), az(i),
        ax(i + 1), ay(i + 1), az(i + 1),
        ax(i + 2), ay(i + 2), az(i + 2),
      );
    }
  }

  return Math.abs(sum);
}

function signedTetVolume(
  x0, y0, z0,
  x1, y1, z1,
  x2, y2, z2,
) {
  // (v0 · (v1 × v2)) / 6
  const cx = y1 * z2 - z1 * y2;
  const cy = z1 * x2 - x1 * z2;
  const cz = x1 * y2 - y1 * x2;
  return (x0 * cx + y0 * cy + z0 * cz) / 6;
}

/**
 * Compute volume from sliced layer pixel data.
 * Each layer is RGBA; "white" = inside model. We treat any pixel with red > 127
 * as filled (binary stencil output, anti-aliased edges count fractionally only
 * if we change to fractional weighting later).
 *
 * @param {Uint8Array[]} layers
 * @param {{resolutionX:number,resolutionY:number,buildWidthMM:number,buildDepthMM:number}} printerSpec
 * @param {number} layerHeightMM
 * @returns {number} volume in mm³
 */
export function computeSlicedVolume(layers, printerSpec, layerHeightMM) {
  if (!layers || layers.length === 0) return 0;
  const pxArea =
    (printerSpec.buildWidthMM / printerSpec.resolutionX) *
    (printerSpec.buildDepthMM / printerSpec.resolutionY);

  let whitePixels = 0;
  for (const layer of layers) {
    for (let i = 0; i < layer.length; i += 4) {
      if (layer[i] > 127) whitePixels++;
    }
  }
  return whitePixels * pxArea * layerHeightMM;
}

/** Convert mm³ to mL (= cm³). */
export function mm3ToMl(mm3) {
  return mm3 / 1000;
}
