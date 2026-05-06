/**
 * Manual pillar — build and merge a single support pillar into the viewer.
 * Called by manual-support.ts when the user clicks to place.
 */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { buildSupportGeometry, type RouteWaypoint } from '../../supports-geometry';

interface PillarViewer {
  activePlate: { originX?: number; originZ?: number };
  scene: THREE.Scene;
  requestRender(): void;
}

interface PillarObject {
  supportsMesh: THREE.Mesh | null;
  _cachedLocalSupportVolume?: number;
}

export function addManualPillar(
  viewer: PillarViewer,
  obj: PillarObject,
  worldPosition: THREE.Vector3,
  _worldNormal: THREE.Vector3,
  tipDiameterMM: number,
): void {
  const contactY = worldPosition.y;
  if (contactY <= 0.1) return;

  // Build a simple vertical route from contact point to build plate
  const route: RouteWaypoint[] = [
    { x: worldPosition.x, y: worldPosition.y, z: worldPosition.z },
    { x: worldPosition.x, y: 0, z: worldPosition.z },
  ];

  // Offset by plate origin
  const originX = viewer.activePlate.originX || 0;
  const originZ = viewer.activePlate.originZ || 0;
  route[0].x -= originX;
  route[0].z -= originZ;
  route[1].x -= originX;
  route[1].z -= originZ;

  const tipHeight = Math.max(tipDiameterMM * 1.2, 0.5);
  const pillarRadius = Math.max(tipDiameterMM * 0.6, 0.3);
  const baseRadius = pillarRadius * 2;
  const baseHeight = 0.5;

  const geometries: THREE.BufferGeometry[] = [];
  buildSupportGeometry(
    route,
    geometries,
    tipDiameterMM,
    tipHeight,
    pillarRadius,
    baseRadius,
    baseHeight,
  );

  if (geometries.length === 0) return;

  const newPillarGeo =
    geometries.length === 1
      ? geometries[0]
      : BufferGeometryUtils.mergeGeometries(geometries, false);

  if (!newPillarGeo) {
    geometries.forEach((g) => g.dispose());
    return;
  }

  // Merge with existing support geometry if present
  if (obj.supportsMesh) {
    const existingGeo = obj.supportsMesh.geometry;
    const merged = BufferGeometryUtils.mergeGeometries([existingGeo, newPillarGeo], false);
    if (merged) {
      existingGeo.dispose();
      obj.supportsMesh.geometry = merged;
      obj._cachedLocalSupportVolume = undefined;
    }
    newPillarGeo.dispose();
  } else {
    // Create new support mesh
    const mat = new THREE.MeshPhongMaterial({
      color: 0x9b59b6,
      specular: 0x222222,
      shininess: 30,
      transparent: true,
      opacity: 0.55,
    });
    const mesh = new THREE.Mesh(newPillarGeo, mat);
    mesh.position.set(originX, 0, originZ);
    obj.supportsMesh = mesh;
    obj._cachedLocalSupportVolume = undefined;
    viewer.scene.add(mesh);
  }

  viewer.requestRender();
}
