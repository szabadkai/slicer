import { describe, expect, it } from 'vitest';
/* eslint-disable no-restricted-imports */
import * as THREE from 'three';
import { createBasePanGeometry } from './supports-base-pan';

describe('createBasePanGeometry', () => {
  it('uses a compact footprint for a single support base instead of falling back to model bounds', () => {
    const modelBounds = new THREE.Box3(
      new THREE.Vector3(-100, 0, -100),
      new THREE.Vector3(100, 20, 100),
    );
    const geo = createBasePanGeometry(
      modelBounds,
      [
        [
          { x: 0, y: 10, z: 0 },
          { x: 0, y: 0, z: 0 },
        ],
      ],
      4,
      0.8,
      1.2,
      1,
    );

    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(box.min.x).toBeGreaterThan(-10);
    expect(box.max.x).toBeLessThan(10);
    expect(box.min.z).toBeGreaterThan(-10);
    expect(box.max.z).toBeLessThan(10);
  });

  it('still falls back to model bounds when there are no build-plate bases', () => {
    const modelBounds = new THREE.Box3(
      new THREE.Vector3(-20, 0, -10),
      new THREE.Vector3(20, 20, 10),
    );
    const geo = createBasePanGeometry(
      modelBounds,
      [
        [
          { x: 0, y: 10, z: 0 },
          { x: 0, y: 5, z: 0, internalResting: true },
        ],
      ],
      4,
      0.8,
      1.2,
      1,
    );

    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(box.min.x).toBeLessThan(-20);
    expect(box.max.x).toBeGreaterThan(20);
  });
});
