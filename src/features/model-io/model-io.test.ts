import { describe, it, expect } from 'vitest';
import { parseStl } from './load';
import { makeBinaryStl, makeObj, buildManifest, estimatePrintTime } from './export';
import type { Triangle } from './export';
import type { SliceParams } from '@core/types';

function makeTestTriangle(): Triangle {
  return {
    normal: { x: 0, y: 0, z: 1 },
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    ],
  };
}

function createBinaryStlBuffer(triangles: Triangle[]): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);

  let offset = 84;
  for (const { normal, vertices } of triangles) {
    view.setFloat32(offset, normal.x, true);
    view.setFloat32(offset + 4, normal.y, true);
    view.setFloat32(offset + 8, normal.z, true);
    offset += 12;
    for (const v of vertices) {
      view.setFloat32(offset, v.x, true);
      view.setFloat32(offset + 4, v.y, true);
      view.setFloat32(offset + 8, v.z, true);
      offset += 12;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }

  return buffer;
}

describe('STL parser', () => {
  it('parses binary STL correctly', () => {
    const tri = makeTestTriangle();
    const buffer = createBinaryStlBuffer([tri]);

    const result = parseStl(buffer);

    expect(result.triangleCount).toBe(1);
    expect(result.positions[0]).toBe(0); // vertex 0 x
    expect(result.positions[3]).toBe(1); // vertex 1 x
    expect(result.positions[7]).toBe(1); // vertex 2 y
    expect(result.normals[2]).toBe(1); // normal z
  });

  it('parses ASCII STL correctly', () => {
    const ascii = `solid test
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid test`;
    const buffer = new TextEncoder().encode(ascii).buffer;

    const result = parseStl(buffer);

    expect(result.triangleCount).toBe(1);
    expect(result.positions[3]).toBe(1);
    expect(result.normals[2]).toBe(1);
  });

  it('throws on malformed file', () => {
    const buffer = new TextEncoder().encode('not a valid file').buffer;
    expect(() => parseStl(buffer)).toThrow();
  });

  it('throws on truncated binary STL', () => {
    const buffer = new ArrayBuffer(84);
    const view = new DataView(buffer);
    view.setUint32(80, 100, true); // claims 100 triangles but has no data

    expect(() => parseStl(buffer)).toThrow(/truncated/i);
  });
});

describe('STL export', () => {
  it('produces valid binary STL blob', () => {
    const tri = makeTestTriangle();
    const blob = makeBinaryStl([tri], 'test');

    expect(blob.size).toBe(84 + 50);
    expect(blob.type).toBe('model/stl');
  });

  it('produces valid OBJ blob', () => {
    const tri = makeTestTriangle();
    const blob = makeObj([tri], 'test');

    expect(blob.type).toBe('text/plain');
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('manifest builder', () => {
  it('builds correct metadata', () => {
    const params: SliceParams = {
      layerHeightMM: 0.05,
      normalExposureS: 2.5,
      bottomLayers: 6,
      bottomExposureS: 30,
      liftHeightMM: 6,
      liftSpeedMMs: 3,
    };
    const printer = {
      name: 'Test Printer',
      resolutionX: 2560,
      resolutionY: 1620,
      buildWidthMM: 130,
      buildDepthMM: 80,
      buildHeightMM: 165,
    };

    const manifest = buildManifest(100, printer, params);

    expect(manifest.layerCount).toBe(100);
    expect(manifest.printer).toBe('Test Printer');
    expect(manifest.layerHeightMM).toBe(0.05);
  });
});

describe('print time estimate', () => {
  it('calculates time for simple scenario', () => {
    const params: SliceParams = {
      layerHeightMM: 0.05,
      normalExposureS: 2.5,
      bottomLayers: 6,
      bottomExposureS: 30,
      liftHeightMM: 6,
      liftSpeedMMs: 3,
    };

    const est = estimatePrintTime(100, params);

    expect(est.totalSeconds).toBeGreaterThan(0);
    expect(est.hours).toBeGreaterThanOrEqual(0);
    expect(est.minutes).toBeGreaterThanOrEqual(0);
    // Sanity: 100 layers at ~7.5s per layer ≈ ~750s ≈ ~12 min
    expect(est.totalSeconds).toBeLessThan(3600);
  });

  it('handles zero layers', () => {
    const params: SliceParams = {
      layerHeightMM: 0.05,
      normalExposureS: 2.5,
      bottomLayers: 6,
      bottomExposureS: 30,
      liftHeightMM: 6,
      liftSpeedMMs: 3,
    };

    const est = estimatePrintTime(0, params);
    expect(est.totalSeconds).toBe(0);
  });
});
