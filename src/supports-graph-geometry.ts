/**
 * Geometry builder for graph-based support structures.
 */

/* eslint-disable no-restricted-imports */
import * as THREE from 'three';

export interface SupportGraphNode {
  id: string;
  position: { x: number; y: number; z: number };
  radius: number;
  kind: 'tip' | 'branch' | 'trunk' | 'base';
}

export interface SupportGraphEdge {
  from: string;
  to: string;
  radius: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const SUPPORT_SEGMENTS = 6;

export function buildSupportGraphGeometry(
  nodes: SupportGraphNode[],
  edges: SupportGraphEdge[],
  geometries: THREE.BufferGeometry[],
): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  for (const edge of edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    const p1 = new THREE.Vector3(from.position.x, from.position.y, from.position.z);
    const p2 = new THREE.Vector3(to.position.x, to.position.y, to.position.z);
    const length = p1.distanceTo(p2);
    if (length < 0.1) continue;

    const radius = Math.max(edge.radius, 0.05);
    const edgeGeo = new THREE.CylinderGeometry(
      radius,
      radius,
      length,
      Math.max(3, SUPPORT_SEGMENTS),
    );
    const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
    edgeGeo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
    edgeGeo.translate((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, (p1.z + p2.z) / 2);
    geometries.push(edgeGeo);
  }

  for (const node of nodes) {
    const radius = Math.max(node.radius, 0.05);
    const sphereGeo = new THREE.SphereGeometry(radius, SUPPORT_SEGMENTS, 4);
    sphereGeo.translate(node.position.x, node.position.y, node.position.z);
    geometries.push(sphereGeo);
  }
}
