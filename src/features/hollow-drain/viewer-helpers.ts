// ─── Viewer internal helpers for hollow-drain feature ─────────
// Runtime casts to reach THREE.js internals through the LegacyViewer boundary.

/* eslint-disable no-restricted-imports */
import * as THREE from 'three';
import type { AppContext } from '@core/types';
import { disposeGeometry, ensureGeometryBoundsTree } from '../../geometry-bvh';

export function getScene(viewer: AppContext['viewer']): THREE.Scene {
  return (viewer as unknown as { scene: THREE.Scene }).scene;
}

export function getMesh(viewer: AppContext['viewer']): THREE.Mesh | null {
  const sel = viewer.selected[0];
  if (!sel) return null;
  return sel.mesh as unknown as THREE.Mesh;
}

export function getGeometry(viewer: AppContext['viewer']): THREE.BufferGeometry | null {
  const mesh = getMesh(viewer);
  return mesh ? mesh.geometry.clone() : null;
}

export function setMeshGeometry(viewer: AppContext['viewer'], geo: THREE.BufferGeometry): void {
  const sel = viewer.selected[0];
  if (!sel) return;
  const mesh = sel.mesh as unknown as THREE.Mesh;
  disposeGeometry(mesh.geometry);
  ensureGeometryBoundsTree(geo);
  mesh.geometry = geo;
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeVertexNormals();
  mesh.updateMatrixWorld(true);
}

export function addModel(
  viewer: AppContext['viewer'],
  geo: THREE.BufferGeometry,
): { id: string } | null {
  return (
    viewer as unknown as { addModel(geo: unknown, elevation?: number): { id: string } }
  ).addModel(geo, 5);
}

export function addWorldModel(
  viewer: AppContext['viewer'],
  geo: THREE.BufferGeometry,
): { id: string } | null {
  const raw = viewer as unknown as {
    _addModelRaw(
      geometry: THREE.BufferGeometry,
      material: THREE.Material | null,
      elevation: number,
    ): { id: string };
    selectObject(id: string): void;
    canvas: HTMLCanvasElement;
  };
  const obj = raw._addModelRaw(geo, null, 5);
  raw.selectObject(obj.id);
  raw.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  return obj;
}

export function removeSceneObjectById(viewer: AppContext['viewer'], id: string): void {
  const legacy = viewer as unknown as {
    objects: Array<{
      id: string;
      mesh: THREE.Mesh;
      supportsMesh?: THREE.Mesh | null;
      bracingMesh?: THREE.Mesh | null;
    }>;
    activePlate: { objects: Array<{ id: string }> };
    scene: THREE.Scene;
    selected: Array<{ id: string }>;
    transformControl: { detach(): void };
    canvas: HTMLCanvasElement;
  };
  const obj = legacy.objects.find((item) => item.id === id);
  if (!obj) return;
  legacy.scene.remove(obj.mesh);
  disposeGeometry(obj.mesh.geometry);
  disposeMaterial(obj.mesh.material);
  if (obj.supportsMesh) {
    legacy.scene.remove(obj.supportsMesh);
    disposeGeometry(obj.supportsMesh.geometry);
    disposeMaterial(obj.supportsMesh.material);
  }
  if (obj.bracingMesh) {
    legacy.scene.remove(obj.bracingMesh);
    disposeGeometry(obj.bracingMesh.geometry);
    disposeMaterial(obj.bracingMesh.material);
  }
  legacy.objects = legacy.objects.filter((item) => item.id !== id);
  legacy.activePlate.objects = legacy.activePlate.objects.filter((item) => item.id !== id);
  legacy.selected = legacy.selected.filter((item) => item.id !== id);
  legacy.transformControl.detach();
  legacy.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  legacy.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
}

export function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else {
    material.dispose();
  }
}
