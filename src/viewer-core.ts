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

const FALLBACK_PRESET = { color: 0x4f6170, opacity: 0.96, roughness: 0.52, metalness: 0, transmission: 0, ior: 1.5 };
const STATIC_CAP = 1.5;
const INTERACTIVE_CAP = 1.25;
const MAX_SHADER_PAINT_STROKES = 64;

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
  paintToolEnabled = false;
  intentPaintMode = false;
  intentBrushRadiusMM = 8;
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
    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      this.pointerDown.set(e.clientX, e.clientY);
      if (this.intentPaintMode && e.button === 0) { this._handleIntentPaint(e); }
      this.requestRender();
    });
    canvas.addEventListener('pointerup', (e: PointerEvent) => {
      if (Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y) < 5 && !this.transformControl.dragging && !this.paintToolEnabled && !this.intentPaintMode) this._onClick(e);
      if (this.intentPaintMode) this.controls.enabled = !this.intentPaintMode;
      this.requestRender();
    });
    canvas.addEventListener('pointermove', (e: PointerEvent) => {
      if (this.intentPaintMode && e.buttons === 1) { this._handleIntentPaint(e); }
      this._handlePaintPointerMove(e);
    });
    canvas.addEventListener('pointerdown', (e: PointerEvent) => this._handlePaintPointerDown(e));
    canvas.addEventListener('pointerup', () => this._handlePaintPointerUp());
    canvas.addEventListener('pointerleave', () => this._handlePaintPointerLeave());
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

  setIntentPaintMode(enabled: boolean): void {
    this.intentPaintMode = enabled;
    this.canvas.classList.toggle('intent-paint-mode', enabled);
    this.controls.enabled = !enabled;
    if (!enabled) this._hidePaintPreview();
  }

  /**
   * Intent painting: on pointerdown/move in intent paint mode, raycast to find
   * the hit face index and write intent data to the model's intentBuffer.
   */
  protected _handleIntentPaint(e: PointerEvent): void {
    if (!this.intentPaintMode) return;
    const rect = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    const targets = this.selected.length > 0 ? this.selected : this.objects;
    const meshes = targets.map((o) => o.mesh);
    const intersects = this.raycaster.intersectObjects(meshes, false);
    const hit = intersects[0];
    if (!hit?.face) return;

    const object = targets.find((o) => o.mesh === hit.object);
    if (!object) return;

    // faceIndex from THREE.js is the triangle index for non-indexed geometry,
    // or the face index for indexed geometry
    const faceIndex = hit.faceIndex;
    if (faceIndex === undefined || faceIndex === null) return;

    // Determine triangles within brush radius
    const hitPoint = hit.point.clone();
    const geo = object.mesh.geometry;
    const pos = geo.attributes.position;
    if (!pos) return;

    const triCount = geo.index
      ? Math.floor(geo.index.count / 3)
      : Math.floor(pos.count / 3);

    // Ensure intent buffer exists
    if (!object.intentBuffer || object.intentBuffer.length !== triCount) {
      object.intentBuffer = new Uint8Array(triCount);
    }

    // Collect face indices within brush radius
    const brushRadius = this.intentBrushRadiusMM;
    const affectedFaces: number[] = [];
    const worldMatrix = object.mesh.matrixWorld;
    const v = new THREE.Vector3();

    if (brushRadius <= 0) {
      // Single face mode
      affectedFaces.push(faceIndex);
    } else {
      // Brush mode: find all triangles whose centroid is within radius
      for (let tri = 0; tri < triCount; tri++) {
        // Compute centroid in world space
        let cx = 0, cy = 0, cz = 0;
        if (geo.index) {
          for (let vi = 0; vi < 3; vi++) {
            const idx = geo.index.getX(tri * 3 + vi);
            v.fromBufferAttribute(pos, idx);
            v.applyMatrix4(worldMatrix);
            cx += v.x; cy += v.y; cz += v.z;
          }
        } else {
          for (let vi = 0; vi < 3; vi++) {
            v.fromBufferAttribute(pos, tri * 3 + vi);
            v.applyMatrix4(worldMatrix);
            cx += v.x; cy += v.y; cz += v.z;
          }
        }
        cx /= 3; cy /= 3; cz /= 3;

        const dx = cx - hitPoint.x;
        const dy = cy - hitPoint.y;
        const dz = cz - hitPoint.z;
        if (dx * dx + dy * dy + dz * dz <= brushRadius * brushRadius) {
          affectedFaces.push(tri);
        }
      }
    }

    if (affectedFaces.length === 0) return;

    // Dispatch event with the faces to paint — the panel/store handles encoding
    this.canvas.dispatchEvent(new CustomEvent('intent-paint-faces', {
      detail: { objectId: object.id, faceIndices: affectedFaces },
    }));
  }

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

  // ---- paint --------------------------------------------------------------
  setPaintToolEnabled(enabled: boolean): void {
    this.paintToolEnabled = enabled;
    this.canvas.classList.toggle('paint-mode', enabled);
    this.controls.enabled = !enabled || !this.isPainting;
    if (!enabled) this._hidePaintPreview();
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
    this.paintBrush = {
      radiusMM: brush.radiusMM ?? this.paintBrush.radiusMM,
      color: brush.color ?? this.paintBrush.color,
      density: brush.density ?? this.paintBrush.density,
      depthMM: brush.depthMM ?? this.paintBrush.depthMM,
      bumpStrength: brush.bumpStrength ?? this.paintBrush.bumpStrength,
      pattern: brush.pattern ?? this.paintBrush.pattern,
      patternScaleMM: brush.patternScaleMM ?? this.paintBrush.patternScaleMM,
    };
    if (this.paintPreview) {
      this.paintPreview.scale.setScalar(this.paintBrush.radiusMM);
      (this.paintPreview.material as THREE.MeshBasicMaterial).color.setHex(this.paintBrush.color);
    }
  }

  undoPaintStroke(): void {
    const target = this.selected[0] ?? this.paintTarget ?? this.objects.find((o) => (o.paintStrokes?.length ?? 0) > 0);
    if (!target?.paintStrokes?.length) return;
    target.paintStrokes.pop();
    this._syncPaintMaterial(target);
    this.canvas.dispatchEvent(new CustomEvent('paint-changed', { detail: { objectId: target.id } }));
    this.requestRender();
  }

  clearPaint(): void {
    const targets = this.selected.length > 0 ? this.selected : this.objects;
    for (const target of targets) {
      target.paintStrokes = [];
      this._syncPaintMaterial(target);
    }
    this.canvas.dispatchEvent(new CustomEvent('paint-changed'));
    this.requestRender();
  }

  getPaintStrokeCount(): number {
    const targets = this.selected.length > 0 ? this.selected : this.objects;
    return targets.reduce((count, target) => count + (target.paintStrokes?.length ?? 0), 0);
  }

  getPaintSliceMarks(): Array<{
    x: number;
    y: number;
    z: number;
    radiusMM: number;
    depthMM: number;
  }> {
    const marks: Array<{
      x: number;
      y: number;
      z: number;
      radiusMM: number;
      depthMM: number;
    }> = [];
    for (const obj of this.objects) {
      if (!obj.paintStrokes?.length) continue;
      obj.mesh.updateMatrixWorld(true);
      for (const stroke of obj.paintStrokes) {
        const point = new THREE.Vector3(
          stroke.localPoint[0],
          stroke.localPoint[1],
          stroke.localPoint[2],
        ).applyMatrix4(obj.mesh.matrixWorld);
        marks.push({
          x: point.x,
          y: point.y,
          z: point.z,
          radiusMM: stroke.radiusMM,
          depthMM: stroke.depthMM ?? 0.5,
        });
      }
    }
    return marks;
  }

  getPaintTextureConfig(): {
    strength: number;
    pattern: number;
    patternScaleMM: number;
  } {
    return {
      strength: this.paintBrush.density,
      pattern: this.paintBrush.pattern,
      patternScaleMM: this.paintBrush.patternScaleMM,
    };
  }

  protected _handlePaintPointerDown(e: PointerEvent): void {
    if (!this.paintToolEnabled || e.button !== 0) return;
    const hit = this._paintHitFromEvent(e);
    if (!hit) return;
    e.preventDefault();
    this.isPainting = true;
    this.controls.enabled = false;
    this.paintTarget = hit.object;
    this.lastPaintPoint = null;
    this._stampPaint(hit);
  }

  protected _handlePaintPointerMove(e: PointerEvent): void {
    if (!this.paintToolEnabled) return;
    const hit = this._paintHitFromEvent(e);
    if (!hit) {
      this._hidePaintPreview();
      return;
    }
    this._showPaintPreview(hit);
    if (this.isPainting) this._stampPaint(hit);
  }

  protected _handlePaintPointerUp(): void {
    if (!this.isPainting) return;
    this.isPainting = false;
    this.lastPaintPoint = null;
    this.controls.enabled = !this.paintToolEnabled;
    this.canvas.dispatchEvent(new CustomEvent('paint-changed', { detail: { objectId: this.paintTarget?.id } }));
  }

  protected _handlePaintPointerLeave(): void {
    this._handlePaintPointerUp();
    this._hidePaintPreview();
  }

  private _paintHitFromEvent(e: PointerEvent): { object: SceneObject; point: THREE.Vector3; normal: THREE.Vector3; localPoint: THREE.Vector3 } | null {
    const rect = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1),
      this.camera,
    );
    const targets = this.selected.length > 0 ? this.selected : this.objects;
    const meshes = targets.map((o) => o.mesh);
    const intersects = this.raycaster.intersectObjects(meshes, false);
    const hit = intersects[0];
    if (!hit?.face) return null;
    const object = targets.find((o) => o.mesh === hit.object);
    if (!object) return null;

    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    if (normal.dot(this.raycaster.ray.direction) > 0) normal.multiplyScalar(-1);
    const localPoint = hit.object.worldToLocal(hit.point.clone());
    return { object, point: hit.point.clone(), normal, localPoint };
  }

  private _stampPaint(hit: { object: SceneObject; localPoint: THREE.Vector3 }): void {
    if (this.paintTarget && hit.object !== this.paintTarget) return;
    const spacing = Math.max(0.2, this.paintBrush.radiusMM * 0.35);
    if (this.lastPaintPoint && this.lastPaintPoint.distanceTo(hit.localPoint) < spacing) return;

    const strokes = hit.object.paintStrokes ?? [];
    strokes.push({
      localPoint: [hit.localPoint.x, hit.localPoint.y, hit.localPoint.z],
      radiusMM: this.paintBrush.radiusMM,
      color: this.paintBrush.color,
      density: this.paintBrush.density,
      depthMM: this.paintBrush.depthMM,
      bumpStrength: this.paintBrush.bumpStrength,
      pattern: this.paintBrush.pattern,
      patternScaleMM: this.paintBrush.patternScaleMM,
    });
    hit.object.paintStrokes = strokes.slice(-MAX_SHADER_PAINT_STROKES);
    this.lastPaintPoint = hit.localPoint.clone();
    this._syncPaintMaterial(hit.object);
    this.requestRender();
  }

  private _showPaintPreview(hit: { point: THREE.Vector3; normal: THREE.Vector3 }): void {
    if (!this.paintPreview) {
      const geometry = new THREE.RingGeometry(0.92, 1, 64);
      const material = new THREE.MeshBasicMaterial({
        color: this.paintBrush.color,
        transparent: true,
        opacity: 0.88,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      this.paintPreview = new THREE.Mesh(geometry, material);
      this.paintPreview.renderOrder = 1000;
      this.scene.add(this.paintPreview);
    }
    this.paintPreview.visible = true;
    this.paintPreview.position.copy(hit.point).addScaledVector(hit.normal, 0.08);
    this.paintPreview.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);
    this.paintPreview.scale.setScalar(this.paintBrush.radiusMM);
  }

  private _hidePaintPreview(): void {
    if (this.paintPreview) this.paintPreview.visible = false;
  }

  protected _syncPaintMaterial(obj: SceneObject): void {
    const material = obj.mesh.material as THREE.MeshPhysicalMaterial;
    if (!material.userData.paintEnabled) this._installPaintShader(material);
    const shader = material.userData.paintShader as { uniforms?: Record<string, { value: unknown }> } | undefined;
    if (!shader?.uniforms) {
      material.needsUpdate = true;
      return;
    }

    const points = shader.uniforms.uPaintPoints.value as THREE.Vector4[];
    const colors = shader.uniforms.uPaintColors.value as THREE.Vector4[];
    const effects = shader.uniforms.uPaintEffects.value as THREE.Vector4[];
    const strokes = obj.paintStrokes ?? [];
    shader.uniforms.uPaintCount.value = Math.min(strokes.length, MAX_SHADER_PAINT_STROKES);
    for (let i = 0; i < MAX_SHADER_PAINT_STROKES; i++) {
      const stroke = strokes[i];
      if (!stroke) {
        points[i].set(0, 0, 0, 0);
        colors[i].set(0, 0, 0, 0);
        effects[i].set(0, 0, 0, 0);
        continue;
      }
      const color = new THREE.Color(stroke.color);
      points[i].set(stroke.localPoint[0], stroke.localPoint[1], stroke.localPoint[2], stroke.radiusMM);
      colors[i].set(color.r, color.g, color.b, stroke.density ?? 0.8);
      effects[i].set(stroke.depthMM ?? 0.5, stroke.bumpStrength ?? 0.6, stroke.pattern ?? 0, stroke.patternScaleMM ?? 2);
    }
  }

  private _installPaintShader(material: THREE.MeshPhysicalMaterial): void {
    material.userData.paintEnabled = true;
    material.customProgramCacheKey = () => 'slicelab-paint-v1';
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uPaintCount = { value: 0 };
      shader.uniforms.uPaintPoints = { value: Array.from({ length: MAX_SHADER_PAINT_STROKES }, () => new THREE.Vector4()) };
      shader.uniforms.uPaintColors = { value: Array.from({ length: MAX_SHADER_PAINT_STROKES }, () => new THREE.Vector4()) };
      shader.uniforms.uPaintEffects = { value: Array.from({ length: MAX_SHADER_PAINT_STROKES }, () => new THREE.Vector4()) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPaintLocalPosition;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaintLocalPosition = transformed;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vPaintLocalPosition;
uniform int uPaintCount;
uniform vec4 uPaintPoints[${MAX_SHADER_PAINT_STROKES}];
uniform vec4 uPaintColors[${MAX_SHADER_PAINT_STROKES}];
uniform vec4 uPaintEffects[${MAX_SHADER_PAINT_STROKES}];
float slHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float slNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = slHash(i);
  float b = slHash(i + vec2(1.0, 0.0));
  float c = slHash(i + vec2(0.0, 1.0));
  float d = slHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float slFbm(vec2 p) {
  float v = 0.0;
  v += 0.5 * slNoise(p);
  v += 0.25 * slNoise(p * 2.0 + vec2(17.0, 31.0));
  v += 0.125 * slNoise(p * 4.0 + vec2(53.0, 97.0));
  return v / 0.875;
}
float slicelabPaintHeight(vec3 localPosition) {
  float h = 0.0;
  for (int i = 0; i < ${MAX_SHADER_PAINT_STROKES}; i++) {
    if (i >= uPaintCount) break;
    vec4 brush = uPaintPoints[i];
    vec4 effect = uPaintEffects[i];
    float normalizedDistance = clamp(distance(localPosition, brush.xyz) / max(brush.w, 0.0001), 0.0, 1.0);
    float dome = 1.0 - smoothstep(0.0, 1.0, normalizedDistance);
    vec2 patternPosition = localPosition.xz / max(effect.w, 0.001);
    float carbonA = step(0.5, fract((patternPosition.x + patternPosition.y) * 0.5));
    float carbonB = step(0.5, fract((patternPosition.x - patternPosition.y) * 0.5));
    float carbon = mix(carbonA, carbonB, step(0.5, fract(patternPosition.y * 0.25)));
    float knurl = max(
      1.0 - smoothstep(0.04, 0.16, abs(fract(patternPosition.x + patternPosition.y) - 0.5)),
      1.0 - smoothstep(0.04, 0.16, abs(fract(patternPosition.x - patternPosition.y) - 0.5))
    );
    float ribbed = 1.0 - smoothstep(0.08, 0.22, abs(fract(patternPosition.x) - 0.5));
    float noise = slFbm(patternPosition * 3.0);
    float bumpsDist = length(fract(patternPosition) - 0.5);
    float bumps = 1.0 - smoothstep(0.0, 0.35, bumpsDist);
    float patterned = 1.0;
    patterned = mix(patterned, carbon, step(0.5, effect.z) * (1.0 - step(1.5, effect.z)));
    patterned = mix(patterned, knurl, step(1.5, effect.z) * (1.0 - step(2.5, effect.z)));
    patterned = mix(patterned, ribbed, step(2.5, effect.z) * (1.0 - step(3.5, effect.z)));
    patterned = mix(patterned, noise, step(3.5, effect.z) * (1.0 - step(4.5, effect.z)));
    patterned = mix(patterned, bumps, step(4.5, effect.z) * (1.0 - step(5.5, effect.z)));
    h = max(h, dome * patterned * effect.x * effect.y * uPaintColors[i].a);
  }
  return h;
}`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
float paintHeight = slicelabPaintHeight(vPaintLocalPosition);
vec3 paintDx = dFdx(vPaintLocalPosition);
vec3 paintDy = dFdy(vPaintLocalPosition);
float paintHeightDx = dFdx(paintHeight);
float paintHeightDy = dFdy(paintHeight);
normal = normalize(normal - paintHeightDx * normalize(cross(paintDy, normal)) + paintHeightDy * normalize(cross(paintDx, normal)));`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  float totalMask = 0.0;
  vec3 paintRGB = vec3(0.0);
  for (int i = 0; i < ${MAX_SHADER_PAINT_STROKES}; i++) {
    if (i >= uPaintCount) break;
    vec4 brush = uPaintPoints[i];
    float distToBrush = distance(vPaintLocalPosition, brush.xyz);
    vec4 effect = uPaintEffects[i];
    vec2 patternPosition = vPaintLocalPosition.xz / max(effect.w, 0.001);
    float carbonA = step(0.5, fract((patternPosition.x + patternPosition.y) * 0.5));
    float carbonB = step(0.5, fract((patternPosition.x - patternPosition.y) * 0.5));
    float carbon = mix(carbonA, carbonB, step(0.5, fract(patternPosition.y * 0.25)));
    float knurl = max(
      1.0 - smoothstep(0.04, 0.16, abs(fract(patternPosition.x + patternPosition.y) - 0.5)),
      1.0 - smoothstep(0.04, 0.16, abs(fract(patternPosition.x - patternPosition.y) - 0.5))
    );
    float ribbed = 1.0 - smoothstep(0.08, 0.22, abs(fract(patternPosition.x) - 0.5));
    float noise = slFbm(patternPosition * 3.0);
    float bumpsDist = length(fract(patternPosition) - 0.5);
    float bumps = 1.0 - smoothstep(0.0, 0.35, bumpsDist);
    float patterned = 1.0;
    patterned = mix(patterned, carbon, step(0.5, effect.z) * (1.0 - step(1.5, effect.z)));
    patterned = mix(patterned, knurl, step(1.5, effect.z) * (1.0 - step(2.5, effect.z)));
    patterned = mix(patterned, ribbed, step(2.5, effect.z) * (1.0 - step(3.5, effect.z)));
    patterned = mix(patterned, noise, step(3.5, effect.z) * (1.0 - step(4.5, effect.z)));
    patterned = mix(patterned, bumps, step(4.5, effect.z) * (1.0 - step(5.5, effect.z)));
    float paintMask = smoothstep(brush.w, brush.w * 0.65, distToBrush) * uPaintColors[i].a * mix(0.35, 1.0, patterned);
    paintRGB = mix(paintRGB, uPaintColors[i].rgb, step(totalMask, paintMask));
    totalMask = max(totalMask, paintMask);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, paintRGB, totalMask);
}`,
        );
      material.userData.paintShader = shader;
    };
  }

  // ---- material -----------------------------------------------------------
  getActiveMaterialPreset(): Record<string, unknown> { const obj = this.selected[0] || this.objects[0]; return (obj?.materialPreset || this.defaultMaterialPreset) as Record<string, unknown>; }
  setDefaultMaterialPreset(preset: Record<string, unknown>): void { if (preset) this.defaultMaterialPreset = preset; }
  setMaterialPreset(preset: Record<string, unknown>, target: 'selection' | 'all' = 'selection'): void {
    const targets = target === 'all' || this.selected.length === 0 ? this.objects : this.selected;
    targets.forEach((obj) => {
      const prev = obj.mesh.material as THREE.Material;
      obj.mesh.material = createResinMaterial(preset);
      obj.materialPreset = preset;
      if ((obj.paintStrokes?.length ?? 0) > 0) this._syncPaintMaterial(obj);
      prev?.dispose?.();
    });
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
      obj.materialPreset = sel.materialPreset;
      obj.paintStrokes = sel.paintStrokes?.map((stroke) => ({ ...stroke, localPoint: [...stroke.localPoint] }));
      if ((obj.paintStrokes?.length ?? 0) > 0) this._syncPaintMaterial(obj);
      obj.mesh.position.copy(sel.mesh.position); obj.mesh.position.x += 10; obj.mesh.position.z += 10; obj.mesh.updateMatrixWorld(); newSel.push(obj);
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
