/**
 * Slice panel — slice button, slice-all, settings, preflight, estimate.
 */
import type { AppContext, ProjectState } from '@core/types';
import type { LegacyPlate, LegacySlicer } from '@core/legacy-types';
import { listen } from '@features/app-shell/utils';
import {
  getSlicedLayerCount, setSlicedLayerCount, setSlicedVolumes,
  setInspectorAreaData,
} from '@features/app-shell/mount';
import { executeSlice } from './ops';

export function mountSlicePanel(
  ctx: AppContext,
  slicer: LegacySlicer,
  project: ProjectState,
  getActivePlate: () => LegacyPlate,
  saveSliceRefsToActivePlate: () => void,
): { updateEstimate: () => void } {
  const { viewer } = ctx;
  const sliceBtn = document.getElementById('slice-btn');
  const sliceAllBtn = document.getElementById('slice-all-btn');

  // Slice settings inputs
  const layerHeightInput = document.getElementById('layer-height') as HTMLInputElement | null;
  const normalExposureInput = document.getElementById('normal-exposure') as HTMLInputElement | null;
  const bottomLayersInput = document.getElementById('bottom-layers') as HTMLInputElement | null;
  const bottomExposureInput = document.getElementById('bottom-exposure') as HTMLInputElement | null;
  const liftHeightInput = document.getElementById('lift-height') as HTMLInputElement | null;
  const liftSpeedInput = document.getElementById('lift-speed') as HTMLInputElement | null;
  const summaryPanel = document.getElementById('summary-panel');
  const printEstimate = document.getElementById('print-estimate');
  const layerPreviewPanel = document.getElementById('layer-preview-panel');
  const layerSlider = document.getElementById('layer-slider') as HTMLInputElement | null;

  function getSettings(): {
    layerHeight: number; normalExposure: number; bottomLayers: number;
    bottomExposure: number; liftHeight: number; liftSpeed: number;
  } {
    return {
      layerHeight: Number.parseFloat(layerHeightInput?.value ?? '0.05'),
      normalExposure: Number.parseFloat(normalExposureInput?.value ?? '2'),
      bottomLayers: Number.parseInt(bottomLayersInput?.value ?? '6', 10),
      bottomExposure: Number.parseFloat(bottomExposureInput?.value ?? '30'),
      liftHeight: Number.parseFloat(liftHeightInput?.value ?? '8'),
      liftSpeed: Number.parseFloat(liftSpeedInput?.value ?? '3'),
    };
  }

  async function handleSlice(): Promise<boolean> {
    const layerHeight = Number.parseFloat(layerHeightInput?.value ?? '0.05');

    const result = await executeSlice(viewer, slicer, layerHeight, {
      showProgress: ctx.showProgress,
      updateProgress: ctx.updateProgress,
    });

    if (!result) return false;

    setInspectorAreaData(result.perLayerWhitePixels);
    setSlicedLayerCount(result.layerCount);
    setSlicedVolumes(result.volumes);
    saveSliceRefsToActivePlate();
    updateEstimate();

    ctx.hideProgress();

    if (layerPreviewPanel) layerPreviewPanel.hidden = false;
    if (layerSlider) {
      layerSlider.max = String(result.layerCount - 1);
      layerSlider.value = '0';
      layerSlider.dispatchEvent(new Event('input'));
    }
    ctx.renderPlateTabs();
    return true;
  }

  async function handleSliceAll(): Promise<void> {
    const startId = project.activePlateId;
    const toSlice = project.plates.filter((p) => p.objects.length > 0);
    for (let i = 0; i < toSlice.length; i++) {
      const plate = toSlice[i];
      project.activePlateId = plate.id;
      viewer.setActivePlate(plate);
      ctx.showProgress(`Slicing ${plate.name} (${i + 1} / ${toSlice.length})...`);
      const ok = await handleSlice();
      if (!ok) break;
    }
    const startPlate = project.plates.find((p) => p.id === startId);
    if (startPlate) {
      project.activePlateId = startPlate.id;
      viewer.setActivePlate(startPlate);
    }
    ctx.renderPlateTabs();
  }

  function updateEstimate(): void {
    const info = viewer.getOverallInfo();
    if (!info || info.count === 0) {
      if (summaryPanel) summaryPanel.hidden = true;
      if (printEstimate) printEstimate.textContent = '';
      return;
    }
    if (summaryPanel) summaryPanel.hidden = false;

    const settings = getSettings();
    const modelHeight = info.height;
    const layerCount = Math.ceil(modelHeight / settings.layerHeight);
    const bottomTime = settings.bottomLayers * settings.bottomExposure;
    const normalTime = (layerCount - settings.bottomLayers) * settings.normalExposure;
    const liftTime = layerCount * ((settings.liftHeight * 2) / settings.liftSpeed + 1);
    const totalSeconds = bottomTime + normalTime + liftTime;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    const vols = getSlicedLayerCount() > 0 ? (getActivePlate().slicedVolumes ?? null) : null;
    const mm3ToMl = (v: number): number => v / 1000;
    const modelMl = mm3ToMl(vols ? vols.model : (info.modelVolume ?? 0));
    const supportMl = mm3ToMl(vols ? vols.supports : (info.supportVolume ?? 0));
    const totalMl = mm3ToMl(vols?.total ?? ((info.modelVolume ?? 0) + (info.supportVolume ?? 0)));

    const rows = [
      `<div class="estimate-row"><span class="estimate-label">Layers</span><span class="estimate-value">${layerCount}</span></div>`,
      `<div class="estimate-row"><span class="estimate-label">Height</span><span class="estimate-value">${modelHeight.toFixed(1)} mm</span></div>`,
      `<div class="estimate-row"><span class="estimate-label">Model</span><span class="estimate-value">${modelMl.toFixed(1)} mL</span></div>`,
    ];
    if (supportMl > 0 || vols) {
      rows.push(`<div class="estimate-row"><span class="estimate-label">Supports</span><span class="estimate-value">${supportMl.toFixed(1)} mL</span></div>`);
    }
    if (vols) {
      rows.push(`<div class="estimate-row"><span class="estimate-label">Total</span><span class="estimate-value">${totalMl.toFixed(1)} mL</span></div>`);
    }
    rows.push(`<div class="estimate-row"><span class="estimate-label">Total Time</span><span class="estimate-value">${hours}h ${minutes}m</span></div>`);

    if (printEstimate) printEstimate.innerHTML = rows.join('');
  }

  // Wire buttons
  listen(sliceBtn, 'click', () => { handleSlice(); });
  listen(sliceAllBtn, 'click', () => { handleSliceAll(); });

  // Settings change → update estimate
  [layerHeightInput, normalExposureInput, bottomLayersInput, bottomExposureInput, liftHeightInput, liftSpeedInput]
    .forEach((el) => listen(el, 'change', updateEstimate));

  return { updateEstimate };
}
