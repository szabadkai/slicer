/**
 * Typed interfaces for legacy JS modules (viewer.js, slicer.js).
 * These describe the subset of methods used by TypeScript feature panels.
 * The actual implementations live in the .js files — these are compile-time only.
 */

import type { PrinterSpec, ResinMaterial } from './types';

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

  // Selection
  clearSelection(): void;
  selectObject(id: string): void;
  selectObjects(ids: string[]): void;
  selectAll(): void;
  toggleSelection(id: string): void;

  // Transform
  setTransformMode(mode: string | null): void;
  translateSelectionTo(position: Vec3): void;
  scaleSelectionBy(scale: Vec3): void;
  rotateSelectionBy(rotation: Vec3): void;
  getSelectionWorldSize(): Vec3 | null;
  getSelectionWorldCenter(): Vec3 | null;
  setElevation(elevation: number): void;
  applyRotation(quaternion: unknown): void;
  setFacePickMode(enabled: boolean): void;

  // Edit operations
  duplicateSelected(): void;
  removeSelected(): void;
  clearPlate(): void;
  fillPlatform(): boolean;
  autoArrange(padding?: number, elevation?: number): void;
  distributeAcrossPlates(plates: LegacyPlate[], padding?: number, elevation?: number): boolean;
  undo(): void;
  copySelected(): void;
  paste(): void;
  _saveUndoState?(): void;

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

  // Geometry access
  getModelGeometry(): unknown | null;
  getMergedModelGeometry(): unknown | null;
  getMergedSupportGeometry(): unknown | null;
  getOverallInfo(): OverallInfo | null;

  // Supports
  setSupports(geometry: unknown): void;
  clearSupports(): void;

  // Support heatmap
  buildSupportHeatmapGeometry?(targets: LegacyObject[], overhangAngleDeg: number): { geometry: unknown; area: number; triangleCount: number } | null;
  showSupportHeatmap?(result: { geometry: unknown; area: number; triangleCount: number }): void;
  clearSupportHeatmap?(): void;

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

// ─── Legacy Slicer (src/slicer.js) ─────────────────────────

export interface LegacySlicer {
  setPrinter(printerKey: string): void;
  uploadGeometry(geometry: unknown, supportsGeometry?: unknown | null): void;
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
