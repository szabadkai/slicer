import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { detectMinima, detectStabilization, detectReinforcements } from './supports-detect';
import type { RouteContext } from './supports-geometry';

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Box geometry from (0,0,0) to (w,h,d), all faces. */
function makeBoxGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(w / 2, h / 2, d / 2);
  return geo;
}

/**
 * A "hanging spike" shape: a flat disc at y=10 with a single spike vertex
 * protruding downward to y=2. The spike vertex (y=2) is a local Y-minimum
 * (all its neighbors are at y=10) and has a downward-pointing accumulated normal.
 */
function makeHangingSpikeGeometry(): THREE.BufferGeometry {
  // Spike tip at y=2; ring of vertices at y=10 radius=3
  const N = 6;
  const ringY = 10;
  const tipY = 2;
  const positions: number[] = [0, tipY, 0]; // vertex 0 = spike tip
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    positions.push(Math.cos(a) * 3, ringY, Math.sin(a) * 3);
  }
  const indices: number[] = [];
  for (let i = 0; i < N; i++) {
    const next = ((i + 1) % N) + 1;
    indices.push(0, i + 1, next); // spike faces
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(new THREE.Uint16BufferAttribute(new Uint16Array(indices), 1));
  return geo;
}

/** Tall narrow tower: 2×30×2 box. height/footprint = 30/2 = 15 >> threshold of 3. */
function makeTowerGeometry(): THREE.BufferGeometry {
  return makeBoxGeometry(2, 30, 2);
}

/** Wide squat box: 20×5×20. height/footprint = 5/20 = 0.25 << threshold. */
function makeWideBoxGeometry(): THREE.BufferGeometry {
  return makeBoxGeometry(20, 5, 20);
}

/** Thin wall: two parallel faces separated by thicknessMM, 10mm tall, 10mm wide. */
function makeThinWallGeometry(thicknessMM: number): THREE.BufferGeometry {
  const half = thicknessMM / 2;
  // Two quad faces: one at z=-half, one at z=+half
  const positions = new Float32Array([
    // front face (z = +half), outward normal = +Z
    -5,
    0,
    half,
    5,
    0,
    half,
    5,
    10,
    half,
    -5,
    0,
    half,
    5,
    10,
    half,
    -5,
    10,
    half,
    // back face (z = -half), outward normal = -Z
    -5,
    0,
    -half,
    5,
    10,
    -half,
    5,
    0,
    -half,
    -5,
    0,
    -half,
    -5,
    10,
    -half,
    5,
    10,
    -half,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function makeContext(geo: THREE.BufferGeometry): RouteContext {
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;
  const bounds = new THREE.Box3().setFromObject(mesh);
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  return { mesh, raycaster, modelBounds: bounds, modelCenter: center };
}

// ---------------------------------------------------------------------------
// detectMinima
// ---------------------------------------------------------------------------

describe('detectMinima', () => {
  it('detects a hanging spike tip as a local minimum', () => {
    // Spike tip at y=2, ring at y=10 — tip is strictly lower than all its neighbors
    const geo = makeHangingSpikeGeometry();
    const contacts = detectMinima(geo, { minSupportHeight: 0.5 });
    expect(contacts.length).toBeGreaterThanOrEqual(1);
    expect(contacts.every((c) => c.reason === 'minima')).toBe(true);
  });

  it('returns no minima for a flat region where all vertices share the same Y', () => {
    const geo = makeBoxGeometry(10, 5, 10);
    // BoxGeometry has separate face verts so each face's verts only neighbour same-face verts.
    // Top face verts at y=5 all have the same Y → no vertex is strictly lower than all neighbours.
    // Bottom face verts at y=0 → filtered by floorY+0.5 guard.
    const contacts = detectMinima(geo, { minSupportHeight: 0.5 });
    expect(contacts.length).toBe(0);
  });

  it('respects minSupportHeight — spike tip below threshold is not emitted', () => {
    const geo = makeHangingSpikeGeometry(); // tip at y=2
    const contacts = detectMinima(geo, { minSupportHeight: 5.0 });
    // y=2 < 5 → skipped; ring at y=10 has all equal Y → not a local min
    expect(contacts.length).toBe(0);
  });

  it('tags all contacts with reason minima', () => {
    const geo = makeHangingSpikeGeometry();
    const contacts = detectMinima(geo, { minSupportHeight: 0.5 });
    for (const c of contacts) expect(c.reason).toBe('minima');
  });
});

// ---------------------------------------------------------------------------
// detectStabilization
// ---------------------------------------------------------------------------

describe('detectStabilization', () => {
  it('returns contacts for a tall narrow tower', () => {
    const geo = makeTowerGeometry(); // 2×30×2
    const contacts = detectStabilization(geo, {
      density: 4,
      minSupportHeight: 0.5,
    });
    expect(contacts.length).toBeGreaterThan(0);
  });

  it('tags all stabilization contacts correctly', () => {
    const geo = makeTowerGeometry();
    const contacts = detectStabilization(geo, { density: 4, minSupportHeight: 0.5 });
    expect(contacts.every((c) => c.reason === 'stabilization')).toBe(true);
  });

  it('returns no contacts for a stable wide squat box', () => {
    const geo = makeWideBoxGeometry(); // 20×5×20, aspect ratio = 5/20 = 0.25
    const contacts = detectStabilization(geo, {
      density: 4,
      minSupportHeight: 0.5,
      aspectRatioThreshold: 3.0,
      instabilityMargin: 0.15,
    });
    expect(contacts.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// detectReinforcements
// ---------------------------------------------------------------------------

describe('detectReinforcements', () => {
  it('detects thin wall geometry as needing reinforcement', async () => {
    const geo = makeThinWallGeometry(0.5); // 0.5mm thick
    const ctx = makeContext(geo);
    const contacts = await detectReinforcements(geo, ctx, {
      thresholdMM: 2.0,
      minSupportHeight: 0.5,
    });
    expect(contacts.length).toBeGreaterThan(0);
  });

  it('does not flag thick wall geometry', async () => {
    const geo = makeThinWallGeometry(10); // 10mm thick — way above threshold
    const ctx = makeContext(geo);
    const contacts = await detectReinforcements(geo, ctx, {
      thresholdMM: 2.0,
      minSupportHeight: 0.5,
    });
    expect(contacts.length).toBe(0);
  });

  it('tags all reinforcement contacts correctly', async () => {
    const geo = makeThinWallGeometry(0.5);
    const ctx = makeContext(geo);
    const contacts = await detectReinforcements(geo, ctx, {
      thresholdMM: 2.0,
      minSupportHeight: 0.5,
    });
    expect(contacts.every((c) => c.reason === 'reinforcement')).toBe(true);
  });

  it('respects minSupportHeight', async () => {
    const geo = makeThinWallGeometry(0.5); // wall from y=0 to y=10
    const ctx = makeContext(geo);
    const contacts = await detectReinforcements(geo, ctx, {
      thresholdMM: 2.0,
      minSupportHeight: 20.0, // above wall height
    });
    expect(contacts.length).toBe(0);
  });
});
