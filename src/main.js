import { Viewer } from './viewer.js';
import { Slicer, PRINTERS } from './slicer.js';
import { optimizeOrientationAsync, analyzeCurrentOrientation } from './orientation.js';
import { generateSupports } from './supports.js';
import { exportMesh, exportZip, estimatePrintTime } from './exporter.js';
import { mm3ToMl } from './volume.js';
import { DEFAULT_RESIN_MATERIAL_ID, RESIN_MATERIALS } from './materials.js';
import { createPlate, clearPlateSlice, renumberDefaultPlateNames } from './plates.js';

// --- State ---
let viewer;
let slicer;
let slicedLayers = null;
// Set after slicing completes; falsy means "use mesh-based pre-slice estimate".
let slicedVolumes = null; // { model: mm³, supports: mm³, total: mm³, exactTotal: boolean, exactBreakdown: boolean }
let selectedMaterialId = DEFAULT_RESIN_MATERIAL_ID;
let selectedPrinterKey = 'photon-mono';
let protectedFace = null;
const project = {
  plates: [createPlate(1)],
  activePlateId: null,
};
project.activePlateId = project.plates[0].id;

const PRINTER_DETAILS = {
  'photon-mono': {
    image: 'printers/anycubic-photon-mono-4k.jpg',
    description: 'Compact Anycubic machine with a small plate for quick tabletop resin prints.',
  },
  'photon-mono-m5s': {
    image: 'printers/anycubic-photon-mono-m5s.jpg',
    description: 'Leveling-free 12K Anycubic printer with a larger mid-size build area.',
  },
  'mars-3': {
    image: 'printers/elegoo-mars-3.jpg',
    description: 'Balanced desktop resin printer with a sharper 4K screen and moderate plate size.',
  },
  'mars-4-ultra': {
    image: 'printers/elegoo-mars-4-ultra.jpg',
    description: 'Fast 9K Mars-series printer with Wi-Fi and very fine 18 micron XY pixels.',
  },
  'saturn-2': {
    image: 'printers/elegoo-saturn-2.jpg',
    description: 'Large-format 8K machine for bigger models or batching many parts at once.',
  },
  'halot-mage-8k': {
    image: 'printers/creality-halot-mage-8k.jpg',
    description: 'Creality 10.3 inch 8K MSLA printer with a flip lid and generous build height.',
  },
  'uniformation-gktwo': {
    image: 'printers/uniformation-gktwo.png',
    description: 'UniFormation 8K printer with a heated chamber and tall 245 mm Z capacity.',
  },
  'sonic-mini-8k': {
    image: 'printers/phrozen-sonic-mini-8k.png',
    description: 'High-detail compact printer with dense 8K resolution for fine miniatures.',
  },
  'sonic-mighty-8k': {
    image: 'printers/phrozen-sonic-mighty-8k.png',
    description: 'Large Phrozen 8K printer for high-detail batches and larger resin parts.',
  },
  'form-4': {
    image: 'printers/formlabs-form-4.jpg',
    description: 'Industrial Formlabs LFD resin printer profile with a 50 micron pixel pitch.',
  },
};

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
const plateTabs = document.getElementById('plate-tabs');
const addPlateBtn = document.getElementById('add-plate-btn');
const removePlateBtn = document.getElementById('remove-plate-btn');
const arrangeBtn = document.getElementById('arrange-btn');
const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');

const toolPanels = {
  edit: editPanel,
  transform: transformPanel,
  orient: orientationPanel,
  supports: supportsPanel,
  materials: materialsPanel,
  slice: slicePanel,
};
let showToolPanelByName = null;

const printerSelectBtn = document.getElementById('printer-select-btn');
const selectedPrinterName = document.getElementById('selected-printer-name');
const selectedPrinterSpec = document.getElementById('selected-printer-spec');
const printerModal = document.getElementById('printer-modal');
const printerModalClose = document.getElementById('printer-modal-close');
const printerGrid = document.getElementById('printer-grid');

const shortcutsBtn = document.getElementById('shortcuts-btn');
const shortcutsModal = document.getElementById('shortcuts-modal');
const shortcutsModalClose = document.getElementById('shortcuts-modal-close');

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
const pickProtectedFaceBtn = document.getElementById('pick-protected-face-btn');
const orientProtectedFaceBtn = document.getElementById('orient-protected-face-btn');
const clearProtectedFaceBtn = document.getElementById('clear-protected-face-btn');
const protectedFaceStatus = document.getElementById('protected-face-status');

const layerHeightInput = document.getElementById('layer-height');
const normalExposureInput = document.getElementById('normal-exposure');
const bottomLayersInput = document.getElementById('bottom-layers');
const bottomExposureInput = document.getElementById('bottom-exposure');
const liftHeightInput = document.getElementById('lift-height');
const liftSpeedInput = document.getElementById('lift-speed');
const summaryPanel = document.getElementById('summary-panel');
const printEstimate = document.getElementById('print-estimate');
const sliceBtn = document.getElementById('slice-btn');
const sliceAllBtn = document.getElementById('slice-all-btn');
const exportBtn = document.getElementById('export-btn');
const exportAllBtn = document.getElementById('export-all-btn');

function listen(target, eventName, handler, options) {
  if (!target) return;
  target.addEventListener(eventName, handler, options);
}

const layerCanvas = document.getElementById('layer-canvas');
const layerSlider = document.getElementById('layer-slider');
const layerInfo = document.getElementById('layer-info');

const progressOverlay = document.getElementById('progress-overlay');
const progressText = document.getElementById('progress-text');
const progressBar = document.getElementById('progress-bar');
const progressPercent = document.getElementById('progress-percent');
const contextMenu = document.getElementById('context-menu');

function getActivePlate() {
  return project.plates.find(plate => plate.id === project.activePlateId) || project.plates[0];
}

function syncSliceRefsFromActivePlate() {
  const plate = getActivePlate();
  slicedLayers = plate.slicedLayers;
  slicedVolumes = plate.slicedVolumes;
  exportBtn.hidden = !slicedLayers;
  exportAllBtn.hidden = !project.plates.some(p => p.slicedLayers);
  layerPreviewPanel.hidden = !slicedLayers || slicePanel.hidden;
}

function saveSliceRefsToActivePlate() {
  const plate = getActivePlate();
  plate.slicedLayers = slicedLayers;
  plate.slicedVolumes = slicedVolumes;
  plate.dirty = !slicedLayers;
}

function clearActivePlateSlice() {
  const plate = getActivePlate();
  clearPlateSlice(plate);
  slicedLayers = null;
  slicedVolumes = null;
  exportBtn.hidden = true;
  exportAllBtn.hidden = !project.plates.some(p => p.slicedLayers);
  layerPreviewPanel.hidden = true;
}

function addPlate({ switchTo = false, layout = true } = {}) {
  const plate = createPlate(project.plates.length + 1);
  project.plates.push(plate);
  if (layout) layoutPlateOrigins();
  renumberDefaultPlateNames(project.plates);
  viewer?.setPlates(project.plates);
  if (layout) viewer?.frameAllPlates();
  renderPlateTabs();
  updateArrangeButtonText();
  if (switchTo) switchToPlate(plate);
  return plate;
}

function updateArrangeButtonText() {
  if (!arrangeBtn) return;
  const newText = project.plates.length > 1 ? 'Auto Distribute' : 'Auto Arrange';
  const textNode = Array.from(arrangeBtn.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (textNode) textNode.textContent = ` ${newText}`;
}

function arrangeActiveOrProject() {
  if (project.plates.length > 1) {
    return handleAutoDistribute();
  }
  const arranged = viewer.autoArrange();
  if (!arranged) {
    alert("Models do not fit on the current build plate.");
  }
  return arranged;
}

function switchToPlate(plate) {
  if (!plate || plate.id === project.activePlateId) return;
  saveSliceRefsToActivePlate();
  project.activePlateId = plate.id;
  viewer.setActivePlate(plate);
  syncSliceRefsFromActivePlate();
  showLayer();
  updateEstimate();
  renderPlateTabs();
}

function layoutPlateOrigins() {
  const spec = PRINTERS[selectedPrinterKey];
  if (!spec) return;
  const gap = Math.max(36, spec.buildWidthMM * 0.22);
  const columns = Math.ceil(Math.sqrt(project.plates.length));
  project.plates.forEach((plate, index) => {
    const oldX = plate.originX || 0;
    const oldZ = plate.originZ || 0;
    const col = index % columns;
    const row = Math.floor(index / columns);
    const originX = col * (spec.buildWidthMM + gap);
    const originZ = row * (spec.buildDepthMM + gap);
    const dx = originX - oldX;
    const dz = originZ - oldZ;
    plate.originX = originX;
    plate.originZ = originZ;
    if (dx !== 0 || dz !== 0) {
      plate.objects.forEach(obj => {
        obj.mesh.position.x += dx;
        obj.mesh.position.z += dz;
        if (obj.supportsMesh) {
          obj.supportsMesh.position.x += dx;
          obj.supportsMesh.position.z += dz;
        }
      });
    }
  });
}

function setSidebarCollapsed(collapsed) {
  const sidebar = document.getElementById('sidebar');
  const workspace = document.getElementById('workspace');
  if (!sidebar || !workspace || !toggleSidebarBtn) return;

  sidebar.classList.toggle('collapsed', collapsed);
  workspace.classList.toggle('sidebar-collapsed', collapsed);
  toggleSidebarBtn.classList.toggle('collapsed', collapsed);

  const icon = toggleSidebarBtn.querySelector('span');
  if (icon) icon.textContent = collapsed ? '‹' : '›';
  toggleSidebarBtn.title = collapsed ? 'Show panel' : 'Hide panel';
  toggleSidebarBtn.setAttribute('aria-label', collapsed ? 'Show panel' : 'Hide panel');
  toggleSidebarBtn.setAttribute('aria-expanded', String(!collapsed));
  setTimeout(() => viewer?._resize(), 220);
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  setSidebarCollapsed(!sidebar.classList.contains('collapsed'));
}

// --- Init ---
function init() {
  const canvas = document.getElementById('viewport');
  viewer = new Viewer(canvas);
  initCanvasPlateDrop(canvas);
  viewer.bindInitialPlate(getActivePlate());
  slicer = new Slicer();

  initPrinterPicker();
  applyPrinter(selectedPrinterKey, { resetSlice: false });
  initMaterialPicker();

  listen(stlInput, 'change', handleFileLoad);

  // Orientation presets
  orientationPanel?.querySelectorAll('[data-preset]').forEach(btn => {
    listen(btn, 'click', () => handleOrientation(btn.dataset.preset));
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
  // Edit panel actions - auto arrange/distribute combined based on plate count
  listen(duplicateBtn, 'click', () => viewer.duplicateSelected());
  listen(deleteBtn, 'click', () => viewer.removeSelected());
  listen(clearBtn, 'click', () => viewer.clearPlate());
  listen(fillBtn, 'click', () => {
    if (!viewer.fillPlatform()) {
      alert("Model may be too large to duplicate on the platform.");
    }
  });
  listen(arrangeBtn, 'click', arrangeActiveOrProject);
  listen(applyMaterialAllBtn, 'click', () => {
    const preset = RESIN_MATERIALS.find(m => m.id === selectedMaterialId);
    viewer.setMaterialPreset(preset, 'all');
  });

  document.addEventListener('keydown', (e) => {
    // Don't interfere with text input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Escape - hide context menu
    if (e.key === 'Escape') {
      hideContextMenu();
      return;
    }

    // H key - toggle right panel
    if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      toggleSidebar();
      return;
    }

    // ? key - show shortcuts modal
    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const shortcutsModal = document.getElementById('shortcuts-modal');
      if (shortcutsModal) shortcutsModal.hidden = false;
      return;
    }

    // Delete/Backspace - remove selected
    if (e.key === 'Delete' || e.key === 'Backspace') {
      viewer.removeSelected();
      return;
    }

    // Ctrl/Cmd + Shift + A - auto arrange (single) or distribute (multi)
    if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      arrangeActiveOrProject();
      return;
    }

    // Ctrl/Cmd + A - select all
    if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      viewer.selectAll();
      return;
    }

    // Ctrl/Cmd + D - duplicate
    if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      viewer.duplicateSelected();
      return;
    }

    // Ctrl/Cmd + C - copy
    if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      viewer.copySelected();
      return;
    }

    // Ctrl/Cmd + V - paste
    if ((e.key === 'v' || e.key === 'V') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      viewer.paste();
      return;
    }

    // Ctrl/Cmd + Z - undo
    if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      viewer.undo();
      return;
    }

    // G key - auto arrange (single plate) or distribute (multi-plate)
    if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      arrangeActiveOrProject();
      return;
    }

    // S key - slice active plate (with Ctrl/Cmd)
    if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      handleSlice();
      return;
    }

    // Ctrl/Cmd + Shift + S - slice all plates
    if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      handleSliceAll();
      return;
    }

    // E key - export active plate (with Ctrl/Cmd)
    if ((e.key === 'e' || e.key === 'E') && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      if (slicedLayers) {
        handleExport('zip');
      }
      return;
    }

    // Ctrl/Cmd + Shift + E - export all plates
    if ((e.key === 'e' || e.key === 'E') && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      handleExportAll();
      return;
    }

    // F key - fill platform
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!viewer.fillPlatform()) {
        // Could show alert if needed
      }
      return;
    }

    // Tab - switch to next tool panel
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const panelOrder = ['edit', 'transform', 'orient', 'supports', 'materials', 'slice'];
      const currentIndex = panelOrder.indexOf(activeToolPanel);
      const nextIndex = e.shiftKey
        ? (currentIndex - 1 + panelOrder.length) % panelOrder.length
        : (currentIndex + 1) % panelOrder.length;
      showToolPanel(panelOrder[nextIndex]);
      return;
    }

    // 1-6 keys - quick switch to tool panels
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const panelShortcuts = { '1': 'edit', '2': 'transform', '3': 'orient', '4': 'supports', '5': 'materials', '6': 'slice' };
      if (panelShortcuts[e.key]) {
        showToolPanel(panelShortcuts[e.key]);
        return;
      }
    }

    // Space - toggle transform mode
    if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (viewer.selected.length > 0 || viewer.objects.length > 0) {
        showToolPanel('transform');
        const currentMode = viewer.transformControl?.getMode?.() || 'translate';
        const modes = ['translate', 'scale', 'rotate'];
        const currentModeIndex = modes.indexOf(currentMode);
        const nextMode = modes[(currentModeIndex + 1) % modes.length];
        modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === nextMode));
        Object.values(transformFieldSets).forEach(f => f.hidden = true);
        transformFieldSets[nextMode].hidden = false;
        viewer.setTransformMode(nextMode);
      }
      return;
    }

    // Left/Right arrows - adjust layer preview when in slice mode
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && activeToolPanel === 'slice' && slicedLayers) {
      e.preventDefault();
      const currentIdx = parseInt(layerSlider.value, 10);
      const maxIdx = slicedLayers.length - 1;
      if (e.key === 'ArrowRight') {
        layerSlider.value = Math.min(currentIdx + 1, maxIdx);
      } else {
        layerSlider.value = Math.max(currentIdx - 1, 0);
      }
      showLayer();
      return;
    }

    // Ctrl/Cmd + Shift + Enter - slice all plates
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      handleSliceAll();
      return;
    }

    // Ctrl/Cmd + Enter - slice active plate
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSlice();
      return;
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
  showToolPanelByName = showToolPanel;

  listen(editBtn, 'click', () => showToolPanel('edit'));
  listen(transformBtn, 'click', () => showToolPanel('transform'));
  listen(orientBtn, 'click', () => showToolPanel('orient'));
  listen(supportToolBtn, 'click', () => showToolPanel('supports'));
  listen(materialBtn, 'click', () => showToolPanel('materials'));
  listen(sliceToolBtn, 'click', () => showToolPanel('slice'));

  // --- Transform panel mode toggles ---
  const modeBtns = transformPanel?.querySelectorAll('.mode-btn') || [];
  const transformFieldSets = {
    translate: document.getElementById('transform-move-fields'),
    scale: document.getElementById('transform-scale-fields'),
    rotate: document.getElementById('transform-rotate-fields'),
  };

  modeBtns.forEach(btn => {
    listen(btn, 'click', () => {
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      Object.values(transformFieldSets).filter(Boolean).forEach(f => f.hidden = true);
      if (transformFieldSets[mode]) transformFieldSets[mode].hidden = false;
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

  function applyTransformFromInputs() {
    if (viewer.selected.length === 0) return;
    viewer.translateSelectionTo(new THREE.Vector3(
      parseFloat(moveXInput.value) || 0,
      parseFloat(moveYInput.value) || 0,
      parseFloat(moveZInput.value) || 0,
    ));
    updateTransformInputs();
  }

  [moveXInput, moveYInput, moveZInput].filter(Boolean).forEach(el => {
    listen(el, 'change', applyTransformFromInputs);
  });

  function applyScaleFromInputs(changedAxis) {
    if (viewer.selected.length === 0) return;
    const sx = parseFloat(scaleXInput.value) / 100 || 1;
    const sy = parseFloat(scaleYInput.value) / 100 || 1;
    const sz = parseFloat(scaleZInput.value) / 100 || 1;

    if (uniformScaleInput.checked) {
      const val = changedAxis === 'x' ? sx : changedAxis === 'y' ? sy : sz;
      scaleXInput.value = Math.round(val * 100);
      scaleYInput.value = Math.round(val * 100);
      scaleZInput.value = Math.round(val * 100);
      viewer.scaleSelectionBy(new THREE.Vector3(val, val, val));
    } else {
      viewer.scaleSelectionBy(new THREE.Vector3(sx, sy, sz));
    }
    updateTransformInputs();
  }

  function getSelectedWorldSize() {
    return viewer.getSelectionWorldSize();
  }

  function applySizeFromInputs(changedAxis) {
    if (viewer.selected.length === 0) return;
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
      viewer.scaleSelectionBy(new THREE.Vector3(factor, factor, factor));
    } else {
      viewer.scaleSelectionBy(new THREE.Vector3(
        Number.isFinite(targetX) && targetX > 0 ? targetX / currentSize.x : 1,
        Number.isFinite(targetY) && targetY > 0 ? targetY / currentSize.y : 1,
        Number.isFinite(targetZ) && targetZ > 0 ? targetZ / currentSize.z : 1,
      ));
    }
    updateTransformInputs();
  }

  listen(scaleXInput, 'change', () => applyScaleFromInputs('x'));
  listen(scaleYInput, 'change', () => applyScaleFromInputs('y'));
  listen(scaleZInput, 'change', () => applyScaleFromInputs('z'));
  listen(sizeXInput, 'change', () => applySizeFromInputs('x'));
  listen(sizeYInput, 'change', () => applySizeFromInputs('y'));
  listen(sizeZInput, 'change', () => applySizeFromInputs('z'));

  function applyRotationFromInputs() {
    if (viewer.selected.length === 0) return;
    const deg2rad = Math.PI / 180;
    viewer.rotateSelectionBy(new THREE.Euler(
      (parseFloat(rotateXInput.value) || 0) * deg2rad,
      (parseFloat(rotateYInput.value) || 0) * deg2rad,
      (parseFloat(rotateZInput.value) || 0) * deg2rad,
    ));
    updateTransformInputs();
  }

  [rotateXInput, rotateYInput, rotateZInput].filter(Boolean).forEach(el => {
    listen(el, 'change', applyRotationFromInputs);
  });

  canvas.addEventListener('selection-changed', () => {
    const singleSelected = viewer.selected.length === 1;
    const hasSelection = viewer.selected.length > 0;

    transformBtn.style.opacity = hasSelection ? '1' : '0.3';
    transformBtn.style.pointerEvents = hasSelection ? 'auto' : 'none';

    // Model tools can process one selected mesh or batch over a multi-selection.
    [orientBtn, supportToolBtn].forEach(btn => {
      btn.style.opacity = hasSelection ? '1' : '0.3';
      btn.style.pointerEvents = hasSelection ? 'auto' : 'none';
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

    // Auto Arrange/Distribute button - enabled when there are objects
    const canArrange = viewer.objects.length > 0;
    if (arrangeBtn) {
      arrangeBtn.style.opacity = canArrange ? '1' : '0.5';
      arrangeBtn.style.pointerEvents = canArrange ? 'auto' : 'none';

      // Update button text based on plate count
      const btnText = arrangeBtn.querySelector('span') || arrangeBtn.lastChild;
      if (btnText && btnText.nodeType === Node.TEXT_NODE) {
        btnText.textContent = project.plates.length > 1 ? 'Auto Distribute' : 'Auto Arrange';
      }
    }

    deleteBtn.style.opacity = hasSelection ? '1' : '0.5';
    deleteBtn.style.pointerEvents = hasSelection ? 'auto' : 'none';

    // Close selected-model panels only when there is no selected model to process.
    if (!hasSelection && activeToolPanel && (activeToolPanel === 'orient' || activeToolPanel === 'supports')) {
      toolPanels[activeToolPanel].hidden = true;
      toolButtons[activeToolPanel].classList.remove('active');
      activeToolPanel = 'edit';
      toolPanels.edit.hidden = false;
      toolButtons.edit.classList.add('active');
      viewer.setTransformMode(null);
    }

    if (hasSelection) {
      zElevationInput.value = viewer.selected[0].elevation;
      updateTransformInputs();
    }

    updateWorkspaceInfo({ detail: { preserveSlice: true } });
    syncMaterialPicker();
  });

  canvas.addEventListener('material-changed', () => {
    selectedMaterialId = viewer.getActiveMaterialPreset().id;
    syncMaterialPicker();
  });

  function updateTransformInputs() {
    if (viewer.selected.length === 0) return;
    const position = viewer.selected.length === 1
      ? viewer.selected[0].mesh.getWorldPosition(new THREE.Vector3())
      : viewer.getSelectionWorldCenter();
    if (position) {
      moveXInput.value = Math.round(position.x * 100) / 100;
      moveYInput.value = Math.round(position.y * 100) / 100;
      moveZInput.value = Math.round(position.z * 100) / 100;
    }
    scaleXInput.value = 100;
    scaleYInput.value = 100;
    scaleZInput.value = 100;
    const size = getSelectedWorldSize();
    if (size) {
      sizeXInput.value = Math.round(size.x * 100) / 100;
      sizeYInput.value = Math.round(size.y * 100) / 100;
      sizeZInput.value = Math.round(size.z * 100) / 100;
    }
    if (viewer.selected.length === 1) {
      const mesh = viewer.selected[0].mesh;
      const rad2deg = 180 / Math.PI;
      rotateXInput.value = Math.round(mesh.rotation.x * rad2deg);
      rotateYInput.value = Math.round(mesh.rotation.y * rad2deg);
      rotateZInput.value = Math.round(mesh.rotation.z * rad2deg);
    } else {
      rotateXInput.value = 0;
      rotateYInput.value = 0;
      rotateZInput.value = 0;
    }
  }

  function updateWorkspaceInfo(event = null) {
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
      if (!event?.detail?.preserveSlice) clearActivePlateSlice();
    } else {
      modelInfo.classList.remove('visible');
      if (summaryPanel) summaryPanel.hidden = true;
      printEstimate.innerHTML = '';
      if (!event?.detail?.preserveSlice) clearActivePlateSlice();
    }
    viewer.updateBoundsWarning();
    renderPlateTabs();
  }

  canvas.addEventListener('mesh-changed', updateWorkspaceInfo);
  canvas.addEventListener('protected-face-picked', handleProtectedFacePicked);
  canvas.addEventListener('plate-changed', (event) => {
    const plate = event.detail?.plate;
    if (!plate) return;
    project.activePlateId = plate.id;
    syncSliceRefsFromActivePlate();
    updateEstimate();
    renderPlateTabs();
  });

  showToolPanel('edit');

  // Support controls
  listen(overhangAngleInput, 'input', () => {
    if (overhangAngleVal) overhangAngleVal.textContent = overhangAngleInput.value + '°';
  });
  listen(supportDensityInput, 'input', () => {
    if (supportDensityVal) supportDensityVal.textContent = supportDensityInput.value;
  });
  listen(autoDensityInput, 'change', () => {
    if (supportDensityInput) supportDensityInput.disabled = autoDensityInput.checked;
    if (supportDensityGroup) {
      supportDensityGroup.style.opacity = autoDensityInput.checked ? '0.5' : '1';
      supportDensityGroup.style.pointerEvents = autoDensityInput.checked ? 'none' : 'auto';
    }
  });
  listen(autoThicknessInput, 'change', () => {
    if (tipDiameterInput) tipDiameterInput.disabled = autoThicknessInput.checked;
    if (tipDiameterGroup) {
      tipDiameterGroup.style.opacity = autoThicknessInput.checked ? '0.5' : '1';
      tipDiameterGroup.style.pointerEvents = autoThicknessInput.checked ? 'none' : 'auto';
    }
    if (supportThicknessInput) supportThicknessInput.disabled = autoThicknessInput.checked;
    if (supportThicknessGroup) {
      supportThicknessGroup.style.opacity = autoThicknessInput.checked ? '0.5' : '1';
      supportThicknessGroup.style.pointerEvents = autoThicknessInput.checked ? 'none' : 'auto';
    }
  });
  listen(basePanEnabledInput, 'change', () => {
    [basePanMarginInput, basePanThicknessInput, basePanLipWidthInput, basePanLipHeightInput].filter(Boolean).forEach(input => {
      input.disabled = !basePanEnabledInput.checked;
    });
    if (basePanOptions) {
      basePanOptions.style.opacity = basePanEnabledInput.checked ? '1' : '0.5';
      basePanOptions.style.pointerEvents = basePanEnabledInput.checked ? 'auto' : 'none';
    }
  });
  listen(generateSupportsBtn, 'click', handleGenerateSupports);
  listen(document.getElementById('orient-all-btn'), 'click', () => handleOrientAll('fastest'));
  listen(document.getElementById('support-all-btn'), 'click', handleSupportAll);
  listen(pickProtectedFaceBtn, 'click', handlePickProtectedFace);
  listen(orientProtectedFaceBtn, 'click', orientProtectedFace);
  listen(clearProtectedFaceBtn, 'click', clearProtectedFace);
  listen(clearSupportsBtn, 'click', () => {
    viewer.clearSupports();
    updateEstimate();
  });
  listen(zElevationInput, 'change', () => {
    viewer.setElevation(parseFloat(zElevationInput.value));
    clearActivePlateSlice();
    updateEstimate();
  });

  // Slice controls
  listen(sliceBtn, 'click', handleSlice);
  listen(sliceAllBtn, 'click', handleSliceAll);
  listen(exportBtn, 'click', handleExport);
  listen(exportAllBtn, 'click', handleExportAll);

  // Settings change -> update estimate
  [layerHeightInput, normalExposureInput, bottomLayersInput,
   bottomExposureInput, liftHeightInput, liftSpeedInput].filter(Boolean).forEach(el => {
    listen(el, 'change', updateEstimate);
  });

  // Layer preview slider
  listen(layerSlider, 'input', showLayer);
  listen(addPlateBtn, 'click', () => switchToPlate(addPlate()));
  listen(removePlateBtn, 'click', () => deletePlate(getActivePlate()));
  initPlateDragTargets();
  listen(toggleSidebarBtn, 'click', toggleSidebar);
  renderPlateTabs();

  // Load default model
  loadDefaultModel();
}

function initPrinterPicker() {
  if (!printerGrid) return;
  printerGrid.innerHTML = '';
  for (const [key, spec] of Object.entries(PRINTERS)) {
    const details = PRINTER_DETAILS[key] || {};
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'printer-card';
    card.dataset.printer = key;
    card.innerHTML = `
      <img class="printer-card-image" src="${assetUrl(details.image)}" alt="${spec.name}">
      <div class="printer-card-title">
        <strong>${spec.name}</strong>
        <span class="printer-active-badge">Selected</span>
      </div>
      <p class="printer-card-desc">${details.description || 'Resin printer profile for slicing and export.'}</p>
      <div class="printer-card-specs">
        <span>Build <b>${formatBuildVolume(spec)}</b></span>
        <span>LCD <b>${spec.resolutionX} × ${spec.resolutionY}</b></span>
        <span>Pixel <b>${formatPixelSize(spec)}</b></span>
      </div>
    `;
    card.addEventListener('click', () => {
      applyPrinter(key);
      closePrinterModal();
    });
    printerGrid.appendChild(card);
  }

  listen(printerSelectBtn, 'click', openPrinterModal);
  listen(printerModalClose, 'click', closePrinterModal);
  listen(printerModal, 'click', (event) => {
    if (event.target === printerModal) closePrinterModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && printerModal && !printerModal.hidden) closePrinterModal();
  });

  // Shortcuts modal
  function openShortcutsModal() {
    if (!shortcutsModal) return;
    shortcutsModal.hidden = false;
    shortcutsModal.setAttribute('aria-expanded', 'true');
  }
  function closeShortcutsModal() {
    if (!shortcutsModal) return;
    shortcutsModal.hidden = true;
    shortcutsModal.setAttribute('aria-expanded', 'false');
  }
  listen(shortcutsBtn, 'click', openShortcutsModal);
  listen(shortcutsModalClose, 'click', closeShortcutsModal);
  listen(shortcutsModal, 'click', (event) => {
    if (event.target === shortcutsModal) closeShortcutsModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && shortcutsModal && !shortcutsModal.hidden) closeShortcutsModal();
  });
}

function renderPlateTabs() {
  if (!plateTabs) return;
  if (removePlateBtn) {
    const removesPlate = project.plates.length > 1;
    const label = removesPlate ? 'Remove active plate' : 'Clear active plate';
    removePlateBtn.title = label;
    removePlateBtn.setAttribute('aria-label', label);
  }
  plateTabs.innerHTML = '';
  project.plates.forEach((plate, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `plate-tab${plate.id === project.activePlateId ? ' active' : ''}`;
    button.draggable = true;
    button.dataset.plateId = plate.id;
    const count = plate.objects.length;
    const status = plate.slicedLayers ? 'sliced' : plate.dirty && count > 0 ? 'dirty' : 'ready';
    button.innerHTML = `
      <span class="plate-tab-title">${escapeHtml(plate.name)}</span>
      <span class="plate-tab-meta">
        <span>${count} item${count === 1 ? '' : 's'}</span>
        <span class="plate-status ${status === 'dirty' ? 'warn' : ''}">${status}</span>
      </span>
    `;
    button.addEventListener('click', () => switchToPlate(plate));
    button.addEventListener('dblclick', () => renamePlate(plate));
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openPlateMenu(plate);
    });
    button.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plate-reorder', plate.id);
      event.dataTransfer.effectAllowed = 'move';
    });
    button.addEventListener('dragover', (event) => {
      if (viewer.selected.length > 0 || event.dataTransfer.types.includes('text/plate-reorder')) {
        event.preventDefault();
        button.classList.add('drag-over');
      }
    });
    button.addEventListener('dragleave', () => button.classList.remove('drag-over'));
    button.addEventListener('drop', (event) => {
      event.preventDefault();
      button.classList.remove('drag-over');
      const reorderId = event.dataTransfer.getData('text/plate-reorder');
      if (reorderId) {
        reorderPlate(reorderId, plate.id);
        return;
      }
      moveSelectionToPlate(plate);
    });
    plateTabs.appendChild(button);
  });
}

function initPlateDragTargets() {
  listen(addPlateBtn, 'dragover', (event) => {
    if (viewer.selected.length === 0) return;
    event.preventDefault();
    addPlateBtn.classList.add('drag-over');
  });
  listen(addPlateBtn, 'dragleave', () => addPlateBtn.classList.remove('drag-over'));
  listen(addPlateBtn, 'drop', (event) => {
    event.preventDefault();
    addPlateBtn.classList.remove('drag-over');
    if (viewer.selected.length === 0) return;
    const plate = addPlate();
    moveSelectionToPlate(plate, { switchAfterMove: true });
  });
}

function initCanvasPlateDrop(canvas) {
  let candidate = null;
  let dragging = false;

  canvas.addEventListener('pointerdown', (event) => {
    if (viewer.selected.length === 0 || event.button !== 0) {
      candidate = null;
      dragging = false;
      return;
    }
    candidate = { x: event.clientX, y: event.clientY };
    dragging = false;
  });

  document.addEventListener('pointermove', (event) => {
    if (!candidate) return;
    const dist = Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y);
    if (dist > 14) {
      dragging = true;
      plateTabs?.classList.add('model-dragging');
    }
  });

  document.addEventListener('pointerup', (event) => {
    if (!candidate) return;
    const wasDragging = dragging;
    candidate = null;
    dragging = false;
    plateTabs?.classList.remove('model-dragging');
    if (!wasDragging || viewer.selected.length === 0) return;

    const target = document.elementFromPoint(event.clientX, event.clientY);
    const plateTab = target?.closest?.('.plate-tab');
    if (plateTab) {
      const plate = project.plates.find(p => p.id === plateTab.dataset.plateId);
      moveSelectionToPlate(plate);
      return;
    }
    if (target?.closest?.('#add-plate-btn')) {
      const plate = addPlate();
      moveSelectionToPlate(plate, { switchAfterMove: true });
    }
  });
}

function moveSelectionToPlate(plate, { switchAfterMove = true } = {}) {
  if (!plate || plate.id === project.activePlateId || viewer.selected.length === 0) return;
  const sourcePlate = getActivePlate();
  const moved = viewer.moveSelectedToPlate(plate);
  if (moved.length === 0) return;
  clearPlateSlice(sourcePlate);
  clearPlateSlice(plate);
  if (sourcePlate.id === project.activePlateId) {
    slicedLayers = null;
    slicedVolumes = null;
  }
  if (switchAfterMove) {
    switchToPlate(plate);
  } else {
    syncSliceRefsFromActivePlate();
  }
  renderPlateTabs();
}

function renamePlate(plate) {
  const nextName = prompt('Plate name', plate.name);
  if (!nextName) return;
  plate.name = nextName.trim() || plate.name;
  renderPlateTabs();
}

function openPlateMenu(plate) {
  const action = prompt(`Plate action for ${plate.name}: rename, duplicate, delete`);
  if (!action) return;
  const normalized = action.trim().toLowerCase();
  if (normalized === 'rename') {
    renamePlate(plate);
  } else if (normalized === 'duplicate') {
    duplicatePlate(plate);
  } else if (normalized === 'delete') {
    deletePlate(plate);
  }
}

function duplicatePlate(plate) {
  const copy = createPlate(project.plates.length + 1);
  copy.name = `${plate.name} Copy`;
  copy.originX = plate.originX || 0;
  copy.originZ = plate.originZ || 0;
  copy.objects = viewer.duplicateObjectsForPlate(plate.objects);
  project.plates.push(copy);
  layoutPlateOrigins();
  viewer.setPlates(project.plates);
  switchToPlate(copy);
}

function deletePlate(plate) {
  if (project.plates.length === 1) {
    if (plate.objects.length > 0 && !confirm(`Clear ${plate.name}?`)) return;
    viewer.clearPlate();
    clearActivePlateSlice();
    renderPlateTabs();
    updateArrangeButtonText();
    return;
  }
  if (!confirm(`Delete ${plate.name}?`)) return;
  const wasActive = plate.id === project.activePlateId;
  const index = project.plates.indexOf(plate);
  const objectsToDelete = [...plate.objects];
  if (wasActive) viewer.replaceActiveObjects([]);
  objectsToDelete.forEach(obj => {
    obj.mesh.parent?.remove(obj.mesh);
    obj.supportsMesh?.parent?.remove(obj.supportsMesh);
    obj.mesh.geometry.dispose();
    obj.mesh.material.dispose();
    obj.supportsMesh?.geometry.dispose();
    obj.supportsMesh?.material.dispose();
  });
  project.plates.splice(index, 1);
  layoutPlateOrigins();
  viewer.setPlates(project.plates);
  renumberDefaultPlateNames(project.plates);
  if (wasActive) {
    project.activePlateId = project.plates[Math.max(0, index - 1)].id;
    viewer.setActivePlate(getActivePlate());
    syncSliceRefsFromActivePlate();
  }
  renderPlateTabs();
  updateArrangeButtonText();
}

function reorderPlate(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const sourceIndex = project.plates.findIndex(plate => plate.id === sourceId);
  const targetIndex = project.plates.findIndex(plate => plate.id === targetId);
  if (sourceIndex === -1 || targetIndex === -1) return;
  const [plate] = project.plates.splice(sourceIndex, 1);
  project.plates.splice(targetIndex, 0, plate);
  layoutPlateOrigins();
  viewer.setPlates(project.plates);
  renumberDefaultPlateNames(project.plates);
  renderPlateTabs();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

function handleAutoDistribute() {
  if (!viewer.printer) return false;
  const allObjects = project.plates.flatMap(plate => plate.objects);
  if (allObjects.length === 0) return false;

  const padding = 3;
  const elevation = 10;
  const usableWidth = viewer.printer.buildWidthMM - padding * 2;
  const usableDepth = viewer.printer.buildDepthMM - padding * 2;
  const activePlate = getActivePlate();

  const items = allObjects.map(obj => {
    obj.mesh.geometry.computeBoundingBox();
    obj.mesh.updateMatrixWorld(true);
    const box = obj.mesh.geometry.boundingBox.clone().applyMatrix4(obj.mesh.matrixWorld);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    return {
      obj,
      box,
      center,
      width: size.x,
      depth: size.z,
      area: size.x * size.z,
    };
  }).sort((a, b) => b.area - a.area);

  const tooLarge = items.filter(item => item.width > usableWidth || item.depth > usableDepth);
  const packable = items.filter(item => !tooLarge.includes(item));
  const bins = [];

  function makeBin(plate) {
    return {
      plate,
      placements: [],
      cursorX: 0,
      cursorZ: 0,
      rowDepth: 0,
      arrangedWidth: 0,
      arrangedDepth: 0,
    };
  }

  function tryPlace(bin, item) {
    if (bin.cursorX > 0 && bin.cursorX + item.width > usableWidth) {
      bin.cursorX = 0;
      bin.cursorZ += bin.rowDepth + padding;
      bin.rowDepth = 0;
    }
    if (bin.cursorZ + item.depth > usableDepth) return false;

    bin.placements.push({
      item,
      x: bin.cursorX + item.width / 2,
      z: bin.cursorZ + item.depth / 2,
    });
    bin.cursorX += item.width + padding;
    bin.rowDepth = Math.max(bin.rowDepth, item.depth);
    bin.arrangedWidth = Math.max(bin.arrangedWidth, bin.cursorX - padding);
    bin.arrangedDepth = Math.max(bin.arrangedDepth, bin.cursorZ + bin.rowDepth);
    return true;
  }

  project.plates.forEach(plate => bins.push(makeBin(plate)));
  packable.forEach(item => {
    let placed = bins.some(bin => tryPlace(bin, item));
    if (!placed) {
      const plate = addPlate({ layout: false });
      const bin = makeBin(plate);
      bins.push(bin);
      placed = tryPlace(bin, item);
    }
  });

  viewer.clearSelection();
  project.plates.forEach(plate => {
    plate.objects = [];
    plate.selectedIds = [];
    clearPlateSlice(plate);
  });
  layoutPlateOrigins();

  bins.forEach(bin => {
    const plateOriginX = bin.plate.originX || 0;
    const plateOriginZ = bin.plate.originZ || 0;
    bin.placements.forEach(({ item, x, z }) => {
      const targetX = plateOriginX + x - bin.arrangedWidth / 2;
      const targetZ = plateOriginZ + z - bin.arrangedDepth / 2;
      const dx = targetX - item.center.x;
      const dy = elevation - item.box.min.y;
      const dz = targetZ - item.center.z;

      item.obj.mesh.position.x += dx;
      item.obj.mesh.position.y += dy;
      item.obj.mesh.position.z += dz;
      item.obj.elevation = elevation;
      item.obj.mesh.updateMatrixWorld(true);
      disposeSupports(item.obj);
      bin.plate.objects.push(item.obj);
    });
  });

  if (tooLarge.length > 0) {
    const overflowPlate = project.plates[0] || addPlate();
    tooLarge.forEach((item, index) => {
      item.obj.mesh.position.x = (overflowPlate.originX || 0) + viewer.printer.buildWidthMM / 2 + padding * 3 + index * padding * 4;
      item.obj.mesh.position.z = overflowPlate.originZ || 0;
      item.obj.mesh.updateMatrixWorld(true);
      disposeSupports(item.obj);
      overflowPlate.objects.push(item.obj);
    });
    alert(`${tooLarge.length} model${tooLarge.length === 1 ? '' : 's'} cannot fit on the selected printer plate.`);
  }

  project.activePlateId = activePlate.id;
  viewer.setPlates(project.plates);
  viewer.setActivePlate(activePlate);
  viewer.frameAllPlates();
  syncSliceRefsFromActivePlate();
  updateEstimate();
  renderPlateTabs();
  return tooLarge.length === 0;
}

function disposeSupports(obj) {
  if (!obj.supportsMesh) return;
  if (obj.supportsMesh.parent) obj.supportsMesh.parent.remove(obj.supportsMesh);
  obj.supportsMesh.geometry.dispose();
  obj.supportsMesh.material.dispose();
  obj.supportsMesh = null;
  obj._cachedLocalSupportVolume = undefined;
}

function applyPrinter(printerKey, { resetSlice = true } = {}) {
  if (!PRINTERS[printerKey]) return;
  selectedPrinterKey = printerKey;
  const spec = PRINTERS[printerKey];
  slicer.setPrinter(printerKey);
  layoutPlateOrigins();
  viewer.setPlates(project.plates);
  viewer.setPrinter(spec);
  if (project.plates.length > 1) viewer.frameAllPlates();
  selectedPrinterName.textContent = spec.name;
  selectedPrinterSpec.textContent = `${formatBuildVolume(spec)} · ${spec.resolutionX} × ${spec.resolutionY}`;
  printerGrid.querySelectorAll('.printer-card').forEach(card => {
    const active = card.dataset.printer === printerKey;
    card.classList.toggle('active', active);
    card.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  if (resetSlice) {
    project.plates.forEach(clearPlateSlice);
    syncSliceRefsFromActivePlate();
    updateEstimate();
    viewer.updateBoundsWarning();
  }
}

function openPrinterModal() {
  if (!printerModal) return;
  printerModal.hidden = false;
  printerSelectBtn?.setAttribute('aria-expanded', 'true');
  const activeCard = printerGrid?.querySelector('.printer-card.active') || printerGrid?.querySelector('.printer-card');
  activeCard?.focus();
}

function closePrinterModal() {
  if (!printerModal) return;
  printerModal.hidden = true;
  printerSelectBtn?.setAttribute('aria-expanded', 'false');
  printerSelectBtn?.focus();
}

function formatBuildVolume(spec) {
  return `${spec.buildWidthMM} × ${spec.buildDepthMM} × ${spec.buildHeightMM} mm`;
}

function formatPixelSize(spec) {
  const xMicron = (spec.buildWidthMM / spec.resolutionX) * 1000;
  const yMicron = (spec.buildDepthMM / spec.resolutionY) * 1000;
  return `${xMicron.toFixed(1)} × ${yMicron.toFixed(1)} μm`;
}

function assetUrl(path) {
  return `${import.meta.env.BASE_URL}${path}`;
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
    clearActivePlateSlice();
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

      clearActivePlateSlice();

      updateEstimate();
      hideProgress();
    }, 50);
  };
  reader.readAsArrayBuffer(file);
}

// --- Orientation ---
async function handleOrientation(preset) {
  const targets = [...viewer.selected];
  if (targets.length === 0) return;
  const originalSelectionIds = targets.map(obj => obj.id);

  showProgress(targets.length === 1 ? 'Optimizing orientation...' : 'Optimizing selected models...');

  let failureCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const obj = targets[i];
    viewer.selectObject(obj.id);
    const geometry = viewer.getModelGeometry();
    if (!geometry) continue;

    updateProgress(i / targets.length, targets.length === 1 ? 'Optimizing orientation...' : `Orienting model ${i + 1} / ${targets.length}`);

    try {
      const quaternion = await optimizeOrientationAsync(geometry, preset, (fraction, text) => {
        const overall = (i + fraction) / targets.length;
        updateProgress(overall, targets.length === 1 ? text : `Orienting model ${i + 1} / ${targets.length}`);
      });
      viewer.applyRotation(quaternion);
    } catch (error) {
      failureCount += 1;
      console.error(`Failed to orient model ${i + 1}`, error);
    }
  }

  viewer.selectObjects(originalSelectionIds);
  showToolPanelByName?.('orient');
  if (failureCount > 0) {
    alert(`Failed to orient ${failureCount} selected model${failureCount === 1 ? '' : 's'}.`);
  }
  hideProgress();
}

function getSupportOptions(onProgress) {
  return {
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
    onProgress,
  };
}

// --- Supports ---
async function handleGenerateSupports() {
  const targets = [...viewer.selected];
  if (targets.length === 0) return;
  const originalSelectionIds = targets.map(obj => obj.id);

  showProgress(targets.length === 1 ? 'Generating supports...' : 'Generating supports for selected models...');
  await new Promise(r => setTimeout(r, 50));

  let failureCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const obj = targets[i];
    viewer.selectObject(obj.id);
    const geometry = viewer.getModelGeometry();
    if (!geometry) continue;

    updateProgress(i / targets.length, targets.length === 1 ? 'Generating supports...' : `Supporting model ${i + 1} / ${targets.length}`);

    try {
      const supportGeo = await generateSupports(geometry, getSupportOptions((fraction, text) => {
        const overall = (i + fraction) / targets.length;
        updateProgress(overall, targets.length === 1 ? text : `Supporting model ${i + 1} / ${targets.length}`);
      }));

      if (supportGeo.attributes.position && supportGeo.attributes.position.count > 0) {
        viewer.setSupports(supportGeo);
      } else {
        viewer.clearSupports();
      }
    } catch (error) {
      failureCount += 1;
      console.error(`Failed to generate supports for model ${i + 1}`, error);
    }
  }

  viewer.selectObjects(originalSelectionIds);
  showToolPanelByName?.('supports');
  clearActivePlateSlice();
  updateEstimate();
  if (failureCount > 0) {
    alert(`Failed to generate supports for ${failureCount} selected model${failureCount === 1 ? '' : 's'}.`);
  }
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

// --- Find Significant Faces ---
function handlePickProtectedFace() {
  if (viewer.objects.length === 0) return;
  const enabled = !viewer.facePickMode;
  viewer.setFacePickMode(enabled);
  pickProtectedFaceBtn?.classList.toggle('active', enabled);
  if (protectedFaceStatus) {
    protectedFaceStatus.textContent = enabled
      ? 'Click the cosmetic surface on the model.'
      : (protectedFace ? 'Protected face selected.' : 'No protected face selected.');
  }
}

function handleProtectedFacePicked(event) {
  const selectedSize = viewer.getSelectionWorldSize();
  const selectedMaxDim = selectedSize ? Math.max(selectedSize.x, selectedSize.y, selectedSize.z) : 80;
  const markerSize = THREE.MathUtils.clamp(selectedMaxDim * 0.045, 3, 10);

  protectedFace = {
    objectId: event.detail.objectId,
    point: event.detail.point.clone(),
    normal: event.detail.normal.clone().normalize(),
  };
  pickProtectedFaceBtn?.classList.remove('active');
  if (orientProtectedFaceBtn) orientProtectedFaceBtn.disabled = false;
  if (clearProtectedFaceBtn) clearProtectedFaceBtn.disabled = false;
  if (protectedFaceStatus) protectedFaceStatus.textContent = 'Protected face selected. Orient will tilt it upward about 45° so supports avoid that surface.';
  viewer.clearSignificantFaceMarkers();
  viewer.addSignificantFaceMarker(protectedFace.point, protectedFace.normal, markerSize * markerSize, 0x00a86b, 1, {
    size: markerSize,
    arrowLength: markerSize * 2.6,
    showLabel: false,
  });
  viewer.requestRender();
}

function clearProtectedFace() {
  protectedFace = null;
  viewer.setFacePickMode(false);
  viewer.clearSignificantFaceMarkers();
  pickProtectedFaceBtn?.classList.remove('active');
  if (orientProtectedFaceBtn) orientProtectedFaceBtn.disabled = true;
  if (clearProtectedFaceBtn) clearProtectedFaceBtn.disabled = true;
  if (protectedFaceStatus) protectedFaceStatus.textContent = 'No protected face selected.';
  viewer.requestRender();
}

function orientProtectedFace() {
  if (!protectedFace || viewer.selected.length !== 1) return;
  const selected = viewer.selected[0];
  if (selected.id !== protectedFace.objectId) {
    viewer.selectObject(protectedFace.objectId);
  }
  alignModelToFace(protectedFace.normal, protectedSurfacePrintNormal(protectedFace.normal));
  protectedFace = null;
  viewer.clearSignificantFaceMarkers();
  if (orientProtectedFaceBtn) orientProtectedFaceBtn.disabled = true;
  if (clearProtectedFaceBtn) clearProtectedFaceBtn.disabled = true;
  if (protectedFaceStatus) protectedFaceStatus.textContent = 'Oriented protected face upward at about 45°. Regenerate supports before slicing.';
}

async function handleFindSignificantFaces() {
  if (viewer.selected.length !== 1) {
    alert('Please select exactly one model to analyze.');
    return;
  }

  const geometry = viewer.getModelGeometry();
  if (!geometry) {
    alert('Could not get model geometry.');
    return;
  }

  showProgress('Analyzing significant faces...');
  await new Promise(r => setTimeout(r, 50));

  try {
    const significantFaces = findSignificantFaces(geometry, 6);
    hideProgress();

    // Calculate total model surface area for percentage
    let totalSurfaceArea = 0;
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i += 3) {
      const v0 = new THREE.Vector3().fromBufferAttribute(positions, i);
      const v1 = new THREE.Vector3().fromBufferAttribute(positions, i + 1);
      const v2 = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
      const edge1 = new THREE.Vector3().subVectors(v1, v0);
      const edge2 = new THREE.Vector3().subVectors(v2, v0);
      const cross = new THREE.Vector3().crossVectors(edge1, edge2);
      totalSurfaceArea += cross.length() * 0.5;
    }

    const resultsDiv = document.getElementById('significant-faces-results');
    if (significantFaces.length === 0) {
      resultsDiv.innerHTML = '<em>No significant flat faces found.</em>';
    } else {
      const rows = significantFaces.map((face, i) => {
        const areaPct = ((face.area / totalSurfaceArea) * 100).toFixed(1);
        const normalStr = `(${face.normal.x.toFixed(2)}, ${face.normal.y.toFixed(2)}, ${face.normal.z.toFixed(2)})`;
        return `<button type="button" class="significant-face-result" data-face-index="${i}">
          <span class="significant-face-index" style="color: hsl(${(i * 60) % 360}, 70%, 45%);">${i + 1}.</span>
          Area: <b>${face.area.toFixed(1)}</b> mm² (${areaPct}%)
          <br><span class="significant-face-normal">Normal: ${normalStr}</span>
          <span class="significant-face-action">Align</span>
        </button>`;
      }).join('');
      resultsDiv.innerHTML = `<div style="margin-bottom: 8px; color: var(--text); font-weight: 600;">Found ${significantFaces.length} significant face${significantFaces.length === 1 ? '' : 's'}:</div>${rows}`;
      resultsDiv.querySelectorAll('[data-face-index]').forEach(button => {
        button.addEventListener('click', () => {
          const index = Number(button.dataset.faceIndex);
          if (significantFaces[index]) alignModelToFace(significantFaces[index].normal);
        });
      });

      // Visualize significant faces on the model
      visualizeSignificantFaces(significantFaces);
    }
  } catch (error) {
    hideProgress();
    console.error('Failed to find significant faces:', error);
    alert('Failed to analyze model: ' + error.message);
  }
}

function protectedSurfacePrintNormal(currentNormal) {
  const horizontal = new THREE.Vector3(currentNormal.x, 0, currentNormal.z);
  if (horizontal.lengthSq() < 1e-5) {
    horizontal.set(0, 0, 1);
  } else {
    horizontal.normalize();
  }

  const tilt = Math.PI / 4;
  return horizontal
    .multiplyScalar(Math.sin(tilt))
    .addScaledVector(new THREE.Vector3(0, 1, 0), Math.cos(tilt))
    .normalize();
}

// Align selected model so the given normal points toward a printable protected-face target.
function alignModelToFace(targetNormal, desiredNormal = new THREE.Vector3(0, 1, 0)) {
  if (viewer.selected.length !== 1) {
    alert('Please select exactly one model to align.');
    return;
  }

  const obj = viewer.selected[0];
  viewer._saveUndoState();

  // Create a world-space delta that points the protected normal away from support contact.
  const quaternion = new THREE.Quaternion();
  quaternion.setFromUnitVectors(targetNormal.clone().normalize(), desiredNormal.clone().normalize());

  // Apply rotation to the mesh
  obj.mesh.quaternion.premultiply(quaternion);
  obj.mesh.updateMatrixWorld(true);

  // Clear supports since they're now invalid
  if (obj.supportsMesh) {
    viewer.scene.remove(obj.supportsMesh);
    obj.supportsMesh.geometry.dispose();
    obj.supportsMesh.material.dispose();
    obj.supportsMesh = null;
    obj._cachedLocalSupportVolume = undefined;
  }

  viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  clearSignificantFaces();

  // Update transform controls
  viewer._attachTransformControls();

  showToolPanel('transform');
}

function findSignificantFaces(geometry, topN = 5) {
  // Build a map of face groups by normal direction
  const positions = geometry.attributes.position;
  const faceNormalMap = new Map();
  const tolerance = 0.95; // Dot product threshold for "same direction" (stricter for flat faces)
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  const cross = new THREE.Vector3();

  for (let i = 0; i < positions.count; i += 3) {
    // Get triangle vertices
    v0.fromBufferAttribute(positions, i);
    v1.fromBufferAttribute(positions, i + 1);
    v2.fromBufferAttribute(positions, i + 2);

    // Calculate face normal via cross product
    edge1.subVectors(v1, v0);
    edge2.subVectors(v2, v0);
    cross.crossVectors(edge1, edge2);
    const triArea = cross.length() * 0.5;

    if (triArea < 0.0001) continue; // Skip degenerate triangles

    faceNormal.copy(cross).normalize();
    if (faceNormal.length() < 0.001) continue;

    // Quantize normal to nearby face group
    let bestKey = null;
    let bestDot = -Infinity;

    for (const key of faceNormalMap.keys()) {
      const [nx, ny, nz] = key.split(',').map(Number);
      const existingNormal = new THREE.Vector3(nx, ny, nz);
      const dot = faceNormal.dot(existingNormal);
      if (dot > tolerance && dot > bestDot) {
        bestDot = dot;
        bestKey = key;
      }
    }

    if (bestKey) {
      const existing = faceNormalMap.get(bestKey);
      existing.totalArea += triArea;
      existing.normal.add(faceNormal);
      existing.count += 1;
      // Update centroid
      existing.centroidX += (v0.x + v1.x + v2.x) / 3 * triArea;
      existing.centroidY += (v0.y + v1.y + v2.y) / 3 * triArea;
      existing.centroidZ += (v0.z + v1.z + v2.z) / 3 * triArea;
    } else {
      const cx = (v0.x + v1.x + v2.x) / 3;
      const cy = (v0.y + v1.y + v2.y) / 3;
      const cz = (v0.z + v1.z + v2.z) / 3;
      faceNormalMap.set(`${faceNormal.x.toFixed(3)},${faceNormal.y.toFixed(3)},${faceNormal.z.toFixed(3)}`, {
        count: 1,
        totalArea: triArea,
        normal: faceNormal.clone(),
        centroidX: cx * triArea,
        centroidY: cy * triArea,
        centroidZ: cz * triArea,
      });
    }
  }

  // Average normals, calculate final centroids, and sort by area
  const faceGroups = [];
  for (const [, data] of faceNormalMap) {
    data.normal.divideScalar(data.count).normalize();
    // Final centroid
    const totalArea = data.totalArea;
    faceGroups.push({
      normal: data.normal,
      area: totalArea,
      triangleCount: data.count,
      centroid: new THREE.Vector3(
        data.centroidX / totalArea,
        data.centroidY / totalArea,
        data.centroidZ / totalArea
      ),
    });
  }

  faceGroups.sort((a, b) => b.area - a.area);

  return faceGroups.slice(0, topN);
}

// Visualize significant faces as colored markers on the model
function visualizeSignificantFaces(significantFaces) {
  viewer.clearSignificantFaceMarkers();
  const origin = viewer.getActivePlateOrigin();

  const colors = [
    0xff6b6b, // Red
    0x4ecdc4, // Teal
    0xffe66d, // Yellow
    0x95e1d3, // Mint
    0xf38181, // Coral
    0xaa96da, // Purple
  ];

  significantFaces.forEach((face, index) => {
    const color = colors[index % colors.length];
    viewer.addSignificantFaceMarker(face.centroid.clone().add(origin), face.normal, face.area, color, index + 1);
  });

  viewer.requestRender();
}

// Clear significant face visualization
function clearSignificantFaces() {
  viewer.clearSignificantFaceMarkers();
  viewer.requestRender();
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
  clearActivePlateSlice();
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
  saveSliceRefsToActivePlate();
  updateEstimate();

  hideProgress();

  // Show layer preview
  layerPreviewPanel.hidden = false;
  exportBtn.hidden = false;
  exportAllBtn.hidden = !project.plates.some(p => p.slicedLayers);
  layerSlider.max = slicedLayers.length - 1;
  layerSlider.value = 0;
  showLayer();
  renderPlateTabs();
}

async function handleSliceAll() {
  const startPlateId = project.activePlateId;
  const platesToSlice = project.plates.filter(plate => plate.objects.length > 0);
  for (let i = 0; i < platesToSlice.length; i++) {
    const plate = platesToSlice[i];
    switchToPlate(plate);
    showProgress(`Slicing ${plate.name} (${i + 1} / ${platesToSlice.length})...`);
    await handleSlice();
  }
  const startPlate = project.plates.find(plate => plate.id === startPlateId);
  if (startPlate) switchToPlate(startPlate);
  exportAllBtn.hidden = !project.plates.some(plate => plate.slicedLayers);
  renderPlateTabs();
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

async function handleExportAll() {
  const startPlateId = project.activePlateId;
  const slicedPlates = project.plates.filter(plate => plate.slicedLayers);
  for (let i = 0; i < slicedPlates.length; i++) {
    const plate = slicedPlates[i];
    switchToPlate(plate);
    showProgress(`Exporting ${plate.name} (${i + 1} / ${slicedPlates.length})...`);
    await handleExport();
  }
  const startPlate = project.plates.find(plate => plate.id === startPlateId);
  if (startPlate) switchToPlate(startPlate);
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
    if (summaryPanel) summaryPanel.hidden = true;
    printEstimate.textContent = '';
    return;
  }
  if (summaryPanel) summaryPanel.hidden = false;

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
