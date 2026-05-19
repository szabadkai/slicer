/**
 * CWS (CreationWorkshop) slice exporter.
 *
 * Format: ZIP archive containing:
 *   - PNG layer images (named slice_NNNNN.png)
 *   - manifest.gcode — GCode header with print parameters + per-layer commands
 *
 * Compatible with Wanhao D7/D8, Peopoly Moai, and various open-source
 * DLP printers that accept CreationWorkshop-style files.
 */
import type {
  SliceExporter,
  LayerSource,
  SliceSettings,
  ProgressCallback,
} from '@core/format-registry';
import type { PrinterSpec } from '@core/types';

function buildGcode(settings: SliceSettings, printer: PrinterSpec, layerCount: number): string {
  const lines: string[] = [];
  const liftH = settings.liftHeight ?? 8;
  const liftS = (settings.liftSpeed ?? 3) * 60; // mm/min

  lines.push(';START_GCODE_BEGIN');
  lines.push('G28 ; home');
  lines.push('G21 ; mm units');
  lines.push('G91 ; relative positioning');
  lines.push('M106 S0 ; UV off');
  lines.push(';START_GCODE_END');
  lines.push('');
  lines.push(`; printer: ${printer.name}`);
  lines.push(`; resolution: ${printer.resolutionX}x${printer.resolutionY}`);
  lines.push(`; layerHeight: ${settings.layerHeight} mm`);
  lines.push(`; normalExposure: ${settings.normalExposure} s`);
  lines.push(`; bottomExposure: ${settings.bottomExposure} s`);
  lines.push(`; bottomLayers: ${settings.bottomLayers}`);
  lines.push(`; totalLayers: ${layerCount}`);
  lines.push('');

  for (let i = 0; i < layerCount; i++) {
    const isBottom = i < settings.bottomLayers;
    const exposure = isBottom ? settings.bottomExposure : settings.normalExposure;
    const exposureMs = Math.round(exposure * 1000);
    const layerNum = String(i).padStart(5, '0');

    lines.push(`;LAYER_START:${i}`);
    lines.push(`;<Slice> slice_${layerNum}.png`);

    if (i > 0) {
      lines.push(`G1 Z${liftH.toFixed(2)} F${liftS.toFixed(0)} ; lift`);
      lines.push(`G1 Z-${(liftH - settings.layerHeight).toFixed(4)} F${liftS.toFixed(0)} ; lower`);
    } else {
      lines.push(`G1 Z${settings.layerHeight.toFixed(4)} F${liftS.toFixed(0)} ; first layer`);
    }

    lines.push(`;<Delay> ${exposureMs}`);
    lines.push(`M106 S255 ; UV on`);
    lines.push(`G4 P${exposureMs} ; expose`);
    lines.push(`M106 S0 ; UV off`);
    lines.push(`;LAYER_END`);
    lines.push('');
  }

  lines.push(';END_GCODE_BEGIN');
  lines.push('M106 S0 ; UV off');
  lines.push('G1 Z40 F60 ; raise platform');
  lines.push('M18 ; motors off');
  lines.push(';END_GCODE_END');
  lines.push('');

  return lines.join('\n');
}

async function buildCwsBlob(
  source: LayerSource,
  settings: SliceSettings,
  printer: PrinterSpec,
  onProgress?: ProgressCallback,
): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const layerCount = source.kind === 'pixels' ? source.layers.length : source.pngs.length;

  if (source.kind === 'png') {
    for (let i = 0; i < layerCount; i++) {
      onProgress?.(i + 1, layerCount, `Packing layer ${i + 1} / ${layerCount}`);
      const name = String(i).padStart(5, '0');
      zip.file(`slice_${name}.png`, source.pngs[i], { compression: 'STORE' });
    }
  } else {
    const { getSharedPngEncodePool } = await import('../../../png-encode-pool');
    const pool = getSharedPngEncodePool();
    const { resolutionX, resolutionY } = printer;
    const maxInFlight = 8;
    const pngs: Uint8Array[] = new Array(layerCount);
    let dispatched = 0;
    let completed = 0;

    await new Promise<void>((resolve, reject) => {
      const dispatch = (): void => {
        while (dispatched < layerCount && dispatched - completed < maxInFlight) {
          const i = dispatched++;
          const rgba = source.layers[i];
          onProgress?.(completed + 1, layerCount, `Encoding layer ${i + 1} / ${layerCount}`);
          pool
            .encode(rgba, resolutionX, resolutionY)
            .then((png) => {
              pngs[i] = png;
              completed++;
              if (completed === layerCount) resolve();
              else dispatch();
            })
            .catch(reject);
        }
      };
      dispatch();
    });

    for (let i = 0; i < layerCount; i++) {
      const name = String(i).padStart(5, '0');
      zip.file(`slice_${name}.png`, pngs[i], { compression: 'STORE' });
    }
  }

  zip.file('manifest.gcode', buildGcode(settings, printer, layerCount));

  onProgress?.(layerCount, layerCount, 'Building .cws archive...');
  await new Promise((r) => setTimeout(r, 0));

  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

export const cwsSliceExporter: SliceExporter = {
  id: 'cws',
  name: 'CWS (CreationWorkshop)',
  extension: 'cws',
  isAvailable(): boolean {
    return true;
  },
  async export(
    source: LayerSource,
    settings: SliceSettings,
    printer: PrinterSpec,
    onProgress?: ProgressCallback,
  ): Promise<Blob> {
    return buildCwsBlob(source, settings, printer, onProgress);
  },
};
