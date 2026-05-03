import { describe, it, expect } from 'vitest';
import type { MeshData } from './detect';
import { inspectMesh, badgeColorFromSeverity } from './detect';
import { repairMesh } from './repair';

// ─── Test meshes ───────────────────────────────────────────

/** A watertight unit cube (12 triangles, 36 vertices, non-indexed) */
function makeWatertightCube(): MeshData {
  // prettier-ignore
  const positions = new Float32Array([
    // Front face (z=1)
    0,0,1, 1,0,1, 1,1,1,
    0,0,1, 1,1,1, 0,1,1,
    // Back face (z=0)
    1,0,0, 0,0,0, 0,1,0,
    1,0,0, 0,1,0, 1,1,0,
    // Top face (y=1)
    0,1,1, 1,1,1, 1,1,0,
    0,1,1, 1,1,0, 0,1,0,
    // Bottom face (y=0)
    0,0,0, 1,0,0, 1,0,1,
    0,0,0, 1,0,1, 0,0,1,
    // Right face (x=1)
    1,0,1, 1,0,0, 1,1,0,
    1,0,1, 1,1,0, 1,1,1,
    // Left face (x=0)
    0,0,0, 0,0,1, 0,1,1,
    0,0,0, 0,1,1, 0,1,0,
  ]);

  const normals = new Float32Array([
    // Front
    0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1,
    // Back
    0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
    // Top
    0,1,0, 0,1,0, 0,1,0, 0,1,0, 0,1,0, 0,1,0,
    // Bottom
    0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
    // Right
    1,0,0, 1,0,0, 1,0,0, 1,0,0, 1,0,0, 1,0,0,
    // Left
    -1,0,0, -1,0,0, -1,0,0, -1,0,0, -1,0,0, -1,0,0,
  ]);

  return { positions, normals, triangleCount: 12 };
}

/** A cube missing one triangle → has boundary edges (holes) */
function makeCubeWithHole(): MeshData {
  const full = makeWatertightCube();
  // Remove last triangle (indices 99..107 → last 9 floats of positions)
  const positions = full.positions.slice(0, (12 - 1) * 9);
  const normals = full.normals!.slice(0, (12 - 1) * 9);
  return { positions, normals, triangleCount: 11 };
}

/** A single degenerate triangle (all 3 vertices at same point) */
function makeDegenerateTriangle(): MeshData {
  const positions = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]);
  return { positions, normals: null, triangleCount: 1 };
}

// ─── Detection tests ───────────────────────────────────────

describe('mesh-health detect', () => {
  it('clean cube reports healthy', () => {
    const report = inspectMesh(makeWatertightCube());
    expect(report.overallSeverity).toBe('healthy');
    expect(report.issues).toHaveLength(0);
    expect(report.triangleCount).toBe(12);
  });

  it('cube with hole reports boundary edges', () => {
    const report = inspectMesh(makeCubeWithHole());
    expect(report.overallSeverity).toBe('error');
    const holesIssue = report.issues.find((i) => i.id === 'holes');
    expect(holesIssue).toBeDefined();
    expect(holesIssue!.count).toBeGreaterThan(0);
  });

  it('degenerate triangle detected', () => {
    const report = inspectMesh(makeDegenerateTriangle());
    const degen = report.issues.find((i) => i.id === 'degenerate-triangles');
    expect(degen).toBeDefined();
    expect(degen!.count).toBe(1);
  });

  it('badgeColorFromSeverity maps correctly', () => {
    expect(badgeColorFromSeverity('error')).toBe('red');
    expect(badgeColorFromSeverity('warning')).toBe('yellow');
    expect(badgeColorFromSeverity('healthy')).toBe('green');
    expect(badgeColorFromSeverity('info')).toBe('green');
  });
});

// ─── Repair tests ──────────────────────────────────────────

describe('mesh-health repair', () => {
  it('repair removes degenerate triangles', () => {
    // Combine a cube + one degenerate triangle
    const cube = makeWatertightCube();
    const degen = makeDegenerateTriangle();
    const combined = new Float32Array(cube.positions.length + degen.positions.length);
    combined.set(cube.positions, 0);
    combined.set(degen.positions, cube.positions.length);

    const mesh: MeshData = {
      positions: combined,
      normals: null,
      triangleCount: 13,
    };

    const result = repairMesh(mesh);
    expect(result.removedTriangles).toBe(1);
    expect(result.triangleCount).toBe(12);
  });

  it('repair produces normals with unit length', () => {
    const cube = makeWatertightCube();
    const result = repairMesh(cube);

    for (let i = 0; i < result.normals.length; i += 3) {
      const len = Math.sqrt(
        result.normals[i] ** 2 + result.normals[i + 1] ** 2 + result.normals[i + 2] ** 2,
      );
      expect(len).toBeCloseTo(1.0, 4);
    }
  });

  it('repair does not mutate input', () => {
    const cube = makeWatertightCube();
    const originalPositions = new Float32Array(cube.positions);
    repairMesh(cube);
    expect(cube.positions).toEqual(originalPositions);
  });
});
