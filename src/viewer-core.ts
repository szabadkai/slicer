/**
 * ViewerCore — base class with scene setup, rendering, selection, and basic object CRUD.
 * Extended by Viewer (viewer.ts) with transforms, plate management, and arrangement.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { PrimitiveParams, PrimitiveTransform } from '@core/primitives';
import { type BuildVolumeEdge, buildGridGroup, setupLights } from './viewer-scene';
import {
  showIntentOverlay as showIntentOverlayImpl,
  clearIntentOverlay as clearIntentOverlayImpl,
  setIntentPaintMode as setIntentPaintModeImpl,
  handleIntentPaint,
} from './viewer-core-intent';
import {
  showOverhangOverlay as showOverhangOverlayImpl,
  clearOverhangOverlay as clearOverhangOverlayImpl,
} from './viewer-core-overhang';
import type { SupportContact } from './features/support-generation/overhang-overlay';
import type { OverhangParams } from './features/support-generation/detect';
import {
  setPaintToolEnabled as setPaintToolEnabledImpl,
  setPaintBrush as setPaintBrushImpl,
  undoPaintStroke as undoPaintStrokeImpl,
  clearPaint as clearPaintImpl,
  paintAll as paintAllImpl,
  paintVolume as paintVolumeImpl,
  getPaintStrokeCount as getPaintStrokeCountImpl,
  getPaintSliceMarks as getPaintSliceMarksImpl,
  getPaintTextureConfig as getPaintTextureConfigImpl,
  handlePaintPointerDown,
  handlePaintPointerMove,
  handlePaintPointerUp,
  handlePaintPointerLeave,
  syncPaintMaterial as syncPaintMaterialImpl,
} from './viewer-core-paint';
import {
  loadSTL as loadSTLImpl,
  addModelRaw,
  addModel as addModelImpl,
  moveMeshOriginToBoundsMin,
  removeSelected as removeSelectedImpl,
  clearPlate as clearPlateImpl,
  duplicateSelected as duplicateSelectedImpl,
} from './viewer-core-models';
import {
  saveActivePlateSelection,
  clearSelection as clearSelectionImpl,
  toggleSelection as toggleSelectionImpl,
  selectObject as selectObjectImpl,
  selectObjects as selectObjectsImpl,
  selectAll as selectAllImpl,
  getObjectTriangleCount as getObjectTriangleCountImpl,
  handleClick,
  attachTransformControls,
  getSelectionBounds,
  positionSelectionPivot,
  updateSelectionVisuals,
} from './viewer-core-selection';

export interface SceneObject {
  id: string;
  mesh: THREE.Mesh;
  supportsMesh: THREE.Mesh | null;
  elevation: number;
  materialPreset: Record<string, unknown>;
  paintStrokes?: PaintStroke[];
  intentBuffer?: Uint8Array;
  _cachedLocalVolume?: number;
  _cachedLocalSupportVolume?: number;
}

export interface PaintStroke {
  localPoint: [number, number, number];
  radiusMM: number;
  color: number;
  density: number;
  depthMM: number;
  bumpStrength: number;
  pattern: number;
  patternScaleMM: number;
}

export interface PlateState {
  id: string;
  name: string;
  objects: SceneObject[];
  selectedIds: string[];
  originX: number;
  originZ: number;
  dirty: boolean;
  slicedLayers?: Uint8Array[] | null;
  slicedVolumes?: unknown;
}

const FALLBACK_PRESET = {
  color: 0x4f6170,
  opacity: 0.96,
  roughness: 0.52,
  metalness: 0,
  transmission: 0,
  ior: 1.5,
};
const STATIC_CAP = 1.5;
const INTERACTIVE_CAP = 1.25;

export function createResinMaterial(
  preset: Record<string, unknown> = FALLBACK_PRESET,
): THREE.MeshPhysicalMaterial {
  const o = (preset.opacity as number) ?? 1;
  const t = (preset.transmission as number) ?? 0;
  return new THREE.MeshPhysicalMaterial({
    color: (preset.color as number) ?? 0x888888,
    roughness: (preset.roughness as number) ?? 0.5,
    metalness: (preset.metalness as number) ?? 0,
    transparent: o < 1,
    opacity: o,
    depthWrite: o >= 0.55,
    transmission: t,
    thickness: t > 0 ? 0.8 : 0,
    ior: (preset.ior as number) ?? 1.5,
  });
}

export class ViewerCore {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  transformControl: TransformControls;
  raycaster: THREE.Raycaster;
  selectionPivot: THREE.Object3D;

  objects: SceneObject[];
  selected: SceneObject[];
  activePlate: PlateState;
  plates: PlateState[];
  printer: unknown;

  gridGroup: THREE.Group | null = null;
  buildVolumeEdges: BuildVolumeEdge[] = [];
  undoStack: unknown[] = [];
  redoStack: unknown[] = [];
  clipboard: unknown[] = [];
  MAX_UNDO = 30;
  defaultMaterialPreset: Record<string, unknown>;
  multiTransformState: {
    pivotMatrix: THREE.Matrix4;
    objectMatrices: { sel: SceneObject; matrix: THREE.Matrix4 }[];
  } | null = null;
  transformSupportState: {
    items: { sel: SceneObject; meshPosition: THREE.Vector3; supportPosition: THREE.Vector3 }[];
  } | null = null;
  paintToolEnabled = false;
  intentPaintMode = false;
  intentBrushRadiusMM = 8;
  _intentOverlayMesh: THREE.Mesh | null = null;
  _intentOverlayMaterial: THREE.MeshBasicMaterial | null = null;
  _overhangOverlayMesh: THREE.Mesh | null = null;
  _overhangOverlayMaterial: THREE.MeshBasicMaterial | null = null;
  paintBrush = {
    radiusMM: 4,
    color: 0xef4444,
    density: 0.8,
    depthMM: 0.5,
    bumpStrength: 0.6,
    pattern: 0,
    patternScaleMM: 2,
  };
  paintPreview: THREE.Mesh | null = null;
  paintTarget: SceneObject | null = null;
  isPainting = false;
  lastPaintPoint: THREE.Vector3 | null = null;
  significantFaceHighlights: THREE.Mesh[] | null = null;
  _flaggedIds: Set<string> = new Set();

  protected renderRequested = false;
  protected isUserInteracting = false;
  protected renderPixelRatio = 0;
  protected pointerDown = new THREE.Vector2();
  private fpsElement: HTMLElement | null;
  private fpsFrames = 0;
  private fpsWindowStart: number;
  private fpsIdleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const plate: PlateState = {
      id: 'plate-1',
      name: 'Plate 1',
      objects: [],
      selectedIds: [],
      originX: 0,
      originZ: 0,
      dirty: false,
    };
    this.objects = plate.objects;
    this.selected = [];
    this.activePlate = plate;
    this.plates = [plate];
    this.printer = null;
    this.defaultMaterialPreset = FALLBACK_PRESET;
    this.selectionPivot = new THREE.Object3D();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf0f2f5);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      stencil: false,
      powerPreference: 'low-power',
    });
    this._setRenderPixelRatio(STATIC_CAP);
    this.renderer.sortObjects = true;
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    this.camera.position.set(100, 100, 100);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.addEventListener('start', () => {
      this.isUserInteracting = true;
      this._setRenderPixelRatio(INTERACTIVE_CAP);
      this.requestRender();
    });
    this.controls.addEventListener('end', () => {
      this.isUserInteracting = false;
      this._setRenderPixelRatio(STATIC_CAP);
      this.requestRender();
    });
    this.controls.addEventListener('change', () => this.requestRender());

    this.transformControl = new TransformControls(this.camera, canvas);
    this.scene.add(this.selectionPivot);
    this.transformControl.addEventListener('change', () => {
      this._applyMultiTransformDelta();
      this._syncSupportsDuringTranslation();
      this.requestRender();
    });
    this.transformControl.addEventListener('dragging-changed', (event: { value: unknown }) => {
      const dragging = !!event.value;
      if (dragging) {
        this._beginMultiTransform();
        this._beginTransformSupportSync();
      }
      this.controls.enabled = !dragging;
      this.isUserInteracting = dragging;
      this._setRenderPixelRatio(dragging ? INTERACTIVE_CAP : STATIC_CAP);
      this.requestRender();
    });
    this.transformControl.addEventListener('mouseUp', () => {
      this._finishTransform();
    });
    this.scene.add(this.transformControl.getHelper());

    this.raycaster = new THREE.Raycaster();
    this.fpsElement = document.getElementById('fps-counter');
    this.fpsFrames = 0;
    this.fpsWindowStart = performance.now();
    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      this.pointerDown.set(e.clientX, e.clientY);
      if (this.intentPaintMode && e.button === 0) {
        this._handleIntentPaint(e);
      }
      this.requestRender();
    });
    canvas.addEventListener('pointerup', (e: PointerEvent) => {
      if (
        Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y) < 5 &&
        !this.transformControl.dragging &&
        !this.paintToolEnabled &&
        !this.intentPaintMode
      )
        this._onClick(e);
      if (this.intentPaintMode) this.controls.enabled = !this.intentPaintMode;
      this.requestRender();
    });
    canvas.addEventListener('pointermove', (e: PointerEvent) => {
      if (this.intentPaintMode && e.buttons === 1) {
        this._handleIntentPaint(e);
      }
      this._handlePaintPointerMove(e);
    });
    canvas.addEventListener('pointerdown', (e: PointerEvent) => this._handlePaintPointerDown(e));
    canvas.addEventListener('pointerup', () => this._handlePaintPointerUp());
    canvas.addEventListener('pointerleave', () => this._handlePaintPointerLeave());
    canvas.addEventListener('mesh-changed', () => this.requestRender());
    canvas.addEventListener('selection-changed', () => {
      this._saveActivePlateSelection();
      this.requestRender();
    });
    canvas.addEventListener('material-changed', () => this.requestRender());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.requestRender();
    });
    setupLights(this.scene);
    this._setupGrid();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this.requestRender();
  }

  // ---- rendering ----------------------------------------------------------
  requestRender(): void {
    if (this.renderRequested || document.hidden) return;
    this.renderRequested = true;
    requestAnimationFrame(() => this._render());
  }
  protected _render(): void {
    this.renderRequested = false;
    const now = performance.now();
    const moved = this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this._updateFps(now);
    if (this.isUserInteracting || moved) this.requestRender();
  }
  private _updateFps(now: number): void {
    if (!this.fpsElement) return;
    this.fpsFrames++;
    const elapsed = now - this.fpsWindowStart;
    if (elapsed >= 250) {
      this.fpsElement.textContent = `${Math.round((this.fpsFrames * 1000) / elapsed)} FPS`;
      this.fpsFrames = 0;
      this.fpsWindowStart = now;
    }
    if (this.fpsIdleTimer) clearTimeout(this.fpsIdleTimer);
    this.fpsIdleTimer = setTimeout(() => {
      this.fpsFrames = 0;
      this.fpsWindowStart = performance.now();
      if (this.fpsElement) this.fpsElement.textContent = 'Idle';
    }, 500);
  }
  protected _resize(): void {
    const ct = this.canvas.parentElement;
    if (!ct) return;
    this.renderer.setSize(ct.clientWidth, ct.clientHeight);
    this.camera.aspect = ct.clientWidth / ct.clientHeight;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }
  protected _setRenderPixelRatio(max: number): void {
    const next = Math.min(window.devicePixelRatio || 1, max);
    if (next === this.renderPixelRatio) return;
    this.renderPixelRatio = next;
    this.renderer.setPixelRatio(next);
    if (this.canvas.parentElement && this.camera) this._resize();
  }

  _setupGrid(): void {
    if (this.gridGroup) {
      this.scene.remove(this.gridGroup);
      this.gridGroup.children.forEach((c: THREE.Object3D) => {
        const m = c as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (m.material as THREE.Material).dispose();
      });
    }
    if (!this.printer) {
      this.gridGroup = null;
      return;
    }
    const plates = this.plates.length ? this.plates : [this.activePlate];
    const { group, buildVolumeEdges } = buildGridGroup(
      this.printer as { buildWidthMM: number; buildDepthMM: number; buildHeightMM: number },
      plates,
      this.activePlate,
    );
    this.gridGroup = group;
    this.buildVolumeEdges = buildVolumeEdges;
    this.scene.add(group);
    this.requestRender();
  }
  _setObjectSceneVisible(obj: SceneObject, visible: boolean): void {
    [obj.mesh, obj.supportsMesh]
      .filter((m): m is THREE.Mesh => m != null)
      .forEach((m) => {
        if (visible && !m.parent) this.scene.add(m);
        else if (!visible && m.parent === this.scene) this.scene.remove(m);
      });
  }

  // ---- selection (delegated to viewer-core-selection.ts) --------------------
  _saveActivePlateSelection(): void {
    saveActivePlateSelection(this);
  }
  clearSelection(): void {
    clearSelectionImpl(this);
  }
  toggleSelection(id: string): void {
    toggleSelectionImpl(this, id);
  }
  selectObject(id: string): void {
    selectObjectImpl(this, id);
  }
  selectObjects(ids: string[]): void {
    selectObjectsImpl(this, ids);
  }
  selectAll(): void {
    selectAllImpl(this);
  }
  getObjectTriangleCount(objectId: string): number | null {
    return getObjectTriangleCountImpl(this, objectId);
  }

  // Intent overlay (delegated to viewer-core-intent.ts)
  showIntentOverlay(objectId: string, intentBuffer: Uint8Array): void {
    showIntentOverlayImpl(this, objectId, intentBuffer);
  }
  clearIntentOverlay(): void {
    clearIntentOverlayImpl(this);
  }

  // Overhang overlay (delegated to viewer-core-overhang.ts)
  showOverhangOverlay(id: string, contacts: SupportContact[], params?: Partial<OverhangParams>, radius?: number): void {
    showOverhangOverlayImpl(this, id, contacts, params, radius);
  }
  clearOverhangOverlay(): void { clearOverhangOverlayImpl(this); }

  setIntentPaintMode(enabled: boolean): void {
    setIntentPaintModeImpl(this, enabled);
  }
  protected _handleIntentPaint(e: PointerEvent): void {
    handleIntentPaint(this, e);
  }

  protected _onClick(e: PointerEvent): void {
    handleClick(this, e);
  }
  _attachTransformControls(): void {
    attachTransformControls(this);
  }
  _getSelectionBounds(): THREE.Box3 {
    return getSelectionBounds(this);
  }
  _positionSelectionPivot(): void {
    positionSelectionPivot(this);
  }
  _updateSelectionVisuals(): void {
    updateSelectionVisuals(this);
  }

  // ---- transform stubs (overridden in Viewer) ----------------------------
  protected _applyMultiTransformDelta(): void {
    /* overridden */
  }
  protected _syncSupportsDuringTranslation(): void {
    /* overridden */
  }
  protected _beginMultiTransform(): void {
    /* overridden */
  }
  protected _beginTransformSupportSync(): void {
    /* overridden */
  }
  protected _finishTransform(): void {
    /* overridden */
  }

  // ---- paint (delegated to viewer-core-paint.ts) --------------------------
  setPaintToolEnabled(enabled: boolean): void {
    setPaintToolEnabledImpl(this, enabled);
  }
  setPaintBrush(brush: {
    radiusMM?: number;
    color?: number;
    density?: number;
    depthMM?: number;
    bumpStrength?: number;
    pattern?: number;
    patternScaleMM?: number;
  }): void {
    setPaintBrushImpl(this, brush);
  }
  undoPaintStroke(): void {
    undoPaintStrokeImpl(this);
  }
  clearPaint(): void {
    clearPaintImpl(this);
  }
  paintAll(targets: 'all' | 'selected'): void {
    paintAllImpl(this, targets);
  }
  paintVolume(params: PrimitiveParams, transform: PrimitiveTransform): void {
    paintVolumeImpl(this, params, transform);
  }
  getPaintStrokeCount(): number {
    return getPaintStrokeCountImpl(this);
  }
  getPaintSliceMarks(): Array<{
    x: number;
    y: number;
    z: number;
    radiusMM: number;
    depthMM: number;
  }> {
    return getPaintSliceMarksImpl(this);
  }
  getPaintTextureConfig(): { strength: number; pattern: number; patternScaleMM: number } {
    return getPaintTextureConfigImpl(this);
  }
  protected _handlePaintPointerDown(e: PointerEvent): void {
    handlePaintPointerDown(this, e);
  }
  protected _handlePaintPointerMove(e: PointerEvent): void {
    handlePaintPointerMove(this, e);
  }
  protected _handlePaintPointerUp(): void {
    handlePaintPointerUp(this);
  }
  protected _handlePaintPointerLeave(): void {
    handlePaintPointerLeave(this);
  }
  protected _syncPaintMaterial(obj: SceneObject): void {
    syncPaintMaterialImpl(this, obj);
  }

  getActiveMaterialPreset(): Record<string, unknown> {
    const obj = this.selected[0] || this.objects[0];
    return (obj?.materialPreset || this.defaultMaterialPreset) as Record<string, unknown>;
  }
  setDefaultMaterialPreset(preset: Record<string, unknown>): void {
    if (preset) this.defaultMaterialPreset = preset;
  }
  setMaterialPreset(
    preset: Record<string, unknown>,
    target: 'selection' | 'all' = 'selection',
  ): void {
    const targets = target === 'all' || this.selected.length === 0 ? this.objects : this.selected;
    targets.forEach((obj) => {
      const prev = obj.mesh.material as THREE.Material;
      obj.mesh.material = createResinMaterial(preset);
      obj.materialPreset = preset;
      if ((obj.paintStrokes?.length ?? 0) > 0) this._syncPaintMaterial(obj);
      prev?.dispose?.();
    });
    this._updateSelectionVisuals();
    this.canvas.dispatchEvent(new CustomEvent('material-changed', { detail: { preset, target } }));
  }

  // ---- printer ------------------------------------------------------------
  setPrinter(spec: unknown): void {
    this.printer = spec;
    this._setupGrid();
    if (this.objects.length === 0 && spec) {
      const s = spec as { buildWidthMM: number; buildDepthMM: number; buildHeightMM: number };
      const m = Math.max(s.buildWidthMM, s.buildHeightMM, s.buildDepthMM);
      this.camera.position.set(m * 0.8, m * 0.8, m * 0.8);
      this.controls.target.set(
        this.activePlate.originX || 0,
        s.buildHeightMM / 2,
        this.activePlate.originZ || 0,
      );
      this.controls.update();
    }
    this.requestRender();
  }

  loadSTL(buffer: ArrayBuffer, scale = 1): void {
    loadSTLImpl(this, buffer, scale);
  }
  _addModelRaw(
    geometry: THREE.BufferGeometry,
    material: THREE.Material | null,
    elevation: number,
  ): SceneObject {
    return addModelRaw(this, geometry, material, elevation);
  }
  addModel(geometry: THREE.BufferGeometry, elevation = 5): SceneObject {
    return addModelImpl(this, geometry, elevation);
  }
  _moveMeshOriginToBoundsMin(mesh: THREE.Mesh): void {
    moveMeshOriginToBoundsMin(mesh);
  }
  removeSelected(): void {
    removeSelectedImpl(this);
  }
  clearPlate(): void {
    clearPlateImpl(this);
  }
  duplicateSelected(): void {
    duplicateSelectedImpl(this);
  }

  getActivePlateOrigin(): THREE.Vector3 {
    return new THREE.Vector3(this.activePlate?.originX || 0, 0, this.activePlate?.originZ || 0);
  }
  getAllObjects(): SceneObject[] {
    return this.plates.flatMap((p) => p.objects);
  }
  getPlateForObject(objectId: string): PlateState | null {
    return this.plates.find((p) => p.objects.some((o) => o.id === objectId)) || null;
  }
  _saveUndoState(): void {
    /* overridden in Viewer */
  }
  _bakeTransform(_opts?: { preserveSupports?: boolean }): void {
    void _opts; /* overridden */
  }
}
