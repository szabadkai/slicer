import type {
  SliceExporter,
  LayerSource,
  SliceSettings,
  ProgressCallback,
} from '@core/format-registry';
import type { PrinterSpec } from '@core/types';

export const zipSliceExporter: SliceExporter = {
  id: 'zip',
  name: 'PNG Print Package (.zip)',
  extension: 'zip',
  isAvailable(): boolean {
    return true;
  },
  async export(
    source: LayerSource,
    settings: SliceSettings,
    printer: PrinterSpec,
    onProgress?: ProgressCallback,
  ): Promise<Blob> {
    const { exportZipToBlob } = await import('../../../exporter');
    return exportZipToBlob(source, settings, printer, onProgress);
  },
};
