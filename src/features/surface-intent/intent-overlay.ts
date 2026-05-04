// ─── Intent overlay visualization ───────────────────────────
// Builds a color-coded mesh overlay showing per-face intent assignments.
// Follows the same pattern as buildSupportHeatmapGeometry in viewer.ts.

import * as THREE from 'three';
import { type IntentBuffer, decodeIntent, INTENT_COLORS } from './types';

const UNASSIGNED_COLOR = new THREE.Color(0x000000); // not used — unassigned faces are skipped
const OVERLAY_OFFSET = 0.05; // normal offset to prevent z-fighting

/**
 * Build a vertex-colored overlay geometry for faces with intent assignments.
 * Only includes triangles that have an intent assigned (byte !== 0).
 *
 * @param sourceGeometry The model's BufferGeometry (should be non-indexed, or will be converted)
 * @param intentBuffer Per-triangle intent buffer (one byte per triangle)
 * @param worldMatrix The model's matrixWorld for transforming positions
 * @returns Overlay BufferGeometry with vertex colors, or null if no intents assigned
 */
export function buildIntentOverlayGeometry(
  sourceGeometry: THREE.BufferGeometry,
  intentBuffer: IntentBuffer,
  worldMatrix: THREE.Matrix4,
): THREE.BufferGeometry | null {
  const geo = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone();
  geo.applyMatrix4(worldMatrix);

  const pos = geo.attributes.position;
  if (!pos) {
    geo.dispose();
    return null;
  }

  const triangleCount = Math.floor(pos.count / 3);
  const positions: number[] = [];
  const colors: number[] = [];

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const normal = new THREE.Vector3();

  // Pre-convert intent colors to THREE.Color instances
  const colorCache = new Map<number, THREE.Color>();
  for (const [intent, hex] of Object.entries(INTENT_COLORS)) {
    colorCache.set(hex, new THREE.Color(hex));
    void intent; // suppress unused warning
  }

  for (let tri = 0; tri < triangleCount; tri++) {
    if (tri >= intentBuffer.length) break;
    if (intentBuffer[tri] === 0) continue;

    const decoded = decodeIntent(intentBuffer[tri]);
    if (!decoded) continue;

    const hex = INTENT_COLORS[decoded.intent];
    const color = colorCache.get(hex) ?? UNASSIGNED_COLOR;

    // Read triangle vertices
    const i = tri * 3;
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);

    // Compute face normal for offset
    edge1.subVectors(b, a);
    edge2.subVectors(c, a);
    normal.crossVectors(edge1, edge2);
    const len = normal.length();
    if (len < 1e-8) continue;
    normal.divideScalar(len);

    // Offset vertices along normal to prevent z-fighting
    const ox = normal.x * OVERLAY_OFFSET;
    const oy = normal.y * OVERLAY_OFFSET;
    const oz = normal.z * OVERLAY_OFFSET;

    // Priority modulates opacity via alpha vertex attribute (handled by material)
    // For now, all priorities use the same color; we could vary brightness later
    for (const v of [a, b, c]) {
      positions.push(v.x + ox, v.y + oy, v.z + oz);
      colors.push(color.r, color.g, color.b);
    }
  }

  geo.dispose();

  if (positions.length === 0) return null;

  const overlay = new THREE.BufferGeometry();
  overlay.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  overlay.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  overlay.computeBoundingSphere();
  return overlay;
}

/** Create the semi-transparent material for the intent overlay */
export function createIntentOverlayMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}
