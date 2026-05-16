import {
  createBaseBraceGeometry,
  createBasePanGeometry,
  estimateBaseBraceVolume,
  type RouteWaypoint,
} from '../../supports-geometry';
import { computeMeshVolume } from '../../volume';
import type { Pillar, PillarSetSettings, SupportStructure } from './pillar-store';

export function addSupportFoundationGeometry(
  geometries: Parameters<typeof createBaseBraceGeometry>[1],
  pillars: Pillar[],
  supportStructures: SupportStructure[],
  settings: PillarSetSettings,
  routesFromStructure: (structure: SupportStructure) => RouteWaypoint[][],
  modelBounds?: Parameters<typeof createBasePanGeometry>[0],
): void {
  const routes = collectFoundationRoutes(pillars, supportStructures, routesFromStructure);

  if (settings.basePan && modelBounds) {
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

  if (settings.baseBracing) {
    const braceRadius = Math.max(
      settings.baseBracing.radius,
      maxFoundationRadius(pillars, supportStructures),
    );
    createBaseBraceGeometry(
      routes,
      geometries,
      braceRadius,
      settings.baseBracing.maxDistance,
      settings.supportFloorY,
      settings.baseBracing.height,
    );
  }
}

export function estimateSupportFoundationVolume(
  pillars: Pillar[],
  supportStructures: SupportStructure[],
  settings: PillarSetSettings,
  routesFromStructure: (structure: SupportStructure) => RouteWaypoint[][],
  modelBounds?: Parameters<typeof createBasePanGeometry>[0],
): number {
  const routes = collectFoundationRoutes(pillars, supportStructures, routesFromStructure);
  let volume = 0;
  if (settings.basePan && modelBounds) {
    const panGeometry = createBasePanGeometry(
      modelBounds,
      routes,
      settings.basePan.margin,
      settings.basePan.thickness,
      settings.basePan.lipWidth,
      settings.basePan.lipHeight,
    );
    volume += computeMeshVolume(panGeometry);
  }
  if (settings.baseBracing) {
    const routeData = collectFoundationRouteData(pillars, supportStructures, routesFromStructure);
    const braceRadius = Math.max(
      settings.baseBracing.radius,
      maxFoundationRadius(pillars, supportStructures),
    );
    volume += estimateBaseBraceVolume(
      routeData.routes,
      braceRadius,
      settings.baseBracing.maxDistance,
      routeData.endpointRadii,
      settings.baseBracing.height,
    );
  }
  return volume;
}

export function collectFoundationRoutes(
  pillars: Pillar[],
  supportStructures: SupportStructure[],
  routesFromStructure: (structure: SupportStructure) => RouteWaypoint[][],
): RouteWaypoint[][] {
  return [
    ...pillars.map((pillar) => pillar.route),
    ...supportStructures.flatMap((structure) => routesFromStructure(structure)),
  ];
}

function collectFoundationRouteData(
  pillars: Pillar[],
  supportStructures: SupportStructure[],
  routesFromStructure: (structure: SupportStructure) => RouteWaypoint[][],
): { routes: RouteWaypoint[][]; endpointRadii: number[] } {
  const routes: RouteWaypoint[][] = [];
  const endpointRadii: number[] = [];
  for (const pillar of pillars) {
    routes.push(pillar.route);
    endpointRadii.push(pillar.baseRadius);
  }
  for (const structure of supportStructures) {
    for (const route of routesFromStructure(structure)) {
      routes.push(route);
      endpointRadii.push(baseRadiusForStructureRoute(structure, route));
    }
  }
  return { routes, endpointRadii };
}

function baseRadiusForStructureRoute(structure: SupportStructure, route: RouteWaypoint[]): number {
  const base = route[route.length - 1];
  if (!base || base.internalResting) return 0;
  const node = structure.nodes.find(
    (candidate) =>
      candidate.kind === 'base' &&
      Math.hypot(
        candidate.position.x - base.x,
        candidate.position.y - base.y,
        candidate.position.z - base.z,
      ) < 1e-4,
  );
  return node?.radius ?? 0;
}

function maxFoundationRadius(pillars: Pillar[], supportStructures: SupportStructure[]): number {
  const maxPillarBase = pillars.reduce((max, pillar) => Math.max(max, pillar.baseRadius), 0);
  const maxStructureBase = supportStructures.reduce((max, structure) => {
    const baseRadius = structure.nodes.reduce(
      (nodeMax, node) => (node.kind === 'base' ? Math.max(nodeMax, node.radius) : nodeMax),
      0,
    );
    return Math.max(max, baseRadius);
  }, 0);
  const maxRadius = Math.max(maxPillarBase, maxStructureBase);
  return Number.isFinite(maxRadius) ? maxRadius : 0;
}
