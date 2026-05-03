import { signal, computed } from '@preact/signals-core';
import type { Plate, SliceParams, Stage } from './types';
import type { SlicedVolumes } from './legacy-types';

// ─── Workflow Stage ────────────────────────────────────────

export const activeStage = signal<Stage>('prepare');

// ─── Plates ────────────────────────────────────────────────

export const plates = signal<Plate[]>([]);
export const activePlateId = signal<string>('');
export const activePlate = computed<Plate | undefined>(() =>
  plates.value.find((p) => p.id === activePlateId.value),
);

// ─── Selection ─────────────────────────────────────────────

export const selectedModelIds = signal<string[]>([]);

// ─── Material & Printer ────────────────────────────────────

export const selectedMaterialId = signal<string>('siraya-fast-navy-grey');
export const selectedPrinterKey = signal<string>('photon-mono');

// ─── Slice Parameters ──────────────────────────────────────

export const sliceParams = signal<SliceParams>({
  layerHeightMM: 0.05,
  normalExposureS: 2.5,
  bottomLayers: 6,
  bottomExposureS: 30,
  liftHeightMM: 6,
  liftSpeedMMs: 3,
});

// ─── Orientation ───────────────────────────────────────────

export const protectedFace = signal<{
  objectId: string;
  point: [number, number, number];
  normal: [number, number, number];
} | null>(null);

// ─── Slice Results (per active plate) ──────────────────────

export const slicedLayerCount = signal<number>(0);
export const slicedVolumes = signal<SlicedVolumes | null>(null);
export const inspectorAreaData = signal<Float64Array | null>(null);
