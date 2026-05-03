import { describe, it, expect, beforeEach } from 'vitest';
import type { SliceParams } from '@core/types';
import { sliceParams } from '@core/state';
import {
  computeLayerCount,
  estimatePrintTime,
  setCachedSlice,
  getCachedSlice,
  invalidateCache,
  isCacheValid,
  sliceCaches,
  sliceStatus,
  sliceProgress,
} from './params';

const defaultParams: SliceParams = {
  layerHeightMM: 0.05,
  normalExposureS: 2.5,
  bottomLayers: 6,
  bottomExposureS: 30,
  liftHeightMM: 6,
  liftSpeedMMs: 3,
};

beforeEach(() => {
  sliceCaches.value = new Map();
  sliceStatus.value = 'idle';
  sliceProgress.value = 0;
  sliceParams.value = defaultParams;
});

describe('gpu-slicing params', () => {
  it('computeLayerCount calculates correct count', () => {
    expect(computeLayerCount(20, 0.05)).toBe(400);
    expect(computeLayerCount(10, 0.1)).toBe(100);
    expect(computeLayerCount(0.03, 0.05)).toBe(1); // ceil
  });

  it('computeLayerCount handles zero/negative height', () => {
    expect(computeLayerCount(20, 0)).toBe(0);
    expect(computeLayerCount(20, -1)).toBe(0);
  });

  it('estimatePrintTime calculates bottom + normal correctly', () => {
    const result = estimatePrintTime(400, defaultParams);
    // liftTime = 6 / 3 = 2s per layer
    // bottom: 6 × (30 + 2) = 192s
    // normal: 394 × (2.5 + 2) = 1773s
    // total = 1965s
    expect(result.totalSeconds).toBeCloseTo(1965, 0);
  });

  it('estimatePrintTime updates when exposure doubles', () => {
    const base = estimatePrintTime(400, defaultParams);
    const doubled = estimatePrintTime(400, { ...defaultParams, normalExposureS: 5 });
    // Increase ≈ 394 layers × 2.5s extra = 985s more
    const diff = doubled.totalSeconds - base.totalSeconds;
    expect(diff).toBeCloseTo(985, 0);
  });

  it('estimatePrintTime formats as hours/minutes', () => {
    const result = estimatePrintTime(400, defaultParams);
    expect(result.formatted).toMatch(/\d+m/);
  });

  it('estimatePrintTime returns 0 for empty', () => {
    expect(estimatePrintTime(0, defaultParams).totalSeconds).toBe(0);
  });
});

describe('gpu-slicing cache', () => {
  it('set and get cache', () => {
    setCachedSlice({
      plateId: 'p1',
      layerCount: 1,
      params: defaultParams,
      printerKey: 'mars3',
      geometryHash: 'abc',
    });
    const cached = getCachedSlice('p1');
    expect(cached).toBeDefined();
    expect(cached!.layerCount).toBe(1);
  });

  it('invalidateCache removes cache', () => {
    setCachedSlice({
      plateId: 'p1',
      layerCount: 0,
      params: defaultParams,
      printerKey: 'mars3',
      geometryHash: 'abc',
    });
    invalidateCache('p1');
    expect(getCachedSlice('p1')).toBeUndefined();
  });

  it('isCacheValid returns true when params match', () => {
    setCachedSlice({
      plateId: 'p1',
      layerCount: 0,
      params: defaultParams,
      printerKey: 'mars3',
      geometryHash: 'abc',
    });
    expect(isCacheValid('p1', defaultParams, 'mars3', 'abc')).toBe(true);
  });

  it('isCacheValid returns false on param change', () => {
    setCachedSlice({
      plateId: 'p1',
      layerCount: 0,
      params: defaultParams,
      printerKey: 'mars3',
      geometryHash: 'abc',
    });
    expect(isCacheValid('p1', { ...defaultParams, layerHeightMM: 0.1 }, 'mars3', 'abc')).toBe(
      false,
    );
  });

  it('isCacheValid returns false on geometry change', () => {
    setCachedSlice({
      plateId: 'p1',
      layerCount: 0,
      params: defaultParams,
      printerKey: 'mars3',
      geometryHash: 'abc',
    });
    expect(isCacheValid('p1', defaultParams, 'mars3', 'xyz')).toBe(false);
  });

  it('isCacheValid returns false on printer change', () => {
    setCachedSlice({
      plateId: 'p1',
      layerCount: 0,
      params: defaultParams,
      printerKey: 'mars3',
      geometryHash: 'abc',
    });
    expect(isCacheValid('p1', defaultParams, 'saturn2', 'abc')).toBe(false);
  });
});
