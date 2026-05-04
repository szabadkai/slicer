export interface UV {
  u: number;
  v: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PaintMaterial {
  id: number;
  name: string;
  color: string;
}

export interface PaintTexture {
  width: number;
  height: number;
  /**
   * One material id per texel. Use 0 for base/unpainted material.
   */
  materialIds: Uint8Array | Uint16Array;
  /**
   * Optional paint coverage per texel. Values below alphaThreshold resolve to base.
   */
  alpha?: Uint8Array;
}

export interface PaintLayer {
  objectId: string;
  texture: PaintTexture;
  materials: PaintMaterial[];
  alphaThreshold?: number;
}

export interface TriangleUVs {
  a: UV;
  b: UV;
  c: UV;
}

export interface Barycentric {
  a: number;
  b: number;
  c: number;
}

export interface SurfaceSample {
  point: Vec3;
  uv: UV;
  materialId: number;
}

export interface ToolpathPoint {
  x: number;
  y: number;
  z?: number;
  triangleUVs?: TriangleUVs;
  barycentric?: Barycentric;
  uv?: UV;
}

export interface MaterialSegment {
  materialId: number;
  startIndex: number;
  endIndex: number;
  lengthMM: number;
}

export interface SegmentOptions {
  /**
   * Ignore islands shorter than this by merging them into a neighboring segment.
   */
  minSegmentLengthMM: number;
  /**
   * Merge adjacent paths with material changes below machine resolution.
   */
  nozzleWidthMM: number;
}

export interface PaintPrintabilityReport {
  segmentCount: number;
  materialChangeCount: number;
  shortSegmentCount: number;
  paintedLengthMM: number;
  totalLengthMM: number;
  materialLengthsMM: Map<number, number>;
}

export function samplePaintTexture(
  texture: PaintTexture,
  uv: UV,
  alphaThreshold = 128,
): number {
  if (texture.width <= 0 || texture.height <= 0) return 0;
  if (texture.materialIds.length < texture.width * texture.height) return 0;

  const u = clamp01(uv.u);
  const v = clamp01(uv.v);
  const x = Math.min(texture.width - 1, Math.floor(u * texture.width));
  const y = Math.min(texture.height - 1, Math.floor((1 - v) * texture.height));
  const index = y * texture.width + x;

  if (texture.alpha && texture.alpha[index] < alphaThreshold) return 0;
  return texture.materialIds[index] ?? 0;
}

export function interpolateUV(barycentric: Barycentric, triangle: TriangleUVs): UV {
  return {
    u: triangle.a.u * barycentric.a + triangle.b.u * barycentric.b + triangle.c.u * barycentric.c,
    v: triangle.a.v * barycentric.a + triangle.b.v * barycentric.b + triangle.c.v * barycentric.c,
  };
}

export function materialAtToolpathPoint(point: ToolpathPoint, layer: PaintLayer): number {
  const uv = point.uv ??
    (point.triangleUVs && point.barycentric
      ? interpolateUV(point.barycentric, point.triangleUVs)
      : null);
  if (!uv) return 0;
  return samplePaintTexture(layer.texture, uv, layer.alphaThreshold);
}

export function samplePaintedToolpath(
  points: ToolpathPoint[],
  layer: PaintLayer,
): SurfaceSample[] {
  return points.map((point) => {
    const uv = point.uv ??
      (point.triangleUVs && point.barycentric
        ? interpolateUV(point.barycentric, point.triangleUVs)
        : { u: 0, v: 0 });
    return {
      point: { x: point.x, y: point.y, z: point.z ?? 0 },
      uv,
      materialId: materialAtToolpathPoint(point, layer),
    };
  });
}

export function segmentToolpathByPaint(
  points: ToolpathPoint[],
  layer: PaintLayer,
  options: SegmentOptions,
): MaterialSegment[] {
  if (points.length < 2) return [];

  const materialIds = points.map((point) => materialAtToolpathPoint(point, layer));
  const segments: MaterialSegment[] = [];
  let startIndex = 0;
  let currentMaterialId = materialIds[0];
  let lengthMM = 0;

  for (let i = 1; i < points.length; i++) {
    const step = distanceMM(points[i - 1], points[i]);
    const materialChanged = materialIds[i] !== currentMaterialId;

    if (materialChanged) {
      segments.push({
        materialId: currentMaterialId,
        startIndex,
        endIndex: i - 1,
        lengthMM,
      });
      startIndex = i;
      currentMaterialId = materialIds[i];
      lengthMM = step;
    } else {
      lengthMM += step;
    }
  }

  segments.push({
    materialId: currentMaterialId,
    startIndex,
    endIndex: points.length - 1,
    lengthMM,
  });

  return mergeUnprintableSegments(segments, {
    minSegmentLengthMM: Math.max(options.minSegmentLengthMM, options.nozzleWidthMM),
  });
}

export function analyzePaintSegments(
  segments: MaterialSegment[],
  options: SegmentOptions,
): PaintPrintabilityReport {
  const materialLengthsMM = new Map<number, number>();
  let totalLengthMM = 0;
  let paintedLengthMM = 0;
  let shortSegmentCount = 0;
  const minPrintableLength = Math.max(options.minSegmentLengthMM, options.nozzleWidthMM);

  for (const segment of segments) {
    totalLengthMM += segment.lengthMM;
    if (segment.materialId !== 0) paintedLengthMM += segment.lengthMM;
    if (segment.lengthMM < minPrintableLength) shortSegmentCount++;
    materialLengthsMM.set(
      segment.materialId,
      (materialLengthsMM.get(segment.materialId) ?? 0) + segment.lengthMM,
    );
  }

  return {
    segmentCount: segments.length,
    materialChangeCount: Math.max(0, segments.length - 1),
    shortSegmentCount,
    paintedLengthMM,
    totalLengthMM,
    materialLengthsMM,
  };
}

function mergeUnprintableSegments(
  segments: MaterialSegment[],
  options: { minSegmentLengthMM: number },
): MaterialSegment[] {
  const merged = segments.map((segment) => ({ ...segment }));
  let index = 0;

  while (index < merged.length) {
    const segment = merged[index];
    if (segment.lengthMM >= options.minSegmentLengthMM || merged.length === 1) {
      index++;
      continue;
    }

    const prev = merged[index - 1];
    const next = merged[index + 1];
    const target = chooseMergeTarget(prev, next);
    if (!target) {
      index++;
      continue;
    }

    target.lengthMM += segment.lengthMM;
    target.startIndex = Math.min(target.startIndex, segment.startIndex);
    target.endIndex = Math.max(target.endIndex, segment.endIndex);
    merged.splice(index, 1);
    index = Math.max(0, index - 1);
  }

  return coalesceAdjacentSegments(merged);
}

function chooseMergeTarget(
  prev: MaterialSegment | undefined,
  next: MaterialSegment | undefined,
): MaterialSegment | undefined {
  if (!prev) return next;
  if (!next) return prev;
  if (prev.materialId === next.materialId) return prev;
  return prev.lengthMM >= next.lengthMM ? prev : next;
}

function coalesceAdjacentSegments(segments: MaterialSegment[]): MaterialSegment[] {
  const coalesced: MaterialSegment[] = [];
  for (const segment of segments) {
    const prev = coalesced[coalesced.length - 1];
    if (prev && prev.materialId === segment.materialId) {
      prev.endIndex = segment.endIndex;
      prev.lengthMM += segment.lengthMM;
    } else {
      coalesced.push({ ...segment });
    }
  }
  return coalesced;
}

function distanceMM(a: ToolpathPoint, b: ToolpathPoint): number {
  const dz = (b.z ?? 0) - (a.z ?? 0);
  return Math.hypot(b.x - a.x, b.y - a.y, dz);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
