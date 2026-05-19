import type { AppContext, ProjectState } from '@core/types';
import type { LegacySlicer } from '@core/legacy-types';
import { formatRegistry } from '@core/format-registry';
import type { LayerSource, SliceSettings, ProgressCallback } from '@core/format-registry';
import { listen } from '@features/app-shell/utils';
import {
  showContextMenu,
  hideContextMenu,
  getActiveMenuContext,
} from '@features/app-shell/context-menu';
import { getSlicedLayerCount, getSlicedVolumes } from '@features/app-shell/mount';
import { slicedLayerPngs } from '@features/layer-preview/ops';

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function mountExportPanel(
  ctx: AppContext,
  slicer: LegacySlicer,
  project: ProjectState,
): void {
  const { viewer } = ctx;
  const exportBtn = document.getElementById('export-btn');
  const exportAllBtn = document.getElementById('export-all-btn');

  function getSettings(): SliceSettings {
    return {
      layerHeight: parseFloat(
        (document.getElementById('layer-height') as HTMLInputElement)?.value ?? '0.05',
      ),
      normalExposure: parseFloat(
        (document.getElementById('normal-exposure') as HTMLInputElement)?.value ?? '2',
      ),
      bottomLayers: parseInt(
        (document.getElementById('bottom-layers') as HTMLInputElement)?.value ?? '6',
        10,
      ),
      bottomExposure: parseFloat(
        (document.getElementById('bottom-exposure') as HTMLInputElement)?.value ?? '30',
      ),
      liftHeight: parseFloat(
        (document.getElementById('lift-height') as HTMLInputElement)?.value ?? '8',
      ),
      liftSpeed: parseFloat(
        (document.getElementById('lift-speed') as HTMLInputElement)?.value ?? '3',
      ),
    };
  }

  function buildSettingsWithVolumes(): SliceSettings {
    const settings = getSettings();
    const vols = getSlicedVolumes();
    if (vols) {
      settings.modelVolumeMm3 = vols.model;
      settings.supportVolumeMm3 = vols.supports;
      settings.totalVolumeMm3 = vols.total;
      settings.volumeBreakdownExact = vols.exactBreakdown;
    }
    return settings;
  }

  function buildLayerSource(layerCount: number): LayerSource {
    const cachedPngs = slicedLayerPngs.value;
    const cacheUsable =
      cachedPngs.length === layerCount && cachedPngs.every((p) => p && p.length > 0);

    if (cacheUsable) {
      return { kind: 'png', pngs: cachedPngs };
    }

    const spec = slicer.getPrinterSpec();
    const layerHeight = Number.parseFloat(
      (document.getElementById('layer-height') as HTMLInputElement | null)?.value ?? '0.05',
    );
    const pixelByteCount = spec.resolutionX * spec.resolutionY * 4;
    const layerProvider: Uint8Array[] = new Proxy([] as Uint8Array[], {
      get(target, prop) {
        if (prop === 'length') return layerCount;
        const idx = typeof prop === 'string' ? parseInt(prop, 10) : undefined;
        if (idx !== undefined && !isNaN(idx)) {
          const buf = new Uint8Array(pixelByteCount);
          return slicer.renderLayer(idx, layerHeight, buf);
        }
        return Reflect.get(target, prop);
      },
    });
    return { kind: 'pixels', layers: layerProvider };
  }

  function meshExportItems(): Array<{ action: string; label: string; disabled: boolean }> {
    const disabled = viewer.objects.length === 0;
    return formatRegistry.getMeshExporters().map((exp) => ({
      action: `mesh-${exp.id}`,
      label: `Export ${exp.name}`,
      disabled,
    }));
  }

  function openExportMenu(clientX: number, clientY: number): void {
    const spec = slicer.getPrinterSpec();
    const sliceExporters = formatRegistry.getSliceExporters(spec);
    const hasSlices = getSlicedLayerCount() > 0;

    const sliceItems = sliceExporters.map((exp) => ({
      action: `slice-${exp.id}`,
      label: `Export ${exp.name}`,
      disabled: !hasSlices,
    }));

    showContextMenu(clientX, clientY, {
      title: 'Export',
      context: { type: 'export' },
      items: [
        ...sliceItems,
        {
          action: 'export-all-zip',
          label: 'Export all sliced plates',
          disabled: !project.plates.some((p) => p.slicedLayers),
        },
        ...meshExportItems(),
      ],
    });
  }

  async function handleSliceExport(exporterId: string): Promise<void> {
    const layerCount = getSlicedLayerCount();
    if (layerCount === 0) return;

    const spec = slicer.getPrinterSpec();
    const exporter = formatRegistry.getSliceExporters(spec).find((e) => e.id === exporterId);
    if (!exporter) return;

    const settings = buildSettingsWithVolumes();
    const source = buildLayerSource(layerCount);

    ctx.showProgress(`Exporting .${exporter.extension}...`);
    await new Promise((r) => setTimeout(r, 50));

    const t0 = performance.now();
    const onProgress: ProgressCallback = (current, total, extra) => {
      ctx.updateProgress(current / total, extra ?? `Layer ${current} / ${total}`);
    };

    const blob = await exporter.export(source, settings, spec, onProgress);

    const elapsed = performance.now() - t0;
    const pixelsPerLayer = spec.resolutionX * spec.resolutionY;
    console.warn(
      `[export] ${exporter.id}: ${layerCount} layers, ${pixelsPerLayer} px/layer, ${elapsed.toFixed(0)} ms total, ${(elapsed / layerCount).toFixed(1)} ms/layer`,
    );

    const safeName = spec.name.replace(/\s+/g, '-').toLowerCase();
    downloadBlob(blob, `${safeName}_${layerCount}layers.${exporter.extension}`);

    ctx.hideProgress();
    document.dispatchEvent(new CustomEvent('export-complete'));
  }

  async function handleExportAll(): Promise<void> {
    const startId = project.activePlateId;
    const slicedPlates = project.plates.filter((p) => p.slicedLayers);
    for (let i = 0; i < slicedPlates.length; i++) {
      const plate = slicedPlates[i];
      project.activePlateId = plate.id;
      viewer.setActivePlate(plate);
      ctx.showProgress(`Exporting ${plate.name} (${i + 1} / ${slicedPlates.length})...`);
      await handleSliceExport('zip');
    }
    const startPlate = project.plates.find((p) => p.id === startId);
    if (startPlate) {
      project.activePlateId = startPlate.id;
      viewer.setActivePlate(startPlate);
    }
  }

  async function handleMeshExport(exporterId: string): Promise<void> {
    if (viewer.objects.length === 0) return;

    const exporter = formatRegistry.getMeshExporters().find((e) => e.id === exporterId);
    if (!exporter) return;

    const geometries: unknown[] = [];
    const modelGeo = viewer.getMergedModelGeometry();
    const supportGeo = viewer.getMergedSupportGeometry();
    if (modelGeo) geometries.push(modelGeo);
    if (supportGeo) geometries.push(supportGeo);

    try {
      ctx.showProgress(`Exporting ${exporter.name}...`);
      await new Promise((r) => setTimeout(r, 50));
      const blob = await exporter.export(geometries as Parameters<typeof exporter.export>[0]);
      downloadBlob(blob, `slicelab-plate.${exporter.extension}`);
      document.dispatchEvent(new CustomEvent('export-complete'));
    } catch (error) {
      console.error(`Failed to export ${exporter.id}`, error);
      alert(
        `Failed to export ${exporter.name}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      geometries.forEach((g) => (g as { dispose?(): void }).dispose?.());
      ctx.hideProgress();
    }
  }

  listen(exportBtn, 'click', (e) => {
    e.preventDefault();
    const rect = (exportBtn as HTMLElement).getBoundingClientRect();
    openExportMenu(rect.left, rect.bottom + 4);
  });
  listen(exportAllBtn, 'click', () => {
    handleExportAll();
  });

  listen(viewer.canvas, 'contextmenu', (e) => {
    if (viewer.objects.length === 0) return;
    e.preventDefault();
    showContextMenu((e as MouseEvent).clientX, (e as MouseEvent).clientY, {
      title: 'Export plate mesh',
      context: { type: 'mesh-export' },
      items: meshExportItems(),
    });
  });

  const menu = document.getElementById('context-menu');
  listen(menu, 'click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-menu-action]') as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset.menuAction;
    const menuCtx = getActiveMenuContext();
    if (menuCtx?.type !== 'export' && menuCtx?.type !== 'mesh-export') return;
    hideContextMenu();
    if (action === 'export-all-zip') {
      handleExportAll();
      return;
    }
    if (action?.startsWith('slice-')) {
      handleSliceExport(action.replace('slice-', ''));
      return;
    }
    if (action?.startsWith('mesh-')) {
      handleMeshExport(action.replace('mesh-', ''));
    }
  });
}
