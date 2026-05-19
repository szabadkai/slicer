import { computeMeshVolume } from '../../volume';
import type { RouteWaypoint } from '../../supports-geometry';
import { estimateSupportFoundationVolume } from './support-foundation';
import { getPillarSet, rebuildSupportsMesh, type SupportStructure } from './pillar-store';

export function estimateSupportVolume(
  modelId: string,
  modelBounds?: Parameters<typeof rebuildSupportsMesh>[1],
): number | null {
  const set = getPillarSet(modelId);
  if (set.legacyOpaque) return null;
  const supportStructures = set.supportStructures ?? [];
  const result = rebuildSupportsMesh(modelId, modelBounds, { includeFoundation: false });
  const bodyVolume = computeMeshVolume(result.supports);
  result.supports.dispose();
  let bracingVolume = 0;
  if (result.bracing) {
    bracingVolume = computeMeshVolume(result.bracing);
    result.bracing.dispose();
  }
  return (
    bodyVolume +
    bracingVolume +
    estimateSupportFoundationVolume(
      set.pillars,
      supportStructures,
      set.settings,
      routesFromStructure,
      modelBounds,
    )
  );
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

function activeSupportGraph(structure: SupportStructure): SupportStructure | null {
  const disabledTipIds = new Set(
    structure.nodes
      .filter((node) => node.kind === 'tip')
      .filter((node) => findTouchpointForTipNode(structure, node.id)?.enabled === false)
      .map((node) => node.id),
  );
  const nodes = structure.nodes.filter((node) => !disabledTipIds.has(node.id));
  if (!nodes.some((node) => node.kind === 'tip')) return null;
  const edges = structure.edges.filter(
    (edge) => !disabledTipIds.has(edge.from) && !disabledTipIds.has(edge.to),
  );
  return { ...structure, nodes, edges };
}

function findTouchpointForTipNode(structure: SupportStructure, nodeId: string) {
  return structure.touchpoints.find((touchpoint) => touchpoint.nodeId === nodeId);
}
