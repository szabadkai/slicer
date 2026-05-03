import { describe, it, expect, beforeEach } from 'vitest';
import { sliceParams } from '@core/state';
import {
  slicedLayers,
  currentLayerIndex,
  layerCount,
  hasSlice,
  currentLayerHeight,
  countWhitePixels,
  computePixelVolume,
  formatLayerInfo,
} from './ops';

function makeLayerData(width: number, height: number, whiteFraction: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  const whiteCount = Math.floor(width * height * whiteFraction);
  for (let i = 0; i < whiteCount; i++) {
    const offset = i * 4;
    data[offset] = 255; // R
    data[offset + 1] = 255; // G
    data[offset + 2] = 255; // B
    data[offset + 3] = 255; // A
  }
  return data;
}

beforeEach(() => {
  slicedLayers.value = [];
  currentLayerIndex.value = 0;
  sliceParams.value = {
    layerHeightMM: 0.05,
    normalExposureS: 2.5,
    bottomLayers: 6,
    bottomExposureS: 30,
    liftHeightMM: 6,
    liftSpeedMMs: 3,
  };
});

describe('layer preview ops', () => {
  it('layerCount reflects slicedLayers length', () => {
    expect(layerCount.value).toBe(0);
    slicedLayers.value = [new Uint8Array(4), new Uint8Array(4)];
    expect(layerCount.value).toBe(2);
  });

  it('hasSlice is false when no layers', () => {
    expect(hasSlice.value).toBe(false);
    slicedLayers.value = [new Uint8Array(4)];
    expect(hasSlice.value).toBe(true);
  });

  it('currentLayerHeight computes from index and params', () => {
    sliceParams.value = { ...sliceParams.value, layerHeightMM: 0.05 };
    currentLayerIndex.value = 100;
    expect(currentLayerHeight.value).toBeCloseTo(5.0, 5);
  });

  it('countWhitePixels counts RGBA pixels above threshold', () => {
    // 10x10 image, 50% white
    const data = makeLayerData(10, 10, 0.5);
    expect(countWhitePixels(data)).toBe(50);
  });

  it('countWhitePixels returns 0 for all-black layer', () => {
    const data = new Uint8Array(40); // 10 pixels, all zeros
    expect(countWhitePixels(data)).toBe(0);
  });

  it('computePixelVolume aggregates across layers', () => {
    const layer = makeLayerData(10, 10, 1.0); // 100 white pixels
    const layers = [layer, layer, layer]; // 3 layers

    const pixelAreaMm2 = 0.05 * 0.05; // 50μm pixel pitch
    const result = computePixelVolume(layers, pixelAreaMm2, sliceParams.value);

    // 100 pixels × 3 layers = 300 total pixels
    expect(result.totalPixels).toBe(300);
    // Volume = 300 × 0.0025mm² × 0.05mm = 0.0375mm³
    expect(result.totalVolumeMm3).toBeCloseTo(0.0375, 5);
    expect(result.totalVolumeMl).toBeCloseTo(0.0000375, 7);
  });

  it('formatLayerInfo produces expected string', () => {
    expect(formatLayerInfo(99, 400, 5.0)).toBe('Layer 100 / 400 — Z 5.00 mm');
    expect(formatLayerInfo(0, 1, 0)).toBe('Layer 1 / 1 — Z 0.00 mm');
  });
});
