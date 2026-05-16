/**
 * Experimental branching support clustering.
 */

/* eslint-disable no-restricted-imports */
import * as THREE from 'three';
import type { Pillar, SupportStructure } from './features/support-generation/pillar-store';
import { segmentCollides, type RouteContext } from './supports-geometry';

interface BranchClusterOptions {
  clusterRadius: number;
  maxTips: number;
  supportFloorY: number;
  routeContext?: RouteContext;
  collisionRadius?: number;
}

export function clusterPillarsIntoBranchStructures(
  pillars: Pillar[],
  options: BranchClusterOptions,
): { pillars: Pillar[]; supportStructures: SupportStructure[] } {
  const clusterRadius = Math.max(options.clusterRadius, 1);
  const maxTips = Math.max(Math.floor(options.maxTips), 2);
  const candidates = pillars.filter((pillar) => !pillar.bridgeTarget && pillar.contact.y > 1);
  const used = new Set<string>();
  const structures: SupportStructure[] = [];

  const sorted = [...candidates].sort(
    (a, b) => b.contact.y - a.contact.y || a.contact.x - b.contact.x || a.contact.z - b.contact.z,
  );

  for (const seed of sorted) {
    if (used.has(seed.id)) continue;
    const neighbors = candidates
      .filter((candidate) => !used.has(candidate.id) && candidate.id !== seed.id)
      .map((candidate) => ({
        pillar: candidate,
        dist: Math.hypot(
          candidate.contact.x - seed.contact.x,
          candidate.contact.z - seed.contact.z,
        ),
        yDelta: Math.abs(candidate.contact.y - seed.contact.y),
      }))
      .filter((item) => item.dist <= clusterRadius && item.yDelta <= clusterRadius)
      .sort((a, b) => a.dist - b.dist || a.yDelta - b.yDelta)
      .slice(0, maxTips - 1)
      .map((item) => item.pillar);

    const cluster = [seed, ...neighbors];
    if (cluster.length < 2) continue;
    const structure = buildBranchStructureFromPillars(
      cluster,
      structures.length,
      options.supportFloorY,
    );
    if (!isBranchStructureCollisionFree(structure, options)) continue;
    cluster.forEach((pillar) => used.add(pillar.id));
    structures.push(structure);
  }

  return {
    pillars: pillars.filter((pillar) => !used.has(pillar.id)),
    supportStructures: structures,
  };
}

function isBranchStructureCollisionFree(
  structure: SupportStructure,
  options: BranchClusterOptions,
): boolean {
  if (!options.routeContext) return true;
  const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
  for (const edge of structure.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) return false;
    const rawFromVec = new THREE.Vector3(from.position.x, from.position.y, from.position.z);
    const rawToVec = new THREE.Vector3(to.position.x, to.position.y, to.position.z);
    const dir = new THREE.Vector3().subVectors(rawToVec, rawFromVec);
    const length = dir.length();
    if (length < 0.1) continue;
    dir.normalize();
    let fromVec = rawFromVec;
    let toVec = rawToVec;
    if (from.kind === 'tip') {
      fromVec = rawFromVec
        .clone()
        .addScaledVector(dir, Math.min(length * 0.4, from.radius * 2 + 0.5));
    }
    if (to.kind === 'tip') {
      toVec = rawToVec.clone().addScaledVector(dir, -Math.min(length * 0.4, to.radius * 2 + 0.5));
    }
    if (fromVec.distanceToSquared(toVec) < 0.01) continue;
    const radius = Math.max(edge.radius, options.collisionRadius ?? edge.radius);
    if (segmentCollides(fromVec, toVec, options.routeContext, radius)) return false;
  }
  return true;
}

function buildBranchStructureFromPillars(
  pillars: Pillar[],
  index: number,
  supportFloorY: number,
): SupportStructure {
  const id = `auto_branch_${Date.now().toString(36)}_${index.toString(36)}`;
  const avg = pillars.reduce(
    (sum, pillar) => {
      sum.x += pillar.contact.x;
      sum.y += pillar.contact.y;
      sum.z += pillar.contact.z;
      return sum;
    },
    { x: 0, y: 0, z: 0 },
  );
  avg.x /= pillars.length;
  avg.y /= pillars.length;
  avg.z /= pillars.length;
  const minY = Math.min(...pillars.map((pillar) => pillar.contact.y));
  const avgRadius =
    pillars.reduce((sum, pillar) => sum + pillar.pillarRadius, 0) / Math.max(pillars.length, 1);
  const avgTipRadius =
    pillars.reduce((sum, pillar) => sum + pillar.tipDiameter / 2, 0) / Math.max(pillars.length, 1);
  const branchDrop = Math.max(avgRadius * 6, 3);
  const branchY = Math.max(supportFloorY + avgRadius * 2, minY - branchDrop);
  const trunkRadius = Math.max(avgRadius, avgTipRadius) * Math.sqrt(pillars.length) * 0.75;
  const branchNodeId = `${id}_junction`;
  const baseNodeId = `${id}_base`;

  return {
    id,
    origin: 'auto',
    kind: 'branching',
    touchpoints: pillars.map((pillar, tipIndex) => ({
      id: `${id}_touch_${tipIndex}`,
      nodeId: `${id}_tip_${tipIndex}`,
      position: { ...pillar.contact },
      normal: { x: 0, y: -1, z: 0 },
      diameter: pillar.tipDiameter,
      shape: 'ball',
      priority: 'normal',
      enabled: true,
    })),
    nodes: [
      ...pillars.map((pillar, tipIndex) => ({
        id: `${id}_tip_${tipIndex}`,
        position: { ...pillar.contact },
        radius: Math.max(pillar.tipDiameter / 2, 0.05),
        kind: 'tip' as const,
      })),
      {
        id: branchNodeId,
        position: { x: avg.x, y: branchY, z: avg.z },
        radius: Math.max(trunkRadius * 0.9, avgRadius),
        kind: 'branch',
      },
      {
        id: baseNodeId,
        position: { x: avg.x, y: supportFloorY, z: avg.z },
        radius: Math.max(trunkRadius * 1.8, avgRadius * 2.5),
        kind: 'base',
      },
    ],
    edges: [
      ...pillars.map((pillar, tipIndex) => ({
        from: `${id}_tip_${tipIndex}`,
        to: branchNodeId,
        radius: Math.max(pillar.pillarRadius * 0.7, pillar.tipDiameter / 2),
      })),
      {
        from: branchNodeId,
        to: baseNodeId,
        radius: Math.max(trunkRadius, avgRadius),
      },
    ],
  };
}
