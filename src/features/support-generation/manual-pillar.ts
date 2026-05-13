/**
 * Manual pillar — plan a route for a user-placed support and add it to the
 * pillar store, then rebuild the supports mesh. Both auto and manual pillars
 * flow through the same store → rebuild path so settings apply uniformly.
 */
import * as THREE from 'three';
import {
  type RouteWaypoint,
  type RouteContext,
  type RouteOptions,
  type ContactPoint,
} from '../../supports-geometry';
import { planSupportRoute } from '../../supports';
import { addManualPillarRecord, buildPillarFromRoute } from './pillar-store';

interface PillarViewer {
  activePlate: { originX?: number; originZ?: number };
  scene: THREE.Scene;
  requestRender(): void;
  rebuildSupportsFromStore(modelId: string): void;
}

interface PillarObject {
  id: string;
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
      supportTipRadius: Math.max((opts.tipDiameterMM / 2) * 1.1, 0.15),
      maxContactOffset: opts.maxContactOffset,
    };

    const tempMesh = new THREE.Mesh(
      modelGeometry,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
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

  // If we have model geometry but no route fits without piercing, bail out.
  // Falling back to a vertical drop here would let manual pillars pierce
  // the model — exactly what the pierce-through fix prevents for auto-gen.
  if (!route && modelGeometry) {
    document.dispatchEvent(new CustomEvent('manual-support-failed'));
    return;
  }

  // No model geometry available (e.g. early in load): straight vertical is safe.
  if (!route) {
    route = [
      { x: localPosition.x, y: localPosition.y, z: localPosition.z },
      { x: localPosition.x, y: 0, z: localPosition.z },
    ];
  }

  // Snapshot for undo before we mutate the pillar store.
  document.dispatchEvent(new CustomEvent('pillar-edit-undo-save', { detail: { modelId: obj.id } }));

  const pillar = buildPillarFromRoute(
    route,
    {
      tipDiameter: opts.tipDiameterMM,
      pillarRadius,
      baseRadius,
      tipHeight,
      baseHeight,
    },
    'manual',
  );
  addManualPillarRecord(obj.id, pillar);
  viewer.rebuildSupportsFromStore(obj.id);
}
