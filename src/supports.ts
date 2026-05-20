/**
 * Support generation — route planning, overhang detection, and orchestration.
 *
 * Geometry building, collision checks, cross-bracing, and base-pan creation
 * live in supports-geometry.ts.
 */

import * as THREE from 'three';
import { ensureGeometryBoundsTree, ensureBvhRaycast } from './geometry-bvh';
import {
  type RouteWaypoint,
  type ContactPoint,
  type RouteContext,
  type RouteOptions,
  routeCollides,
} from './supports-geometry';
import {
  buildPillarFromRoute,
  type Pillar,
  type PillarSetSettings,
  type SupportStructure,
} from './features/support-generation/pillar-store';
import { DEFAULT_OVERHANG_PARAMS } from './features/support-generation/detect';
import {
  ROUTE_DIRECTIONS,
  deduplicatePoints,
  uniqueSortedNumbers,
  directionOffset,
  normalizedAngleDelta,
  yieldThread,
} from './supports-utils';
import {
  findContactPoints,
  detectMinima,
  detectStabilization,
  detectReinforcements,
} from './supports-detect';
import { isExteriorContact } from './supports-exterior';
import { findBridgeRoute } from './supports-bridge';
import { clusterPillarsIntoBranchStructures } from './supports-branching';

ensureBvhRaycast();

export type { RouteWaypoint, ContactPoint, RouteContext, RouteOptions };

export { planSupportRoute };

const DOWN = new THREE.Vector3(0, -1, 0);

interface SupportOptions {
  overhangAngle?: number;
  density?: number;
  autoDensity?: boolean;
  tipDiameter?: number;
  supportThickness?: number;
  autoThickness?: boolean;
  internalSupports?: boolean;
  supportScope?: 'all' | 'outside-only';
  approachMode?: 'prefer-angled' | 'vertical';
  maxPillarAngle?: number;
  modelClearance?: number;
  maxContactOffset?: number;
  crossBracing?: boolean;
  baseBracingEnabled?: boolean;
  basePanEnabled?: boolean;
  basePanMargin?: number;
  basePanThickness?: number;
  basePanLipWidth?: number;
  basePanLipHeight?: number;
  sphericalConnection?: boolean;
  sphereConnectionDiameter?: number;
  detectMinima?: boolean;
  detectStabilization?: boolean;
  detectReinforcements?: boolean;
  stabilizationDensity?: number;
  reinforcementThreshold?: number;
  bridgeSupports?: boolean;
  maxBridgeSearchRadius?: number;
  experimentalBranchingSupports?: boolean;
  branchClusterRadius?: number;
  branchMaxTips?: number;
  onProgress?: (fraction: number, text: string) => void;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface GenerateSupportsResult {
  pillars: Pillar[];
  supportStructures: SupportStructure[];
  settings: PillarSetSettings;
  modelBounds: THREE.Box3;
}

export async function generateSupports(
  geometry: THREE.BufferGeometry,
  options: SupportOptions = {},
): Promise<GenerateSupportsResult> {
  const {
    overhangAngle = DEFAULT_OVERHANG_PARAMS.angleDeg,
    density = 5,
    autoDensity = false,
    tipDiameter = 0.4,
    supportThickness = 0.8,
    autoThickness = true,
    internalSupports = false,
    supportScope = internalSupports ? 'all' : 'outside-only',
    approachMode = 'prefer-angled',
    maxPillarAngle = 45,
    modelClearance = 1.5,
    maxContactOffset = 18,
    crossBracing = false,
    baseBracingEnabled = true,
    basePanEnabled = true,
    basePanMargin = 4,
    basePanThickness = 0.8,
    basePanLipWidth = 1.2,
    basePanLipHeight = 1,
    sphericalConnection = true,
    sphereConnectionDiameter = 0.3,
    detectMinima: doDetectMinima = true,
    detectStabilization: doDetectStabilization = true,
    detectReinforcements: doDetectReinforcements = false,
    stabilizationDensity = 4,
    reinforcementThreshold = 2.0,
    bridgeSupports = false,
    maxBridgeSearchRadius = 30,
    experimentalBranchingSupports = false,
    branchClusterRadius = 10,
    branchMaxTips = 5,
    onProgress,
  } = options;

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) throw new Error('Failed to compute bounding box');
  const modelBounds = bb.clone();
  const size = new THREE.Vector3();
  modelBounds.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const footprintArea = Math.max(size.x * size.z, 1);
  const normalizedFootprint = THREE.MathUtils.clamp(footprintArea / 10000, 0, 1);
  const normalizedHeight = THREE.MathUtils.clamp(size.y / 120, 0, 1);

  let effectiveDensity = density;
  if (autoDensity) {
    effectiveDensity = THREE.MathUtils.clamp(
      Math.round(6.5 - maxDim / 120 + normalizedFootprint * 1.5 + normalizedHeight),
      4,
      9,
    );
  }

  if (onProgress) {
    onProgress(0.05, 'Building bounds tree...');
    await yieldThread();
  }
  ensureGeometryBoundsTree(geometry);
  const tempMesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  tempMesh.updateMatrixWorld(true);
  const modelCenter = new THREE.Vector3();
  modelBounds.getCenter(modelCenter);
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = false;

  const scale = THREE.MathUtils.clamp(maxDim / 160, 0, 1);
  const loadBoost = normalizedFootprint * 0.25 + normalizedHeight * 0.2;
  let actualTipDiameter = tipDiameter;
  let actualSupportThickness = supportThickness;
  if (autoThickness) {
    actualTipDiameter = THREE.MathUtils.clamp(0.28 + scale * 0.45 + loadBoost, 0.28, 1.15);
    actualSupportThickness = THREE.MathUtils.clamp(actualTipDiameter * 1.85, 0.65, 2.4);
  }

  const pillarRadius = actualSupportThickness / 2;
  const tipHeight = actualTipDiameter * 3;
  const baseHeight = 0.6;
  const minSupportHeight = tipHeight + baseHeight + 0.5;
  const spacing = 12 - effectiveDensity;

  const routeOpts: RouteOptions = {
    allowInternalSupports: supportScope === 'all',
    allowCavityContacts: supportScope === 'all',
    approachMode,
    maxPillarAngle,
    modelClearance: Math.max(modelClearance, pillarRadius * 1.5),
    supportCollisionRadius: Math.max(pillarRadius * 1.1, 0.2),
    supportTipRadius: Math.max((actualTipDiameter / 2) * 1.1, 0.15),
    maxContactOffset,
    allowBridgeSupports: bridgeSupports ?? false,
    maxBridgeSearchRadius: maxBridgeSearchRadius ?? 30,
  };
  const ctx: RouteContext = { mesh: tempMesh, raycaster, modelBounds, modelCenter };

  if (onProgress) onProgress(0.07, 'Finding contact points...');
  await yieldThread();
  const contactPoints = await findContactPoints(
    geometry,
    overhangAngle,
    effectiveDensity,
    (text) => {
      if (onProgress) onProgress(0.07, text);
    },
  );

  if (doDetectMinima) {
    if (onProgress) onProgress(0.14, 'Detecting minima...');
    const pts = detectMinima(geometry, { minSupportHeight });
    contactPoints.push(...pts);
  }

  if (doDetectStabilization) {
    if (onProgress) onProgress(0.16, 'Detecting stabilization needs...');
    const pts = detectStabilization(geometry, {
      density: stabilizationDensity,
      minSupportHeight,
    });
    contactPoints.push(...pts);
  }

  if (doDetectReinforcements) {
    if (onProgress) onProgress(0.18, 'Detecting thin sections...');
    await yieldThread();
    const pts = await detectReinforcements(geometry, ctx, {
      thresholdMM: reinforcementThreshold,
      minSupportHeight,
    });
    contactPoints.push(...pts);
  }

  // Deduplicate across all detectors
  const allContactPoints = deduplicatePoints(contactPoints, spacing * 0.5);

  if (allContactPoints.length === 0) {
    return {
      pillars: [],
      supportStructures: [],
      settings: buildSettings({
        basePanEnabled,
        baseBracingEnabled,
        basePanMargin,
        basePanThickness,
        basePanLipWidth,
        basePanLipHeight,
        sphericalConnection,
        sphereConnectionDiameter,
        crossBracing,
        routeContext: undefined,
        bracingCollisionRadius: 0.5,
      }),
      modelBounds,
    };
  }

  let supportPoints = allContactPoints;
  if (!routeOpts.allowCavityContacts) {
    if (onProgress) {
      onProgress(0.2, 'Filtering interior contact points...');
      await yieldThread();
    }
    supportPoints = allContactPoints.filter((p) =>
      isExteriorContact(p, ctx, routeOpts.modelClearance),
    );
  }

  const routedContacts: ContactPoint[] = [];
  const routes: RouteWaypoint[][] = [];

  for (let i = 0; i < supportPoints.length; i++) {
    const cp = supportPoints[i];
    if (cp.position.y > minSupportHeight) {
      const route = planSupportRoute(cp, ctx, pillarRadius, baseHeight, tipHeight, routeOpts);
      if (route) {
        routes.push(route);
        routedContacts.push(cp);
      }
    }
    if (i % 200 === 0 && onProgress) {
      onProgress(
        0.2 + 0.6 * (i / supportPoints.length),
        `Planning routes... ${Math.round((i / supportPoints.length) * 100)}%`,
      );
      await yieldThread();
    }
  }

  const supportFloorY = basePanEnabled ? basePanThickness + 0.01 : 0;
  if (onProgress) {
    onProgress(0.9, 'Building pillars...');
    await yieldThread();
  }

  const pillars: Pillar[] = routes.map((route, i) => {
    const cp = routedContacts[i];
    let effectiveTipDiameter = actualTipDiameter;
    let effectivePillarRadius = pillarRadius;
    if (cp.reason === 'reinforcement') {
      effectiveTipDiameter = Math.min(actualTipDiameter * 1.4, 1.2);
      effectivePillarRadius = Math.min(pillarRadius * 1.2, 1.0);
    }
    const pillar = buildPillarFromRoute(
      route,
      {
        tipDiameter: effectiveTipDiameter,
        pillarRadius: effectivePillarRadius,
        baseRadius: effectivePillarRadius * 2.5,
        tipHeight,
        baseHeight,
      },
      'auto',
    );
    const lastWp = route[route.length - 1];
    if (lastWp.internalResting) {
      pillar.bridgeTarget = { x: lastWp.x, y: lastWp.y, z: lastWp.z };
    }
    return pillar;
  });
  const branchResult = experimentalBranchingSupports
    ? clusterPillarsIntoBranchStructures(pillars, {
        clusterRadius: branchClusterRadius,
        maxTips: branchMaxTips,
        supportFloorY,
        routeContext: ctx,
        collisionRadius: routeOpts.supportCollisionRadius,
      })
    : { pillars, supportStructures: [] };

  return {
    pillars: branchResult.pillars,
    supportStructures: branchResult.supportStructures,
    settings: buildSettings({
      basePanEnabled,
      baseBracingEnabled,
      basePanMargin,
      basePanThickness,
      basePanLipWidth,
      basePanLipHeight,
      sphericalConnection,
      sphereConnectionDiameter,
      crossBracing,
      routeContext: ctx,
      bracingCollisionRadius: routeOpts.supportCollisionRadius,
      supportFloorY,
    }),
    modelBounds,
  };
}

interface SettingsInput {
  basePanEnabled: boolean;
  baseBracingEnabled: boolean;
  basePanMargin: number;
  basePanThickness: number;
  basePanLipWidth: number;
  basePanLipHeight: number;
  sphericalConnection: boolean;
  sphereConnectionDiameter: number;
  crossBracing: boolean;
  routeContext: RouteContext | undefined;
  bracingCollisionRadius: number;
  supportFloorY?: number;
}

function buildSettings(input: SettingsInput): PillarSetSettings {
  return {
    crossBracing: input.crossBracing,
    baseBracing: input.baseBracingEnabled
      ? {
          radius: 0.8,
          maxDistance: 28,
          height: 0.15,
        }
      : null,
    basePan: input.basePanEnabled
      ? {
          margin: input.basePanMargin,
          thickness: input.basePanThickness,
          lipWidth: input.basePanLipWidth,
          lipHeight: input.basePanLipHeight,
        }
      : null,
    sphericalConnection: input.sphericalConnection
      ? { radius: input.sphereConnectionDiameter / 2 }
      : null,
    supportFloorY:
      input.supportFloorY ?? (input.basePanEnabled ? input.basePanThickness + 0.01 : 0),
    routeContext: input.routeContext,
    bracingCollisionRadius: input.bracingCollisionRadius,
  };
}

// ---------------------------------------------------------------------------
// Route planning
// ---------------------------------------------------------------------------

function planSupportRoute(
  point: ContactPoint,
  context: RouteContext,
  _pillarRadius: number,
  baseHeight: number,
  tipHeight: number,
  options: RouteOptions,
): RouteWaypoint[] | null {
  const contactPos = point.position;
  const clearance = options.modelClearance;
  const maxAngleRad = THREE.MathUtils.degToRad(options.maxPillarAngle);
  const maxHorizontalPerVertical = Math.tan(maxAngleRad);

  const raycaster = context.raycaster;
  raycaster.set(new THREE.Vector3(contactPos.x, contactPos.y - 0.01, contactPos.z), DOWN);
  raycaster.far = contactPos.y;
  const hits = raycaster.intersectObject(context.mesh);
  const validHits = hits.filter((h) => h.point.y < contactPos.y - 0.5);

  if (validHits.length === 0) {
    if (options.approachMode === 'prefer-angled') {
      const preferredAngle = preferredRouteAngle(point, context);
      const angled = findAngledRoute(
        contactPos,
        context,
        baseHeight,
        tipHeight,
        clearance,
        maxHorizontalPerVertical,
        options.maxContactOffset,
        null,
        preferredAngle,
        options.supportCollisionRadius,
        options.supportTipRadius,
      );
      if (angled) return angled;
    }
    const route: RouteWaypoint[] = [
      { x: contactPos.x, y: contactPos.y, z: contactPos.z },
      { x: contactPos.x, y: baseHeight, z: contactPos.z },
    ];
    if (
      !routeCollides(
        route,
        context,
        tipHeight,
        baseHeight,
        options.supportCollisionRadius,
        options.supportTipRadius,
      )
    ) {
      return route;
    }
    // Vertical route collides — try bridge as last resort.
    if (options.allowBridgeSupports) {
      return findBridgeRoute(contactPos, context, _pillarRadius, tipHeight, baseHeight, options);
    }
    return null;
  }

  if (options.approachMode === 'vertical') {
    if (!options.allowInternalSupports) return null;
    return [
      { x: contactPos.x, y: contactPos.y, z: contactPos.z },
      { x: contactPos.x, y: validHits[0].point.y, z: contactPos.z, internalResting: true },
    ];
  }

  const obstruction = validHits[0];
  const obstructionNormal = obstruction.face?.normal
    ? obstruction.face.normal.clone().normalize()
    : (point.normal?.clone().normalize() ?? new THREE.Vector3(1, 0, 0));

  const escapeDir = new THREE.Vector3(obstructionNormal.x, 0, obstructionNormal.z);
  if (escapeDir.length() < 0.01) {
    const radial = new THREE.Vector3(
      contactPos.x - context.modelCenter.x,
      0,
      contactPos.z - context.modelCenter.z,
    );
    escapeDir.copy(radial.lengthSq() > 0.01 ? radial : new THREE.Vector3(1, 0, 0));
  }
  escapeDir.normalize();

  const tipBottom = contactPos.y - tipHeight;
  const angleStartY = Math.min(tipBottom - 0.1, obstruction.point.y + clearance * 2);
  const verticalDrop = tipBottom - angleStartY;
  const maxOffsetForSlope = Math.max(0, verticalDrop * maxHorizontalPerVertical);
  const maxUsableOffset = Math.min(options.maxContactOffset, maxOffsetForSlope);

  if (maxUsableOffset >= clearance * 1.5) {
    const preferredAngle = Math.atan2(escapeDir.z, escapeDir.x);
    const route = findAngledRoute(
      contactPos,
      context,
      baseHeight,
      tipHeight,
      clearance,
      maxHorizontalPerVertical,
      maxUsableOffset,
      angleStartY,
      preferredAngle,
      options.supportCollisionRadius,
      options.supportTipRadius,
    );
    if (route) return route;
  }

  if (options.allowInternalSupports) {
    return [
      { x: contactPos.x, y: contactPos.y, z: contactPos.z },
      { x: contactPos.x, y: obstruction.point.y, z: contactPos.z, internalResting: true },
    ];
  }
  // All standard routes failed — try bridge as last resort.
  if (options.allowBridgeSupports) {
    return findBridgeRoute(contactPos, context, _pillarRadius, tipHeight, baseHeight, options);
  }
  return null;
}

function preferredRouteAngle(point: ContactPoint, context: RouteContext): number | null {
  const normal = point.normal?.clone().normalize();
  if (normal) {
    normal.y = 0;
    if (normal.lengthSq() > 0.01) {
      normal.normalize();
      return Math.atan2(normal.z, normal.x);
    }
  }
  const radial = new THREE.Vector3(
    point.position.x - context.modelCenter.x,
    0,
    point.position.z - context.modelCenter.z,
  );
  if (radial.lengthSq() > 0.01) {
    radial.normalize();
    return Math.atan2(radial.z, radial.x);
  }
  return null;
}

function findAngledRoute(
  contactPos: THREE.Vector3,
  context: RouteContext,
  baseHeight: number,
  tipHeight: number,
  clearance: number,
  maxHorizontalPerVertical: number,
  maxContactOffset: number,
  forcedAngleStartY: number | null,
  preferredAngle: number | null,
  collisionRadius: number,
  tipRadius: number,
): RouteWaypoint[] | null {
  const tipBottomY = contactPos.y - tipHeight;
  const angleStartY =
    forcedAngleStartY ?? Math.max(baseHeight + clearance, tipBottomY - clearance * 3);
  const verticalDrop = tipBottomY - angleStartY;
  if (verticalDrop <= 0.1) return null;
  const maxOffset = Math.min(maxContactOffset, verticalDrop * maxHorizontalPerVertical);
  if (maxOffset < clearance) return null;

  const distances = uniqueSortedNumbers(
    [clearance * 1.5, clearance * 2.5, clearance * 4, maxOffset].filter((d) => d <= maxOffset),
  );
  const targetOffset = Math.min(maxOffset, Math.max(clearance * 2.5, 6));
  const candidates: { route: RouteWaypoint[]; score: number }[] = [];

  for (const dist of distances) {
    for (let i = 0; i < ROUTE_DIRECTIONS; i++) {
      const angle =
        preferredAngle === null
          ? (i / ROUTE_DIRECTIONS) * Math.PI * 2
          : preferredAngle + directionOffset(i);
      const shaftX = contactPos.x + Math.cos(angle) * dist;
      const shaftZ = contactPos.z + Math.sin(angle) * dist;
      const route: RouteWaypoint[] = [
        { x: contactPos.x, y: contactPos.y, z: contactPos.z },
        { x: shaftX, y: angleStartY, z: shaftZ },
        { x: shaftX, y: baseHeight, z: shaftZ },
      ];
      if (!routeCollides(route, context, tipHeight, baseHeight, collisionRadius, tipRadius)) {
        const preferencePenalty =
          preferredAngle === null ? 0 : Math.abs(normalizedAngleDelta(angle, preferredAngle));
        candidates.push({
          route,
          score: Math.abs(dist - targetOffset) + preferencePenalty * clearance,
        });
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.route ?? null;
}
