/**
 * CAD format loader — STEP/IGES/3MF import via occt-import-js WASM.
 *
 * Lazily loads the WASM module on first use to avoid bloating the initial bundle.
 * Converts BREP geometry to triangulated mesh (positions + normals) matching
 * the ParsedGeometry interface from the STL loader.
 */
import type { ParsedGeometry } from './load';

/** Supported CAD file extensions */
export const CAD_EXTENSIONS = new Set(['step', 'stp', 'iges', 'igs', 'brep']);

/**
 * Check if a filename has a supported CAD extension.
 */
export function isCadFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return CAD_EXTENSIONS.has(ext);
}

/**
 * Check if a filename is a supported model file (STL or CAD).
 */
export function isSupportedModelFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'stl' || CAD_EXTENSIONS.has(ext);
}

// Lazy-loaded WASM module reference
let occtModule: OcctImportModule | null = null;

interface OcctImportModule {
  ReadStepFile: (buffer: Uint8Array, params: unknown) => OcctResult;
  ReadIgesFile: (buffer: Uint8Array, params: unknown) => OcctResult;
  ReadBrepFile: (buffer: Uint8Array, params: unknown) => OcctResult;
}

interface OcctResult {
  success: boolean;
  meshes: Array<{
    attributes: {
      position: { array: Float32Array };
      normal: { array: Float32Array };
    };
    index?: { array: Uint32Array };
  }>;
}

async function loadOcctModule(): Promise<OcctImportModule> {
  if (occtModule) return occtModule;

  try {
    // Dynamic import — occt-import-js is an optional peer dependency.
    // Variable indirection prevents Vite/Vitest static resolution.
    const pkg = 'occt-import-js';
    const occtImport = await import(/* @vite-ignore */ pkg);
    const init =
      (occtImport as { default?: () => Promise<OcctImportModule> }).default ?? occtImport;
    const mod = (await (init as () => Promise<OcctImportModule>)()) as OcctImportModule;
    occtModule = mod;
    return mod;
  } catch {
    throw new Error(
      'CAD import requires the occt-import-js package. ' +
        'Install it with: npm install occt-import-js',
    );
  }
}

/**
 * Parse a CAD file (STEP/IGES/BREP) into triangulated geometry.
 */
export async function parseCadFile(buffer: ArrayBuffer, filename: string): Promise<ParsedGeometry> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const occt = await loadOcctModule();
  const data = new Uint8Array(buffer);

  let result: OcctResult;

  if (ext === 'step' || ext === 'stp') {
    result = occt.ReadStepFile(data, { linearDeflection: 0.1, angularDeflection: 0.5 });
  } else if (ext === 'iges' || ext === 'igs') {
    result = occt.ReadIgesFile(data, { linearDeflection: 0.1, angularDeflection: 0.5 });
  } else if (ext === 'brep') {
    result = occt.ReadBrepFile(data, { linearDeflection: 0.1, angularDeflection: 0.5 });
  } else {
    throw new Error(`Unsupported CAD format: .${ext}`);
  }

  if (!result.success || result.meshes.length === 0) {
    throw new Error(`Failed to parse ${ext.toUpperCase()} file. The file may be corrupted.`);
  }

  // Merge all meshes into a single ParsedGeometry
  return mergeOcctMeshes(result.meshes);
}

function mergeOcctMeshes(meshes: OcctResult['meshes']): ParsedGeometry {
  // Calculate total triangle count across all meshes
  let totalTriangles = 0;

  for (const mesh of meshes) {
    if (mesh.index) {
      totalTriangles += mesh.index.array.length / 3;
    } else {
      totalTriangles += mesh.attributes.position.array.length / 9;
    }
  }

  const positions = new Float32Array(totalTriangles * 9);
  const normals = new Float32Array(totalTriangles * 9);
  let offset = 0;

  for (const mesh of meshes) {
    const pos = mesh.attributes.position.array;
    const norm = mesh.attributes.normal.array;

    if (mesh.index) {
      const idx = mesh.index.array;
      for (let i = 0; i < idx.length; i++) {
        const srcIdx = idx[i] * 3;
        positions[offset] = pos[srcIdx];
        positions[offset + 1] = pos[srcIdx + 1];
        positions[offset + 2] = pos[srcIdx + 2];
        normals[offset] = norm[srcIdx];
        normals[offset + 1] = norm[srcIdx + 1];
        normals[offset + 2] = norm[srcIdx + 2];
        offset += 3;
      }
    } else {
      positions.set(pos, offset);
      normals.set(norm, offset);
      offset += pos.length;
    }
  }

  return { positions, normals, triangleCount: totalTriangles };
}
