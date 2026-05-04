// ─── Selection management extracted from ViewerCore ──────────────
// All functions take the viewer core instance as first parameter.

import * as THREE from 'three';
import type { ViewerCore, SceneObject, PlateState } from './viewer-core';
import { isCutterGizmoActive } from './viewer-cutter-preview';

export function saveActivePlateSelection(core: ViewerCore): void {
  if (core.activePlate) core.activePlate.selectedIds = core.selected.map((o) => o.id);
}

export function clearSelection(core: ViewerCore): void {
  core.selected = [];
  attachTransformControls(core);
  updateSelectionVisuals(core);
  core.canvas.dispatchEvent(new CustomEvent('selection-changed'));
}

export function toggleSelection(core: ViewerCore, id: string): void {
  const idx = core.selected.findIndex((o) => o.id === id);
  if (idx !== -1) core.selected.splice(idx, 1);
  else {
    const obj = core.objects.find((o) => o.id === id);
    if (obj) core.selected.push(obj);
  }
  attachTransformControls(core);
  updateSelectionVisuals(core);
  core.canvas.dispatchEvent(new CustomEvent('selection-changed'));
}

export function selectObject(core: ViewerCore, id: string): void {
  if (!id) {
    clearSelection(core);
    return;
  }
  const obj = core.objects.find((o) => o.id === id);
  core.selected = obj ? [obj] : [];
  attachTransformControls(core);
  updateSelectionVisuals(core);
  core.canvas.dispatchEvent(new CustomEvent('selection-changed'));
}

export function selectObjects(core: ViewerCore, ids: string[]): void {
  const s = new Set(ids);
  core.selected = core.objects.filter((o) => s.has(o.id));
  attachTransformControls(core);
  updateSelectionVisuals(core);
  core.canvas.dispatchEvent(new CustomEvent('selection-changed'));
}

export function selectAll(core: ViewerCore): void {
  core.selected = [...core.objects];
  attachTransformControls(core);
  updateSelectionVisuals(core);
  core.canvas.dispatchEvent(new CustomEvent('selection-changed'));
}

export function getObjectTriangleCount(core: ViewerCore, objectId: string): number | null {
  const obj = core.objects.find((o) => o.id === objectId);
  if (!obj) return null;
  const geo = obj.mesh.geometry;
  const pos = geo.attributes.position;
  if (!pos) return null;
  return geo.index ? Math.floor(geo.index.count / 3) : Math.floor(pos.count / 3);
}

export function handleClick(core: ViewerCore, e: PointerEvent): void {
  if (isCutterGizmoActive()) return;
  const rect = core.canvas.getBoundingClientRect();
  core.raycaster.setFromCamera(
    new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    ),
    core.camera,
  );
  const allObjects = core.getAllObjects();

  // Check support meshes first — support click takes priority
  const supportMeshes = allObjects
    .map((o) => o.supportsMesh)
    .filter((m): m is THREE.Mesh => m !== null);
  if (supportMeshes.length > 0) {
    const supportHits = core.raycaster.intersectObjects(supportMeshes, false);
    if (supportHits.length > 0) {
      const hit = supportHits[0];
      const p = hit.point;
      core.canvas.dispatchEvent(
        new CustomEvent('support-clicked', {
          detail: { x: p.x, y: p.y, z: p.z, screenX: e.clientX, screenY: e.clientY },
        }),
      );
      return;
    }
  }

  const meshes = allObjects.map((o: SceneObject) => o.mesh);
  const intersects = core.raycaster.intersectObjects(meshes, false);
  const multi = e.shiftKey || e.ctrlKey || e.metaKey;
  if (intersects.length > 0) {
    const hit = intersects[0];
    const id = hit.object.userData.id as string;
    const hitPlate = core.getPlateForObject(id);
    if (hitPlate && hitPlate !== core.activePlate)
      (core as unknown as { setActivePlate(p: PlateState): void }).setActivePlate(hitPlate);

    if (multi) toggleSelection(core, id);
    else selectObject(core, id);
  } else if (!multi) clearSelection(core);
}

export function attachTransformControls(core: ViewerCore): void {
  if (isCutterGizmoActive()) return;
  if (core.selected.length === 1) {
    core.transformControl.attach(core.selected[0].mesh);
    if (!core.transformControl.getMode()) core.transformControl.setMode('translate');
  } else if (core.selected.length > 1) {
    positionSelectionPivot(core);
    core.transformControl.attach(core.selectionPivot);
    if (!core.transformControl.getMode()) core.transformControl.setMode('translate');
  } else core.transformControl.detach();
}

export function getSelectionBounds(core: ViewerCore): THREE.Box3 {
  const bb = new THREE.Box3();
  core.selected.forEach((s) => {
    s.mesh.geometry.computeBoundingBox();
    s.mesh.updateMatrixWorld(true);
    const sbb = s.mesh.geometry.boundingBox;
    if (sbb) bb.union(sbb.clone().applyMatrix4(s.mesh.matrixWorld));
  });
  return bb;
}

export function positionSelectionPivot(core: ViewerCore): void {
  if (core.selected.length <= 1) return;
  const c = new THREE.Vector3();
  getSelectionBounds(core).getCenter(c);
  core.selectionPivot.position.copy(c);
  core.selectionPivot.rotation.set(0, 0, 0);
  core.selectionPivot.scale.set(1, 1, 1);
  core.selectionPivot.updateMatrixWorld(true);
}

export function updateSelectionVisuals(core: ViewerCore): void {
  const ids = new Set(core.selected.map((o) => o.id));
  core.getAllObjects().forEach((o: SceneObject) => {
    if (core._flaggedIds.has(o.id)) {
      (o.mesh.material as THREE.MeshPhysicalMaterial).emissive.setHex(0x660000);
    } else {
      (o.mesh.material as THREE.MeshPhysicalMaterial).emissive.setHex(
        ids.has(o.id) ? 0x333333 : 0x000000,
      );
    }
  });
}
