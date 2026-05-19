/**
 * Viewer support-mesh helpers, extracted from viewer.ts to keep that file
 * under the project's 600-LOC convention.
 *
 * These functions operate on a `Viewer`-shaped argument with the minimal
 * surface the class exposes (scene, selection, plates, etc). They are
 * called from thin wrappers on the Viewer class.
 */

import * as THREE from 'three';
import type { SceneObject, PlateState } from './viewer-core';
import {
  clearPillarSet,
  getPillarSet,
  findPillarNear,
  findSupportStructureNear,
  removePillar as removePillarFromStore,
  rebuildSupportsMesh,
} from './features/support-generation/pillar-store';

interface ViewerLike {
  scene: THREE.Scene;
  selected: SceneObject[];
  plates: PlateState[];
  activePlate: PlateState & { originX?: number; originZ?: number };
  requestRender(): void;
}

const SUPPORT_MATERIAL = (): THREE.MeshPhongMaterial =>
  new THREE.MeshPhongMaterial({
    color: 0x9b59b6,
    specular: 0x222222,
    shininess: 30,
    transparent: true,
    opacity: 0.55,
  });

const BRACING_MATERIAL = (): THREE.MeshPhongMaterial =>
  new THREE.MeshPhongMaterial({
    color: 0x2bb5b2,
    specular: 0x222222,
    shininess: 30,
    transparent: true,
    opacity: 0.55,
  });

export function findObjectAnywhere(viewer: ViewerLike, modelId: string): SceneObject | null {
  for (const plate of viewer.plates) {
    for (const o of plate.objects) if (o.id === modelId) return o;
  }
  return null;
}

export function setSupportsMesh(
  viewer: ViewerLike,
  modelId: string,
  geo: THREE.BufferGeometry | null,
  bracingGeo?: THREE.BufferGeometry | null,
): void {
  const obj = findObjectAnywhere(viewer, modelId);
  if (!obj) return;
  if (obj.supportsMesh) {
    viewer.scene.remove(obj.supportsMesh);
    obj.supportsMesh.geometry.dispose();
    (obj.supportsMesh.material as THREE.Material).dispose();
    obj.supportsMesh = null;
  }
  if (obj.bracingMesh) {
    viewer.scene.remove(obj.bracingMesh);
    obj.bracingMesh.geometry.dispose();
    (obj.bracingMesh.material as THREE.Material).dispose();
    obj.bracingMesh = null;
  }
  obj._cachedLocalSupportVolume = undefined;
  const platePos = new THREE.Vector3(
    viewer.activePlate.originX || 0,
    0,
    viewer.activePlate.originZ || 0,
  );
  if (geo && (geo.attributes.position?.count ?? 0) > 0) {
    const mesh = new THREE.Mesh(geo, SUPPORT_MATERIAL());
    mesh.position.copy(platePos);
    obj.supportsMesh = mesh;
    viewer.scene.add(mesh);
  }
  if (bracingGeo && (bracingGeo.attributes.position?.count ?? 0) > 0) {
    const mesh = new THREE.Mesh(bracingGeo, BRACING_MATERIAL());
    mesh.position.copy(platePos);
    obj.bracingMesh = mesh;
    viewer.scene.add(mesh);
  }
  viewer.requestRender();
}

export function clearSupports(viewer: ViewerLike): void {
  viewer.selected.forEach((s) => {
    if (s.supportsMesh) {
      viewer.scene.remove(s.supportsMesh);
      s.supportsMesh.geometry.dispose();
      (s.supportsMesh.material as THREE.Material).dispose();
      s.supportsMesh = null;
    }
    if (s.bracingMesh) {
      viewer.scene.remove(s.bracingMesh);
      s.bracingMesh.geometry.dispose();
      (s.bracingMesh.material as THREE.Material).dispose();
      s.bracingMesh = null;
    }
    s._cachedLocalSupportVolume = undefined;
    clearPillarSet(s.id);
  });
  viewer.requestRender();
}

export function rebuildSupportsFromStore(viewer: ViewerLike, modelId: string): void {
  const obj = findObjectAnywhere(viewer, modelId);
  if (!obj) return;
  if (!obj.mesh.geometry.boundingBox) obj.mesh.geometry.computeBoundingBox();
  const bounds = obj.mesh.geometry.boundingBox?.clone() ?? undefined;
  const result = rebuildSupportsMesh(modelId, bounds, { modelGeometry: obj.mesh.geometry });
  setSupportsMesh(viewer, modelId, result.supports, result.bracing);
}

export function removePillarAndRebuild(
  viewer: ViewerLike,
  modelId: string,
  pillarId: string,
): boolean {
  const removed = removePillarFromStore(modelId, pillarId);
  if (!removed) return false;
  rebuildSupportsFromStore(viewer, modelId);
  return true;
}

export function findPillarHit(
  viewer: ViewerLike,
  point: THREE.Vector3,
  maxDistMM: number = 5,
): { modelId: string; pillarId: string } | null {
  const bestDist = maxDistMM;
  let bestHit: { modelId: string; pillarId: string } | null = null;
  for (const plate of viewer.plates) {
    for (const obj of plate.objects) {
      if (!obj.supportsMesh) continue;
      const set = getPillarSet(obj.id);
      if (set.legacyOpaque || set.pillars.length === 0) continue;
      const local = {
        x: point.x - obj.supportsMesh.position.x,
        y: point.y - obj.supportsMesh.position.y,
        z: point.z - obj.supportsMesh.position.z,
      };
      const pillar = findPillarNear(obj.id, local, bestDist);
      if (pillar) {
        bestHit = { modelId: obj.id, pillarId: pillar.id };
      }
    }
  }
  return bestHit;
}

export function findSupportStructureHit(
  viewer: ViewerLike,
  point: THREE.Vector3,
  maxDistMM: number = 5,
): { modelId: string; structureId: string } | null {
  const bestDist = maxDistMM;
  let bestHit: { modelId: string; structureId: string } | null = null;
  for (const plate of viewer.plates) {
    for (const obj of plate.objects) {
      if (!obj.supportsMesh) continue;
      const set = getPillarSet(obj.id);
      if (set.legacyOpaque || (set.supportStructures?.length ?? 0) === 0) continue;
      const local = {
        x: point.x - obj.supportsMesh.position.x,
        y: point.y - obj.supportsMesh.position.y,
        z: point.z - obj.supportsMesh.position.z,
      };
      const structure = findSupportStructureNear(obj.id, local, bestDist);
      if (structure) {
        bestHit = { modelId: obj.id, structureId: structure.id };
      }
    }
  }
  return bestHit;
}
