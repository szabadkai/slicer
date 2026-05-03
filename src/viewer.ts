/**
 * Viewer — extends ViewerCore with transforms, plate management,
 * arrangement, geometry queries, and undo.
 */

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { ViewerCore, createResinMaterial, type SceneObject, type PlateState } from './viewer-core';
import { computeMeshVolume } from './volume';
import {
  gaArrange,
  computeFillLayout,
  computeConvexHull,
  distributeAcrossPlates as distributeLayout,
  type BodyFootprint,
  type ArrangePlacement,
  type Point2D,
} from './viewer-arrange';
import {
  addSignificantFaceMarker as addMarker,
  clearSignificantFaceMarkers as clearMarkers,
} from './viewer-scene';
import type { SerializedObject } from './project-store';

export { createResinMaterial };
export type { SceneObject, PlateState };

export class Viewer extends ViewerCore {
  _significantFaceMarkers: THREE.Group[] = [];

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

  // ---- plate management ---------------------------------------------------
  setActivePlate(plate: PlateState): void {
    if (!plate || plate === this.activePlate) return;
    this._saveActivePlateSelection();
    this.transformControl.detach();
    this.activePlate = plate;
    this.objects = plate.objects;
    const ids = new Set(plate.selectedIds || []);
    this.selected = this.objects.filter((o) => ids.has(o.id));
    this._attachTransformControls();
    this._updateSelectionVisuals();
    this._setupGrid();
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('plate-changed', { detail: { plate } }));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed', { detail: { preserveSlice: true } }));
    this.requestRender();
  }
  bindInitialPlate(plate: PlateState): void {
    this.activePlate = plate;
    this.plates = [plate];
    this.objects = plate.objects;
    this.selected = [];
    this._setupGrid();
  }
  setPlates(plates: PlateState[]): void {
    this.plates = plates;
    this._setupGrid();
    plates.forEach((p) => p.objects.forEach((o) => this._setObjectSceneVisible(o, true)));
    this._updateSelectionVisuals();
  }
  frameAllPlates(): void {
    if (!this.printer || !this.plates?.length) return;
    const bb = new THREE.Box3();
    const p = this.printer as { buildWidthMM: number; buildDepthMM: number; buildHeightMM: number };
    this.plates.forEach((pl) => {
      const hw = p.buildWidthMM / 2,
        hd = p.buildDepthMM / 2;
      bb.expandByPoint(new THREE.Vector3((pl.originX || 0) - hw, 0, (pl.originZ || 0) - hd));
      bb.expandByPoint(
        new THREE.Vector3((pl.originX || 0) + hw, p.buildHeightMM, (pl.originZ || 0) + hd),
      );
    });
    const c = new THREE.Vector3(),
      s = new THREE.Vector3();
    bb.getCenter(c);
    bb.getSize(s);
    const m = Math.max(s.x, s.z, s.y);
    this.camera.position.set(c.x + m * 0.75, Math.max(m * 0.7, p.buildHeightMM), c.z + m * 0.75);
    this.controls.target.copy(c);
    this.controls.update();
    this.requestRender();
  }
  moveSelectedToPlate(targetPlate: PlateState, { selectMoved = true } = {}): SceneObject[] {
    if (!targetPlate || targetPlate === this.activePlate || this.selected.length === 0) return [];
    this._saveMultiPlateUndoState();
    const ids = new Set(this.selected.map((o) => o.id));
    const moving = this.objects.filter((o) => ids.has(o.id));
    this.objects = this.objects.filter((o) => !ids.has(o.id));
    this.activePlate.objects = this.objects;
    this.activePlate.selectedIds = [];
    const dx = (targetPlate.originX || 0) - (this.activePlate.originX || 0);
    const dz = (targetPlate.originZ || 0) - (this.activePlate.originZ || 0);
    moving.forEach((o) => {
      o.mesh.position.x += dx;
      o.mesh.position.z += dz;
      if (o.supportsMesh) {
        o.supportsMesh.position.x += dx;
        o.supportsMesh.position.z += dz;
      }
    });
    targetPlate.objects.push(...moving);
    targetPlate.selectedIds = selectMoved ? moving.map((o) => o.id) : [];
    this.selected = [];
    this.transformControl.detach();
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    return moving;
  }
  replaceActiveObjects(objects: SceneObject[]): void {
    this.transformControl.detach();
    this.objects.forEach((o) => this._setObjectSceneVisible(o, false));
    this.objects = objects;
    this.activePlate.objects = objects;
    this.selected = [];
    this.activePlate.selectedIds = [];
    this.objects.forEach((o) => this._setObjectSceneVisible(o, true));
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    this.requestRender();
  }
  duplicateObjectsForPlate(objects: SceneObject[] = this.objects): SceneObject[] {
    return objects.map((src) => {
      const mesh = new THREE.Mesh(
        src.mesh.geometry.clone(),
        (src.mesh.material as THREE.Material).clone(),
      );
      mesh.position.copy(src.mesh.position);
      mesh.rotation.copy(src.mesh.rotation);
      mesh.scale.copy(src.mesh.scale);
      const id = 'obj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      mesh.userData.id = id;
      mesh.updateMatrixWorld(true);
      let supportsMesh: THREE.Mesh | null = null;
      if (src.supportsMesh) {
        supportsMesh = new THREE.Mesh(
          src.supportsMesh.geometry.clone(),
          (src.supportsMesh.material as THREE.Material).clone(),
        );
        supportsMesh.position.copy(src.supportsMesh.position);
        supportsMesh.rotation.copy(src.supportsMesh.rotation);
        supportsMesh.scale.copy(src.supportsMesh.scale);
        supportsMesh.updateMatrixWorld(true);
      }
      return {
        id,
        mesh,
        supportsMesh,
        elevation: src.elevation,
        materialPreset: src.materialPreset || {},
      } as SceneObject;
    });
  }
  private _reassignObjectsToPlates(): void {
    if (this.selected.length === 0 || !this.plates || this.plates.length <= 1 || !this.printer)
      return;
    const spec = this.printer as { buildWidthMM: number; buildDepthMM: number };
    const hw = spec.buildWidthMM / 2,
      hd = spec.buildDepthMM / 2;
    let movedTo: PlateState | null = null;
    this.selected.forEach((sel) => {
      const pos = sel.mesh.position;
      const cur = this.getPlateForObject(sel.id);
      let bestPlate: PlateState | null = null,
        bestDist = Infinity;
      for (const pl of this.plates) {
        const ox = pl.originX || 0,
          oz = pl.originZ || 0;
        if (pos.x >= ox - hw && pos.x <= ox + hw && pos.z >= oz - hd && pos.z <= oz + hd) {
          const d = Math.hypot(pos.x - ox, pos.z - oz);
          if (d < bestDist) {
            bestDist = d;
            bestPlate = pl;
          }
        }
      }
      if (!bestPlate) {
        for (const pl of this.plates) {
          const d = Math.hypot(pos.x - (pl.originX || 0), pos.z - (pl.originZ || 0));
          if (d < bestDist) {
            bestDist = d;
            bestPlate = pl;
          }
        }
      }
      if (bestPlate && bestPlate !== cur) {
        this._moveObjectToPlate(sel, bestPlate);
        movedTo = bestPlate;
      }
    });
    if (movedTo) {
      this.setActivePlate(movedTo);
      this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    } else this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  }
  private _moveObjectToPlate(obj: SceneObject, target: PlateState): void {
    const cur = this.getPlateForObject(obj.id);
    if (!cur || cur === target) return;
    const idx = cur.objects.indexOf(obj);
    if (idx !== -1) cur.objects.splice(idx, 1);
    target.objects.push(obj);
    cur.slicedLayers = null;
    cur.slicedVolumes = null;
    cur.dirty = true;
    target.slicedLayers = null;
    target.slicedVolumes = null;
    target.dirty = true;
  }

  // ---- geometry queries ---------------------------------------------------
  getModelGeometry(): THREE.BufferGeometry | null {
    if (this.selected.length !== 1) return null;
    const m = this.selected[0].mesh;
    const g = m.geometry.clone();
    m.updateMatrixWorld(true);
    g.applyMatrix4(m.matrixWorld);
    g.translate(-(this.activePlate.originX || 0), 0, -(this.activePlate.originZ || 0));
    g.computeBoundingBox();
    return g;
  }
  getModelMesh(): THREE.Mesh | null {
    return this.selected.length === 1 ? this.selected[0].mesh : null;
  }
  getMergedModelGeometry(): THREE.BufferGeometry | null {
    if (this.objects.length === 0) return null;
    const gs = this.objects.map((o) => {
      const g = o.mesh.geometry.clone();
      o.mesh.updateMatrixWorld(true);
      g.applyMatrix4(o.mesh.matrixWorld);
      g.translate(-(this.activePlate.originX || 0), 0, -(this.activePlate.originZ || 0));
      return g;
    });
    return gs.length === 1 ? gs[0] : BufferGeometryUtils.mergeGeometries(gs, false);
  }
  getMergedSupportGeometry(): THREE.BufferGeometry | null {
    const gs: THREE.BufferGeometry[] = [];
    this.objects.forEach((o) => {
      if (o.supportsMesh) {
        const g = o.supportsMesh.geometry.clone();
        o.supportsMesh.updateMatrixWorld(true);
        g.applyMatrix4(o.supportsMesh.matrixWorld);
        g.translate(-(this.activePlate.originX || 0), 0, -(this.activePlate.originZ || 0));
        gs.push(g);
      }
    });
    if (gs.length === 0) return null;
    return gs.length === 1 ? gs[0] : BufferGeometryUtils.mergeGeometries(gs, false);
  }
  getOverallInfo(): {
    count: number;
    triangles: number;
    width: number;
    height: number;
    depth: number;
    modelVolume: number;
    supportVolume: number;
  } | null {
    if (this.objects.length === 0) return null;
    let tris = 0,
      modelVol = 0,
      supVol = 0;
    const bb = new THREE.Box3();
    this.objects.forEach((o) => {
      tris += o.mesh.geometry.attributes.position.count / 3;
      o.mesh.geometry.computeBoundingBox();
      o.mesh.updateMatrixWorld();
      const obb = o.mesh.geometry.boundingBox;
      if (obb) bb.union(obb.clone().applyMatrix4(o.mesh.matrixWorld));
      if (o._cachedLocalVolume === undefined)
        o._cachedLocalVolume = computeMeshVolume(o.mesh.geometry);
      modelVol += (o._cachedLocalVolume ?? 0) * Math.abs(o.mesh.matrixWorld.determinant());
      if (o.supportsMesh) {
        if (o._cachedLocalSupportVolume === undefined)
          o._cachedLocalSupportVolume = computeMeshVolume(o.supportsMesh.geometry);
        o.supportsMesh.updateMatrixWorld();
        supVol +=
          (o._cachedLocalSupportVolume ?? 0) * Math.abs(o.supportsMesh.matrixWorld.determinant());
      }
    });
    const size = new THREE.Vector3();
    bb.getSize(size);
    return {
      triangles: tris,
      width: size.x,
      height: size.y,
      depth: size.z,
      count: this.objects.length,
      modelVolume: modelVol,
      supportVolume: supVol,
    };
  }
  checkBounds(): { inBounds: boolean } {
    if (!this.printer || this.objects.length === 0) return { inBounds: true };
    const bb = new THREE.Box3();
    this.objects.forEach((o) => {
      o.mesh.geometry.computeBoundingBox();
      o.mesh.updateMatrixWorld();
      const obb = o.mesh.geometry.boundingBox;
      if (obb) bb.union(obb.clone().applyMatrix4(o.mesh.matrixWorld));
    });
    const p = this.printer as { buildWidthMM: number; buildDepthMM: number; buildHeightMM: number };
    const ox = this.activePlate.originX || 0,
      oz = this.activePlate.originZ || 0,
      hw = p.buildWidthMM / 2,
      hd = p.buildDepthMM / 2;
    return {
      inBounds:
        bb.min.x >= ox - hw &&
        bb.max.x <= ox + hw &&
        bb.min.z >= oz - hd &&
        bb.max.z <= oz + hd &&
        bb.max.y <= p.buildHeightMM,
    };
  }
  updateBoundsWarning(): void {
    if (!this.buildVolumeEdges) return;
    const { inBounds } = this.checkBounds();
    this.buildVolumeEdges.forEach(({ plate, lines }) => {
      const a = plate === this.activePlate;
      (lines.material as THREE.LineBasicMaterial).color.setHex(
        a && !inBounds ? 0xff4444 : a ? 0x0070f3 : 0x888888,
      );
      (lines.material as THREE.LineBasicMaterial).opacity = a && !inBounds ? 0.8 : a ? 0.7 : 0.3;
    });
    this._updateCollisionWarnings();
    this.requestRender();
  }

  private _updateCollisionWarnings(): void {
    const objs = this.objects;
    if (!this.printer || objs.length === 0) {
      this._flaggedIds.clear();
      return;
    }
    const p = this.printer as { buildWidthMM: number; buildDepthMM: number; buildHeightMM: number };
    const ox = this.activePlate.originX || 0,
      oz = this.activePlate.originZ || 0;
    const hw = p.buildWidthMM / 2,
      hd = p.buildDepthMM / 2;

    // Compute world-space AABB for each object
    const boxes: { obj: SceneObject; box: THREE.Box3 }[] = objs.map((obj) => {
      obj.mesh.geometry.computeBoundingBox();
      obj.mesh.updateMatrixWorld(true);
      const box = obj.mesh.geometry.boundingBox
        ? obj.mesh.geometry.boundingBox.clone().applyMatrix4(obj.mesh.matrixWorld)
        : new THREE.Box3();
      return { obj, box };
    });

    const flagged = new Set<string>();

    // Check out-of-bounds per model
    for (const { obj, box } of boxes) {
      if (
        box.min.x < ox - hw ||
        box.max.x > ox + hw ||
        box.min.z < oz - hd ||
        box.max.z > oz + hd ||
        box.max.y > p.buildHeightMM
      ) {
        flagged.add(obj.id);
      }
    }

    // Check pairwise overlap (AABB intersection)
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (boxes[i].box.intersectsBox(boxes[j].box)) {
          flagged.add(boxes[i].obj.id);
          flagged.add(boxes[j].obj.id);
        }
      }
    }

    this._flaggedIds = flagged;

    // Apply emissive color: red for flagged, else selection gray or none
    const selectedIds = new Set(this.selected.map((o) => o.id));
    for (const { obj } of boxes) {
      const mat = obj.mesh.material as THREE.MeshPhysicalMaterial;
      if (flagged.has(obj.id)) {
        mat.emissive.setHex(0x660000);
      } else {
        mat.emissive.setHex(selectedIds.has(obj.id) ? 0x333333 : 0x000000);
      }
    }
  }

  // ---- supports -----------------------------------------------------------
  setSupports(supportGeometry: THREE.BufferGeometry): void {
    if (this.selected.length !== 1) return;
    this.clearSupports();
    const mat = new THREE.MeshPhongMaterial({
      color: 0x9b59b6,
      specular: 0x222222,
      shininess: 30,
      transparent: true,
      opacity: 0.55,
    });
    const mesh = new THREE.Mesh(supportGeometry, mat);
    mesh.position.set(this.activePlate.originX || 0, 0, this.activePlate.originZ || 0);
    this.selected[0].supportsMesh = mesh;
    this.selected[0]._cachedLocalSupportVolume = undefined;
    this.scene.add(mesh);
    this.requestRender();
  }
  clearSupports(): void {
    this.selected.forEach((s) => {
      if (s.supportsMesh) {
        this.scene.remove(s.supportsMesh);
        s.supportsMesh.geometry.dispose();
        (s.supportsMesh.material as THREE.Material).dispose();
        s.supportsMesh = null;
      }
      s._cachedLocalSupportVolume = undefined;
    });
    this.requestRender();
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
    sel.mesh.position.x += min.x;
    sel.mesh.position.z += min.z;
    sel.mesh.position.y = sel.elevation;
    sel.mesh.updateMatrixWorld(true);
    this.clearSupports();
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  // ---- undo / clipboard ---------------------------------------------------
  override _saveUndoState(): void {
    const snap = this.objects.map((o) => ({
      geometry: o.mesh.geometry.clone(),
      material: (o.mesh.material as THREE.Material).clone(),
      materialPreset: o.materialPreset,
      position: o.mesh.position.clone(),
      rotation: o.mesh.rotation.clone(),
      scale: o.mesh.scale.clone(),
      elevation: o.elevation,
    }));
    this.undoStack.push(snap);
    if (this.undoStack.length > this.MAX_UNDO) this.undoStack.shift();
  }
  _saveMultiPlateUndoState(): void {
    const snap = {
      type: 'multi-plate' as const,
      activePlateId: this.activePlate.id,
      plates: this.plates.map((pl) => ({
        plateId: pl.id,
        objects: pl.objects.map((o) => ({
          id: o.id,
          geometry: o.mesh.geometry.clone(),
          material: (o.mesh.material as THREE.Material).clone(),
          materialPreset: o.materialPreset,
          position: o.mesh.position.clone(),
          rotation: o.mesh.rotation.clone(),
          scale: o.mesh.scale.clone(),
          elevation: o.elevation,
        })),
      })),
    };
    this.undoStack.push(snap);
    if (this.undoStack.length > this.MAX_UNDO) this.undoStack.shift();
  }
  undo(): void {
    if (this.undoStack.length === 0) return;
    const entry = this.undoStack.pop();
    this.transformControl.detach();

    if (
      entry &&
      typeof entry === 'object' &&
      'type' in (entry as Record<string, unknown>) &&
      (entry as { type: string }).type === 'multi-plate'
    ) {
      this._undoMultiPlate(
        entry as {
          activePlateId: string;
          plates: {
            plateId: string;
            objects: {
              id: string;
              geometry: THREE.BufferGeometry;
              material: THREE.Material;
              materialPreset: Record<string, unknown>;
              position: THREE.Vector3;
              rotation: THREE.Euler;
              scale: THREE.Vector3;
              elevation: number;
            }[];
          }[];
        },
      );
    } else {
      const snap = entry as {
        geometry: THREE.BufferGeometry;
        material: THREE.Material;
        materialPreset: Record<string, unknown>;
        position: THREE.Vector3;
        rotation: THREE.Euler;
        scale: THREE.Vector3;
        elevation: number;
      }[];
      this.objects.forEach((o) => {
        this.scene.remove(o.mesh);
        o.mesh.geometry.dispose();
        (o.mesh.material as THREE.Material).dispose();
        if (o.supportsMesh) {
          this.scene.remove(o.supportsMesh);
          o.supportsMesh.geometry.dispose();
          (o.supportsMesh.material as THREE.Material).dispose();
        }
      });
      this.objects = [];
      this.activePlate.objects = this.objects;
      this.selected = [];
      snap.forEach((s) => {
        const mesh = new THREE.Mesh(s.geometry, s.material);
        mesh.position.copy(s.position);
        mesh.rotation.copy(s.rotation);
        mesh.scale.copy(s.scale);
        const id = 'obj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
        mesh.userData.id = id;
        this.scene.add(mesh);
        this.objects.push({
          id,
          mesh,
          supportsMesh: null,
          elevation: s.elevation,
          materialPreset: s.materialPreset,
        } as SceneObject);
      });
    }

    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }
  private _undoMultiPlate(snap: {
    activePlateId: string;
    plates: {
      plateId: string;
      objects: {
        id: string;
        geometry: THREE.BufferGeometry;
        material: THREE.Material;
        materialPreset: Record<string, unknown>;
        position: THREE.Vector3;
        rotation: THREE.Euler;
        scale: THREE.Vector3;
        elevation: number;
      }[];
    }[];
  }): void {
    const plateMap = new Map(this.plates.map((pl) => [pl.id, pl]));
    // Remove all objects from all plates in the scene
    for (const pl of this.plates) {
      for (const o of pl.objects) {
        this.scene.remove(o.mesh);
        o.mesh.geometry.dispose();
        (o.mesh.material as THREE.Material).dispose();
        if (o.supportsMesh) {
          this.scene.remove(o.supportsMesh);
          o.supportsMesh.geometry.dispose();
          (o.supportsMesh.material as THREE.Material).dispose();
        }
      }
      pl.objects = [];
    }
    // Restore objects to their original plates
    for (const plateSnap of snap.plates) {
      const plate = plateMap.get(plateSnap.plateId);
      if (!plate) continue;
      for (const s of plateSnap.objects) {
        const mesh = new THREE.Mesh(s.geometry, s.material);
        mesh.position.copy(s.position);
        mesh.rotation.copy(s.rotation);
        mesh.scale.copy(s.scale);
        mesh.userData.id = s.id;
        this.scene.add(mesh);
        plate.objects.push({
          id: s.id,
          mesh,
          supportsMesh: null,
          elevation: s.elevation,
          materialPreset: s.materialPreset,
        } as SceneObject);
      }
    }
    this.objects = this.activePlate.objects;
    this.selected = [];
  }
  copySelected(): void {
    if (this.selected.length === 0) return;
    this.clipboard = this.selected.map((sel) => ({
      geometry: sel.mesh.geometry.clone(),
      material: (sel.mesh.material as THREE.Material).clone(),
      materialPreset: sel.materialPreset,
      position: sel.mesh.position.clone(),
      elevation: sel.elevation,
    }));
  }
  paste(): void {
    if (this.clipboard.length === 0) return;
    this._saveUndoState();
    const newSel: SceneObject[] = [];
    (
      this.clipboard as {
        geometry: THREE.BufferGeometry;
        material: THREE.Material;
        materialPreset: Record<string, unknown>;
        position: THREE.Vector3;
        elevation: number;
      }[]
    ).forEach((item) => {
      const obj = this._addModelRaw(item.geometry.clone(), item.material.clone(), item.elevation);
      obj.materialPreset = item.materialPreset;
      obj.mesh.position.copy(item.position);
      obj.mesh.position.x += 10;
      obj.mesh.position.z += 10;
      obj.mesh.updateMatrixWorld();
      newSel.push(obj);
    });
    this.selected = newSel;
    this._attachTransformControls();
    this._updateSelectionVisuals();
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  // ---- arrangement (delegates to viewer-arrange.ts) -----------------------
  autoArrange(padding = 0.5, elevation = 10): boolean {
    if (!this.printer) return false;
    if (this.plates.length > 1) {
      return this.distributeAcrossPlates(this.plates, padding, elevation);
    }
    if (this.objects.length === 0) return false;
    this._saveUndoState();
    const p = this.printer as { buildWidthMM: number; buildDepthMM: number };
    const uw = p.buildWidthMM,
      ud = p.buildDepthMM;
    if (uw <= 0 || ud <= 0) return false;
    const ox = this.activePlate.originX || 0,
      oz = this.activePlate.originZ || 0;

    // Build body footprints from actual mesh vertices (model+supports as a unit)
    const bodies = this._computeBodyFootprints(this.objects);

    // Run genetic algorithm
    const placements = gaArrange(bodies, uw, ud, { padding });
    if (placements.length === 0) return false;

    // Apply placements — move model+supports as rigid bodies
    this._applyArrangePlacements(placements, this.objects, ox, oz, elevation);

    if (this.selected.length > 1) this._positionSelectionPivot();
    else this._attachTransformControls();
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    return true;
  }
  fillPlatform(): boolean {
    if (this.selected.length !== 1 || !this.printer) return false;
    this._saveUndoState();
    this._bakeTransform();
    const sel = this.selected[0];
    sel.mesh.geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    const fbb = sel.mesh.geometry.boundingBox;
    if (fbb) fbb.getSize(size);
    const p = this.printer as { buildWidthMM: number; buildDepthMM: number };
    const layout = computeFillLayout(size.x, size.z, p.buildWidthMM, p.buildDepthMM);
    if (!layout) return false;
    const ox = this.activePlate.originX || 0,
      oz = this.activePlate.originZ || 0;
    const elev = sel.elevation,
      mat = sel.mesh.material as THREE.Material,
      preset = sel.materialPreset;
    const tpl = sel.mesh.geometry.clone();
    tpl.computeBoundingBox();
    const srcY = elev - (tpl.boundingBox?.min.y ?? 0);
    this.removeSelected();
    for (let i = 0; i < layout.countX; i++)
      for (let j = 0; j < layout.countZ; j++) {
        const obj = this._addModelRaw(tpl.clone(), mat.clone(), elev);
        obj.materialPreset = preset;
        obj.mesh.position.set(
          ox + layout.startX + i * layout.itemW - size.x / 2,
          srcY,
          oz + layout.startZ + j * layout.itemD - size.z / 2,
        );
        obj.mesh.updateMatrixWorld();
      }
    this.clearSelection();
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    return true;
  }
  distributeAcrossPlates(plates: PlateState[], padding = 0.5, elevation = 10): boolean {
    if (!plates?.length || !this.printer) return false;
    const p = this.printer as { buildWidthMM: number; buildDepthMM: number };
    const uw = p.buildWidthMM,
      ud = p.buildDepthMM;
    if (uw <= 0 || ud <= 0) return false;
    this._saveMultiPlateUndoState();

    const allObjs: { obj: SceneObject; sourcePlate: PlateState }[] = [];
    plates.forEach((pl) => pl.objects.forEach((obj) => allObjs.push({ obj, sourcePlate: pl })));
    if (allObjs.length === 0) return true;

    const bodies = this._computeBodyFootprints(allObjs.map((a) => a.obj));
    const plateLayouts = plates.map((pl) => ({
      plateId: pl.id,
      originX: pl.originX || 0,
      originZ: pl.originZ || 0,
    }));
    const placements = distributeLayout(bodies, plateLayouts, uw, ud, { padding });
    const placementMap = new Map(placements.map((dp) => [dp.id, dp]));
    const plateMap = new Map(plates.map((pl) => [pl.id, pl]));

    for (const { obj, sourcePlate } of allObjs) {
      const dp = placementMap.get(obj.id);
      if (!dp) continue;
      const targetPlate = plateMap.get(dp.plateId);
      if (!targetPlate) continue;
      const tox = targetPlate.originX || 0,
        toz = targetPlate.originZ || 0;
      this._applyBodyPlacement(obj, dp, tox, toz, elevation);
      if (sourcePlate.id !== dp.plateId) {
        const idx = sourcePlate.objects.indexOf(obj);
        if (idx !== -1) sourcePlate.objects.splice(idx, 1);
        targetPlate.objects.push(obj);
      }
    }
    this.objects = this.activePlate.objects;
    this.clearSelection();
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    return placements.length === allObjs.length;
  }

  // ---- body footprint + placement helpers --------------------------------

  private _computeBodyFootprints(objects: SceneObject[]): BodyFootprint[] {
    return objects.map((obj) => {
      // Collect world-space XZ vertices for the footprint
      const points: Point2D[] = [];

      const addMeshFootprint = (mesh: THREE.Mesh, baseOnly: boolean): void => {
        const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        mesh.updateMatrixWorld(true);
        const v = new THREE.Vector3();

        if (baseOnly) {
          // For supports: only use vertices near the build plate (Y < 1mm world space)
          // This avoids support tips at model height inflating the hull
          mesh.geometry.computeBoundingBox();
          const bbox = mesh.geometry.boundingBox;
          if (!bbox) return;
          const localFloor = bbox.min.y;
          const threshold = localFloor + 1; // 1mm above base in local space
          for (let i = 0; i < posAttr.count; i++) {
            const ly = posAttr.getY(i);
            if (ly <= threshold) {
              v.fromBufferAttribute(posAttr, i);
              v.applyMatrix4(mesh.matrixWorld);
              points.push({ x: v.x, z: v.z });
            }
          }
        } else {
          for (let i = 0; i < posAttr.count; i++) {
            v.fromBufferAttribute(posAttr, i);
            v.applyMatrix4(mesh.matrixWorld);
            points.push({ x: v.x, z: v.z });
          }
        }
      };

      addMeshFootprint(obj.mesh, false);
      if (obj.supportsMesh) addMeshFootprint(obj.supportsMesh, true);

      // Compute centroid and centre the hull
      let cx = 0,
        cz = 0;
      for (const pt of points) {
        cx += pt.x;
        cz += pt.z;
      }
      cx /= points.length;
      cz /= points.length;
      const centred = points.map((pt) => ({ x: pt.x - cx, z: pt.z - cz }));

      // Compute convex hull
      const hull = computeConvexHull(centred);
      // Supported models cannot be rotated (supports geometry is in plate-local coords)
      const canRotate = !obj.supportsMesh;
      return { id: obj.id, hull, canRotate };
    });
  }

  private _applyArrangePlacements(
    placements: ArrangePlacement[],
    objects: SceneObject[],
    plateOriginX: number,
    plateOriginZ: number,
    elevation: number,
  ): void {
    const lookup = new Map(objects.map((o) => [o.id, o]));
    for (const pl of placements) {
      const obj = lookup.get(pl.id);
      if (!obj) continue;
      this._applyBodyPlacement(obj, pl, plateOriginX, plateOriginZ, elevation);
    }
  }

  /** Move a model+supports body to the placement position.
   *  Unsupported models: rotate then translate.
   *  Supported models: translate only (rotation breaks plate-local supports geometry). */
  private _applyBodyPlacement(
    obj: SceneObject,
    placement: ArrangePlacement,
    plateOriginX: number,
    plateOriginZ: number,
    elevation: number,
  ): void {
    // Compute current combined bounding box centre
    obj.mesh.geometry.computeBoundingBox();
    obj.mesh.updateMatrixWorld(true);
    const box = obj.mesh.geometry.boundingBox
      ? obj.mesh.geometry.boundingBox.clone().applyMatrix4(obj.mesh.matrixWorld)
      : new THREE.Box3();
    if (obj.supportsMesh?.geometry) {
      obj.supportsMesh.geometry.computeBoundingBox();
      obj.supportsMesh.updateMatrixWorld(true);
      const supBB = obj.supportsMesh.geometry.boundingBox;
      if (supBB) box.union(supBB.clone().applyMatrix4(obj.supportsMesh.matrixWorld));
    }
    const center = new THREE.Vector3();
    box.getCenter(center);

    // Rotate only unsupported models (supports geometry is plate-local, can't be rotated)
    if (Math.abs(placement.angle) > 0.001 && !obj.supportsMesh) {
      obj.mesh.rotateY(placement.angle);
      obj.mesh.updateMatrixWorld(true);

      // Recompute centre after rotation
      obj.mesh.geometry.computeBoundingBox();
      const rotBB = obj.mesh.geometry.boundingBox;
      const newBox = rotBB ? rotBB.clone().applyMatrix4(obj.mesh.matrixWorld) : new THREE.Box3();
      newBox.getCenter(center);
      box.copy(newBox);
    }

    // Translate to target position
    // placement.x/z are in plate-local coords with (0,0) = plate centre
    const targetX = plateOriginX + placement.x;
    const targetZ = plateOriginZ + placement.z;
    const dx = targetX - center.x;
    const dy = obj.supportsMesh ? 0 - box.min.y : elevation - box.min.y;
    const dz = targetZ - center.z;

    obj.mesh.position.x += dx;
    obj.mesh.position.y += dy;
    obj.mesh.position.z += dz;
    if (!obj.supportsMesh) obj.elevation = elevation;
    obj.mesh.updateMatrixWorld(true);

    if (obj.supportsMesh) {
      obj.supportsMesh.position.x += dx;
      obj.supportsMesh.position.y += dy;
      obj.supportsMesh.position.z += dz;
      obj.supportsMesh.updateMatrixWorld(true);
    }
  }

  // ---- face markers -------------------------------------------------------
  addSignificantFaceMarker(
    centroid: THREE.Vector3,
    normal: THREE.Vector3,
    area: number,
    color: number,
    index: number,
    options?: Record<string, unknown>,
  ): void {
    addMarker(
      this.scene,
      this._significantFaceMarkers,
      centroid,
      normal,
      area,
      color,
      index,
      options,
    );
  }
  clearSignificantFaceMarkers(): void {
    clearMarkers(this.scene, this._significantFaceMarkers);
  }
  highlightSignificantFaces(
    faces: { centroid: THREE.Vector3; normal: THREE.Vector3; area: number }[],
  ): void {
    const colors = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0x95e1d3, 0xf38181, 0xaa96da];
    faces.forEach((f, i) =>
      this.addSignificantFaceMarker(f.centroid, f.normal, f.area, colors[i % colors.length], i + 1),
    );
  }
  clearSignificantFaceHighlights(): void {
    if (this.significantFaceHighlights) {
      this.significantFaceHighlights.forEach((m) => {
        if (m.parent === this.scene) this.scene.remove(m);
        m.geometry?.dispose();
        (m.material as THREE.Material)?.dispose();
      });
      this.significantFaceHighlights = null;
    }
    this.requestRender();
  }

  // ---- support heatmap ----------------------------------------------------
  private _supportHeatmapMesh: THREE.Mesh | null = null;

  buildSupportHeatmapGeometry(
    targets: SceneObject[],
    overhangAngleDeg: number,
  ): { geometry: THREE.BufferGeometry | null; area: number; triangleCount: number } | null {
    const geos: THREE.BufferGeometry[] = [];
    for (const obj of targets) {
      if (!obj?.mesh?.geometry) continue;
      const geometry = obj.mesh.geometry.clone();
      obj.mesh.updateMatrixWorld(true);
      geometry.applyMatrix4(obj.mesh.matrixWorld);
      geos.push(geometry);
    }
    if (geos.length === 0) return null;
    const merged = geos.length === 1 ? geos[0] : BufferGeometryUtils.mergeGeometries(geos, false);
    geos.forEach((g) => {
      if (g !== merged) g.dispose();
    });
    if (!merged) return null;

    const source = merged.index ? merged.toNonIndexed() : merged;
    if (source !== merged) merged.dispose();

    const pos = source.attributes.position;
    const overhangThreshold = Math.cos(THREE.MathUtils.degToRad(90 - overhangAngleDeg));
    const heatPositions: number[] = [];
    const heatColors: number[] = [];
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3();
    const center = new THREE.Vector3(),
      edge1 = new THREE.Vector3(),
      edge2 = new THREE.Vector3(),
      normal = new THREE.Vector3();
    let supportArea = 0,
      triangleCount = 0;

    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      edge1.subVectors(b, a);
      edge2.subVectors(c, a);
      normal.crossVectors(edge1, edge2);
      const area = normal.length() * 0.5;
      if (area <= 1e-8) continue;
      normal.normalize();
      const downness = -normal.y;
      if (downness <= overhangThreshold) continue;
      center.copy(a).add(b).add(c).divideScalar(3);
      if (center.y <= 0.5) continue;

      const angleDemand = THREE.MathUtils.clamp(
        (downness - overhangThreshold) / (1 - overhangThreshold),
        0,
        1,
      );
      const heightDemand = THREE.MathUtils.clamp(center.y / 50, 0, 1);
      const areaDemand = THREE.MathUtils.clamp(area / 35, 0, 1);
      const demand = THREE.MathUtils.clamp(
        Math.max(angleDemand, angleDemand * 0.82 + heightDemand * 0.12 + areaDemand * 0.06),
        0,
        1,
      );
      const color = this._supportDemandColor(demand);
      const offset = normal.clone().multiplyScalar(0.04);
      for (const v of [a, b, c]) {
        heatPositions.push(v.x + offset.x, v.y + offset.y, v.z + offset.z);
        heatColors.push(color.r, color.g, color.b);
      }
      supportArea += area;
      triangleCount++;
    }
    source.dispose();
    if (triangleCount === 0) return { geometry: null, area: 0, triangleCount: 0 };

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(heatPositions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(heatColors, 3));
    geometry.computeBoundingSphere();
    return { geometry, area: supportArea, triangleCount };
  }

  showSupportHeatmap(result: {
    geometry: THREE.BufferGeometry | null;
    area: number;
    triangleCount: number;
  }): void {
    this.clearSupportHeatmap();
    if (!result.geometry) return;
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this._supportHeatmapMesh = new THREE.Mesh(result.geometry, material);
    this._supportHeatmapMesh.renderOrder = 900;
    this.scene.add(this._supportHeatmapMesh);
    this.requestRender();
  }

  clearSupportHeatmap(): void {
    if (!this._supportHeatmapMesh) return;
    this.scene.remove(this._supportHeatmapMesh);
    this._supportHeatmapMesh.geometry?.dispose();
    (this._supportHeatmapMesh.material as THREE.Material)?.dispose();
    this._supportHeatmapMesh = null;
    this.requestRender();
  }

  private _supportDemandColor(demand: number): THREE.Color {
    const low = new THREE.Color(0x00e676);
    const mid = new THREE.Color(0xffea00);
    const hot = new THREE.Color(0xff6d00);
    const high = new THREE.Color(0xff1744);
    if (demand < 0.35) return low.lerp(mid, demand / 0.35);
    if (demand < 0.68) return mid.lerp(hot, (demand - 0.35) / 0.33);
    return hot.lerp(high, (demand - 0.68) / 0.32);
  }

  // ---- project serialization (for autosave) -------------------------------
  private _serializeMeshGeo(mesh: THREE.Mesh): {
    positions: ArrayBuffer;
    normals: ArrayBuffer | null;
    position: [number, number, number];
    rotation: [number, number, number, string];
    scale: [number, number, number];
  } {
    const geo = mesh.geometry;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute | null;
    const posArr = posAttr.array as Float32Array;
    const normArr = normAttr ? (normAttr.array as Float32Array) : null;
    return {
      positions: new Float32Array(posArr).buffer as ArrayBuffer,
      normals: normArr ? (new Float32Array(normArr).buffer as ArrayBuffer) : null,
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z, mesh.rotation.order],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
    };
  }

  serializeObjects(objects: SceneObject[] = this.objects): SerializedObject[] {
    return objects.map((obj) => {
      const meshData = this._serializeMeshGeo(obj.mesh);
      return {
        id: obj.id,
        ...meshData,
        elevation: obj.elevation,
        materialPreset: obj.materialPreset,
        supports: obj.supportsMesh ? this._serializeMeshGeo(obj.supportsMesh) : null,
      };
    });
  }

  private _restoreMesh(
    data: {
      positions: ArrayBuffer;
      normals: ArrayBuffer | null;
      position: [number, number, number];
      rotation: [number, number, number, string];
      scale: [number, number, number];
    },
    material: THREE.Material,
  ): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(data.positions), 3),
    );
    if (data.normals) {
      geo.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute(new Float32Array(data.normals), 3),
      );
    } else {
      geo.computeVertexNormals();
    }
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(data.position[0], data.position[1], data.position[2]);
    mesh.rotation.set(
      data.rotation[0],
      data.rotation[1],
      data.rotation[2],
      data.rotation[3] as THREE.EulerOrder,
    );
    mesh.scale.set(data.scale[0], data.scale[1], data.scale[2]);
    mesh.updateMatrixWorld(true);
    return mesh;
  }

  restoreSerializedObjects(data: SerializedObject[]): SceneObject[] {
    return data.map((item) => {
      const material = createResinMaterial(item.materialPreset);
      const mesh = this._restoreMesh(item, material);
      const id = item.id;
      mesh.userData.id = id;
      this.scene.add(mesh);

      let supportsMesh: THREE.Mesh | null = null;
      if (item.supports) {
        const supMat = new THREE.MeshPhysicalMaterial({
          color: 0x88aacc,
          roughness: 0.6,
          metalness: 0,
          transparent: true,
          opacity: 0.85,
        });
        supportsMesh = this._restoreMesh(item.supports, supMat);
        this.scene.add(supportsMesh);
      }

      const obj: SceneObject = {
        id,
        mesh,
        supportsMesh,
        elevation: item.elevation,
        materialPreset: item.materialPreset,
      };
      return obj;
    });
  }
}
