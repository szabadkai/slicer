/**
 * Support generation — route planning, overhang detection, and orchestration.
 *
 * Geometry building, collision checks, cross-bracing, and base-pan creation
 * live in supports-geometry.ts.
 */

import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import {
  type RouteWaypoint,
  type ContactPoint,
  type RouteContext,
  type RouteOptions,
  routeCollides,
  buildSupportGeometry,
  generateCrossBracing,
  createBasePanGeometry,
  mergeGeometries,
} from './supports-geometry';
import {
  ROUTE_DIRECTIONS,
  halton,
  deduplicatePoints,
  uniqueSortedNumbers,
  directionOffset,
  normalizedAngleDelta,
  yieldThread,
} from './supports-utils';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type { RouteWaypoint, ContactPoint, RouteContext, RouteOptions };

export { planSupportRoute };

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const EXTERIOR_RAY_DIRECTIONS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

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
  basePanEnabled?: boolean;
  basePanMargin?: number;
  basePanThickness?: number;
  basePanLipWidth?: number;
  basePanLipHeight?: number;
  onProgress?: (fraction: number, text: string) => void;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function generateSupports(
  geometry: THREE.BufferGeometry,
  options: SupportOptions = {},
): Promise<THREE.BufferGeometry> {
  const {
    overhangAngle = 30,
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
    basePanEnabled = false,
    basePanMargin = 4,
    basePanThickness = 0.8,
    basePanLipWidth = 1.2,
    basePanLipHeight = 1,
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

  if (onProgress) onProgress(0, 'Finding contact points...');
  await yieldThread();
  const contactPoints = await findContactPoints(
    geometry,
    overhangAngle,
    effectiveDensity,
    (text) => {
      if (onProgress) onProgress(0, text);
    },
  );

  if (contactPoints.length === 0) {
    if (!basePanEnabled) return new THREE.BufferGeometry();
    return createBasePanGeometry(
      modelBounds,
      [],
      basePanMargin,
      basePanThickness,
      basePanLipWidth,
      basePanLipHeight,
    );
  }

  if (onProgress) {
    onProgress(0.1, 'Building bounds tree...');
    await yieldThread();
  }
  if (!(geometry as unknown as { boundsTree: unknown }).boundsTree) geometry.computeBoundsTree();
  const tempMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
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
  const baseRadius = pillarRadius * 2.5;
  const baseHeight = 0.6;
  const minSupportHeight = tipHeight + baseHeight + 0.5;

  const routeOpts: RouteOptions = {
    allowInternalSupports: supportScope === 'all',
    allowCavityContacts: supportScope === 'all',
    approachMode,
    maxPillarAngle,
    modelClearance: Math.max(modelClearance, pillarRadius * 1.5),
    supportCollisionRadius: Math.max(pillarRadius * 1.1, 0.2),
    maxContactOffset,
  };
  const ctx: RouteContext = { mesh: tempMesh, raycaster, modelBounds, modelCenter };

  let supportPoints = contactPoints;
  if (!routeOpts.allowCavityContacts) {
    if (onProgress) {
      onProgress(0.08, 'Filtering interior contact points...');
      await yieldThread();
    }
    supportPoints = contactPoints.filter((p) =>
      isExteriorContact(p, ctx, routeOpts.modelClearance),
    );
  }

  const geometries: THREE.BufferGeometry[] = [];
  const routes: RouteWaypoint[][] = [];

  for (let i = 0; i < supportPoints.length; i++) {
    const { position } = supportPoints[i];
    if (position.y > minSupportHeight) {
      const route = planSupportRoute(
        supportPoints[i],
        ctx,
        pillarRadius,
        baseHeight,
        tipHeight,
        routeOpts,
      );
      if (route) routes.push(route);
    }
    if (i % 200 === 0 && onProgress) {
      onProgress(
        0.1 + 0.6 * (i / supportPoints.length),
        `Planning routes... ${Math.round((i / supportPoints.length) * 100)}%`,
      );
      await yieldThread();
    }
  }

  const supportFloorY = basePanEnabled ? basePanThickness + 0.01 : 0;
  if (onProgress) onProgress(0.7, 'Building geometry...');
  for (let i = 0; i < routes.length; i++) {
    buildSupportGeometry(
      routes[i],
      geometries,
      actualTipDiameter,
      tipHeight,
      pillarRadius,
      baseRadius,
      baseHeight,
      supportFloorY,
    );
    if (i % 500 === 0 && onProgress) {
      onProgress(
        0.7 + 0.2 * (i / routes.length),
        `Building geometry... ${Math.round((i / routes.length) * 100)}%`,
      );
      await yieldThread();
    }
  }

  if (crossBracing) {
    if (onProgress) {
      onProgress(0.9, 'Generating cross bracing...');
      await yieldThread();
    }
    generateCrossBracing(
      routes,
      geometries,
      pillarRadius,
      baseHeight,
      tipHeight,
      ctx,
      routeOpts.supportCollisionRadius,
      supportFloorY,
    );
  }

  if (basePanEnabled) {
    geometries.push(
      createBasePanGeometry(
        modelBounds,
        routes,
        basePanMargin,
        basePanThickness,
        basePanLipWidth,
        basePanLipHeight,
      ),
    );
  }

  if (onProgress) {
    onProgress(0.95, 'Merging geometry...');
    await yieldThread();
  }
  if (geometries.length === 0) return new THREE.BufferGeometry();
  return mergeGeometries(geometries);
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
      );
      if (angled) return angled;
    }
    const route: RouteWaypoint[] = [
      { x: contactPos.x, y: contactPos.y, z: contactPos.z },
      { x: contactPos.x, y: baseHeight, z: contactPos.z },
    ];
    return routeCollides(route, context, tipHeight, baseHeight, options.supportCollisionRadius)
      ? null
      : route;
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
    );
    if (route) return route;
  }

  if (options.allowInternalSupports) {
    return [
      { x: contactPos.x, y: contactPos.y, z: contactPos.z },
      { x: contactPos.x, y: obstruction.point.y, z: contactPos.z, internalResting: true },
    ];
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
      if (!routeCollides(route, context, tipHeight, baseHeight, collisionRadius)) {
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

// ---------------------------------------------------------------------------
// Exterior detection
// ---------------------------------------------------------------------------

function isExteriorContact(point: ContactPoint, context: RouteContext, clearance: number): boolean {
  const normal = point.normal?.clone().normalize() ?? DOWN.clone();
  if (!isOutwardFacingSurface(point.position, normal, context.modelCenter)) return false;
  const start = point.position.clone().addScaledVector(normal, Math.max(0.05, clearance * 0.1));
  return [normal, ...EXTERIOR_RAY_DIRECTIONS].some((dir) => rayEscapesModel(start, dir, context));
}

function isOutwardFacingSurface(
  position: THREE.Vector3,
  normal: THREE.Vector3,
  modelCenter: THREE.Vector3,
): boolean {
  const radial = new THREE.Vector3().subVectors(position, modelCenter);
  if (radial.lengthSq() < 1e-6) return true;
  radial.normalize();
  return normal.dot(radial) > -0.1;
}

function rayEscapesModel(
  start: THREE.Vector3,
  direction: THREE.Vector3,
  context: RouteContext,
): boolean {
  const dir = direction.clone().normalize();
  if (dir.lengthSq() === 0) return false;
  const far = rayDistancePastBounds(start, dir, context.modelBounds);
  if (far <= 0) return true;
  context.raycaster.set(start, dir);
  context.raycaster.far = far;
  return context.raycaster.intersectObject(context.mesh).every((hit) => hit.distance < 0.05);
}

function rayDistancePastBounds(
  start: THREE.Vector3,
  direction: THREE.Vector3,
  bounds: THREE.Box3,
): number {
  const expanded = bounds.clone().expandByScalar(1);
  const boxHit = new THREE.Vector3();
  const ray = new THREE.Ray(start, direction);
  if (!ray.intersectBox(expanded, boxHit)) return 0;
  return start.distanceTo(boxHit) + 1;
}

// ---------------------------------------------------------------------------
// Contact point detection
// ---------------------------------------------------------------------------

async function findContactPoints(
  geometry: THREE.BufferGeometry,
  overhangAngleDeg: number,
  density: number,
  onProgress: (text: string) => void,
): Promise<ContactPoint[]> {
  const pos = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const overhangThreshold = Math.cos(THREE.MathUtils.degToRad(90 - overhangAngleDeg));
  const spacing = 12 - density;
  const points: ContactPoint[] = [];

  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const n = new THREE.Vector3(),
    edge1 = new THREE.Vector3(),
    edge2 = new THREE.Vector3(),
    cross = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    if (i % 50000 === 0 && i !== 0) {
      onProgress(`Finding contact points... ${Math.round((i / triCount) * 100)}%`);
      await yieldThread();
    }

    const [idxA, idxB, idxC] = index
      ? [index.getX(i * 3), index.getX(i * 3 + 1), index.getX(i * 3 + 2)]
      : [i * 3, i * 3 + 1, i * 3 + 2];

    a.set(pos.getX(idxA), pos.getY(idxA), pos.getZ(idxA));
    b.set(pos.getX(idxB), pos.getY(idxB), pos.getZ(idxB));
    c.set(pos.getX(idxC), pos.getY(idxC), pos.getZ(idxC));
    edge1.subVectors(b, a);
    edge2.subVectors(c, a);
    cross.crossVectors(edge1, edge2);
    n.copy(cross).normalize();

    if (
      normals &&
      n.dot(new THREE.Vector3(normals.getX(idxA), normals.getY(idxA), normals.getZ(idxA))) < 0
    ) {
      n.multiplyScalar(-1);
      cross.multiplyScalar(-1);
    }
    if (n.dot(UP) >= -overhangThreshold) continue;

    const area = cross.length() * 0.5;
    const numSamples = Math.max(1, Math.round(area / (spacing * spacing)));
    for (let s = 0; s < numSamples; s++) {
      let u: number, v: number;
      if (numSamples === 1) {
        u = 1 / 3;
        v = 1 / 3;
      } else {
        u = halton(i * 31 + s + 1, 2);
        v = halton(i * 31 + s + 1, 3);
      }
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      const w = 1 - u - v;
      points.push({
        position: new THREE.Vector3(
          a.x * u + b.x * v + c.x * w,
          a.y * u + b.y * v + c.y * w,
          a.z * u + b.z * v + c.z * w,
        ),
        normal: n.clone(),
      });
    }
  }
  return deduplicatePoints(points, spacing * 0.5);
}
