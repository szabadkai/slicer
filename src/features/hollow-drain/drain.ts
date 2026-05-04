/* eslint-disable no-restricted-imports */
import * as THREE from 'three';
import { buildDrainCutterGeometry } from './drain-cut';

export interface DrainHole {
  id: string;
  position: THREE.Vector3;    // world position on surface
  normal: THREE.Vector3;      // surface normal (points outward)
  diameter: number;           // mm
  depth: number;              // mm (auto: wallThickness * 1.4)
  visualMesh: THREE.Mesh;     // ring indicator shown in viewport
}

export interface DrainPlug {
  holeId: string;
  geometry: THREE.BufferGeometry;   // manifold solid, ready for viewer.addModel()
  diameter: number;
  height: number;
}

let _holeIdCounter = 0;

/**
 * Create a visual indicator ring for a drain hole.
 * This is purely cosmetic — the actual geometry cut is done by drain-cut.ts
 * via Manifold CSG.
 */
export function createVisualIndicator(
  position: THREE.Vector3,
  normal: THREE.Vector3,
  diameter: number,
): THREE.Mesh {
  const r = diameter / 2;

  // Ring on the surface
  const ringGeo = new THREE.RingGeometry(r * 0.6, r, 32);
  const visMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(ringGeo, visMat);
  mesh.renderOrder = 10;

  // Orient ring perpendicular to surface normal
  const up = new THREE.Vector3(0, 0, 1); // ring geometry lies in XY plane
  const q = new THREE.Quaternion().setFromUnitVectors(up, normal.clone().normalize());
  mesh.quaternion.copy(q);
  mesh.position.copy(position);
  // Slight offset along normal to prevent z-fighting
  mesh.position.addScaledVector(normal.clone().normalize(), 0.05);

  return mesh;
}

/** Add a drain hole to the scene; returns the DrainHole object. */
export function addDrainHole(
  scene: THREE.Scene,
  position: THREE.Vector3,
  normal: THREE.Vector3,
  diameter: number,
  wallThickness: number,
): DrainHole {
  const depth = wallThickness * 1.4;
  const visualMesh = createVisualIndicator(position, normal, diameter);
  scene.add(visualMesh);

  return {
    id: `hole-${++_holeIdCounter}`,
    position: position.clone(),
    normal: normal.clone(),
    diameter,
    depth,
    visualMesh,
  };
}

/** Remove a drain hole from the scene and dispose its meshes. */
export function removeDrainHole(scene: THREE.Scene, hole: DrainHole): void {
  scene.remove(hole.visualMesh);
  hole.visualMesh.geometry.dispose();
  (hole.visualMesh.material as THREE.Material).dispose();
}

/**
 * Auto-place N drain holes at the lowest-Z points of the model.
 * Strategy: sample points on the bottom 30% of the model's bounding box,
 * cast rays upward and collect surface hits, pick the N most separated hits.
 */
export function autoPlaceHoles(
  geometry: THREE.BufferGeometry,
  modelMesh: THREE.Mesh,
  scene: THREE.Scene,
  options: { count: number; diameter: number; wallThickness: number },
): DrainHole[] {
  const { count, diameter, wallThickness } = options;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return [];
  const size = new THREE.Vector3(); bb.getSize(size);
  const minY = bb.min.y;
  const zoneHeight = size.y * 0.3; // bottom 30%

  const raycaster = new THREE.Raycaster();
  const hits: { pos: THREE.Vector3; norm: THREE.Vector3 }[] = [];

  // Sample a grid in the bottom zone's XZ footprint
  const gridN = 8;
  for (let xi = 0; xi <= gridN; xi++) {
    for (let zi = 0; zi <= gridN; zi++) {
      const x = bb.min.x + (size.x * xi) / gridN;
      const z = bb.min.z + (size.z * zi) / gridN;
      const origin = modelMesh.localToWorld(new THREE.Vector3(x, minY - 0.5, z));
      raycaster.set(origin, new THREE.Vector3(0, 1, 0));
      raycaster.near = 0;
      raycaster.far = zoneHeight + 1;
      const intersects = raycaster.intersectObject(modelMesh);
      if (intersects.length > 0) {
        const hit = intersects[0];
        if (!hit.face) continue;
        const norm = hit.face.normal.clone().transformDirection(modelMesh.matrixWorld).normalize();
        // We want holes going downward (low normal.y)
        if (norm.y < 0.3) {
          hits.push({ pos: hit.point.clone(), norm });
        }
      }
    }
  }

  // Pick the lowest hits spread apart by at least diameter*3
  hits.sort((a, b) => a.pos.y - b.pos.y);
  const picked: typeof hits = [];
  const minDist = diameter * 3;
  for (const h of hits) {
    if (picked.every((p) => p.pos.distanceTo(h.pos) >= minDist)) {
      picked.push(h);
      if (picked.length >= count) break;
    }
  }

  // Fallback: use lowest point on the bounding box bottom if nothing found
  if (picked.length === 0) {
    const center = new THREE.Vector3((bb.min.x + bb.max.x) / 2, minY, (bb.min.z + bb.max.z) / 2);
    picked.push({ pos: center, norm: new THREE.Vector3(0, -1, 0) });
  }

  return picked.map(({ pos, norm }) => addDrainHole(scene, pos, norm, diameter, wallThickness));
}

/**
 * Generate the plug as the same volume removed by the drain cutter, reduced
 * slightly for print clearance.
 */
export function generatePlug(hole: DrainHole): DrainPlug {
  const radialClearance = 0.08;
  const endClearance = 0.15;
  const geo = buildDrainCutterGeometry(
    hole.position,
    hole.normal,
    hole.diameter,
    hole.depth / 1.4,
    radialClearance,
    endClearance,
  );
  geo.computeVertexNormals();

  return { holeId: hole.id, geometry: geo, diameter: hole.diameter - radialClearance * 2, height: hole.depth };
}
