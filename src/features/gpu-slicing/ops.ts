/**
 * GPU slicing operations — pure domain logic extracted from the panel.
 * Handles geometry upload, slice execution, volume computation.
 */
import type { LegacySlicer, LegacyViewer, SlicedVolumes } from '@core/legacy-types';
import type { IntentConflict } from '@features/surface-intent/engine-types';
import { getIntentBuffer } from '@features/surface-intent/store';
import { detectConflicts } from '@features/surface-intent/engine';
import { detectOverhangs } from '@features/support-generation/detect';
import {
  cloneCompactGrayLayer,
  getSharedPngEncodePool,
  getCompactGrayLayerByteLength,
  makeCompactGrayLayer,
  withCompactGrayLayerCrop,
} from '../../png-encode-pool';
import {
  exportCacheMode,
  slicedCompactLayers,
  slicedLayerPngCacheStatus,
  slicedLayerPngs,
} from '@features/layer-preview/ops';

const MAX_SLICE_CACHE_ENCODE_BACKLOG = 24;
const MAX_SLICE_CACHE_QUEUED_LAYERS = 24;
const MAX_SLICE_CACHE_LAYER_BYTES = 48 * 1024 * 1024;
const MAX_SLICE_CACHE_IN_FLIGHT_BYTES = 384 * 1024 * 1024;

export interface SliceResult {
  layerCount: number;
  volumes: SlicedVolumes;
  perLayerWhitePixels: Float64Array;
  /** Conflicts detected during pre-slice analysis (if intent buffers present) */
  conflicts: IntentConflict[];
  timings: SlicePipelineTimings;
}

export interface SliceProgress {
  showProgress: (text: string) => void;
  updateProgress: (fraction: number, text?: string) => void;
}

export interface SlicePipelineTimings {
  totalMs: number;
  preflightMs: number;
  uploadMs: number;
  sliceMs: number;
  compactLayerMs: number;
  pixelCountMs: number;
  queuedPngLayers: number;
  cachedPngLayers: number;
  slicer?: {
    layerCount: number;
    renderMs: number;
    readbackMs: number;
    paintMs: number;
    totalMs: number;
    asyncReadback?: boolean;
    croppedReadback?: boolean;
    readbackPixels?: number;
  };
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function logSliceTimings(timings: SlicePipelineTimings): void {
  const layerCount = Math.max(1, timings.slicer?.layerCount ?? timings.queuedPngLayers);
  const summary = {
    totalMs: Math.round(timings.totalMs),
    preflightMs: Math.round(timings.preflightMs),
    uploadMs: Math.round(timings.uploadMs),
    sliceMs: Math.round(timings.sliceMs),
    renderMs: Math.round(timings.slicer?.renderMs ?? 0),
    readbackMs: Math.round(timings.slicer?.readbackMs ?? 0),
    paintMs: Math.round(timings.slicer?.paintMs ?? 0),
    compactLayerMs: Math.round(timings.compactLayerMs),
    pixelCountMs: Math.round(timings.pixelCountMs),
    msPerLayer: Number((timings.sliceMs / layerCount).toFixed(2)),
    queuedPngLayers: timings.queuedPngLayers,
    cachedPngLayers: timings.cachedPngLayers,
    asyncReadback: timings.slicer?.asyncReadback ?? false,
    croppedReadback: timings.slicer?.croppedReadback ?? false,
    readbackMegapixels: Number(((timings.slicer?.readbackPixels ?? 0) / 1_000_000).toFixed(2)),
  };
  console.warn('[slice] timings', summary);
  console.warn('[slice] timings-json', JSON.stringify(summary));
}

/**
 * Compute the volume breakdown from pixel counts and geometry estimates.
 */
function computeVolumes(
  filledPx: number,
  pxArea: number,
  layerHeight: number,
  hasSupportGeo: boolean,
  viewer: LegacyViewer,
): SlicedVolumes {
  const totalVolMm3 = filledPx * pxArea * layerHeight;
  let modelVolMm3 = totalVolMm3;
  let supportVolMm3 = 0;
  let exactBreakdown = true;

  if (hasSupportGeo) {
    const info = viewer.getOverallInfo();
    const estModel = info?.modelVolume ?? 0;
    const estSupport = info?.supportVolume ?? 0;
    const estTotal = estModel + estSupport;
    if (estTotal > 0) {
      modelVolMm3 = totalVolMm3 * (estModel / estTotal);
      supportVolMm3 = totalVolMm3 - modelVolMm3;
    }
    exactBreakdown = false;
  }

  return {
    model: modelVolMm3,
    supports: supportVolMm3,
    total: totalVolMm3,
    exactTotal: true,
    exactBreakdown,
  };
}

/**
 * Execute the full slice pipeline for the current plate.
 * Returns null if there's no geometry to slice.
 * When models have intent buffers, runs conflict detection and builds
 * IntentSupportParams for downstream use.
 */
export async function executeSlice(
  viewer: LegacyViewer,
  slicer: LegacySlicer,
  layerHeight: number,
  progress: SliceProgress,
): Promise<SliceResult | null> {
  const totalStart = nowMs();
  const mergedModelGeo = viewer.getMergedModelGeometry();
  const mergedSupportGeo = viewer.getMergedSupportGeometry();
  if (!mergedModelGeo) return null;

  progress.showProgress('Merging & Uploading geometry...');
  await yieldToBrowser();

  // ─── Intent-aware pre-slice analysis ──────────────────────
  const preflightStart = nowMs();
  const conflicts: IntentConflict[] = [];

  for (const obj of viewer.objects) {
    const buffer = getIntentBuffer(obj.id);
    if (!buffer) continue;

    // Run overhang detection for conflict analysis
    const geo = obj.mesh.geometry as {
      attributes?: { position?: { array: Float32Array; count: number } };
      index?: { count: number };
    };
    const posAttr = geo.attributes?.position;
    if (posAttr) {
      const triCount = geo.index ? Math.floor(geo.index.count / 3) : Math.floor(posAttr.count / 3);
      const { overhangTriangles } = detectOverhangs(posAttr.array, triCount);
      const modelConflicts = detectConflicts(buffer, overhangTriangles, posAttr.array, triCount);
      conflicts.push(...modelConflicts);
    }
  }
  const preflightMs = nowMs() - preflightStart;

  const uploadStart = nowMs();
  slicer.uploadGeometry(mergedModelGeo, mergedSupportGeo);
  slicer.setInstances(0, null);
  slicer.setPaintSliceMarks?.(viewer.getPaintSliceMarks?.() ?? []);
  slicer.setPaintTextureConfig?.(
    viewer.getPaintTextureConfig?.() ?? { strength: 0.8, pattern: 0, patternScaleMM: 2 },
  );
  const uploadMs = nowMs() - uploadStart;

  progress.showProgress('Slicing...');
  await yieldToBrowser();

  const printerSpec = slicer.getPrinterSpec();
  const pxArea =
    (printerSpec.buildWidthMM / printerSpec.resolutionX) *
    (printerSpec.buildDepthMM / printerSpec.resolutionY);

  const perLayerWhite: number[] = [];

  // Encode each layer to PNG in the worker pool, in parallel with the next
  // layer's GPU render. The queued payload is compact grayscale data: empty,
  // sparse, or dense depending on which stores the layer losslessly with fewer
  // bytes.
  let pool: ReturnType<typeof getSharedPngEncodePool> | null = null;
  const pngs: Uint8Array[] = [];
  const compactLayers: ReturnType<typeof makeCompactGrayLayer>[] = [];
  const encodePromises: Promise<void>[] = [];
  let encodeBacklog = 0;
  let encodeBytesInFlight = 0;
  let pngCacheComplete = true;
  const cacheMode = exportCacheMode.value;
  slicedLayerPngs.value = [];
  slicedCompactLayers.value = [];
  slicedLayerPngCacheStatus.value = 'encoding';
  let compactLayerMs = 0;
  const pixelCountMs = 0;
  let slicerTiming: SlicePipelineTimings['slicer'];

  const sliceStart = nowMs();
  await slicer.slice(
    layerHeight,
    (current, total) => {
      progress.updateProgress(current / total, `Slicing layer ${current} / ${total}`);
    },
    {
      collect: false,
      onLayer: (pixels: Uint8Array, layerIndex: number, region) => {
        const layerWidth = region?.width ?? printerSpec.resolutionX;
        let layer: ReturnType<typeof makeCompactGrayLayer>;
        let layerByteCount: number;
        const compactStart = nowMs();
        try {
          layer = makeCompactGrayLayer(pixels, layerWidth);
          layer = withCompactGrayLayerCrop(layer, region ?? null);
          layerByteCount = getCompactGrayLayerByteLength(layer);
        } catch (error) {
          pngCacheComplete = false;
          if (error instanceof RangeError) {
            throw new Error(
              'Slicing ran out of browser memory while preparing layer previews. Try a lower-resolution printer profile, a thicker layer height, or a smaller model.',
              { cause: error },
            );
          }
          throw error;
        } finally {
          compactLayerMs += nowMs() - compactStart;
        }

        const w = layer.filledPixels;
        perLayerWhite[layerIndex] = w;

        compactLayers[layerIndex] = layer;

        if (cacheMode === 'fast-slice' || cacheMode === 'fast-export' || !pngCacheComplete) {
          pngCacheComplete = false;
          return;
        }

        pool ??= getSharedPngEncodePool();
        const canQueuePng =
          layerByteCount <= MAX_SLICE_CACHE_LAYER_BYTES &&
          encodePromises.length < MAX_SLICE_CACHE_QUEUED_LAYERS &&
          encodeBacklog < MAX_SLICE_CACHE_ENCODE_BACKLOG &&
          encodeBytesInFlight + layerByteCount <= MAX_SLICE_CACHE_IN_FLIGHT_BYTES;

        if (!canQueuePng) {
          pngCacheComplete = false;
          return;
        }

        const encodeLayer = cloneCompactGrayLayer(layer);
        encodeBacklog++;
        encodeBytesInFlight += layerByteCount;
        encodePromises.push(
          pool
            .encode(encodeLayer, printerSpec.resolutionX, printerSpec.resolutionY)
            .then((png) => {
              pngs[layerIndex] = png;
            })
            .finally(() => {
              encodeBacklog--;
              encodeBytesInFlight -= layerByteCount;
            }),
        );
      },
      onTiming: (timing) => {
        slicerTiming = timing;
      },
    },
  );
  const sliceMs = nowMs() - sliceStart;
  const compactReady =
    compactLayers.length === perLayerWhite.length && compactLayers.every((layer) => !!layer);
  slicedCompactLayers.value = compactReady ? compactLayers : [];

  const finishPngCache = async (): Promise<void> => {
    try {
      await Promise.all(encodePromises);
      const ready =
        pngCacheComplete &&
        pngs.length === perLayerWhite.length &&
        pngs.every((png) => png.length > 0);
      slicedLayerPngs.value = ready ? pngs : [];
      slicedLayerPngCacheStatus.value = ready ? 'ready' : 'skipped';
      console.warn('[slice] png cache', {
        status: slicedLayerPngCacheStatus.value,
        layers: ready ? pngs.length : 0,
      });
    } catch (error) {
      slicedLayerPngs.value = [];
      slicedLayerPngCacheStatus.value = 'skipped';
      console.warn('[slice] PNG cache failed; export will render layers on demand.', error);
    }
  };

  const encodeCompactCacheInBackground = async (): Promise<void> => {
    if (!compactReady) return;
    try {
      const encodePool = getSharedPngEncodePool();
      const readyPngs: Uint8Array[] = new Array(compactLayers.length);
      const pending = new Set<Promise<void>>();
      let nextLayer = 0;

      while (nextLayer < compactLayers.length || pending.size > 0) {
        while (nextLayer < compactLayers.length && pending.size < encodePool.size) {
          const layerIndex = nextLayer++;
          const layer = cloneCompactGrayLayer(compactLayers[layerIndex]);
          const task = encodePool
            .encode(layer, printerSpec.resolutionX, printerSpec.resolutionY)
            .then((png) => {
              readyPngs[layerIndex] = png;
            })
            .finally(() => {
              pending.delete(task);
            });
          pending.add(task);
        }

        if (pending.size > 0) await Promise.race(pending);
        await yieldToBrowser();
      }

      slicedLayerPngs.value = readyPngs;
      slicedLayerPngCacheStatus.value = 'ready';
      console.warn('[slice] png cache', {
        status: slicedLayerPngCacheStatus.value,
        layers: readyPngs.length,
      });
    } catch (error) {
      slicedLayerPngs.value = [];
      slicedLayerPngCacheStatus.value = 'skipped';
      console.warn('[slice] PNG cache failed; export will encode compact layers on demand.', error);
    }
  };

  if (encodePromises.length > 0) {
    void finishPngCache();
    if (!pngCacheComplete) slicedLayerPngCacheStatus.value = 'skipped';
  } else if (cacheMode === 'fast-export' && compactReady) {
    slicedLayerPngCacheStatus.value = 'encoding';
    void encodeCompactCacheInBackground();
  } else {
    slicedLayerPngCacheStatus.value = 'skipped';
  }

  const filledPx = perLayerWhite.reduce((sum, count) => sum + (count ?? 0), 0);
  const volumes = computeVolumes(filledPx, pxArea, layerHeight, !!mergedSupportGeo, viewer);
  const timings: SlicePipelineTimings = {
    totalMs: nowMs() - totalStart,
    preflightMs,
    uploadMs,
    sliceMs,
    compactLayerMs,
    pixelCountMs,
    queuedPngLayers: encodePromises.length,
    cachedPngLayers: 0,
    slicer: slicerTiming,
  };
  logSliceTimings(timings);

  return {
    layerCount: perLayerWhite.length,
    volumes,
    perLayerWhitePixels: new Float64Array(perLayerWhite),
    conflicts,
    timings,
  };
}
