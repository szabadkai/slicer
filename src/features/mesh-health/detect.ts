// ─── Mesh-health types & detection engine ──────────────────
// This module operates on raw geometry buffers (Float32Array positions)
// without importing THREE.js. The viewer-service hands us the data.

export type Severity = 'error' | 'warning' | 'info';

export type IssueTypeId =
  | 'non-manifold-edges'
  | 'holes'
  | 'inverted-normals'
  | 'degenerate-triangles'
  | 'self-intersections';

export interface IssueTypeMeta {
  id: IssueTypeId;
  name: string;
  severity: Severity;
  impact: string;
  autoFixable: boolean;
}

export const ISSUE_TYPES: Record<IssueTypeId, IssueTypeMeta> = {
  'non-manifold-edges': {
    id: 'non-manifold-edges',
    name: 'Non-manifold edges',
    severity: 'error',
    impact: 'Slice will fail or produce unexpected results',
    autoFixable: false,
  },
  holes: {
    id: 'holes',
    name: 'Holes (boundary loops)',
    severity: 'error',
    impact: 'Causes holes in sliced layers',
    autoFixable: true,
  },
  'inverted-normals': {
    id: 'inverted-normals',
    name: 'Inverted normals',
    severity: 'warning',
    impact: 'Incorrect inside/outside detection',
    autoFixable: true,
  },
  'degenerate-triangles': {
    id: 'degenerate-triangles',
    name: 'Degenerate triangles',
    severity: 'warning',
    impact: 'Zero-area triangles can cause issues',
    autoFixable: true,
  },
  'self-intersections': {
    id: 'self-intersections',
    name: 'Self-intersections',
    severity: 'error',
    impact: 'Causes unpredictable slicing',
    autoFixable: false,
  },
};

export interface HealthIssue {
  id: IssueTypeId;
  severity: Severity;
  count: number;
  description: string;
  autoFixable: boolean;
}

export interface HealthReport {
  triangleCount: number;
  vertexCount: number;
  issues: HealthIssue[];
  overallSeverity: Severity | 'healthy';
}

export type BadgeColor = 'green' | 'yellow' | 'red';

// ─── Core detection ────────────────────────────────────────

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array | null;
  triangleCount: number;
}

/**
 * Run full mesh inspection on raw triangle data (non-indexed, 3 verts per tri).
 */
export function inspectMesh(mesh: MeshData): HealthReport {
  const { positions, normals, triangleCount } = mesh;
  const vertexCount = positions.length / 3;
  const issues: HealthIssue[] = [];

  const edgeMap = buildEdgeMap(positions, triangleCount);

  const nonManifold = detectNonManifoldEdges(edgeMap);
  if (nonManifold > 0) {
    issues.push(makeIssue('non-manifold-edges', nonManifold));
  }

  const holes = detectHoles(edgeMap);
  if (holes > 0) {
    issues.push(makeIssue('holes', holes));
  }

  if (normals) {
    const inverted = detectInvertedNormals(positions, normals, triangleCount);
    if (inverted > 0) {
      issues.push(makeIssue('inverted-normals', inverted));
    }
  }

  const degenerate = detectDegenerateTriangles(positions, triangleCount);
  if (degenerate > 0) {
    issues.push(makeIssue('degenerate-triangles', degenerate));
  }

  return {
    triangleCount,
    vertexCount,
    issues,
    overallSeverity: computeOverallSeverity(issues),
  };
}

export function badgeColorFromSeverity(severity: Severity | 'healthy'): BadgeColor {
  switch (severity) {
    case 'error':
      return 'red';
    case 'warning':
      return 'yellow';
    case 'healthy':
    case 'info':
      return 'green';
  }
}

// ─── Edge map construction ─────────────────────────────────

interface EdgeEntry {
  faceCount: number;
}

type EdgeMap = Map<string, EdgeEntry>;

function quantize(v: number): number {
  return Math.round(v * 1000);
}

function vertexKey(positions: Float32Array, idx: number): string {
  const base = idx * 3;
  return `${quantize(positions[base])},${quantize(positions[base + 1])},${quantize(positions[base + 2])}`;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function buildEdgeMap(positions: Float32Array, triangleCount: number): EdgeMap {
  const map: EdgeMap = new Map();

  for (let tri = 0; tri < triangleCount; tri++) {
    const base = tri * 3;
    const ka = vertexKey(positions, base);
    const kb = vertexKey(positions, base + 1);
    const kc = vertexKey(positions, base + 2);

    addEdge(map, ka, kb);
    addEdge(map, kb, kc);
    addEdge(map, kc, ka);
  }

  return map;
}

function addEdge(map: EdgeMap, a: string, b: string): void {
  if (a === b) return; // degenerate
  const key = edgeKey(a, b);
  const entry = map.get(key);
  if (entry) {
    entry.faceCount++;
  } else {
    map.set(key, { faceCount: 1 });
  }
}

// ─── Detectors ─────────────────────────────────────────────

function detectNonManifoldEdges(edgeMap: EdgeMap): number {
  let count = 0;
  for (const entry of edgeMap.values()) {
    if (entry.faceCount > 2) count++;
  }
  return count;
}

function detectHoles(edgeMap: EdgeMap): number {
  let count = 0;
  for (const entry of edgeMap.values()) {
    if (entry.faceCount === 1) count++;
  }
  return count;
}

function detectInvertedNormals(
  positions: Float32Array,
  normals: Float32Array,
  triangleCount: number,
): number {
  let count = 0;

  for (let tri = 0; tri < triangleCount; tri++) {
    const base = tri * 9; // 3 verts × 3 components
    // Compute face normal via cross product of two edges
    const ax = positions[base + 3] - positions[base];
    const ay = positions[base + 4] - positions[base + 1];
    const az = positions[base + 5] - positions[base + 2];
    const bx = positions[base + 6] - positions[base];
    const by = positions[base + 7] - positions[base + 1];
    const bz = positions[base + 8] - positions[base + 2];

    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;

    // Average stored normal for this triangle
    const nBase = tri * 9;
    const snx = normals[nBase] + normals[nBase + 3] + normals[nBase + 6];
    const sny = normals[nBase + 1] + normals[nBase + 4] + normals[nBase + 7];
    const snz = normals[nBase + 2] + normals[nBase + 5] + normals[nBase + 8];

    // If dot product is negative → normals point opposite to winding
    const dot = nx * snx + ny * sny + nz * snz;
    if (dot < 0) count++;
  }

  return count;
}

function detectDegenerateTriangles(
  positions: Float32Array,
  triangleCount: number,
): number {
  const AREA_THRESHOLD = 1e-10;
  let count = 0;

  for (let tri = 0; tri < triangleCount; tri++) {
    const base = tri * 9;
    const ax = positions[base + 3] - positions[base];
    const ay = positions[base + 4] - positions[base + 1];
    const az = positions[base + 5] - positions[base + 2];
    const bx = positions[base + 6] - positions[base];
    const by = positions[base + 7] - positions[base + 1];
    const bz = positions[base + 8] - positions[base + 2];

    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const areaSq = cx * cx + cy * cy + cz * cz;

    if (areaSq < AREA_THRESHOLD) count++;
  }

  return count;
}

// ─── Helpers ───────────────────────────────────────────────

function makeIssue(id: IssueTypeId, count: number): HealthIssue {
  const meta = ISSUE_TYPES[id];
  return {
    id,
    severity: meta.severity,
    count,
    description: `${count} ${meta.name.toLowerCase()} found`,
    autoFixable: meta.autoFixable,
  };
}

function computeOverallSeverity(issues: HealthIssue[]): Severity | 'healthy' {
  let worst: Severity | 'healthy' = 'healthy';
  for (const issue of issues) {
    if (issue.severity === 'error') return 'error';
    if (issue.severity === 'warning') worst = 'warning';
    if (issue.severity === 'info' && worst === 'healthy') worst = 'info';
  }
  return worst;
}
