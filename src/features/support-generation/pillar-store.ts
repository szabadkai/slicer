/**
 * Pillar store — the source of truth for support pillars per model.
 *
 * The visible `supportsMesh` on each SceneObject is a derived view: it is
 * (re)built from the Pillar[] in this store every time the user adds,
 * removes, or regenerates supports.
 *
 * Auto-generated and manually-placed pillars are tagged with `origin` and
 * coexist freely. Aggregate features (cross-bracing, base pan, spherical
 * connection) re-run over the **union** of all pillars on rebuild — so
 * the user's settings apply uniformly regardless of origin.
 */

import * as THREE from 'three';
import {
  buildSupportGeometry,
  generateCrossBracing,
  createBasePanGeometry,
  mergeGeometries,
  type RouteWaypoint,
  type RouteContext,
} from '../../supports-geometry';

export interface Pillar {
  id: string;
  origin: 'auto' | 'manual';
  route: RouteWaypoint[];
  tipDiameter: number;
  pillarRadius: number;
  baseRadius: number;
  tipHeight: number;
  baseHeight: number;
  // Contact point in plate-local coordinates (matches route[0]).
  // Retained explicitly so findPillarNear works after the route is
  // rewritten by a future re-route pass.
  contact: { x: number; y: number; z: number };
  // When set, this pillar bridges to a model surface instead of the
  // build plate.  The last waypoint will have internalResting: true
  // and its coordinates match this field.
  bridgeTarget?: { x: number; y: number; z: number };
}

export interface BasePanSettings {
  margin: number;
  thickness: number;
  lipWidth: number;
  lipHeight: number;
}

export interface PillarSetSettings {
  crossBracing: boolean;
  basePan: BasePanSettings | null;
  sphericalConnection: { radius: number } | null;
  supportFloorY: number;
  // The route context (mesh + raycaster) used at last auto-gen, retained
  // so cross-bracing rebuilds without forcing the user to re-run auto-gen.
  // Null when the only pillars are manual or the legacy fallback applies.
  routeContext?: RouteContext;
  // Default support collision radius for cross-bracing segment tests.
  bracingCollisionRadius: number;
}

export interface ModelPillarSet {
  pillars: Pillar[];
  settings: PillarSetSettings;
  // True for legacy projects: the mesh was loaded from a pre-rework save
  // and we have no per-pillar data. The mesh stays opaque until the user
  // takes the next action (manual-add or auto-regen) that triggers a
  // rebuild — at which point legacyOpaque drops and per-pillar editing
  // becomes available.
  legacyOpaque?: boolean;
}

const DEFAULT_SETTINGS: PillarSetSettings = {
  crossBracing: false,
  basePan: null,
  sphericalConnection: null,
  supportFloorY: 0,
  bracingCollisionRadius: 0.5,
};

const pillarSets = new Map<string, ModelPillarSet>();

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function getPillarSet(modelId: string): ModelPillarSet {
  let set = pillarSets.get(modelId);
  if (!set) {
    set = { pillars: [], settings: { ...DEFAULT_SETTINGS } };
    pillarSets.set(modelId, set);
  }
  return set;
}

export function hasPillarSet(modelId: string): boolean {
  return pillarSets.has(modelId);
}

export function setPillarSet(modelId: string, set: ModelPillarSet): void {
  pillarSets.set(modelId, set);
}

export function clearPillarSet(modelId: string): void {
  pillarSets.delete(modelId);
}

export function markLegacyOpaque(modelId: string): void {
  const set = getPillarSet(modelId);
  set.legacyOpaque = true;
}

// ---------------------------------------------------------------------------
// Mutators
// ---------------------------------------------------------------------------

let nextId = 0;
function genId(): string {
  nextId += 1;
  return `p_${Date.now().toString(36)}_${nextId.toString(36)}`;
}

export function buildPillarFromRoute(
  route: RouteWaypoint[],
  opts: Omit<Pillar, 'id' | 'route' | 'contact' | 'origin'>,
  origin: 'auto' | 'manual',
): Pillar {
  const top = route[0];
  return {
    id: genId(),
    origin,
    route,
    tipDiameter: opts.tipDiameter,
    pillarRadius: opts.pillarRadius,
    baseRadius: opts.baseRadius,
    tipHeight: opts.tipHeight,
    baseHeight: opts.baseHeight,
    contact: { x: top.x, y: top.y, z: top.z },
  };
}

export function replaceAutoPillars(modelId: string, autoPillars: Pillar[]): void {
  const set = getPillarSet(modelId);
  const manual = set.pillars.filter((p) => p.origin === 'manual');
  set.pillars = [...autoPillars, ...manual];
  set.legacyOpaque = false;
}

export function addManualPillarRecord(modelId: string, pillar: Pillar): void {
  const set = getPillarSet(modelId);
  set.pillars.push(pillar);
  set.legacyOpaque = false;
}

export function removePillar(modelId: string, pillarId: string): boolean {
  const set = pillarSets.get(modelId);
  if (!set) return false;
  const before = set.pillars.length;
  set.pillars = set.pillars.filter((p) => p.id !== pillarId);
  return set.pillars.length !== before;
}

export function updatePillarSettings(modelId: string, partial: Partial<PillarSetSettings>): void {
  const set = getPillarSet(modelId);
  set.settings = { ...set.settings, ...partial };
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

export function findPillarNear(
  modelId: string,
  worldPos: { x: number; y: number; z: number },
  maxDistMM: number,
): Pillar | null {
  const set = pillarSets.get(modelId);
  if (!set || set.pillars.length === 0) return null;
  let bestDist2 = maxDistMM * maxDistMM;
  let best: Pillar | null = null;
  for (const p of set.pillars) {
    const d2 = squaredDistanceToRoute(p.route, worldPos);
    if (d2 < bestDist2) {
      bestDist2 = d2;
      best = p;
    }
  }
  return best;
}

function squaredDistanceToRoute(
  route: RouteWaypoint[],
  q: { x: number; y: number; z: number },
): number {
  let best = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const d2 = squaredDistanceToSegment(route[i], route[i + 1], q);
    if (d2 < best) best = d2;
  }
  return best;
}

function squaredDistanceToSegment(
  a: RouteWaypoint,
  b: RouteWaypoint,
  q: { x: number; y: number; z: number },
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const aqx = q.x - a.x;
  const aqy = q.y - a.y;
  const aqz = q.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  if (len2 < 1e-9) {
    return aqx * aqx + aqy * aqy + aqz * aqz;
  }
  let t = (aqx * abx + aqy * aby + aqz * abz) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const px = a.x + abx * t;
  const py = a.y + aby * t;
  const pz = a.z + abz * t;
  const dx = q.x - px;
  const dy = q.y - py;
  const dz = q.z - pz;
  return dx * dx + dy * dy + dz * dz;
}

// ---------------------------------------------------------------------------
// Geometry rebuild — the single source of truth
// ---------------------------------------------------------------------------

export function rebuildSupportsMesh(
  modelId: string,
  modelBounds?: THREE.Box3,
): THREE.BufferGeometry {
  const set = pillarSets.get(modelId);
  if (!set) return new THREE.BufferGeometry();

  const geometries: THREE.BufferGeometry[] = [];
  const { settings, pillars } = set;
  const sphereRadius = settings.sphericalConnection?.radius ?? 0;
  const floorY = settings.supportFloorY;

  for (const p of pillars) {
    buildSupportGeometry(
      p.route,
      geometries,
      p.tipDiameter,
      p.tipHeight,
      p.pillarRadius,
      p.baseRadius,
      p.baseHeight,
      floorY,
      sphereRadius,
    );
  }

  if (settings.crossBracing && pillars.length >= 2 && settings.routeContext) {
    // Bracing uses the smallest pillar radius among the set as a safe
    // conservative value — bigger pillars accept thinner braces fine.
    const minRadius = pillars.reduce((m, p) => Math.min(m, p.pillarRadius), Infinity);
    const minTipHeight = pillars.reduce((m, p) => Math.min(m, p.tipHeight), Infinity);
    const minBaseHeight = pillars.reduce((m, p) => Math.min(m, p.baseHeight), Infinity);
    generateCrossBracing(
      pillars.map((p) => p.route),
      geometries,
      Number.isFinite(minRadius) ? minRadius : 0.4,
      Number.isFinite(minBaseHeight) ? minBaseHeight : 0.6,
      Number.isFinite(minTipHeight) ? minTipHeight : 1.2,
      settings.routeContext,
      settings.bracingCollisionRadius,
      floorY,
    );
  }

  if (settings.basePan && modelBounds) {
    geometries.push(
      createBasePanGeometry(
        modelBounds,
        pillars.map((p) => p.route),
        settings.basePan.margin,
        settings.basePan.thickness,
        settings.basePan.lipWidth,
        settings.basePan.lipHeight,
      ),
    );
  }

  if (geometries.length === 0) return new THREE.BufferGeometry();
  return mergeGeometries(geometries);
}

// ---------------------------------------------------------------------------
// Test-only — reset the singleton store
// ---------------------------------------------------------------------------

export function _resetPillarStoreForTests(): void {
  pillarSets.clear();
  nextId = 0;
}
