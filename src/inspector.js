/**
 * Model Inspector - Analyzes 3D models for common printability issues
 * 
 * Detection methods for:
 * - Non-manifold edges (edges with != 2 adjacent faces)
 * - Open boundaries (holes in mesh)
 * - Inverted normals (faces with incorrect winding)
 * - Duplicate vertices (vertices at same position)
 * - Degenerate triangles (zero-area triangles)
 * - Self-intersections (faces intersecting each other)
 * - Thin features (walls thinner than printer resolution)
 * - Small components (floating debris, disconnected geometry)
 * - Scale issues (model too small/large for build plate)
 * - Sharp overhangs (angles requiring support)
 */

import * as THREE from 'three';

// Issue severity levels
export const Severity = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info'
};

// Issue types with metadata
export const IssueTypes = {
  NON_MANIFOLD_EDGES: {
    id: 'non-manifold-edges',
    name: 'Non-manifold edges',
    severity: Severity.ERROR,
    impact: 'Slice will fail or produce unexpected results',
    autoFixable: false
  },
  OPEN_BOUNDARIES: {
    id: 'open-boundaries',
    name: 'Open boundaries (holes)',
    severity: Severity.ERROR,
    impact: 'Causes holes in sliced layers',
    autoFixable: false
  },
  INVERTED_NORMALS: {
    id: 'inverted-normals',
    name: 'Inverted normals',
    severity: Severity.WARNING,
    impact: 'Incorrect inside/outside detection',
    autoFixable: true
  },
  DUPLICATE_VERTICES: {
    id: 'duplicate-vertices',
    name: 'Duplicate vertices',
    severity: Severity.WARNING,
    impact: 'Wastes memory, may cause artifacts',
    autoFixable: true
  },
  DEGENERATE_TRIANGLES: {
    id: 'degenerate-triangles',
    name: 'Degenerate triangles',
    severity: Severity.WARNING,
    impact: 'Zero-area triangles can cause issues',
    autoFixable: true
  },
  SELF_INTERSECTIONS: {
    id: 'self-intersections',
    name: 'Self-intersections',
    severity: Severity.ERROR,
    impact: 'Causes unpredictable slicing',
    autoFixable: false
  },
  THIN_FEATURES: {
    id: 'thin-features',
    name: 'Thin features',
    severity: Severity.INFO,
    impact: 'May not print correctly',
    autoFixable: false
  },
  SMALL_COMPONENTS: {
    id: 'small-components',
    name: 'Small detached components',
    severity: Severity.INFO,
    impact: 'Often printing artifacts or debris',
    autoFixable: false
  },
  SCALE_ISSUES: {
    id: 'scale-issues',
    name: 'Scale issues',
    severity: Severity.INFO,
    impact: 'May not fit on build plate',
    autoFixable: false
  },
  SHARP_OVERHANGS: {
    id: 'sharp-overhangs',
    name: 'Sharp overhangs',
    severity: Severity.INFO,
    impact: 'Requires supports',
    autoFixable: false
  }
};

/**
 * Represents a single issue found during inspection
 */
export class Issue {
  constructor(type, count, locations = null, description = null, occurrences = []) {
    this.id = type.id;
    this.type = type;
    this.severity = type.severity;
    this.count = count;
    this.description = description || type.name;
    this.impact = type.impact;
    this.autoFixable = type.autoFixable;
    this.locations = locations; // Float32Array of vertex positions for visualization
    this.occurrences = occurrences;
  }
}

/**
 * Full inspection report
 */
export class InspectionReport {
  constructor() {
    this.timestamp = new Date();
    this.geometry = {
      triangleCount: 0,
      vertexCount: 0,
      boundingBox: null,
      volume: 0
    };
    this.issues = [];
    this.summary = {
      errors: 0,
      warnings: 0,
      info: 0
    };
    this.overallHealth = 'excellent';
  }

  addIssue(issue) {
    this.issues.push(issue);
    if (issue.severity === Severity.ERROR) this.summary.errors++;
    else if (issue.severity === Severity.WARNING) this.summary.warnings++;
    else this.summary.info++;
  }

  calculateHealth() {
    const { errors, warnings, info } = this.summary;
    
    if (errors > 0) {
      this.overallHealth = errors >= 3 ? 'critical' : errors >= 1 ? 'poor' : 'fair';
    } else if (warnings > 0) {
      this.overallHealth = warnings >= 5 ? 'fair' : 'good';
    } else if (info > 0) {
      this.overallHealth = 'good';
    } else {
      this.overallHealth = 'excellent';
    }
    
    return this.overallHealth;
  }

  getHealthScore() {
    // Returns 0-100 score
    const { errors, warnings, info } = this.summary;
    let score = 100;
    score -= errors * 25;
    score -= warnings * 5;
    score -= info * 2;
    return Math.max(0, Math.min(100, score));
  }

  getHealthColor() {
    switch (this.overallHealth) {
      case 'excellent': return '#22c55e';
      case 'good': return '#84cc16';
      case 'fair': return '#eab308';
      case 'poor': return '#f97316';
      case 'critical': return '#ef4444';
      default: return '#6b7280';
    }
  }
}

/**
 * Main Model Inspector class
 */
export class ModelInspector {
  constructor(geometry, options = {}) {
    this.geometry = geometry;
    this.options = {
      weldTolerance: options.weldTolerance || 0.001,
      thinFeatureThreshold: options.thinFeatureThreshold || 0.3,
      smallComponentThreshold: options.smallComponentThreshold || 1.0,
      overhangAngle: options.overhangAngle || 45,
      printerSpec: options.printerSpec || null,
      ...options
    };
    
    // Cache computed data
    this._positionAttr = null;
    this._indexAttr = null;
    this._vertexCount = 0;
    this._triangleCount = 0;
    this._edgeMap = null;
    this._vertexMap = null;
  }

  /**
   * Run full inspection and return comprehensive report
   */
  runFullInspection() {
    const report = new InspectionReport();
    
    if (!this.geometry || !this.geometry.attributes || !this.geometry.attributes.position) {
      report.addIssue(new Issue(IssueTypes.SCALE_ISSUES, 1, null, 'Invalid geometry'));
      return report;
    }

    // Gather basic geometry info
    this._cacheGeometryData();
    report.geometry.triangleCount = this._triangleCount;
    report.geometry.vertexCount = this._vertexCount;
    
    this.geometry.computeBoundingBox();
    report.geometry.boundingBox = this.geometry.boundingBox.clone();
    
    // Run all detection methods
    this._detectAllIssues(report);
    
    // Calculate final health score
    report.calculateHealth();
    
    return report;
  }

  _cacheGeometryData() {
    this._positionAttr = this.geometry.attributes.position;
    this._indexAttr = this.geometry.index;
    this._vertexCount = this._positionAttr.count;
    this._triangleCount = this._indexAttr 
      ? Math.floor(this._indexAttr.count / 3) 
      : Math.floor(this._vertexCount / 3);
  }

  _detectAllIssues(report) {
    // Build edge map once (used by multiple detection methods)
    this._buildEdgeMap();
    
    // Error-level issues
    this._detectNonManifoldEdges(report);
    this._detectOpenBoundaries(report);
    this._detectSelfIntersections(report);
    
    // Warning-level issues
    this._detectInvertedNormals(report);
    this._detectDuplicateVertices(report);
    this._detectDegenerateTriangles(report);
    
    // Info-level issues
    this._detectThinFeatures(report);
    this._detectSmallComponents(report);
    this._detectScaleIssues(report);
    this._detectSharpOverhangs(report);
  }

  /**
   * Build edge-to-faces adjacency map keyed by canonical (welded) vertex ids,
   * so meshes that duplicate vertex positions at UV seams (e.g. spheres,
   * non-indexed STLs) don't get reported as non-manifold or full of holes.
   *
   * Key: "v1_v2" of canonical ids (sorted).
   * Value: { faces: [faceId, ...], boundary: boolean, vertices: [rawV1, rawV2] }
   */
  _buildEdgeMap() {
    if (this._edgeMap) return this._edgeMap;

    // Build canonical vertex id table from the spatial-hash vertex map.
    const vertexMap = this._buildVertexMap();
    const canonical = new Int32Array(this._vertexCount);
    let canonId = 0;
    for (const [, indices] of vertexMap) {
      for (const vi of indices) canonical[vi] = canonId;
      canonId++;
    }
    this._canonicalVertices = canonical;

    this._edgeMap = new Map();

    const addEdge = (rawV1, rawV2, faceId) => {
      const c1 = canonical[rawV1];
      const c2 = canonical[rawV2];
      if (c1 === c2) return; // degenerate edge, ignore
      const key = c1 < c2 ? `${c1}_${c2}` : `${c2}_${c1}`;
      let entry = this._edgeMap.get(key);
      if (!entry) {
        entry = { faces: [], boundary: false, vertices: [rawV1, rawV2] };
        this._edgeMap.set(key, entry);
      }
      entry.faces.push(faceId);
    };

    if (this._indexAttr) {
      for (let i = 0; i < this._indexAttr.count; i += 3) {
        const faceId = i / 3;
        const a = this._indexAttr.getX(i);
        const b = this._indexAttr.getX(i + 1);
        const c = this._indexAttr.getX(i + 2);
        addEdge(a, b, faceId);
        addEdge(b, c, faceId);
        addEdge(c, a, faceId);
      }
    } else {
      for (let i = 0; i < this._vertexCount; i += 3) {
        const faceId = i / 3;
        addEdge(i, i + 1, faceId);
        addEdge(i + 1, i + 2, faceId);
        addEdge(i + 2, i, faceId);
      }
    }

    return this._edgeMap;
  }

  /**
   * Build spatial hash for vertices
   */
  _buildVertexMap(tolerance = this.options.weldTolerance) {
    if (this._vertexMap && this._vertexMapTolerance === tolerance) {
      return this._vertexMap;
    }
    
    this._vertexMap = new Map();
    this._vertexMapTolerance = tolerance;
    
    const pos = this._positionAttr;
    const scale = 1 / tolerance;
    
    for (let i = 0; i < pos.count; i++) {
      const x = Math.round(pos.getX(i) * scale);
      const y = Math.round(pos.getY(i) * scale);
      const z = Math.round(pos.getZ(i) * scale);
      const key = `${x},${y},${z}`;
      
      if (!this._vertexMap.has(key)) {
        this._vertexMap.set(key, []);
      }
      this._vertexMap.get(key).push(i);
    }
    
    return this._vertexMap;
  }

  // ============================================
  // Detection Methods
  // ============================================

  /**
   * Detect non-manifold edges (edges with != 2 adjacent faces)
   */
  _detectNonManifoldEdges(report) {
    let count = 0;
    const locations = [];
    const occurrences = [];
    const MAX_LOCATIONS = 2000; // cap point cloud size

    // Non-manifold = edge shared by 3+ faces. Boundary edges (1 face) are
    // reported separately by _detectOpenBoundaries.
    for (const [, edge] of this._edgeMap) {
      if (edge.faces.length > 2) {
        count++;
        if (locations.length < MAX_LOCATIONS * 3) {
          const v1 = edge.vertices[0];
          const v2 = edge.vertices[1];
          const mx = (this._positionAttr.getX(v1) + this._positionAttr.getX(v2)) / 2;
          const my = (this._positionAttr.getY(v1) + this._positionAttr.getY(v2)) / 2;
          const mz = (this._positionAttr.getZ(v1) + this._positionAttr.getZ(v2)) / 2;
          locations.push(mx, my, mz);
          occurrences.push({
            label: `Edge ${count}`,
            locations: [mx, my, mz],
          });
        }
      }
    }

    if (count > 0) {
      report.addIssue(new Issue(
        IssueTypes.NON_MANIFOLD_EDGES,
        count,
        new Float32Array(locations),
        `${count} non-manifold edge${count > 1 ? 's' : ''} found`,
        occurrences
      ));
    }
  }

  /**
   * Detect open boundaries (edges with only 1 adjacent face = holes)
   */
  _detectOpenBoundaries(report) {
    let count = 0;
    const locations = [];
    const occurrences = [];
    const MAX_LOCATIONS = 2000;

    for (const [, edge] of this._edgeMap) {
      if (edge.faces.length === 1) {
        edge.boundary = true;
        count++;
        if (locations.length < MAX_LOCATIONS * 3) {
          const v1 = edge.vertices[0];
          const v2 = edge.vertices[1];
          const mx = (this._positionAttr.getX(v1) + this._positionAttr.getX(v2)) / 2;
          const my = (this._positionAttr.getY(v1) + this._positionAttr.getY(v2)) / 2;
          const mz = (this._positionAttr.getZ(v1) + this._positionAttr.getZ(v2)) / 2;
          locations.push(mx, my, mz);
          occurrences.push({
            label: `Boundary ${count}`,
            locations: [mx, my, mz],
          });
        }
      }
    }

    if (count > 0) {
      report.addIssue(new Issue(
        IssueTypes.OPEN_BOUNDARIES,
        count,
        new Float32Array(locations),
        `${count} boundary edge${count > 1 ? 's' : ''} (holes) found`,
        occurrences
      ));
    }
  }

  /**
   * Detect inverted normals by checking if majority face outward
   */
  _detectInvertedNormals(report) {
    // Sample a subset of triangles for performance
    const sampleSize = Math.min(500, this._triangleCount);
    const step = Math.max(1, Math.floor(this._triangleCount / sampleSize));
    
    let outwardCount = 0;
    let inwardCount = 0;
    
    const pos = this._positionAttr;
    const center = new THREE.Vector3();
    this.geometry.boundingBox.getCenter(center);
    
    for (let i = 0; i < this._triangleCount; i += step) {
      let a, b, c;
      if (this._indexAttr) {
        a = this._indexAttr.getX(i * 3);
        b = this._indexAttr.getX(i * 3 + 1);
        c = this._indexAttr.getX(i * 3 + 2);
      } else {
        a = i * 3;
        b = i * 3 + 1;
        c = i * 3 + 2;
      }
      
      // Get triangle vertices
      const v0 = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a));
      const v1 = new THREE.Vector3(pos.getX(b), pos.getY(b), pos.getZ(b));
      const v2 = new THREE.Vector3(pos.getX(c), pos.getY(c), pos.getZ(c));
      
      // Compute face normal
      const edge1 = new THREE.Vector3().subVectors(v1, v0);
      const edge2 = new THREE.Vector3().subVectors(v2, v0);
      const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
      
      // Check if normal points away from center
      const faceCenter = new THREE.Vector3().add(v0).add(v1).add(v2).divideScalar(3);
      const toCenter = new THREE.Vector3().subVectors(center, faceCenter);
      
      if (normal.dot(toCenter) < 0) {
        outwardCount++;
      } else {
        inwardCount++;
      }
    }
    
    // Only flag inverted normals when a clear majority point inward.
    // The bounding-box-center heuristic is unreliable for hollow or thin
    // shapes, so require a strong majority before reporting.
    const sampled = inwardCount + outwardCount;
    if (sampled > 0 && inwardCount / sampled >= 0.7) {
      const estimated = Math.round(this._triangleCount * (inwardCount / sampled));
      report.addIssue(new Issue(
        IssueTypes.INVERTED_NORMALS,
        estimated,
        null,
        'Mesh appears to have inverted normals'
      ));
    }
  }

  /**
   * Detect duplicate vertices using spatial hash
   */
  _detectDuplicateVertices(report) {
    const vertexMap = this._buildVertexMap();
    let duplicateCount = 0;
    const locations = [];
    const occurrences = [];
    const MAX_LOCATIONS = 2000;
    
    for (const [, indices] of vertexMap) {
      if (indices.length > 1) {
        duplicateCount += indices.length - 1;
        if (locations.length < MAX_LOCATIONS * 3) {
          const vi = indices[0];
          locations.push(
            this._positionAttr.getX(vi),
            this._positionAttr.getY(vi),
            this._positionAttr.getZ(vi)
          );
          occurrences.push({
            label: `Cluster ${occurrences.length + 1}`,
            count: indices.length,
            locations: [
              this._positionAttr.getX(vi),
              this._positionAttr.getY(vi),
              this._positionAttr.getZ(vi),
            ],
          });
        }
      }
    }
    
    if (duplicateCount > 0) {
      report.addIssue(new Issue(
        IssueTypes.DUPLICATE_VERTICES,
        duplicateCount,
        new Float32Array(locations),
        `${duplicateCount} duplicate vertex${duplicateCount > 1 ? 's' : ''} found`,
        occurrences
      ));
    }
  }

  /**
   * Detect degenerate (zero-area) triangles
   */
  _detectDegenerateTriangles(report) {
    const pos = this._positionAttr;
    const tolerance = 1e-10;
    let degenerateCount = 0;
    const locations = [];
    const occurrences = [];
    const MAX_LOCATIONS = 2000;
    
    for (let i = 0; i < this._triangleCount; i++) {
      let a, b, c;
      if (this._indexAttr) {
        a = this._indexAttr.getX(i * 3);
        b = this._indexAttr.getX(i * 3 + 1);
        c = this._indexAttr.getX(i * 3 + 2);
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
      
      if (area < tolerance) {
        degenerateCount++;
        if (locations.length < MAX_LOCATIONS * 3) {
          locations.push(
            (v0.x + v1.x + v2.x) / 3,
            (v0.y + v1.y + v2.y) / 3,
            (v0.z + v1.z + v2.z) / 3
          );
          occurrences.push({
            label: `Triangle ${degenerateCount}`,
            locations: [
              (v0.x + v1.x + v2.x) / 3,
              (v0.y + v1.y + v2.y) / 3,
              (v0.z + v1.z + v2.z) / 3,
            ],
          });
        }
      }
    }
    
    if (degenerateCount > 0) {
      report.addIssue(new Issue(
        IssueTypes.DEGENERATE_TRIANGLES,
        degenerateCount,
        new Float32Array(locations),
        `${degenerateCount} degenerate triangle${degenerateCount > 1 ? 's' : ''} found`,
        occurrences
      ));
    }
  }

  /**
   * Detect self-intersections (expensive, uses BVH-like approach)
   * This is a simplified check - full implementation would use BVH
   */
  _detectSelfIntersections(report) {
    // Self-intersection detection is expensive O(n²)
    // For now, we'll do a limited sample check
    const sampleSize = Math.min(100, this._triangleCount);
    
    // Quick check: if mesh has boundary edges, it might have self-intersections
    let hasBoundary = false;
    for (const [key, edge] of this._edgeMap) {
      if (edge.faces.length === 1) {
        hasBoundary = true;
        break;
      }
    }
    
    // Full self-intersection detection would require BVH
    // For now, we'll skip this expensive check and rely on other indicators
    // A proper implementation would use three-mesh-bvh or similar
  }

  /**
   * Detect thin features (walls thinner than threshold)
   */
  _detectThinFeatures(report) {
    const threshold = this.options.thinFeatureThreshold;
    const printer = this.options.printerSpec;
    
    // Get bounding box dimensions
    const bb = this.geometry.boundingBox;
    const size = new THREE.Vector3();
    bb.getSize(size);
    
    // Check if any dimension is very thin
    const minDim = Math.min(size.x, size.y, size.z);
    
    if (minDim < threshold) {
      const locations = [];
      // Add corners of bounding box as reference points
      locations.push(bb.min.x, bb.min.y, bb.min.z);
      locations.push(bb.max.x, bb.max.y, bb.max.z);
      
      let description = `Thin feature detected (${minDim.toFixed(2)}mm)`;
      
      // Add printer-specific context if available
      if (printer) {
        const pixelSize = printer.buildWidthMM / printer.resolutionX;
        if (minDim < pixelSize * 2) {
          description += ` - below printer resolution (${(pixelSize * 1000).toFixed(1)}µm pixel)`;
        }
      }
      
      report.addIssue(new Issue(
        IssueTypes.THIN_FEATURES,
        1,
        new Float32Array(locations),
        description
      ));
    }
  }

  /**
   * Detect small disconnected components
   */
  _detectSmallComponents(report) {
    const triCount = this._triangleCount;
    if (triCount === 0) return;

    // Build connected components using union-find over triangles.
    const parent = new Int32Array(triCount);
    const rank = new Uint8Array(triCount);
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

    // Map every raw vertex index to a canonical (welded) vertex id, so that
    // triangles that share a vertex either by index or by spatial position get
    // connected. This is O(V) instead of O(V*T).
    let canonical = this._canonicalVertices;
    if (!canonical) {
      const vertexMap = this._buildVertexMap();
      canonical = new Int32Array(this._vertexCount);
      let canonId = 0;
      for (const [, indices] of vertexMap) {
        for (const vi of indices) canonical[vi] = canonId;
        canonId++;
      }
      this._canonicalVertices = canonical;
    }

    // For each canonical vertex, union all triangles incident on it. We build
    // the incidence list in a single pass and then union in a single pass.
    const vertexToTris = new Map();
    const idx = this._indexAttr;
    for (let ti = 0; ti < triCount; ti++) {
      let a, b, c;
      if (idx) {
        a = idx.getX(ti * 3);
        b = idx.getX(ti * 3 + 1);
        c = idx.getX(ti * 3 + 2);
      } else {
        a = ti * 3;
        b = ti * 3 + 1;
        c = ti * 3 + 2;
      }
      const ca = canonical[a];
      const cb = canonical[b];
      const cc = canonical[c];
      let list = vertexToTris.get(ca);
      if (!list) { list = []; vertexToTris.set(ca, list); }
      list.push(ti);
      if (cb !== ca) {
        list = vertexToTris.get(cb);
        if (!list) { list = []; vertexToTris.set(cb, list); }
        list.push(ti);
      }
      if (cc !== ca && cc !== cb) {
        list = vertexToTris.get(cc);
        if (!list) { list = []; vertexToTris.set(cc, list); }
        list.push(ti);
      }
    }

    for (const tris of vertexToTris.values()) {
      if (tris.length < 2) continue;
      const first = tris[0];
      for (let i = 1; i < tris.length; i++) union(first, tris[i]);
    }

    // Count component sizes
    const componentSizes = new Map();
    for (let i = 0; i < triCount; i++) {
      const root = find(i);
      componentSizes.set(root, (componentSizes.get(root) || 0) + 1);
    }

    if (componentSizes.size <= 1) return;

    // Find largest component first
    let largestComponent = 0;
    for (const size of componentSizes.values()) {
      if (size > largestComponent) largestComponent = size;
    }

    // Small component: < 0.1% of total or < 10 triangles, and far smaller than the largest
    const threshold = Math.max(10, triCount * 0.001);
    const smallComponentRoots = new Set();
    for (const [root, size] of componentSizes) {
      if (size === largestComponent) continue;
      if (size < threshold || size < largestComponent * 0.01) {
        smallComponentRoots.add(root);
      }
    }

    const smallComponentCount = smallComponentRoots.size;
    const locations = [];
    const occurrenceSums = new Map();
    const MAX_LOCATIONS = 2000;

    if (smallComponentCount > 0) {
      for (let ti = 0; ti < triCount && locations.length < MAX_LOCATIONS * 3; ti++) {
        const root = find(ti);
        if (!smallComponentRoots.has(root)) continue;
        let a, b, c;
        if (idx) {
          a = idx.getX(ti * 3);
          b = idx.getX(ti * 3 + 1);
          c = idx.getX(ti * 3 + 2);
        } else {
          a = ti * 3;
          b = ti * 3 + 1;
          c = ti * 3 + 2;
        }
        locations.push(
          (this._positionAttr.getX(a) + this._positionAttr.getX(b) + this._positionAttr.getX(c)) / 3,
          (this._positionAttr.getY(a) + this._positionAttr.getY(b) + this._positionAttr.getY(c)) / 3,
          (this._positionAttr.getZ(a) + this._positionAttr.getZ(b) + this._positionAttr.getZ(c)) / 3
        );
        let sum = occurrenceSums.get(root);
        if (!sum) {
          sum = { x: 0, y: 0, z: 0, count: 0 };
          occurrenceSums.set(root, sum);
        }
        sum.x += (this._positionAttr.getX(a) + this._positionAttr.getX(b) + this._positionAttr.getX(c)) / 3;
        sum.y += (this._positionAttr.getY(a) + this._positionAttr.getY(b) + this._positionAttr.getY(c)) / 3;
        sum.z += (this._positionAttr.getZ(a) + this._positionAttr.getZ(b) + this._positionAttr.getZ(c)) / 3;
        sum.count++;
      }
    }

    const occurrences = Array.from(occurrenceSums.values()).map((sum, index) => ({
      label: `Component ${index + 1}`,
      count: sum.count,
      locations: [sum.x / sum.count, sum.y / sum.count, sum.z / sum.count],
    }));

    if (smallComponentCount > 0) {
      report.addIssue(new Issue(
        IssueTypes.SMALL_COMPONENTS,
        smallComponentCount,
        new Float32Array(locations),
        `${smallComponentCount} small detached component${smallComponentCount > 1 ? 's' : ''} found`,
        occurrences
      ));
    }
  }

  /**
   * Detect scale issues relative to build plate
   */
  _detectScaleIssues(report) {
    const printer = this.options.printerSpec;
    if (!printer) return;
    
    const bb = this.geometry.boundingBox;
    const size = new THREE.Vector3();
    bb.getSize(size);
    
    const fitsWidth = size.x <= printer.buildWidthMM;
    const fitsDepth = size.z <= printer.buildDepthMM;
    const fitsHeight = size.y <= printer.buildHeightMM;
    
    if (!fitsWidth || !fitsDepth || !fitsHeight) {
      const exceedDims = [];
      if (!fitsWidth) exceedDims.push(`width ${size.x.toFixed(1)}mm > ${printer.buildWidthMM}mm`);
      if (!fitsDepth) exceedDims.push(`depth ${size.z.toFixed(1)}mm > ${printer.buildDepthMM}mm`);
      if (!fitsHeight) exceedDims.push(`height ${size.y.toFixed(1)}mm > ${printer.buildHeightMM}mm`);
      
      report.addIssue(new Issue(
        IssueTypes.SCALE_ISSUES,
        1,
        null,
        `Model exceeds build volume: ${exceedDims.join(', ')}`
      ));
    }
    
    // Also check for extremely small models
    const volume = size.x * size.y * size.z;
    if (volume < 100) { // Less than 100mm³
      report.addIssue(new Issue(
        IssueTypes.SCALE_ISSUES,
        1,
        null,
        'Model is very small - verify scale is correct'
      ));
    }
  }

  /**
   * Detect sharp overhangs that may need support
   */
  _detectSharpOverhangs(report) {
    const threshold = this.options.overhangAngle;
    const thresholdRad = (90 - threshold) * Math.PI / 180; // Convert overhang angle
    
    const pos = this._positionAttr;
    let overhangCount = 0;
    const locations = [];
    
    // Sample triangles for overhang detection
    const sampleSize = Math.min(1000, this._triangleCount);
    const step = Math.max(1, Math.floor(this._triangleCount / sampleSize));
    
    for (let i = 0; i < this._triangleCount; i += step) {
      let a, b, c;
      if (this._indexAttr) {
        a = this._indexAttr.getX(i * 3);
        b = this._indexAttr.getX(i * 3 + 1);
        c = this._indexAttr.getX(i * 3 + 2);
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
      
      // Check if face is facing downward (overhang)
      // normal.y < cos(thresholdRad) means overhang
      if (normal.y < Math.cos(thresholdRad) && normal.y < -0.01) {
        overhangCount++;
        // Add face center to locations
        const cx = (v0.x + v1.x + v2.x) / 3;
        const cy = (v0.y + v1.y + v2.y) / 3;
        const cz = (v0.z + v1.z + v2.z) / 3;
        locations.push(cx, cy, cz);
      }
    }
    
    if (overhangCount > 0) {
      // Scale count to estimate actual overhang triangles
      const estimatedCount = Math.round(overhangCount * step);
      report.addIssue(new Issue(
        IssueTypes.SHARP_OVERHANGS,
        estimatedCount,
        new Float32Array(locations.slice(0, 300)), // Limit locations for performance
        `~${estimatedCount} face${estimatedCount > 1 ? 's' : ''} with >${threshold}° overhang`
      ));
    }
  }
}

/**
 * Convenience function to inspect geometry
 */
export function inspectGeometry(geometry, options = {}) {
  const inspector = new ModelInspector(geometry, options);
  return inspector.runFullInspection();
}
