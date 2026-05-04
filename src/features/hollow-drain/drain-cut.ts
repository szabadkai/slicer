/* eslint-disable no-restricted-imports */
import * as THREE from 'three';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { getManifoldModule, setWasmUrl } from 'manifold-3d/lib/wasm';
import { inspectMesh } from '@features/mesh-health/detect';

interface IndexedMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

export interface DrainCutSpec {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  diameter: number;
  wallThickness: number;
}

const WELD_SCALE = 1e5;
let wasmUrlConfigured = false;

export async function cutDrainHoleFromGeometry(
  geometry: THREE.BufferGeometry,
  spec: DrainCutSpec,
): Promise<THREE.BufferGeometry | null> {
  if (spec.diameter <= 0 || spec.wallThickness <= 0) return null;
  const normal = spec.normal.clone().normalize();
  if (normal.lengthSq() <= 1e-8) return null;

  try {
    configureWasmUrl();
    const module = await getManifoldModule();
    const source = manifoldFromGeometry(module, geometry);
    if (!source || source.status() !== 'NoError') return null;

    const cutterGeometry = buildDrainCutterGeometry(spec.position, normal, spec.diameter, spec.wallThickness);
    const cutter = manifoldFromGeometry(module, cutterGeometry);
    cutterGeometry.dispose();
    if (!cutter || cutter.status() !== 'NoError') {
      source.delete();
      cutter?.delete();
      return null;
    }

    const result = source.subtract(cutter);
    source.delete();
    cutter.delete();
    if (result.status() !== 'NoError' || result.isEmpty()) {
      result.delete();
      return null;
    }

    const positions = positionsFromManifoldMesh(result.getMesh());
    result.delete();
    if (!positions || !isHealthyDrainResult(positions)) return null;

    const output = new THREE.BufferGeometry();
    output.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    output.computeVertexNormals();
    output.computeBoundingBox();
    return output;
  } catch (error) {
    console.warn('Drain boolean cut failed.', error);
    return null;
  }
}

export async function createDrainPlugFromGeometry(
  geometry: THREE.BufferGeometry,
  spec: DrainCutSpec,
): Promise<THREE.BufferGeometry | null> {
  if (spec.diameter <= 0 || spec.wallThickness <= 0) return null;
  const normal = spec.normal.clone().normalize();
  if (normal.lengthSq() <= 1e-8) return null;

  try {
    configureWasmUrl();
    const module = await getManifoldModule();
    const source = manifoldFromGeometry(module, geometry);
    if (!source || source.status() !== 'NoError') return null;

    const cutterGeometry = buildDrainCutterGeometry(spec.position, normal, spec.diameter, spec.wallThickness, 0.08, 0.15);
    const cutter = manifoldFromGeometry(module, cutterGeometry);
    cutterGeometry.dispose();
    if (!cutter || cutter.status() !== 'NoError') {
      source.delete();
      cutter?.delete();
      return null;
    }

    const result = source.intersect(cutter);
    source.delete();
    cutter.delete();
    if (result.status() !== 'NoError' || result.isEmpty()) {
      result.delete();
      return null;
    }

    const positions = positionsFromManifoldMesh(result.getMesh());
    result.delete();
    if (!positions || positions.length < 9 || !isHealthyDrainResult(positions)) return null;

    const output = new THREE.BufferGeometry();
    output.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    output.computeVertexNormals();
    output.computeBoundingBox();
    return output;
  } catch (error) {
    console.warn('Drain plug generation failed.', error);
    return null;
  }
}

function configureWasmUrl(): void {
  if (wasmUrlConfigured) return;
  setWasmUrl(wasmUrl);
  wasmUrlConfigured = true;
}

export function buildDrainCutterGeometry(
  surfacePosition: THREE.Vector3,
  normal: THREE.Vector3,
  diameter: number,
  wallThickness: number,
  radialTolerance = 0,
  lengthTolerance = 0,
): THREE.BufferGeometry {
  const radius = Math.max(diameter / 2 - radialTolerance, 0.05);
  const outward = Math.max(diameter, wallThickness * 0.75);
  const inward = Math.max(wallThickness * 2.5, diameter * 1.5);
  const length = Math.max(outward + inward - lengthTolerance * 2, 0.1);
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 48, 1, false);
  const axis = normal.clone().normalize();
  const center = surfacePosition.clone().add(axis.multiplyScalar(outward - lengthTolerance - length / 2));
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal));
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

function manifoldFromGeometry(
  module: Awaited<ReturnType<typeof getManifoldModule>>,
  geometry: THREE.BufferGeometry,
): InstanceType<typeof module.Manifold> | null {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const positionAttribute = source.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!positionAttribute) {
    source.dispose();
    return null;
  }
  const positions = new Float32Array(positionAttribute.array as ArrayLike<number>);
  source.dispose();
  const indexed = indexPositions(positions);
  if (indexed.indices.length < 3 || indexed.vertices.length < 9) return null;

  const mesh = new module.Mesh({
    numProp: 3,
    vertProperties: indexed.vertices,
    triVerts: indexed.indices,
  });
  return new module.Manifold(mesh);
}

function indexPositions(positions: Float32Array): IndexedMesh {
  const vertexMap = new Map<string, number>();
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const key = `${Math.round(x * WELD_SCALE)},${Math.round(y * WELD_SCALE)},${Math.round(z * WELD_SCALE)}`;
    let index = vertexMap.get(key);
    if (index === undefined) {
      index = vertices.length / 3;
      vertexMap.set(key, index);
      vertices.push(x, y, z);
    }
    indices.push(index);
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
  };
}

function positionsFromManifoldMesh(mesh: { vertProperties: Float32Array; triVerts: Uint32Array }): Float32Array | null {
  if (mesh.triVerts.length < 3 || mesh.vertProperties.length < 9) return null;
  const positions = new Float32Array(mesh.triVerts.length * 3);
  for (let i = 0; i < mesh.triVerts.length; i++) {
    const src = mesh.triVerts[i] * 3;
    const dst = i * 3;
    positions[dst] = mesh.vertProperties[src];
    positions[dst + 1] = mesh.vertProperties[src + 1];
    positions[dst + 2] = mesh.vertProperties[src + 2];
  }
  return positions;
}

function isHealthyDrainResult(positions: Float32Array): boolean {
  const report = inspectMesh({
    positions,
    normals: null,
    triangleCount: positions.length / 9,
  });
  return !report.issues.some((issue) =>
    issue.id === 'holes' ||
    issue.id === 'non-manifold-edges' ||
    issue.id === 'degenerate-triangles',
  );
}
