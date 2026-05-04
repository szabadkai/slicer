import { describe, it, expect, beforeEach } from 'vitest';
import {
  supportsByModel,
  setSupports,
  clearSupports,
  toggleSupportVisibility,
  getSupports,
} from './store';
import type { GenerateResult } from './build';

const mockResult: GenerateResult = {
  pillars: [
    {
      contact: { x: 0, y: 5, z: 0, triangleIndex: 0 },
      path: [
        { x: 0, y: 5, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
      routed: false,
    },
  ],
  skippedCount: 0,
};

beforeEach(() => {
  supportsByModel.value = new Map();
});

describe('support-generation store', () => {
  describe('setSupports', () => {
    it('adds supports for a model', () => {
      setSupports('model-1', mockResult);
      const entry = supportsByModel.value.get('model-1');
      expect(entry).toBeDefined();
      expect(entry!.result).toBe(mockResult);
      expect(entry!.visible).toBe(true);
    });

    it('overwrites existing supports', () => {
      setSupports('model-1', mockResult);
      const newResult: GenerateResult = { pillars: [], skippedCount: 5 };
      setSupports('model-1', newResult);
      expect(supportsByModel.value.get('model-1')!.result).toBe(newResult);
    });

    it('creates a new map reference (immutable update)', () => {
      const before = supportsByModel.value;
      setSupports('model-1', mockResult);
      expect(supportsByModel.value).not.toBe(before);
    });
  });

  describe('clearSupports', () => {
    it('removes supports for a model', () => {
      setSupports('model-1', mockResult);
      clearSupports('model-1');
      expect(supportsByModel.value.has('model-1')).toBe(false);
    });

    it('does not affect other models', () => {
      setSupports('model-1', mockResult);
      setSupports('model-2', mockResult);
      clearSupports('model-1');
      expect(supportsByModel.value.has('model-2')).toBe(true);
    });

    it('is a no-op for unknown model id', () => {
      setSupports('model-1', mockResult);
      clearSupports('nonexistent');
      expect(supportsByModel.value.size).toBe(1);
    });
  });

  describe('toggleSupportVisibility', () => {
    it('toggles visible from true to false', () => {
      setSupports('model-1', mockResult);
      toggleSupportVisibility('model-1');
      expect(supportsByModel.value.get('model-1')!.visible).toBe(false);
    });

    it('toggles visible back to true', () => {
      setSupports('model-1', mockResult);
      toggleSupportVisibility('model-1');
      toggleSupportVisibility('model-1');
      expect(supportsByModel.value.get('model-1')!.visible).toBe(true);
    });

    it('is a no-op for unknown model id', () => {
      const before = supportsByModel.value;
      toggleSupportVisibility('nonexistent');
      expect(supportsByModel.value).toBe(before);
    });
  });

  describe('getSupports', () => {
    it('returns undefined for unknown model', () => {
      expect(getSupports('nonexistent')).toBeUndefined();
    });

    it('returns the stored entry', () => {
      setSupports('model-1', mockResult);
      const entry = getSupports('model-1');
      expect(entry).toBeDefined();
      expect(entry!.result.pillars).toHaveLength(1);
    });
  });
});
