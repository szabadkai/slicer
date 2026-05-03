/**
 * ViewerCore — base class with scene setup, rendering, selection, and basic object CRUD.
 * Extended by Viewer (viewer.ts) with transforms, plate management, and arrangement.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { type BuildVolumeEdge, buildGridGroup, setupLights } from './viewer-scene';

export interface SceneObject {
  id: string;
  mesh: THREE.Mesh;
  supportsMesh: THREE.Mesh | null;
  elevation: number;
  materialPreset: Record<string, unknown>;
  _cachedLocalVolume?: number;
  _cachedLocalSupportVolume?: number;
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

const FALLBACK_PRESET = { color: 0x4f6170, opacity: 0.96, roughness: 0.52, metalness: 0, transmission: 0, ior: 1.5 };
const STATIC_CAP = 1.5;
const INTERACTIVE_CAP = 1.25;

export function createResinMaterial(preset: Record<string, unknown> = FALLBACK_PRESET): THREE.MeshPhysicalMaterial {
  const o = (preset.opacity as number) ?? 1;
  const t = (preset.transmission as number) ?? 0;
  return new THREE.MeshPhysicalMaterial({
    color: (preset.color as number) ?? 0x888888, roughness: (preset.roughness as number) ?? 0.5,
    metalness: (preset.metalness as number) ?? 0, transparent: o < 1, opacity: o,
    depthWrite: o >= 0.55, transmission: t, thickness: t > 0 ? 0.8 : 0, ior: (preset.ior as number) ?? 1.5,
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
  clipboard: unknown[] = [];
  MAX_UNDO = 30;
  defaultMaterialPreset: Record<string, unknown>;
  multiTransformState: { pivotMatrix: THREE.Matrix4; objectMatrices: { sel: SceneObject; matrix: THREE.Matrix4 }[] } | null = null;
  transformSupportState: { items: { sel: SceneObject; meshPosition: THREE.Vector3; supportPosition: THREE.Vector3 }[] } | null = null;
  facePickMode = false;
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
    const plate: PlateState = { id: 'plate-1', name: 'Plate 1', objects: [], selectedIds: [], originX: 0, originZ: 0, dirty: false };
    this.objects = plate.objects;
    this.selected = [];
    this.activePlate = plate;
    this.plates = [plate];
    this.printer = null;
    this.defaultMaterialPreset = FALLBACK_PRESET;
    this.selectionPivot = new THREE.Object3D();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf0f2f5);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: false, powerPreference: 'low-power' });
    this._setRenderPixelRatio(STATIC_CAP);
    this.renderer.sortObjects = true;
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    this.camera.position.set(100, 100, 100);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.addEventListener('start', () => { this.isUserInteracting = true; this._setRenderPixelRatio(INTERACTIVE_CAP); this.requestRender(); });
    this.controls.addEventListener('end', () => { this.isUserInteracting = false; this._setRenderPixelRatio(STATIC_CAP); this.requestRender(); });
    this.controls.addEventListener('change', () => this.requestRender());

    this.transformControl = new TransformControls(this.camera, canvas);
    this.scene.add(this.selectionPivot);
    this.transformControl.addEventListener('change', () => { this._applyMultiTransformDelta(); this._syncSupportsDuringTranslation(); this.requestRender(); });
    this.transformControl.addEventListener('dragging-changed', (event: { value: unknown }) => {
      const dragging = !!event.value;
      if (dragging) { this._beginMultiTransform(); this._beginTransformSupportSync(); }
      this.controls.enabled = !dragging;
      this.isUserInteracting = dragging;
      this._setRenderPixelRatio(dragging ? INTERACTIVE_CAP : STATIC_CAP);
      this.requestRender();
    });
    this.transformControl.addEventListener('mouseUp', () => { this._finishTransform(); });
    this.scene.add(this.transformControl.getHelper());

    this.raycaster = new THREE.Raycaster();
    this.fpsElement = document.getElementById('fps-counter');
    this.fpsFrames = 0;
    this.fpsWindowStart = performance.now();
    canvas.addEventListener('pointerdown', (e: PointerEvent) => { this.pointerDown.set(e.clientX, e.clientY); this.requestRender(); });
    canvas.addEventListener('pointerup', (e: PointerEvent) => {
      if (Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y) < 5 && !this.transformControl.dragging) this._onClick(e);
      this.requestRender();
    });
    canvas.addEventListener('mesh-changed', () => this.requestRender());
    canvas.addEventListener('selection-changed', () => { this._saveActivePlateSelection(); this.requestRender(); });
    canvas.addEventListener('material-changed', () => this.requestRender());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.requestRender(); });
    setupLights(this.scene);
    this._setupGrid();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this.requestRender();
  }

  // ---- rendering ----------------------------------------------------------
  requestRender(): void { if (this.renderRequested || document.hidden) return; this.renderRequested = true; requestAnimationFrame(() => this._render()); }
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
    if (elapsed >= 250) { this.fpsElement.textContent = `${Math.round((this.fpsFrames * 1000) / elapsed)} FPS`; this.fpsFrames = 0; this.fpsWindowStart = now; }
    if (this.fpsIdleTimer) clearTimeout(this.fpsIdleTimer);
    this.fpsIdleTimer = setTimeout(() => { this.fpsFrames = 0; this.fpsWindowStart = performance.now(); if (this.fpsElement) this.fpsElement.textContent = 'Idle'; }, 500);
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
    this.renderPixelRatio = next; this.renderer.setPixelRatio(next);
    if (this.canvas.parentElement && this.camera) this._resize();
  }

  // ---- grid ---------------------------------------------------------------
  _setupGrid(): void {
    if (this.gridGroup) { this.scene.remove(this.gridGroup); this.gridGroup.children.forEach((c: THREE.Object3D) => { const m = c as THREE.Mesh; if (m.geometry) m.geometry.dispose(); if (m.material) (m.material as THREE.Material).dispose(); }); }
    if (!this.printer) { this.gridGroup = null; return; }
    const plates = this.plates.length ? this.plates : [this.activePlate];
    const { group, buildVolumeEdges } = buildGridGroup(this.printer as { buildWidthMM: number; buildDepthMM: number; buildHeightMM: number }, plates, this.activePlate);
    this.gridGroup = group; this.buildVolumeEdges = buildVolumeEdges;
    this.scene.add(group);
    this.requestRender();
  }

  // ---- visibility ---------------------------------------------------------
  _setObjectSceneVisible(obj: SceneObject, visible: boolean): void {
    [obj.mesh, obj.supportsMesh].filter((m): m is THREE.Mesh => m != null).forEach((m) => {
      if (visible && !m.parent) this.scene.add(m);
      else if (!visible && m.parent === this.scene) this.scene.remove(m);
    });
  }

  // ---- selection ----------------------------------------------------------
  _saveActivePlateSelection(): void { if (this.activePlate) this.activePlate.selectedIds = this.selected.map((o) => o.id); }
  clearSelection(): void { this.selected = []; this._attachTransformControls(); this._updateSelectionVisuals(); this.canvas.dispatchEvent(new CustomEvent('selection-changed')); }
  toggleSelection(id: string): void {
    const idx = this.selected.findIndex((o) => o.id === id);
    if (idx !== -1) this.selected.splice(idx, 1);
    else { const obj = this.objects.find((o) => o.id === id); if (obj) this.selected.push(obj); }
    this._attachTransformControls(); this._updateSelectionVisuals(); this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  }
  selectObject(id: string): void {
    if (!id) { this.clearSelection(); return; }
    const obj = this.objects.find((o) => o.id === id);
    this.selected = obj ? [obj] : [];
    this._attachTransformControls(); this._updateSelectionVisuals(); this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  }
  selectObjects(ids: string[]): void { const s = new Set(ids); this.selected = this.objects.filter((o) => s.has(o.id)); this._attachTransformControls(); this._updateSelectionVisuals(); this.canvas.dispatchEvent(new CustomEvent('selection-changed')); }
  selectAll(): void { this.selected = [...this.objects]; this._attachTransformControls(); this._updateSelectionVisuals(); this.canvas.dispatchEvent(new CustomEvent('selection-changed')); }
  setFacePickMode(enabled: boolean): void { this.facePickMode = enabled; this.canvas.classList.toggle('face-pick-mode', enabled); }

  protected _onClick(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const meshes = (this as unknown as { getAllObjects(): SceneObject[] }).getAllObjects().map((o: SceneObject) => o.mesh);
    const intersects = this.raycaster.intersectObjects(meshes, false);
    const multi = e.shiftKey || e.ctrlKey || e.metaKey;
    if (intersects.length > 0) {
      const hit = intersects[0];
      const id = hit.object.userData.id as string;
      const hitPlate = (this as unknown as { getPlateForObject(id: string): PlateState | null }).getPlateForObject(id);
      if (hitPlate && hitPlate !== this.activePlate) (this as unknown as { setActivePlate(p: PlateState): void }).setActivePlate(hitPlate);
      if (this.facePickMode) {
        this.selectObject(id);
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
        const face = hit.face;
        if (!face) return;
        const normal = face.normal.clone().applyMatrix3(normalMatrix).normalize();
        if (normal.dot(this.raycaster.ray.direction) > 0) normal.multiplyScalar(-1);
        this.canvas.dispatchEvent(new CustomEvent('protected-face-picked', { detail: { objectId: id, point: hit.point.clone(), normal } }));
        this.setFacePickMode(false);
        return;
      }
      if (multi) this.toggleSelection(id); else this.selectObject(id);
    } else if (!multi) this.clearSelection();
  }

  _attachTransformControls(): void {
    if (this.selected.length === 1) { this.transformControl.attach(this.selected[0].mesh); if (!this.transformControl.getMode()) this.transformControl.setMode('translate'); }
    else if (this.selected.length > 1) { this._positionSelectionPivot(); this.transformControl.attach(this.selectionPivot); if (!this.transformControl.getMode()) this.transformControl.setMode('translate'); }
    else this.transformControl.detach();
  }
  _getSelectionBounds(): THREE.Box3 {
    const bb = new THREE.Box3();
    this.selected.forEach((s) => { s.mesh.geometry.computeBoundingBox(); s.mesh.updateMatrixWorld(true); const sbb = s.mesh.geometry.boundingBox; if (sbb) bb.union(sbb.clone().applyMatrix4(s.mesh.matrixWorld)); });
    return bb;
  }
  _positionSelectionPivot(): void {
    if (this.selected.length <= 1) return;
    const c = new THREE.Vector3(); this._getSelectionBounds().getCenter(c);
    this.selectionPivot.position.copy(c); this.selectionPivot.rotation.set(0, 0, 0); this.selectionPivot.scale.set(1, 1, 1); this.selectionPivot.updateMatrixWorld(true);
  }
  _updateSelectionVisuals(): void {
    const ids = new Set(this.selected.map((o) => o.id));
    (this as unknown as { getAllObjects(): SceneObject[] }).getAllObjects().forEach((o: SceneObject) => {
      if (this._flaggedIds.has(o.id)) {
        (o.mesh.material as THREE.MeshPhysicalMaterial).emissive.setHex(0x660000);
      } else {
        (o.mesh.material as THREE.MeshPhysicalMaterial).emissive.setHex(ids.has(o.id) ? 0x333333 : 0x000000);
      }
    });
  }

  // ---- transform stubs (overridden in Viewer) ----------------------------
  protected _applyMultiTransformDelta(): void { /* overridden */ }
  protected _syncSupportsDuringTranslation(): void { /* overridden */ }
  protected _beginMultiTransform(): void { /* overridden */ }
  protected _beginTransformSupportSync(): void { /* overridden */ }
  protected _finishTransform(): void { /* overridden */ }

  // ---- material -----------------------------------------------------------
  getActiveMaterialPreset(): Record<string, unknown> { const obj = this.selected[0] || this.objects[0]; return (obj?.materialPreset || this.defaultMaterialPreset) as Record<string, unknown>; }
  setDefaultMaterialPreset(preset: Record<string, unknown>): void { if (preset) this.defaultMaterialPreset = preset; }
  setMaterialPreset(preset: Record<string, unknown>, target: 'selection' | 'all' = 'selection'): void {
    const targets = target === 'all' || this.selected.length === 0 ? this.objects : this.selected;
    targets.forEach((obj) => { const prev = obj.mesh.material as THREE.Material; obj.mesh.material = createResinMaterial(preset); obj.materialPreset = preset; prev?.dispose?.(); });
    this._updateSelectionVisuals(); this.canvas.dispatchEvent(new CustomEvent('material-changed', { detail: { preset, target } }));
  }

  // ---- printer ------------------------------------------------------------
  setPrinter(spec: unknown): void {
    this.printer = spec;
    this._setupGrid();
    if (this.objects.length === 0 && spec) {
      const s = spec as { buildWidthMM: number; buildDepthMM: number; buildHeightMM: number };
      const m = Math.max(s.buildWidthMM, s.buildHeightMM, s.buildDepthMM);
      this.camera.position.set(m * 0.8, m * 0.8, m * 0.8);
      this.controls.target.set(this.activePlate.originX || 0, s.buildHeightMM / 2, this.activePlate.originZ || 0);
      this.controls.update();
    }
    this.requestRender();
  }

  // ---- model loading & basic CRUD ----------------------------------------
  loadSTL(buffer: ArrayBuffer, scale = 1): void {
    const geo = new STLLoader().parse(buffer);
    if (scale !== 1) geo.scale(scale, scale, scale);
    geo.computeBoundingBox(); geo.computeVertexNormals();
    const bb = geo.boundingBox;
    if (!bb) throw new Error('Failed to compute bounding box for STL');
    const center = new THREE.Vector3(); bb.getCenter(center);
    const elevation = 5;
    geo.translate(-center.x, -bb.min.y + elevation, -center.z); geo.computeBoundingBox();
    this.addModel(geo, elevation);
    if (this.objects.length === 1) {
      const size = new THREE.Vector3(); const gbb = geo.boundingBox; if (gbb) gbb.getSize(size); const m = Math.max(size.x, size.y, size.z);
      const origin = this.getActivePlateOrigin();
      this.camera.position.set(origin.x + m, m * 0.8, origin.z + m); this.controls.target.set(origin.x, size.y / 2, origin.z); this.controls.update();
    }
  }
  _addModelRaw(geometry: THREE.BufferGeometry, material: THREE.Material | null, elevation: number): SceneObject {
    const preset = this.defaultMaterialPreset;
    if (!material) material = createResinMaterial(preset);
    const mesh = new THREE.Mesh(geometry, material);
    const id = 'obj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    mesh.userData.id = id; this.scene.add(mesh);
    const obj: SceneObject = { id, mesh, supportsMesh: null, elevation, materialPreset: preset };
    this.objects.push(obj); return obj;
  }
  addModel(geometry: THREE.BufferGeometry, elevation = 5): SceneObject {
    const obj = this._addModelRaw(geometry, null, elevation);
    this._moveMeshOriginToBoundsMin(obj.mesh);
    const origin = this.getActivePlateOrigin();
    obj.mesh.position.x += origin.x; obj.mesh.position.z += origin.z; obj.mesh.updateMatrixWorld(true);
    this.selectObject(obj.id); this.canvas.dispatchEvent(new CustomEvent('mesh-changed')); return obj;
  }
  _moveMeshOriginToBoundsMin(mesh: THREE.Mesh): void {
    mesh.geometry.computeBoundingBox(); const mbb = mesh.geometry.boundingBox; if (!mbb) return; const min = mbb.min.clone();
    if (min.lengthSq() === 0) return;
    mesh.geometry.translate(-min.x, -min.y, -min.z); mesh.position.add(min); mesh.geometry.computeBoundingBox(); mesh.updateMatrixWorld(true);
  }
  removeSelected(): void {
    if (this.selected.length === 0) return;
    this._saveUndoState(); this.transformControl.detach();
    const ids = new Set(this.selected.map((s) => s.id));
    this.objects.forEach((o) => { if (ids.has(o.id)) { this.scene.remove(o.mesh); o.mesh.geometry.dispose(); (o.mesh.material as THREE.Material).dispose(); if (o.supportsMesh) { this.scene.remove(o.supportsMesh); o.supportsMesh.geometry.dispose(); (o.supportsMesh.material as THREE.Material).dispose(); } } });
    this.objects = this.objects.filter((o) => !ids.has(o.id)); this.activePlate.objects = this.objects; this.selected = [];
    this.canvas.dispatchEvent(new CustomEvent('selection-changed')); this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }
  clearPlate(): void {
    if (this.objects.length === 0) return;
    this._saveUndoState(); this.transformControl.detach();
    this.objects.forEach((o) => { this.scene.remove(o.mesh); o.mesh.geometry.dispose(); (o.mesh.material as THREE.Material).dispose(); if (o.supportsMesh) { this.scene.remove(o.supportsMesh); o.supportsMesh.geometry.dispose(); (o.supportsMesh.material as THREE.Material).dispose(); } });
    this.objects = []; this.activePlate.objects = this.objects; this.selected = [];
    this.canvas.dispatchEvent(new CustomEvent('selection-changed')); this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }
  duplicateSelected(): void {
    if (this.selected.length === 0) return;
    this._saveUndoState(); this._bakeTransform();
    const newSel: SceneObject[] = [];
    this.selected.forEach((sel) => {
      const obj = this._addModelRaw(sel.mesh.geometry.clone(), (sel.mesh.material as THREE.Material).clone(), sel.elevation);
      obj.materialPreset = sel.materialPreset; obj.mesh.position.copy(sel.mesh.position); obj.mesh.position.x += 10; obj.mesh.position.z += 10; obj.mesh.updateMatrixWorld(); newSel.push(obj);
    });
    this.selected = newSel; this._attachTransformControls(); this._updateSelectionVisuals();
    this.canvas.dispatchEvent(new CustomEvent('selection-changed')); this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  // ---- stubs for methods defined in Viewer --------------------------------
  getActivePlateOrigin(): THREE.Vector3 { return new THREE.Vector3(this.activePlate?.originX || 0, 0, this.activePlate?.originZ || 0); }
  getAllObjects(): SceneObject[] { return this.plates.flatMap((p) => p.objects); }
  getPlateForObject(objectId: string): PlateState | null { return this.plates.find((p) => p.objects.some((o) => o.id === objectId)) || null; }
  _saveUndoState(): void { /* overridden in Viewer */ }
  _bakeTransform(_opts?: { preserveSupports?: boolean }): void { void _opts; /* overridden in Viewer */ }
}
