import * as THREE from 'three';
import type { Viewer } from './viewer';
import type { SceneObject } from './viewer-core';
import {
  cleanPlaneCutResult,
  cutGeometryByPlane,
  type CutAxis,
} from './features/model-transform/cut';
import { cutGeometryByManifoldPlane } from './features/model-transform/manifold-cut';

function axisComponent(vector: THREE.Vector3, axis: CutAxis): number {
  if (axis === 'x') return vector.x;
  if (axis === 'y') return vector.y;
  return vector.z;
}

function setAxisComponent(vector: THREE.Vector3, axis: CutAxis, value: number): void {
  if (axis === 'x') vector.x = value;
  else if (axis === 'y') vector.y = value;
  else vector.z = value;
}

function geometryFromPositions(positions: Float32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

function tupleFromVector(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

function hasCompleteCutResult(result: ReturnType<typeof cutGeometryByPlane>): result is ReturnType<
  typeof cutGeometryByPlane
> & {
  negative: Float32Array;
  positive: Float32Array;
} {
  return !!result.negative && !!result.positive;
}

function cutRetryOffsets(geometry: THREE.BufferGeometry): number[] {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return [0];
  const size = box.getSize(new THREE.Vector3());
  const diagonal = Math.max(size.length(), 1);
  const epsilon = THREE.MathUtils.clamp(diagonal * 1e-5, 0.001, 0.05);
  return [0, epsilon, -epsilon, epsilon * 4, -epsilon * 4];
}

// ---- undo / clipboard -----------------------------------------------------

export function saveUndoState(viewer: Viewer): void {
  const snap = viewer.objects.map((o) => ({
    geometry: o.mesh.geometry.clone(),
    material: (o.mesh.material as THREE.Material).clone(),
    materialPreset: o.materialPreset,
    position: o.mesh.position.clone(),
    rotation: o.mesh.rotation.clone(),
    scale: o.mesh.scale.clone(),
    elevation: o.elevation,
  }));
  viewer.undoStack.push(snap);
  if (viewer.undoStack.length > viewer.MAX_UNDO) viewer.undoStack.shift();
}

export function saveMultiPlateUndoState(viewer: Viewer): void {
  const snap = {
    type: 'multi-plate' as const,
    activePlateId: viewer.activePlate.id,
    plates: viewer.plates.map((pl) => ({
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
  viewer.undoStack.push(snap);
  if (viewer.undoStack.length > viewer.MAX_UNDO) viewer.undoStack.shift();
}

export function undo(viewer: Viewer): void {
  if (viewer.undoStack.length === 0) return;
  const entry = viewer.undoStack.pop();
  viewer.transformControl.detach();

  if (
    entry &&
    typeof entry === 'object' &&
    'type' in (entry as Record<string, unknown>) &&
    (entry as { type: string }).type === 'multi-plate'
  ) {
    undoMultiPlate(
      viewer,
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
    viewer.objects.forEach((o) => {
      viewer.scene.remove(o.mesh);
      o.mesh.geometry.dispose();
      (o.mesh.material as THREE.Material).dispose();
      if (o.supportsMesh) {
        viewer.scene.remove(o.supportsMesh);
        o.supportsMesh.geometry.dispose();
        (o.supportsMesh.material as THREE.Material).dispose();
      }
    });
    viewer.objects = [];
    viewer.activePlate.objects = viewer.objects;
    viewer.selected = [];
    snap.forEach((s) => {
      const mesh = new THREE.Mesh(s.geometry, s.material);
      mesh.position.copy(s.position);
      mesh.rotation.copy(s.rotation);
      mesh.scale.copy(s.scale);
      const id = 'obj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      mesh.userData.id = id;
      viewer.scene.add(mesh);
      viewer.objects.push({
        id,
        mesh,
        supportsMesh: null,
        elevation: s.elevation,
        materialPreset: s.materialPreset,
      } as SceneObject);
    });
  }

  viewer.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
}

function undoMultiPlate(
  viewer: Viewer,
  snap: {
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
): void {
  const plateMap = new Map(viewer.plates.map((pl) => [pl.id, pl]));
  for (const pl of viewer.plates) {
    for (const o of pl.objects) {
      viewer.scene.remove(o.mesh);
      o.mesh.geometry.dispose();
      (o.mesh.material as THREE.Material).dispose();
      if (o.supportsMesh) {
        viewer.scene.remove(o.supportsMesh);
        o.supportsMesh.geometry.dispose();
        (o.supportsMesh.material as THREE.Material).dispose();
      }
    }
    pl.objects = [];
  }
  for (const plateSnap of snap.plates) {
    const plate = plateMap.get(plateSnap.plateId);
    if (!plate) continue;
    for (const s of plateSnap.objects) {
      const mesh = new THREE.Mesh(s.geometry, s.material);
      mesh.position.copy(s.position);
      mesh.rotation.copy(s.rotation);
      mesh.scale.copy(s.scale);
      mesh.userData.id = s.id;
      viewer.scene.add(mesh);
      plate.objects.push({
        id: s.id,
        mesh,
        supportsMesh: null,
        elevation: s.elevation,
        materialPreset: s.materialPreset,
      } as SceneObject);
    }
  }
  viewer.objects = viewer.activePlate.objects;
  viewer.selected = [];
}

export function copySelected(viewer: Viewer): void {
  if (viewer.selected.length === 0) return;
  viewer.clipboard = viewer.selected.map((sel) => ({
    geometry: sel.mesh.geometry.clone(),
    material: (sel.mesh.material as THREE.Material).clone(),
    materialPreset: sel.materialPreset,
    position: sel.mesh.position.clone(),
    elevation: sel.elevation,
  }));
}

export function paste(viewer: Viewer): void {
  if (viewer.clipboard.length === 0) return;
  saveUndoState(viewer);
  const newSel: SceneObject[] = [];
  (
    viewer.clipboard as {
      geometry: THREE.BufferGeometry;
      material: THREE.Material;
      materialPreset: Record<string, unknown>;
      position: THREE.Vector3;
      elevation: number;
    }[]
  ).forEach((item) => {
    const obj = viewer._addModelRaw(item.geometry.clone(), item.material.clone(), item.elevation);
    obj.materialPreset = item.materialPreset;
    obj.mesh.position.copy(item.position);
    obj.mesh.position.x += 10;
    obj.mesh.position.z += 10;
    obj.mesh.updateMatrixWorld();
    newSel.push(obj);
  });
  viewer.selected = newSel;
  viewer._attachTransformControls();
  viewer._updateSelectionVisuals();
  viewer.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
}

// ---- cut operations -------------------------------------------------------

export async function cutSelectedByAxisPlane(
  viewer: Viewer,
  axis: CutAxis,
  worldOffset: number,
): Promise<boolean> {
  if (viewer.selected.length === 0 || !Number.isFinite(worldOffset)) return false;
  const normal = new THREE.Vector3();
  setAxisComponent(normal, axis, 1);
  return cutSelectedByPlane(viewer, normal, worldOffset);
}

export async function cutSelectedByPlane(
  viewer: Viewer,
  worldNormal: THREE.Vector3,
  worldConstant: number,
): Promise<boolean> {
  if (viewer.selected.length === 0 || !Number.isFinite(worldConstant)) return false;
  const normal = worldNormal.clone().normalize();
  if (normal.lengthSq() <= 1e-8) return false;
  const targets = [...viewer.selected];
  const originalObjects = [...viewer.objects];
  saveUndoState(viewer);
  viewer._bakeTransform();

  const worldPoint = normal.clone().multiplyScalar(worldConstant);
  const replacements: { source: SceneObject; parts: SceneObject[] }[] = [];

  for (const target of targets) {
    const parts = await cutObjectByPlane(viewer, target, normal, worldPoint);
    if (parts.length === 2) replacements.push({ source: target, parts });
  }

  if (replacements.length === 0) return false;

  viewer.transformControl.detach();
  for (const { source } of replacements) disposeSceneObject(viewer, source);
  const replaced = new Set(replacements.map(({ source }) => source));
  const inserted = new Map(replacements.map(({ source, parts }) => [source, parts]));
  const nextObjects: SceneObject[] = [];
  for (const obj of originalObjects) {
    const parts = inserted.get(obj);
    if (parts) nextObjects.push(...parts);
    else if (!replaced.has(obj)) nextObjects.push(obj);
  }
  viewer.objects = nextObjects;
  viewer.activePlate.objects = viewer.objects;

  clearCutPlanePreview(viewer);
  viewer.selected = replacements.flatMap(({ parts }) => parts);
  viewer._attachTransformControls();
  viewer._updateSelectionVisuals();
  viewer.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  return true;
}

async function cutObjectByPlane(
  viewer: Viewer,
  obj: SceneObject,
  worldNormal: THREE.Vector3,
  worldPoint: THREE.Vector3,
): Promise<SceneObject[]> {
  obj.mesh.geometry.computeBoundingBox();
  obj.mesh.updateMatrixWorld(true);
  const inverseWorld = obj.mesh.matrixWorld.clone().invert();
  const localNormal = worldNormal.clone().transformDirection(inverseWorld);
  const localPoint = obj.mesh.worldToLocal(worldPoint.clone());
  const localConstant = localNormal.dot(localPoint);
  const cutSource = obj.mesh.geometry.index ? obj.mesh.geometry.toNonIndexed() : obj.mesh.geometry;
  const positionAttribute = cutSource.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!positionAttribute) {
    if (cutSource !== obj.mesh.geometry) cutSource.dispose();
    return [];
  }
  const sourcePositions = new Float32Array(positionAttribute.array as ArrayLike<number>);
  if (cutSource !== obj.mesh.geometry) cutSource.dispose();
  const normalTuple = tupleFromVector(localNormal);
  let result: ReturnType<typeof cutGeometryByPlane> | null = null;
  for (const offset of cutRetryOffsets(obj.mesh.geometry)) {
    const constant = localConstant + offset;
    const manifoldResult = await cutGeometryByManifoldPlane(sourcePositions, normalTuple, constant);
    result =
      (manifoldResult ? cleanPlaneCutResult(manifoldResult) : null) ??
      cleanPlaneCutResult(cutGeometryByPlane(sourcePositions, normalTuple, constant));
    if (result) break;
  }
  if (!result) return [];

  const partMaterial = obj.mesh.material as THREE.Material;
  const partMaterials = [partMaterial.clone(), partMaterial.clone()];

  if (!hasCompleteCutResult(result)) return [];

  return [result.negative, result.positive].map((positions, index) => {
    const geometry = geometryFromPositions(positions);
    const part = viewer._addModelRaw(geometry, partMaterials[index], obj.elevation);
    part.materialPreset = obj.materialPreset;
    part.mesh.position.copy(obj.mesh.position);
    viewer._moveMeshOriginToBoundsMin(part.mesh);
    part.mesh.updateMatrixWorld(true);
    return part;
  });
}

function disposeSceneObject(viewer: Viewer, obj: SceneObject): void {
  viewer.scene.remove(obj.mesh);
  obj.mesh.geometry.dispose();
  (obj.mesh.material as THREE.Material).dispose();
  if (obj.supportsMesh) {
    viewer.scene.remove(obj.supportsMesh);
    obj.supportsMesh.geometry.dispose();
    (obj.supportsMesh.material as THREE.Material).dispose();
  }
}

// ---- cut plane preview ----------------------------------------------------

export function previewCutPlane(viewer: Viewer, axis: CutAxis, worldOffset: number): boolean {
  if (viewer.selected.length === 0 || !Number.isFinite(worldOffset)) {
    clearCutPlanePreview(viewer);
    return false;
  }
  const bounds = viewer.getSelectionWorldBounds();
  const center = viewer.getSelectionWorldCenter();
  if (!bounds || !center) {
    clearCutPlanePreview(viewer);
    return false;
  }
  const min = axisComponent(bounds.min, axis);
  const max = axisComponent(bounds.max, axis);
  if (worldOffset <= min || worldOffset >= max) {
    clearCutPlanePreview(viewer);
    return false;
  }

  viewer._cutPlaneAxis = axis;
  viewer._cutPlaneBounds = {
    min: bounds.min.clone(),
    max: bounds.max.clone(),
    center: center.clone(),
  };
  if (!viewer._cutPlanePreview) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0x1f8fff,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    viewer._cutPlanePreview = new THREE.Mesh(geometry, material);
    viewer._cutPlanePreview.renderOrder = 900;
    viewer.scene.add(viewer._cutPlanePreview);
  }

  placeCutPlanePreview(viewer._cutPlanePreview, axis, worldOffset, bounds, center);
  viewer.requestRender();
  return true;
}

export function editCutPlane(
  viewer: Viewer,
  axis: CutAxis,
  worldOffset: number,
  mode: 'translate' | 'rotate' = 'translate',
): boolean {
  if (!previewCutPlane(viewer, axis, worldOffset) || !viewer._cutPlanePreview) return false;
  viewer._cutPlaneInteractive = true;
  viewer.transformControl.detach();
  viewer.transformControl.attach(viewer._cutPlanePreview);
  viewer.transformControl.setMode(mode);
  viewer.transformControl.space = 'world';
  viewer.transformControl.showX = mode === 'rotate' || axis === 'x';
  viewer.transformControl.showY = mode === 'rotate' || axis === 'y';
  viewer.transformControl.showZ = mode === 'rotate' || axis === 'z';
  viewer.transformControl.showXY = false;
  viewer.transformControl.showYZ = false;
  viewer.transformControl.showXZ = false;
  viewer.requestRender();
  return true;
}

export function clearCutPlanePreview(viewer: Viewer): void {
  if (!viewer._cutPlanePreview) return;
  viewer._cutPlaneInteractive = false;
  restoreTransformControlAxes(viewer);
  viewer.transformControl.detach();
  viewer.scene.remove(viewer._cutPlanePreview);
  viewer._cutPlanePreview.geometry.dispose();
  (viewer._cutPlanePreview.material as THREE.Material).dispose();
  viewer._cutPlanePreview = null;
  viewer._cutPlaneBounds = null;
  viewer.requestRender();
}

export function getCutPlaneState(
  viewer: Viewer,
): { axis: CutAxis; position: number; normal: THREE.Vector3; constant: number } | null {
  if (!viewer._cutPlanePreview) return null;
  syncInteractiveCutPlane(viewer);
  viewer._cutPlanePreview.updateMatrixWorld(true);
  const normal = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(viewer._cutPlanePreview.getWorldQuaternion(new THREE.Quaternion()))
    .normalize();
  const constant = normal.dot(viewer._cutPlanePreview.getWorldPosition(new THREE.Vector3()));
  return {
    axis: viewer._cutPlaneAxis,
    position: axisComponent(viewer._cutPlanePreview.position, viewer._cutPlaneAxis),
    normal,
    constant,
  };
}

export function syncInteractiveCutPlane(viewer: Viewer): void {
  if (!viewer._cutPlaneInteractive || !viewer._cutPlanePreview || !viewer._cutPlaneBounds) return;
  const preview = viewer._cutPlanePreview;
  const axis = viewer._cutPlaneAxis;
  const min = axisComponent(viewer._cutPlaneBounds.min, axis);
  const max = axisComponent(viewer._cutPlaneBounds.max, axis);
  const position = THREE.MathUtils.clamp(
    axisComponent(preview.position, axis),
    min + 0.01,
    max - 0.01,
  );
  preview.position.copy(viewer._cutPlaneBounds.center);
  setAxisComponent(preview.position, axis, position);
  viewer.canvas.dispatchEvent(
    new CustomEvent('cut-plane-changed', {
      detail: { axis, position, min, max },
    }),
  );
}

function placeCutPlanePreview(
  preview: THREE.Mesh,
  axis: CutAxis,
  worldOffset: number,
  bounds: { min: THREE.Vector3; max: THREE.Vector3 },
  center: THREE.Vector3,
): void {
  const sizeX = Math.max(bounds.max.x - bounds.min.x, 1);
  const sizeY = Math.max(bounds.max.y - bounds.min.y, 1);
  const sizeZ = Math.max(bounds.max.z - bounds.min.z, 1);
  preview.position.copy(center);
  preview.rotation.set(0, 0, 0);
  if (axis === 'x') {
    preview.position.x = worldOffset;
    preview.rotation.y = Math.PI / 2;
    preview.scale.set(sizeZ * 1.12, sizeY * 1.12, 1);
  } else if (axis === 'y') {
    preview.position.y = worldOffset;
    preview.rotation.x = Math.PI / 2;
    preview.scale.set(sizeX * 1.12, sizeZ * 1.12, 1);
  } else {
    preview.position.z = worldOffset;
    preview.scale.set(sizeX * 1.12, sizeY * 1.12, 1);
  }
}

function restoreTransformControlAxes(viewer: Viewer): void {
  viewer.transformControl.showX = true;
  viewer.transformControl.showY = true;
  viewer.transformControl.showZ = true;
  viewer.transformControl.showXY = true;
  viewer.transformControl.showYZ = true;
  viewer.transformControl.showXZ = true;
}
