import { signal, computed } from '@preact/signals-core';
import type { SliceParams } from '@core/types';
import { sliceParams } from '@core/state';
import { countWhitePixels } from '@core/pixel-utils';

// ─── Feature-local state ───────────────────────────────────

export const slicedLayers = signal<Uint8Array[]>([]);
export const currentLayerIndex = signal(0);

export const layerCount = computed(() => slicedLayers.value.length);
export const hasSlice = computed(() => slicedLayers.value.length > 0);

export const currentLayerHeight = computed(() => {
  return currentLayerIndex.value * sliceParams.value.layerHeightMM;
});

// ─── Volume calculations ───────────────────────────────────

export interface VolumeResult {
  totalPixels: number;
  totalVolumeMm3: number;
  totalVolumeMl: number;
}

export function computePixelVolume(
  layers: Uint8Array[],
  pixelAreaMm2: number,
  params: SliceParams,
): VolumeResult {
  let totalPixels = 0;

  for (const layer of layers) {
    totalPixels += countWhitePixels(layer);
  }

  const totalVolumeMm3 = totalPixels * pixelAreaMm2 * params.layerHeightMM;
  const totalVolumeMl = totalVolumeMm3 / 1000;

  return { totalPixels, totalVolumeMm3, totalVolumeMl };
}

export { countWhitePixels } from '@core/pixel-utils';

export function countWhitePixelsForLayer(layerIndex: number): number {
  const layers = slicedLayers.value;
  if (layerIndex < 0 || layerIndex >= layers.length) return 0;
  return countWhitePixels(layers[layerIndex]);
}

export function formatLayerInfo(
  index: number,
  total: number,
  heightMM: number,
): string {
  return `Layer ${index + 1} / ${total} — Z ${heightMM.toFixed(2)} mm`;
}
