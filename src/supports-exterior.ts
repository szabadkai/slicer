/**
 * Exterior contact-point validation — determines whether a support contact
 * point sits on the model's outer surface rather than inside a cavity.
 */

import * as THREE from 'three';
import type { ContactPoint, RouteContext } from './supports-geometry';

const DOWN = new THREE.Vector3(0, -1, 0);

const EXTERIOR_RAY_DIRECTIONS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

export function isExteriorContact(
  point: ContactPoint,
  context: RouteContext,
  clearance: number,
): boolean {
  const normal = point.normal?.clone().normalize() ?? DOWN.clone();
  if (!isOutwardFacingSurface(point.position, normal, context.modelCenter)) return false;
  const start = point.position.clone().addScaledVector(normal, Math.max(0.05, clearance * 0.1));
  return [normal, ...EXTERIOR_RAY_DIRECTIONS].some((dir) => rayEscapesModel(start, dir, context));
}

function isOutwardFacingSurface(
  position: THREE.Vector3,
  normal: THREE.Vector3,
  modelCenter: THREE.Vector3,
): boolean {
  const radial = new THREE.Vector3().subVectors(position, modelCenter);
  if (radial.lengthSq() < 1e-6) return true;
  radial.normalize();
  return normal.dot(radial) > -0.1;
}

function rayEscapesModel(
  start: THREE.Vector3,
  direction: THREE.Vector3,
  context: RouteContext,
): boolean {
  const dir = direction.clone().normalize();
  if (dir.lengthSq() === 0) return false;
  const far = rayDistancePastBounds(start, dir, context.modelBounds);
  if (far <= 0) return true;
  context.raycaster.set(start, dir);
  context.raycaster.far = far;
  return context.raycaster.intersectObject(context.mesh).every((hit) => hit.distance < 0.05);
}

function rayDistancePastBounds(
  start: THREE.Vector3,
  direction: THREE.Vector3,
  bounds: THREE.Box3,
): number {
  const expanded = bounds.clone().expandByScalar(1);
  const boxHit = new THREE.Vector3();
  const ray = new THREE.Ray(start, direction);
  if (!ray.intersectBox(expanded, boxHit)) return 0;
  return start.distanceTo(boxHit) + 1;
}
