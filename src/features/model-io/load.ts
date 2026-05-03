/**
 * Binary and ASCII STL parser.
 * Returns raw triangle data (positions + normals) without THREE.js dependency.
 */

export interface ParsedGeometry {
  positions: Float32Array;
  normals: Float32Array;
  triangleCount: number;
}

export function parseStl(buffer: ArrayBuffer): ParsedGeometry {
  if (isBinaryStl(buffer)) {
    return parseBinaryStl(buffer);
  }
  return parseAsciiStl(buffer);
}

function isBinaryStl(buffer: ArrayBuffer): boolean {
  // ASCII STL starts with "solid". Binary has an 80-byte header + 4-byte triangle count.
  // However some binary files start with "solid" in the header, so also check size.
  const view = new DataView(buffer);
  if (buffer.byteLength < 84) return false;

  const triCount = view.getUint32(80, true);
  const expectedSize = 84 + triCount * 50;

  // If file size matches binary format, treat as binary
  if (buffer.byteLength === expectedSize) return true;

  // Check if it looks like ASCII
  const header = new Uint8Array(buffer, 0, Math.min(80, buffer.byteLength));
  const headerStr = String.fromCharCode(...header).trim();
  if (headerStr.startsWith('solid') && buffer.byteLength !== expectedSize) {
    return false;
  }

  return true;
}

function parseBinaryStl(buffer: ArrayBuffer): ParsedGeometry {
  const view = new DataView(buffer);
  const triangleCount = view.getUint32(80, true);

  if (buffer.byteLength < 84 + triangleCount * 50) {
    throw new Error(`STL file truncated: expected ${84 + triangleCount * 50} bytes, got ${buffer.byteLength}`);
  }

  const positions = new Float32Array(triangleCount * 9);
  const normals = new Float32Array(triangleCount * 9);

  let offset = 84;
  for (let i = 0; i < triangleCount; i++) {
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    offset += 12;

    for (let v = 0; v < 3; v++) {
      const baseIdx = i * 9 + v * 3;
      positions[baseIdx] = view.getFloat32(offset, true);
      positions[baseIdx + 1] = view.getFloat32(offset + 4, true);
      positions[baseIdx + 2] = view.getFloat32(offset + 8, true);
      normals[baseIdx] = nx;
      normals[baseIdx + 1] = ny;
      normals[baseIdx + 2] = nz;
      offset += 12;
    }

    offset += 2; // attribute byte count
  }

  return { positions, normals, triangleCount };
}

function parseAsciiStl(buffer: ArrayBuffer): ParsedGeometry {
  const text = new TextDecoder().decode(buffer);
  const facetRegex = /facet\s+normal\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/g;
  const vertexRegex = /vertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/g;

  const posArr: number[] = [];
  const normArr: number[] = [];

  let facetMatch = facetRegex.exec(text);
  while (facetMatch) {
    const nx = parseFloat(facetMatch[1]);
    const ny = parseFloat(facetMatch[2]);
    const nz = parseFloat(facetMatch[3]);

    for (let v = 0; v < 3; v++) {
      const vertexMatch = vertexRegex.exec(text);
      if (!vertexMatch) {
        throw new Error('Malformed ASCII STL: expected vertex after facet normal');
      }
      posArr.push(parseFloat(vertexMatch[1]), parseFloat(vertexMatch[2]), parseFloat(vertexMatch[3]));
      normArr.push(nx, ny, nz);
    }

    facetMatch = facetRegex.exec(text);
  }

  if (posArr.length === 0) {
    throw new Error('No triangles found in STL file');
  }

  const triangleCount = posArr.length / 9;
  return {
    positions: new Float32Array(posArr),
    normals: new Float32Array(normArr),
    triangleCount,
  };
}
