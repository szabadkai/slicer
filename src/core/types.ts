import type { Signal } from '@preact/signals-core';

// ─── Workflow ──────────────────────────────────────────────

export type Stage = 'prepare' | 'orient' | 'support' | 'slice' | 'export';

// ─── Printer ───────────────────────────────────────────────

export interface PrinterSpec {
  name: string;
  resolutionX: number;
  resolutionY: number;
  buildWidthMM: number;
  buildDepthMM: number;
  buildHeightMM: number;
}

// ─── Material ──────────────────────────────────────────────

export interface ResinMaterial {
  id: string;
  brand: string;
  product: string;
  colorName: string;
  swatch: string;
  color: number;
  opacity: number;
  roughness: number;
  metalness: number;
  transmission: number;
  ior: number;
  description: string;
  sourceUrl: string;
}

// ─── Slice Parameters ──────────────────────────────────────

export interface SliceParams {
  layerHeightMM: number;
  normalExposureS: number;
  bottomLayers: number;
  bottomExposureS: number;
  liftHeightMM: number;
  liftSpeedMMs: number;
}

// ─── Primitives ────────────────────────────────────────────

export type PrimitiveType = 'box' | 'sphere' | 'cylinder' | 'cone';

export interface PrimitiveCutter {
  id: string;
  type: PrimitiveType;
  params: import('./primitives').PrimitiveParams;
  transform: import('./primitives').PrimitiveTransform;
}

// ─── Model ─────────────────────────────────────────────────

export interface Model {
  id: string;
  name: string;
  meshId: string;
}

// ─── Plate ─────────────────────────────────────────────────

export interface Plate {
  id: string;
  name: string;
  models: Model[];
  selectedIds: string[];
  originX: number;
  originZ: number;
  dirty: boolean;
}

// ─── Mount Context (legacy — kept for test compat) ─────────

export interface MountContext {
  viewer: ViewerService;
  commands: CommandBus;
}

// ─── App Context (used by real panel mounts) ───────────────

export interface AppContext {
  viewer: import('./legacy-types').LegacyViewer;
  slicer: import('./legacy-types').LegacySlicer;
  project: ProjectState;
  showProgress: (text: string) => void;
  updateProgress: (fraction: number, text?: string) => void;
  hideProgress: () => void;
  showToolPanel: (name: string) => void;
  scheduleProjectAutosave: () => void;
  scheduleSavePreferences: () => void;
  updateEstimate: () => void;
  renderPlateTabs: () => void;
  clearActivePlateSlice: () => void;
}

export interface ProjectState {
  plates: import('./legacy-types').LegacyPlate[];
  activePlateId: string;
}

// ─── Viewer Service ────────────────────────────────────────

export interface ModelHandle {
  id: string;
  name: string;
}

export interface ViewerService {
  init(): Promise<void>;
  addModel(geometry: unknown, opts?: { name?: string }): string;
  removeModel(id: string): void;
  getModel(id: string): ModelHandle | undefined;
  setLayerImage(image: ImageData | null): void;
  setPrinter(spec: PrinterSpec): void;
  render(): void;
  readonly canvas: HTMLCanvasElement;
  /** Access the underlying legacy Viewer instance for features that need it */
  readonly legacy: unknown;

  // Cutter preview
  addCutterPreview(positions: Float32Array): string;
  updateCutterPreview(
    id: string,
    position: [number, number, number],
    rotation: [number, number, number],
    scale: [number, number, number],
  ): void;
  removeCutterPreview(id: string): void;
  setCutterGizmo(id: string, mode: 'translate' | 'rotate' | 'scale'): void;
  clearCutterGizmo(): void;
  onCutterGizmoChange(
    callback: (
      position: [number, number, number],
      rotation: [number, number, number],
      scale: [number, number, number],
    ) => void,
  ): () => void;
  getModelPositions(modelId: string): Float32Array | null;
}

// ─── Command Bus ───────────────────────────────────────────

export type CommandMap = {
  slice: { plateId: string };
  'slice-all': undefined;
  'cancel-slice': undefined;
  export: { format: 'stl' | 'obj' | '3mf' | 'png-zip' };
  'auto-orient': { modelId: string };
  'assign-intent': {
    modelId: string;
    triangleIndices: number[];
    intent: string;
    priority: string;
  };
  'clear-intent': { modelId: string };
  'generate-supports': { modelId: string };
  'boolean-subtract': { modelId: string };
  'boolean-split': { modelId: string };
};

export type CommandName = keyof CommandMap;

export type CommandHandler<T extends CommandName> = (
  payload: CommandMap[T],
) => void | Promise<void>;

export interface CommandBus {
  dispatch<T extends CommandName>(command: T, payload: CommandMap[T]): void;
  on<T extends CommandName>(command: T, handler: CommandHandler<T>): () => void;
}

// ─── Utility ───────────────────────────────────────────────

export type ReadonlySignal<T> = Signal<T> & { readonly value: T };
