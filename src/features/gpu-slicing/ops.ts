/**
 * GPU slicing operations — pure domain logic extracted from the panel.
 * Handles geometry upload, slice execution, volume computation.
 */
import type { LegacySlicer, LegacyViewer, SlicedVolumes } from '@core/legacy-types';
import { countWhitePixels } from '@core/pixel-utils';
import type { IntentConflict } from '@features/surface-intent/engine-types';
import { getIntentBuffer } from '@features/surface-intent/store';
import { detectConflicts } from '@features/surface-intent/engine';
import { detectOverhangs } from '@features/support-generation/detect';
import { getSharedPngEncodePool } from '../../png-encode-pool';
import { slicedLayerPngs } from '@features/layer-preview/ops';

export interface SliceResult {
  layerCount: number;
  volumes: SlicedVolumes;
  perLayerWhitePixels: Float64Array;
  /** Conflicts detected during pre-slice analysis (if intent buffers present) */
  conflicts: IntentConflict[];
}

export interface SliceProgress {
  showProgress: (text: string) => void;
  updateProgress: (fraction: number, text?: string) => void;
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
  const mergedModelGeo = viewer.getMergedModelGeometry();
  const mergedSupportGeo = viewer.getMergedSupportGeometry();
  if (!mergedModelGeo) return null;

  progress.showProgress('Merging & Uploading geometry...');
  await new Promise((r) => setTimeout(r, 50));

  // ─── Intent-aware pre-slice analysis ──────────────────────
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

  slicer.uploadGeometry(mergedModelGeo, mergedSupportGeo);
  slicer.setInstances(0, null);
  slicer.setPaintSliceMarks?.(viewer.getPaintSliceMarks?.() ?? []);
  slicer.setPaintTextureConfig?.(
    viewer.getPaintTextureConfig?.() ?? { strength: 0.8, pattern: 0, patternScaleMM: 2 },
  );

  progress.showProgress('Slicing...');
  await new Promise((r) => setTimeout(r, 50));

  const printerSpec = slicer.getPrinterSpec();
  const pxArea =
    (printerSpec.buildWidthMM / printerSpec.resolutionX) *
    (printerSpec.buildDepthMM / printerSpec.resolutionY);

  let filledPx = 0;
  const perLayerWhite: number[] = [];

  // Encode each layer's pixels to PNG in the worker pool, in parallel with
  // the next layer's GPU render. The resulting bytes are cached so export
  // can skip the second slice pass entirely.
  const pool = getSharedPngEncodePool();
  const pngs: Uint8Array[] = [];
  const encodePromises: Promise<void>[] = [];
  slicedLayerPngs.value = [];

  await slicer.slice(
    layerHeight,
    (current, total) => {
      progress.updateProgress(current / total, `Slicing layer ${current} / ${total}`);
    },
    {
      collect: false,
      onLayer: (pixels: Uint8Array, layerIndex: number) => {
        const w = countWhitePixels(pixels);
        filledPx += w;
        perLayerWhite.push(w);

        // Copy because the slice loop reuses the buffer for the next layer.
        const copy = new Uint8Array(pixels);
        encodePromises.push(
          pool.encode(copy, printerSpec.resolutionX, printerSpec.resolutionY).then((png) => {
            pngs[layerIndex] = png;
          }),
        );
      },
    },
  );

  // Wait for all PNG encodes to complete before returning so the cache is
  // ready when the user clicks export.
  await Promise.all(encodePromises);
  slicedLayerPngs.value = pngs;

  const volumes = computeVolumes(filledPx, pxArea, layerHeight, !!mergedSupportGeo, viewer);

  return {
    layerCount: perLayerWhite.length,
    volumes,
    perLayerWhitePixels: new Float64Array(perLayerWhite),
    conflicts,
  };
}
