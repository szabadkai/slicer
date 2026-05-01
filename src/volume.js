/**
 * Compute the volume of a closed mesh using the signed-tetrahedron method.
 * For each triangle, sum (v0 · (v1 × v2)) / 6. Disconnected shells are summed
 * independently so a support raft/pan with opposite winding cannot subtract
 * from the rest of the support structure.
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

  const ax = (i) => pos.getX(i);
  const ay = (i) => pos.getY(i);
  const az = (i) => pos.getZ(i);
  const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
  if (triCount === 0) return 0;

  const parent = new Int32Array(triCount);
  const rank = new Uint8Array(triCount);
  const componentVolume = new Float64Array(triCount);
  for (let i = 0; i < triCount; i++) parent[i] = i;

  const find = (x) => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== x) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };

  const union = (a, b) => {
    let rootA = find(a);
    let rootB = find(b);
    if (rootA === rootB) return;
    if (rank[rootA] < rank[rootB]) {
      const tmp = rootA;
      rootA = rootB;
      rootB = tmp;
    }
    parent[rootB] = rootA;
    if (rank[rootA] === rank[rootB]) rank[rootA]++;
  };

  const vertexToTriangle = new Map();
  const connectVertex = (vertexIndex, triangleIndex) => {
    const key = vertexKey(ax(vertexIndex), ay(vertexIndex), az(vertexIndex));
    const previousTriangle = vertexToTriangle.get(key);
    if (previousTriangle === undefined) {
      vertexToTriangle.set(key, triangleIndex);
    } else {
      union(triangleIndex, previousTriangle);
    }
  };

  if (index) {
    for (let tri = 0; tri < triCount; tri++) {
      const a = index.getX(tri * 3);
      const b = index.getX(tri * 3 + 1);
      const c = index.getX(tri * 3 + 2);
      componentVolume[tri] = signedTetVolume(
        ax(a), ay(a), az(a),
        ax(b), ay(b), az(b),
        ax(c), ay(c), az(c),
      );
      connectVertex(a, tri);
      connectVertex(b, tri);
      connectVertex(c, tri);
    }
  } else {
    for (let tri = 0; tri < triCount; tri++) {
      const i = tri * 3;
      componentVolume[tri] = signedTetVolume(
        ax(i), ay(i), az(i),
        ax(i + 1), ay(i + 1), az(i + 1),
        ax(i + 2), ay(i + 2), az(i + 2),
      );
      connectVertex(i, tri);
      connectVertex(i + 1, tri);
      connectVertex(i + 2, tri);
    }
  }

  const sums = new Map();
  for (let tri = 0; tri < triCount; tri++) {
    const root = find(tri);
    sums.set(root, (sums.get(root) || 0) + componentVolume[tri]);
  }

  let volume = 0;
  for (const sum of sums.values()) {
    volume += Math.abs(sum);
  }
  return volume;
}

function vertexKey(x, y, z) {
  return `${roundForKey(x)},${roundForKey(y)},${roundForKey(z)}`;
}

function roundForKey(value) {
  return Math.round(value * 1e5);
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
