import type { PrinterSpec } from './types';
import type { ParsedGeometry } from '@features/model-io/load';
import type { CompactGrayLayer } from '../png-encode-pool';

// ─── Importer ──────────────────────────────────────────────

export interface FormatImporter {
  id: string;
  name: string;
  extensions: string[];
  parse(buffer: ArrayBuffer, filename: string): Promise<ParsedGeometry>;
}

// ─── Mesh exporter ─────────────────────────────────────────

export interface GeometryLike {
  attributes?: {
    position?: {
      getX(index: number): number;
      getY(index: number): number;
      getZ(index: number): number;
      count: number;
    };
  };
  index?: { array: ArrayLike<number> } | null;
}

export interface MeshExporter {
  id: string;
  name: string;
  extension: string;
  export(geometries: GeometryLike[]): Promise<Blob>;
}

// ─── Slice exporter ────────────────────────────────────────

export type LayerSource =
  | { kind: 'pixels'; layers: Uint8Array[] }
  | { kind: 'compact'; layers: CompactGrayLayer[] }
  | { kind: 'png'; pngs: Uint8Array[] }
  | {
      kind: 'png-renderer';
      layerCount: number;
      renderPngs: (onProgress?: ProgressCallback) => Promise<Uint8Array[]>;
    }
  | {
      kind: 'compact-renderer';
      layerCount: number;
      renderCompactLayers: (onProgress?: ProgressCallback) => Promise<CompactGrayLayer[]>;
    };

export type ProgressCallback = (current: number, total: number, extra?: string) => void;

export interface SliceSettings {
  layerHeight: number;
  normalExposure: number;
  bottomLayers: number;
  bottomExposure: number;
  liftHeight: number;
  liftSpeed: number;
  modelVolumeMm3?: number;
  supportVolumeMm3?: number;
  totalVolumeMm3?: number;
  volumeBreakdownExact?: boolean;
  [key: string]: unknown;
}

export interface SliceExporter {
  id: string;
  name: string;
  extension: string;
  isAvailable(printer: PrinterSpec): boolean;
  export(
    source: LayerSource,
    settings: SliceSettings,
    printer: PrinterSpec,
    onProgress?: ProgressCallback,
  ): Promise<Blob>;
}

// ─── Registry ──────────────────────────────────────────────

class FormatRegistry {
  private importers: FormatImporter[] = [];
  private meshExporters: MeshExporter[] = [];
  private sliceExporters: SliceExporter[] = [];

  registerImporter(importer: FormatImporter): void {
    this.importers.push(importer);
  }

  registerMeshExporter(exporter: MeshExporter): void {
    this.meshExporters.push(exporter);
  }

  registerSliceExporter(exporter: SliceExporter): void {
    this.sliceExporters.push(exporter);
  }

  getImporterForFile(filename: string): FormatImporter | undefined {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    return this.importers.find((i) => i.extensions.includes(ext));
  }

  getSupportedImportExtensions(): string[] {
    return this.importers.flatMap((i) => i.extensions);
  }

  getImporterAcceptString(): string {
    return this.importers.flatMap((i) => i.extensions.map((e) => `.${e}`)).join(',');
  }

  getMeshExporters(): MeshExporter[] {
    return [...this.meshExporters];
  }

  getSliceExporters(printer: PrinterSpec): SliceExporter[] {
    return this.sliceExporters.filter((e) => e.isAvailable(printer));
  }

  getAllSliceExporters(): SliceExporter[] {
    return [...this.sliceExporters];
  }
}

export const formatRegistry = new FormatRegistry();
