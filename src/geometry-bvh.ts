/* eslint-disable no-restricted-imports */
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

type BvhGeometry = THREE.BufferGeometry & {
  boundsTree?: unknown;
  computeBoundsTree?: () => void;
  disposeBoundsTree?: () => void;
};

let patched = false;

export function ensureBvhRaycast(): void {
  if (patched) return;
  (THREE.BufferGeometry.prototype as BvhGeometry).computeBoundsTree = computeBoundsTree;
  (THREE.BufferGeometry.prototype as BvhGeometry).disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
  patched = true;
}

export function ensureGeometryBoundsTree(geometry: THREE.BufferGeometry): void {
  ensureBvhRaycast();
  const bvhGeometry = geometry as BvhGeometry;
  if (bvhGeometry.boundsTree || !bvhGeometry.getAttribute('position')) return;
  bvhGeometry.computeBoundsTree?.();
}

export function disposeGeometryBoundsTree(geometry: THREE.BufferGeometry): void {
  (geometry as BvhGeometry).disposeBoundsTree?.();
}

export function disposeGeometry(geometry: THREE.BufferGeometry): void {
  disposeGeometryBoundsTree(geometry);
  geometry.dispose();
}
