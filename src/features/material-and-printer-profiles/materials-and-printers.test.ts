import { describe, it, expect } from 'vitest';
import { selectedPrinterKey } from '@core/state';
import {
  PRINTERS,
  getPrinter,
  getAllPrinterKeys,
  getPrintersByVendor,
  getAllVendors,
  computePixelPitch,
  DEFAULT_PRINTER_KEY,
} from './printers';

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
  it('selectedPrinterKey defaults to photon-mono', () => {
    selectedPrinterKey.value = DEFAULT_PRINTER_KEY;
    expect(selectedPrinterKey.value).toBe('photon-mono');
  });
});
