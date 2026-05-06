/**
 * Manual pillar — build and merge a single support pillar into the viewer.
 * Called by manual-support.ts when the user clicks to place.
 * Supports auto-routing around geometry (same algorithm as auto-gen).
 */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import {
  buildSupportGeometry,
  type RouteWaypoint,
  type RouteContext,
  type RouteOptions,
  type ContactPoint,
} from '../../supports-geometry';
import { planSupportRoute } from '../../supports';

interface PillarViewer {
  activePlate: { originX?: number; originZ?: number };
  scene: THREE.Scene;
  requestRender(): void;
}

interface PillarObject {
  supportsMesh: THREE.Mesh | null;
  _cachedLocalSupportVolume?: number;
}

export interface ManualPillarOptions {
  tipDiameterMM: number;
  shaftDiameterMM: number;
  maxPillarAngle: number;
  modelClearance: number;
  maxContactOffset: number;
}

const DEFAULT_MANUAL_OPTIONS: ManualPillarOptions = {
  tipDiameterMM: 0.4,
  shaftDiameterMM: 0.8,
  maxPillarAngle: 45,
  modelClearance: 1.5,
  maxContactOffset: 18,
};

export function addManualPillar(
  viewer: PillarViewer,
  obj: PillarObject,
  worldPosition: THREE.Vector3,
  worldNormal: THREE.Vector3,
  modelGeometry: THREE.BufferGeometry | null,
  options?: Partial<ManualPillarOptions>,
): void {
  const opts: ManualPillarOptions = { ...DEFAULT_MANUAL_OPTIONS, ...options };
  const contactY = worldPosition.y;
  if (contactY <= 0.1) return;

  const originX = viewer.activePlate.originX || 0;
  const originZ = viewer.activePlate.originZ || 0;

  // Convert world-space contact to plate-local coordinates to match
  // the geometry returned by getModelGeometry() (which is plate-local).
  const localPosition = worldPosition.clone();
  localPosition.x -= originX;
  localPosition.z -= originZ;

  const tipHeight = Math.max(opts.tipDiameterMM * 1.2, 0.5);
  const pillarRadius = Math.max(opts.shaftDiameterMM / 2, 0.15);
  const baseRadius = pillarRadius * 2;
  const baseHeight = 0.5;

  let route: RouteWaypoint[] | null = null;

  // Try auto-routing around geometry if we have the model mesh
  if (modelGeometry) {
    // Ensure BVH is available for accelerated raycasting
    if (
      !(modelGeometry as unknown as { boundsTree: unknown }).boundsTree &&
      typeof modelGeometry.computeBoundsTree === 'function'
    ) {
      modelGeometry.computeBoundsTree();
    }

    const contactPoint: ContactPoint = {
      position: localPosition.clone(),
      normal: worldNormal.clone(),
    };
    const routeOpts: RouteOptions = {
      allowInternalSupports: false,
      allowCavityContacts: false,
      approachMode: 'prefer-angled',
      maxPillarAngle: opts.maxPillarAngle,
      modelClearance: Math.max(opts.modelClearance, pillarRadius * 1.5),
      supportCollisionRadius: Math.max(pillarRadius * 1.1, 0.2),
      maxContactOffset: opts.maxContactOffset,
    };

    const tempMesh = new THREE.Mesh(modelGeometry, new THREE.MeshBasicMaterial());
    tempMesh.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = false;
    const modelBounds = new THREE.Box3().setFromBufferAttribute(
      modelGeometry.attributes.position as THREE.BufferAttribute,
    );
    const modelCenter = new THREE.Vector3();
    modelBounds.getCenter(modelCenter);

    const ctx: RouteContext = { mesh: tempMesh, raycaster, modelBounds, modelCenter };
    route = planSupportRoute(contactPoint, ctx, pillarRadius, baseHeight, tipHeight, routeOpts);

    tempMesh.geometry = new THREE.BufferGeometry(); // detach without disposing source
    tempMesh.material.dispose();
  }

  // Fall back to straight vertical if routing failed or no geometry provided
  if (!route) {
    route = [
      { x: localPosition.x, y: localPosition.y, z: localPosition.z },
      { x: localPosition.x, y: 0, z: localPosition.z },
    ];
  }

  // Route is already in plate-local coordinates — no further offset needed

  const geometries: THREE.BufferGeometry[] = [];
  buildSupportGeometry(
    route,
    geometries,
    opts.tipDiameterMM,
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
