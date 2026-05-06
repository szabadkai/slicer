/**
 * Slice panel — slice button, slice-all, settings, preflight, estimate.
 */
import type { AppContext, ProjectState } from '@core/types';
import type { LegacyPlate, LegacySlicer } from '@core/legacy-types';
import { listen } from '@features/app-shell/utils';
import {
  getSlicedLayerCount,
  setSlicedLayerCount,
  setSlicedVolumes,
  setInspectorAreaData,
} from '@features/app-shell/mount';
import { executeSlice } from './ops';
import { setConflicts } from '@features/surface-intent/conflict-inspector';
import {
  allProfiles,
  activeProfileId,
  applyProfileToInputs,
  saveProfile,
  deleteProfile,
  readInputsAsParams,
} from './profiles';
import { computeAdaptiveLayers, formatAdaptiveSummary } from './adaptive-layers';
import { compensationFactors, setCompensation, formatCompensation } from './compensation';
import { exposureProfile, setExposureProfile, formatExposureMultiplier } from './exposure-regions';

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
    layerHeight: number;
    normalExposure: number;
    bottomLayers: number;
    bottomExposure: number;
    liftHeight: number;
    liftSpeed: number;
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

    // Surface intent conflicts detected during pre-slice analysis
    if (result.conflicts.length > 0) {
      setConflicts(result.conflicts);
    }

    setInspectorAreaData(result.perLayerWhitePixels);
    setSlicedLayerCount(result.layerCount);
    setSlicedVolumes(result.volumes);
    saveSliceRefsToActivePlate();
    updateEstimate();

    // Emit per-layer data for peel force chart
    viewer.canvas?.dispatchEvent(
      new CustomEvent('slice-complete', {
        detail: { perLayerWhitePixels: result.perLayerWhitePixels, layerCount: result.layerCount },
      }),
    );

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
    const totalMl = mm3ToMl(vols?.total ?? (info.modelVolume ?? 0) + (info.supportVolume ?? 0));

    const rows = [
      `<div class="estimate-row"><span class="estimate-label">Layers</span><span class="estimate-value">${layerCount}</span></div>`,
      `<div class="estimate-row"><span class="estimate-label">Height</span><span class="estimate-value">${modelHeight.toFixed(1)} mm</span></div>`,
      `<div class="estimate-row"><span class="estimate-label">Model</span><span class="estimate-value">${modelMl.toFixed(1)} mL</span></div>`,
    ];
    if (supportMl > 0 || vols) {
      rows.push(
        `<div class="estimate-row"><span class="estimate-label">Supports</span><span class="estimate-value">${supportMl.toFixed(1)} mL</span></div>`,
      );
    }
    if (vols) {
      rows.push(
        `<div class="estimate-row"><span class="estimate-label">Total</span><span class="estimate-value">${totalMl.toFixed(1)} mL</span></div>`,
      );
    }
    rows.push(
      `<div class="estimate-row"><span class="estimate-label">Total Time</span><span class="estimate-value">${hours}h ${minutes}m</span></div>`,
    );

    if (printEstimate) printEstimate.innerHTML = rows.join('');
  }

  // Wire buttons
  listen(sliceBtn, 'click', () => {
    handleSlice();
  });
  listen(sliceAllBtn, 'click', () => {
    handleSliceAll();
  });

  // Settings change → update estimate
  [
    layerHeightInput,
    normalExposureInput,
    bottomLayersInput,
    bottomExposureInput,
    liftHeightInput,
    liftSpeedInput,
  ].forEach((el) => listen(el, 'change', updateEstimate));

  // ─── Profile selector ────────────────────────────────────────────
  const profileSelect = document.getElementById('slice-profile-select') as HTMLSelectElement | null;
  const profileSaveBtn = document.getElementById('profile-save-btn');
  const profileDeleteBtn = document.getElementById('profile-delete-btn') as HTMLElement | null;

  function refreshProfileDropdown(): void {
    if (!profileSelect) return;
    const profiles = allProfiles.value;
    profileSelect.innerHTML = profiles
      .map((p) => `<option value="${p.id}">${p.name}${p.isBuiltIn ? '' : ' ★'}</option>`)
      .join('');
    profileSelect.value = activeProfileId.value;
    if (profileDeleteBtn) {
      const active = profiles.find((p) => p.id === activeProfileId.value);
      profileDeleteBtn.hidden = !active || active.isBuiltIn;
    }
  }

  listen(profileSelect, 'change', () => {
    if (!profileSelect) return;
    activeProfileId.value = profileSelect.value;
    const profile = allProfiles.value.find((p) => p.id === profileSelect.value);
    if (profile) applyProfileToInputs(profile);
    updateEstimate();
    refreshProfileDropdown();
  });

  listen(profileSaveBtn, 'click', () => {
    const name = prompt('Profile name:');
    if (!name) return;
    const params = readInputsAsParams();
    saveProfile(name, params);
    refreshProfileDropdown();
  });

  listen(profileDeleteBtn, 'click', () => {
    const id = activeProfileId.value;
    const profile = allProfiles.value.find((p) => p.id === id);
    if (!profile || profile.isBuiltIn) return;
    if (!confirm(`Delete profile "${profile.name}"?`)) return;
    deleteProfile(id);
    const std = allProfiles.value.find((p) => p.id === 'standard');
    if (std) applyProfileToInputs(std);
    refreshProfileDropdown();
    updateEstimate();
  });

  refreshProfileDropdown();

  // ─── Adaptive layers ─────────────────────────────────────────────
  const adaptiveToggle = document.getElementById(
    'adaptive-layers-toggle',
  ) as HTMLInputElement | null;
  const adaptiveConfig = document.getElementById('adaptive-layers-config');
  const adaptiveMinInput = document.getElementById(
    'adaptive-min-height',
  ) as HTMLInputElement | null;
  const adaptiveMaxInput = document.getElementById(
    'adaptive-max-height',
  ) as HTMLInputElement | null;
  const adaptiveAngleInput = document.getElementById(
    'adaptive-steep-angle',
  ) as HTMLInputElement | null;
  const adaptiveSummary = document.getElementById('adaptive-summary');

  listen(adaptiveToggle, 'change', () => {
    if (adaptiveConfig) adaptiveConfig.hidden = !adaptiveToggle?.checked;
    if (!adaptiveToggle?.checked && adaptiveSummary) adaptiveSummary.textContent = '';
  });

  function previewAdaptive(): void {
    if (!adaptiveToggle?.checked) return;
    const info = viewer.getOverallInfo();
    if (!info || info.count === 0) return;

    const geometry = viewer.getModelGeometry?.() ?? viewer.getMergedModelGeometry?.();
    if (!geometry) return;

    const positions = (geometry as { attributes?: { position?: { array: Float32Array } } })
      .attributes?.position?.array;
    const normals = (geometry as { attributes?: { normal?: { array: Float32Array } } }).attributes
      ?.normal?.array;
    if (!positions || !normals) return;

    const result = computeAdaptiveLayers(positions, normals, info.height, {
      minHeightMM: parseFloat(adaptiveMinInput?.value ?? '0.025'),
      maxHeightMM: parseFloat(adaptiveMaxInput?.value ?? '0.1'),
      steepAngleDeg: parseFloat(adaptiveAngleInput?.value ?? '45'),
    });

    if (adaptiveSummary) adaptiveSummary.textContent = formatAdaptiveSummary(result);
  }

  [adaptiveMinInput, adaptiveMaxInput, adaptiveAngleInput].forEach((el) =>
    listen(el, 'change', previewAdaptive),
  );

  // ─── Dimensional compensation ────────────────────────────────────
  const compToggle = document.getElementById('compensation-toggle') as HTMLInputElement | null;
  const compConfig = document.getElementById('compensation-config');
  const compXY = document.getElementById('compensation-xy') as HTMLInputElement | null;
  const compZ = document.getElementById('compensation-z') as HTMLInputElement | null;
  const compXYVal = document.getElementById('compensation-xy-val');
  const compZVal = document.getElementById('compensation-z-val');

  function syncCompensation(): void {
    const xy = parseFloat(compXY?.value ?? '1');
    const z = parseFloat(compZ?.value ?? '1');
    if (compXYVal) compXYVal.textContent = formatCompensation(xy);
    if (compZVal) compZVal.textContent = formatCompensation(z);
    if (compToggle?.checked) setCompensation({ xyFactor: xy, zFactor: z });
  }

  listen(compToggle, 'change', () => {
    if (compConfig) compConfig.hidden = !compToggle?.checked;
    if (compToggle?.checked) syncCompensation();
    else setCompensation({ xyFactor: 1.0, zFactor: 1.0 });
  });
  listen(compXY, 'input', syncCompensation);
  listen(compZ, 'input', syncCompensation);

  // Init from stored values
  const initComp = compensationFactors.value;
  if (compXY) compXY.value = String(initComp.xyFactor);
  if (compZ) compZ.value = String(initComp.zFactor);
  syncCompensation();

  // ─── Per-region exposure ─────────────────────────────────────────
  const expToggle = document.getElementById('exposure-region-toggle') as HTMLInputElement | null;
  const expConfig = document.getElementById('exposure-region-config');

  listen(expToggle, 'change', () => {
    if (expConfig) expConfig.hidden = !expToggle?.checked;
    const profile = exposureProfile.value;
    setExposureProfile({ ...profile, enabled: !!expToggle?.checked });
  });

  // Display current multiplier labels
  const cosmeticEl = document.getElementById('exposure-cosmetic');
  const hiddenEl = document.getElementById('exposure-hidden');
  const reliabilityEl = document.getElementById('exposure-reliability');
  const removalEl = document.getElementById('exposure-removal');
  const ep = exposureProfile.value;
  if (cosmeticEl) cosmeticEl.textContent = formatExposureMultiplier(ep.multipliers.cosmetic);
  if (hiddenEl) hiddenEl.textContent = formatExposureMultiplier(ep.multipliers.hidden);
  if (reliabilityEl)
    reliabilityEl.textContent = formatExposureMultiplier(ep.multipliers['reliability-critical']);
  if (removalEl)
    removalEl.textContent = formatExposureMultiplier(ep.multipliers['removal-sensitive']);

  // ─── Gyroid infill ───────────────────────────────────────────────
  const gyroidToggle = document.getElementById('gyroid-toggle') as HTMLInputElement | null;
  const gyroidConfig = document.getElementById('gyroid-config');

  listen(gyroidToggle, 'change', () => {
    if (gyroidConfig) gyroidConfig.hidden = !gyroidToggle?.checked;
  });

  return { updateEstimate };
}
