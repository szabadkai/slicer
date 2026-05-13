/**
 * Pierce-regression tests for the clearanceSampleStarts fix.
 *
 * Before the fix: clearanceSampleStarts used radius * 0.5, so a route
 * passing within pillarRadius * 0.8 of a face was NOT detected as colliding.
 * After the fix: the full radius is used, so such a route IS detected.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { segmentCollides } from './supports-geometry';
import type { RouteContext } from './supports-geometry';

/**
 * Build a quad mesh perpendicular to the X axis at x=atX, spanning y∈[y0,y1] and z∈[z0,z1].
 * Rays traveling in the +X direction will hit this face if they pass through that y-z region.
 */
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

function makeContext(mesh: THREE.Mesh): RouteContext {
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = false;
  const bounds = new THREE.Box3().setFromObject(mesh);
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  return { mesh, raycaster, modelBounds: bounds, modelCenter: center };
}

describe('segmentCollides pierce-fix regression', () => {
  /**
   * Scenario: a horizontal segment from (0,0,0) to (10,0,0) along +X.
   * clearanceSampleStarts for axis=(1,0,0) offsets by tangent=(0,0,1)
   * and bitangent=(0,-1,0). So the +bitangent offset is at y=-0.6.
   * We place a face at x=5 spanning only y ∈ [-0.9, -0.3] (does NOT cover
   * y=0, only y≈-0.6). The center ray (y=0) misses. The -Y offset ray
   * (y=-0.6) hits.
   */
  it('detects collision when offset sample hits a face that the center ray misses', () => {
    const pillarRadius = 0.6;
    // Face at x=5, spanning y ∈ [-0.9, -0.3] and z ∈ [-1, 1].
    // Center ray at y=0 misses; -Y offset at y=-0.6 hits.
    const mesh = makeYZQuadAtX(5, -0.9, -0.3, -1, 1);
    const ctx = makeContext(mesh);

    const from = new THREE.Vector3(0, 0, 0);
    const to = new THREE.Vector3(10, 0, 0);

    expect(segmentCollides(from, to, ctx, pillarRadius)).toBe(true);
  });

  it('does not flag a segment whose offset samples all miss', () => {
    const pillarRadius = 0.6;
    // Face is way off to the side — no sample ray will hit it.
    const mesh = makeYZQuadAtX(5, 10, 20, 10, 20);
    const ctx = makeContext(mesh);

    const from = new THREE.Vector3(0, 0, 0);
    const to = new THREE.Vector3(10, 0, 0);

    expect(segmentCollides(from, to, ctx, pillarRadius)).toBe(false);
  });
});
