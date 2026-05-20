import * as THREE from 'three';
import type { Viewer } from './viewer';
import type { SceneObject } from './viewer-core';
import {
  getPillarSet,
  setPillarSet,
  type ModelPillarSet,
} from './features/support-generation/pillar-store';
import { disposeGeometry, ensureGeometryBoundsTree } from './geometry-bvh';

interface PillarEditEntry {
  type: 'pillar-edit';
  modelId: string;
  previousPillarSet: ModelPillarSet;
}

function clonePillarSet(set: ModelPillarSet): ModelPillarSet {
  // structuredClone handles the nested Vector/Box objects in routeContext
  // poorly, so we strip it (routeContext is recomputed on next auto-gen).
  return {
    pillars: set.pillars.map((p) => ({
      ...p,
      route: p.route.map((w) => ({ ...w })),
      contact: { ...p.contact },
    })),
    settings: {
      ...set.settings,
      routeContext: undefined,
    },
    legacyOpaque: set.legacyOpaque,
  };
}

export function savePillarEditUndoState(viewer: Viewer, modelId: string): void {
  const entry: PillarEditEntry = {
    type: 'pillar-edit',
    modelId,
    previousPillarSet: clonePillarSet(getPillarSet(modelId)),
  };
  viewer.undoStack.push(entry);
  if (viewer.undoStack.length > viewer.MAX_UNDO) viewer.undoStack.shift();
  viewer.redoStack.length = 0;
}

function snapshotPillarEdit(modelId: string): PillarEditEntry {
  return {
    type: 'pillar-edit',
    modelId,
    previousPillarSet: clonePillarSet(getPillarSet(modelId)),
  };
}

function restorePillarEdit(viewer: Viewer, entry: PillarEditEntry): void {
  setPillarSet(entry.modelId, clonePillarSet(entry.previousPillarSet));
  viewer.rebuildSupportsFromStore(entry.modelId);
}

function disposeSceneObject(viewer: Viewer, obj: SceneObject): void {
  viewer.scene.remove(obj.mesh);
  disposeGeometry(obj.mesh.geometry);
  (obj.mesh.material as THREE.Material).dispose();
  if (obj.supportsMesh) {
    viewer.scene.remove(obj.supportsMesh);
    disposeGeometry(obj.supportsMesh.geometry);
    (obj.supportsMesh.material as THREE.Material).dispose();
  }
  if (obj.bracingMesh) {
    viewer.scene.remove(obj.bracingMesh);
    disposeGeometry(obj.bracingMesh.geometry);
    (obj.bracingMesh.material as THREE.Material).dispose();
  }
}

function restoreSnapshotMesh(s: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}): THREE.Mesh {
  ensureGeometryBoundsTree(s.geometry);
  const mesh = new THREE.Mesh(s.geometry, s.material);
  mesh.position.copy(s.position);
  mesh.rotation.copy(s.rotation);
  mesh.scale.copy(s.scale);
  return mesh;
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
  viewer.redoStack.length = 0;
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
  viewer.redoStack.length = 0;
}

function snapshotCurrentState(viewer: Viewer): unknown {
  if (viewer.plates.length > 1) {
    return {
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
  }
  return viewer.objects.map((o) => ({
    geometry: o.mesh.geometry.clone(),
    material: (o.mesh.material as THREE.Material).clone(),
    materialPreset: o.materialPreset,
    position: o.mesh.position.clone(),
    rotation: o.mesh.rotation.clone(),
    scale: o.mesh.scale.clone(),
    elevation: o.elevation,
  }));
}

export function undo(viewer: Viewer): void {
  if (viewer.undoStack.length === 0) return;
  const entry = viewer.undoStack.pop();
  viewer.transformControl.detach();

  if (
    entry &&
    typeof entry === 'object' &&
    'type' in (entry as Record<string, unknown>) &&
    (entry as { type: string }).type === 'pillar-edit'
  ) {
    viewer.redoStack.push(snapshotPillarEdit((entry as PillarEditEntry).modelId));
    restorePillarEdit(viewer, entry as PillarEditEntry);
    viewer.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    return;
  }

  viewer.redoStack.push(snapshotCurrentState(viewer));

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
    viewer.objects.forEach((o) => disposeSceneObject(viewer, o));
    viewer.objects = [];
    viewer.activePlate.objects = viewer.objects;
    viewer.selected = [];
    snap.forEach((s) => {
      const mesh = restoreSnapshotMesh(s);
      const id = 'obj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      mesh.userData.id = id;
      viewer.scene.add(mesh);
      viewer.objects.push({
        id,
        mesh,
        supportsMesh: null,
        bracingMesh: null,
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
      disposeSceneObject(viewer, o);
    }
    pl.objects = [];
  }
  for (const plateSnap of snap.plates) {
    const plate = plateMap.get(plateSnap.plateId);
    if (!plate) continue;
    for (const s of plateSnap.objects) {
      const mesh = restoreSnapshotMesh(s);
      mesh.userData.id = s.id;
      viewer.scene.add(mesh);
      plate.objects.push({
        id: s.id,
        mesh,
        supportsMesh: null,
        bracingMesh: null,
        elevation: s.elevation,
        materialPreset: s.materialPreset,
      } as SceneObject);
    }
  }
  viewer.objects = viewer.activePlate.objects;
  viewer.selected = [];
}

export function redo(viewer: Viewer): void {
  if (viewer.redoStack.length === 0) return;
  const entry = viewer.redoStack.pop();
  viewer.transformControl.detach();

  if (
    entry &&
    typeof entry === 'object' &&
    'type' in (entry as Record<string, unknown>) &&
    (entry as { type: string }).type === 'pillar-edit'
  ) {
    viewer.undoStack.push(snapshotPillarEdit((entry as PillarEditEntry).modelId));
    if (viewer.undoStack.length > viewer.MAX_UNDO) viewer.undoStack.shift();
    restorePillarEdit(viewer, entry as PillarEditEntry);
    viewer.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    return;
  }

  viewer.undoStack.push(snapshotCurrentState(viewer));
  if (viewer.undoStack.length > viewer.MAX_UNDO) viewer.undoStack.shift();

  if (
    entry &&
    typeof entry === 'object' &&
    'type' in (entry as Record<string, unknown>) &&
    (entry as { type: string }).type === 'multi-plate'
  ) {
    undoMultiPlate(viewer, entry as Parameters<typeof undoMultiPlate>[1]);
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
    viewer.objects.forEach((o) => disposeSceneObject(viewer, o));
    viewer.objects = [];
    viewer.activePlate.objects = viewer.objects;
    viewer.selected = [];
    snap.forEach((s) => {
      const mesh = restoreSnapshotMesh(s);
      const id = 'obj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      mesh.userData.id = id;
      viewer.scene.add(mesh);
      viewer.objects.push({
        id,
        mesh,
        supportsMesh: null,
        bracingMesh: null,
        elevation: s.elevation,
        materialPreset: s.materialPreset,
      } as SceneObject);
    });
  }

  viewer.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
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
