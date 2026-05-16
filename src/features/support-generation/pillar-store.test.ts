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

function makePillar(
  origin: 'auto' | 'manual',
  contact: { x: number; y: number; z: number },
): Pillar {
  return buildPillarFromRoute(
    [contact, { x: contact.x, y: 0, z: contact.z }],
    { tipDiameter: 0.4, pillarRadius: 0.4, baseRadius: 0.8, tipHeight: 0.5, baseHeight: 0.5 },
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
    const geo = rebuildSupportsMesh('m1');
    expect(geo.attributes.position?.count ?? 0).toBe(0);
  });

  it('vertex count grows with each pillar added', () => {
    const p1 = makePillar('auto', { x: 0, y: 5, z: 0 });
    const p2 = makePillar('auto', { x: 5, y: 5, z: 0 });
    addManualPillarRecord('m1', p1);
    const count1 = rebuildSupportsMesh('m1').attributes.position.count;
    addManualPillarRecord('m1', p2);
    const count2 = rebuildSupportsMesh('m1').attributes.position.count;
    expect(count2).toBeGreaterThan(count1);
  });

  it('builds geometry for graph-only experimental support structures', () => {
    addSupportStructureRecord('m1', makeBranchingStructure());
    const geo = rebuildSupportsMesh('m1');
    expect(geo.attributes.position.count).toBeGreaterThan(0);
  });

  it('omits disabled touchpoint branches from graph geometry', () => {
    const structure = makeBranchingStructure();
    addSupportStructureRecord('m1', structure);
    const fullCount = rebuildSupportsMesh('m1').attributes.position.count;

    updateSupportStructureTouchpoint('m1', 's1', 'n_tip_1', { enabled: false });
    const reducedCount = rebuildSupportsMesh('m1').attributes.position.count;

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

    const geo = rebuildSupportsMesh(
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
