import { describe, expect, it } from 'vitest';
import { buildBranchSupportStructure } from './manual-pillar';

function vec3(
  x: number,
  y: number,
  z: number,
): {
  x: number;
  y: number;
  z: number;
  clone(): ReturnType<typeof vec3>;
  normalize(): ReturnType<typeof vec3>;
} {
  return {
    x,
    y,
    z,
    clone() {
      return vec3(x, y, z);
    },
    normalize() {
      const length = Math.hypot(this.x, this.y, this.z);
      if (length > 0) {
        this.x /= length;
        this.y /= length;
        this.z /= length;
      }
      return this;
    },
  };
}

describe('buildBranchSupportStructure', () => {
  it('returns null for fewer than two touchpoints', () => {
    const result = buildBranchSupportStructure([
      {
        position: vec3(0, 5, 0),
        normal: vec3(0, -1, 0),
      },
    ]);

    expect(result).toBeNull();
  });

  it('builds a branching graph from multiple touchpoints', () => {
    const result = buildBranchSupportStructure(
      [
        {
          position: vec3(-1, 6, 0),
          normal: vec3(0, -1, 0),
        },
        {
          position: vec3(1, 6, 0),
          normal: vec3(0, -1, 0),
        },
      ],
      { tipDiameterMM: 0.4, shaftDiameterMM: 0.8 },
    );

    expect(result).not.toBeNull();
    expect(result!.kind).toBe('branching');
    expect(result!.origin).toBe('manual');
    expect(result!.touchpoints).toHaveLength(2);
    expect(result!.nodes.filter((node) => node.kind === 'tip')).toHaveLength(2);
    expect(result!.nodes.find((node) => node.kind === 'branch')).toBeDefined();
    expect(result!.nodes.find((node) => node.kind === 'base')).toBeDefined();
    expect(result!.edges).toHaveLength(3);
  });

  it('places the shared branch below the selected tips and the base on the plate', () => {
    const result = buildBranchSupportStructure(
      [
        {
          position: vec3(0, 8, 0),
          normal: vec3(0, -1, 0),
        },
        {
          position: vec3(4, 10, 2),
          normal: vec3(0, -1, 0),
        },
      ],
      { shaftDiameterMM: 1 },
    );

    const branch = result!.nodes.find((node) => node.kind === 'branch')!;
    const base = result!.nodes.find((node) => node.kind === 'base')!;
    expect(branch.position.y).toBeLessThan(8);
    expect(base.position.y).toBe(0);
    expect(base.position.x).toBeCloseTo(2);
    expect(base.position.z).toBeCloseTo(1);
  });
});
