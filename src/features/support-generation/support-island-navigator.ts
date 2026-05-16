import { detectOverhangs } from './detect';
import type { OverhangParams } from './detect';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SupportIsland {
  id: string;
  triangleCount: number;
  center: Vec3;
  min: Vec3;
  max: Vec3;
  resolved: boolean;
}

interface CandidateTriangle {
  tri: number;
  center: Vec3;
}

export interface DetectSupportIslandsOptions {
  coverageRadius?: number;
  clusterDistance?: number;
  overhangParams?: Partial<OverhangParams>;
  resolvedIds?: Set<string>;
}

export function detectSupportIslands(
  positions: Float32Array,
  triangleCount: number,
  supportContacts: Vec3[],
  options: DetectSupportIslandsOptions = {},
): SupportIsland[] {
  const coverageRadius = options.coverageRadius ?? 3;
  const clusterDistance = options.clusterDistance ?? 8;
  const coverageRadiusSq = coverageRadius * coverageRadius;
  const { overhangTriangles } = detectOverhangs(positions, triangleCount, options.overhangParams);
  const candidates: CandidateTriangle[] = [];

  for (const tri of overhangTriangles) {
    const center = triangleCenter(positions, tri);
    if (isCovered(center, supportContacts, coverageRadiusSq)) continue;
    candidates.push({ tri, center });
  }

  if (candidates.length === 0) return [];

  const clusterDistanceSq = clusterDistance * clusterDistance;
  const visited = new Uint8Array(candidates.length);
  const islands: SupportIsland[] = [];

  for (let i = 0; i < candidates.length; i++) {
    if (visited[i]) continue;
    const queue = [i];
    visited[i] = 1;
    const members: CandidateTriangle[] = [];

    while (queue.length > 0) {
      const current = queue.pop() as number;
      const item = candidates[current];
      members.push(item);

      for (let j = 0; j < candidates.length; j++) {
        if (visited[j]) continue;
        if (distanceSq(item.center, candidates[j].center) > clusterDistanceSq) continue;
        visited[j] = 1;
        queue.push(j);
      }
    }

    islands.push(buildIsland(members, positions, options.resolvedIds));
  }

  return islands.sort((a, b) => b.triangleCount - a.triangleCount);
}

function triangleCenter(positions: Float32Array, tri: number): Vec3 {
  const base = tri * 9;
  return {
    x: (positions[base] + positions[base + 3] + positions[base + 6]) / 3,
    y: (positions[base + 1] + positions[base + 4] + positions[base + 7]) / 3,
    z: (positions[base + 2] + positions[base + 5] + positions[base + 8]) / 3,
  };
}

function isCovered(point: Vec3, contacts: Vec3[], coverageRadiusSq: number): boolean {
  for (const contact of contacts) {
    if (distanceSq(point, contact) <= coverageRadiusSq) return true;
  }
  return false;
}

function distanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function buildIsland(
  members: CandidateTriangle[],
  positions: Float32Array,
  resolvedIds?: Set<string>,
): SupportIsland {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const center = { x: 0, y: 0, z: 0 };

  for (const member of members) {
    center.x += member.center.x;
    center.y += member.center.y;
    center.z += member.center.z;
    expandBounds(positions, member.tri, min, max);
  }

  center.x /= members.length;
  center.y /= members.length;
  center.z /= members.length;
  const id = `${Math.round(center.x * 10)}:${Math.round(center.y * 10)}:${Math.round(center.z * 10)}:${members.length}`;

  return {
    id,
    triangleCount: members.length,
    center,
    min,
    max,
    resolved: resolvedIds?.has(id) ?? false,
  };
}

function expandBounds(positions: Float32Array, tri: number, min: Vec3, max: Vec3): void {
  const base = tri * 9;
  for (let i = 0; i < 3; i++) {
    const offset = base + i * 3;
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    min.x = Math.min(min.x, x);
    min.y = Math.min(min.y, y);
    min.z = Math.min(min.z, z);
    max.x = Math.max(max.x, x);
    max.y = Math.max(max.y, y);
    max.z = Math.max(max.z, z);
  }
}
