/**
 * App mount — wires all feature panels to the DOM and orchestrates lifecycle.
 * This is the main glue layer that replaces the 4500-line main.js.
 */
import type { AppContext, PrinterSpec, ProjectState } from '@core/types';
import type { LegacyPlate, SlicedVolumes } from '@core/legacy-types';
import { slicedLayerCount, slicedVolumes, inspectorAreaData } from '@core/state';
import { mountShell } from './shell';
import { mountContextMenu } from './context-menu';
import { mountFileHandling } from './file-handling';
import { mountPreferences } from './preferences';
import { mountMaterialPanel } from '@features/material-selection/panel';
import { mountPrinterPanel } from '@features/material-and-printer-profiles/panel';
import { mountPlatePanel } from '@features/multi-plate-project/panel';
import { mountTransformPanel } from '@features/model-transform/panel';
import { mountSlicePanel } from '@features/gpu-slicing/panel';
import { mountLayerPreview } from '@features/layer-preview/panel';
import { mountHollowDrainPanel } from '@features/hollow-drain/panel';
import { mountSupportPanel } from '@features/support-generation/panel';
import { mountExplanationInspector } from '@features/support-generation/explanation-inspector';
import { mountOrientationPanel } from '@features/auto-orientation/panel';
import { mountExportPanel } from '@features/model-io/panel';
import { mountHealthPanel } from '@features/mesh-health/panel';
import { mountPaintPanel } from '@features/paint-tool/panel';
import { mountIntentPanel } from '@features/surface-intent/panel';
import { mountPrimitiveBoolean } from '@features/primitive-boolean/mount';
import { listen } from './utils';
import { createPrinterManager } from './printer-manager';

export function getSlicedLayerCount(): number {
  return slicedLayerCount.value;
}
export function setSlicedLayerCount(count: number): void {
  slicedLayerCount.value = count;
}
export function getSlicedVolumes(): SlicedVolumes | null {
  return slicedVolumes.value;
}
export function setSlicedVolumes(v: SlicedVolumes | null): void {
  slicedVolumes.value = v;
}
export function getInspectorAreaData(): Float64Array | null {
  return inspectorAreaData.value;
}
export function setInspectorAreaData(d: Float64Array | null): void {
  inspectorAreaData.value = d;
}

export function mountApp(ctx: AppContext, PRINTERS: Record<string, PrinterSpec>): void {
  const { viewer, slicer, project } = ctx;

  // ─── Helper: get/set active plate ────────────────────
  function getActivePlate(): LegacyPlate {
    return project.plates.find((p) => p.id === project.activePlateId) ?? project.plates[0];
  }

  function saveSliceRefsToActivePlate(): void {
    const plate = getActivePlate();
    plate.slicedLayerCount = slicedLayerCount.value;
    plate.slicedLayers = slicedLayerCount.value > 0 ? [] : null;
    plate.slicedVolumes = slicedVolumes.value;
  }

  function syncSliceRefsFromActivePlate(): void {
    const plate = getActivePlate();
    slicedLayerCount.value = plate.slicedLayerCount ?? 0;
    slicedVolumes.value = plate.slicedVolumes ?? null;
    inspectorAreaData.value = null;
  }

  function clearActivePlateSlice(): void {
    slicedLayerCount.value = 0;
    slicedVolumes.value = null;
    inspectorAreaData.value = null;
    const plate = getActivePlate();
    plate.slicedLayers = null;
    plate.slicedLayerCount = 0;
    plate.slicedVolumes = null;
    plate.dirty = true;
    const layerPanel = document.getElementById('layer-preview-panel');
    if (layerPanel) layerPanel.hidden = true;
  }

  // Wire into ctx so panels can call these
  ctx.clearActivePlateSlice = clearActivePlateSlice;

  // ─── Printer management ──────────────────────────────
  const printerManager = createPrinterManager({
    viewer,
    slicer,
    project,
    printers: PRINTERS,
    syncSliceRefs: syncSliceRefsFromActivePlate,
    onPrinterApplied: () => {
      ctx.updateEstimate();
      viewer.updateBoundsWarning();
      ctx.scheduleSavePreferences();
    },
  });
  const { selectedPrinterKey, applyPrinter, layoutPlateOrigins } = printerManager;

  // ─── Material tracking ───────────────────────────────
  let _selectedMaterialId = 'siraya-fast-navy-grey';
  function selectedMaterialId(): string {
    return _selectedMaterialId;
  }
  function setSelectedMaterialId(id: string): void {
    _selectedMaterialId = id;
  }

  // ─── Mount all panels ────────────────────────────────
  const { showToolPanel, getActiveToolPanel } = mountShell(ctx);
  ctx.showToolPanel = showToolPanel;

  mountContextMenu();
  mountFileHandling(ctx);
  mountMaterialPanel(ctx, selectedMaterialId, setSelectedMaterialId);
  mountPrinterPanel(ctx, applyPrinter, PRINTERS);
  mountTransformPanel(ctx);
  const { renderPlateTabs } = mountPlatePanel(
    ctx,
    project,
    getActivePlate,
    saveSliceRefsToActivePlate,
    syncSliceRefsFromActivePlate,
    clearActivePlateSlice,
    layoutPlateOrigins,
  );
  ctx.renderPlateTabs = renderPlateTabs;

  const { updateEstimate } = mountSlicePanel(
    ctx,
    slicer,
    project,
    getActivePlate,
    saveSliceRefsToActivePlate,
  );
  ctx.updateEstimate = updateEstimate;

  mountLayerPreview(ctx, slicer);
  mountHollowDrainPanel(ctx);
  mountSupportPanel(ctx);
  mountExplanationInspector(document.body);
  mountOrientationPanel(ctx);
  mountExportPanel(ctx, slicer, project);
  mountHealthPanel(ctx);
  mountPaintPanel(ctx);
  mountIntentPanel(ctx);
  mountPrimitiveBoolean(ctx);

  // ─── Preferences & autosave ──────────────────────────
  const { scheduleSavePreferences, scheduleProjectAutosave } = mountPreferences(
    ctx,
    project,
    PRINTERS,
    applyPrinter,
    selectedPrinterKey,
    setSelectedMaterialId,
    getActivePlate,
    getActiveToolPanel,
    showToolPanel,
  );
  ctx.scheduleSavePreferences = scheduleSavePreferences;
  ctx.scheduleProjectAutosave = scheduleProjectAutosave;

  // ─── Clear autosave button ───────────────────────────
  listen(document.getElementById('clear-autosave-btn'), 'click', () => {
    import('../../project-store')
      .then(({ deleteAutosavedProject }) => {
        deleteAutosavedProject().catch(() => {});
      })
      .catch(() => {});
    import('@features/model-io/autosave')
      .then(({ discardSnapshot }) => {
        discardSnapshot();
      })
      .catch(() => {});
  });

  // ─── Canvas event wiring ─────────────────────────────
  mountCanvasEvents(ctx, project, getActivePlate, clearActivePlateSlice, renderPlateTabs);

  // ─── Apply initial printer and load default ──────────
  applyPrinter(selectedPrinterKey(), { resetSlice: false });

  // Restore autosaved project or load default model
  restoreOrLoadDefault(project, renderPlateTabs, layoutPlateOrigins, viewer);
}

function mountCanvasEvents(
  ctx: AppContext,
  _project: import('@core/types').ProjectState,
  _getActivePlate: () => LegacyPlate,
  clearActivePlateSlice: () => void,
  renderPlateTabs: () => void,
): void {
  const { viewer } = ctx;
  const canvas = viewer.canvas;

  listen(canvas, 'selection-changed', () => {
    // No hard lockouts — all toolbar panels always selectable.
    // Only disable inline action buttons that need a selection target.
    const hasSel = viewer.selected.length > 0;
    const btns: Record<string, boolean> = {
      'duplicate-btn': !hasSel,
      'delete-btn': !hasSel,
      'fill-btn': viewer.selected.length !== 1,
    };
    for (const [id, disabled] of Object.entries(btns)) {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      if (el) {
        el.disabled = disabled;
        el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
      }
    }

    ctx.updateEstimate();
    renderPlateTabs();
  });

  listen(canvas, 'mesh-changed', () => {
    clearActivePlateSlice();
    ctx.updateEstimate();
    viewer.updateBoundsWarning();
    renderPlateTabs();
  });

  listen(canvas, 'paint-changed', () => {
    clearActivePlateSlice();
    ctx.updateEstimate();
    renderPlateTabs();
  });

  listen(canvas, 'plate-changed', ((e: CustomEvent) => {
    const plate = e.detail?.plate as LegacyPlate | undefined;
    if (!plate) return;
    _project.activePlateId = plate.id;
    ctx.updateEstimate();
    renderPlateTabs();
  }) as EventListener);
}

async function restoreOrLoadDefault(
  project: ProjectState,
  renderPlateTabs: () => void,
  layoutPlateOrigins: () => void,
  viewer: AppContext['viewer'],
): Promise<void> {
  try {
    const { loadAutosavedProject } = await import('../../project-store');
    const snapshot = await loadAutosavedProject();
    if (snapshot && snapshot.plates.some((p) => p.objects.length > 0)) {
      // Restore plates from snapshot
      const restoredPlates: LegacyPlate[] = snapshot.plates.map((sp) => ({
        id: sp.id,
        name: sp.name,
        objects: viewer.restoreSerializedObjects(sp.objects),
        selectedIds: [],
        originX: sp.originX,
        originZ: sp.originZ,
        dirty: true,
        slicedLayers: null,
        slicedVolumes: null,
      }));
      project.plates = restoredPlates;
      project.activePlateId = snapshot.activePlateId || restoredPlates[0].id;
      viewer.setPlates(project.plates);
      viewer.setActivePlate(
        project.plates.find((p) => p.id === project.activePlateId) ?? project.plates[0],
      );
      layoutPlateOrigins();
      renderPlateTabs();
      viewer.requestRender();
      return;
    }
  } catch {
    console.warn('Could not restore autosaved project');
  }
  // Fallback: load default model
  try {
    const base = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL;
    const resp = await fetch(base + 'models/d20v2_thick.stl');
    if (!resp.ok) return;
    const buffer = await resp.arrayBuffer();
    viewer.loadSTL(buffer, 2);
  } catch {
    console.warn('Could not load default model');
  }
}
