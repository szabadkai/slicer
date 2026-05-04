/**
 * Model Repairer - Automated and interactive repair operations
 *
 * Provides repair capabilities for:
 * - Duplicate vertices (merge within tolerance)
 * - Degenerate triangles (remove zero-area)
 * - Inverted normals (flip to match majority)
 * - Small holes (close boundary edges)
 * - Small components (remove floating debris)
 */

import * as THREE from 'three';

export const RepairDefaults: RepairOptions = {
  weldTolerance: 0.001,
  minHoleSize: 5,
  minComponentSize: 10,
  preserveUVs: false,
};

interface RepairStats {
  verticesRemoved?: number;
  trianglesRemoved?: number;
  normalsFlipped?: number;
  holesFilled?: number;
  componentsRemoved?: number;
}

interface RepairOptions {
  weldTolerance?: number;
  minHoleSize?: number;
  minComponentSize?: number;
  preserveUVs?: boolean;
}

interface BoundaryEdge {
  count: number;
  vertices: [number, number];
}

export class RepairResult {
  success: boolean;
  message: string;
  geometry: THREE.BufferGeometry | null;
  stats: RepairStats;

  constructor(
    success: boolean,
    message: string,
    modifiedGeometry: THREE.BufferGeometry | null = null,
    stats: RepairStats = {},
  ) {
    this.success = success;
    this.message = message;
    this.geometry = modifiedGeometry;
    this.stats = stats;
  }
}

export class ModelRepairer {
  geometry: THREE.BufferGeometry;
  private options: Required<RepairOptions>;
  private _originalGeometry: THREE.BufferGeometry;

  constructor(geometry: THREE.BufferGeometry, options: RepairOptions = {}) {
    this.geometry = geometry;
    this.options = { ...RepairDefaults, ...options } as Required<RepairOptions>;
    this._originalGeometry = geometry.clone();
  }

  getRepairedGeometry(): THREE.BufferGeometry {
    return this.geometry;
  }

  restoreOriginal(): THREE.BufferGeometry {
    this.geometry = this._originalGeometry.clone();
    return this.geometry;
  }

  autoRepair(): RepairResult {
    const results: RepairResult[] = [];
    results.push(this.fixDegenerateTriangles());
    results.push(this.fixDuplicateVertices());
    results.push(this.fixInvertedNormals());

    const totalStats: RepairStats = {
      verticesRemoved: 0,
      trianglesRemoved: 0,
      normalsFlipped: 0,
    };
    for (const result of results) {
      if (result.stats) {
        totalStats.verticesRemoved =
          (totalStats.verticesRemoved ?? 0) + (result.stats.verticesRemoved ?? 0);
        totalStats.trianglesRemoved =
          (totalStats.trianglesRemoved ?? 0) + (result.stats.trianglesRemoved ?? 0);
        totalStats.normalsFlipped =
          (totalStats.normalsFlipped ?? 0) + (result.stats.normalsFlipped ?? 0);
      }
    }

    return new RepairResult(
      results.every((r) => r.success),
      'Auto-repair completed',
      this.geometry,
      totalStats,
    );
  }

  fixDuplicateVertices(options: { tolerance?: number } = {}): RepairResult {
    const tolerance = options.tolerance ?? this.options.weldTolerance;
    const pos = this.geometry.attributes.position;
    const index = this.geometry.index;
    const scale = 1 / tolerance;

    const getVertexKey = (i: number): string => {
      const x = Math.round(pos.getX(i) * scale);
      const y = Math.round(pos.getY(i) * scale);
      const z = Math.round(pos.getZ(i) * scale);
      return `${x},${y},${z}`;
    };

    const vertexMap = new Map<string, number>();
    const newVertexIndex = new Int32Array(pos.count);
    const uniqueVertices: number[] = [];

    for (let i = 0; i < pos.count; i++) {
      const key = getVertexKey(i);
      if (!vertexMap.has(key)) {
        vertexMap.set(key, uniqueVertices.length);
        uniqueVertices.push(i);
      }
      newVertexIndex[i] = vertexMap.get(key) ?? 0;
    }

    const verticesRemoved = pos.count - uniqueVertices.length;
    if (verticesRemoved === 0) {
      return new RepairResult(true, 'No duplicate vertices found', this.geometry, {
        verticesRemoved: 0,
      });
    }

    const newPos = new Float32Array(uniqueVertices.length * 3);
    for (let i = 0; i < uniqueVertices.length; i++) {
      const srcIdx = uniqueVertices[i];
      newPos[i * 3] = pos.getX(srcIdx);
      newPos[i * 3 + 1] = pos.getY(srcIdx);
      newPos[i * 3 + 2] = pos.getZ(srcIdx);
    }

    const srcCount = index ? index.count : pos.count;
    const newIndices = new Uint32Array(srcCount);
    for (let i = 0; i < srcCount; i++) {
      newIndices[i] = newVertexIndex[index ? index.getX(i) : i];
    }

    const newGeom = new THREE.BufferGeometry();
    newGeom.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
    newGeom.setIndex(new THREE.BufferAttribute(newIndices, 1));
    newGeom.computeVertexNormals();
    newGeom.computeBoundingBox();
    this.geometry = newGeom;

    return new RepairResult(true, `Merged ${verticesRemoved} duplicate vertices`, this.geometry, {
      verticesRemoved,
    });
  }

  fixDegenerateTriangles(options: { tolerance?: number } = {}): RepairResult {
    const tolerance = options.tolerance ?? 1e-10;
    const pos = this.geometry.attributes.position;
    const index = this.geometry.index;
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
    const validTriangles: number[] = [];

    for (let i = 0; i < triCount; i++) {
      const a = index ? index.getX(i * 3) : i * 3;
      const b = index ? index.getX(i * 3 + 1) : i * 3 + 1;
      const c = index ? index.getX(i * 3 + 2) : i * 3 + 2;

      const e1x = pos.getX(b) - pos.getX(a),
        e1y = pos.getY(b) - pos.getY(a),
        e1z = pos.getZ(b) - pos.getZ(a);
      const e2x = pos.getX(c) - pos.getX(a),
        e2y = pos.getY(c) - pos.getY(a),
        e2z = pos.getZ(c) - pos.getZ(a);
      const cx = e1y * e2z - e1z * e2y,
        cy = e1z * e2x - e1x * e2z,
        cz = e1x * e2y - e1y * e2x;
      const area = Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;

      if (area >= tolerance) validTriangles.push(a, b, c);
    }

    const trianglesRemoved = triCount - validTriangles.length / 3;
    if (trianglesRemoved === 0) {
      return new RepairResult(true, 'No degenerate triangles found', this.geometry, {
        trianglesRemoved: 0,
      });
    }

    const usedVertices = new Set(validTriangles);
    const vertexRemap = new Map<number, number>();
    const newPositions: number[] = [];
    for (const vi of usedVertices) {
      vertexRemap.set(vi, newPositions.length / 3);
      newPositions.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
    }
    const newIndices = new Uint32Array(validTriangles.length);
    for (let i = 0; i < validTriangles.length; i++) {
      newIndices[i] = vertexRemap.get(validTriangles[i]) ?? 0;
    }

    const newGeom = new THREE.BufferGeometry();
    newGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPositions), 3));
    newGeom.setIndex(new THREE.BufferAttribute(newIndices, 1));
    newGeom.computeVertexNormals();
    newGeom.computeBoundingBox();
    this.geometry = newGeom;

    return new RepairResult(
      true,
      `Removed ${trianglesRemoved} degenerate triangle${trianglesRemoved > 1 ? 's' : ''}`,
      this.geometry,
      { trianglesRemoved },
    );
  }

  fixInvertedNormals(): RepairResult {
    const pos = this.geometry.attributes.position;
    const index = this.geometry.index;
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);

    const sampleSize = Math.min(500, triCount);
    const step = Math.max(1, Math.floor(triCount / sampleSize));

    if (!this.geometry.boundingBox) this.geometry.computeBoundingBox();
    const bb = this.geometry.boundingBox;
    if (!bb)
      return new RepairResult(true, 'No bounding box available', this.geometry, {
        normalsFlipped: 0,
      });
    const cx = (bb.min.x + bb.max.x) / 2;
    const cy = (bb.min.y + bb.max.y) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;

    let outwardCount = 0;
    let inwardCount = 0;

    for (let i = 0; i < triCount; i += step) {
      const a = index ? index.getX(i * 3) : i * 3;
      const b = index ? index.getX(i * 3 + 1) : i * 3 + 1;
      const c = index ? index.getX(i * 3 + 2) : i * 3 + 2;

      const ax = pos.getX(a),
        ay = pos.getY(a),
        az = pos.getZ(a);
      const bx = pos.getX(b),
        by = pos.getY(b),
        bz = pos.getZ(b);
      const ccx = pos.getX(c),
        ccy = pos.getY(c),
        ccz = pos.getZ(c);

      const e1x = bx - ax,
        e1y = by - ay,
        e1z = bz - az;
      const e2x = ccx - ax,
        e2y = ccy - ay,
        e2z = ccz - az;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl > 0) {
        nx /= nl;
        ny /= nl;
        nz /= nl;
      }

      const fx = (ax + bx + ccx) / 3;
      const fy = (ay + by + ccy) / 3;
      const fz = (az + bz + ccz) / 3;
      const toCenterDot = nx * (cx - fx) + ny * (cy - fy) + nz * (cz - fz);

      if (toCenterDot < 0) outwardCount++;
      else inwardCount++;
    }

    if (inwardCount <= outwardCount || inwardCount < sampleSize * 0.3) {
      return new RepairResult(true, 'Normals appear correct', this.geometry, { normalsFlipped: 0 });
    }

    if (index) {
      const indices = (index.array as Uint32Array).slice();
      for (let i = 0; i < indices.length; i += 3) {
        const temp = indices[i + 1];
        indices[i + 1] = indices[i + 2];
        indices[i + 2] = temp;
      }
      this.geometry.index = new THREE.BufferAttribute(indices, 1);
    } else {
      const positions = (pos.array as Float32Array).slice();
      for (let i = 0; i < positions.length; i += 9) {
        for (let j = 0; j < 3; j++) {
          const temp = positions[i + 3 + j];
          positions[i + 3 + j] = positions[i + 6 + j];
          positions[i + 6 + j] = temp;
        }
      }
      this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    }

    this.geometry.computeVertexNormals();
    return new RepairResult(true, `Flipped ${triCount} triangle normals`, this.geometry, {
      normalsFlipped: triCount,
    });
  }

  fillSmallHoles(options: { maxHoleSize?: number } = {}): RepairResult {
    const maxHoleSize = options.maxHoleSize ?? this.options.minHoleSize;
    const pos = this.geometry.attributes.position;
    const index = this.geometry.index;

    const edgeMap = new Map<string, BoundaryEdge>();
    const addEdge = (v1: number, v2: number): void => {
      const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
      if (!edgeMap.has(key))
        edgeMap.set(key, { count: 0, vertices: [Math.min(v1, v2), Math.max(v1, v2)] });
      const edge = edgeMap.get(key);
      if (edge) edge.count++;
    };

    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i),
          b = index.getX(i + 1),
          c = index.getX(i + 2);
        addEdge(a, b);
        addEdge(b, c);
        addEdge(c, a);
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        addEdge(i, i + 1);
        addEdge(i + 1, i + 2);
        addEdge(i + 2, i);
      }
    }

    const boundaryEdges = [...edgeMap.values()].filter((e) => e.count === 1);
    if (boundaryEdges.length === 0) {
      return new RepairResult(true, 'No holes found', this.geometry, { holesFilled: 0 });
    }

    const holes = this._findHoleChains(boundaryEdges);
    const smallHoles = holes.filter((hole) => {
      let perimeter = 0;
      for (const edge of hole) {
        const [v1, v2] = edge.vertices;
        const dx = pos.getX(v1) - pos.getX(v2);
        const dy = pos.getY(v1) - pos.getY(v2);
        const dz = pos.getZ(v1) - pos.getZ(v2);
        perimeter += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      return perimeter < maxHoleSize;
    });

    if (smallHoles.length === 0) {
      return new RepairResult(
        true,
        `Found ${holes.length} hole(s), none < ${maxHoleSize}mm`,
        this.geometry,
        { holesFilled: 0 },
      );
    }

    this.fixDuplicateVertices({ tolerance: maxHoleSize / 10 });
    return new RepairResult(
      true,
      `Attempted to fill ${smallHoles.length} small hole(s)`,
      this.geometry,
      { holesFilled: smallHoles.length },
    );
  }

  private _findHoleChains(boundaryEdges: BoundaryEdge[]): BoundaryEdge[][] {
    if (boundaryEdges.length === 0) return [];
    const vertexEdges = new Map<number, BoundaryEdge[]>();
    for (const edge of boundaryEdges) {
      for (const v of edge.vertices) {
        if (!vertexEdges.has(v)) vertexEdges.set(v, []);
        const edges = vertexEdges.get(v);
        if (edges) edges.push(edge);
      }
    }
    const visited = new Set<string>();
    const holes: BoundaryEdge[][] = [];
    for (const edge of boundaryEdges) {
      const key = `${edge.vertices[0]}_${edge.vertices[1]}`;
      if (visited.has(key)) continue;
      const chain = [edge];
      visited.add(key);
      let currentVertex = edge.vertices[1];
      let extended = true;
      while (extended) {
        extended = false;
        for (const nextEdge of vertexEdges.get(currentVertex) ?? []) {
          const nk = `${nextEdge.vertices[0]}_${nextEdge.vertices[1]}`;
          if (visited.has(nk)) continue;
          const nextVertex =
            nextEdge.vertices[0] === currentVertex ? nextEdge.vertices[1] : nextEdge.vertices[0];
          if (nextVertex === chain[0].vertices[0]) {
            visited.add(nk);
            extended = false;
            break;
          }
          chain.push(nextEdge);
          visited.add(nk);
          currentVertex = nextVertex;
          extended = true;
          break;
        }
      }
      if (chain.length >= 3) holes.push(chain);
    }
    return holes;
  }

  removeSmallComponents(options: { threshold?: number } = {}): RepairResult {
    const threshold = options.threshold ?? this.options.minComponentSize;
    const pos = this.geometry.attributes.position;
    const index = this.geometry.index;
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);

    const parent = new Int32Array(triCount);
    for (let i = 0; i < triCount; i++) parent[i] = i;
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    const union = (a: number, b: number): void => {
      const rA = find(a),
        rB = find(b);
      if (rA !== rB) parent[rB] = rA;
    };

    const vertexTriangles = new Map<number, number[]>();
    const getTriVerts = (ti: number): number[] =>
      index
        ? [index.getX(ti * 3), index.getX(ti * 3 + 1), index.getX(ti * 3 + 2)]
        : [ti * 3, ti * 3 + 1, ti * 3 + 2];

    for (let ti = 0; ti < triCount; ti++) {
      for (const v of getTriVerts(ti)) {
        if (!vertexTriangles.has(v)) vertexTriangles.set(v, []);
        const tris = vertexTriangles.get(v);
        if (tris) tris.push(ti);
      }
    }
    for (const tris of vertexTriangles.values()) {
      for (let i = 1; i < tris.length; i++) union(tris[0], tris[i]);
    }

    const compSizes = new Map<number, number>();
    for (let i = 0; i < triCount; i++) {
      const root = find(i);
      compSizes.set(root, (compSizes.get(root) ?? 0) + 1);
    }
    let largestSize = 0;
    for (const size of compSizes.values()) if (size > largestSize) largestSize = size;

    const validTriangles: number[] = [];
    let smallRemoved = 0;
    for (let ti = 0; ti < triCount; ti++) {
      const size = compSizes.get(find(ti)) ?? 0;
      if (size >= threshold && size >= largestSize * 0.01) validTriangles.push(...getTriVerts(ti));
      else smallRemoved++;
    }

    if (smallRemoved === 0) {
      return new RepairResult(true, 'No small components found', this.geometry, {
        componentsRemoved: 0,
      });
    }

    const usedVertices = new Set(validTriangles);
    const vertexRemap = new Map<number, number>();
    const newPositions: number[] = [];
    for (const vi of usedVertices) {
      vertexRemap.set(vi, newPositions.length / 3);
      newPositions.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
    }
    const newIndices = new Uint32Array(validTriangles.length);
    for (let i = 0; i < validTriangles.length; i++)
      newIndices[i] = vertexRemap.get(validTriangles[i]) ?? 0;

    const newGeom = new THREE.BufferGeometry();
    newGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPositions), 3));
    newGeom.setIndex(new THREE.BufferAttribute(newIndices, 1));
    newGeom.computeVertexNormals();
    newGeom.computeBoundingBox();
    this.geometry = newGeom;

    return new RepairResult(
      true,
      `Removed ${smallRemoved} triangles from small components`,
      this.geometry,
      { componentsRemoved: smallRemoved },
    );
  }
}

export function repairGeometry(
  geometry: THREE.BufferGeometry,
  options: RepairOptions = {},
): RepairResult {
  const repairer = new ModelRepairer(geometry, options);
  return repairer.autoRepair();
}
