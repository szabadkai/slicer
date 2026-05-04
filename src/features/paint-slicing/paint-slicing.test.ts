import { describe, expect, it } from 'vitest';
import {
  analyzePaintSegments,
  interpolateUV,
  materialAtToolpathPoint,
  samplePaintTexture,
  segmentToolpathByPaint,
  type PaintLayer,
  type PaintTexture,
  type ToolpathPoint,
} from './ops';

function makeTexture(): PaintTexture {
  return {
    width: 4,
    height: 1,
    materialIds: new Uint8Array([0, 1, 1, 2]),
  };
}

function makeLayer(texture: PaintTexture = makeTexture()): PaintLayer {
  return {
    objectId: 'object-1',
    texture,
    materials: [
      { id: 0, name: 'Base', color: '#ffffff' },
      { id: 1, name: 'Red', color: '#ff0000' },
      { id: 2, name: 'Blue', color: '#0000ff' },
    ],
  };
}

function point(x: number, u: number): ToolpathPoint {
  return { x, y: 0, uv: { u, v: 0.5 } };
}

describe('paint slicing', () => {
  it('samples material ids from UV texture space', () => {
    const texture = makeTexture();

    expect(samplePaintTexture(texture, { u: 0, v: 0.5 })).toBe(0);
    expect(samplePaintTexture(texture, { u: 0.3, v: 0.5 })).toBe(1);
    expect(samplePaintTexture(texture, { u: 0.99, v: 0.5 })).toBe(2);
  });

  it('uses alpha threshold to keep transparent paint as base material', () => {
    const texture: PaintTexture = {
      width: 2,
      height: 1,
      materialIds: new Uint8Array([1, 2]),
      alpha: new Uint8Array([255, 20]),
    };

    expect(samplePaintTexture(texture, { u: 0.1, v: 0.5 }, 128)).toBe(1);
    expect(samplePaintTexture(texture, { u: 0.9, v: 0.5 }, 128)).toBe(0);
  });

  it('interpolates UVs from barycentric triangle data', () => {
    const uv = interpolateUV(
      { a: 0.25, b: 0.25, c: 0.5 },
      {
        a: { u: 0, v: 0 },
        b: { u: 1, v: 0 },
        c: { u: 0, v: 1 },
      },
    );

    expect(uv.u).toBeCloseTo(0.25);
    expect(uv.v).toBeCloseTo(0.5);
  });

  it('resolves material from toolpath barycentric UV data', () => {
    const materialId = materialAtToolpathPoint(
      {
        x: 0,
        y: 0,
        triangleUVs: {
          a: { u: 0, v: 0.5 },
          b: { u: 1, v: 0.5 },
          c: { u: 1, v: 0.5 },
        },
        barycentric: { a: 0.1, b: 0.8, c: 0.1 },
      },
      makeLayer(),
    );

    expect(materialId).toBe(2);
  });

  it('segments a wall path where paint material changes', () => {
    const segments = segmentToolpathByPaint(
      [point(0, 0.1), point(1, 0.3), point(2, 0.6), point(3, 0.9)],
      makeLayer(),
      { minSegmentLengthMM: 0.1, nozzleWidthMM: 0.4 },
    );

    expect(segments).toEqual([
      { materialId: 1, startIndex: 0, endIndex: 2, lengthMM: 2 },
      { materialId: 2, startIndex: 3, endIndex: 3, lengthMM: 1 },
    ]);
  });

  it('merges paint islands below nozzle resolution', () => {
    const texture: PaintTexture = {
      width: 5,
      height: 1,
      materialIds: new Uint8Array([0, 1, 0, 0, 0]),
    };

    const segments = segmentToolpathByPaint(
      [point(0, 0.1), point(0.2, 0.25), point(0.4, 0.45), point(1.4, 0.7)],
      makeLayer(texture),
      { minSegmentLengthMM: 0.2, nozzleWidthMM: 0.4 },
    );

    expect(segments).toEqual([
      { materialId: 0, startIndex: 0, endIndex: 3, lengthMM: 1.4 },
    ]);
  });

  it('reports material changes and painted length for printability preview', () => {
    const segments = segmentToolpathByPaint(
      [point(0, 0.1), point(1, 0.3), point(2, 0.6), point(3, 0.9)],
      makeLayer(),
      { minSegmentLengthMM: 0.1, nozzleWidthMM: 0.4 },
    );
    const report = analyzePaintSegments(segments, { minSegmentLengthMM: 0.1, nozzleWidthMM: 0.4 });

    expect(report.segmentCount).toBe(2);
    expect(report.materialChangeCount).toBe(1);
    expect(report.paintedLengthMM).toBeCloseTo(3);
    expect(report.totalLengthMM).toBeCloseTo(3);
    expect(report.materialLengthsMM.get(1)).toBeCloseTo(2);
  });
});
