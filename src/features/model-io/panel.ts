/**
 * Export panel — export ZIP, export all, mesh export.
 */
import type { AppContext, ProjectState } from '@core/types';
import type { LegacySlicer } from '@core/legacy-types';
import { listen } from '@features/app-shell/utils';
import {
  showContextMenu,
  hideContextMenu,
  getActiveMenuContext,
} from '@features/app-shell/context-menu';
import { getSlicedLayerCount, getSlicedVolumes } from '@features/app-shell/mount';
import { slicedLayerPngs } from '@features/layer-preview/ops';

export function mountExportPanel(
  ctx: AppContext,
  slicer: LegacySlicer,
  project: ProjectState,
): void {
  const { viewer } = ctx;
  const exportBtn = document.getElementById('export-btn');
  const exportAllBtn = document.getElementById('export-all-btn');

  function getSettings(): Record<string, unknown> {
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

  function meshExportItems(): Array<{ action: string; label: string; disabled: boolean }> {
    const disabled = viewer.objects.length === 0;
    return [
      { action: 'mesh-stl', label: 'Export STL', disabled },
      { action: 'mesh-3mf', label: 'Export 3MF', disabled },
      { action: 'mesh-obj', label: 'Export OBJ', disabled },
    ];
  }

  function openExportMenu(clientX: number, clientY: number): void {
    showContextMenu(clientX, clientY, {
      title: 'Export',
      context: { type: 'export' },
      items: [
        {
          action: 'export-zip',
          label: 'Export print package',
          disabled: getSlicedLayerCount() === 0,
        },
        {
          action: 'export-all-zip',
          label: 'Export all sliced plates',
          disabled: !project.plates.some((p) => p.slicedLayers),
        },
        ...meshExportItems(),
      ],
    });
  }

  async function handleExport(): Promise<void> {
    const layerCount = getSlicedLayerCount();
    if (layerCount === 0) return;

    const exporter = (await import('../../exporter')) as typeof import('../../exporter');
    const exportZip = exporter.exportZip;

    const settings = getSettings();
    const vols = getSlicedVolumes();
    if (vols) {
      settings.modelVolumeMm3 = vols.model;
      settings.supportVolumeMm3 = vols.supports;
      settings.totalVolumeMm3 = vols.total;
      settings.volumeBreakdownExact = vols.exactBreakdown;
    }
    const spec = slicer.getPrinterSpec();
    const layerHeight = Number.parseFloat(
      (document.getElementById('layer-height') as HTMLInputElement | null)?.value ?? '0.05',
    );

    ctx.showProgress('Exporting...');
    await new Promise((r) => setTimeout(r, 50));

    const t0 = performance.now();
    const cachedPngs = slicedLayerPngs.value;
    const cacheUsable =
      cachedPngs.length === layerCount && cachedPngs.every((p) => p && p.length > 0);

    if (cacheUsable) {
      // Fast path — slicing already produced PNG bytes; just zip and download.
      await exportZip(
        { kind: 'png', pngs: cachedPngs },
        settings as unknown as Parameters<typeof exportZip>[1],
        spec,
        (current, total, extra) => {
          ctx.updateProgress(current / total, extra ?? `Layer ${current} / ${total}`);
        },
      );
    } else {
      // Fallback — re-render layers on demand. Allocate a *fresh* buffer per
      // layer so the worker pool can transfer it (zero-copy).
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

      await exportZip(
        { kind: 'pixels', layers: layerProvider },
        settings as unknown as Parameters<typeof exportZip>[1],
        spec,
        (current, total, extra) => {
          ctx.updateProgress(current / total, extra ?? `Encoding layer ${current} / ${total}`);
        },
      );
    }

    const elapsed = performance.now() - t0;
    const pixelsPerLayer = spec.resolutionX * spec.resolutionY;
    console.warn(
      `[export] ${layerCount} layers, ${pixelsPerLayer} px/layer, ${elapsed.toFixed(0)} ms total, ${(elapsed / layerCount).toFixed(1)} ms/layer, cache=${cacheUsable}`,
    );

    ctx.hideProgress();
  }

  async function handleExportAll(): Promise<void> {
    const startId = project.activePlateId;
    const slicedPlates = project.plates.filter((p) => p.slicedLayers);
    for (let i = 0; i < slicedPlates.length; i++) {
      const plate = slicedPlates[i];
      project.activePlateId = plate.id;
      viewer.setActivePlate(plate);
      ctx.showProgress(`Exporting ${plate.name} (${i + 1} / ${slicedPlates.length})...`);
      await handleExport();
    }
    const startPlate = project.plates.find((p) => p.id === startId);
    if (startPlate) {
      project.activePlateId = startPlate.id;
      viewer.setActivePlate(startPlate);
    }
  }

  async function handleMeshExport(format: string): Promise<void> {
    if (viewer.objects.length === 0) return;

    const { exportMesh } = (await import('../../exporter')) as unknown as {
      exportMesh: (geos: unknown[], format: string, name: string) => Promise<void>;
    };

    const geometries: unknown[] = [];
    const modelGeo = viewer.getMergedModelGeometry();
    const supportGeo = viewer.getMergedSupportGeometry();
    if (modelGeo) geometries.push(modelGeo);
    if (supportGeo) geometries.push(supportGeo);

    try {
      ctx.showProgress(`Exporting ${format.toUpperCase()}...`);
      await new Promise((r) => setTimeout(r, 50));
      await exportMesh(geometries, format, 'slicelab-plate');
    } catch (error) {
      console.error(`Failed to export ${format}`, error);
      alert(
        `Failed to export ${format.toUpperCase()}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      geometries.forEach((g) => (g as { dispose?(): void }).dispose?.());
      ctx.hideProgress();
    }
  }

  // Wire export button
  listen(exportBtn, 'click', (e) => {
    e.preventDefault();
    const rect = (exportBtn as HTMLElement).getBoundingClientRect();
    openExportMenu(rect.left, rect.bottom + 4);
  });
  listen(exportAllBtn, 'click', () => {
    handleExportAll();
  });

  // Canvas right-click for mesh export
  listen(viewer.canvas, 'contextmenu', (e) => {
    if (viewer.objects.length === 0) return;
    e.preventDefault();
    showContextMenu((e as MouseEvent).clientX, (e as MouseEvent).clientY, {
      title: 'Export plate mesh',
      context: { type: 'mesh-export' },
      items: meshExportItems(),
    });
  });

  // Handle context menu actions for export
  const menu = document.getElementById('context-menu');
  listen(menu, 'click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-menu-action]') as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset.menuAction;
    const menuCtx = getActiveMenuContext();
    if (menuCtx?.type !== 'export' && menuCtx?.type !== 'mesh-export') return;
    hideContextMenu();
    if (action === 'export-zip') {
      handleExport();
      return;
    }
    if (action === 'export-all-zip') {
      handleExportAll();
      return;
    }
    if (action?.startsWith('mesh-')) {
      handleMeshExport(action.replace('mesh-', ''));
    }
  });
}
