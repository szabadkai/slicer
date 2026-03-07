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
  const duplicateBtn = document.getElementById('duplicate-btn');
  const deleteBtn = document.getElementById('delete-btn');
  const clearBtn = document.getElementById('clear-btn');
  
  duplicateBtn.addEventListener('click', () => viewer.duplicateSelected());
  deleteBtn.addEventListener('click', () => viewer.removeSelected());
  clearBtn.addEventListener('click', () => viewer.clearPlate());
  
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      viewer.removeSelected();
    }
    if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      viewer.selectAll();
    }
    if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      viewer.undo();
    }
    if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      viewer.copySelected();
    }
    if ((e.key === 'v' || e.key === 'V') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      viewer.paste();
    }
  });
  
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

  canvas.addEventListener('selection-changed', () => {
    const singleSelected = viewer.selected.length === 1;
    const hasSelection = viewer.selected.length > 0;
    
    // Visually toggle tools
    [document.getElementById('orient-btn'), document.getElementById('support-tool-btn'),
     document.getElementById('move-btn'), document.getElementById('rotate-btn'),
     document.getElementById('scale-btn'), document.getElementById('fill-btn')].forEach(btn => {
       if (btn) btn.style.opacity = singleSelected ? '1' : '0.3';
       if (btn) btn.style.pointerEvents = singleSelected ? 'auto' : 'none';
     });

    [document.getElementById('duplicate-btn'), document.getElementById('delete-btn')].forEach(btn => {
       if (btn) btn.style.opacity = hasSelection ? '1' : '0.3';
       if (btn) btn.style.pointerEvents = hasSelection ? 'auto' : 'none';
    });
     
    [orientationPanel, supportsPanel].forEach(o => {
        if (!singleSelected) o.hidden = true;
    });
    
    if (singleSelected) {
        zElevationInput.value = viewer.selected[0].elevation;
    }
    
    updateWorkspaceInfo();
  });
  
  function updateWorkspaceInfo() {
    const info = viewer.getOverallInfo();
    const clearBtn = document.getElementById('clear-btn');
    if (clearBtn) {
       const hasObjs = viewer.objects.length > 0;
       clearBtn.style.opacity = hasObjs ? '1' : '0.3';
       clearBtn.style.pointerEvents = hasObjs ? 'auto' : 'none';
    }

    if (info && info.count > 0) {
      if (viewer.selected.length === 1) {
         modelInfo.innerHTML = `<b>Selected (1 of ${info.count}):</b> <br/>` + 
           `${(viewer.selected[0].mesh.geometry.attributes.position.count / 3).toLocaleString()} tris`;
      } else if (viewer.selected.length > 1) {
         let subTris = 0;
         viewer.selected.forEach(s => subTris += s.mesh.geometry.attributes.position.count / 3);
         modelInfo.innerHTML = `<b>Selected (${viewer.selected.length} of ${info.count}):</b> <br/>` + 
           `${subTris.toLocaleString()} tris`;
        modelInfo.classList.add('visible');
      } else {
         modelInfo.innerHTML = `<b>Entire Plate (${info.count} items):</b> <br/>` + 
           `${info.triangles.toLocaleString()} tris | ${info.width}x${info.depth}x${info.height} mm`;
         modelInfo.classList.add('visible');
      }
      updateEstimate();
      slicedLayers = null;
      exportBtn.hidden = true;
      layerPreviewPanel.hidden = true;
    } else {
      modelInfo.classList.remove('visible');
      printEstimate.innerHTML = '';
      slicedLayers = null;
      exportBtn.hidden = true;
      layerPreviewPanel.hidden = true;
    }
  }

  canvas.addEventListener('mesh-changed', updateWorkspaceInfo);
  
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
  document.getElementById('orient-all-btn').addEventListener('click', () => handleOrientAll('fastest'));
  document.getElementById('support-all-btn').addEventListener('click', handleSupportAll);
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

  // Load default model
  loadDefaultModel();
}

async function loadDefaultModel() {
  try {
    const response = await fetch(import.meta.env.BASE_URL + 'models/d20v2_thick.stl');
    if (!response.ok) return;
    const buffer = await response.arrayBuffer();
    viewer.loadSTL(buffer, 2);
    orientationPanel.hidden = false;
    supportsPanel.hidden = false;
    slicePanel.hidden = false;
    layerPreviewPanel.hidden = true;
    exportBtn.hidden = true;
    slicedLayers = null;
    updateEstimate();
  } catch (e) {
    console.warn('Could not load default model:', e);
  }
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
      viewer.loadSTL(buffer);

      if (true) {
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

// --- Batch Orient All ---
async function handleOrientAll(preset = 'fastest') {
  const allObjects = [...viewer.objects];
  if (allObjects.length === 0) return;

  showProgress('Orienting all models...');
  for (let i = 0; i < allObjects.length; i++) {
    const obj = allObjects[i];
    viewer.selectObject(obj.id);
    const geometry = viewer.getModelGeometry();
    if (!geometry) continue;

    updateProgress(i / allObjects.length, `Orienting model ${i + 1} / ${allObjects.length}`);

    try {
      const quaternion = await optimizeOrientationAsync(geometry, preset, (fraction) => {
        const overall = (i + fraction) / allObjects.length;
        updateProgress(overall, `Orienting model ${i + 1} / ${allObjects.length}`);
      });
      viewer.applyRotation(quaternion);
    } catch (error) {
      console.error(`Failed to orient model ${i + 1}`, error);
    }
  }
  viewer.clearSelection();
  hideProgress();
}

// --- Batch Support All ---
async function handleSupportAll() {
  const allObjects = [...viewer.objects];
  if (allObjects.length === 0) return;

  showProgress('Generating supports for all models...');
  for (let i = 0; i < allObjects.length; i++) {
    const obj = allObjects[i];
    viewer.selectObject(obj.id);
    const geometry = viewer.getModelGeometry();
    if (!geometry) continue;

    updateProgress(i / allObjects.length, `Supporting model ${i + 1} / ${allObjects.length}`);

    const supportGeo = await generateSupports(geometry, {
      overhangAngle: parseFloat(overhangAngleInput.value),
      density: parseFloat(supportDensityInput.value),
      tipDiameter: parseFloat(tipDiameterInput.value),
      supportThickness: parseFloat(supportThicknessInput.value),
      autoThickness: autoThicknessInput.checked,
      internalSupports: internalSupportsInput.checked,
      crossBracing: crossBracingInput.checked,
      onProgress: (fraction) => {
        const overall = (i + fraction) / allObjects.length;
        updateProgress(overall, `Supporting model ${i + 1} / ${allObjects.length}`);
      }
    });

    if (supportGeo.attributes.position && supportGeo.attributes.position.count > 0) {
      viewer.setSupports(supportGeo);
    } else {
      viewer.clearSupports();
    }
  }

  viewer.clearSelection();
  slicedLayers = null;
  exportBtn.hidden = true;
  layerPreviewPanel.hidden = true;
  updateEstimate();
  hideProgress();
}

// --- Slicing ---
async function handleSlice() {
  const layerHeight = parseFloat(layerHeightInput.value);

  showProgress('Merging & Uploading geometry...');
  await new Promise(r => setTimeout(r, 50));

  const mergedModelGeo = viewer.getMergedModelGeometry();
  const mergedSupportGeo = viewer.getMergedSupportGeometry();
  
  if (!mergedModelGeo) {
      hideProgress();
      return;
  }

  slicer.uploadGeometry(mergedModelGeo, mergedSupportGeo);
  slicer.setInstances(0, null);

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
  const info = viewer.getOverallInfo();
  if (!info || info.count === 0) {
    printEstimate.textContent = '';
    return;
  }

  const settings = getSettings();
  const modelHeight = parseFloat(info.height);
  const layerCount = Math.ceil(modelHeight / settings.layerHeight);
  const estimate = estimatePrintTime(layerCount, settings);

  printEstimate.innerHTML =
    `<div class="estimate-row"><span class="estimate-label">Layers</span><span class="estimate-value">${layerCount}</span></div>` +
    `<div class="estimate-row"><span class="estimate-label">Height</span><span class="estimate-value">${modelHeight.toFixed(1)} mm</span></div>` +
    `<div class="estimate-row"><span class="estimate-label">Total Time</span><span class="estimate-value">${estimate.hours}h ${estimate.minutes}m</span></div>`;
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
