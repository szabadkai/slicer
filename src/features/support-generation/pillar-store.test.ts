import { describe, it, expect, beforeEach } from 'vitest';
/* eslint-disable no-restricted-imports */
import * as THREE from 'three';
import {
  _resetPillarStoreForTests,
  buildPillarFromRoute,
  replaceAutoPillars,
  replaceAutoSupportStructures,
  addManualPillarRecord,
  removePillar,
  addSupportStructureRecord,
  removeSupportStructure,
  findPillarNear,
  findSupportStructureNear,
  updateSupportStructureNodePosition,
  updateSupportStructureNodeRadius,
  updateSupportStructureRadii,
  updateSupportStructureTouchpoint,
  rebuildSupportsMesh,
  getPillarSet,
  updatePillarSettings,
  type Pillar,
  type SupportStructure,
} from './pillar-store';
import { addSupportFoundationGeometry } from './support-foundation';
import { estimateSupportVolume } from './support-volume-estimate';
import { computeMeshVolume } from '../../volume';
import { estimateBaseBraceVolume } from '../../supports-geometry';

function makePillar(
  origin: 'auto' | 'manual',
  contact: { x: number; y: number; z: number },
  overrides: Partial<Pick<Pillar, 'baseRadius'>> = {},
): Pillar {
  return buildPillarFromRoute(
    [contact, { x: contact.x, y: 0, z: contact.z }],
    {
      tipDiameter: 0.4,
      pillarRadius: 0.4,
      baseRadius: overrides.baseRadius ?? 0.8,
      tipHeight: 0.5,
      baseHeight: 0.5,
    },
    origin,
  );
}

function makeBranchingStructure(id = 's1'): SupportStructure {
  return {
    id,
    origin: 'manual',
    kind: 'branching',
    touchpoints: [
      {
        id: 't1',
        nodeId: 'n_tip_1',
        position: { x: -1, y: 6, z: 0 },
        normal: { x: 0, y: -1, z: 0 },
        diameter: 0.4,
        shape: 'ball',
        priority: 'normal',
        enabled: true,
      },
      {
        id: 't2',
        nodeId: 'n_tip_2',
        position: { x: 1, y: 6, z: 0 },
        normal: { x: 0, y: -1, z: 0 },
        diameter: 0.4,
        shape: 'ball',
        priority: 'normal',
        enabled: true,
      },
    ],
    nodes: [
      { id: 'n_tip_1', position: { x: -1, y: 6, z: 0 }, radius: 0.2, kind: 'tip' },
      { id: 'n_tip_2', position: { x: 1, y: 6, z: 0 }, radius: 0.2, kind: 'tip' },
      { id: 'n_branch', position: { x: 0, y: 4, z: 0 }, radius: 0.35, kind: 'branch' },
      { id: 'n_base', position: { x: 0, y: 0, z: 0 }, radius: 0.8, kind: 'base' },
    ],
    edges: [
      { from: 'n_tip_1', to: 'n_branch', radius: 0.22 },
      { from: 'n_tip_2', to: 'n_branch', radius: 0.22 },
      { from: 'n_branch', to: 'n_base', radius: 0.35 },
    ],
  };
}

function offsetStructure(structure: SupportStructure, dx: number, dz = 0): SupportStructure {
  return {
    ...structure,
    touchpoints: structure.touchpoints.map((touchpoint) => ({
      ...touchpoint,
      position: {
        ...touchpoint.position,
        x: touchpoint.position.x + dx,
        z: touchpoint.position.z + dz,
      },
    })),
    nodes: structure.nodes.map((node) => ({
      ...node,
      position: {
        ...node.position,
        x: node.position.x + dx,
        z: node.position.z + dz,
      },
    })),
  };
}

function tallStructure(id: string): SupportStructure {
  const structure = makeBranchingStructure(id);
  return {
    ...structure,
    touchpoints: structure.touchpoints.map((touchpoint) => ({
      ...touchpoint,
      position: { ...touchpoint.position, y: 10 },
    })),
    nodes: structure.nodes.map((node) =>
      node.kind === 'tip'
        ? { ...node, position: { ...node.position, y: 10 } }
        : node.kind === 'branch'
          ? { ...node, position: { ...node.position, y: 8 } }
          : node,
    ),
  };
}

function makeCollisionFreeRouteContext() {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  mesh.position.set(1000, 1000, 1000);
  mesh.updateMatrixWorld();
  return {
    mesh,
    raycaster: new THREE.Raycaster(),
    modelBounds: new THREE.Box3(
      new THREE.Vector3(999, 999, 999),
      new THREE.Vector3(1001, 1001, 1001),
    ),
    modelCenter: new THREE.Vector3(1000, 1000, 1000),
  };
}

beforeEach(() => {
  _resetPillarStoreForTests();
});

describe('replaceAutoPillars', () => {
  it('replaces auto pillars and keeps manual ones', () => {
    const manual = makePillar('manual', { x: 1, y: 5, z: 0 });
    addManualPillarRecord('m1', manual);

    const auto1 = makePillar('auto', { x: 0, y: 5, z: 0 });
    const auto2 = makePillar('auto', { x: 2, y: 5, z: 0 });
    replaceAutoPillars('m1', [auto1, auto2]);

    const { pillars } = getPillarSet('m1');
    expect(pillars.filter((p) => p.origin === 'manual')).toHaveLength(1);
    expect(pillars.filter((p) => p.origin === 'auto')).toHaveLength(2);
    expect(pillars.find((p) => p.id === manual.id)).toBeDefined();
  });

  it('works when there are no existing manual pillars', () => {
    const auto = makePillar('auto', { x: 0, y: 5, z: 0 });
    replaceAutoPillars('m1', [auto]);
    expect(getPillarSet('m1').pillars).toHaveLength(1);
  });

  it('keeps experimental support structures when replacing auto pillars', () => {
    addSupportStructureRecord('m1', makeBranchingStructure());
    replaceAutoPillars('m1', [makePillar('auto', { x: 0, y: 5, z: 0 })]);
    expect(getPillarSet('m1').supportStructures).toHaveLength(1);
  });
});

describe('removePillar', () => {
  it('removes a pillar by id', () => {
    const p = makePillar('auto', { x: 0, y: 5, z: 0 });
    addManualPillarRecord('m1', p);
    const removed = removePillar('m1', p.id);
    expect(removed).toBe(true);
    expect(getPillarSet('m1').pillars).toHaveLength(0);
  });

  it('returns false for unknown pillar id', () => {
    addManualPillarRecord('m1', makePillar('auto', { x: 0, y: 5, z: 0 }));
    expect(removePillar('m1', 'nonexistent')).toBe(false);
  });

  it('returns false for unknown model id', () => {
    expect(removePillar('no-such-model', 'any-id')).toBe(false);
  });
});

describe('support structures', () => {
  it('adds and removes an experimental support structure', () => {
    addSupportStructureRecord('m1', makeBranchingStructure());
    expect(getPillarSet('m1').supportStructures).toHaveLength(1);

    expect(removeSupportStructure('m1', 's1')).toBe(true);
    expect(getPillarSet('m1').supportStructures).toHaveLength(0);
  });

  it('returns false when removing an unknown support structure', () => {
    addSupportStructureRecord('m1', makeBranchingStructure());
    expect(removeSupportStructure('m1', 'missing')).toBe(false);
    expect(removeSupportStructure('unknown', 's1')).toBe(false);
  });

  it('replaces auto structures and keeps manual or paint structures', () => {
    const manual = makeBranchingStructure('manual-structure');
    const paint = { ...makeBranchingStructure('paint-structure'), origin: 'paint' as const };
    const oldAuto = { ...makeBranchingStructure('old-auto'), origin: 'auto' as const };
    const newAuto = { ...makeBranchingStructure('new-auto'), origin: 'auto' as const };
    addSupportStructureRecord('m1', manual);
    addSupportStructureRecord('m1', paint);
    addSupportStructureRecord('m1', oldAuto);

    replaceAutoSupportStructures('m1', [newAuto]);

    const structures = getPillarSet('m1').supportStructures ?? [];
    expect(structures.map((s) => s.id).sort()).toEqual([
      'manual-structure',
      'new-auto',
      'paint-structure',
    ]);
  });

  it('finds the nearest support structure by edge distance', () => {
    addSupportStructureRecord('m1', makeBranchingStructure());
    const hit = findSupportStructureNear('m1', { x: 0, y: 3, z: 0.1 }, 2);
    expect(hit?.id).toBe('s1');
    expect(findSupportStructureNear('m1', { x: 40, y: 3, z: 0 }, 2)).toBeNull();
  });

  it('updates graph support radii for gizmo slider edits', () => {
    addSupportStructureRecord('m1', makeBranchingStructure());
    expect(
      updateSupportStructureRadii('m1', 's1', {
        tipRadius: 0.3,
        branchRadius: 0.5,
        trunkRadius: 0.7,
        baseRadius: 1.2,
      }),
    ).toBe(true);

    const structure = getPillarSet('m1').supportStructures![0];
    expect(
      structure.nodes.filter((node) => node.kind === 'tip').every((n) => n.radius === 0.3),
    ).toBe(true);
    expect(structure.nodes.find((node) => node.kind === 'branch')?.radius).toBe(0.5);
    expect(structure.nodes.find((node) => node.kind === 'base')?.radius).toBe(1.2);
    expect(
      structure.edges.find((edge) => edge.from === 'n_branch' && edge.to === 'n_base')?.radius,
    ).toBe(0.7);
    expect(structure.touchpoints.every((touchpoint) => touchpoint.diameter === 0.6)).toBe(true);
  });

  it('updates one selected graph node radius for handle-specific gizmo edits', () => {
    addSupportStructureRecord('m1', makeBranchingStructure());

    expect(updateSupportStructureNodeRadius('m1', 's1', 'n_tip_1', 0.45)).toBe(true);

    const structure = getPillarSet('m1').supportStructures![0];
    expect(structure.nodes.find((node) => node.id === 'n_tip_1')?.radius).toBe(0.45);
    expect(structure.nodes.find((node) => node.id === 'n_tip_2')?.radius).toBe(0.2);
    expect(structure.touchpoints.find((touchpoint) => touchpoint.id === 't1')?.diameter).toBe(0.9);
    expect(structure.touchpoints.find((touchpoint) => touchpoint.id === 't2')?.diameter).toBe(0.4);
  });

  it('updates one selected graph node position for movable handle edits', () => {
    addSupportStructureRecord('m1', makeBranchingStructure());

    expect(updateSupportStructureNodePosition('m1', 's1', 'n_branch', { y: 3.25 })).toBe(true);

    const structure = getPillarSet('m1').supportStructures![0];
    expect(structure.nodes.find((node) => node.id === 'n_branch')?.position.y).toBe(3.25);
    expect(structure.nodes.find((node) => node.id === 'n_base')?.position.y).toBe(0);
  });

  it('updates selected touchpoint metadata and diameter', () => {
    addSupportStructureRecord('m1', makeBranchingStructure());

    expect(
      updateSupportStructureTouchpoint('m1', 's1', 'n_tip_1', {
        diameter: 0.7,
        shape: 'pad',
        priority: 'heavy',
        enabled: false,
      }),
    ).toBe(true);

    const structure = getPillarSet('m1').supportStructures![0];
    const touchpoint = structure.touchpoints.find((point) => point.id === 't1');
    expect(touchpoint).toMatchObject({
      diameter: 0.7,
      shape: 'pad',
      priority: 'heavy',
      enabled: false,
    });
    expect(structure.nodes.find((node) => node.id === 'n_tip_1')?.radius).toBe(0.35);
    expect(structure.touchpoints.find((point) => point.id === 't2')?.enabled).toBe(true);
  });
});

describe('findPillarNear', () => {
  it('returns the closest pillar within maxDist', () => {
    const close = makePillar('auto', { x: 1, y: 5, z: 0 });
    const far = makePillar('auto', { x: 100, y: 5, z: 0 });
    addManualPillarRecord('m1', close);
    addManualPillarRecord('m1', far);

    const hit = findPillarNear('m1', { x: 1, y: 3, z: 0 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.id).toBe(close.id);
  });

  it('returns null when nothing is within maxDist', () => {
    addManualPillarRecord('m1', makePillar('auto', { x: 100, y: 5, z: 0 }));
    expect(findPillarNear('m1', { x: 0, y: 0, z: 0 }, 5)).toBeNull();
  });

  it('returns null for unknown model', () => {
    expect(findPillarNear('unknown', { x: 0, y: 0, z: 0 }, 100)).toBeNull();
  });
});

describe('rebuildSupportsMesh', () => {
  it('returns empty geometry with no pillars', () => {
    const { supports: geo } = rebuildSupportsMesh('m1');
    expect(geo.attributes.position?.count ?? 0).toBe(0);
  });

  it('vertex count grows with each pillar added', () => {
    const p1 = makePillar('auto', { x: 0, y: 5, z: 0 });
    const p2 = makePillar('auto', { x: 5, y: 5, z: 0 });
    addManualPillarRecord('m1', p1);
    const count1 = rebuildSupportsMesh('m1').supports.attributes.position.count;
    addManualPillarRecord('m1', p2);
    const count2 = rebuildSupportsMesh('m1').supports.attributes.position.count;
    expect(count2).toBeGreaterThan(count1);
  });

  it('builds geometry for graph-only experimental support structures', () => {
    addSupportStructureRecord('m1', makeBranchingStructure());
    const { supports: geo } = rebuildSupportsMesh('m1');
    expect(geo.attributes.position.count).toBeGreaterThan(0);
  });

  it('adds cross-bracing between branching support trunks', () => {
    addSupportStructureRecord('m1', tallStructure('s1'));
    addSupportStructureRecord('m1', offsetStructure(tallStructure('s2'), 2));
    updatePillarSettings('m1', {
      crossBracing: true,
      routeContext: makeCollisionFreeRouteContext(),
    });

    const { bracing } = rebuildSupportsMesh('m1');

    expect(bracing).not.toBeNull();
    expect(bracing!.attributes.position.count).toBeGreaterThan(0);
  });

  it('adds base bracing with a peelable outline between nearby support feet', () => {
    addManualPillarRecord('m1', makePillar('auto', { x: 0, y: 5, z: 0 }));
    addManualPillarRecord('m1', makePillar('auto', { x: 12, y: 5, z: 0 }));
    addManualPillarRecord('m1', makePillar('auto', { x: 6, y: 5, z: 8 }));
    const withoutBracing = rebuildSupportsMesh('m1').supports.attributes.position.count;

    updatePillarSettings('m1', {
      baseBracing: { radius: 0.8, maxDistance: 28 },
    });
    const withBracing = rebuildSupportsMesh('m1').supports.attributes.position.count;

    expect(withBracing).toBeGreaterThan(withoutBracing);
    expect(withBracing - withoutBracing).toBeGreaterThan(100);
  });

  it('keeps the base-bracing outline on pillar centers instead of adding an offset perimeter', () => {
    addManualPillarRecord('m1', makePillar('auto', { x: 0, y: 5, z: 0 }));
    addManualPillarRecord('m1', makePillar('auto', { x: 12, y: 5, z: 0 }));
    addManualPillarRecord('m1', makePillar('auto', { x: 6, y: 5, z: 8 }));
    updatePillarSettings('m1', {
      baseBracing: { radius: 0.8, maxDistance: 28 },
    });

    const { supports: geo } = rebuildSupportsMesh('m1');
    geo.computeBoundingBox();
    const box = geo.boundingBox!;

    expect(box.min.x).toBeGreaterThanOrEqual(-0.82);
    expect(box.max.x).toBeLessThanOrEqual(12.82);
    expect(box.min.z).toBeGreaterThanOrEqual(-0.82);
    expect(box.max.z).toBeLessThanOrEqual(8.82);
  });

  it('makes base bracing at least as thick as the thickest support base', () => {
    const pillars = [
      makePillar('auto', { x: 0, y: 5, z: 0 }, { baseRadius: 1.4 }),
      makePillar('auto', { x: 12, y: 5, z: 0 }, { baseRadius: 0.8 }),
      makePillar('auto', { x: 6, y: 5, z: 8 }, { baseRadius: 0.9 }),
    ];
    const geometries: THREE.BufferGeometry[] = [];

    addSupportFoundationGeometry(
      geometries,
      pillars,
      [],
      {
        crossBracing: false,
        baseBracing: { radius: 0.2, maxDistance: 28 },
        basePan: null,
        sphericalConnection: null,
        supportFloorY: 0,
        bracingCollisionRadius: 0.4,
      },
      () => [],
    );

    const firstBrace = geometries[0];
    firstBrace.computeBoundingBox();
    expect(firstBrace.boundingBox!.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(firstBrace.boundingBox!.max.y).toBeLessThanOrEqual(0.16);

    const braceStart = new THREE.Vector2(0, 0);
    const braceEnd = new THREE.Vector2(12, 0);
    const braceDelta = new THREE.Vector2().subVectors(braceEnd, braceStart);
    const braceLen2 = braceDelta.lengthSq();
    const position = firstBrace.attributes.position;
    let maxPlanarDistance = 0;
    for (let i = 0; i < position.count; i++) {
      const point = new THREE.Vector2(position.getX(i), position.getZ(i));
      const t = Math.min(1, Math.max(0, point.clone().sub(braceStart).dot(braceDelta) / braceLen2));
      const closest = braceStart.clone().addScaledVector(braceDelta, t);
      maxPlanarDistance = Math.max(maxPlanarDistance, closest.distanceTo(point));
    }

    expect(maxPlanarDistance).toBeGreaterThanOrEqual(1.39);
  });

  it('estimates brace volume only between support feet, not through their bases', () => {
    const routes = [
      [
        { x: 0, y: 5, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
      [
        { x: 12, y: 5, z: 0 },
        { x: 12, y: 0, z: 0 },
      ],
      [
        { x: 6, y: 5, z: 8 },
        { x: 6, y: 0, z: 8 },
      ],
    ];

    const centerToCenter = estimateBaseBraceVolume(routes, 1, 28);
    const betweenFeet = estimateBaseBraceVolume(routes, 1, 28, [1, 1, 1]);

    expect(betweenFeet).toBeLessThan(centerToCenter);
    expect(betweenFeet).toBeCloseTo(centerToCenter - 6 * 2 * 0.15, 5);
  });

  it('uses the corrected foundation estimate for support volume with base bracing', () => {
    addManualPillarRecord('m1', makePillar('auto', { x: 0, y: 5, z: 0 }, { baseRadius: 1 }));
    addManualPillarRecord('m1', makePillar('auto', { x: 12, y: 5, z: 0 }, { baseRadius: 1 }));
    addManualPillarRecord('m1', makePillar('auto', { x: 6, y: 5, z: 8 }, { baseRadius: 1 }));
    updatePillarSettings('m1', {
      baseBracing: { radius: 0.8, maxDistance: 28 },
    });

    const result = rebuildSupportsMesh('m1');
    const renderedVolume = computeMeshVolume(result.supports);
    const estimatedVolume = estimateSupportVolume('m1');

    expect(estimatedVolume).not.toBeNull();
    expect(estimatedVolume!).toBeLessThan(renderedVolume);
  });

  it('omits disabled touchpoint branches from graph geometry', () => {
    const structure = makeBranchingStructure();
    addSupportStructureRecord('m1', structure);
    const fullCount = rebuildSupportsMesh('m1').supports.attributes.position.count;

    updateSupportStructureTouchpoint('m1', 's1', 'n_tip_1', { enabled: false });
    const reducedCount = rebuildSupportsMesh('m1').supports.attributes.position.count;

    expect(reducedCount).toBeGreaterThan(0);
    expect(reducedCount).toBeLessThan(fullCount);
  });

  it('includes raised branch bases when building a base pan', () => {
    const structure = makeBranchingStructure();
    structure.nodes = structure.nodes.map((node) =>
      node.kind === 'base' ? { ...node, position: { ...node.position, y: 2 } } : node,
    );
    addSupportStructureRecord('m1', structure);
    updatePillarSettings('m1', {
      supportFloorY: 2,
      basePan: { margin: 4, thickness: 2, lipWidth: 1, lipHeight: 1 },
    });

    const { supports: geo } = rebuildSupportsMesh(
      'm1',
      new THREE.Box3(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 20, 100)),
    );

    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(box.min.x).toBeGreaterThan(-10);
    expect(box.max.x).toBeLessThan(10);
    expect(box.min.z).toBeGreaterThan(-10);
    expect(box.max.z).toBeLessThan(10);
  });
});
