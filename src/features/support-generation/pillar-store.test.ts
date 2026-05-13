import { describe, it, expect, beforeEach } from 'vitest';
import {
  _resetPillarStoreForTests,
  buildPillarFromRoute,
  replaceAutoPillars,
  addManualPillarRecord,
  removePillar,
  findPillarNear,
  rebuildSupportsMesh,
  getPillarSet,
  type Pillar,
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
});
