import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { findBridgeRoute } from './supports-bridge';
import type { RouteContext, RouteOptions } from './supports-geometry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a horizontal quad (floor/ceiling) at the given Y, spanning x/z. */
function makeHorizontalQuad(
  y: number,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
): THREE.BufferGeometry {
  const positions = new Float32Array([
    x0,
    y,
    z0,
    x1,
    y,
    z0,
    x1,
    y,
    z1,
    x0,
    y,
    z0,
    x1,
    y,
    z1,
    x0,
    y,
    z1,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function makeContext(geometries: THREE.BufferGeometry[]): RouteContext {
  const merged = new THREE.BufferGeometry();
  const arrays = geometries.map(
    (g) => (g.attributes.position as THREE.Float32BufferAttribute).array,
  );
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const positions = new Float32Array(total);
  let offset = 0;
  for (const a of arrays) {
    positions.set(a, offset);
    offset += a.length;
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = false;
  const bounds = new THREE.Box3().setFromObject(mesh);
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  return { mesh, raycaster, modelBounds: bounds, modelCenter: center };
}

function defaultRouteOpts(overrides?: Partial<RouteOptions>): RouteOptions {
  return {
    allowInternalSupports: false,
    allowCavityContacts: false,
    approachMode: 'prefer-angled',
    maxPillarAngle: 45,
    modelClearance: 1.5,
    supportCollisionRadius: 0.2,
    supportTipRadius: 0.15,
    maxContactOffset: 18,
    allowBridgeSupports: true,
    maxBridgeSearchRadius: 30,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('findBridgeRoute', () => {
  it('finds a bridge to a surface below the contact point', () => {
    // A platform at Y=5 that the contact (at Y=20) can bridge down to.
    const ctx = makeContext([makeHorizontalQuad(5, -10, 10, -10, 10)]);
    const contactPos = new THREE.Vector3(0, 20, 0);
    const opts = defaultRouteOpts();

    const route = findBridgeRoute(contactPos, ctx, 0.4, 0.5, 0.6, opts);

    expect(route).not.toBeNull();
    expect(route!.length).toBe(2);
    // Source is the contact point.
    expect(route![0].x).toBeCloseTo(0, 0);
    expect(route![0].y).toBeCloseTo(20, 0);
    // Target has internalResting.
    expect(route![1].internalResting).toBe(true);
    // Target should be on or near the platform at Y=5.
    expect(route![1].y).toBeCloseTo(5, 0);
  });

  it('returns null when no surface is within search radius', () => {
    // Platform at Y=5 but search radius is only 3mm (contact at Y=20 = 15mm away).
    const ctx = makeContext([makeHorizontalQuad(5, -10, 10, -10, 10)]);
    const contactPos = new THREE.Vector3(0, 20, 0);
    const opts = defaultRouteOpts({ maxBridgeSearchRadius: 3 });

    const route = findBridgeRoute(contactPos, ctx, 0.4, 0.5, 0.6, opts);
    expect(route).toBeNull();
  });

  it('rejects bridges shorter than minimum length', () => {
    // Platform very close to contact point — tipHeight*2 + 0.5 = 1.5mm minimum.
    const tipHeight = 0.5;
    const ctx = makeContext([makeHorizontalQuad(19.8, -10, 10, -10, 10)]);
    const contactPos = new THREE.Vector3(0, 20, 0);
    const opts = defaultRouteOpts();

    const route = findBridgeRoute(contactPos, ctx, 0.4, tipHeight, 0.6, opts);
    // Distance is only 0.2mm, less than tipHeight*2 + 0.5 = 1.5mm.
    expect(route).toBeNull();
  });

  it('prefers shorter bridges when multiple candidates exist', () => {
    // Two platforms: one at Y=15 (5mm away) and one at Y=5 (15mm away).
    const ctx = makeContext([
      makeHorizontalQuad(15, -10, 10, -10, 10),
      makeHorizontalQuad(5, -10, 10, -10, 10),
    ]);
    const contactPos = new THREE.Vector3(0, 20, 0);
    const opts = defaultRouteOpts();

    const route = findBridgeRoute(contactPos, ctx, 0.4, 0.5, 0.6, opts);

    expect(route).not.toBeNull();
    // Should pick the closer platform (Y=15).
    expect(route![1].y).toBeCloseTo(15, 0);
  });
});
