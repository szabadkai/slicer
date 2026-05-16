import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { serializeObjects, restoreSerializedObjects } from './viewer-serialize';
import {
  getPillarSet,
  setPillarSet,
  _resetPillarStoreForTests,
} from './features/support-generation/pillar-store';
import type { SceneObject } from './viewer-core';

function makeMinimalObject(id: string): SceneObject {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  mesh.userData.id = id;
  return {
    id,
    mesh,
    supportsMesh: null,
    elevation: 0,
    materialPreset: {} as Record<string, unknown>,
  } as SceneObject;
}

function mockViewer(): unknown {
  return {
    scene: { add: () => {} },
    rebuildSupportsFromStore: () => {},
  };
}

describe('pillar serialization round-trip', () => {
  beforeEach(() => {
    _resetPillarStoreForTests();
  });

  it('preserves internalResting on route waypoints', () => {
    const modelId = 'test-model-1';
    setPillarSet(modelId, {
      pillars: [
        {
          id: 'p1',
          origin: 'auto',
          route: [
            { x: 1, y: 10, z: 2 },
            { x: 1, y: 5, z: 2 },
            { x: 1, y: 0, z: 2, internalResting: true },
          ],
          tipDiameter: 0.4,
          pillarRadius: 0.3,
          baseRadius: 0.6,
          tipHeight: 1.2,
          baseHeight: 0.6,
          contact: { x: 1, y: 10, z: 2 },
        },
      ],
      settings: {
        crossBracing: false,
        baseBracing: { radius: 0.8, maxDistance: 28 },
        basePan: null,
        sphericalConnection: null,
        supportFloorY: 0,
        bracingCollisionRadius: 0.2,
      },
    });

    const obj = makeMinimalObject(modelId);
    const serialized = serializeObjects(mockViewer() as never, [obj]);

    expect(serialized[0].pillarSet).toBeDefined();
    const sp = serialized[0].pillarSet!;
    expect(sp.settings.baseBracing).toEqual({ radius: 0.8, maxDistance: 28 });
    expect(sp.pillars[0].route[0].internalResting).toBeUndefined();
    expect(sp.pillars[0].route[1].internalResting).toBeUndefined();
    expect(sp.pillars[0].route[2].internalResting).toBe(true);

    _resetPillarStoreForTests();

    restoreSerializedObjects(mockViewer() as never, serialized);

    const restored = getPillarSet(modelId);
    expect(restored.settings.baseBracing).toEqual({ radius: 0.8, maxDistance: 28 });
    expect(restored.pillars).toHaveLength(1);
    const route = restored.pillars[0].route;
    expect(route[0].internalResting).toBeUndefined();
    expect(route[1].internalResting).toBeUndefined();
    expect(route[2].internalResting).toBe(true);
  });

  it('preserves bridgeTarget on pillars', () => {
    const modelId = 'test-model-2';
    const bridgePoint = { x: 3, y: 2, z: 5 };

    setPillarSet(modelId, {
      pillars: [
        {
          id: 'p2',
          origin: 'manual',
          route: [
            { x: 3, y: 10, z: 5 },
            { x: 3, y: 2, z: 5, internalResting: true },
          ],
          tipDiameter: 0.4,
          pillarRadius: 0.3,
          baseRadius: 0.6,
          tipHeight: 1.2,
          baseHeight: 0.6,
          contact: { x: 3, y: 10, z: 5 },
          bridgeTarget: bridgePoint,
        },
      ],
      settings: {
        crossBracing: false,
        baseBracing: null,
        basePan: null,
        sphericalConnection: null,
        supportFloorY: 0,
        bracingCollisionRadius: 0.2,
      },
    });

    const obj = makeMinimalObject(modelId);
    const serialized = serializeObjects(mockViewer() as never, [obj]);

    const sp = serialized[0].pillarSet!;
    expect(sp.pillars[0].bridgeTarget).toEqual(bridgePoint);

    _resetPillarStoreForTests();

    restoreSerializedObjects(mockViewer() as never, serialized);

    const restored = getPillarSet(modelId);
    expect(restored.pillars[0].bridgeTarget).toEqual(bridgePoint);
  });

  it('omits bridgeTarget when not set', () => {
    const modelId = 'test-model-3';

    setPillarSet(modelId, {
      pillars: [
        {
          id: 'p3',
          origin: 'auto',
          route: [
            { x: 0, y: 8, z: 0 },
            { x: 0, y: 0, z: 0 },
          ],
          tipDiameter: 0.4,
          pillarRadius: 0.3,
          baseRadius: 0.6,
          tipHeight: 1.2,
          baseHeight: 0.6,
          contact: { x: 0, y: 8, z: 0 },
        },
      ],
      settings: {
        crossBracing: false,
        baseBracing: null,
        basePan: null,
        sphericalConnection: null,
        supportFloorY: 0,
        bracingCollisionRadius: 0.2,
      },
    });

    const obj = makeMinimalObject(modelId);
    const serialized = serializeObjects(mockViewer() as never, [obj]);

    const sp = serialized[0].pillarSet!;
    expect(sp.pillars[0].bridgeTarget).toBeUndefined();

    _resetPillarStoreForTests();

    restoreSerializedObjects(mockViewer() as never, serialized);

    const restored = getPillarSet(modelId);
    expect(restored.pillars[0].bridgeTarget).toBeUndefined();
  });

  it('round-trips bridge pillar with internalResting and bridgeTarget together', () => {
    const modelId = 'test-model-4';
    const bridge = { x: 5, y: 3, z: 7 };

    setPillarSet(modelId, {
      pillars: [
        {
          id: 'p4',
          origin: 'auto',
          route: [
            { x: 5, y: 12, z: 7 },
            { x: 5, y: 8, z: 7 },
            { x: 5, y: 3, z: 7, internalResting: true },
          ],
          tipDiameter: 0.5,
          pillarRadius: 0.35,
          baseRadius: 0.7,
          tipHeight: 1.0,
          baseHeight: 0.5,
          contact: { x: 5, y: 12, z: 7 },
          bridgeTarget: bridge,
        },
      ],
      settings: {
        crossBracing: false,
        baseBracing: null,
        basePan: null,
        sphericalConnection: null,
        supportFloorY: 0,
        bracingCollisionRadius: 0.2,
      },
    });

    const obj = makeMinimalObject(modelId);
    const serialized = serializeObjects(mockViewer() as never, [obj]);
    _resetPillarStoreForTests();
    restoreSerializedObjects(mockViewer() as never, serialized);

    const restored = getPillarSet(modelId);
    const pillar = restored.pillars[0];

    expect(pillar.bridgeTarget).toEqual(bridge);
    expect(pillar.route).toHaveLength(3);
    expect(pillar.route[2].internalResting).toBe(true);
    expect(pillar.route[2].x).toBe(bridge.x);
    expect(pillar.route[2].y).toBe(bridge.y);
    expect(pillar.route[2].z).toBe(bridge.z);
  });
});
