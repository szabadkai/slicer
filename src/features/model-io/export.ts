import type { PrinterSpec, SliceParams } from '@core/types';

export interface ExportManifest {
  printer: string;
  resolutionX: number;
  resolutionY: number;
  layerCount: number;
  layerHeightMM: number;
  normalExposureS: number;
  bottomLayers: number;
  bottomExposureS: number;
  liftHeightMM: number;
  liftSpeedMMs: number;
}

export interface Triangle {
  normal: { x: number; y: number; z: number };
  vertices: [
    { x: number; y: number; z: number },
    { x: number; y: number; z: number },
    { x: number; y: number; z: number },
  ];
}

export function makeBinaryStl(triangles: Triangle[], name = 'SliceLab export'): Blob {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  const encoder = new TextEncoder();
  const header = encoder.encode(name.slice(0, 80));
  new Uint8Array(buffer, 0, header.length).set(header);
  view.setUint32(80, triangles.length, true);

  let offset = 84;
  for (const { normal, vertices } of triangles) {
    view.setFloat32(offset, normal.x, true);
    view.setFloat32(offset + 4, normal.y, true);
    view.setFloat32(offset + 8, normal.z, true);
    offset += 12;

    for (const v of vertices) {
      view.setFloat32(offset, v.x, true);
      view.setFloat32(offset + 4, v.y, true);
      view.setFloat32(offset + 8, v.z, true);
      offset += 12;
    }

    view.setUint16(offset, 0, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'model/stl' });
}

export function makeObj(triangles: Triangle[], name = 'slicelab_export'): Blob {
  const lines = [`# ${name}`, 'o SliceLab_Plate'];

  for (const { vertices } of triangles) {
    for (const v of vertices) {
      lines.push(`v ${v.x} ${v.y} ${v.z}`);
    }
  }

  for (const { normal } of triangles) {
    lines.push(`vn ${normal.x} ${normal.y} ${normal.z}`);
  }

  for (let i = 0; i < triangles.length; i++) {
    const v = i * 3 + 1;
    const n = i + 1;
    lines.push(`f ${v}//${n} ${v + 1}//${n} ${v + 2}//${n}`);
  }

  return new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
}

export function buildManifest(
  layerCount: number,
  printer: PrinterSpec,
  params: SliceParams,
): ExportManifest {
  return {
    printer: printer.name,
    resolutionX: printer.resolutionX,
    resolutionY: printer.resolutionY,
    layerCount,
    layerHeightMM: params.layerHeightMM,
    normalExposureS: params.normalExposureS,
    bottomLayers: params.bottomLayers,
    bottomExposureS: params.bottomExposureS,
    liftHeightMM: params.liftHeightMM,
    liftSpeedMMs: params.liftSpeedMMs,
  };
}

export interface PrintTimeEstimate {
  totalSeconds: number;
  hours: number;
  minutes: number;
}

export function estimatePrintTime(layerCount: number, params: SliceParams): PrintTimeEstimate {
  const liftTime = (params.liftHeightMM * 2) / params.liftSpeedMMs;
  const retractDelay = 1;

  const bottomCount = Math.min(params.bottomLayers, layerCount);
  const bottomTime = bottomCount * (params.bottomExposureS + liftTime + retractDelay);
  const normalCount = Math.max(0, layerCount - params.bottomLayers);
  const normalTime = normalCount * (params.normalExposureS + liftTime + retractDelay);

  const totalSeconds = bottomTime + normalTime;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return { totalSeconds, hours, minutes };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
