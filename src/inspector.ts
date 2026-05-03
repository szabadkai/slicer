/**
 * Model Inspector — Analyzes 3D models for common printability issues.
 *
 * No THREE.js dependency: accepts geometry via the structural InspectorGeometry
 * interface (satisfied by THREE.BufferGeometry without importing three).
 */

import {
  type BufferAttributeLike,
  type InspectorGeometry,
  type InspectorOptions,
  type IssueOccurrence,
  type PrinterSpecLike,
  Severity,
  IssueTypes,
  Issue,
  InspectionReport,
} from './inspector-types';

// Re-export so callers can keep a single import site.
export { Severity, IssueTypes, Issue, InspectionReport };
export type {
  BufferAttributeLike,
  InspectorGeometry,
  InspectorOptions,
  IssueOccurrence,
  PrinterSpecLike,
} from './inspector-types';

const MAX_LOCATIONS = 2000;

interface EdgeEntry {
  faces: number[];
  boundary: boolean;
  vertices: [number, number];
}

interface ResolvedOptions {
  weldTolerance: number;
  thinFeatureThreshold: number;
  smallComponentThreshold: number;
  overhangAngle: number;
  printerSpec: PrinterSpecLike | null;
}

// ---------------------------------------------------------------------------
// ModelInspector
// ---------------------------------------------------------------------------

export class ModelInspector {
  geometry: InspectorGeometry;
  private opts: ResolvedOptions;
  private pos!: BufferAttributeLike;
  private idx!: BufferAttributeLike | null;
  private vertCount = 0;
  private triCount = 0;
  private edgeMap: Map<string, EdgeEntry> | null = null;
  private vertexMap: Map<string, number[]> | null = null;
  private vertexMapTolerance = 0;
  private canonical: Int32Array | null = null;

  constructor(geometry: InspectorGeometry, options: InspectorOptions = {}) {
    this.geometry = geometry;
    this.opts = {
      weldTolerance: options.weldTolerance ?? 0.001,
      thinFeatureThreshold: options.thinFeatureThreshold ?? 0.3,
      smallComponentThreshold: options.smallComponentThreshold ?? 1.0,
      overhangAngle: options.overhangAngle ?? 45,
      printerSpec: options.printerSpec ?? null,
    };
  }

  runFullInspection(): InspectionReport {
    const report = new InspectionReport();
    if (!this.geometry?.attributes?.position) {
      report.addIssue(new Issue(IssueTypes.SCALE_ISSUES, 1, null, 'Invalid geometry'));
      return report;
    }
    this._cache();
    report.geometry.triangleCount = this.triCount;
    report.geometry.vertexCount = this.vertCount;
    this.geometry.computeBoundingBox();
    const bb = this.geometry.boundingBox;
    if (bb) report.geometry.boundingBox = { min: { ...bb.min }, max: { ...bb.max } };
    this._detectAll(report);
    report.calculateHealth();
    return report;
  }

  // ---- internal helpers ---------------------------------------------------

  private _cache(): void {
    this.pos = this.geometry.attributes.position;
    this.idx = this.geometry.index;
    this.vertCount = this.pos.count;
    this.triCount = this.idx ? Math.floor(this.idx.count / 3) : Math.floor(this.vertCount / 3);
  }

  private _detectAll(report: InspectionReport): void {
    this._buildEdgeMap();
    this._detectNonManifoldEdges(report);
    this._detectOpenBoundaries(report);
    this._detectInvertedNormals(report);
    this._detectDuplicateVertices(report);
    this._detectDegenerateTriangles(report);
    this._detectThinFeatures(report);
    this._detectSmallComponents(report);
    this._detectScaleIssues(report);
    this._detectSharpOverhangs(report);
  }

  private _buildEdgeMap(): Map<string, EdgeEntry> {
    if (this.edgeMap) return this.edgeMap;
    const vmap = this._buildVertexMap();
    const canonical = new Int32Array(this.vertCount);
    let canonId = 0;
    for (const indices of vmap.values()) {
      for (const vi of indices) canonical[vi] = canonId;
      canonId++;
    }
    this.canonical = canonical;
    this.edgeMap = new Map();
    const edgeMap = this.edgeMap;

    const addEdge = (rawV1: number, rawV2: number, faceId: number): void => {
      const c1 = canonical[rawV1], c2 = canonical[rawV2];
      if (c1 === c2) return;
      const key = c1 < c2 ? `${c1}_${c2}` : `${c2}_${c1}`;
      let entry = edgeMap.get(key);
      if (!entry) {
        entry = { faces: [], boundary: false, vertices: [rawV1, rawV2] };
        edgeMap.set(key, entry);
      }
      entry.faces.push(faceId);
    };

    if (this.idx) {
      for (let i = 0; i < this.idx.count; i += 3) {
        const f = i / 3;
        const a = this.idx.getX(i), b = this.idx.getX(i + 1), c = this.idx.getX(i + 2);
        addEdge(a, b, f); addEdge(b, c, f); addEdge(c, a, f);
      }
    } else {
      for (let i = 0; i < this.vertCount; i += 3) {
        const f = i / 3;
        addEdge(i, i + 1, f); addEdge(i + 1, i + 2, f); addEdge(i + 2, i, f);
      }
    }
    return this.edgeMap;
  }

  private _buildVertexMap(tolerance: number = this.opts.weldTolerance): Map<string, number[]> {
    if (this.vertexMap && this.vertexMapTolerance === tolerance) return this.vertexMap;
    this.vertexMap = new Map();
    this.vertexMapTolerance = tolerance;
    const scale = 1 / tolerance;
    for (let i = 0; i < this.pos.count; i++) {
      const key = `${Math.round(this.pos.getX(i) * scale)},${Math.round(this.pos.getY(i) * scale)},${Math.round(this.pos.getZ(i) * scale)}`;
      let arr = this.vertexMap.get(key);
      if (!arr) { arr = []; this.vertexMap.set(key, arr); }
      arr.push(i);
    }
    return this.vertexMap;
  }

  private _triVerts(ti: number): [number, number, number] {
    if (this.idx) return [this.idx.getX(ti * 3), this.idx.getX(ti * 3 + 1), this.idx.getX(ti * 3 + 2)];
    return [ti * 3, ti * 3 + 1, ti * 3 + 2];
  }

  // ---- detection methods --------------------------------------------------

  private _detectNonManifoldEdges(report: InspectionReport): void {
    let count = 0;
    const locs: number[] = [], occs: IssueOccurrence[] = [];
    const edgeMap = this.edgeMap ?? new Map();
    for (const edge of edgeMap.values()) {
      if (edge.faces.length > 2) {
        count++;
        if (locs.length < MAX_LOCATIONS * 3) {
          const [v1, v2] = edge.vertices;
          const mx = (this.pos.getX(v1) + this.pos.getX(v2)) / 2;
          const my = (this.pos.getY(v1) + this.pos.getY(v2)) / 2;
          const mz = (this.pos.getZ(v1) + this.pos.getZ(v2)) / 2;
          locs.push(mx, my, mz);
          occs.push({ label: `Edge ${count}`, locations: [mx, my, mz] });
        }
      }
    }
    if (count > 0) {
      report.addIssue(new Issue(
        IssueTypes.NON_MANIFOLD_EDGES, count, new Float32Array(locs),
        `${count} non-manifold edge${count > 1 ? 's' : ''} found`, occs,
      ));
    }
  }

  private _detectOpenBoundaries(report: InspectionReport): void {
    let count = 0;
    const locs: number[] = [], occs: IssueOccurrence[] = [];
    const edgeMap = this.edgeMap ?? new Map();
    for (const edge of edgeMap.values()) {
      if (edge.faces.length === 1) {
        edge.boundary = true;
        count++;
        if (locs.length < MAX_LOCATIONS * 3) {
          const [v1, v2] = edge.vertices;
          const mx = (this.pos.getX(v1) + this.pos.getX(v2)) / 2;
          const my = (this.pos.getY(v1) + this.pos.getY(v2)) / 2;
          const mz = (this.pos.getZ(v1) + this.pos.getZ(v2)) / 2;
          locs.push(mx, my, mz);
          occs.push({ label: `Boundary ${count}`, locations: [mx, my, mz] });
        }
      }
    }
    if (count > 0) {
      report.addIssue(new Issue(
        IssueTypes.OPEN_BOUNDARIES, count, new Float32Array(locs),
        `${count} boundary edge${count > 1 ? 's' : ''} (holes) found`, occs,
      ));
    }
  }

  private _detectInvertedNormals(report: InspectionReport): void {
    const sampleSize = Math.min(500, this.triCount);
    const step = Math.max(1, Math.floor(this.triCount / sampleSize));
    const bb = this.geometry.boundingBox;
    if (!bb) return;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cy = (bb.min.y + bb.max.y) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    let outward = 0, inward = 0;

    for (let i = 0; i < this.triCount; i += step) {
      const [ai, bi, ci] = this._triVerts(i);
      const ax = this.pos.getX(ai), ay = this.pos.getY(ai), az = this.pos.getZ(ai);
      const bx = this.pos.getX(bi), by = this.pos.getY(bi), bz = this.pos.getZ(bi);
      const ccx = this.pos.getX(ci), ccy = this.pos.getY(ci), ccz = this.pos.getZ(ci);
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = ccx - ax, e2y = ccy - ay, e2z = ccz - az;
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl > 0) { nx /= nl; ny /= nl; nz /= nl; }
      const fx = (ax + bx + ccx) / 3, fy = (ay + by + ccy) / 3, fz = (az + bz + ccz) / 3;
      if (nx * (cx - fx) + ny * (cy - fy) + nz * (cz - fz) < 0) outward++;
      else inward++;
    }
    const sampled = inward + outward;
    if (sampled > 0 && inward / sampled >= 0.7) {
      const estimated = Math.round(this.triCount * (inward / sampled));
      report.addIssue(new Issue(IssueTypes.INVERTED_NORMALS, estimated, null, 'Mesh appears to have inverted normals'));
    }
  }

  private _detectDuplicateVertices(report: InspectionReport): void {
    const vmap = this._buildVertexMap();
    let dup = 0;
    const locs: number[] = [], occs: IssueOccurrence[] = [];
    for (const indices of vmap.values()) {
      if (indices.length > 1) {
        dup += indices.length - 1;
        if (locs.length < MAX_LOCATIONS * 3) {
          const vi = indices[0];
          const x = this.pos.getX(vi), y = this.pos.getY(vi), z = this.pos.getZ(vi);
          locs.push(x, y, z);
          occs.push({ label: `Cluster ${occs.length + 1}`, count: indices.length, locations: [x, y, z] });
        }
      }
    }
    if (dup > 0) {
      report.addIssue(new Issue(
        IssueTypes.DUPLICATE_VERTICES, dup, new Float32Array(locs),
        `${dup} duplicate vertex${dup > 1 ? 'es' : ''} found`, occs,
      ));
    }
  }

  private _detectDegenerateTriangles(report: InspectionReport): void {
    const tolerance = 1e-10;
    let count = 0;
    const locs: number[] = [], occs: IssueOccurrence[] = [];
    for (let i = 0; i < this.triCount; i++) {
      const [ai, bi, ci] = this._triVerts(i);
      const ax = this.pos.getX(ai), ay = this.pos.getY(ai), az = this.pos.getZ(ai);
      const bx = this.pos.getX(bi), by = this.pos.getY(bi), bz = this.pos.getZ(bi);
      const cx = this.pos.getX(ci), cy = this.pos.getY(ci), cz = this.pos.getZ(ci);
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      const crx = e1y * e2z - e1z * e2y, cry = e1z * e2x - e1x * e2z, crz = e1x * e2y - e1y * e2x;
      if (Math.sqrt(crx * crx + cry * cry + crz * crz) / 2 < tolerance) {
        count++;
        if (locs.length < MAX_LOCATIONS * 3) {
          const fx = (ax + bx + cx) / 3, fy = (ay + by + cy) / 3, fz = (az + bz + cz) / 3;
          locs.push(fx, fy, fz);
          occs.push({ label: `Triangle ${count}`, locations: [fx, fy, fz] });
        }
      }
    }
    if (count > 0) {
      report.addIssue(new Issue(
        IssueTypes.DEGENERATE_TRIANGLES, count, new Float32Array(locs),
        `${count} degenerate triangle${count > 1 ? 's' : ''} found`, occs,
      ));
    }
  }

  private _detectThinFeatures(report: InspectionReport): void {
    const threshold = this.opts.thinFeatureThreshold;
    const bb = this.geometry.boundingBox;
    if (!bb) return;
    const sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z;
    const minDim = Math.min(sx, sy, sz);
    if (minDim < threshold) {
      const locs = new Float32Array([bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z]);
      let desc = `Thin feature detected (${minDim.toFixed(2)}mm)`;
      const printer = this.opts.printerSpec;
      if (printer) {
        const px = printer.buildWidthMM / printer.resolutionX;
        if (minDim < px * 2) desc += ` - below printer resolution (${(px * 1000).toFixed(1)}µm pixel)`;
      }
      report.addIssue(new Issue(IssueTypes.THIN_FEATURES, 1, locs, desc));
    }
  }

  private _detectSmallComponents(report: InspectionReport): void {
    if (this.triCount === 0) return;
    const parent = new Int32Array(this.triCount);
    const rank = new Uint8Array(this.triCount);
    for (let i = 0; i < this.triCount; i++) parent[i] = i;

    const find = (x: number): number => {
      let r = x;
      while (parent[r] !== r) r = parent[r];
      while (parent[x] !== x) { const n = parent[x]; parent[x] = r; x = n; }
      return r;
    };
    const union = (a: number, b: number): void => {
      let rA = find(a), rB = find(b);
      if (rA === rB) return;
      if (rank[rA] < rank[rB]) { const t = rA; rA = rB; rB = t; }
      parent[rB] = rA;
      if (rank[rA] === rank[rB]) rank[rA]++;
    };

    let canonical = this.canonical;
    if (!canonical) {
      const vmap = this._buildVertexMap();
      canonical = new Int32Array(this.vertCount);
      let cid = 0;
      for (const indices of vmap.values()) { for (const vi of indices) canonical[vi] = cid; cid++; }
      this.canonical = canonical;
    }

    const vtMap = new Map<number, number[]>();
    for (let ti = 0; ti < this.triCount; ti++) {
      const [a, b, c] = this._triVerts(ti);
      const ca = canonical[a], cb = canonical[b], cc = canonical[c];
      for (const cv of [ca, cb, cc]) {
        if (cv === ca || cv === cb || cv === cc) {
          let list = vtMap.get(cv);
          if (!list) { list = []; vtMap.set(cv, list); }
          if (list[list.length - 1] !== ti) list.push(ti);
        }
      }
    }
    for (const tris of vtMap.values()) {
      if (tris.length < 2) continue;
      for (let i = 1; i < tris.length; i++) union(tris[0], tris[i]);
    }

    const sizes = new Map<number, number>();
    for (let i = 0; i < this.triCount; i++) {
      const r = find(i);
      sizes.set(r, (sizes.get(r) ?? 0) + 1);
    }
    if (sizes.size <= 1) return;

    let largest = 0;
    for (const s of sizes.values()) if (s > largest) largest = s;
    const threshold = Math.max(10, this.triCount * 0.001);
    const smallRoots = new Set<number>();
    for (const [root, size] of sizes) {
      if (size !== largest && (size < threshold || size < largest * 0.01)) smallRoots.add(root);
    }
    if (smallRoots.size === 0) return;

    const locs: number[] = [];
    const sums = new Map<number, { x: number; y: number; z: number; count: number }>();
    for (let ti = 0; ti < this.triCount && locs.length < MAX_LOCATIONS * 3; ti++) {
      const root = find(ti);
      if (!smallRoots.has(root)) continue;
      const [a, b, c] = this._triVerts(ti);
      const fx = (this.pos.getX(a) + this.pos.getX(b) + this.pos.getX(c)) / 3;
      const fy = (this.pos.getY(a) + this.pos.getY(b) + this.pos.getY(c)) / 3;
      const fz = (this.pos.getZ(a) + this.pos.getZ(b) + this.pos.getZ(c)) / 3;
      locs.push(fx, fy, fz);
      let s = sums.get(root);
      if (!s) { s = { x: 0, y: 0, z: 0, count: 0 }; sums.set(root, s); }
      s.x += fx; s.y += fy; s.z += fz; s.count++;
    }
    const occs = Array.from(sums.values()).map((s, i) => ({
      label: `Component ${i + 1}`,
      count: s.count,
      locations: [s.x / s.count, s.y / s.count, s.z / s.count],
    }));
    report.addIssue(new Issue(
      IssueTypes.SMALL_COMPONENTS, smallRoots.size, new Float32Array(locs),
      `${smallRoots.size} small detached component${smallRoots.size > 1 ? 's' : ''} found`, occs,
    ));
  }

  private _detectScaleIssues(report: InspectionReport): void {
    const printer = this.opts.printerSpec;
    if (!printer) return;
    const bb = this.geometry.boundingBox;
    if (!bb) return;
    const sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z;
    const fitsW = sx <= printer.buildWidthMM;
    const fitsD = sz <= printer.buildDepthMM;
    const fitsH = sy <= printer.buildHeightMM;
    if (!fitsW || !fitsD || !fitsH) {
      const dims: string[] = [];
      if (!fitsW) dims.push(`width ${sx.toFixed(1)}mm > ${printer.buildWidthMM}mm`);
      if (!fitsD) dims.push(`depth ${sz.toFixed(1)}mm > ${printer.buildDepthMM}mm`);
      if (!fitsH) dims.push(`height ${sy.toFixed(1)}mm > ${printer.buildHeightMM}mm`);
      report.addIssue(new Issue(IssueTypes.SCALE_ISSUES, 1, null, `Model exceeds build volume: ${dims.join(', ')}`));
    }
    if (sx * sy * sz < 100) {
      report.addIssue(new Issue(IssueTypes.SCALE_ISSUES, 1, null, 'Model is very small - verify scale is correct'));
    }
  }

  private _detectSharpOverhangs(report: InspectionReport): void {
    const threshDeg = this.opts.overhangAngle;
    const threshRad = (90 - threshDeg) * Math.PI / 180;
    const cosThresh = Math.cos(threshRad);
    const sampleSize = Math.min(1000, this.triCount);
    const step = Math.max(1, Math.floor(this.triCount / sampleSize));
    let count = 0;
    const locs: number[] = [];

    for (let i = 0; i < this.triCount; i += step) {
      const [ai, bi, ci] = this._triVerts(i);
      const ax = this.pos.getX(ai), ay = this.pos.getY(ai), az = this.pos.getZ(ai);
      const bx = this.pos.getX(bi), by = this.pos.getY(bi), bz = this.pos.getZ(bi);
      const cx = this.pos.getX(ci), cy = this.pos.getY(ci), cz = this.pos.getZ(ci);
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      let ny = e1z * e2x - e1x * e2z;
      const nx = e1y * e2z - e1z * e2y, nz = e1x * e2y - e1y * e2x;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl > 0) ny /= nl;
      if (ny < cosThresh && ny < -0.01) {
        count++;
        locs.push((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3);
      }
    }
    if (count > 0) {
      const estimated = Math.round(count * step);
      report.addIssue(new Issue(
        IssueTypes.SHARP_OVERHANGS, estimated, new Float32Array(locs.slice(0, 300)),
        `~${estimated} face${estimated > 1 ? 's' : ''} with >${threshDeg}° overhang`,
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience function
// ---------------------------------------------------------------------------

export function inspectGeometry(
  geometry: InspectorGeometry,
  options: InspectorOptions = {},
): InspectionReport {
  const inspector = new ModelInspector(geometry, options);
  return inspector.runFullInspection();
}
