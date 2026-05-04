import * as THREE from 'three';

export interface SplitResult {
  part1: THREE.BufferGeometry;   // above the plane
  part2: THREE.BufferGeometry;   // below the plane
  capArea: number;               // mm²
}

interface Vertex { x: number; y: number; z: number }

/**
 * Split a mesh along an axis-aligned plane.
 *
 * @param geometry - input BufferGeometry (will be converted to non-indexed)
 * @param axis - 'x' | 'y' | 'z'
 * @param positionMM - world-space position of the cutting plane along the axis
 * @param addPins - whether to add alignment pin stubs to the cut faces
 * @param pinCount - number of pins (default 2)
 * @param pinDiameterMM - pin diameter in mm (default 3)
 */
export function splitMesh(
  geometry: THREE.BufferGeometry,
  axis: 'x' | 'y' | 'z',
  positionMM: number,
  addPins = false,
  pinCount = 2,
  pinDiameterMM = 3,
): SplitResult {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const triCount = pos.count / 3;

  const above: number[] = []; // flat array of vertex positions (x,y,z per vertex)
  const below: number[] = [];
  const cutEdge: { a: Vertex; b: Vertex }[] = []; // edges along the cut plane

  const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;

  function getV(i: number): Vertex {
    return { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
  }
  function vToArr(v: Vertex): number[] { return [v.x, v.y, v.z]; }
  function sign(v: Vertex): number { return [v.x, v.y, v.z][axisIdx] - positionMM; }

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3, i1 = t * 3 + 1, i2 = t * 3 + 2;
    const v = [getV(i0), getV(i1), getV(i2)];
    const s = v.map(sign);
    const aboveMask = s.map((x) => x >= 0);

    if (aboveMask.every(Boolean)) {
      above.push(...vToArr(v[0]), ...vToArr(v[1]), ...vToArr(v[2]));
    } else if (aboveMask.every((b) => !b)) {
      below.push(...vToArr(v[0]), ...vToArr(v[1]), ...vToArr(v[2]));
    } else {
      // Mixed — clip triangle at the plane
      clipTriangle(v, s, above, below, cutEdge);
    }
  }

  // Cap the cut face by fan-triangulating the cut edge loop
  const { cap1, cap2, capArea } = buildCap(cutEdge, axis, positionMM);
  above.push(...cap1);
  below.push(...cap2);

  // Optionally add pin stubs to the cut faces
  if (addPins && pinCount > 0) {
    addPinStubs(cutEdge, axis, positionMM, above, below, pinCount, pinDiameterMM);
  }

  return {
    part1: buildGeo(above),
    part2: buildGeo(below),
    capArea,
  };
}

function clipTriangle(
  v: Vertex[],
  s: number[],
  above: number[],
  below: number[],
  cutEdge: { a: Vertex; b: Vertex }[],
): void {
  const a: Vertex[] = [];
  const b: Vertex[] = [];

  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const vi = v[i], vj = v[j];
    const si = s[i], sj = s[j];
    if (si >= 0) a.push(vi); else b.push(vi);
    if ((si >= 0) !== (sj >= 0)) {
      // Edge crosses plane
      const t = si / (si - sj);
      const cut = { x: vi.x + (vj.x - vi.x) * t, y: vi.y + (vj.y - vi.y) * t, z: vi.z + (vj.z - vi.z) * t };
      a.push(cut); b.push(cut);
    }
  }

  // Fan-triangulate polygon 'a' and 'b'
  for (let i = 1; i + 1 < a.length; i++) {
    above.push(...[a[0], a[i], a[i + 1]].flatMap((vv) => [vv.x, vv.y, vv.z]));
  }
  for (let i = 1; i + 1 < b.length; i++) {
    below.push(...[b[0], b[i], b[i + 1]].flatMap((vv) => [vv.x, vv.y, vv.z]));
  }

  // Collect cut edge segments (intersections between a and b sides)
  const cutPoints: Vertex[] = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const si = s[i], sj = s[j];
    if ((si >= 0) !== (sj >= 0)) {
      const t = si / (si - sj);
      cutPoints.push({ x: v[i].x + (v[j].x - v[i].x) * t, y: v[i].y + (v[j].y - v[i].y) * t, z: v[i].z + (v[j].z - v[i].z) * t });
    }
  }
  if (cutPoints.length === 2) {
    cutEdge.push({ a: cutPoints[0], b: cutPoints[1] });
  }
}

function buildCap(
  cutEdge: { a: Vertex; b: Vertex }[],
  axis: 'x' | 'y' | 'z',
  _positionMM: number,
): { cap1: number[]; cap2: number[]; capArea: number } {
  if (cutEdge.length === 0) return { cap1: [], cap2: [], capArea: 0 };

  // Collect unique cut points
  const pts = cutEdge.flatMap((e) => [e.a, e.b]);

  // Compute centroid
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;

  // Sort points around centroid in the cut plane
  const axisOther = axis === 'x' ? ['y', 'z'] : axis === 'y' ? ['x', 'z'] : ['x', 'y'];
  type K = 'x' | 'y' | 'z';
  const a0 = axisOther[0] as K, a1 = axisOther[1] as K;
  const sorted = [...pts].sort((p, q) => {
    const ap = Math.atan2(p[a0] - cy, p[a1] - cz);
    const aq = Math.atan2(q[a0] - cy, q[a1] - cz);
    return ap - aq;
  });

  const cap1: number[] = []; const cap2: number[] = [];
  let area = 0;

  for (let i = 0; i < sorted.length; i++) {
    const p1 = sorted[i], p2 = sorted[(i + 1) % sorted.length];
    // Fan triangles from centroid
    cap1.push(cx, cy, cz, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    cap2.push(cx, cy, cz, p2.x, p2.y, p2.z, p1.x, p1.y, p1.z); // flipped winding

    // Accumulate area using cross product
    const ax2 = p1.x - cx, ay = p1.y - cy, az = p1.z - cz;
    const bx = p2.x - cx, by = p2.y - cy, bz = p2.z - cz;
    area += 0.5 * Math.sqrt(
      (ay * bz - az * by) ** 2 + (az * bx - ax2 * bz) ** 2 + (ax2 * by - ay * bx) ** 2,
    );
  }

  return { cap1, cap2, capArea: area };
}

function addPinStubs(
  cutEdge: { a: Vertex; b: Vertex }[],
  axis: 'x' | 'y' | 'z',
  positionMM: number,
  above: number[],
  _below: number[],
  count: number,
  diameterMM: number,
): void {
  if (cutEdge.length === 0) return;

  const pts = cutEdge.flatMap((e) => [e.a, e.b]);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;

  const r = diameterMM / 2;
  const pinH = diameterMM * 1.5; // pin extends 1.5× its diameter
  const segments = 12;

  // Distribute pins evenly around centroid
  for (let p = 0; p < count; p++) {
    const angle = (p / count) * Math.PI * 2;
    const spread = Math.min(diameterMM * 4, 10); // spread pins apart
    const px = cx + Math.cos(angle) * spread;
    const pz = cz + Math.sin(angle) * spread;
    const py = cy;

    // Build a small cylinder stub (above only)
    const axisDir = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    const [dx, dy, dz] = axisDir;

    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * Math.PI * 2;
      const a1 = ((s + 1) / segments) * Math.PI * 2;

      // Choose radial axes perpendicular to axisDir
      const rx = dy, ry = dz, rz = dx; // cyclic shift
      const x0 = r * Math.cos(a0) * rx, y0 = r * Math.cos(a0) * ry, z0 = r * Math.cos(a0) * rz;
      const x1 = r * Math.cos(a1) * rx, y1 = r * Math.cos(a1) * ry, z1 = r * Math.cos(a1) * rz;
      const xn = r * Math.sin(a0) * rz, yn = r * Math.sin(a0) * rx, zn = r * Math.sin(a0) * ry;
      const xn2 = r * Math.sin(a1) * rz, yn2 = r * Math.sin(a1) * rx, zn2 = r * Math.sin(a1) * ry;

      // Two triangles forming a quad on the cylinder side
      const bx = px + x0 + xn, by = py + y0 + yn, bz = pz + z0 + zn;
      const cx2 = px + x1 + xn2, cy2 = py + y1 + yn2, cz2 = pz + z1 + zn2;
      const topOffset = dx * pinH, tpy = dy * pinH, tpz = dz * pinH;
      above.push(
        bx, by, bz,
        cx2, cy2, cz2,
        bx + topOffset, by + tpy, bz + tpz,
        cx2, cy2, cz2,
        cx2 + topOffset, cy2 + tpy, cz2 + tpz,
        bx + topOffset, by + tpy, bz + tpz,
      );
      void positionMM;
    }
  }
}

function buildGeo(positions: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.computeVertexNormals();
  return geo;
}
