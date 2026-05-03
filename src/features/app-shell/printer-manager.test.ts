import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrinterManager, type PrinterManagerDeps } from './printer-manager';
import type { PrinterSpec } from '@core/types';
import type { LegacyPlate } from '@core/legacy-types';

function makePlate(id: string): LegacyPlate {
  return {
    id,
    name: `Plate ${id}`,
    objects: [],
    selectedIds: [],
    originX: 0,
    originZ: 0,
    dirty: false,
    slicedLayers: null,
    slicedVolumes: null,
  };
}

const PRINTERS: Record<string, PrinterSpec> = {
  'photon-mono': {
    name: 'Photon Mono',
    resolutionX: 2560,
    resolutionY: 1620,
    buildWidthMM: 130,
    buildDepthMM: 80,
    buildHeightMM: 165,
  },
  'mars-3': {
    name: 'Mars 3',
    resolutionX: 4098,
    resolutionY: 2560,
    buildWidthMM: 143,
    buildDepthMM: 89.6,
    buildHeightMM: 175,
  },
};

function makeDeps(overrides: Partial<PrinterManagerDeps> = {}): PrinterManagerDeps {
  return {
    viewer: {
      setPlates: vi.fn(),
      setPrinter: vi.fn(),
      frameAllPlates: vi.fn(),
    } as unknown as PrinterManagerDeps['viewer'],
    slicer: {
      setPrinter: vi.fn(),
    } as unknown as PrinterManagerDeps['slicer'],
    project: { plates: [makePlate('p1')], activePlateId: 'p1' },
    printers: PRINTERS,
    syncSliceRefs: vi.fn(),
    onPrinterApplied: vi.fn(),
    ...overrides,
  };
}

describe('createPrinterManager', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns default printer key', () => {
    const deps = makeDeps();
    const mgr = createPrinterManager(deps);
    expect(mgr.selectedPrinterKey()).toBe('photon-mono');
  });

  it('applyPrinter updates the selected key', () => {
    const deps = makeDeps();
    const mgr = createPrinterManager(deps);
    mgr.applyPrinter('mars-3');
    expect(mgr.selectedPrinterKey()).toBe('mars-3');
  });

  it('applyPrinter calls slicer.setPrinter', () => {
    const deps = makeDeps();
    const mgr = createPrinterManager(deps);
    mgr.applyPrinter('mars-3');
    expect(deps.slicer.setPrinter).toHaveBeenCalledWith('mars-3');
  });

  it('applyPrinter calls viewer.setPrinter with spec', () => {
    const deps = makeDeps();
    const mgr = createPrinterManager(deps);
    mgr.applyPrinter('mars-3');
    expect(deps.viewer.setPrinter).toHaveBeenCalledWith(PRINTERS['mars-3']);
  });

  it('applyPrinter ignores unknown printer key', () => {
    const deps = makeDeps();
    const mgr = createPrinterManager(deps);
    mgr.applyPrinter('nonexistent');
    expect(mgr.selectedPrinterKey()).toBe('photon-mono');
    expect(deps.slicer.setPrinter).not.toHaveBeenCalled();
  });

  it('applyPrinter resets slice state by default', () => {
    const plate = makePlate('p1');
    plate.slicedLayers = [new Uint8Array(4)];
    const deps = makeDeps({ project: { plates: [plate], activePlateId: 'p1' } });
    const mgr = createPrinterManager(deps);
    mgr.applyPrinter('mars-3');
    expect(plate.slicedLayers).toBeNull();
    expect(plate.dirty).toBe(true);
    expect(deps.syncSliceRefs).toHaveBeenCalledOnce();
  });

  it('applyPrinter skips reset when resetSlice=false', () => {
    const plate = makePlate('p1');
    plate.slicedLayers = [new Uint8Array(4)];
    const deps = makeDeps({ project: { plates: [plate], activePlateId: 'p1' } });
    const mgr = createPrinterManager(deps);
    mgr.applyPrinter('mars-3', { resetSlice: false });
    expect(plate.slicedLayers).not.toBeNull();
    expect(deps.syncSliceRefs).not.toHaveBeenCalled();
  });

  it('applyPrinter calls onPrinterApplied', () => {
    const deps = makeDeps();
    const mgr = createPrinterManager(deps);
    mgr.applyPrinter('mars-3');
    expect(deps.onPrinterApplied).toHaveBeenCalledOnce();
  });

  it('layoutPlateOrigins spaces plates by build width + 20mm', () => {
    const plates = [makePlate('p1'), makePlate('p2'), makePlate('p3')];
    const deps = makeDeps({ project: { plates, activePlateId: 'p1' } });
    const mgr = createPrinterManager(deps);
    mgr.layoutPlateOrigins();

    // photon-mono: buildWidthMM=130, spacing = 130+20 = 150
    expect(plates[0].originX).toBe(0);
    expect(plates[1].originX).toBe(150);
    expect(plates[2].originX).toBe(300);
    expect(plates[0].originZ).toBe(0);
  });

  it('applyPrinter frames all plates when multiple exist', () => {
    const plates = [makePlate('p1'), makePlate('p2')];
    const deps = makeDeps({ project: { plates, activePlateId: 'p1' } });
    const mgr = createPrinterManager(deps);
    mgr.applyPrinter('photon-mono');
    expect(deps.viewer.frameAllPlates).toHaveBeenCalled();
  });

  it('applyPrinter does not frame when single plate', () => {
    const deps = makeDeps();
    const mgr = createPrinterManager(deps);
    mgr.applyPrinter('photon-mono');
    expect(deps.viewer.frameAllPlates).not.toHaveBeenCalled();
  });
});
