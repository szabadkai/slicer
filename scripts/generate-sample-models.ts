/**
 * Generate sample STL models suited for SLA/DLP resin printing.
 * Run with: npx tsx scripts/generate-sample-models.ts
 *
 * Generates:
 *   - chess-rook.stl    — miniature figurine with fine detail
 *   - dental-arch.stl   — simplified dental arch with teeth
 *   - resin-test.stl    — calibration model with pillars, holes, overhangs
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'models');

// ---------------------------------------------------------------------------
// STL writer
// ---------------------------------------------------------------------------

function geometryToStlBuffer(geo: THREE.BufferGeometry, label: string): Buffer {
  const ng = geo.toNonIndexed();
  ng.computeVertexNormals();

  const pos = ng.getAttribute('position');
  const nor = ng.getAttribute('normal');
  const triCount = pos.count / 3;
  const buf = Buffer.alloc(84 + triCount * 50);

  buf.write(label.substring(0, 79).padEnd(80, '\0'), 0, 80, 'ascii');
  buf.writeUInt32LE(triCount, 80);

  let off = 84;
  for (let t = 0; t < triCount; t++) {
    const b = t * 3;
    // face normal from first vertex
    buf.writeFloatLE(nor.getX(b), off);
    buf.writeFloatLE(nor.getY(b), off + 4);
    buf.writeFloatLE(nor.getZ(b), off + 8);
    off += 12;
    for (let v = 0; v < 3; v++) {
      buf.writeFloatLE(pos.getX(b + v), off);
      buf.writeFloatLE(pos.getY(b + v), off + 4);
      buf.writeFloatLE(pos.getZ(b + v), off + 8);
      off += 12;
    }
    buf.writeUInt16LE(0, off);
    off += 2;
  }
  return buf;
}

function save(geo: THREE.BufferGeometry, name: string): void {
  const buf = geometryToStlBuffer(geo, name);
  const filePath = join(OUT_DIR, `${name}.stl`);
  writeFileSync(filePath, buf);
  const kb = (buf.byteLength / 1024).toFixed(1);
  const tris = (buf.byteLength - 84) / 50;
  console.warn(`  ${filePath}  (${kb} KB, ${tris} triangles)`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function translated(
  geo: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const g = geo.clone();
  g.translate(x, y, z);
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const result = mergeGeometries(parts);
  if (!result) throw new Error('mergeGeometries failed');
  return result;
}

// ---------------------------------------------------------------------------
// 1. Chess Rook  (≈30 mm tall, classic SLA miniature)
// ---------------------------------------------------------------------------

function makeChessRook(): THREE.BufferGeometry {
  const seg = 48;

  // Profile points for LatheGeometry (x = radius, y = height)
  const profile: THREE.Vector2[] = [
    // base
    new THREE.Vector2(0, 0),
    new THREE.Vector2(7, 0),
    new THREE.Vector2(7.5, 0.5),
    new THREE.Vector2(7.5, 1.5),
    new THREE.Vector2(7, 2),
    new THREE.Vector2(5.5, 2.5),
    // body
    new THREE.Vector2(5, 3.5),
    new THREE.Vector2(4.5, 10),
    new THREE.Vector2(4.2, 18),
    // collar
    new THREE.Vector2(4.5, 19),
    new THREE.Vector2(5.5, 20),
    new THREE.Vector2(5.5, 21),
    // top platform
    new THREE.Vector2(6, 21.5),
    new THREE.Vector2(6, 24),
    // inner wall (going back down for the hollow top)
    new THREE.Vector2(5, 24),
    new THREE.Vector2(5, 22),
    new THREE.Vector2(4, 22),
    new THREE.Vector2(4, 24),
    // close top
    new THREE.Vector2(0, 24),
  ];

  const body = new THREE.LatheGeometry(profile, seg);

  // Crenellations (merlons) on top — 6 rectangular notches cut into the rim
  const merlonCount = 6;
  const merlons: THREE.BufferGeometry[] = [];
  const merlonWidth = 3;
  const merlonDepth = 2;
  const merlonHeight = 4;

  for (let i = 0; i < merlonCount; i++) {
    const angle = (i / merlonCount) * Math.PI * 2;
    const cx = Math.cos(angle) * 5.5;
    const cz = Math.sin(angle) * 5.5;
    const merlon = new THREE.BoxGeometry(merlonWidth, merlonHeight, merlonDepth);
    merlon.rotateY(-angle);
    merlon.translate(cx, 24 + merlonHeight / 2, cz);
    merlons.push(merlon);
  }

  return merge([body, ...merlons]);
}

// ---------------------------------------------------------------------------
// 2. Dental Arch  (≈60 mm wide horseshoe with simplified teeth)
// ---------------------------------------------------------------------------

function makeDentalArch(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Horseshoe arch base — half torus
  const archRadius = 25; // center-to-center radius
  const tubeRadius = 5; // tube cross-section radius
  const archSegments = 64;
  const tubeSegments = 24;

  // Create a half-torus (pi radians)
  const arch = new THREE.TorusGeometry(archRadius, tubeRadius, tubeSegments, archSegments, Math.PI);
  // Rotate so arch opens toward +Y and lies flat
  arch.rotateX(Math.PI / 2);
  arch.rotateZ(Math.PI / 2);
  parts.push(arch);

  // Teeth — simplified as small rounded cylinders along the arch
  const toothCount = 14; // 7 per side
  for (let i = 0; i < toothCount; i++) {
    const t = i / (toothCount - 1); // 0..1
    const angle = t * Math.PI; // spread along arch
    const x = Math.cos(angle) * archRadius;
    const z = Math.sin(angle) * archRadius;

    // Vary tooth size: molars at ends, incisors in middle
    const isMolar = i < 3 || i >= toothCount - 3;
    const w = isMolar ? 4 : 2.5;
    const d = isMolar ? 5 : 3;
    const h = isMolar ? 6 : 7;

    const tooth = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
    // Round corners slightly by applying a small spherical warp
    const toothPos = tooth.getAttribute('position');
    for (let vi = 0; vi < toothPos.count; vi++) {
      const px = toothPos.getX(vi);
      const py = toothPos.getY(vi);
      const pz = toothPos.getZ(vi);
      const bevel = 0.3;
      const ex = Math.max(0, Math.abs(px) - w / 2 + bevel);
      const ey = Math.max(0, Math.abs(py) - h / 2 + bevel);
      const ez = Math.max(0, Math.abs(pz) - d / 2 + bevel);
      const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (dist > 0) {
        const scale = 1 - dist * 0.15;
        toothPos.setXYZ(vi, px * scale, py * scale, pz * scale);
      }
    }

    tooth.rotateY(-angle + Math.PI / 2);
    tooth.translate(x, tubeRadius + h / 2 - 1, z);
    parts.push(tooth);
  }

  // Gum line — slightly wider torus for realistic look
  const gumLine = new THREE.TorusGeometry(archRadius, tubeRadius + 1.5, tubeSegments, archSegments, Math.PI);
  gumLine.rotateX(Math.PI / 2);
  gumLine.rotateZ(Math.PI / 2);
  // Scale vertically to flatten
  gumLine.scale(1, 0.4, 1);
  gumLine.translate(0, tubeRadius * 0.3, 0);
  parts.push(gumLine);

  const result = merge(parts);
  // Center on build plate
  result.computeBoundingBox();
  const bb = result.boundingBox!;
  result.translate(0, -bb.min.y, 0);
  return result;
}

// ---------------------------------------------------------------------------
// 3. Resin Calibration Test  (30×30 mm base with test features)
// ---------------------------------------------------------------------------

function makeResinTest(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const seg = 32;

  // Base plate 40×40×2 mm
  const baseW = 40;
  const baseD = 40;
  const baseH = 2;
  parts.push(translated(new THREE.BoxGeometry(baseW, baseH, baseD), 0, baseH / 2, 0));

  // --- Test pillars of various diameters ---
  const pillarDiameters = [0.5, 0.8, 1.0, 1.5, 2.0, 3.0];
  const pillarHeight = 15;
  for (let i = 0; i < pillarDiameters.length; i++) {
    const d = pillarDiameters[i];
    const x = -15 + i * 6;
    const z = -12;
    const pillar = new THREE.CylinderGeometry(d / 2, d / 2, pillarHeight, seg);
    pillar.translate(x, baseH + pillarHeight / 2, z);
    parts.push(pillar);

    // Label plate behind each pillar
    const label = new THREE.BoxGeometry(4, 1, 0.5);
    label.translate(x, baseH + pillarHeight + 1, z - 2);
    parts.push(label);
  }

  // --- Test holes of various diameters (negative space shown as thin rings) ---
  const holeDiameters = [0.5, 0.8, 1.0, 1.5, 2.0, 3.0];
  const ringHeight = 5;
  for (let i = 0; i < holeDiameters.length; i++) {
    const d = holeDiameters[i];
    const x = -15 + i * 6;
    const z = 0;
    // Outer cylinder
    const outer = new THREE.CylinderGeometry(d / 2 + 1, d / 2 + 1, ringHeight, seg);
    outer.translate(x, baseH + ringHeight / 2, z);
    parts.push(outer);
    // Inner hole (smaller cylinder to visually indicate the hole feature)
    // In a real test print the hole would be negative space — here we just show the ring
  }

  // --- Overhang test: stepped block ---
  const overhangBlock = new THREE.BoxGeometry(8, 10, 8);
  overhangBlock.translate(14, baseH + 5, 0);
  parts.push(overhangBlock);

  // Overhang shelves at increasing angles
  const angles = [20, 30, 45, 60];
  for (let i = 0; i < angles.length; i++) {
    const shelf = new THREE.BoxGeometry(8, 0.8, 3);
    const rad = (angles[i] * Math.PI) / 180;
    shelf.rotateZ(rad);
    shelf.translate(14 - 4 - Math.cos(rad) * 2, baseH + 2 + i * 2.5, 0);
    parts.push(shelf);
  }

  // --- Fine detail ridges ---
  const ridgeHeights = [0.1, 0.2, 0.3, 0.5, 0.8];
  for (let i = 0; i < ridgeHeights.length; i++) {
    const h = ridgeHeights[i];
    const ridge = new THREE.BoxGeometry(15, h, 1);
    ridge.translate(-5, baseH + h / 2, 10 + i * 2.5);
    parts.push(ridge);
  }

  // --- Cone for point detail ---
  const cone = new THREE.ConeGeometry(3, 10, seg);
  cone.translate(-14, baseH + 5, 10);
  parts.push(cone);

  // --- Small sphere for surface quality ---
  const sphere = new THREE.SphereGeometry(3, seg, seg / 2);
  sphere.translate(-14, baseH + 3, 0);
  parts.push(sphere);

  return merge(parts);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
console.warn('Generating SLA sample models...\n');

save(makeChessRook(), 'chess-rook');
save(makeDentalArch(), 'dental-arch');
save(makeResinTest(), 'resin-test');

console.warn('\nDone.');
