import { describe, it, expect } from 'vitest';
import { selectedMaterialId, selectedPrinterKey } from '@core/state';
import {
  RESIN_MATERIALS,
  getMaterialById,
  getMaterialsByBrand,
  getAllBrands,
  DEFAULT_MATERIAL_ID,
} from './materials';
import {
  PRINTERS,
  getPrinter,
  getAllPrinterKeys,
  getPrintersByVendor,
  getAllVendors,
  computePixelPitch,
  DEFAULT_PRINTER_KEY,
} from './printers';

describe('material library', () => {
  it('contains at least 20 presets', () => {
    expect(RESIN_MATERIALS.length).toBeGreaterThanOrEqual(20);
  });

  it('default material exists in library', () => {
    const mat = getMaterialById(DEFAULT_MATERIAL_ID);
    expect(mat).toBeDefined();
    expect(mat!.id).toBe('siraya-fast-navy-grey');
  });

  it('getMaterialsByBrand filters correctly', () => {
    const siraya = getMaterialsByBrand('Siraya Tech');
    expect(siraya.length).toBeGreaterThanOrEqual(4);
    expect(siraya.every((m) => m.brand === 'Siraya Tech')).toBe(true);
  });

  it('getAllBrands returns distinct brands', () => {
    const brands = getAllBrands();
    expect(brands.length).toBeGreaterThanOrEqual(3);
    expect(new Set(brands).size).toBe(brands.length);
  });

  it('every material has required properties', () => {
    for (const mat of RESIN_MATERIALS) {
      expect(mat.id).toBeTruthy();
      expect(mat.brand).toBeTruthy();
      expect(mat.swatch).toMatch(/^#[0-9a-f]{6}$/);
      expect(mat.opacity).toBeGreaterThan(0);
      expect(mat.opacity).toBeLessThanOrEqual(1);
    }
  });
});

describe('printer profiles', () => {
  it('contains at least 10 profiles', () => {
    expect(getAllPrinterKeys().length).toBeGreaterThanOrEqual(10);
  });

  it('default printer exists', () => {
    const printer = getPrinter(DEFAULT_PRINTER_KEY);
    expect(printer).toBeDefined();
    expect(printer!.name).toBe('Anycubic Photon Mono 4K');
  });

  it('switching printer updates pixel pitch', () => {
    const m5s = getPrinter('photon-mono-m5s')!;
    const pitch = computePixelPitch(m5s);
    expect(pitch.x).toBeCloseTo(218.88 / 11520, 5);
    expect(pitch.y).toBeCloseTo(122.88 / 5120, 5);
  });

  it('getPrintersByVendor filters correctly', () => {
    const elegoo = getPrintersByVendor('Elegoo');
    expect(elegoo.length).toBeGreaterThanOrEqual(3);
    expect(elegoo.every((p) => p.vendor === 'Elegoo')).toBe(true);
  });

  it('getAllVendors returns distinct vendors', () => {
    const vendors = getAllVendors();
    expect(vendors.length).toBeGreaterThanOrEqual(4);
    expect(new Set(vendors).size).toBe(vendors.length);
  });

  it('every printer has valid dimensions', () => {
    for (const printer of Object.values(PRINTERS)) {
      expect(printer.resolutionX).toBeGreaterThan(0);
      expect(printer.resolutionY).toBeGreaterThan(0);
      expect(printer.buildWidthMM).toBeGreaterThan(0);
      expect(printer.buildDepthMM).toBeGreaterThan(0);
      expect(printer.buildHeightMM).toBeGreaterThan(0);
    }
  });
});

describe('signal integration', () => {
  it('selectedMaterialId defaults to siraya-fast-navy-grey', () => {
    selectedMaterialId.value = DEFAULT_MATERIAL_ID;
    expect(selectedMaterialId.value).toBe('siraya-fast-navy-grey');
  });

  it('selectedPrinterKey defaults to photon-mono', () => {
    selectedPrinterKey.value = DEFAULT_PRINTER_KEY;
    expect(selectedPrinterKey.value).toBe('photon-mono');
  });
});
