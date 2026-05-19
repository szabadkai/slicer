import { describe, it, expect } from 'vitest';
import { objImporter } from './obj-importer';

function encode(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe('objImporter', () => {
  it('has correct metadata', () => {
    expect(objImporter.id).toBe('obj');
    expect(objImporter.extensions).toEqual(['obj']);
  });

  it('parses a single triangle with vertices only', async () => {
    const obj = `
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`;
    const result = await objImporter.parse(encode(obj), 'test.obj');
    expect(result.triangleCount).toBe(1);
    expect(result.positions.length).toBe(9);
    expect(result.normals.length).toBe(9);
    // Check vertex positions
    expect(result.positions[0]).toBe(0); // v1.x
    expect(result.positions[3]).toBe(1); // v2.x
    expect(result.positions[7]).toBe(1); // v3.y
  });

  it('parses faces with vertex//normal format', async () => {
    const obj = `
v 0 0 0
v 1 0 0
v 0 1 0
vn 0 0 1
f 1//1 2//1 3//1
`;
    const result = await objImporter.parse(encode(obj), 'test.obj');
    expect(result.triangleCount).toBe(1);
    // All normals should be (0,0,1)
    for (let i = 0; i < 9; i += 3) {
      expect(result.normals[i]).toBe(0);
      expect(result.normals[i + 1]).toBe(0);
      expect(result.normals[i + 2]).toBe(1);
    }
  });

  it('triangulates a quad face as fan', async () => {
    const obj = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3 4
`;
    const result = await objImporter.parse(encode(obj), 'test.obj');
    expect(result.triangleCount).toBe(2);
    expect(result.positions.length).toBe(18);
  });

  it('handles v/vt/vn face format', async () => {
    const obj = `
v 0 0 0
v 1 0 0
v 0 1 0
vt 0 0
vn 0 0 1
f 1/1/1 2/1/1 3/1/1
`;
    const result = await objImporter.parse(encode(obj), 'test.obj');
    expect(result.triangleCount).toBe(1);
  });

  it('computes face normals when vertex normals absent', async () => {
    const obj = `
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`;
    const result = await objImporter.parse(encode(obj), 'test.obj');
    // Face in XY plane, normal should point in +Z
    expect(result.normals[2]).toBeCloseTo(1, 5);
  });

  it('throws on empty file', async () => {
    await expect(objImporter.parse(encode(''), 'empty.obj')).rejects.toThrow('No triangles');
  });

  it('ignores comments and blank lines', async () => {
    const obj = `
# This is a comment
v 0 0 0

v 1 0 0
# Another comment
v 0 1 0
f 1 2 3
`;
    const result = await objImporter.parse(encode(obj), 'test.obj');
    expect(result.triangleCount).toBe(1);
  });

  it('handles negative (relative) indices', async () => {
    const obj = `
v 0 0 0
v 1 0 0
v 0 1 0
f -3 -2 -1
`;
    const result = await objImporter.parse(encode(obj), 'test.obj');
    expect(result.triangleCount).toBe(1);
    expect(result.positions[0]).toBe(0);
    expect(result.positions[3]).toBe(1);
  });
});
