import { Viewer } from './viewer.js';
import { Slicer, PRINTERS } from './slicer.js';
import { optimizeOrientationAsync, analyzeCurrentOrientation } from './orientation.js';
import { generateSupports } from './supports.js';
import { exportMesh, exportZip, estimatePrintTime } from './exporter.js';
import { mm3ToMl } from './volume.js';
import { DEFAULT_RESIN_MATERIAL_ID, RESIN_MATERIALS } from './materials.js';

// --- State ---
let viewer;
let slicer;
let slicedLayers = null;
// Set after slicing completes; falsy means "use mesh-based pre-slice estimate".
let slicedVolumes = null; // { model: mm³, supports: mm³, total: mm³, exactTotal: boolean, exactBreakdown: boolean }
let selectedMaterialId = DEFAULT_RESIN_MATERIAL_ID;

// Debug access
import * as THREE from 'three';
window.__debug = { get viewer() { return viewer; }, get slicer() { return slicer; }, THREE };

// --- DOM refs ---
const stlInput = document.getElementById('stl-input');
const modelInfo = document.getElementById('model-info');
const transformPanel = document.getElementById('transform-panel');
const orientationPanel = document.getElementById('orientation-panel');
const supportsPanel = document.getElementById('supports-panel');
const editPanel = document.getElementById('edit-panel');
const materialsPanel = document.getElementById('materials-panel');
const slicePanel = document.getElementById('slice-panel');
const layerPreviewPanel = document.getElementById('layer-preview-panel');
const footerActions = document.getElementById('footer-actions');
const materialPicker = document.getElementById('material-picker');
const materialDetail = document.getElementById('material-detail');
const applyMaterialAllBtn = document.getElementById('apply-material-all-btn');

const toolPanels = {
  edit: editPanel,
  transform: transformPanel,
  orient: orientationPanel,
  supports: supportsPanel,
  materials: materialsPanel,
  slice: slicePanel,
};

const printerSelect = document.getElementById('printer-select');

const overhangAngleInput = document.getElementById('overhang-angle');
const overhangAngleVal = document.getElementById('overhang-angle-val');
const autoDensityInput = document.getElementById('auto-density');
const supportDensityInput = document.getElementById('support-density');
const supportDensityVal = document.getElementById('support-density-val');
const supportDensityGroup = document.getElementById('support-density-group');
const tipDiameterInput = document.getElementById('tip-diameter');
const tipDiameterGroup = document.getElementById('tip-diameter-group');
const supportThicknessInput = document.getElementById('support-thickness');
const supportThicknessGroup = document.getElementById('support-thickness-group');
const autoThicknessInput = document.getElementById('auto-thickness');
const supportScopeInput = document.getElementById('support-scope');
const supportApproachInput = document.getElementById('support-approach');
const supportMaxAngleInput = document.getElementById('support-max-angle');
const supportClearanceInput = document.getElementById('support-clearance');
const supportMaxOffsetInput = document.getElementById('support-max-offset');
const crossBracingInput = document.getElementById('cross-bracing');
const basePanEnabledInput = document.getElementById('base-pan-enabled');
const basePanOptions = document.getElementById('base-pan-options');
const basePanMarginInput = document.getElementById('base-pan-margin');
const basePanThicknessInput = document.getElementById('base-pan-thickness');
const basePanLipWidthInput = document.getElementById('base-pan-lip-width');
const basePanLipHeightInput = document.getElementById('base-pan-lip-height');
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
const contextMenu = document.getElementById('context-menu');

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
  
  printerSelect.value = 'photon-mono';

  printerSelect.addEventListener('change', () => {
    const printerKey = printerSelect.value;
    slicer.setPrinter(printerKey);
    viewer.setPrinter(PRINTERS[printerKey]);

    // Clear out sliced output because bounds/resolution changed
    slicedLayers = null;
    slicedVolumes = null;
    exportBtn.hidden = true;
    layerPreviewPanel.hidden = true;
    updateEstimate();
    viewer.updateBoundsWarning();
  });

  // Initialize both viewer and slicer with the default printer
  slicer.setPrinter(printerSelect.value);
  viewer.setPrinter(PRINTERS[printerSelect.value]);
  initMaterialPicker();

  stlInput.addEventListener('change', handleFileLoad);

  // Orientation presets
  orientationPanel.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => handleOrientation(btn.dataset.preset));
  });

  // Toolbar tools
  const transformBtn = document.getElementById('transform-btn');
  const orientBtn = document.getElementById('orient-btn');
  const supportToolBtn = document.getElementById('support-tool-btn');
  const editBtn = document.getElementById('edit-btn');
  const materialBtn = document.getElementById('material-btn');
  const sliceToolBtn = document.getElementById('slice-tool-btn');

  const duplicateBtn = document.getElementById('duplicate-btn');
  const deleteBtn = document.getElementById('delete-btn');
  const clearBtn = document.getElementById('clear-btn');
  const fillBtn = document.getElementById('fill-btn');

  // Edit panel actions
  duplicateBtn.addEventListener('click', () => viewer.duplicateSelected());
  deleteBtn.addEventListener('click', () => viewer.removeSelected());
  clearBtn.addEventListener('click', () => viewer.clearPlate());
  fillBtn.addEventListener('click', () => {
    if (!viewer.fillPlatform()) {
      alert("Model may be too large to duplicate on the platform.");
    }
  });
  applyMaterialAllBtn.addEventListener('click', () => {
    const preset = RESIN_MATERIALS.find(m => m.id === selectedMaterialId);
    viewer.setMaterialPreset(preset, 'all');
  });
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideContextMenu();
    }
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

  canvas.addEventListener('contextmenu', (e) => {
    if (viewer.objects.length === 0) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!contextMenu?.contains(e.target)) {
      hideContextMenu();
    }
  });
  contextMenu?.addEventListener('click', (e) => {
    const button = e.target.closest('[data-export-format]');
    if (!button) return;
    handleMeshExport(button.dataset.exportFormat);
  });
  
  // --- Panel toggle logic ---
  const toolButtons = {
    edit: editBtn,
    transform: transformBtn,
    orient: orientBtn,
    supports: supportToolBtn,
    materials: materialBtn,
    slice: sliceToolBtn,
  };
  let activeToolPanel = 'edit';

  function showToolPanel(name) {
    Object.keys(toolPanels).forEach(k => {
      toolPanels[k].hidden = true;
      toolButtons[k].classList.remove('active');
    });
    layerPreviewPanel.hidden = true;
    footerActions.hidden = name !== 'slice';

    toolPanels[name].hidden = false;
    toolButtons[name].classList.add('active');
    activeToolPanel = name;

    if (name === 'transform') {
      const activeMode = transformPanel.querySelector('.mode-btn.active');
      if (activeMode) viewer.setTransformMode(activeMode.dataset.mode);
    } else {
      viewer.setTransformMode(null);
    }

    if (name === 'slice' && slicedLayers) {
      layerPreviewPanel.hidden = false;
    }
  }

  editBtn.addEventListener('click', () => showToolPanel('edit'));
  transformBtn.addEventListener('click', () => showToolPanel('transform'));
  orientBtn.addEventListener('click', () => showToolPanel('orient'));
  supportToolBtn.addEventListener('click', () => showToolPanel('supports'));
  materialBtn.addEventListener('click', () => showToolPanel('materials'));
  sliceToolBtn.addEventListener('click', () => showToolPanel('slice'));

  // --- Transform panel mode toggles ---
  const modeBtns = transformPanel.querySelectorAll('.mode-btn');
  const transformFieldSets = {
    translate: document.getElementById('transform-move-fields'),
    scale: document.getElementById('transform-scale-fields'),
    rotate: document.getElementById('transform-rotate-fields'),
  };

  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      Object.values(transformFieldSets).forEach(f => f.hidden = true);
      transformFieldSets[mode].hidden = false;
      viewer.setTransformMode(mode);
    });
  });

  // Transform numeric inputs
  const moveXInput = document.getElementById('move-x');
  const moveYInput = document.getElementById('move-y');
  const moveZInput = document.getElementById('move-z');
  const scaleXInput = document.getElementById('scale-x');
  const scaleYInput = document.getElementById('scale-y');
  const scaleZInput = document.getElementById('scale-z');
  const sizeXInput = document.getElementById('size-x');
  const sizeYInput = document.getElementById('size-y');
  const sizeZInput = document.getElementById('size-z');
  const rotateXInput = document.getElementById('rotate-x');
  const rotateYInput = document.getElementById('rotate-y');
  const rotateZInput = document.getElementById('rotate-z');
  const uniformScaleInput = document.getElementById('uniform-scale');

  // After mutating mesh.position/rotation/scale from a panel input, commit it
  // by baking the transform — same behavior as releasing the transform gizmo.
  // Without this, supports (which are a sibling mesh in the scene, not a child
  // of the model) stay attached at the original 1:1 dimensions while the
  // model visually changes.
  function commitTransform() {
    viewer._bakeTransform();
    updateTransformInputs();
  }

  function applyTransformFromInputs() {
    if (viewer.selected.length !== 1) return;
    const mesh = viewer.selected[0].mesh;
    mesh.position.set(
      parseFloat(moveXInput.value) || 0,
      parseFloat(moveYInput.value) || 0,
      parseFloat(moveZInput.value) || 0,
    );
    commitTransform();
  }

  [moveXInput, moveYInput, moveZInput].forEach(el => {
    el.addEventListener('change', applyTransformFromInputs);
  });

  function applyScaleFromInputs(changedAxis) {
    if (viewer.selected.length !== 1) return;
    const sx = parseFloat(scaleXInput.value) / 100 || 1;
    const sy = parseFloat(scaleYInput.value) / 100 || 1;
    const sz = parseFloat(scaleZInput.value) / 100 || 1;

    if (uniformScaleInput.checked) {
      const val = changedAxis === 'x' ? sx : changedAxis === 'y' ? sy : sz;
      scaleXInput.value = Math.round(val * 100);
      scaleYInput.value = Math.round(val * 100);
      scaleZInput.value = Math.round(val * 100);
      viewer.selected[0].mesh.scale.set(val, val, val);
    } else {
      viewer.selected[0].mesh.scale.set(sx, sy, sz);
    }
    commitTransform();
  }

  function getSelectedWorldSize() {
    if (viewer.selected.length !== 1) return null;
    const mesh = viewer.selected[0].mesh;
    mesh.geometry.computeBoundingBox();
    mesh.updateMatrixWorld(true);
    const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    const size = new THREE.Vector3();
    box.getSize(size);
    return size;
  }

  function applySizeFromInputs(changedAxis) {
    if (viewer.selected.length !== 1) return;
    const currentSize = getSelectedWorldSize();
    if (!currentSize || currentSize.x <= 0 || currentSize.y <= 0 || currentSize.z <= 0) return;

    const targetX = parseFloat(sizeXInput.value);
    const targetY = parseFloat(sizeYInput.value);
    const targetZ = parseFloat(sizeZInput.value);
    if (uniformScaleInput.checked) {
      const currentAxisSize = changedAxis === 'x' ? currentSize.x : changedAxis === 'y' ? currentSize.y : currentSize.z;
      const targetAxisSize = changedAxis === 'x' ? targetX : changedAxis === 'y' ? targetY : targetZ;
      if (!Number.isFinite(targetAxisSize) || targetAxisSize <= 0 || currentAxisSize <= 0) return;
      const factor = targetAxisSize / currentAxisSize;
      viewer.selected[0].mesh.scale.multiplyScalar(factor);
    } else {
      viewer.selected[0].mesh.scale.set(
        Number.isFinite(targetX) && targetX > 0 ? targetX / currentSize.x : 1,
        Number.isFinite(targetY) && targetY > 0 ? targetY / currentSize.y : 1,
        Number.isFinite(targetZ) && targetZ > 0 ? targetZ / currentSize.z : 1,
      );
    }
    commitTransform();
  }

  scaleXInput.addEventListener('change', () => applyScaleFromInputs('x'));
  scaleYInput.addEventListener('change', () => applyScaleFromInputs('y'));
  scaleZInput.addEventListener('change', () => applyScaleFromInputs('z'));
  sizeXInput.addEventListener('change', () => applySizeFromInputs('x'));
  sizeYInput.addEventListener('change', () => applySizeFromInputs('y'));
  sizeZInput.addEventListener('change', () => applySizeFromInputs('z'));

  function applyRotationFromInputs() {
    if (viewer.selected.length !== 1) return;
    const deg2rad = Math.PI / 180;
    viewer.selected[0].mesh.rotation.set(
      (parseFloat(rotateXInput.value) || 0) * deg2rad,
      (parseFloat(rotateYInput.value) || 0) * deg2rad,
      (parseFloat(rotateZInput.value) || 0) * deg2rad,
    );
    commitTransform();
  }

  [rotateXInput, rotateYInput, rotateZInput].forEach(el => {
    el.addEventListener('change', applyRotationFromInputs);
  });

  canvas.addEventListener('selection-changed', () => {
    const singleSelected = viewer.selected.length === 1;
    const hasSelection = viewer.selected.length > 0;

    // Single-object tools in left toolbar
    [transformBtn, orientBtn, supportToolBtn].forEach(btn => {
       btn.style.opacity = singleSelected ? '1' : '0.3';
       btn.style.pointerEvents = singleSelected ? 'auto' : 'none';
    });

    // Workflow steps that need plate content
    editBtn.style.opacity = (hasSelection || viewer.objects.length > 0) ? '1' : '0.3';
    editBtn.style.pointerEvents = (hasSelection || viewer.objects.length > 0) ? 'auto' : 'none';
    materialBtn.style.opacity = viewer.objects.length > 0 ? '1' : '0.3';
    materialBtn.style.pointerEvents = viewer.objects.length > 0 ? 'auto' : 'none';
    sliceToolBtn.style.opacity = viewer.objects.length > 0 ? '1' : '0.3';
    sliceToolBtn.style.pointerEvents = viewer.objects.length > 0 ? 'auto' : 'none';

    // Within edit panel, enable/disable individual buttons
    duplicateBtn.style.opacity = hasSelection ? '1' : '0.5';
    duplicateBtn.style.pointerEvents = hasSelection ? 'auto' : 'none';
    fillBtn.style.opacity = singleSelected ? '1' : '0.5';
    fillBtn.style.pointerEvents = singleSelected ? 'auto' : 'none';
    deleteBtn.style.opacity = hasSelection ? '1' : '0.5';
    deleteBtn.style.pointerEvents = hasSelection ? 'auto' : 'none';

    // Close single-object panels when no single selection
    if (!singleSelected && activeToolPanel && (activeToolPanel === 'transform' || activeToolPanel === 'orient' || activeToolPanel === 'supports')) {
      toolPanels[activeToolPanel].hidden = true;
      toolButtons[activeToolPanel].classList.remove('active');
      activeToolPanel = 'edit';
      toolPanels.edit.hidden = false;
      toolButtons.edit.classList.add('active');
      viewer.setTransformMode(null);
    }

    if (singleSelected) {
        zElevationInput.value = viewer.selected[0].elevation;
        updateTransformInputs();
    }

    updateWorkspaceInfo();
    syncMaterialPicker();
  });

  canvas.addEventListener('material-changed', () => {
    selectedMaterialId = viewer.getActiveMaterialPreset().id;
    syncMaterialPicker();
  });

  function updateTransformInputs() {
    if (viewer.selected.length !== 1) return;
    const mesh = viewer.selected[0].mesh;
    moveXInput.value = Math.round(mesh.position.x * 100) / 100;
    moveYInput.value = Math.round(mesh.position.y * 100) / 100;
    moveZInput.value = Math.round(mesh.position.z * 100) / 100;
    scaleXInput.value = Math.round(mesh.scale.x * 100);
    scaleYInput.value = Math.round(mesh.scale.y * 100);
    scaleZInput.value = Math.round(mesh.scale.z * 100);
    const size = getSelectedWorldSize();
    if (size) {
      sizeXInput.value = Math.round(size.x * 100) / 100;
      sizeYInput.value = Math.round(size.y * 100) / 100;
      sizeZInput.value = Math.round(size.z * 100) / 100;
    }
    const rad2deg = 180 / Math.PI;
    rotateXInput.value = Math.round(mesh.rotation.x * rad2deg);
    rotateYInput.value = Math.round(mesh.rotation.y * rad2deg);
    rotateZInput.value = Math.round(mesh.rotation.z * rad2deg);
  }
  
  function updateWorkspaceInfo() {
    const info = viewer.getOverallInfo();
    const hasObjs = viewer.objects.length > 0;
    clearBtn.style.opacity = hasObjs ? '1' : '0.5';
    clearBtn.style.pointerEvents = hasObjs ? 'auto' : 'none';

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
      slicedVolumes = null;
      exportBtn.hidden = true;
      layerPreviewPanel.hidden = true;
    } else {
      modelInfo.classList.remove('visible');
      printEstimate.innerHTML = '';
      slicedLayers = null;
      slicedVolumes = null;
      exportBtn.hidden = true;
      layerPreviewPanel.hidden = true;
    }
    viewer.updateBoundsWarning();
  }

  canvas.addEventListener('mesh-changed', updateWorkspaceInfo);
  
  showToolPanel('edit');

  // Support controls
  overhangAngleInput.addEventListener('input', () => {
    overhangAngleVal.textContent = overhangAngleInput.value + '°';
  });
  supportDensityInput.addEventListener('input', () => {
    supportDensityVal.textContent = supportDensityInput.value;
  });
  autoDensityInput.addEventListener('change', () => {
    supportDensityInput.disabled = autoDensityInput.checked;
    supportDensityGroup.style.opacity = autoDensityInput.checked ? '0.5' : '1';
    supportDensityGroup.style.pointerEvents = autoDensityInput.checked ? 'none' : 'auto';
  });
  autoThicknessInput.addEventListener('change', () => {
    tipDiameterInput.disabled = autoThicknessInput.checked;
    tipDiameterGroup.style.opacity = autoThicknessInput.checked ? '0.5' : '1';
    tipDiameterGroup.style.pointerEvents = autoThicknessInput.checked ? 'none' : 'auto';
    supportThicknessInput.disabled = autoThicknessInput.checked;
    supportThicknessGroup.style.opacity = autoThicknessInput.checked ? '0.5' : '1';
    supportThicknessGroup.style.pointerEvents = autoThicknessInput.checked ? 'none' : 'auto';
  });
  basePanEnabledInput.addEventListener('change', () => {
    [basePanMarginInput, basePanThicknessInput, basePanLipWidthInput, basePanLipHeightInput].forEach(input => {
      input.disabled = !basePanEnabledInput.checked;
    });
    basePanOptions.style.opacity = basePanEnabledInput.checked ? '1' : '0.5';
    basePanOptions.style.pointerEvents = basePanEnabledInput.checked ? 'auto' : 'none';
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
    slicedVolumes = null;
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

function initMaterialPicker() {
  materialPicker.innerHTML = '';
  RESIN_MATERIALS.forEach((material) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'material-card';
    card.dataset.materialId = material.id;
    card.innerHTML = `
      <span class="material-card-top">
        <span class="material-swatch" style="background:${material.swatch}"></span>
        <span class="material-brand">${material.brand}</span>
      </span>
      <span class="material-product">${material.product}</span>
      <span class="material-color">${material.colorName}</span>
    `;
    card.addEventListener('click', () => {
      selectedMaterialId = material.id;
      viewer.setMaterialPreset(material, 'selection');
      syncMaterialPicker();
    });
    materialPicker.appendChild(card);
  });
  syncMaterialPicker();
}

function syncMaterialPicker() {
  if (!materialPicker) return;
  const activePreset = viewer?.getActiveMaterialPreset?.();
  const activeId = activePreset?.id || selectedMaterialId;
  selectedMaterialId = activeId;
  materialPicker.querySelectorAll('.material-card').forEach(card => {
    card.classList.toggle('active', card.dataset.materialId === activeId);
  });

  const material = RESIN_MATERIALS.find(m => m.id === activeId) || RESIN_MATERIALS[0];
  const opacityPct = Math.round(material.opacity * 100);
  const reflectivenessPct = Math.round((1 - material.roughness) * 100);
  const translucentLabel = material.transmission > 0.45 ? 'transparent' : material.opacity < 0.85 ? 'translucent' : 'opaque';
  materialDetail.innerHTML = `
    <div class="material-detail-title">${material.brand} ${material.colorName}</div>
    <div>${material.description}</div>
    <div class="material-metrics">
      <span>Opacity ${opacityPct}%</span>
      <span>Reflect ${reflectivenessPct}%</span>
      <span>${translucentLabel}</span>
    </div>
  `;
}

async function loadDefaultModel() {
  try {
    const response = await fetch(import.meta.env.BASE_URL + 'models/d20v2_thick.stl');
    if (!response.ok) return;
    const buffer = await response.arrayBuffer();
    viewer.loadSTL(buffer, 2);
    layerPreviewPanel.hidden = true;
    exportBtn.hidden = true;
    slicedLayers = null;
    slicedVolumes = null;
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

      layerPreviewPanel.hidden = true;
      exportBtn.hidden = true;
      slicedLayers = null;
      slicedVolumes = null;

      updateEstimate();
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
    autoDensity: autoDensityInput.checked,
    tipDiameter: parseFloat(tipDiameterInput.value),
    supportThickness: parseFloat(supportThicknessInput.value),
    autoThickness: autoThicknessInput.checked,
    supportScope: supportScopeInput.value,
    approachMode: supportApproachInput.value,
    maxPillarAngle: parseFloat(supportMaxAngleInput.value),
    modelClearance: parseFloat(supportClearanceInput.value),
    maxContactOffset: parseFloat(supportMaxOffsetInput.value),
    crossBracing: crossBracingInput.checked,
    basePanEnabled: basePanEnabledInput.checked,
    basePanMargin: parseFloat(basePanMarginInput.value),
    basePanThickness: parseFloat(basePanThicknessInput.value),
    basePanLipWidth: parseFloat(basePanLipWidthInput.value),
    basePanLipHeight: parseFloat(basePanLipHeightInput.value),
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
  slicedVolumes = null;
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
      autoDensity: autoDensityInput.checked,
      tipDiameter: parseFloat(tipDiameterInput.value),
      supportThickness: parseFloat(supportThicknessInput.value),
      autoThickness: autoThicknessInput.checked,
      supportScope: supportScopeInput.value,
      approachMode: supportApproachInput.value,
      maxPillarAngle: parseFloat(supportMaxAngleInput.value),
      modelClearance: parseFloat(supportClearanceInput.value),
      maxContactOffset: parseFloat(supportMaxOffsetInput.value),
      crossBracing: crossBracingInput.checked,
      basePanEnabled: basePanEnabledInput.checked,
      basePanMargin: parseFloat(basePanMarginInput.value),
      basePanThickness: parseFloat(basePanThicknessInput.value),
      basePanLipWidth: parseFloat(basePanLipWidthInput.value),
      basePanLipHeight: parseFloat(basePanLipHeightInput.value),
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
  slicedVolumes = null;
  exportBtn.hidden = true;
  layerPreviewPanel.hidden = true;
  updateEstimate();
  hideProgress();
}

// --- Slicing ---
async function handleSlice() {
  const { inBounds } = viewer.checkBounds();
  if (!inBounds) {
    if (!confirm('Model extends beyond the build volume. Slice anyway?')) return;
  }

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

  const printerSpec = slicer.getPrinterSpec();
  const pxArea =
    (printerSpec.buildWidthMM / printerSpec.resolutionX) *
    (printerSpec.buildDepthMM / printerSpec.resolutionY);
  let filledPx = 0;
  const countWhitePixels = (pixels) => {
    let c = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 127) c++;
    }
    return c;
  };

  slicedLayers = await slicer.slice(layerHeight, (current, total) => {
    updateProgress(current / total, `Slicing layer ${current} / ${total}`);
  }, {
    onLayer: (pixels) => { filledPx += countWhitePixels(pixels); },
  });

  const totalVolMm3 = filledPx * pxArea * layerHeight;
  let modelVolMm3 = totalVolMm3;
  let supportVolMm3 = 0;
  let exactBreakdown = true;
  if (mergedSupportGeo) {
    const info = viewer.getOverallInfo();
    const estimatedModel = info?.modelVolume || 0;
    const estimatedSupports = info?.supportVolume || 0;
    const estimatedTotal = estimatedModel + estimatedSupports;
    if (estimatedTotal > 0) {
      modelVolMm3 = totalVolMm3 * (estimatedModel / estimatedTotal);
      supportVolMm3 = totalVolMm3 - modelVolMm3;
    }
    exactBreakdown = false;
  }
  slicedVolumes = {
    model: modelVolMm3,
    supports: supportVolMm3,
    total: totalVolMm3,
    exactTotal: true,
    exactBreakdown,
  };
  updateEstimate();

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

  // Size preview canvas to match printer aspect ratio
  const aspectRatio = spec.resolutionX / spec.resolutionY;
  const previewW = 512;
  const previewH = Math.round(previewW / aspectRatio);
  layerCanvas.width = previewW;
  layerCanvas.height = previewH;

  const ctx = layerCanvas.getContext('2d');

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
  if (slicedVolumes) {
    settings.modelVolumeMm3 = slicedVolumes.model;
    settings.supportVolumeMm3 = slicedVolumes.supports;
    settings.totalVolumeMm3 = slicedVolumes.total;
    settings.volumeBreakdownExact = slicedVolumes.exactBreakdown;
  }
  const spec = slicer.getPrinterSpec();

  showProgress('Exporting...');
  await new Promise(r => setTimeout(r, 50));

  await exportZip(slicedLayers, settings, spec, (current, total, extra) => {
    updateProgress(current / total, extra || `Encoding PNG ${current} / ${total}`);
  });

  hideProgress();
}

async function handleMeshExport(format) {
  hideContextMenu();
  if (viewer.objects.length === 0) return;

  const geometries = [];
  const modelGeometry = viewer.getMergedModelGeometry();
  const supportGeometry = viewer.getMergedSupportGeometry();
  if (modelGeometry) geometries.push(modelGeometry);
  if (supportGeometry) geometries.push(supportGeometry);

  try {
    showProgress(`Exporting ${format.toUpperCase()}...`);
    await new Promise(r => setTimeout(r, 50));
    await exportMesh(geometries, format, 'slicelab-plate');
  } catch (error) {
    console.error(`Failed to export ${format}`, error);
    alert(`Failed to export ${format.toUpperCase()}: ${error.message}`);
  } finally {
    geometries.forEach(geometry => geometry.dispose?.());
    hideProgress();
  }
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

  const exactTotal = !!slicedVolumes?.exactTotal;
  const exactBreakdown = !!slicedVolumes?.exactBreakdown;
  const modelMl = mm3ToMl(slicedVolumes ? slicedVolumes.model : (info.modelVolume || 0));
  const supportMl = mm3ToMl(slicedVolumes ? slicedVolumes.supports : (info.supportVolume || 0));
  const totalMl = mm3ToMl(slicedVolumes?.total ?? ((info.modelVolume || 0) + (info.supportVolume || 0)));
  const pourMl = totalMl * 1.05;
  const breakdownSuffix = exactBreakdown ? '' : ' (est.)';
  const totalSuffix = exactTotal ? '' : ' (est.)';

  const rows = [
    `<div class="estimate-row"><span class="estimate-label">Layers</span><span class="estimate-value">${layerCount}</span></div>`,
    `<div class="estimate-row"><span class="estimate-label">Height</span><span class="estimate-value">${modelHeight.toFixed(1)} mm</span></div>`,
    `<div class="estimate-row"><span class="estimate-label">Model${breakdownSuffix}</span><span class="estimate-value">${modelMl.toFixed(1)} mL</span></div>`,
  ];
  if (supportMl > 0 || slicedVolumes) {
    rows.push(
      `<div class="estimate-row"><span class="estimate-label">Supports${breakdownSuffix}</span><span class="estimate-value">${supportMl.toFixed(1)} mL</span></div>`,
    );
  }
  if (slicedVolumes) {
    rows.push(
      `<div class="estimate-row"><span class="estimate-label">Total${totalSuffix}</span><span class="estimate-value">${totalMl.toFixed(1)} mL <small>(pour ≥${Math.ceil(pourMl)} mL)</small></span></div>`,
    );
  }
  rows.push(
    `<div class="estimate-row"><span class="estimate-label">Total Time</span><span class="estimate-value">${estimate.hours}h ${estimate.minutes}m</span></div>`,
  );

  printEstimate.innerHTML = rows.join('');
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

function showContextMenu(clientX, clientY) {
  if (!contextMenu) return;
  contextMenu.hidden = false;

  const { innerWidth, innerHeight } = window;
  const rect = contextMenu.getBoundingClientRect();
  const x = Math.min(clientX, innerWidth - rect.width - 8);
  const y = Math.min(clientY, innerHeight - rect.height - 8);
  contextMenu.style.left = `${Math.max(8, x)}px`;
  contextMenu.style.top = `${Math.max(8, y)}px`;
}

function hideContextMenu() {
  if (contextMenu) contextMenu.hidden = true;
}

// --- Start ---
init();
