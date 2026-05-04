/**
 * Boolean operations: subtract and split using Manifold-3D.
 * Mirrors the patterns from hollow-drain/drain-cut.ts.
 */

import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { getManifoldModule, setWasmUrl } from 'manifold-3d/lib/wasm';

// ─── Types ─────────────────────────────────────────────────

export interface BooleanResult {
  positions: Float32Array | null;
  triangleCount: number;
}

export interface SplitResult {
  inside: BooleanResult;
  outside: BooleanResult;
}

// ─── WASM setup ────────────────────────────────────────────

const WELD_SCALE = 1e5;
let wasmUrlConfigured = false;

function configureWasmUrl(): void {
  if (wasmUrlConfigured) return;
  setWasmUrl(wasmUrl);
  wasmUrlConfigured = true;
}

// ─── Indexing helpers (same approach as drain-cut.ts) ───────

interface IndexedMesh {
  vertices: Float32Array;
  indices: Uint32Array;
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

function positionsFromManifoldMesh(mesh: {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
}): Float32Array | null {
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

type ManifoldModule = Awaited<ReturnType<typeof getManifoldModule>>;
type ManifoldInstance = InstanceType<ManifoldModule['Manifold']>;

function manifoldFromPositions(
  module: ManifoldModule,
  positions: Float32Array,
): ManifoldInstance | null {
  const indexed = indexPositions(positions);
  if (indexed.indices.length < 3 || indexed.vertices.length < 9) return null;

  const mesh = new module.Mesh({
    numProp: 3,
    vertProperties: indexed.vertices,
    triVerts: indexed.indices,
  });
  return new module.Manifold(mesh);
}

function toBooleanResult(positions: Float32Array | null): BooleanResult {
  return {
    positions,
    triangleCount: positions ? positions.length / 9 : 0,
  };
}

// ─── Public API ────────────────────────────────────────────

/**
 * Subtract primitive from model: model - primitive.
 * Both inputs are flat position arrays (non-indexed, 9 floats per triangle).
 */
export async function subtractPrimitive(
  modelPositions: Float32Array,
  cutterPositions: Float32Array,
): Promise<BooleanResult> {
  configureWasmUrl();
  const module = await getManifoldModule();

  const source = manifoldFromPositions(module, modelPositions);
  if (!source) return toBooleanResult(null);

  const cutter = manifoldFromPositions(module, cutterPositions);
  if (!cutter) {
    source.delete();
    return toBooleanResult(null);
  }

  try {
    const result = source.subtract(cutter);
    source.delete();
    cutter.delete();

    if (result.isEmpty()) {
      result.delete();
      return toBooleanResult(null);
    }

    const positions = positionsFromManifoldMesh(result.getMesh());
    result.delete();
    return toBooleanResult(positions);
  } catch (error) {
    console.error('Boolean subtract operation failed:', error);
    source.delete();
    cutter.delete();
    return toBooleanResult(null);
  }
}

/**
 * Split model by primitive: returns inside (intersection) and outside (subtraction).
 */
export async function splitByPrimitive(
  modelPositions: Float32Array,
  cutterPositions: Float32Array,
): Promise<SplitResult> {
  configureWasmUrl();
  const module = await getManifoldModule();

  // Run subtract and intersect independently — each can fail without blocking the other.
  let outsidePositions: Float32Array | null = null;
  let insidePositions: Float32Array | null = null;

  // Outside = model - cutter (subtract)
  try {
    const src = manifoldFromPositions(module, modelPositions);
    const cut = manifoldFromPositions(module, cutterPositions);
    if (src && cut) {
      const result = src.subtract(cut);
      if (!result.isEmpty()) {
        outsidePositions = positionsFromManifoldMesh(result.getMesh());
      }
      result.delete();
    } else {
      src?.delete();
      cut?.delete();
    }
  } catch (error) {
    console.warn('Boolean split (outside/subtract) failed:', error);
  }

  // Inside = model ∩ cutter (intersect)
  try {
    const src = manifoldFromPositions(module, modelPositions);
    const cut = manifoldFromPositions(module, cutterPositions);
    if (src && cut) {
      const result = src.intersect(cut);
      if (!result.isEmpty()) {
        insidePositions = positionsFromManifoldMesh(result.getMesh());
      }
      result.delete();
    } else {
      src?.delete();
      cut?.delete();
    }
  } catch (error) {
    console.warn('Boolean split (inside/intersect) failed:', error);
  }

  return {
    inside: toBooleanResult(insidePositions),
    outside: toBooleanResult(outsidePositions),
  };
}
