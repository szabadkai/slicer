import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { getManifoldModule, setWasmUrl } from 'manifold-3d/lib/wasm';
import type { Vec3Tuple, PlaneCutResult } from './cut';

interface IndexedMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

const WELD_SCALE = 1e5;
let wasmUrlConfigured = false;

export async function cutGeometryByManifoldPlane(
  positions: Float32Array,
  normal: Vec3Tuple,
  constant: number,
): Promise<PlaneCutResult | null> {
  try {
    configureWasmUrl();
    const module = await getManifoldModule();
    const indexed = indexPositions(positions);
    if (indexed.indices.length < 3 || indexed.vertices.length < 9) return null;

    const mesh = new module.Mesh({
      numProp: 3,
      vertProperties: indexed.vertices,
      triVerts: indexed.indices,
    });
    mesh.merge();
    const manifold = new module.Manifold(mesh);
    if (manifold.status() !== 'NoError') return null;

    const [positive, negative] = manifold.splitByPlane(normal, constant);
    if (positive.status() !== 'NoError' || negative.status() !== 'NoError') return null;

    const positivePositions = positionsFromManifoldMesh(positive.getMesh());
    const negativePositions = positionsFromManifoldMesh(negative.getMesh());
    if (!positivePositions || !negativePositions) return null;

    return {
      negative: negativePositions,
      positive: positivePositions,
      negativeTriangleCount: negativePositions.length / 9,
      positiveTriangleCount: positivePositions.length / 9,
    };
  } catch (error) {
    console.warn('Manifold cut failed; falling back to triangle clipping.', error);
    return null;
  }
}

function configureWasmUrl(): void {
  if (wasmUrlConfigured) return;
  setWasmUrl(wasmUrl);
  wasmUrlConfigured = true;
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
