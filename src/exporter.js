import JSZip from 'jszip';

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
  zip.file('metadata.json', JSON.stringify(metadata, null, 2));

  const content = await zip.generateAsync({ type: 'blob' }, (meta) => {
    if (onProgress) {
      onProgress(layers.length, layers.length, `Compressing: ${meta.percent.toFixed(0)}%`);
    }
  });

  // Trigger download
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  const safeName = printerSpec.name.replace(/\s+/g, '-').toLowerCase();
  a.download = `${safeName}_${layers.length}layers.zip`;
  a.click();
  URL.revokeObjectURL(url);
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
