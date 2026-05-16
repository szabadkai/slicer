import { describe, expect, it } from 'vitest';
/* eslint-disable no-restricted-imports */
import * as THREE from 'three';
import { clusterPillarsIntoBranchStructures } from './supports-branching';
import type { Pillar } from './features/support-generation/pillar-store';
import type { RouteContext } from './supports-geometry';

function makePillar(id: string, x: number, y: number, z: number): Pillar {
  return {
    id,
    origin: 'auto',
    route: [
      { x, y, z },
      { x, y: 0, z },
    ],
    tipDiameter: 0.4,
    pillarRadius: 0.4,
    baseRadius: 0.8,
    tipHeight: 0.6,
    baseHeight: 0.5,
    contact: { x, y, z },
  };
}

function makeYZQuadAtX(atX: number, y0: number, y1: number, z0: number, z1: number): THREE.Mesh {
  const positions = new Float32Array([
    atX,
    y0,
    z0,
    atX,
    y1,
    z0,
    atX,
    y1,
    z1,
    atX,
    y0,
    z0,
    atX,
    y1,
    z1,
    atX,
    y0,
    z1,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  return mesh;
}

function makeRouteContext(mesh: THREE.Mesh): RouteContext {
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = false;
  const modelBounds = new THREE.Box3().setFromObject(mesh);
  const modelCenter = new THREE.Vector3();
  modelBounds.getCenter(modelCenter);
  return { mesh, raycaster, modelBounds, modelCenter };
}

describe('clusterPillarsIntoBranchStructures', () => {
  it('clusters nearby pillars into an auto branching structure', () => {
    const result = clusterPillarsIntoBranchStructures(
      [makePillar('p1', 0, 8, 0), makePillar('p2', 3, 8, 0), makePillar('p3', 20, 8, 0)],
      { clusterRadius: 6, maxTips: 5, supportFloorY: 0 },
    );

    expect(result.supportStructures).toHaveLength(1);
    expect(result.supportStructures[0].origin).toBe('auto');
    expect(result.supportStructures[0].touchpoints).toHaveLength(2);
    expect(result.pillars.map((pillar) => pillar.id)).toEqual(['p3']);
  });

  it('respects max tips per branch cluster', () => {
    const result = clusterPillarsIntoBranchStructures(
      [
        makePillar('p1', 0, 8, 0),
        makePillar('p2', 1, 8, 0),
        makePillar('p3', 2, 8, 0),
        makePillar('p4', 3, 8, 0),
      ],
      { clusterRadius: 8, maxTips: 3, supportFloorY: 0 },
    );

    expect(result.supportStructures).toHaveLength(1);
    expect(result.supportStructures[0].touchpoints).toHaveLength(3);
    expect(result.pillars).toHaveLength(1);
  });

  it('keeps bridge pillars as linear pillars', () => {
    const bridge = {
      ...makePillar('bridge', 1, 8, 0),
      bridgeTarget: { x: 1, y: 2, z: 0 },
    };
    const result = clusterPillarsIntoBranchStructures([makePillar('p1', 0, 8, 0), bridge], {
      clusterRadius: 6,
      maxTips: 5,
      supportFloorY: 0,
    });

    expect(result.supportStructures).toHaveLength(0);
    expect(result.pillars.map((pillar) => pillar.id)).toEqual(['p1', 'bridge']);
  });

  it('falls back to linear pillars when a branch edge collides with the model', () => {
    const obstacle = makeYZQuadAtX(0.75, 6, 7, -1, 1);
    const result = clusterPillarsIntoBranchStructures(
      [makePillar('p1', 0, 8, 0), makePillar('p2', 3, 8, 0)],
      {
        clusterRadius: 6,
        maxTips: 5,
        supportFloorY: 0,
        routeContext: makeRouteContext(obstacle),
        collisionRadius: 0.2,
      },
    );

    expect(result.supportStructures).toHaveLength(0);
    expect(result.pillars.map((pillar) => pillar.id)).toEqual(['p1', 'p2']);
  });

  it('does not reject a branch only because the edge starts on the supported surface', () => {
    const nearContactSurface = makeYZQuadAtX(0.1, 7.7, 8.1, -1, 1);
    const result = clusterPillarsIntoBranchStructures(
      [makePillar('p1', 0, 8, 0), makePillar('p2', 3, 8, 0)],
      {
        clusterRadius: 6,
        maxTips: 5,
        supportFloorY: 0,
        routeContext: makeRouteContext(nearContactSurface),
        collisionRadius: 0.2,
      },
    );

    expect(result.supportStructures).toHaveLength(1);
    expect(result.pillars).toHaveLength(0);
  });
});
