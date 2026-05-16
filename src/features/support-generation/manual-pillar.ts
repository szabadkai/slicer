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
  routeCollides,
} from '../../supports-geometry';
import { planSupportRoute } from '../../supports';
import {
  addManualPillarRecord,
  addSupportStructureRecord,
  buildPillarFromRoute,
  type SupportStructure,
} from './pillar-store';

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

export interface BranchTouchpointInput {
  position: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
}

const DEFAULT_MANUAL_OPTIONS: ManualPillarOptions = {
  tipDiameterMM: 0.4,
  shaftDiameterMM: 0.8,
  maxPillarAngle: 45,
  modelClearance: 1.5,
  maxContactOffset: 18,
};

let nextBranchId = 0;
function genBranchId(prefix: string): string {
  nextBranchId += 1;
  return `${prefix}_${Date.now().toString(36)}_${nextBranchId.toString(36)}`;
}

export function buildBranchSupportStructure(
  touchpoints: BranchTouchpointInput[],
  options?: Partial<ManualPillarOptions>,
): SupportStructure | null {
  if (touchpoints.length < 2) return null;
  const opts: ManualPillarOptions = { ...DEFAULT_MANUAL_OPTIONS, ...options };
  const tipRadius = Math.max(opts.tipDiameterMM / 2, 0.05);
  const shaftRadius = Math.max(opts.shaftDiameterMM / 2, 0.15);
  const branchRadius = Math.max(shaftRadius * 1.15, tipRadius);
  const baseRadius = Math.max(shaftRadius * 2, branchRadius * 1.4);

  const avg = touchpoints.reduce(
    (sum, point) => {
      sum.x += point.position.x;
      sum.y += point.position.y;
      sum.z += point.position.z;
      return sum;
    },
    { x: 0, y: 0, z: 0 },
  );
  avg.x /= touchpoints.length;
  avg.y /= touchpoints.length;
  avg.z /= touchpoints.length;
  const minTipY = Math.min(...touchpoints.map((point) => point.position.y));
  const branchDrop = Math.max(opts.shaftDiameterMM * 4, 3);
  const branchY = Math.max(shaftRadius + 0.5, minTipY - branchDrop);
  const structureId = genBranchId('branch');
  const branchNodeId = `${structureId}_junction`;
  const baseNodeId = `${structureId}_base`;

  return {
    id: structureId,
    origin: 'manual',
    kind: 'branching',
    touchpoints: touchpoints.map((point, index) => ({
      id: `${structureId}_touch_${index}`,
      position: { x: point.position.x, y: point.position.y, z: point.position.z },
      normal: { x: point.normal.x, y: point.normal.y, z: point.normal.z },
      diameter: opts.tipDiameterMM,
      shape: 'ball',
      priority: 'normal',
      enabled: true,
    })),
    nodes: [
      ...touchpoints.map((point, index) => ({
        id: `${structureId}_tip_${index}`,
        position: { x: point.position.x, y: point.position.y, z: point.position.z },
        radius: tipRadius,
        kind: 'tip' as const,
      })),
      {
        id: branchNodeId,
        position: { x: avg.x, y: branchY, z: avg.z },
        radius: branchRadius,
        kind: 'branch',
      },
      {
        id: baseNodeId,
        position: { x: avg.x, y: 0, z: avg.z },
        radius: baseRadius,
        kind: 'base',
      },
    ],
    edges: [
      ...touchpoints.map((_, index) => ({
        from: `${structureId}_tip_${index}`,
        to: branchNodeId,
        radius: Math.max(tipRadius * 0.8, shaftRadius * 0.55),
      })),
      {
        from: branchNodeId,
        to: baseNodeId,
        radius: shaftRadius,
      },
    ],
  };
}

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
      allowBridgeSupports: false,
      maxBridgeSearchRadius: 30,
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

/**
 * Place a bridge support between two user-picked surface points.
 * The support has tapered tips at both ends (no flared base).
 */
export function addBridgePillar(
  viewer: PillarViewer,
  obj: PillarObject,
  sourceWorld: THREE.Vector3,
  targetWorld: THREE.Vector3,
  modelGeometry: THREE.BufferGeometry | null,
  options?: Partial<ManualPillarOptions>,
): void {
  const opts: ManualPillarOptions = { ...DEFAULT_MANUAL_OPTIONS, ...options };

  const originX = viewer.activePlate.originX || 0;
  const originZ = viewer.activePlate.originZ || 0;

  const sourceLocal = sourceWorld.clone();
  sourceLocal.x -= originX;
  sourceLocal.z -= originZ;

  const targetLocal = targetWorld.clone();
  targetLocal.x -= originX;
  targetLocal.z -= originZ;

  const tipHeight = Math.max(opts.tipDiameterMM * 1.2, 0.5);
  const pillarRadius = Math.max(opts.shaftDiameterMM / 2, 0.15);
  const baseRadius = pillarRadius * 2;
  const baseHeight = 0.5;
  const minBridgeLength = tipHeight * 2 + 0.5;

  const distance = sourceLocal.distanceTo(targetLocal);
  if (distance < minBridgeLength) {
    document.dispatchEvent(new CustomEvent('manual-bridge-failed'));
    return;
  }

  // Ensure source is above target so the route goes "downward".
  const [top, bottom] =
    sourceLocal.y >= targetLocal.y ? [sourceLocal, targetLocal] : [targetLocal, sourceLocal];

  let route: RouteWaypoint[] = [
    { x: top.x, y: top.y, z: top.z },
    { x: bottom.x, y: bottom.y, z: bottom.z, internalResting: true },
  ];

  // Validate route against model geometry if available.
  if (modelGeometry) {
    if (
      !(modelGeometry as unknown as { boundsTree: unknown }).boundsTree &&
      typeof modelGeometry.computeBoundsTree === 'function'
    ) {
      modelGeometry.computeBoundsTree();
    }
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
    const collisionRadius = Math.max(pillarRadius * 1.1, 0.2);
    const tipRadius = Math.max((opts.tipDiameterMM / 2) * 1.1, 0.15);

    if (routeCollides(route, ctx, tipHeight, baseHeight, collisionRadius, tipRadius)) {
      // Try inserting a midpoint offset outward from model center.
      const mid = top.clone().add(bottom).multiplyScalar(0.5);
      const outward = new THREE.Vector3(mid.x - modelCenter.x, 0, mid.z - modelCenter.z);
      if (outward.lengthSq() > 0.01) outward.normalize();
      else outward.set(1, 0, 0);

      const offsetMid = mid.clone().addScaledVector(outward, opts.modelClearance * 2);
      const altRoute: RouteWaypoint[] = [
        { x: top.x, y: top.y, z: top.z },
        { x: offsetMid.x, y: offsetMid.y, z: offsetMid.z },
        { x: bottom.x, y: bottom.y, z: bottom.z, internalResting: true },
      ];

      if (routeCollides(altRoute, ctx, tipHeight, baseHeight, collisionRadius, tipRadius)) {
        tempMesh.geometry = new THREE.BufferGeometry();
        tempMesh.material.dispose();
        document.dispatchEvent(new CustomEvent('manual-bridge-failed'));
        return;
      }
      route = altRoute;
    }

    tempMesh.geometry = new THREE.BufferGeometry();
    tempMesh.material.dispose();
  }

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
  const lastWp = route[route.length - 1];
  pillar.bridgeTarget = { x: lastWp.x, y: lastWp.y, z: lastWp.z };
  addManualPillarRecord(obj.id, pillar);
  viewer.rebuildSupportsFromStore(obj.id);
}

export function addBranchSupportStructure(
  viewer: PillarViewer,
  obj: PillarObject,
  worldTouchpoints: { position: THREE.Vector3; normal: THREE.Vector3 }[],
  options?: Partial<ManualPillarOptions>,
): boolean {
  if (worldTouchpoints.length < 2) {
    document.dispatchEvent(new CustomEvent('manual-branch-failed'));
    return false;
  }

  const originX = viewer.activePlate.originX || 0;
  const originZ = viewer.activePlate.originZ || 0;
  const localTouchpoints = worldTouchpoints.map((point) => {
    const localPosition = point.position.clone();
    localPosition.x -= originX;
    localPosition.z -= originZ;
    return {
      position: localPosition,
      normal: point.normal.clone().normalize(),
    };
  });
  const structure = buildBranchSupportStructure(localTouchpoints, options);
  if (!structure) {
    document.dispatchEvent(new CustomEvent('manual-branch-failed'));
    return false;
  }

  document.dispatchEvent(new CustomEvent('pillar-edit-undo-save', { detail: { modelId: obj.id } }));
  addSupportStructureRecord(obj.id, structure);
  viewer.rebuildSupportsFromStore(obj.id);
  return true;
}
