import type { FormatImporter } from '@core/format-registry';
import type { ParsedGeometry } from '@features/model-io/load';

function parseObj(buffer: ArrayBuffer): ParsedGeometry {
  const text = new TextDecoder().decode(buffer);
  const lines = text.split('\n');

  const verts: number[] = [];
  const vnorms: number[] = [];

  const outPos: number[] = [];
  const outNorm: number[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0 || line[0] === '#') continue;

    if (line.startsWith('v ')) {
      const parts = line.split(/\s+/);
      verts.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    } else if (line.startsWith('vn ')) {
      const parts = line.split(/\s+/);
      vnorms.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    } else if (line.startsWith('f ')) {
      const parts = line.split(/\s+/).slice(1);
      // Triangulate n-gon faces as a fan from first vertex
      const indices = parts.map(parseFaceVertex);
      for (let i = 1; i < indices.length - 1; i++) {
        emitTriangle(indices[0], indices[i], indices[i + 1]);
      }
    }
  }

  if (outPos.length === 0) {
    throw new Error('No triangles found in OBJ file');
  }

  const triangleCount = outPos.length / 9;
  return {
    positions: new Float32Array(outPos),
    normals: new Float32Array(outNorm),
    triangleCount,
  };

  function parseFaceVertex(token: string): { vi: number; ni: number } {
    // Formats: v, v/vt, v/vt/vn, v//vn
    const parts = token.split('/');
    const vi = parseInt(parts[0], 10);
    const ni = parts.length >= 3 && parts[2] !== '' ? parseInt(parts[2], 10) : 0;
    return { vi, ni };
  }

  function emitTriangle(
    a: { vi: number; ni: number },
    b: { vi: number; ni: number },
    c: { vi: number; ni: number },
  ): void {
    const ax = vertX(a.vi),
      ay = vertY(a.vi),
      az = vertZ(a.vi);
    const bx = vertX(b.vi),
      by = vertY(b.vi),
      bz = vertZ(b.vi);
    const cx = vertX(c.vi),
      cy = vertY(c.vi),
      cz = vertZ(c.vi);

    outPos.push(ax, ay, az, bx, by, bz, cx, cy, cz);

    if (a.ni !== 0 && b.ni !== 0 && c.ni !== 0) {
      outNorm.push(
        normX(a.ni),
        normY(a.ni),
        normZ(a.ni),
        normX(b.ni),
        normY(b.ni),
        normZ(b.ni),
        normX(c.ni),
        normY(c.ni),
        normZ(c.ni),
      );
    } else {
      // Compute face normal from cross product
      const e1x = bx - ax,
        e1y = by - ay,
        e1z = bz - az;
      const e2x = cx - ax,
        e2y = cy - ay,
        e2z = cz - az;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 0) {
        nx /= len;
        ny /= len;
        nz /= len;
      }
      outNorm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    }
  }

  // OBJ indices are 1-based; negative means relative to end
  function resolveIndex(idx: number, count: number): number {
    return idx > 0 ? idx - 1 : count / 3 + idx;
  }
  function vertX(i: number): number {
    return verts[resolveIndex(i, verts.length) * 3];
  }
  function vertY(i: number): number {
    return verts[resolveIndex(i, verts.length) * 3 + 1];
  }
  function vertZ(i: number): number {
    return verts[resolveIndex(i, verts.length) * 3 + 2];
  }
  function normX(i: number): number {
    return vnorms[resolveIndex(i, vnorms.length) * 3];
  }
  function normY(i: number): number {
    return vnorms[resolveIndex(i, vnorms.length) * 3 + 1];
  }
  function normZ(i: number): number {
    return vnorms[resolveIndex(i, vnorms.length) * 3 + 2];
  }
}

export const objImporter: FormatImporter = {
  id: 'obj',
  name: 'OBJ (Wavefront)',
  extensions: ['obj'],
  async parse(buffer: ArrayBuffer): Promise<ParsedGeometry> {
    return parseObj(buffer);
  },
};
