/**
 * Viewer — extends ViewerCore with transforms, plate management,
 * arrangement, geometry queries, and undo.
 */

import * as THREE from 'three';
import { ViewerCore, createResinMaterial, type SceneObject, type PlateState } from './viewer-core';
import {
  addSignificantFaceMarker as addMarkerImpl,
  clearSignificantFaceMarkers as clearMarkersImpl,
  highlightSignificantFaces as highlightFacesImpl,
  clearSignificantFaceHighlights as clearHighlightsImpl,
} from './viewer-face-markers';
import type { CutAxis } from './features/model-transform/cut';
import type { SerializedObject } from './project-store';
import {
  saveUndoState,
  saveMultiPlateUndoState,
  savePillarEditUndoState,
  undo as undoImpl,
  redo as redoImpl,
  copySelected as copySelectedImpl,
  paste as pasteImpl,
} from './viewer-undo';
import {
  setSupportsMesh as setSupportsMeshImpl,
  clearSupports as clearSupportsImpl,
  removePillarAndRebuild as removePillarAndRebuildImpl,
  rebuildSupportsFromStore as rebuildSupportsFromStoreImpl,
  findPillarHit as findPillarHitImpl,
  findSupportStructureHit as findSupportStructureHitImpl,
  findObjectAnywhere,
} from './viewer-supports';
import {
  cutSelectedByAxisPlane as cutByAxisImpl,
  cutSelectedByPlane as cutByPlaneImpl,
  previewCutPlane as previewCutImpl,
  editCutPlane as editCutImpl,
  clearCutPlanePreview as clearCutImpl,
  getCutPlaneState as getCutStateImpl,
  syncInteractiveCutPlane as syncCutPlaneImpl,
} from './viewer-cut';
import {
  setActivePlate as setActivePlateImpl,
  bindInitialPlate as bindInitialPlateImpl,
  setPlates as setPlatesImpl,
  frameAllPlates as frameAllPlatesImpl,
  moveSelectedToPlate as moveSelectedImpl,
  replaceActiveObjects as replaceActiveImpl,
  duplicateObjectsForPlate as dupObjectsImpl,
  reassignObjectsToPlates as reassignImpl,
  autoArrange as autoArrangeImpl,
  fillPlatform as fillPlatformImpl,
  distributeAcrossPlates as distributeImpl,
  DEFAULT_ARRANGE_ELEVATION,
} from './viewer-plates';
import {
  getModelGeometry as getModelGeoImpl,
  getModelMesh as getModelMeshImpl,
  getMergedModelGeometry as getMergedGeoImpl,
  getMergedSupportGeometry as getMergedSupImpl,
  getOverallInfo as getOverallInfoImpl,
  checkBounds as checkBoundsImpl,
  updateBoundsWarning as updateBoundsImpl,
  buildSupportHeatmapGeometry as buildHeatmapImpl,
  showSupportHeatmap as showHeatmapImpl,
  clearSupportHeatmap as clearHeatmapImpl,
  buildThicknessHeatmapGeometry as buildThicknessImpl,
  showThicknessHeatmap as showThicknessImpl,
  clearThicknessHeatmap as clearThicknessImpl,
} from './viewer-geometry';
import {
  serializeObjects as serializeImpl,
  restoreSerializedObjects as restoreImpl,
} from './viewer-serialize';
import {
  addCutterPreview as addCutterImpl,
  updateCutterPreview as updateCutterImpl,
  removeCutterPreview as removeCutterImpl,
  setCutterGizmo as setCutterGizmoImpl,
  clearCutterGizmo as clearCutterGizmoImpl,
  onCutterGizmoChange as onCutterGizmoImpl,
  getModelPositions as getModelPositionsImpl,
} from './viewer-cutter-preview';

export { createResinMaterial };
export type { SceneObject, PlateState };

export class Viewer extends ViewerCore {
  _significantFaceMarkers: THREE.Group[] = [];

  constructor(canvas: HTMLCanvasElement) {
    super(canvas);
    document.addEventListener('pillar-edit-undo-save', (e) => {
      const modelId = (e as CustomEvent<{ modelId: string }>).detail?.modelId;
      if (modelId) savePillarEditUndoState(this, modelId);
    });
  }

  _cutPlanePreview: THREE.Mesh | null = null;
  _cutPlaneAxis: CutAxis = 'x';
  _cutPlaneInteractive = false;
  _cutPlaneBounds: { min: THREE.Vector3; max: THREE.Vector3; center: THREE.Vector3 } | null = null;
  _supportHeatmapMesh: THREE.Mesh | null = null;
  _thicknessHeatmapMesh: THREE.Mesh | null = null;

  // ---- multi-transform ----------------------------------------------------
  protected override _beginMultiTransform(): void {
    if (this.selected.length <= 1) {
      this.multiTransformState = null;
      return;
    }
    this.selectionPivot.updateMatrixWorld(true);
    this.multiTransformState = {
      pivotMatrix: this.selectionPivot.matrixWorld.clone(),
      objectMatrices: this.selected.map((sel) => {
        sel.mesh.updateMatrixWorld(true);
        return { sel, matrix: sel.mesh.matrixWorld.clone() };
      }),
    };
  }
  protected override _applyMultiTransformDelta(): void {
    if (this._cutPlaneInteractive) {
      this._syncInteractiveCutPlane();
      return;
    }
    if (!this.multiTransformState || this.selected.length <= 1 || !this.transformControl.dragging)
      return;
    this.selectionPivot.updateMatrixWorld(true);
    const delta = this.selectionPivot.matrixWorld
      .clone()
      .multiply(this.multiTransformState.pivotMatrix.clone().invert());
    this._applyMatrixToSelection(delta, this.multiTransformState.objectMatrices);
    this.canvas.dispatchEvent(new CustomEvent('mesh-transforming'));
  }
  _applyMatrixToSelection(
    delta: THREE.Matrix4,
    objectMatrices?: { sel: SceneObject; matrix: THREE.Matrix4 }[] | null,
  ): void {
    const pos = new THREE.Vector3(),
      quat = new THREE.Quaternion(),
      sc = new THREE.Vector3();
    const targets =
      objectMatrices ||
      this.selected.map((sel) => {
        sel.mesh.updateMatrixWorld(true);
        return { sel, matrix: sel.mesh.matrixWorld.clone() };
      });
    targets.forEach(({ sel, matrix }) => {
      delta.clone().multiply(matrix).decompose(pos, quat, sc);
      sel.mesh.position.copy(pos);
      sel.mesh.quaternion.copy(quat);
      sel.mesh.scale.copy(sc);
      sel.mesh.updateMatrixWorld(true);
    });
  }

  // ---- support sync during translate --------------------------------------
  protected override _beginTransformSupportSync(): void {
    if (this.transformControl.getMode?.() !== 'translate') {
      this.transformSupportState = null;
      return;
    }
    const items = this.selected
      .filter((s) => s.supportsMesh)
      .map((sel) => ({
        sel,
        meshPosition: sel.mesh.position.clone(),
        supportPosition: sel.supportsMesh?.position.clone() ?? new THREE.Vector3(),
      }));
    this.transformSupportState = items.length > 0 ? { items } : null;
  }
  protected override _syncSupportsDuringTranslation(): void {
    if (!this.transformSupportState || !this.transformControl.dragging) return;
    this.transformSupportState.items.forEach(({ sel, meshPosition, supportPosition }) => {
      if (!sel.supportsMesh) return;
      sel.supportsMesh.position.x = supportPosition.x + (sel.mesh.position.x - meshPosition.x);
      sel.supportsMesh.position.z = supportPosition.z + (sel.mesh.position.z - meshPosition.z);
    });
  }
  private _canPreserveSupportsDuringTranslation(): boolean {
    if (!this.transformSupportState || this.transformControl.getMode?.() !== 'translate')
      return false;
    return this.transformSupportState.items.every(
      ({ sel, meshPosition }) => Math.abs(sel.mesh.position.y - meshPosition.y) <= 1e-6,
    );
  }
  protected override _finishTransform(): void {
    if (this._cutPlaneInteractive) return;
    const preserve = this._canPreserveSupportsDuringTranslation();
    this._bakeTransform({ preserveSupports: preserve });
    this.transformSupportState = null;
    this._reassignObjectsToPlates();
  }

  // ---- transform API ------------------------------------------------------
  getSelectionWorldSize(): THREE.Vector3 | null {
    if (this.selected.length === 0) return null;
    const s = new THREE.Vector3();
    this._getSelectionBounds().getSize(s);
    return s;
  }
  getSelectionWorldCenter(): THREE.Vector3 | null {
    if (this.selected.length === 0) return null;
    const c = new THREE.Vector3();
    this._getSelectionBounds().getCenter(c);
    return c;
  }
  getSelectionWorldBounds(): { min: THREE.Vector3; max: THREE.Vector3 } | null {
    if (this.selected.length === 0) return null;
    const bounds = this._getSelectionBounds();
    return { min: bounds.min.clone(), max: bounds.max.clone() };
  }
  translateSelectionTo(position: THREE.Vector3): void {
    if (this.selected.length === 0) return;
    const cur =
      this.selected.length === 1 ? this.selected[0].mesh.position : this.getSelectionWorldCenter();
    if (!cur) return;
    const moves = this.selected
      .filter((s) => s.supportsMesh)
      .map((sel) => ({ sel, dx: position.x - cur.x, dz: position.z - cur.z }));
    const preserve = Math.abs(position.y - cur.y) <= 1e-6;
    if (this.selected.length === 1) this.selected[0].mesh.position.copy(position);
    else
      this._applyMatrixToSelection(
        new THREE.Matrix4().makeTranslation(
          position.x - cur.x,
          position.y - cur.y,
          position.z - cur.z,
        ),
      );
    if (preserve)
      moves.forEach(({ sel, dx, dz }) => {
        if (sel.supportsMesh) {
          sel.supportsMesh.position.x += dx;
          sel.supportsMesh.position.z += dz;
        }
      });
    this._bakeTransform({ preserveSupports: preserve });
  }
  scaleSelectionBy(scale: THREE.Vector3): void {
    if (this.selected.length === 0) return;
    if (this.selected.length === 1) this.selected[0].mesh.scale.set(scale.x, scale.y, scale.z);
    else {
      const c = this.getSelectionWorldCenter();
      if (c)
        this._applyMatrixToSelection(
          new THREE.Matrix4()
            .makeTranslation(c.x, c.y, c.z)
            .multiply(new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z))
            .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z)),
        );
    }
    this._bakeTransform();
  }
  rotateSelectionBy(rotation: THREE.Euler): void {
    if (this.selected.length === 0) return;
    if (this.selected.length === 1) this.selected[0].mesh.rotation.copy(rotation);
    else {
      const c = this.getSelectionWorldCenter();
      if (c)
        this._applyMatrixToSelection(
          new THREE.Matrix4()
            .makeTranslation(c.x, c.y, c.z)
            .multiply(new THREE.Matrix4().makeRotationFromEuler(rotation))
            .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z)),
        );
    }
    this._bakeTransform();
  }
  setTransformMode(mode: string | null): void {
    if (!mode) this.transformControl.detach();
    else {
      const m = mode as 'translate' | 'rotate' | 'scale';
      if (this.selected.length > 0) {
        this._attachTransformControls();
        this.transformControl.setMode(m);
      } else if (this.objects.length > 0) {
        this.selectObject(this.objects[0].id);
        this.transformControl.setMode(m);
      }
    }
    this.requestRender();
  }
  override _bakeTransform({ preserveSupports = false } = {}): void {
    if (this.selected.length === 0) return;
    this.multiTransformState = null;
    this.selected.forEach((sel) => {
      sel.mesh.updateMatrix();
      sel.mesh.geometry.applyMatrix4(sel.mesh.matrix);
      sel.mesh.position.set(0, 0, 0);
      sel.mesh.rotation.set(0, 0, 0);
      sel.mesh.scale.set(1, 1, 1);
      sel.mesh.updateMatrix();
      sel.mesh.geometry.computeBoundingBox();
      this._moveMeshOriginToBoundsMin(sel.mesh);
      sel._cachedLocalVolume = undefined;
    });
    if (this.selected.length > 1) this._positionSelectionPivot();
    if (!preserveSupports) this.clearSupports();
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  // ---- plate management (delegated to viewer-plates.ts) -------------------
  setActivePlate(plate: PlateState): void {
    setActivePlateImpl(this, plate);
  }
  bindInitialPlate(plate: PlateState): void {
    bindInitialPlateImpl(this, plate);
  }
  setPlates(plates: PlateState[]): void {
    setPlatesImpl(this, plates);
  }
  frameAllPlates(): void {
    frameAllPlatesImpl(this);
  }
  moveSelectedToPlate(targetPlate: PlateState, opts?: { selectMoved?: boolean }): SceneObject[] {
    return moveSelectedImpl(this, targetPlate, opts);
  }
  replaceActiveObjects(objects: SceneObject[]): void {
    replaceActiveImpl(this, objects);
  }
  duplicateObjectsForPlate(objects: SceneObject[] = this.objects): SceneObject[] {
    return dupObjectsImpl(this, objects);
  }
  _reassignObjectsToPlates(): void {
    reassignImpl(this);
  }

  // ---- geometry queries (delegated to viewer-geometry.ts) -----------------
  getModelGeometry(): THREE.BufferGeometry | null {
    return getModelGeoImpl(this);
  }
  getModelMesh(): THREE.Mesh | null {
    return getModelMeshImpl(this);
  }
  getMergedModelGeometry(): THREE.BufferGeometry | null {
    return getMergedGeoImpl(this);
  }
  getMergedSupportGeometry(): THREE.BufferGeometry | null {
    return getMergedSupImpl(this);
  }
  getOverallInfo(): ReturnType<typeof getOverallInfoImpl> {
    return getOverallInfoImpl(this);
  }
  checkBounds(): { inBounds: boolean } {
    return checkBoundsImpl(this);
  }
  updateBoundsWarning(): void {
    updateBoundsImpl(this);
  }

  // ---- supports (delegated to viewer-supports.ts) -------------------------
  setSupports(supportGeometry: THREE.BufferGeometry): void {
    if (this.selected.length !== 1) return;
    setSupportsMeshImpl(this, this.selected[0].id, supportGeometry);
  }
  setSupportsMesh(modelId: string, geo: THREE.BufferGeometry | null): void {
    setSupportsMeshImpl(this, modelId, geo);
  }
  clearSupports(): void {
    clearSupportsImpl(this);
  }
  removePillarAndRebuild(modelId: string, pillarId: string): boolean {
    return removePillarAndRebuildImpl(this, modelId, pillarId);
  }
  rebuildSupportsFromStore(modelId: string): void {
    rebuildSupportsFromStoreImpl(this, modelId);
  }
  _findObjectAnywhere(modelId: string): SceneObject | null {
    return findObjectAnywhere(this, modelId);
  }
  findPillarHit(point: THREE.Vector3, maxDistMM = 5): { modelId: string; pillarId: string } | null {
    return findPillarHitImpl(this, point, maxDistMM);
  }
  findSupportStructureHit(
    point: THREE.Vector3,
    maxDistMM = 5,
  ): { modelId: string; structureId: string } | null {
    return findSupportStructureHitImpl(this, point, maxDistMM);
  }
  getSupportsMesh(): THREE.Mesh | null {
    return this.selected.length === 1 ? this.selected[0].supportsMesh : null;
  }
  setElevation(elevation: number): void {
    if (this.selected.length === 0) return;
    this.selected.forEach((sel) => {
      if (sel.elevation === elevation) return;
      sel.elevation = elevation;
      sel.mesh.geometry.computeBoundingBox();
      const sbb = sel.mesh.geometry.boundingBox;
      if (sbb) sel.mesh.position.y = elevation - sbb.min.y;
      sel.mesh.updateMatrixWorld(true);
    });
    this.clearSupports();
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }
  applyRotation(
    quaternion: THREE.Quaternion | { x: number; y: number; z: number; w: number },
  ): void {
    if (this.selected.length !== 1) return;
    const sel = this.selected[0];
    const q =
      quaternion instanceof THREE.Quaternion
        ? quaternion
        : new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    sel.mesh.geometry.applyQuaternion(q);
    sel.mesh.geometry.computeBoundingBox();
    const rbb = sel.mesh.geometry.boundingBox;
    if (!rbb) return;
    const min = rbb.min.clone();
    sel.mesh.geometry.translate(-min.x, -min.y, -min.z);
    sel.mesh.geometry.computeBoundingBox();
    const newBB = sel.mesh.geometry.boundingBox;
    if (!newBB) return;
    const size = new THREE.Vector3();
    newBB.getSize(size);
    const origin = this.getActivePlateOrigin();
    sel.mesh.position.x = origin.x - size.x / 2;
    sel.mesh.position.z = origin.z - size.z / 2;
    sel.elevation = DEFAULT_ARRANGE_ELEVATION;
    sel.mesh.position.y = sel.elevation - (newBB.min.y ?? 0);
    sel.mesh.updateMatrixWorld(true);
    this.clearSupports();
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  // ---- undo / clipboard / cut (delegated to viewer-undo.ts) ---------------
  override _saveUndoState(): void {
    saveUndoState(this);
  }
  _saveMultiPlateUndoState(): void {
    saveMultiPlateUndoState(this);
  }
  undo(): void {
    undoImpl(this);
  }
  redo(): void {
    redoImpl(this);
  }
  copySelected(): void {
    copySelectedImpl(this);
  }
  paste(): void {
    pasteImpl(this);
  }
  async cutSelectedByAxisPlane(axis: CutAxis, worldOffset: number): Promise<boolean> {
    return cutByAxisImpl(this, axis, worldOffset);
  }
  async cutSelectedByPlane(worldNormal: THREE.Vector3, worldConstant: number): Promise<boolean> {
    return cutByPlaneImpl(this, worldNormal, worldConstant);
  }
  previewCutPlane(axis: CutAxis, worldOffset: number): boolean {
    return previewCutImpl(this, axis, worldOffset);
  }
  editCutPlane(
    axis: CutAxis,
    worldOffset: number,
    mode: 'translate' | 'rotate' = 'translate',
  ): boolean {
    return editCutImpl(this, axis, worldOffset, mode);
  }
  clearCutPlanePreview(): void {
    clearCutImpl(this);
  }
  getCutPlaneState(): ReturnType<typeof getCutStateImpl> {
    return getCutStateImpl(this);
  }
  _syncInteractiveCutPlane(): void {
    syncCutPlaneImpl(this);
  }

  // ---- arrangement (delegates to viewer-arrange.ts) -----------------------
  // ---- arrangement (delegated to viewer-plates.ts) ------------------------
  autoArrange(padding = 0.5, elevation = 10): boolean {
    return autoArrangeImpl(this, padding, elevation);
  }
  fillPlatform(): boolean {
    return fillPlatformImpl(this);
  }
  distributeAcrossPlates(plates: PlateState[], padding = 0.5, elevation = 10): boolean {
    return distributeImpl(this, plates, padding, elevation);
  }

  // ---- face markers (delegated to viewer-face-markers.ts) -----------------
  addSignificantFaceMarker(
    c: THREE.Vector3,
    n: THREE.Vector3,
    a: number,
    col: number,
    idx: number,
    opts?: Record<string, unknown>,
  ): void {
    addMarkerImpl(this, c, n, a, col, idx, opts);
  }
  clearSignificantFaceMarkers(): void {
    clearMarkersImpl(this);
  }
  highlightSignificantFaces(
    faces: { centroid: THREE.Vector3; normal: THREE.Vector3; area: number }[],
  ): void {
    highlightFacesImpl(this, faces);
  }
  clearSignificantFaceHighlights(): void {
    clearHighlightsImpl(this);
  }

  // ---- support heatmap (delegated to viewer-geometry.ts) ------------------
  buildSupportHeatmapGeometry(
    targets: SceneObject[],
    overhangAngleDeg: number,
  ): ReturnType<typeof buildHeatmapImpl> {
    return buildHeatmapImpl(targets, overhangAngleDeg);
  }
  showSupportHeatmap(result: {
    geometry: THREE.BufferGeometry | null;
    area: number;
    triangleCount: number;
  }): void {
    showHeatmapImpl(this, result);
  }
  clearSupportHeatmap(): void {
    clearHeatmapImpl(this);
  }

  // ---- thickness heatmap (delegated to viewer-geometry.ts) ----------------
  buildThicknessHeatmapGeometry(
    targets: SceneObject[],
    minThresholdMM: number,
    maxThresholdMM: number,
  ): ReturnType<typeof buildThicknessImpl> {
    return buildThicknessImpl(targets, minThresholdMM, maxThresholdMM);
  }
  showThicknessHeatmap(result: {
    geometry: THREE.BufferGeometry | null;
    minThickness: number;
    maxThickness: number;
  }): void {
    showThicknessImpl(this, result);
  }
  clearThicknessHeatmap(): void {
    clearThicknessImpl(this);
  }

  // ---- project serialization (delegated to viewer-serialize.ts) -----------
  serializeObjects(objects: SceneObject[] = this.objects): SerializedObject[] {
    return serializeImpl(this, objects);
  }
  restoreSerializedObjects(data: SerializedObject[]): SceneObject[] {
    const objs = restoreImpl(this, data);
    objs.forEach((obj) => {
      if ((obj.paintStrokes?.length ?? 0) > 0) this._syncPaintMaterial(obj);
    });
    return objs;
  }

  // ---- cutter preview (delegated to viewer-cutter-preview.ts) -------------
  addCutterPreview(positions: Float32Array): string {
    return addCutterImpl(this, positions);
  }
  updateCutterPreview(
    id: string,
    position: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number },
    scale: { x: number; y: number; z: number },
  ): void {
    updateCutterImpl(this, id, position, rotation, scale);
  }
  removeCutterPreview(id: string): void {
    removeCutterImpl(this, id);
  }
  setCutterGizmo(id: string, mode: 'translate' | 'rotate' | 'scale'): void {
    setCutterGizmoImpl(this, id, mode);
  }
  clearCutterGizmo(): void {
    clearCutterGizmoImpl(this);
  }
  onCutterGizmoChange(
    callback: (
      position: { x: number; y: number; z: number },
      rotation: { x: number; y: number; z: number },
      scale: { x: number; y: number; z: number },
    ) => void,
  ): () => void {
    return onCutterGizmoImpl(this, callback);
  }
  getModelPositions(id: string): Float32Array | null {
    return getModelPositionsImpl(this, id);
  }
}
