import JSZip from 'jszip';
import * as THREE from 'three';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getGeometryTriangles(geometries) {
  const triangles = [];
  const normal = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  geometries.forEach((geometry) => {
    if (!geometry?.attributes?.position) return;
    const pos = geometry.attributes.position;
    const index = geometry.index?.array;
    const triCount = index ? index.length / 3 : pos.count / 3;

    for (let i = 0; i < triCount; i++) {
      const ia = index ? index[i * 3] : i * 3;
      const ib = index ? index[i * 3 + 1] : i * 3 + 1;
      const ic = index ? index[i * 3 + 2] : i * 3 + 2;

      a.fromBufferAttribute(pos, ia);
      b.fromBufferAttribute(pos, ib);
      c.fromBufferAttribute(pos, ic);
      cb.subVectors(c, b);
      ab.subVectors(a, b);
      normal.crossVectors(cb, ab).normalize();

      triangles.push({
        normal: normal.clone(),
        vertices: [a.clone(), b.clone(), c.clone()],
      });
    }
  });

  return triangles;
}

function makeBinaryStl(triangles, name = 'SliceLab export') {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  const encoder = new TextEncoder();
  const header = encoder.encode(name.slice(0, 80));
  new Uint8Array(buffer, 0, header.length).set(header);
  view.setUint32(80, triangles.length, true);

  let offset = 84;
  triangles.forEach(({ normal, vertices }) => {
    [normal, ...vertices].forEach((v) => {
      view.setFloat32(offset, v.x, true);
      view.setFloat32(offset + 4, v.y, true);
      view.setFloat32(offset + 8, v.z, true);
      offset += 12;
    });
    view.setUint16(offset, 0, true);
    offset += 2;
  });

  return new Blob([buffer], { type: 'model/stl' });
}

function makeObj(triangles, name = 'slicelab_export') {
  const lines = [`# ${name}`, 'o SliceLab_Plate'];
  triangles.forEach(({ vertices }) => {
    vertices.forEach(v => lines.push(`v ${v.x} ${v.y} ${v.z}`));
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

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function make3mf(triangles, name = 'SliceLab export') {
  const vertices = [];
  const triangleRows = [];

  triangles.forEach(({ vertices: triVertices }) => {
    const base = vertices.length;
    triVertices.forEach(v => {
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
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`);
  zip.folder('3D').file('3dmodel.model', model);

  return zip.generateAsync({ type: 'blob', mimeType: 'model/3mf' });
}

/**
 * Export prepared mesh geometry in common interchange formats.
 *
 * @param {THREE.BufferGeometry[]} geometries - World-space model/support geometries
 * @param {'stl'|'obj'|'3mf'} format
 * @param {string} baseName
 */
export async function exportMesh(geometries, format, baseName = 'slicelab-plate') {
  const cleanFormat = String(format).toLowerCase();
  const triangles = getGeometryTriangles(geometries);
  if (triangles.length === 0) {
    throw new Error('No triangles available to export.');
  }

  let blob;
  if (cleanFormat === 'stl') {
    blob = makeBinaryStl(triangles, baseName);
  } else if (cleanFormat === 'obj') {
    blob = makeObj(triangles, baseName);
  } else if (cleanFormat === '3mf') {
    blob = await make3mf(triangles, baseName);
  } else {
    throw new Error(`Unsupported export format: ${format}`);
  }

  downloadBlob(blob, `${baseName}.${cleanFormat}`);
}

/**
 * Export sliced layers as a ZIP of PNG images.
 *
 * @param {Uint8Array[]} layers - Array of RGBA pixel data (2560x1620x4 bytes each)
 * @param {Object} settings - Print settings
 * @param {number} settings.layerHeight
 * @param {number} settings.normalExposure
 * @param {number} settings.bottomLayers
 * @param {number} settings.bottomExposure
 * @param {number} settings.liftHeight
 * @param {number} settings.liftSpeed
 * @param {Function} onProgress
 */
export async function exportZip(layers, settings, printerSpec, onProgress) {
  const zip = new JSZip();
  const { resolutionX, resolutionY } = printerSpec;

  // Create an offscreen canvas for PNG encoding
  const canvas = document.createElement('canvas');
  canvas.width = resolutionX;
  canvas.height = resolutionY;
  const ctx = canvas.getContext('2d');

  for (let i = 0; i < layers.length; i++) {
    const imageData = new ImageData(
      new Uint8ClampedArray(layers[i].buffer),
      resolutionX,
      resolutionY,
    );

    // WebGL gives us bottom-up, we need to flip for correct PNG
    ctx.clearRect(0, 0, resolutionX, resolutionY);
    // Put flipped: save, scale, translate, draw
    ctx.save();
    ctx.scale(1, -1);
    ctx.drawImage(await createImageBitmap(imageData), 0, -resolutionY);
    ctx.restore();

    const blob = await new Promise(resolve =>
      canvas.toBlob(resolve, 'image/png')
    );
    const arrayBuffer = await blob.arrayBuffer();

    const layerNum = String(i).padStart(5, '0');
    zip.file(`layer_${layerNum}.png`, arrayBuffer);

    if (onProgress) {
      onProgress(i + 1, layers.length);
    }

    // Yield every 10 layers
    if (i % 10 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // Metadata
  const metadata = {
    printer: printerSpec.name,
    resolutionX,
    resolutionY,
    layerCount: layers.length,
    layerHeight: settings.layerHeight,
    normalExposure: settings.normalExposure,
    bottomLayers: settings.bottomLayers,
    bottomExposure: settings.bottomExposure,
    liftHeight: settings.liftHeight,
    liftSpeed: settings.liftSpeed,
  };
  if (settings.modelVolumeMm3 !== undefined) {
    metadata.modelVolume_mm3 = settings.modelVolumeMm3;
    metadata.supportVolume_mm3 = settings.supportVolumeMm3 || 0;
    metadata.volumeBreakdownExact = settings.volumeBreakdownExact !== false;
    metadata.totalVolume_mL = (settings.totalVolumeMm3 ?? (settings.modelVolumeMm3 + (settings.supportVolumeMm3 || 0))) / 1000;
  }
  zip.file('metadata.json', JSON.stringify(metadata, null, 2));

  const content = await zip.generateAsync({ type: 'blob' }, (meta) => {
    if (onProgress) {
      onProgress(layers.length, layers.length, `Compressing: ${meta.percent.toFixed(0)}%`);
    }
  });

  const safeName = printerSpec.name.replace(/\s+/g, '-').toLowerCase();
  downloadBlob(content, `${safeName}_${layers.length}layers.zip`);
}

/**
 * Estimate print time based on settings and layer count.
 */
export function estimatePrintTime(layerCount, settings) {
  const { normalExposure, bottomLayers, bottomExposure, liftHeight, liftSpeed } = settings;
  const liftTime = (liftHeight * 2) / liftSpeed; // up + down
  const retractDelay = 1; // seconds between layers

  const bottomTime = Math.min(bottomLayers, layerCount) * (bottomExposure + liftTime + retractDelay);
  const normalCount = Math.max(0, layerCount - bottomLayers);
  const normalTime = normalCount * (normalExposure + liftTime + retractDelay);

  const totalSeconds = bottomTime + normalTime;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return { totalSeconds, hours, minutes };
}
