/**
 * Compute the volume of a closed mesh using the signed-tetrahedron method.
 * For each triangle, sum (v0 · (v1 × v2)) / 6. Disconnected shells are summed
 * independently so a support raft/pan with opposite winding cannot subtract
 * from the rest of the support structure.
 */

interface BufferAttribute {
  getX(index: number): number;
  getY?(index: number): number;
  getZ?(index: number): number;
  count: number;
}

interface GeometryLike {
  attributes?: {
    position?: BufferAttribute;
  };
  index?: { getX(index: number): number; count: number } | null;
}

interface PrinterSpecLike {
  resolutionX: number;
  resolutionY: number;
  buildWidthMM: number;
  buildDepthMM: number;
}

export function computeMeshVolume(geometry: GeometryLike | null): number {
  if (!geometry?.attributes?.position) return 0;
  const pos = geometry.attributes.position;
  const index = geometry.index;

  const ax = (i: number): number => pos.getX(i);
  const ay = (i: number): number => pos.getY(i);
  const az = (i: number): number => pos.getZ(i);
  const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
  if (triCount === 0) return 0;

  const parent = new Int32Array(triCount);
  const rank = new Uint8Array(triCount);
  const componentVolume = new Float64Array(triCount);
  for (let i = 0; i < triCount; i++) parent[i] = i;

  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== x) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };

  const union = (a: number, b: number): void => {
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

  // Use integer-based spatial hash instead of string keys to avoid GC pressure.
  const QUANT = 1e5;
  const OFFSET = 1048576; // 2^20
  const vertexToTriangle = new Map<bigint, number>();
  const connectVertex = (vertexIndex: number, triangleIndex: number): void => {
    const qx = (Math.round(ax(vertexIndex) * QUANT) + OFFSET) | 0;
    const qy = (Math.round(ay(vertexIndex) * QUANT) + OFFSET) | 0;
    const qz = (Math.round(az(vertexIndex) * QUANT) + OFFSET) | 0;
    const key = BigInt(qx) | (BigInt(qy) << 21n) | (BigInt(qz) << 42n);
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

  const sums = new Map<number, number>();
  for (let tri = 0; tri < triCount; tri++) {
    const root = find(tri);
    sums.set(root, (sums.get(root) ?? 0) + componentVolume[tri]);
  }

  let volume = 0;
  for (const sum of sums.values()) {
    volume += Math.abs(sum);
  }
  return volume;
}

function signedTetVolume(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
): number {
  const cx = y1 * z2 - z1 * y2;
  const cy = z1 * x2 - x1 * z2;
  const cz = x1 * y2 - y1 * x2;
  return (x0 * cx + y0 * cy + z0 * cz) / 6;
}

/**
 * Compute volume from sliced layer pixel data.
 * Each layer is RGBA; "white" = inside model. We treat any pixel with red > 127
 * as filled.
 *
 * If preComputedWhitePixels is provided (total count already accumulated during
 * slicing), skips the expensive per-pixel scan entirely.
 */
export function computeSlicedVolume(
  layers: Uint8Array[] | null,
  printerSpec: PrinterSpecLike,
  layerHeightMM: number,
  preComputedWhitePixels?: number,
): number {
  if (!layers || layers.length === 0) return 0;
  const pxArea =
    (printerSpec.buildWidthMM / printerSpec.resolutionX) *
    (printerSpec.buildDepthMM / printerSpec.resolutionY);

  if (preComputedWhitePixels !== undefined) {
    return preComputedWhitePixels * pxArea * layerHeightMM;
  }

  let whitePixels = 0;
  for (const layer of layers) {
    for (let i = 0; i < layer.length; i += 4) {
      if (layer[i] > 127) whitePixels++;
    }
  }
  return whitePixels * pxArea * layerHeightMM;
}

/** Convert mm³ to mL (= cm³). */
export function mm3ToMl(mm3: number): number {
  return mm3 / 1000;
}
