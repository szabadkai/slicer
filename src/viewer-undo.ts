import * as THREE from 'three';
import type { Viewer } from './viewer';
import type { SceneObject } from './viewer-core';

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
  viewer.redoStack.push(snapshotCurrentState(viewer));
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

export function redo(viewer: Viewer): void {
  if (viewer.redoStack.length === 0) return;
  viewer.undoStack.push(snapshotCurrentState(viewer));
  if (viewer.undoStack.length > viewer.MAX_UNDO) viewer.undoStack.shift();
  const entry = viewer.redoStack.pop();
  viewer.transformControl.detach();

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
