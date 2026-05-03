/**
 * GPU slicing operations — pure domain logic extracted from the panel.
 * Handles geometry upload, slice execution, volume computation.
 */
import type { LegacySlicer, LegacyViewer, SlicedVolumes } from '@core/legacy-types';
import { countWhitePixels } from '@core/pixel-utils';

export interface SliceResult {
  layerCount: number;
  volumes: SlicedVolumes;
  perLayerWhitePixels: Float64Array;
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

  slicer.uploadGeometry(mergedModelGeo, mergedSupportGeo);
  slicer.setInstances(0, null);

  progress.showProgress('Slicing...');
  await new Promise((r) => setTimeout(r, 50));

  const printerSpec = slicer.getPrinterSpec();
  const pxArea =
    (printerSpec.buildWidthMM / printerSpec.resolutionX) *
    (printerSpec.buildDepthMM / printerSpec.resolutionY);

  let filledPx = 0;
  const perLayerWhite: number[] = [];

  await slicer.slice(
    layerHeight,
    (current, total) => {
      progress.updateProgress(current / total, `Slicing layer ${current} / ${total}`);
    },
    {
      collect: false,
      onLayer: (pixels: Uint8Array) => {
        const w = countWhitePixels(pixels);
        filledPx += w;
        perLayerWhite.push(w);
      },
    },
  );

  const volumes = computeVolumes(filledPx, pxArea, layerHeight, !!mergedSupportGeo, viewer);

  return {
    layerCount: perLayerWhite.length,
    volumes,
    perLayerWhitePixels: new Float64Array(perLayerWhite),
  };
}
