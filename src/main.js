import { Viewer } from './viewer.js';
import { Slicer, PRINTERS } from './slicer.js';
import { optimizeOrientationAsync, analyzeCurrentOrientation } from './orientation.js';
import { generateSupports } from './supports.js';
import { exportZip, estimatePrintTime } from './exporter.js';

// --- State ---
let viewer;
let slicer;
let slicedLayers = null;

// Debug access
import * as THREE from 'three';
window.__debug = { get viewer() { return viewer; }, get slicer() { return slicer; }, THREE };

// --- DOM refs ---
const stlInput = document.getElementById('stl-input');
const modelInfo = document.getElementById('model-info');
const orientationPanel = document.getElementById('orientation-panel');
const supportsPanel = document.getElementById('supports-panel');
const slicePanel = document.getElementById('slice-panel');
const layerPreviewPanel = document.getElementById('layer-preview-panel');

const printerSelect = document.getElementById('printer-select');

const overhangAngleInput = document.getElementById('overhang-angle');
const overhangAngleVal = document.getElementById('overhang-angle-val');
const supportDensityInput = document.getElementById('support-density');
const supportDensityVal = document.getElementById('support-density-val');
const tipDiameterInput = document.getElementById('tip-diameter');
const tipDiameterGroup = document.getElementById('tip-diameter-group');
const supportThicknessInput = document.getElementById('support-thickness');
const supportThicknessGroup = document.getElementById('support-thickness-group');
const autoThicknessInput = document.getElementById('auto-thickness');
const internalSupportsInput = document.getElementById('internal-supports');
const crossBracingInput = document.getElementById('cross-bracing');
const generateSupportsBtn = document.getElementById('generate-supports-btn');
const clearSupportsBtn = document.getElementById('clear-supports-btn');
const zElevationInput = document.getElementById('z-elevation');

const layerHeightInput = document.getElementById('layer-height');
const normalExposureInput = document.getElementById('normal-exposure');
const bottomLayersInput = document.getElementById('bottom-layers');
const bottomExposureInput = document.getElementById('bottom-exposure');
const liftHeightInput = document.getElementById('lift-height');
const liftSpeedInput = document.getElementById('lift-speed');
const printEstimate = document.getElementById('print-estimate');
const sliceBtn = document.getElementById('slice-btn');
const exportBtn = document.getElementById('export-btn');

const layerCanvas = document.getElementById('layer-canvas');
const layerSlider = document.getElementById('layer-slider');
const layerInfo = document.getElementById('layer-info');

const progressOverlay = document.getElementById('progress-overlay');
const progressText = document.getElementById('progress-text');
const progressBar = document.getElementById('progress-bar');
const progressPercent = document.getElementById('progress-percent');

// --- Init ---
function init() {
  const canvas = document.getElementById('viewport');
  viewer = new Viewer(canvas);
  slicer = new Slicer();

  // Populate printer select
  for (const [key, spec] of Object.entries(PRINTERS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = spec.name;
    printerSelect.appendChild(opt);
  }
  
  printerSelect.addEventListener('change', () => {
    const printerKey = printerSelect.value;
    slicer.setPrinter(printerKey);
    viewer.setPrinter(PRINTERS[printerKey]);
    
    // Clear out sliced output because bounds/resolution changed
    slicedLayers = null;
    exportBtn.hidden = true;
    layerPreviewPanel.hidden = true;
    updateEstimate();
  });
  
  // Initialize viewer with the default printer
  viewer.setPrinter(PRINTERS[printerSelect.value]);

  stlInput.addEventListener('change', handleFileLoad);

  // Orientation presets
  orientationPanel.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => handleOrientation(btn.dataset.preset));
  });

  // Toolbar tools
  const orientBtn = document.getElementById('orient-btn');
  const supportToolBtn = document.getElementById('support-tool-btn');
  
  const moveBtn = document.getElementById('move-btn');
  const rotateBtn = document.getElementById('rotate-btn');
  const scaleBtn = document.getElementById('scale-btn');
  const fillBtn = document.getElementById('fill-btn');
  
  const transformBtns = [moveBtn, rotateBtn, scaleBtn];

  function toggleTransformMode(mode, btn) {
    // If the tool is already active, turn it off
    const isActive = btn.classList.contains('active');
    transformBtns.forEach(b => b.classList.remove('active'));
    
    if (isActive) {
      viewer.setTransformMode(null);
    } else {
      viewer.setTransformMode(mode);
      btn.classList.add('active');
    }
  }

  moveBtn.addEventListener('click', () => toggleTransformMode('translate', moveBtn));
  rotateBtn.addEventListener('click', () => toggleTransformMode('rotate', rotateBtn));
  scaleBtn.addEventListener('click', () => toggleTransformMode('scale', scaleBtn));
  
  fillBtn.addEventListener('click', () => {
    if (!viewer.fillPlatform()) {
      alert("Model may be too large to duplicate on the platform.");
    }
  });

  canvas.addEventListener('mesh-changed', () => {
    const info = viewer.getModelInfo();
    if (info) {
      modelInfo.textContent =
        `${info.triangles.toLocaleString()} triangles | ${info.width} x ${info.depth} x ${info.height} mm`;
      updateEstimate();
      slicedLayers = null;
      exportBtn.hidden = true;
      layerPreviewPanel.hidden = true;
    }
  });
  
  // Toggle panels logically
  orientBtn.addEventListener('click', () => {
    orientationPanel.hidden = false;
    supportsPanel.hidden = true;
    slicePanel.hidden = true;
  });
  supportToolBtn.addEventListener('click', () => {
    orientationPanel.hidden = true;
    supportsPanel.hidden = false;
    slicePanel.hidden = true;
  });

  // Support controls
  overhangAngleInput.addEventListener('input', () => {
    overhangAngleVal.textContent = overhangAngleInput.value + '°';
  });
  supportDensityInput.addEventListener('input', () => {
    supportDensityVal.textContent = supportDensityInput.value;
  });
  autoThicknessInput.addEventListener('change', () => {
    tipDiameterInput.disabled = autoThicknessInput.checked;
    tipDiameterGroup.style.opacity = autoThicknessInput.checked ? '0.5' : '1';
    tipDiameterGroup.style.pointerEvents = autoThicknessInput.checked ? 'none' : 'auto';
    supportThicknessInput.disabled = autoThicknessInput.checked;
    supportThicknessGroup.style.opacity = autoThicknessInput.checked ? '0.5' : '1';
    supportThicknessGroup.style.pointerEvents = autoThicknessInput.checked ? 'none' : 'auto';
  });
  generateSupportsBtn.addEventListener('click', handleGenerateSupports);
  clearSupportsBtn.addEventListener('click', () => {
    viewer.clearSupports();
    updateEstimate();
  });
  zElevationInput.addEventListener('change', () => {
    viewer.setElevation(parseFloat(zElevationInput.value));
    slicedLayers = null;
    exportBtn.hidden = true;
    layerPreviewPanel.hidden = true;
    updateEstimate();
  });

  // Slice controls
  sliceBtn.addEventListener('click', handleSlice);
  exportBtn.addEventListener('click', handleExport);

  // Settings change -> update estimate
  [layerHeightInput, normalExposureInput, bottomLayersInput,
   bottomExposureInput, liftHeightInput, liftSpeedInput].forEach(el => {
    el.addEventListener('change', updateEstimate);
  });

  // Layer preview slider
  layerSlider.addEventListener('input', showLayer);
}

// --- File loading ---
function handleFileLoad(e) {
  const file = e.target.files[0];
  if (!file) return;

  showProgress('Reading STL...');

  const reader = new FileReader();
  reader.onload = (evt) => {
    showProgress('Parsing STL...');
    // Yield to allow UI to paint
    setTimeout(() => {
      const buffer = evt.target.result;
      const info = viewer.loadSTL(buffer);

      if (info) {
        modelInfo.textContent =
          `${info.triangles.toLocaleString()} triangles | ${info.width} x ${info.depth} x ${info.height} mm`;

        // Show all panels
        orientationPanel.hidden = false;
        supportsPanel.hidden = false;
        slicePanel.hidden = false;
        layerPreviewPanel.hidden = true;
        exportBtn.hidden = true;
        slicedLayers = null;

        updateEstimate();
      }
      hideProgress();
    }, 50);
  };
  reader.readAsArrayBuffer(file);
}

// --- Orientation ---
async function handleOrientation(preset) {
  const geometry = viewer.getModelGeometry();
  if (!geometry) return;

  showProgress('Optimizing orientation...');

  try {
    const quaternion = await optimizeOrientationAsync(geometry, preset, (fraction, text) => {
        updateProgress(fraction, text);
    });
    viewer.applyRotation(quaternion); // applyRotation now fires mesh-changed
  } catch (error) {
    console.error("Failed to optimize orientation", error);
    alert("Failed to optimize orientation: " + error.message);
  } finally {
    hideProgress();
  }
}

// --- Supports ---
async function handleGenerateSupports() {
  const geometry = viewer.getModelGeometry();
  if (!geometry) return;

  showProgress('Generating supports...');
  await new Promise(r => setTimeout(r, 50));

  const supportGeo = await generateSupports(geometry, {
    overhangAngle: parseFloat(overhangAngleInput.value),
    density: parseFloat(supportDensityInput.value),
    tipDiameter: parseFloat(tipDiameterInput.value),
    supportThickness: parseFloat(supportThicknessInput.value),
    autoThickness: autoThicknessInput.checked,
    internalSupports: internalSupportsInput.checked,
    crossBracing: crossBracingInput.checked,
    onProgress: (fraction, text) => {
      updateProgress(fraction, text);
    }
  });

  if (supportGeo.attributes.position && supportGeo.attributes.position.count > 0) {
    viewer.setSupports(supportGeo);
  } else {
    viewer.clearSupports();
  }

  slicedLayers = null;
  exportBtn.hidden = true;
  layerPreviewPanel.hidden = true;
  updateEstimate();
  hideProgress();
}

// --- Slicing ---
async function handleSlice() {
  const geometry = viewer.getModelGeometry();
  if (!geometry) return;

  const layerHeight = parseFloat(layerHeightInput.value);
  const supportsMesh = viewer.getSupportsMesh();
  const supportsGeo = supportsMesh ? supportsMesh.geometry : null;

  showProgress('Uploading geometry...');
  await new Promise(r => setTimeout(r, 50));

  slicer.uploadGeometry(geometry, supportsGeo);

  const modelMesh = viewer.getModelMesh();
  if (modelMesh && modelMesh.isInstancedMesh) {
    slicer.setInstances(modelMesh.count, modelMesh.instanceMatrix.array);
  } else {
    slicer.setInstances(0, null);
  }

  showProgress('Slicing...');
  await new Promise(r => setTimeout(r, 50));

  slicedLayers = await slicer.slice(layerHeight, (current, total) => {
    updateProgress(current / total, `Slicing layer ${current} / ${total}`);
  });

  hideProgress();

  // Show layer preview
  layerPreviewPanel.hidden = false;
  exportBtn.hidden = false;
  layerSlider.max = slicedLayers.length - 1;
  layerSlider.value = 0;
  showLayer();
}

// --- Layer preview ---
function showLayer() {
  if (!slicedLayers || slicedLayers.length === 0) return;

  const idx = parseInt(layerSlider.value, 10);
  layerInfo.textContent = `${idx + 1} / ${slicedLayers.length}`;

  const spec = slicer.getPrinterSpec();
  const pixels = slicedLayers[idx];

  // Draw to preview canvas (scaled down)
  const ctx = layerCanvas.getContext('2d');
  const previewW = layerCanvas.width;
  const previewH = layerCanvas.height;

  // Create full-res ImageData, flip vertically (WebGL is bottom-up)
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = spec.resolutionX;
  tempCanvas.height = spec.resolutionY;
  const tempCtx = tempCanvas.getContext('2d');
  const imageData = new ImageData(
    new Uint8ClampedArray(pixels.buffer.slice(0)),
    spec.resolutionX,
    spec.resolutionY,
  );
  tempCtx.putImageData(imageData, 0, 0);

  // Draw flipped and scaled
  ctx.clearRect(0, 0, previewW, previewH);
  ctx.save();
  ctx.scale(1, -1);
  ctx.drawImage(tempCanvas, 0, -previewH, previewW, previewH);
  ctx.restore();
}

// --- Export ---
async function handleExport() {
  if (!slicedLayers) return;

  const settings = getSettings();
  const spec = slicer.getPrinterSpec();

  showProgress('Exporting...');
  await new Promise(r => setTimeout(r, 50));

  await exportZip(slicedLayers, settings, spec, (current, total, extra) => {
    updateProgress(current / total, extra || `Encoding PNG ${current} / ${total}`);
  });

  hideProgress();
}

// --- Settings & Estimate ---
function getSettings() {
  return {
    layerHeight: parseFloat(layerHeightInput.value),
    normalExposure: parseFloat(normalExposureInput.value),
    bottomLayers: parseInt(bottomLayersInput.value, 10),
    bottomExposure: parseFloat(bottomExposureInput.value),
    liftHeight: parseFloat(liftHeightInput.value),
    liftSpeed: parseFloat(liftSpeedInput.value),
  };
}

function updateEstimate() {
  const geometry = viewer.getModelGeometry();
  if (!geometry) {
    printEstimate.textContent = '';
    return;
  }

  const settings = getSettings();
  const bb = geometry.boundingBox;
  const modelHeight = Math.max(0, bb.max.y); // Printer starts at Y=0
  const layerCount = Math.ceil(modelHeight / settings.layerHeight);
  const { hours, minutes } = estimatePrintTime(layerCount, settings);

  printEstimate.innerHTML =
    `Layers: ${layerCount}<br>` +
    `Height: ${modelHeight.toFixed(1)} mm<br>` +
    `Est. time: ${hours}h ${minutes}m`;
}

// --- Progress UI ---
function showProgress(text) {
  progressOverlay.hidden = false;
  progressText.textContent = text;
  progressBar.style.width = '0%';
  progressPercent.textContent = '0%';
}

function updateProgress(fraction, text) {
  const pct = Math.round(fraction * 100);
  progressBar.style.width = `${pct}%`;
  progressPercent.textContent = `${pct}%`;
  if (text) progressText.textContent = text;
}

function hideProgress() {
  progressOverlay.hidden = true;
}

// --- Start ---
init();
