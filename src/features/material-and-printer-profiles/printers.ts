import type { PrinterSpec } from '@core/types';

export interface PrinterProfile extends PrinterSpec {
  key: string;
  vendor: string;
  image: string;
  description: string;
}

export const PRINTERS: Record<string, PrinterProfile> = {
  'photon-mono': {
    key: 'photon-mono',
    name: 'Anycubic Photon Mono 4K',
    vendor: 'Anycubic',
    image: 'printers/anycubic-photon-mono-4k.jpg',
    description: '6.23" mono LCD, 35μm XY resolution',
    resolutionX: 2560,
    resolutionY: 1620,
    buildWidthMM: 130,
    buildDepthMM: 80,
    buildHeightMM: 165,
  },
  'photon-mono-m5s': {
    key: 'photon-mono-m5s',
    name: 'Anycubic Photon Mono M5s',
    vendor: 'Anycubic',
    image: 'printers/anycubic-photon-mono-m5s.jpg',
    description: '10.1" mono LCD, 19μm XY resolution',
    resolutionX: 11520,
    resolutionY: 5120,
    buildWidthMM: 218.88,
    buildDepthMM: 122.88,
    buildHeightMM: 200,
  },
  'mars-3': {
    key: 'mars-3',
    name: 'Elegoo Mars 3',
    vendor: 'Elegoo',
    image: 'printers/elegoo-mars-3.jpg',
    description: '6.66" 4K mono LCD, 35μm XY resolution',
    resolutionX: 4098,
    resolutionY: 2560,
    buildWidthMM: 143,
    buildDepthMM: 89.6,
    buildHeightMM: 175,
  },
  'mars-4-ultra': {
    key: 'mars-4-ultra',
    name: 'Elegoo Mars 4 Ultra',
    vendor: 'Elegoo',
    image: 'printers/elegoo-mars-4-ultra.jpg',
    description: '7" 9K mono LCD, 18μm XY resolution',
    resolutionX: 8520,
    resolutionY: 4320,
    buildWidthMM: 153.36,
    buildDepthMM: 77.76,
    buildHeightMM: 165,
  },
  'saturn-2': {
    key: 'saturn-2',
    name: 'Elegoo Saturn 2',
    vendor: 'Elegoo',
    image: 'printers/elegoo-saturn-2.jpg',
    description: '10" 8K mono LCD, 28.5μm XY resolution',
    resolutionX: 7680,
    resolutionY: 4320,
    buildWidthMM: 218.88,
    buildDepthMM: 123.12,
    buildHeightMM: 250,
  },
  'halot-mage-8k': {
    key: 'halot-mage-8k',
    name: 'Creality HALOT-MAGE 8K',
    vendor: 'Creality',
    image: 'printers/creality-halot-mage-8k.jpg',
    description: '10.3" 8K mono LCD, 29.7μm XY resolution',
    resolutionX: 7680,
    resolutionY: 4320,
    buildWidthMM: 228,
    buildDepthMM: 128,
    buildHeightMM: 230,
  },
  'uniformation-gktwo': {
    key: 'uniformation-gktwo',
    name: 'UniFormation GKtwo',
    vendor: 'UniFormation',
    image: 'printers/uniformation-gktwo.png',
    description: '10.3" 8K mono LCD, 29.7μm XY resolution',
    resolutionX: 7680,
    resolutionY: 4320,
    buildWidthMM: 228,
    buildDepthMM: 128,
    buildHeightMM: 245,
  },
  'sonic-mini-8k': {
    key: 'sonic-mini-8k',
    name: 'Phrozen Sonic Mini 8K',
    vendor: 'Phrozen',
    image: 'printers/phrozen-sonic-mini-8k.png',
    description: '7.1" 8K mono LCD, 22μm XY resolution',
    resolutionX: 7500,
    resolutionY: 3300,
    buildWidthMM: 165,
    buildDepthMM: 72,
    buildHeightMM: 180,
  },
  'sonic-mighty-8k': {
    key: 'sonic-mighty-8k',
    name: 'Phrozen Sonic Mighty 8K',
    vendor: 'Phrozen',
    image: 'printers/phrozen-sonic-mighty-8k.png',
    description: '10" 8K mono LCD, 29μm XY resolution',
    resolutionX: 7680,
    resolutionY: 4320,
    buildWidthMM: 223,
    buildDepthMM: 126,
    buildHeightMM: 235,
  },
  'form-4': {
    key: 'form-4',
    name: 'Formlabs Form 4',
    vendor: 'Formlabs',
    image: 'printers/formlabs-form-4.jpg',
    description: 'Low Force Display, 50μm XY resolution',
    resolutionX: 4000,
    resolutionY: 2500,
    buildWidthMM: 200,
    buildDepthMM: 125,
    buildHeightMM: 210,
  },
};

export const DEFAULT_PRINTER_KEY = 'photon-mono';

export function getPrinter(key: string): PrinterProfile | undefined {
  return PRINTERS[key];
}

export function getAllPrinterKeys(): string[] {
  return Object.keys(PRINTERS);
}

export function getPrintersByVendor(vendor: string): PrinterProfile[] {
  return Object.values(PRINTERS).filter((p) => p.vendor === vendor);
}

export function getAllVendors(): string[] {
  return [...new Set(Object.values(PRINTERS).map((p) => p.vendor))];
}

export function computePixelPitch(printer: PrinterProfile): { x: number; y: number } {
  return {
    x: printer.buildWidthMM / printer.resolutionX,
    y: printer.buildDepthMM / printer.resolutionY,
  };
}
