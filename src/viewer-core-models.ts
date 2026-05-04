// ─── Model loading & CRUD extracted from ViewerCore ──────────
// All functions take the viewer core instance as first parameter.

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import type { ViewerCore, SceneObject } from './viewer-core';
import { createResinMaterial } from './viewer-core';
import { syncPaintMaterial } from './viewer-core-paint';

export function loadSTL(core: ViewerCore, buffer: ArrayBuffer, scale = 1): void {
  const geo = new STLLoader().parse(buffer);
  if (scale !== 1) geo.scale(scale, scale, scale);
  geo.computeBoundingBox();
  geo.computeVertexNormals();
  const bb = geo.boundingBox;
  if (!bb) throw new Error('Failed to compute bounding box for STL');
  const center = new THREE.Vector3();
  bb.getCenter(center);
  const elevation = 5;
  geo.translate(-center.x, -bb.min.y + elevation, -center.z);
  geo.computeBoundingBox();
  addModel(core, geo, elevation);
  if (core.objects.length === 1) {
    const size = new THREE.Vector3();
    const gbb = geo.boundingBox;
    if (gbb) gbb.getSize(size);
    const m = Math.max(size.x, size.y, size.z);
    const origin = core.getActivePlateOrigin();
    core.camera.position.set(origin.x + m, m * 0.8, origin.z + m);
    core.controls.target.set(origin.x, size.y / 2, origin.z);
    core.controls.update();
  }
}

export function addModelRaw(
  core: ViewerCore,
  geometry: THREE.BufferGeometry,
  material: THREE.Material | null,
  elevation: number,
): SceneObject {
  const preset = core.defaultMaterialPreset;
  if (!material) material = createResinMaterial(preset);
  const mesh = new THREE.Mesh(geometry, material);
  const id = 'obj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  mesh.userData.id = id;
  core.scene.add(mesh);
  const obj: SceneObject = { id, mesh, supportsMesh: null, elevation, materialPreset: preset };
  core.objects.push(obj);
  return obj;
}

export function addModel(
  core: ViewerCore,
  geometry: THREE.BufferGeometry,
  elevation = 5,
): SceneObject {
  const obj = addModelRaw(core, geometry, null, elevation);
  moveMeshOriginToBoundsMin(obj.mesh);
  const origin = core.getActivePlateOrigin();
  obj.mesh.position.x += origin.x;
  obj.mesh.position.z += origin.z;
  obj.mesh.updateMatrixWorld(true);
  core.selectObject(obj.id);
  core.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  return obj;
}

export function moveMeshOriginToBoundsMin(mesh: THREE.Mesh): void {
  mesh.geometry.computeBoundingBox();
  const mbb = mesh.geometry.boundingBox;
  if (!mbb) return;
  const min = mbb.min.clone();
  if (min.lengthSq() === 0) return;
  mesh.geometry.translate(-min.x, -min.y, -min.z);
  mesh.position.add(min);
  mesh.geometry.computeBoundingBox();
  mesh.updateMatrixWorld(true);
}

export function removeSelected(core: ViewerCore): void {
  if (core.selected.length === 0) return;
  core._saveUndoState();
  core.transformControl.detach();
  const ids = new Set(core.selected.map((s) => s.id));
  core.objects.forEach((o) => {
    if (ids.has(o.id)) {
      core.scene.remove(o.mesh);
      o.mesh.geometry.dispose();
      (o.mesh.material as THREE.Material).dispose();
      if (o.supportsMesh) {
        core.scene.remove(o.supportsMesh);
        o.supportsMesh.geometry.dispose();
        (o.supportsMesh.material as THREE.Material).dispose();
      }
    }
  });
  core.objects = core.objects.filter((o) => !ids.has(o.id));
  core.activePlate.objects = core.objects;
  core.selected = [];
  core.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  core.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
}

export function clearPlate(core: ViewerCore): void {
  if (core.objects.length === 0) return;
  core._saveUndoState();
  core.transformControl.detach();
  core.objects.forEach((o) => {
    core.scene.remove(o.mesh);
    o.mesh.geometry.dispose();
    (o.mesh.material as THREE.Material).dispose();
    if (o.supportsMesh) {
      core.scene.remove(o.supportsMesh);
      o.supportsMesh.geometry.dispose();
      (o.supportsMesh.material as THREE.Material).dispose();
    }
  });
  core.objects = [];
  core.activePlate.objects = core.objects;
  core.selected = [];
  core.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  core.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
}

export function duplicateSelected(core: ViewerCore): void {
  if (core.selected.length === 0) return;
  core._saveUndoState();
  core._bakeTransform();
  const newSel: SceneObject[] = [];
  core.selected.forEach((sel) => {
    const obj = addModelRaw(
      core,
      sel.mesh.geometry.clone(),
      (sel.mesh.material as THREE.Material).clone(),
      sel.elevation,
    );
    obj.materialPreset = sel.materialPreset;
    obj.paintStrokes = sel.paintStrokes?.map((stroke) => ({
      ...stroke,
      localPoint: [...stroke.localPoint] as [number, number, number],
    }));
    if ((obj.paintStrokes?.length ?? 0) > 0) syncPaintMaterial(core, obj);
    obj.mesh.position.copy(sel.mesh.position);
    obj.mesh.position.x += 10;
    obj.mesh.position.z += 10;
    obj.mesh.updateMatrixWorld();
    newSel.push(obj);
  });
  core.selected = newSel;
  core._attachTransformControls();
  core._updateSelectionVisuals();
  core.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  core.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
}
