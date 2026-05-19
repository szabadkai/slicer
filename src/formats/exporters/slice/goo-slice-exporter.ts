import type {
  SliceExporter,
  LayerSource,
  SliceSettings,
  ProgressCallback,
} from '@core/format-registry';
import type { PrinterSpec } from '@core/types';

export const gooSliceExporter: SliceExporter = {
  id: 'goo',
  name: 'Elegoo Native (.goo)',
  extension: 'goo',
  isAvailable(printer: PrinterSpec): boolean {
    return printer.name.toLowerCase().startsWith('elegoo');
  },
  async export(
    source: LayerSource,
    settings: SliceSettings,
    printer: PrinterSpec,
    onProgress?: ProgressCallback,
  ): Promise<Blob> {
    const { exportGooToBlob } = await import('../../../goo-exporter');
    return exportGooToBlob(source, settings, printer, onProgress);
  },
};
