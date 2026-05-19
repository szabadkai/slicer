import type { FormatImporter } from '@core/format-registry';
import type { ParsedGeometry } from '@features/model-io/load';

interface Vertex {
  x: number;
  y: number;
  z: number;
}
interface Face {
  v1: number;
  v2: number;
  v3: number;
}

function parseModelXml(xml: string): { vertices: Vertex[]; faces: Face[] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  const ns = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
  const vertices: Vertex[] = [];
  const faces: Face[] = [];

  const vertexEls = doc.getElementsByTagNameNS(ns, 'vertex');
  // Fall back to non-namespaced if the namespace query finds nothing
  const vEls = vertexEls.length > 0 ? vertexEls : doc.getElementsByTagName('vertex');
  for (let i = 0; i < vEls.length; i++) {
    const el = vEls[i];
    vertices.push({
      x: parseFloat(el.getAttribute('x') ?? '0'),
      y: parseFloat(el.getAttribute('y') ?? '0'),
      z: parseFloat(el.getAttribute('z') ?? '0'),
    });
  }

  const triEls = doc.getElementsByTagNameNS(ns, 'triangle');
  const tEls = triEls.length > 0 ? triEls : doc.getElementsByTagName('triangle');
  for (let i = 0; i < tEls.length; i++) {
    const el = tEls[i];
    faces.push({
      v1: parseInt(el.getAttribute('v1') ?? '0', 10),
      v2: parseInt(el.getAttribute('v2') ?? '0', 10),
      v3: parseInt(el.getAttribute('v3') ?? '0', 10),
    });
  }

  return { vertices, faces };
}

function buildGeometry(vertices: Vertex[], faces: Face[]): ParsedGeometry {
  const triangleCount = faces.length;
  const positions = new Float32Array(triangleCount * 9);
  const normals = new Float32Array(triangleCount * 9);

  for (let i = 0; i < triangleCount; i++) {
    const { v1, v2, v3 } = faces[i];
    const a = vertices[v1];
    const b = vertices[v2];
    const c = vertices[v3];

    const off = i * 9;
    positions[off] = a.x;
    positions[off + 1] = a.y;
    positions[off + 2] = a.z;
    positions[off + 3] = b.x;
    positions[off + 4] = b.y;
    positions[off + 5] = b.z;
    positions[off + 6] = c.x;
    positions[off + 7] = c.y;
    positions[off + 8] = c.z;

    // Compute face normal
    const e1x = b.x - a.x,
      e1y = b.y - a.y,
      e1z = b.z - a.z;
    const e2x = c.x - a.x,
      e2y = c.y - a.y,
      e2z = c.z - a.z;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }

    normals[off] = nx;
    normals[off + 1] = ny;
    normals[off + 2] = nz;
    normals[off + 3] = nx;
    normals[off + 4] = ny;
    normals[off + 5] = nz;
    normals[off + 6] = nx;
    normals[off + 7] = ny;
    normals[off + 8] = nz;
  }

  return { positions, normals, triangleCount };
}

async function parse3mf(buffer: ArrayBuffer): Promise<ParsedGeometry> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);

  // 3MF spec: model file is at 3D/3dmodel.model
  // Some exporters use different casing, so search case-insensitively
  let modelXml: string | null = null;
  for (const path of Object.keys(zip.files)) {
    if (path.toLowerCase() === '3d/3dmodel.model') {
      modelXml = await zip.files[path].async('string');
      break;
    }
  }
  if (!modelXml) {
    throw new Error('Invalid 3MF file: missing 3D/3dmodel.model');
  }

  const { vertices, faces } = parseModelXml(modelXml);
  if (vertices.length === 0 || faces.length === 0) {
    throw new Error('3MF file contains no mesh data');
  }

  return buildGeometry(vertices, faces);
}

export const threemfImporter: FormatImporter = {
  id: '3mf',
  name: '3MF',
  extensions: ['3mf'],
  async parse(buffer: ArrayBuffer): Promise<ParsedGeometry> {
    return parse3mf(buffer);
  },
};
