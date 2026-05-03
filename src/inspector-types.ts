/**
 * Inspector types, constants, and report classes.
 * Separated from inspector.ts to keep files ≤ 600 LOC.
 */

// ---------------------------------------------------------------------------
// Geometry interfaces (structural match for THREE.BufferGeometry)
// ---------------------------------------------------------------------------

export interface BufferAttributeLike {
  count: number;
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
  array: ArrayLike<number>;
}

export interface BoundingBoxLike {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export interface InspectorGeometry {
  attributes: { position: BufferAttributeLike };
  index: BufferAttributeLike | null;
  boundingBox: BoundingBoxLike | null;
  computeBoundingBox(): void;
}

export interface PrinterSpecLike {
  buildWidthMM: number;
  buildDepthMM: number;
  buildHeightMM: number;
  resolutionX: number;
}

export interface InspectorOptions {
  weldTolerance?: number;
  thinFeatureThreshold?: number;
  smallComponentThreshold?: number;
  overhangAngle?: number;
  printerSpec?: PrinterSpecLike | null;
}

// ---------------------------------------------------------------------------
// Severity & issue-type metadata
// ---------------------------------------------------------------------------

export const Severity = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
} as const;

export type SeverityLevel = (typeof Severity)[keyof typeof Severity];

export interface IssueType {
  id: string;
  name: string;
  severity: SeverityLevel;
  impact: string;
  autoFixable: boolean;
}

export const IssueTypes: Record<string, IssueType> = {
  NON_MANIFOLD_EDGES: {
    id: 'non-manifold-edges',
    name: 'Non-manifold edges',
    severity: Severity.ERROR,
    impact: 'Slice will fail or produce unexpected results',
    autoFixable: false,
  },
  OPEN_BOUNDARIES: {
    id: 'open-boundaries',
    name: 'Open boundaries (holes)',
    severity: Severity.ERROR,
    impact: 'Causes holes in sliced layers',
    autoFixable: false,
  },
  INVERTED_NORMALS: {
    id: 'inverted-normals',
    name: 'Inverted normals',
    severity: Severity.WARNING,
    impact: 'Incorrect inside/outside detection',
    autoFixable: true,
  },
  DUPLICATE_VERTICES: {
    id: 'duplicate-vertices',
    name: 'Duplicate vertices',
    severity: Severity.WARNING,
    impact: 'Wastes memory, may cause artifacts',
    autoFixable: true,
  },
  DEGENERATE_TRIANGLES: {
    id: 'degenerate-triangles',
    name: 'Degenerate triangles',
    severity: Severity.WARNING,
    impact: 'Zero-area triangles can cause issues',
    autoFixable: true,
  },
  SELF_INTERSECTIONS: {
    id: 'self-intersections',
    name: 'Self-intersections',
    severity: Severity.ERROR,
    impact: 'Causes unpredictable slicing',
    autoFixable: false,
  },
  THIN_FEATURES: {
    id: 'thin-features',
    name: 'Thin features',
    severity: Severity.INFO,
    impact: 'May not print correctly',
    autoFixable: false,
  },
  SMALL_COMPONENTS: {
    id: 'small-components',
    name: 'Small detached components',
    severity: Severity.INFO,
    impact: 'Often printing artifacts or debris',
    autoFixable: false,
  },
  SCALE_ISSUES: {
    id: 'scale-issues',
    name: 'Scale issues',
    severity: Severity.INFO,
    impact: 'May not fit on build plate',
    autoFixable: false,
  },
  SHARP_OVERHANGS: {
    id: 'sharp-overhangs',
    name: 'Sharp overhangs',
    severity: Severity.INFO,
    impact: 'Requires supports',
    autoFixable: false,
  },
};

// ---------------------------------------------------------------------------
// Issue & report classes
// ---------------------------------------------------------------------------

export interface IssueOccurrence {
  label: string;
  count?: number;
  locations: number[];
}

export class Issue {
  id: string;
  type: IssueType;
  severity: SeverityLevel;
  count: number;
  description: string;
  impact: string;
  autoFixable: boolean;
  locations: Float32Array | null;
  occurrences: IssueOccurrence[];

  constructor(
    type: IssueType,
    count: number,
    locations: Float32Array | null = null,
    description: string | null = null,
    occurrences: IssueOccurrence[] = [],
  ) {
    this.id = type.id;
    this.type = type;
    this.severity = type.severity;
    this.count = count;
    this.description = description ?? type.name;
    this.impact = type.impact;
    this.autoFixable = type.autoFixable;
    this.locations = locations;
    this.occurrences = occurrences;
  }
}

export type HealthRating = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

export class InspectionReport {
  timestamp: Date;
  geometry: {
    triangleCount: number;
    vertexCount: number;
    boundingBox: BoundingBoxLike | null;
    volume: number;
  };
  issues: Issue[];
  summary: { errors: number; warnings: number; info: number };
  overallHealth: HealthRating;

  constructor() {
    this.timestamp = new Date();
    this.geometry = { triangleCount: 0, vertexCount: 0, boundingBox: null, volume: 0 };
    this.issues = [];
    this.summary = { errors: 0, warnings: 0, info: 0 };
    this.overallHealth = 'excellent';
  }

  addIssue(issue: Issue): void {
    this.issues.push(issue);
    if (issue.severity === Severity.ERROR) this.summary.errors++;
    else if (issue.severity === Severity.WARNING) this.summary.warnings++;
    else this.summary.info++;
  }

  calculateHealth(): HealthRating {
    const { errors, warnings } = this.summary;
    if (errors > 0) {
      this.overallHealth = errors >= 3 ? 'critical' : 'poor';
    } else if (warnings > 0) {
      this.overallHealth = warnings >= 5 ? 'fair' : 'good';
    } else {
      this.overallHealth = this.summary.info > 0 ? 'good' : 'excellent';
    }
    return this.overallHealth;
  }

  getHealthScore(): number {
    const { errors, warnings, info } = this.summary;
    let score = 100;
    score -= errors * 25;
    score -= warnings * 5;
    score -= info * 2;
    return Math.max(0, Math.min(100, score));
  }

  getHealthColor(): string {
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
