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

/**
 * Repair options and their defaults
 */
export const RepairDefaults = {
  weldTolerance: 0.001,      // mm - vertices within this distance are merged
  minHoleSize: 5,            // mm - maximum hole diameter to auto-fill
  minComponentSize: 10,      // triangles - components smaller than this can be removed
  preserveUVs: false,        // Whether to preserve UV coordinates during repairs
};

/**
 * Result of a repair operation
 */
export class RepairResult {
  constructor(success, message, modifiedGeometry = null, stats = {}) {
    this.success = success;
    this.message = message;
    this.geometry = modifiedGeometry;
    this.stats = stats; // { verticesRemoved, trianglesRemoved, holesFilled, etc. }
  }
}

/**
 * Main Model Repairer class
 */
export class ModelRepairer {
  constructor(geometry, options = {}) {
    this.geometry = geometry;
    this.options = { ...RepairDefaults, ...options };
    this._originalGeometry = geometry.clone();
  }

  /**
   * Get the repaired geometry
   */
  getRepairedGeometry() {
    return this.geometry;
  }

  /**
   * Restore original geometry
   */
  restoreOriginal() {
    this.geometry = this._originalGeometry.clone();
    return this.geometry;
  }

  /**
   * Run all safe auto-repairs
   */
  autoRepair() {
    const results = [];
    
    // Safe repairs in order
    results.push(this.fixDegenerateTriangles());
    results.push(this.fixDuplicateVertices());
    results.push(this.fixInvertedNormals());
    
    // Summarize
    const totalStats = {
      verticesRemoved: 0,
      trianglesRemoved: 0,
      normalsFlipped: 0,
    };
    
    for (const result of results) {
      if (result.stats) {
        totalStats.verticesRemoved += result.stats.verticesRemoved || 0;
        totalStats.trianglesRemoved += result.stats.trianglesRemoved || 0;
        totalStats.normalsFlipped += result.stats.normalsFlipped || 0;
      }
    }
    
    return new RepairResult(
      results.every(r => r.success),
      `Auto-repair completed`,
      this.geometry,
      totalStats
    );
  }

  /**
   * Fix duplicate vertices by merging them within tolerance
   */
  fixDuplicateVertices(options = {}) {
    const tolerance = options.tolerance || this.options.weldTolerance;
    
    const pos = this.geometry.attributes.position;
    const index = this.geometry.index;
    
    // Build vertex map
    const vertexMap = new Map();
    const scale = 1 / tolerance;
    
    const getVertexKey = (i) => {
      const x = Math.round(pos.getX(i) * scale);
      const y = Math.round(pos.getY(i) * scale);
      const z = Math.round(pos.getZ(i) * scale);
      return `${x},${y},${z}`;
    };
    
    // Map each vertex to a canonical index
    const newVertexIndex = new Int32Array(pos.count);
    const uniqueVertices = [];
    
    for (let i = 0; i < pos.count; i++) {
      const key = getVertexKey(i);
      if (!vertexMap.has(key)) {
        vertexMap.set(key, uniqueVertices.length);
        uniqueVertices.push(i);
      }
      newVertexIndex[i] = vertexMap.get(key);
    }
    
    const verticesRemoved = pos.count - uniqueVertices.length;
    
    if (verticesRemoved === 0) {
      return new RepairResult(true, 'No duplicate vertices found', this.geometry, { verticesRemoved: 0 });
    }
    
    // Build new position array
    const newPos = new Float32Array(uniqueVertices.length * 3);
    for (let i = 0; i < uniqueVertices.length; i++) {
      const srcIdx = uniqueVertices[i];
      newPos[i * 3] = pos.getX(srcIdx);
      newPos[i * 3 + 1] = pos.getY(srcIdx);
      newPos[i * 3 + 2] = pos.getZ(srcIdx);
    }
    
    // Rebuild index array
    let newIndices;
    if (index) {
      newIndices = new Uint32Array(index.count);
      for (let i = 0; i < index.count; i++) {
        newIndices[i] = newVertexIndex[index.getX(i)];
      }
    } else {
      newIndices = new Uint32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        newIndices[i] = newVertexIndex[i];
      }
    }
    
    // Create new geometry
    const newGeom = new THREE.BufferGeometry();
    newGeom.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
    newGeom.setIndex(new THREE.BufferAttribute(newIndices, 1));
    newGeom.computeVertexNormals();
    newGeom.computeBoundingBox();
    
    this.geometry = newGeom;
    
    return new RepairResult(
      true,
      `Merged ${verticesRemoved} duplicate vertices`,
      this.geometry,
      { verticesRemoved }
    );
  }

  /**
   * Remove degenerate (zero-area) triangles
   */
  fixDegenerateTriangles(options = {}) {
    const tolerance = options.tolerance || 1e-10;
    
    const pos = this.geometry.attributes.position;
    const index = this.geometry.index;
    
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
    const validTriangles = [];
    
    for (let i = 0; i < triCount; i++) {
      let a, b, c;
      if (index) {
        a = index.getX(i * 3);
        b = index.getX(i * 3 + 1);
        c = index.getX(i * 3 + 2);
      } else {
        a = i * 3;
        b = i * 3 + 1;
        c = i * 3 + 2;
      }
      
      // Compute triangle area
      const v0 = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a));
      const v1 = new THREE.Vector3(pos.getX(b), pos.getY(b), pos.getZ(b));
      const v2 = new THREE.Vector3(pos.getX(c), pos.getY(c), pos.getZ(c));
      
      const edge1 = new THREE.Vector3().subVectors(v1, v0);
      const edge2 = new THREE.Vector3().subVectors(v2, v0);
      const cross = new THREE.Vector3().crossVectors(edge1, edge2);
      const area = cross.length() / 2;
      
      if (area >= tolerance) {
        validTriangles.push(a, b, c);
      }
    }
    
    const trianglesRemoved = triCount - validTriangles.length / 3;
    
    if (trianglesRemoved === 0) {
      return new RepairResult(true, 'No degenerate triangles found', this.geometry, { trianglesRemoved: 0 });
    }
    
    // Build new geometry with only valid triangles
    // Need to remap vertices to only those used
    const usedVertices = new Set(validTriangles);
    const vertexRemap = new Map();
    const newPositions = [];
    
    for (const vi of usedVertices) {
      vertexRemap.set(vi, newPositions.length / 3);
      newPositions.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
    }
    
    const newIndices = new Uint32Array(validTriangles.length);
    for (let i = 0; i < validTriangles.length; i++) {
      newIndices[i] = vertexRemap.get(validTriangles[i]);
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
      { trianglesRemoved }
    );
  }

  /**
   * Fix inverted normals by flipping all faces if majority are inverted
   */
  fixInvertedNormals(options = {}) {
    const pos = this.geometry.attributes.position;
    const index = this.geometry.index;
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
    
    // Sample triangles to determine orientation
    const sampleSize = Math.min(500, triCount);
    const step = Math.max(1, Math.floor(triCount / sampleSize));
    
    const bb = this.geometry.boundingBox;
    const center = new THREE.Vector3();
    bb.getCenter(center);
    
    let outwardCount = 0;
    let inwardCount = 0;
    
    for (let i = 0; i < triCount; i += step) {
      let a, b, c;
      if (index) {
        a = index.getX(i * 3);
        b = index.getX(i * 3 + 1);
        c = index.getX(i * 3 + 2);
      } else {
        a = i * 3;
        b = i * 3 + 1;
        c = i * 3 + 2;
      }
      
      const v0 = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a));
      const v1 = new THREE.Vector3(pos.getX(b), pos.getY(b), pos.getZ(b));
      const v2 = new THREE.Vector3(pos.getX(c), pos.getY(c), pos.getZ(c));
      
      const edge1 = new THREE.Vector3().subVectors(v1, v0);
      const edge2 = new THREE.Vector3().subVectors(v2, v0);
      const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
      
      const faceCenter = new THREE.Vector3().add(v0).add(v1).add(v2).divideScalar(3);
      const toCenter = new THREE.Vector3().subVectors(center, faceCenter);
      
      if (normal.dot(toCenter) < 0) {
        outwardCount++;
      } else {
        inwardCount++;
      }
    }
    
    // Only flip if majority are inverted
    if (inwardCount <= outwardCount || inwardCount < sampleSize * 0.3) {
      return new RepairResult(true, 'Normals appear correct', this.geometry, { normalsFlipped: 0 });
    }
    
    // Flip all triangles by reversing winding order
    if (index) {
      const indices = index.array.slice();
      for (let i = 0; i < indices.length; i += 3) {
        // Swap b and c
        const temp = indices[i + 1];
        indices[i + 1] = indices[i + 2];
        indices[i + 2] = temp;
      }
      this.geometry.index = new THREE.BufferAttribute(indices, 1);
    } else {
      // Non-indexed geometry - need to shuffle position attribute
      const positions = pos.array.slice();
      for (let i = 0; i < positions.length; i += 9) {
        // Swap vertex 1 and 2
        for (let j = 0; j < 3; j++) {
          const temp = positions[i + 3 + j];
          positions[i + 3 + j] = positions[i + 6 + j];
          positions[i + 6 + j] = temp;
        }
      }
      this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    }
    
    this.geometry.computeVertexNormals();
    
    return new RepairResult(
      true,
      `Flipped ${triCount} triangle normals`,
      this.geometry,
      { normalsFlipped: triCount }
    );
  }

  /**
   * Fill small holes by welding boundary vertices
   */
  fillSmallHoles(options = {}) {
    const maxHoleSize = options.maxHoleSize || this.options.minHoleSize;
    
    // Build edge map to find boundary edges
    const pos = this.geometry.attributes.position;
    const index = this.geometry.index;
    
    const edgeMap = new Map();
    
    const addEdge = (v1, v2) => {
      const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { count: 0, vertices: [Math.min(v1, v2), Math.max(v1, v2)] });
      }
      edgeMap.get(key).count++;
    };
    
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);
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
    
    // Find boundary edges (edges with only 1 adjacent face)
    const boundaryEdges = [];
    for (const [key, edge] of edgeMap) {
      if (edge.count === 1) {
        boundaryEdges.push(edge);
      }
    }
    
    if (boundaryEdges.length === 0) {
      return new RepairResult(true, 'No holes found', this.geometry, { holesFilled: 0 });
    }
    
    // Group boundary edges into chains (holes)
    // Simple approach: find connected edge loops
    const holes = this._findHoleChains(boundaryEdges);
    
    // Filter by size
    const smallHoles = holes.filter(hole => {
      const perimeter = this._calculateHolePerimeter(hole, pos);
      return perimeter < maxHoleSize;
    });
    
    if (smallHoles.length === 0) {
      return new RepairResult(
        true,
        `Found ${holes.length} hole(s), but none smaller than ${maxHoleSize}mm`,
        this.geometry,
        { holesFilled: 0 }
      );
    }
    
    // Fill small holes by welding nearby boundary vertices
    // This is a simplified approach - proper hole filling would triangulate
    const result = this.fixDuplicateVertices({ tolerance: maxHoleSize / 10 });
    
    return new RepairResult(
      true,
      `Attempted to fill ${smallHoles.length} small hole(s)`,
      this.geometry,
      { holesFilled: smallHoles.length }
    );
  }

  /**
   * Find connected chains of boundary edges (holes)
   */
  _findHoleChains(boundaryEdges) {
    if (boundaryEdges.length === 0) return [];
    
    // Build vertex adjacency for boundary
    const vertexEdges = new Map();
    for (const edge of boundaryEdges) {
      const [v1, v2] = edge.vertices;
      if (!vertexEdges.has(v1)) vertexEdges.set(v1, []);
      if (!vertexEdges.has(v2)) vertexEdges.set(v2, []);
      vertexEdges.get(v1).push(edge);
      vertexEdges.get(v2).push(edge);
    }
    
    const visited = new Set();
    const holes = [];
    
    for (const edge of boundaryEdges) {
      const key = `${edge.vertices[0]}_${edge.vertices[1]}`;
      if (visited.has(key)) continue;
      
      const chain = [edge];
      visited.add(key);
      
      // Try to extend chain
      let currentVertex = edge.vertices[1];
      let extended = true;
      
      while (extended) {
        extended = false;
        const adjacent = vertexEdges.get(currentVertex) || [];
        
        for (const nextEdge of adjacent) {
          const nextKey = `${nextEdge.vertices[0]}_${nextEdge.vertices[1]}`;
          if (visited.has(nextKey)) continue;
          
          const [nv1, nv2] = nextEdge.vertices;
          const nextVertex = nv1 === currentVertex ? nv2 : nv1;
          
          if (nextVertex === chain[0].vertices[0]) {
            // Closed the loop
            visited.add(nextKey);
            extended = false;
            break;
          }
          
          chain.push(nextEdge);
          visited.add(nextKey);
          currentVertex = nextVertex;
          extended = true;
          break;
        }
      }
      
      if (chain.length >= 3) {
        holes.push(chain);
      }
    }
    
    return holes;
  }

  /**
   * Calculate perimeter of a hole
   */
  _calculateHolePerimeter(holeEdges, pos) {
    let perimeter = 0;
    
    for (const edge of holeEdges) {
      const [v1, v2] = edge.vertices;
      const p1 = new THREE.Vector3(pos.getX(v1), pos.getY(v1), pos.getZ(v1));
      const p2 = new THREE.Vector3(pos.getX(v2), pos.getY(v2), pos.getZ(v2));
      perimeter += p1.distanceTo(p2);
    }
    
    return perimeter;
  }

  /**
   * Remove small disconnected components
   */
  removeSmallComponents(options = {}) {
    const threshold = options.threshold || this.options.minComponentSize;
    
    const pos = this.geometry.attributes.position;
    const index = this.geometry.index;
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
    
    // Build connected components using union-find
    const parent = new Int32Array(triCount);
    for (let i = 0; i < triCount; i++) parent[i] = i;
    
    const find = (x) => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    
    const union = (a, b) => {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent[rootB] = rootA;
    };
    
    // Build vertex-to-triangle map
    const vertexTriangles = new Map();
    
    const getTriangleVertices = (ti) => {
      if (index) {
        return [index.getX(ti * 3), index.getX(ti * 3 + 1), index.getX(ti * 3 + 2)];
      }
      return [ti * 3, ti * 3 + 1, ti * 3 + 2];
    };
    
    for (let ti = 0; ti < triCount; ti++) {
      const verts = getTriangleVertices(ti);
      for (const v of verts) {
        if (!vertexTriangles.has(v)) vertexTriangles.set(v, []);
        vertexTriangles.get(v).push(ti);
      }
    }
    
    // Connect triangles sharing vertices
    for (const [v, tris] of vertexTriangles) {
      for (let i = 1; i < tris.length; i++) {
        union(tris[0], tris[i]);
      }
    }
    
    // Count component sizes
    const componentSizes = new Map();
    for (let i = 0; i < triCount; i++) {
      const root = find(i);
      componentSizes.set(root, (componentSizes.get(root) || 0) + 1);
    }
    
    // Find largest component
    let largestRoot = -1;
    let largestSize = 0;
    for (const [root, size] of componentSizes) {
      if (size > largestSize) {
        largestSize = size;
        largestRoot = root;
      }
    }
    
    // Keep triangles from largest component
    const validTriangles = [];
    let smallRemoved = 0;
    
    for (let ti = 0; ti < triCount; ti++) {
      const root = find(ti);
      const size = componentSizes.get(root);
      
      // Keep if part of a large enough component
      if (size >= threshold && size >= largestSize * 0.01) {
        validTriangles.push(...getTriangleVertices(ti));
      } else {
        smallRemoved++;
      }
    }
    
    if (smallRemoved === 0) {
      return new RepairResult(true, 'No small components found', this.geometry, { componentsRemoved: 0 });
    }
    
    // Rebuild geometry
    const usedVertices = new Set(validTriangles);
    const vertexRemap = new Map();
    const newPositions = [];
    
    for (const vi of usedVertices) {
      vertexRemap.set(vi, newPositions.length / 3);
      newPositions.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
    }
    
    const newIndices = new Uint32Array(validTriangles.length);
    for (let i = 0; i < validTriangles.length; i++) {
      newIndices[i] = vertexRemap.get(validTriangles[i]);
    }
    
    const newGeom = new THREE.BufferGeometry();
    newGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPositions), 3));
    newGeom.setIndex(new THREE.BufferAttribute(newIndices, 1));
    newGeom.computeVertexNormals();
    newGeom.computeBoundingBox();
    
    this.geometry = newGeom;
    
    return new RepairResult(
      true,
      `Removed ${smallRemoved} triangle${smallRemoved > 1 ? 's' : ''} from small components`,
      this.geometry,
      { componentsRemoved: smallRemoved }
    );
  }
}

/**
 * Convenience function to repair geometry
 */
export function repairGeometry(geometry, options = {}) {
  const repairer = new ModelRepairer(geometry, options);
  return repairer.autoRepair();
}
