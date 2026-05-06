/**
 * Typed interfaces for legacy JS modules (viewer.js, slicer.js).
 * These describe the subset of methods used by TypeScript feature panels.
 * The actual implementations live in the .js files — these are compile-time only.
 */

import type { PrinterSpec, ResinMaterial } from './types';
import type { PrimitiveParams, PrimitiveTransform } from './primitives';

// ─── Geometry-like plain objects (avoids THREE.js imports) ──

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ─── Legacy scene object (wraps a THREE.Mesh) ──────────────

export interface LegacyObject {
  id: string;
  mesh: {
    name: string;
    geometry: unknown;
    material: unknown;
    position: Vec3;
    rotation: Vec3 & { order?: string };
    scale: Vec3;
    getWorldPosition(target: Vec3): Vec3;
    updateMatrixWorld(force?: boolean): void;
    parent?: { remove(child: unknown): void } | null;
  };
  supportsMesh?: {
    geometry: { dispose(): void };
    material: { dispose(): void };
    parent?: { remove(child: unknown): void } | null;
  } | null;
  elevation: number;
  intentBuffer?: Uint8Array;
  _cachedLocalVolume?: number;
  _cachedLocalSupportVolume?: number;
}

// ─── Legacy Viewer (src/viewer.js) ──────────────────────────

export interface LegacyViewer {
  readonly canvas: HTMLCanvasElement;
  readonly camera: unknown;
  readonly controls: unknown;
  readonly scene: unknown;
  readonly selected: LegacyObject[];
  readonly objects: LegacyObject[];
  readonly printer: PrinterSpec | null;
  readonly transformControl: unknown;

  // Lifecycle
  requestRender(): void;
  bindInitialPlate(plate: LegacyPlate): void;

  // STL loading
  loadSTL(buffer: ArrayBuffer, scale?: number): void;

  // Parsed geometry loading (CAD imports)
  loadParsedGeometry(parsed: {
    positions: Float32Array;
    normals: Float32Array;
    triangleCount: number;
  }): void;

  // Selection
  clearSelection(): void;
  selectObject(id: string): void;
  selectObjects(ids: string[]): void;
  selectAll(): void;
  toggleSelection(id: string): void;

  // Transform
  setTransformMode(mode: string | null): void;
  paintToolEnabled: boolean;
  setPaintToolEnabled?(enabled: boolean): void;
  setPaintBrush?(brush: {
    radiusMM?: number;
    color?: number;
    density?: number;
    depthMM?: number;
    bumpStrength?: number;
    pattern?: number;
    patternScaleMM?: number;
  }): void;
  undoPaintStroke?(): void;
  clearPaint?(): void;
  paintAll?(targets: 'all' | 'selected'): void;
  paintVolume?(params: PrimitiveParams, transform: PrimitiveTransform): void;
  getPaintStrokeCount?(): number;
  getPaintSliceMarks?(): PaintSliceMark[];
  getPaintTextureConfig?(): PaintTextureConfig;
  translateSelectionTo(position: Vec3): void;
  scaleSelectionBy(scale: Vec3): void;
  rotateSelectionBy(rotation: Vec3): void;
  getSelectionWorldSize(): Vec3 | null;
  getSelectionWorldCenter(): Vec3 | null;
  getSelectionWorldBounds?(): { min: Vec3; max: Vec3 } | null;
  setElevation(elevation: number): void;
  applyRotation(quaternion: unknown): void;

  // Intent painting
  intentPaintMode: boolean;
  intentBrushRadiusMM: number;
  setIntentPaintMode(enabled: boolean): void;

  // Intent overlay management (delegates THREE.js internally)
  showIntentOverlay(objectId: string, intentBuffer: Uint8Array): void;
  clearIntentOverlay(): void;
  getObjectTriangleCount(objectId: string): number | null;

  // Overhang overlay management
  showOverhangOverlay(
    objectId: string,
    supportContacts: Array<{ x: number; y: number; z: number }>,
    overhangParams?: { angleDeg?: number },
    coverageRadius?: number,
  ): void;
  clearOverhangOverlay(): void;

  // Edit operations
  duplicateSelected(): void;
  removeSelected(): void;
  clearPlate(): void;
  fillPlatform(): boolean;
  autoArrange(padding?: number, elevation?: number): void;
  distributeAcrossPlates(plates: LegacyPlate[], padding?: number, elevation?: number): boolean;
  undo(): void;
  redo(): void;
  copySelected(): void;
  paste(): void;
  _saveUndoState?(): void;
  cutSelectedByAxisPlane?(axis: 'x' | 'y' | 'z', worldOffset: number): boolean | Promise<boolean>;
  cutSelectedByPlane?(worldNormal: Vec3, worldConstant: number): boolean | Promise<boolean>;
  previewCutPlane?(axis: 'x' | 'y' | 'z', worldOffset: number): boolean;
  editCutPlane?(axis: 'x' | 'y' | 'z', worldOffset: number, mode?: 'translate' | 'rotate'): boolean;
  clearCutPlanePreview?(): void;
  getCutPlaneState?(): {
    axis: 'x' | 'y' | 'z';
    position: number;
    normal: Vec3;
    constant: number;
  } | null;

  // Plate management
  setPlates(plates: LegacyPlate[]): void;
  setActivePlate(plate: LegacyPlate): void;
  frameAllPlates(): void;
  replaceActiveObjects(objects: LegacyObject[]): void;
  moveSelectedToPlate(targetPlate: LegacyPlate): LegacyObject[];
  duplicateObjectsForPlate(objects?: LegacyObject[]): LegacyObject[];

  // Material
  setDefaultMaterialPreset(preset: ResinMaterial): void;
  setMaterialPreset(preset: ResinMaterial, target: 'selection' | 'all'): void;
  getActiveMaterialPreset(): ResinMaterial | null;

  // Printer
  setPrinter(spec: PrinterSpec): void;
  updateBoundsWarning(): void;

  // Cutter preview
  addCutterPreview?(positions: Float32Array): string;
  updateCutterPreview?(id: string, position: Vec3, rotation: Vec3, scale: Vec3): void;
  removeCutterPreview?(id: string): void;
  setCutterGizmo?(id: string, mode: 'translate' | 'rotate' | 'scale'): void;
  clearCutterGizmo?(): void;
  onCutterGizmoChange?(callback: (position: Vec3, rotation: Vec3, scale: Vec3) => void): () => void;
  getModelPositions?(id: string): Float32Array | null;

  // Geometry access
  getModelGeometry(): unknown | null;
  getMergedModelGeometry(): unknown | null;
  getMergedSupportGeometry(): unknown | null;
  getOverallInfo(): OverallInfo | null;

  // Supports
  setSupports(geometry: unknown): void;
  clearSupports(): void;

  // Support heatmap
  buildSupportHeatmapGeometry?(
    targets: LegacyObject[],
    overhangAngleDeg: number,
  ): { geometry: unknown; area: number; triangleCount: number } | null;
  showSupportHeatmap?(result: { geometry: unknown; area: number; triangleCount: number }): void;
  clearSupportHeatmap?(): void;

  // Thickness heatmap
  buildThicknessHeatmapGeometry?(
    targets: LegacyObject[],
    minThresholdMM: number,
    maxThresholdMM: number,
  ): { geometry: unknown; minThickness: number; maxThickness: number } | null;
  showThicknessHeatmap?(result: {
    geometry: unknown;
    minThickness: number;
    maxThickness: number;
  }): void;
  clearThicknessHeatmap?(): void;

  // Non-manifold edge highlighting
  showEdgeHighlight?(locations: Float32Array): void;
  clearEdgeHighlight?(): void;

  // Project serialization
  serializeObjects(objects?: LegacyObject[]): import('../project-store').SerializedObject[];
  restoreSerializedObjects(data: import('../project-store').SerializedObject[]): LegacyObject[];
}

export interface OverallInfo {
  count: number;
  triangles: number;
  width: number;
  depth: number;
  height: number;
  modelVolume: number;
  supportVolume: number;
}

// ─── Legacy Plate ──────────────────────────────────────────

export interface LegacyPlate {
  id: string;
  name: string;
  objects: LegacyObject[];
  selectedIds: string[];
  originX: number;
  originZ: number;
  dirty: boolean;
  slicedLayers?: Uint8Array[] | null;
  slicedLayerCount?: number;
  slicedVolumes?: SlicedVolumes | null;
}

export interface SlicedVolumes {
  model: number;
  supports: number;
  total: number;
  exactTotal: boolean;
  exactBreakdown: boolean;
}

export interface PaintSliceMark {
  x: number;
  y: number;
  z: number;
  radiusMM: number;
  depthMM: number;
}

export interface PaintTextureConfig {
  strength: number;
  pattern: number;
  patternScaleMM: number;
}

// ─── Legacy Slicer (src/slicer.js) ─────────────────────────

export interface LegacySlicer {
  setPrinter(printerKey: string): void;
  uploadGeometry(geometry: unknown, supportsGeometry?: unknown | null): void;
  setPaintSliceMarks?(marks: PaintSliceMark[]): void;
  setPaintTextureConfig?(config: PaintTextureConfig): void;
  setInstances(count: number, buffer: unknown | null): void;
  slice(
    layerHeightMM: number,
    onProgress: (current: number, total: number) => void,
    options?: { collect?: boolean; onLayer?: (pixels: Uint8Array) => void },
  ): Promise<Uint8Array[] | null>;
  renderLayer(layerIndex: number, layerHeightMM: number, target?: Uint8Array): Uint8Array;
  getPrinterSpec(): PrinterSpec;
  getLayerCount(layerHeightMM: number): number;
}
