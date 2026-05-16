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
import {
  buildSupportGraphGeometry,
  type SupportGraphNode,
  type SupportGraphEdge,
} from '../../supports-graph-geometry';

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

export interface SupportTouchpoint {
  id: string;
  nodeId?: string;
  position: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  diameter: number;
  shape: 'point' | 'ball' | 'cone' | 'pad';
  priority: 'light' | 'normal' | 'heavy';
  enabled: boolean;
}

export interface SupportStructure {
  id: string;
  origin: 'auto' | 'manual' | 'paint';
  kind: 'pillar' | 'branching' | 'bridge';
  touchpoints: SupportTouchpoint[];
  nodes: SupportGraphNode[];
  edges: SupportGraphEdge[];
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
  supportStructures?: SupportStructure[];
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

export function replaceAutoSupportStructures(
  modelId: string,
  autoStructures: SupportStructure[],
): void {
  const set = getPillarSet(modelId);
  const userStructures = (set.supportStructures ?? []).filter((s) => s.origin !== 'auto');
  set.supportStructures = [...autoStructures, ...userStructures];
  set.legacyOpaque = false;
}

export function addSupportStructureRecord(modelId: string, structure: SupportStructure): void {
  const set = getPillarSet(modelId);
  set.supportStructures = [...(set.supportStructures ?? []), structure];
  set.legacyOpaque = false;
}

export function removeSupportStructure(modelId: string, structureId: string): boolean {
  const set = pillarSets.get(modelId);
  if (!set?.supportStructures) return false;
  const before = set.supportStructures.length;
  set.supportStructures = set.supportStructures.filter((s) => s.id !== structureId);
  return set.supportStructures.length !== before;
}

export interface SupportStructureRadiusUpdate {
  tipRadius?: number;
  branchRadius?: number;
  trunkRadius?: number;
  baseRadius?: number;
}

export interface SupportTouchpointUpdate {
  diameter?: number;
  shape?: SupportTouchpoint['shape'];
  priority?: SupportTouchpoint['priority'];
  enabled?: boolean;
}

export function updateSupportStructureRadii(
  modelId: string,
  structureId: string,
  update: SupportStructureRadiusUpdate,
): boolean {
  const structure = getSupportStructure(modelId, structureId);
  if (!structure) return false;
  if (update.tipRadius !== undefined) {
    const radius = Math.max(update.tipRadius, 0.05);
    for (const node of structure.nodes) {
      if (node.kind === 'tip') node.radius = radius;
    }
    for (const touchpoint of structure.touchpoints) touchpoint.diameter = radius * 2;
  }
  if (update.branchRadius !== undefined) {
    const radius = Math.max(update.branchRadius, 0.05);
    for (const node of structure.nodes) {
      if (node.kind === 'branch') node.radius = radius;
    }
    for (const edge of structure.edges) {
      const from = structure.nodes.find((node) => node.id === edge.from);
      const to = structure.nodes.find((node) => node.id === edge.to);
      if (from?.kind === 'tip' || to?.kind === 'tip') edge.radius = radius;
    }
  }
  if (update.trunkRadius !== undefined) {
    const radius = Math.max(update.trunkRadius, 0.05);
    for (const node of structure.nodes) {
      if (node.kind === 'trunk') node.radius = radius;
    }
    for (const edge of structure.edges) {
      const from = structure.nodes.find((node) => node.id === edge.from);
      const to = structure.nodes.find((node) => node.id === edge.to);
      if (from?.kind === 'branch' && to?.kind === 'base') edge.radius = radius;
      if (from?.kind === 'base' && to?.kind === 'branch') edge.radius = radius;
    }
  }
  if (update.baseRadius !== undefined) {
    const radius = Math.max(update.baseRadius, 0.05);
    for (const node of structure.nodes) {
      if (node.kind === 'base') node.radius = radius;
    }
  }
  return true;
}

export function updateSupportStructureNodeRadius(
  modelId: string,
  structureId: string,
  nodeId: string,
  radiusMM: number,
): boolean {
  const structure = getSupportStructure(modelId, structureId);
  if (!structure) return false;
  const node = structure.nodes.find((n) => n.id === nodeId);
  if (!node) return false;
  const radius = Math.max(radiusMM, 0.05);
  node.radius = radius;

  if (node.kind === 'tip') {
    const touchpoint = findTouchpointForTipNode(structure, node);
    if (touchpoint) touchpoint.diameter = radius * 2;
  }

  return true;
}

export function updateSupportStructureTouchpoint(
  modelId: string,
  structureId: string,
  nodeId: string,
  update: SupportTouchpointUpdate,
): boolean {
  const structure = getSupportStructure(modelId, structureId);
  if (!structure) return false;
  const node = structure.nodes.find((n) => n.id === nodeId && n.kind === 'tip');
  if (!node) return false;
  const touchpoint = findTouchpointForTipNode(structure, node);
  if (!touchpoint) return false;
  touchpoint.nodeId = node.id;
  if (update.diameter !== undefined) {
    const diameter = Math.max(update.diameter, 0.1);
    touchpoint.diameter = diameter;
    node.radius = diameter / 2;
  }
  if (update.shape !== undefined) touchpoint.shape = update.shape;
  if (update.priority !== undefined) touchpoint.priority = update.priority;
  if (update.enabled !== undefined) touchpoint.enabled = update.enabled;
  return true;
}

export function updateSupportStructureNodePosition(
  modelId: string,
  structureId: string,
  nodeId: string,
  position: Partial<{ x: number; y: number; z: number }>,
): boolean {
  const structure = getSupportStructure(modelId, structureId);
  if (!structure) return false;
  const node = structure.nodes.find((n) => n.id === nodeId);
  if (!node) return false;
  const previousPosition = { ...node.position };
  if (position.x !== undefined) node.position.x = position.x;
  if (position.y !== undefined) node.position.y = position.y;
  if (position.z !== undefined) node.position.z = position.z;

  if (node.kind === 'tip') {
    const touchpoint = findTouchpointByPosition(structure, previousPosition);
    if (touchpoint) {
      touchpoint.nodeId = node.id;
      touchpoint.position = { ...node.position };
    }
  }
  return true;
}

function findTouchpointForTipNode(
  structure: SupportStructure,
  node: SupportGraphNode,
): SupportTouchpoint | undefined {
  return (
    structure.touchpoints.find((touchpoint) => touchpoint.nodeId === node.id) ??
    findTouchpointByPosition(structure, node.position)
  );
}

function findTouchpointByPosition(
  structure: SupportStructure,
  position: { x: number; y: number; z: number },
): SupportTouchpoint | undefined {
  return structure.touchpoints.find((touchpoint) =>
    pointsAlmostEqual(touchpoint.position, position),
  );
}

function pointsAlmostEqual(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): boolean {
  return Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.z - b.z) < 1e-4;
}

export function getSupportStructure(modelId: string, structureId: string): SupportStructure | null {
  const set = pillarSets.get(modelId);
  return set?.supportStructures?.find((structure) => structure.id === structureId) ?? null;
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

export function findSupportStructureNear(
  modelId: string,
  worldPos: { x: number; y: number; z: number },
  maxDistMM: number,
): SupportStructure | null {
  const set = pillarSets.get(modelId);
  const structures = set?.supportStructures ?? [];
  if (structures.length === 0) return null;
  let bestDist2 = maxDistMM * maxDistMM;
  let best: SupportStructure | null = null;
  for (const structure of structures) {
    const d2 = squaredDistanceToStructure(structure, worldPos);
    if (d2 < bestDist2) {
      bestDist2 = d2;
      best = structure;
    }
  }
  return best;
}

function squaredDistanceToStructure(
  structure: SupportStructure,
  q: { x: number; y: number; z: number },
): number {
  let best = Infinity;
  for (const node of structure.nodes) {
    const dx = q.x - node.position.x;
    const dy = q.y - node.position.y;
    const dz = q.z - node.position.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) best = d2;
  }

  const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
  for (const edge of structure.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    const d2 = squaredDistanceToSegment(from.position, to.position, q);
    if (d2 < best) best = d2;
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
  const supportStructures = set.supportStructures ?? [];
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

  for (const structure of supportStructures) {
    const activeGraph = activeSupportGraph(structure);
    if (activeGraph) buildSupportGraphGeometry(activeGraph.nodes, activeGraph.edges, geometries);
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
    const routes = [
      ...pillars.map((p) => p.route),
      ...supportStructures.flatMap((structure) => routesFromStructure(structure)),
    ];
    geometries.push(
      createBasePanGeometry(
        modelBounds,
        routes,
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

function routesFromStructure(structure: SupportStructure): RouteWaypoint[][] {
  const activeGraph = activeSupportGraph(structure);
  if (!activeGraph) return [];
  const nodeById = new Map(activeGraph.nodes.map((node) => [node.id, node]));
  return activeGraph.edges.flatMap((edge) => {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) return [];
    return [[{ ...from.position }, { ...to.position, internalResting: to.kind !== 'base' }]];
  });
}

function activeSupportGraph(
  structure: SupportStructure,
): { nodes: SupportGraphNode[]; edges: SupportGraphEdge[] } | null {
  const disabledTipIds = new Set(
    structure.nodes
      .filter((node) => node.kind === 'tip')
      .filter((node) => findTouchpointForTipNode(structure, node)?.enabled === false)
      .map((node) => node.id),
  );
  const nodes = structure.nodes.filter((node) => !disabledTipIds.has(node.id));
  if (!nodes.some((node) => node.kind === 'tip')) return null;
  const edges = structure.edges.filter(
    (edge) => !disabledTipIds.has(edge.from) && !disabledTipIds.has(edge.to),
  );
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Test-only — reset the singleton store
// ---------------------------------------------------------------------------

export function _resetPillarStoreForTests(): void {
  pillarSets.clear();
  nextId = 0;
}
