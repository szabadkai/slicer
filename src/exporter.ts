import JSZip from 'jszip';
import {
  addPngFilesToZip,
  encodeCompactLayersToPngs,
  encodePixelLayersToPngs,
  getLayerSourceCount,
  resolveLayerSourcePngs,
  yieldToBrowser,
} from './formats/exporters/slice/export-helpers';
import type { CompactGrayLayer } from './png-encode-pool';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Triangle {
  normal: Vec3;
  vertices: [Vec3, Vec3, Vec3];
}

interface BufferAttribute {
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
  count: number;
}

interface GeometryLike {
  attributes?: {
    position?: BufferAttribute;
  };
  index?: { array: ArrayLike<number>; length?: number } | null;
}

interface PrinterSpecLike {
  name: string;
  resolutionX: number;
  resolutionY: number;
  buildWidthMM?: number;
  buildDepthMM?: number;
  buildHeightMM?: number;
}

interface SliceSettings {
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

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getGeometryTriangles(geometries: GeometryLike[]): Triangle[] {
  const triangles: Triangle[] = [];

  geometries.forEach((geometry) => {
    if (!geometry?.attributes?.position) return;
    const pos = geometry.attributes.position;
    const indexArray = geometry.index?.array;
    const triCount = indexArray ? indexArray.length / 3 : pos.count / 3;

    for (let i = 0; i < triCount; i++) {
      const ia = indexArray ? indexArray[i * 3] : i * 3;
      const ib = indexArray ? indexArray[i * 3 + 1] : i * 3 + 1;
      const ic = indexArray ? indexArray[i * 3 + 2] : i * 3 + 2;

      const ax = pos.getX(ia),
        ay = pos.getY(ia),
        az = pos.getZ(ia);
      const bx = pos.getX(ib),
        by = pos.getY(ib),
        bz = pos.getZ(ib);
      const cx = pos.getX(ic),
        cy = pos.getY(ic),
        cz = pos.getZ(ic);

      // cb = c - b, ab = a - b
      const cbx = cx - bx,
        cby = cy - by,
        cbz = cz - bz;
      const abx = ax - bx,
        aby = ay - by,
        abz = az - bz;

      // normal = cross(cb, ab), normalized
      let nx = cby * abz - cbz * aby;
      let ny = cbz * abx - cbx * abz;
      let nz = cbx * aby - cby * abx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 0) {
        nx /= len;
        ny /= len;
        nz /= len;
      }

      triangles.push({
        normal: { x: nx, y: ny, z: nz },
        vertices: [
          { x: ax, y: ay, z: az },
          { x: bx, y: by, z: bz },
          { x: cx, y: cy, z: cz },
        ],
      });
    }
  });

  return triangles;
}

function makeBinaryStl(triangles: Triangle[], name = 'SliceLab export'): Blob {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  const encoder = new TextEncoder();
  const header = encoder.encode(name.slice(0, 80));
  new Uint8Array(buffer, 0, header.length).set(header);
  view.setUint32(80, triangles.length, true);

  let offset = 84;
  triangles.forEach(({ normal, vertices }) => {
    for (const v of [normal, ...vertices]) {
      view.setFloat32(offset, v.x, true);
      view.setFloat32(offset + 4, v.y, true);
      view.setFloat32(offset + 8, v.z, true);
      offset += 12;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  });

  return new Blob([buffer], { type: 'model/stl' });
}

function makeObj(triangles: Triangle[], name = 'slicelab_export'): Blob {
  const lines = [`# ${name}`, 'o SliceLab_Plate'];
  triangles.forEach(({ vertices }) => {
    vertices.forEach((v) => lines.push(`v ${v.x} ${v.y} ${v.z}`));
  });
  triangles.forEach(({ normal }) => {
    lines.push(`vn ${normal.x} ${normal.y} ${normal.z}`);
  });
  for (let i = 0; i < triangles.length; i++) {
    const v = i * 3 + 1;
    const n = i + 1;
    lines.push(`f ${v}//${n} ${v + 1}//${n} ${v + 2}//${n}`);
  }
  return new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
}

function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function make3mf(triangles: Triangle[], name = 'SliceLab export'): Promise<Blob> {
  const vertices: string[] = [];
  const triangleRows: string[] = [];

  triangles.forEach(({ vertices: triVertices }) => {
    const base = vertices.length;
    triVertices.forEach((v) => {
      vertices.push(`<vertex x="${v.x}" y="${v.y}" z="${v.z}"/>`);
    });
    triangleRows.push(`<triangle v1="${base}" v2="${base + 1}" v3="${base + 2}"/>`);
  });

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">${escapeXml(name)}</metadata>
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
          ${vertices.join('\n          ')}
        </vertices>
        <triangles>
          ${triangleRows.join('\n          ')}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1"/>
  </build>
</model>`;

  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`,
  );
  const relsFolder = zip.folder('_rels');
  if (!relsFolder) throw new Error('Failed to create _rels folder');
  relsFolder.file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`,
  );
  const modelFolder = zip.folder('3D');
  if (!modelFolder) throw new Error('Failed to create 3D folder');
  modelFolder.file('3dmodel.model', model);

  return zip.generateAsync({ type: 'blob', mimeType: 'model/3mf' });
}

/**
 * Build a Blob for mesh geometry in a given format without triggering download.
 */
export async function exportMeshToBlob(
  geometries: GeometryLike[],
  format: string,
  baseName = 'slicelab-plate',
): Promise<Blob> {
  const cleanFormat = String(format).toLowerCase();
  const triangles = getGeometryTriangles(geometries);
  if (triangles.length === 0) {
    throw new Error('No triangles available to export.');
  }

  if (cleanFormat === 'stl') return makeBinaryStl(triangles, baseName);
  if (cleanFormat === 'obj') return makeObj(triangles, baseName);
  if (cleanFormat === '3mf') return make3mf(triangles, baseName);
  throw new Error(`Unsupported export format: ${format}`);
}

/**
 * Export prepared mesh geometry in common interchange formats.
 */
export async function exportMesh(
  geometries: GeometryLike[],
  format: string,
  baseName = 'slicelab-plate',
): Promise<void> {
  const blob = await exportMeshToBlob(geometries, format, baseName);
  const cleanFormat = String(format).toLowerCase();
  downloadBlob(blob, `${baseName}.${cleanFormat}`);
}

type ProgressCallback = (current: number, total: number, extra?: string) => void;

/**
 * Provider for layer pixel data. The proxy/array used by the export path returns
 * a fresh Uint8Array per index so it can be transferred to the worker pool.
 */
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

/**
 * Export sliced layers as a ZIP of PNG images.
 * If pixels are provided, encoding runs in a worker pool, pipelined with
 * however the layers are produced. If PNG bytes are already cached (from the
 * slice pass), they are zipped directly.
 */
export async function exportZipToBlob(
  source: LayerSource,
  settings: SliceSettings,
  printerSpec: PrinterSpecLike,
  onProgress?: ProgressCallback,
): Promise<Blob> {
  const zip = new JSZip();
  const { resolutionX, resolutionY } = printerSpec;
  const layerCount = getLayerSourceCount(source);

  if (source.kind === 'png') {
    await addPngFilesToZip(
      zip,
      source.pngs,
      (i) => `layer_${String(i).padStart(5, '0')}.png`,
      onProgress,
    );
  } else if (source.kind === 'pixels') {
    const pngs = await encodePixelLayersToPngs(source, resolutionX, resolutionY, onProgress);
    await addPngFilesToZip(zip, pngs, (i) => `layer_${String(i).padStart(5, '0')}.png`, onProgress);
  } else if (source.kind === 'compact') {
    const pngs = await encodeCompactLayersToPngs(source, resolutionX, resolutionY, onProgress);
    await addPngFilesToZip(zip, pngs, (i) => `layer_${String(i).padStart(5, '0')}.png`, onProgress);
  } else {
    const pngs = await resolveLayerSourcePngs(source, resolutionX, resolutionY, onProgress);
    await addPngFilesToZip(zip, pngs, (i) => `layer_${String(i).padStart(5, '0')}.png`, onProgress);
  }

  const metadata: Record<string, unknown> = {
    printer: printerSpec.name,
    resolutionX,
    resolutionY,
    layerCount,
    layerHeight: settings.layerHeight,
    normalExposure: settings.normalExposure,
    bottomLayers: settings.bottomLayers,
    bottomExposure: settings.bottomExposure,
    liftHeight: settings.liftHeight,
    liftSpeed: settings.liftSpeed,
  };
  if (settings.modelVolumeMm3 !== undefined) {
    metadata.modelVolume_mm3 = settings.modelVolumeMm3;
    metadata.supportVolume_mm3 = settings.supportVolumeMm3 ?? 0;
    metadata.volumeBreakdownExact = settings.volumeBreakdownExact !== false;
    metadata.totalVolume_mL =
      (settings.totalVolumeMm3 ?? settings.modelVolumeMm3 + (settings.supportVolumeMm3 ?? 0)) /
      1000;
  }
  zip.file('metadata.json', JSON.stringify(metadata, null, 2), { compression: 'STORE' });

  onProgress?.(layerCount, layerCount, 'Building ZIP archive...');
  await yieldToBrowser();

  return zip.generateAsync({ type: 'blob', compression: 'STORE' }, (metadata) => {
    onProgress?.(layerCount, layerCount, `Building ZIP archive... ${metadata.percent.toFixed(0)}%`);
  });
}

export async function exportZip(
  source: LayerSource,
  settings: SliceSettings,
  printerSpec: PrinterSpecLike,
  onProgress?: ProgressCallback,
): Promise<void> {
  const content = await exportZipToBlob(source, settings, printerSpec, onProgress);
  const layerCount = getLayerSourceCount(source);
  const safeName = printerSpec.name.replace(/\s+/g, '-').toLowerCase();
  downloadBlob(content, `${safeName}_${layerCount}layers.zip`);
}

/**
 * Estimate print time based on settings and layer count.
 */
export function estimatePrintTime(
  layerCount: number,
  settings: Pick<
    SliceSettings,
    'normalExposure' | 'bottomLayers' | 'bottomExposure' | 'liftHeight' | 'liftSpeed'
  >,
): { totalSeconds: number; hours: number; minutes: number } {
  const { normalExposure, bottomLayers, bottomExposure, liftHeight, liftSpeed } = settings;
  const liftTime = (liftHeight * 2) / liftSpeed;
  const retractDelay = 1;

  const bottomTime =
    Math.min(bottomLayers, layerCount) * (bottomExposure + liftTime + retractDelay);
  const normalCount = Math.max(0, layerCount - bottomLayers);
  const normalTime = normalCount * (normalExposure + liftTime + retractDelay);

  const totalSeconds = bottomTime + normalTime;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return { totalSeconds, hours, minutes };
}
