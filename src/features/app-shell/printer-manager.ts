/**
 * Printer management — applying printer specs, updating UI, managing plate layout.
 */
import type { PrinterSpec, ProjectState } from '@core/types';
import type { LegacyViewer, LegacyPlate, LegacySlicer } from '@core/legacy-types';

export interface PrinterManager {
  selectedPrinterKey: () => string;
  applyPrinter: (printerKey: string, opts?: { resetSlice?: boolean }) => void;
  layoutPlateOrigins: () => void;
}

export interface PrinterManagerDeps {
  viewer: LegacyViewer;
  slicer: LegacySlicer;
  project: ProjectState;
  printers: Record<string, PrinterSpec>;
  syncSliceRefs: () => void;
  onPrinterApplied: () => void;
}

const PLATE_SPACING_MM = 20;

function updatePrinterUI(printerKey: string, spec: PrinterSpec): void {
  const nameEl = document.getElementById('selected-printer-name');
  const specEl = document.getElementById('selected-printer-spec');
  if (nameEl) nameEl.textContent = spec.name;
  if (specEl) {
    specEl.textContent = `${spec.buildWidthMM} × ${spec.buildDepthMM} × ${spec.buildHeightMM} mm · ${spec.resolutionX} × ${spec.resolutionY}`;
  }

  const grid = document.getElementById('printer-grid');
  grid?.querySelectorAll('.printer-card').forEach((card) => {
    const el = card as HTMLElement;
    const active = el.dataset.printer === printerKey;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

export function createPrinterManager(deps: PrinterManagerDeps): PrinterManager {
  const { viewer, slicer, project, printers } = deps;
  let currentKey = 'photon-mono';

  function layoutPlateOrigins(): void {
    const spec = printers[currentKey] ?? Object.values(printers)[0];
    if (!spec) return;
    const spacing = spec.buildWidthMM + PLATE_SPACING_MM;
    project.plates.forEach((plate: LegacyPlate, i: number) => {
      plate.originX = i * spacing;
      plate.originZ = 0;
    });
  }

  function applyPrinter(printerKey: string, opts: { resetSlice?: boolean } = {}): void {
    const resetSlice = opts.resetSlice !== false;
    if (!printers[printerKey]) return;

    currentKey = printerKey;
    const spec = printers[printerKey];
    slicer.setPrinter(printerKey);
    layoutPlateOrigins();
    viewer.setPlates(project.plates);
    viewer.setPrinter(spec);
    if (project.plates.length > 1) viewer.frameAllPlates();

    updatePrinterUI(printerKey, spec);

    if (resetSlice) {
      project.plates.forEach((p: LegacyPlate) => {
        p.slicedLayers = null;
        p.slicedVolumes = null;
        p.dirty = true;
      });
      deps.syncSliceRefs();
    }

    deps.onPrinterApplied();
  }

  return {
    selectedPrinterKey: () => currentKey,
    applyPrinter,
    layoutPlateOrigins,
  };
}
