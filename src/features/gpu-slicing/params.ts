// ─── GPU slicing parameter calculations & cache logic ───────
// NOTE: This module is allowed to import THREE.js per project rules,
// but the current implementation is pure math — actual WebGL pipeline
// will be added when viewer-service is fully implemented.

import { signal, computed } from '@preact/signals-core';
import type { SliceParams } from '@core/types';
import { sliceParams } from '@core/state';

// ─── Layer count & time estimation ─────────────────────────

export function computeLayerCount(modelHeightMM: number, layerHeightMM: number): number {
  if (layerHeightMM <= 0) return 0;
  return Math.ceil(modelHeightMM / layerHeightMM);
}

export interface PrintTimeEstimate {
  totalSeconds: number;
  formatted: string;
}

export function estimatePrintTime(
  layerCount: number,
  params: SliceParams,
): PrintTimeEstimate {
  if (layerCount <= 0) return { totalSeconds: 0, formatted: '0m' };

  const bottomCount = Math.min(params.bottomLayers, layerCount);
  const normalCount = layerCount - bottomCount;

  const liftTimePerLayer = params.liftHeightMM / params.liftSpeedMMs; // seconds
  const bottomTimeTotal = bottomCount * (params.bottomExposureS + liftTimePerLayer);
  const normalTimeTotal = normalCount * (params.normalExposureS + liftTimePerLayer);

  const totalSeconds = bottomTimeTotal + normalTimeTotal;
  return { totalSeconds, formatted: formatDuration(totalSeconds) };
}

// ─── Cache management ──────────────────────────────────────

export interface SliceCache {
  plateId: string;
  layerCount: number;
  params: SliceParams;
  printerKey: string;
  geometryHash: string;
}

export const sliceCaches = signal<Map<string, SliceCache>>(new Map());

export function getCachedSlice(plateId: string): SliceCache | undefined {
  return sliceCaches.value.get(plateId);
}

export function setCachedSlice(cache: SliceCache): void {
  const next = new Map(sliceCaches.value);
  next.set(cache.plateId, cache);
  sliceCaches.value = next;
}

export function invalidateCache(plateId: string): void {
  const next = new Map(sliceCaches.value);
  next.delete(plateId);
  sliceCaches.value = next;
}

export function isCacheValid(
  plateId: string,
  currentParams: SliceParams,
  currentPrinterKey: string,
  currentGeometryHash: string,
): boolean {
  const cache = sliceCaches.value.get(plateId);
  if (!cache) return false;
  return (
    cache.printerKey === currentPrinterKey &&
    cache.geometryHash === currentGeometryHash &&
    cache.params.layerHeightMM === currentParams.layerHeightMM &&
    cache.params.normalExposureS === currentParams.normalExposureS &&
    cache.params.bottomLayers === currentParams.bottomLayers &&
    cache.params.bottomExposureS === currentParams.bottomExposureS &&
    cache.params.liftHeightMM === currentParams.liftHeightMM &&
    cache.params.liftSpeedMMs === currentParams.liftSpeedMMs
  );
}

// ─── Slice state ───────────────────────────────────────────

export type SliceStatus = 'idle' | 'slicing' | 'done' | 'cancelled';

export const sliceStatus = signal<SliceStatus>('idle');
export const sliceProgress = signal(0); // 0–1

export const currentEstimate = computed(() => {
  // Placeholder: actual model height comes from viewer-service
  return estimatePrintTime(0, sliceParams.value);
});

// ─── Helpers ───────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
