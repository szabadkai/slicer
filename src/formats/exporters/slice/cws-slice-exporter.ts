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
import {
  addPngFilesToZip,
  getLayerSourceCount,
  resolveLayerSourcePngs,
  yieldToBrowser,
} from './export-helpers';

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
  const layerCount = getLayerSourceCount(source);

  if (source.kind === 'png') {
    await addPngFilesToZip(
      zip,
      source.pngs,
      (i) => `slice_${String(i).padStart(5, '0')}.png`,
      onProgress,
    );
  } else {
    const { resolutionX, resolutionY } = printer;
    const pngs = await resolveLayerSourcePngs(source, resolutionX, resolutionY, onProgress);
    await addPngFilesToZip(zip, pngs, (i) => `slice_${String(i).padStart(5, '0')}.png`, onProgress);
  }

  zip.file('manifest.gcode', buildGcode(settings, printer, layerCount));

  onProgress?.(layerCount, layerCount, 'Building .cws archive...');
  await yieldToBrowser();

  return zip.generateAsync({ type: 'blob', compression: 'STORE' }, (metadata) => {
    onProgress?.(
      layerCount,
      layerCount,
      `Building .cws archive... ${metadata.percent.toFixed(0)}%`,
    );
  });
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
