import { Viewer, createResinMaterial } from './viewer.js';
import { Slicer, PRINTERS } from './slicer.js';
import { optimizeOrientationAsync, analyzeCurrentOrientation } from './orientation.js';
import { generateSupports } from './supports.js';
import { exportMesh, exportZip, estimatePrintTime } from './exporter.js';
import { mm3ToMl } from './volume.js';
import { DEFAULT_RESIN_MATERIAL_ID, RESIN_MATERIALS } from './materials.js';
import { createPlate, clearPlateSlice, renumberDefaultPlateNames } from './plates.js';
import { deleteAutosavedProject, loadAutosavedProject, saveAutosavedProject } from './project-store.js';
import { ModelInspector, inspectGeometry, InspectionReport, IssueTypes, Severity } from './inspector.js';
import { ModelRepairer, repairGeometry, RepairDefaults } from './repairer.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// --- State ---
let viewer;
let slicer;
let slicedLayers = null;
// Set after slicing completes; falsy means "use mesh-based pre-slice estimate".
let slicedVolumes = null; // { model: mm³, supports: mm³, total: mm³, exactTotal: boolean, exactBreakdown: boolean }
let selectedMaterialId = DEFAULT_RESIN_MATERIAL_ID;
let selectedPrinterKey = 'photon-mono';
let protectedFace = null;
let preferencesReady = false;
let preferenceSaveTimer = null;
let projectAutosaveReady = false;
let projectAutosaveTimer = null;
const project = {
  plates: [createPlate(1)],
  activePlateId: null,
};
project.activePlateId = project.plates[0].id;

const PREFERENCES_STORAGE_KEY = 'slicelab.preferences.v1';
const PREFERENCES_VERSION = 1;
const PROJECT_AUTOSAVE_VERSION = 1;

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
const healthPanel = document.getElementById('health-panel');
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
  health: healthPanel,
  slice: slicePanel,
};
let showToolPanelByName = null;

const printerSelectBtn = document.getElementById('printer-select-btn');
const selectedPrinterName = document.getElementById('selected-printer-name');
const selectedPrinterSpec = document.getElementById('selected-printer-spec');
const clearAutosaveBtn = document.getElementById('clear-autosave-btn');
const printerModal = document.getElementById('printer-modal');
const printerModalClose = document.getElementById('printer-modal-close');
const printerGrid = document.getElementById('printer-grid');

const shortcutsBtn = document.getElementById('shortcuts-btn');
const shortcutsModal = document.getElementById('shortcuts-modal');
const shortcutsModalClose = document.getElementById('shortcuts-modal-close');
const restoreProjectModal = document.getElementById('restore-project-modal');
const restoreProjectCopy = document.getElementById('restore-project-copy');
const restoreProjectClose = document.getElementById('restore-project-close');
const restoreProjectAuto = document.getElementById('restore-project-auto');
const restoreProjectClear = document.getElementById('restore-project-clear');
const restoreProjectSkip = document.getElementById('restore-project-skip');
const restoreProjectLoad = document.getElementById('restore-project-load');

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

function setButtonDisabled(button, disabled) {
  if (!button) return;
  button.disabled = !!disabled;
  button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
}

const layerCanvas = document.getElementById('layer-canvas');
const layerSlider = document.getElementById('layer-slider');
const layerInfo = document.getElementById('layer-info');
const layerExpandBtn = document.getElementById('layer-expand-btn');

// Layer Inspector elements
const inspectorModal = document.getElementById('layer-inspector');
const inspectorClose = document.getElementById('layer-inspector-close');
const inspectorCanvas = document.getElementById('inspector-canvas');
const inspectorSlider = document.getElementById('inspector-slider');
const inspectorLayerInfo = document.getElementById('inspector-layer-info');
const inspectorPrev = document.getElementById('inspector-prev');
const inspectorNext = document.getElementById('inspector-next');
const inspectorGoto = document.getElementById('inspector-goto');
const inspectorArea = document.getElementById('inspector-area');
const inspectorCoverage = document.getElementById('inspector-coverage');
const inspectorIslands = document.getElementById('inspector-islands');
const inspectorHeight = document.getElementById('inspector-height');
const inspectorHighlightIslands = document.getElementById('inspector-highlight-islands');
const inspectorShowOutline = document.getElementById('inspector-show-outline');
const inspectorDiffMode = document.getElementById('inspector-diff-mode');
const inspectorIssues = document.getElementById('inspector-issues');
const inspectorGraph = document.getElementById('inspector-graph');
const inspectorScanAll = document.getElementById('inspector-scan-all');
const inspectorScanStatus = document.getElementById('inspector-scan-status');
const inspectorIssuePrev = document.getElementById('inspector-issue-prev');
const inspectorIssueNext = document.getElementById('inspector-issue-next');
const inspectorIssuePos = document.getElementById('inspector-issue-pos');
let inspectorAreaData = null; // cached per-layer white pixel counts
let inspectorIssueMap = null; // Map<layerIdx, issues[]> from full scan
let inspectorIssueLayers = []; // sorted list of layer indices with issues
let inspectorIssueNavIdx = -1; // current position in issueLayers

// Preflight elements
const preflightSection = document.getElementById('preflight-section');
const preflightResults = document.getElementById('preflight-results');
const preflightRecheckBtn = document.getElementById('preflight-recheck-btn');
let preflightGeneration = 0; // cancel stale runs
let preflightState = {
  state: 'idle',
  signature: '',
  errors: [],
  warnings: [],
  promise: null,
};

// Model Health elements
const healthScoreValue = document.getElementById('health-score-value');
const healthScoreLabel = document.getElementById('health-score-label');
const healthScoreArc = document.getElementById('health-score-arc');
const healthScoreSvg = document.querySelector('.health-score-svg');
const healthAnalyzeBtn = document.getElementById('health-analyze-btn');
const healthAutorepairBtn = document.getElementById('health-autorepair-btn');
const healthSupportHeatmapBtn = document.getElementById('health-support-heatmap-btn');
const healthIssues = document.getElementById('health-issues');
const healthPrinterContext = document.getElementById('health-printer-context');
const healthPrinterSpecs = document.getElementById('health-printer-specs');
let lastInspectionReport = null;
let lastInspectionReportTarget = null;
let issueHighlightMeshes = [];
let supportHeatmapMesh = null;
const IMPLEMENTED_AUTO_REPAIR_ISSUE_IDS = new Set([
  IssueTypes.INVERTED_NORMALS.id,
  IssueTypes.DUPLICATE_VERTICES.id,
  IssueTypes.DEGENERATE_TRIANGLES.id,
]);

const progressOverlay = document.getElementById('progress-overlay');
const progressText = document.getElementById('progress-text');
const progressBar = document.getElementById('progress-bar');
const progressPercent = document.getElementById('progress-percent');
const contextMenu = document.getElementById('context-menu');
let activeMenuContext = null;

function loadPreferences() {
  try {
    const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.version === PREFERENCES_VERSION ? parsed : null;
  } catch (error) {
    console.warn('Could not load preferences:', error);
    return null;
  }
}

function savePreferences() {
  if (!preferencesReady) return;
  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(collectPreferences()));
  } catch (error) {
    console.warn('Could not save preferences:', error);
  }
}

function scheduleSavePreferences() {
  if (!preferencesReady) return;
  clearTimeout(preferenceSaveTimer);
  preferenceSaveTimer = setTimeout(savePreferences, 250);
}

function collectPreferences() {
  const sidebar = document.getElementById('sidebar');
  return {
    version: PREFERENCES_VERSION,
    selectedPrinterKey,
    selectedMaterialId,
    autoRestoreAutosave: !!restoreProjectAuto?.checked,
    activeToolPanel: getActiveToolPanel(),
    sidebarCollapsed: !!sidebar?.classList.contains('collapsed'),
    sliceSettings: {
      layerHeight: layerHeightInput?.value,
      normalExposure: normalExposureInput?.value,
      bottomLayers: bottomLayersInput?.value,
      bottomExposure: bottomExposureInput?.value,
      liftHeight: liftHeightInput?.value,
      liftSpeed: liftSpeedInput?.value,
    },
    supportSettings: {
      overhangAngle: overhangAngleInput?.value,
      autoDensity: !!autoDensityInput?.checked,
      density: supportDensityInput?.value,
      tipDiameter: tipDiameterInput?.value,
      supportThickness: supportThicknessInput?.value,
      autoThickness: !!autoThicknessInput?.checked,
      supportScope: supportScopeInput?.value,
      approachMode: supportApproachInput?.value,
      maxPillarAngle: supportMaxAngleInput?.value,
      modelClearance: supportClearanceInput?.value,
      maxContactOffset: supportMaxOffsetInput?.value,
      crossBracing: !!crossBracingInput?.checked,
      basePanEnabled: !!basePanEnabledInput?.checked,
      basePanMargin: basePanMarginInput?.value,
      basePanThickness: basePanThicknessInput?.value,
      basePanLipWidth: basePanLipWidthInput?.value,
      basePanLipHeight: basePanLipHeightInput?.value,
    },
    camera: getCameraPreferences(),
  };
}

function getActiveToolPanel() {
  return Object.keys(toolPanels).find(name => toolPanels[name] && !toolPanels[name].hidden) || 'edit';
}

function getCameraPreferences() {
  if (!viewer?.camera || !viewer?.controls) return null;
  return {
    position: viewer.camera.position.toArray(),
    quaternion: viewer.camera.quaternion.toArray(),
    target: viewer.controls.target.toArray(),
  };
}

function applyPreferenceGlobals(preferences) {
  if (!preferences) return;
  if (PRINTERS[preferences.selectedPrinterKey]) {
    selectedPrinterKey = preferences.selectedPrinterKey;
  }
  if (RESIN_MATERIALS.some(material => material.id === preferences.selectedMaterialId)) {
    selectedMaterialId = preferences.selectedMaterialId;
  }
  if (restoreProjectAuto) {
    restoreProjectAuto.checked = !!preferences.autoRestoreAutosave;
  }
}

function setAutoRestorePreference(enabled) {
  if (restoreProjectAuto) restoreProjectAuto.checked = !!enabled;
  try {
    const current = loadPreferences() || { version: PREFERENCES_VERSION };
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
      ...current,
      version: PREFERENCES_VERSION,
      autoRestoreAutosave: !!enabled,
    }));
  } catch (error) {
    console.warn('Could not save restore preference:', error);
  }
}

function setInputValue(input, value) {
  if (!input || value === undefined || value === null) return;
  input.value = value;
}

function setInputChecked(input, value) {
  if (!input || value === undefined || value === null) return;
  input.checked = !!value;
}

function applyControlPreferences(preferences) {
  if (!preferences) return;
  const slice = preferences.sliceSettings || {};
  setInputValue(layerHeightInput, slice.layerHeight);
  setInputValue(normalExposureInput, slice.normalExposure);
  setInputValue(bottomLayersInput, slice.bottomLayers);
  setInputValue(bottomExposureInput, slice.bottomExposure);
  setInputValue(liftHeightInput, slice.liftHeight);
  setInputValue(liftSpeedInput, slice.liftSpeed);

  const support = preferences.supportSettings || {};
  setInputValue(overhangAngleInput, support.overhangAngle);
  setInputChecked(autoDensityInput, support.autoDensity);
  setInputValue(supportDensityInput, support.density);
  setInputValue(tipDiameterInput, support.tipDiameter);
  setInputValue(supportThicknessInput, support.supportThickness);
  setInputChecked(autoThicknessInput, support.autoThickness);
  setInputValue(supportScopeInput, support.supportScope);
  setInputValue(supportApproachInput, support.approachMode);
  setInputValue(supportMaxAngleInput, support.maxPillarAngle);
  setInputValue(supportClearanceInput, support.modelClearance);
  setInputValue(supportMaxOffsetInput, support.maxContactOffset);
  setInputChecked(crossBracingInput, support.crossBracing);
  setInputChecked(basePanEnabledInput, support.basePanEnabled);
  setInputValue(basePanMarginInput, support.basePanMargin);
  setInputValue(basePanThicknessInput, support.basePanThickness);
  setInputValue(basePanLipWidthInput, support.basePanLipWidth);
  setInputValue(basePanLipHeightInput, support.basePanLipHeight);
  syncSupportControlUi();
}

function syncSupportControlUi() {
  if (overhangAngleVal && overhangAngleInput) overhangAngleVal.textContent = overhangAngleInput.value + '°';
  if (supportDensityVal && supportDensityInput) supportDensityVal.textContent = supportDensityInput.value;

  if (supportDensityInput && autoDensityInput) supportDensityInput.disabled = autoDensityInput.checked;
  if (supportDensityGroup && autoDensityInput) {
    supportDensityGroup.style.opacity = autoDensityInput.checked ? '0.5' : '1';
    supportDensityGroup.style.pointerEvents = autoDensityInput.checked ? 'none' : 'auto';
  }

  if (tipDiameterInput && autoThicknessInput) tipDiameterInput.disabled = autoThicknessInput.checked;
  if (tipDiameterGroup && autoThicknessInput) {
    tipDiameterGroup.style.opacity = autoThicknessInput.checked ? '0.5' : '1';
    tipDiameterGroup.style.pointerEvents = autoThicknessInput.checked ? 'none' : 'auto';
  }
  if (supportThicknessInput && autoThicknessInput) supportThicknessInput.disabled = autoThicknessInput.checked;
  if (supportThicknessGroup && autoThicknessInput) {
    supportThicknessGroup.style.opacity = autoThicknessInput.checked ? '0.5' : '1';
    supportThicknessGroup.style.pointerEvents = autoThicknessInput.checked ? 'none' : 'auto';
  }

  [basePanMarginInput, basePanThicknessInput, basePanLipWidthInput, basePanLipHeightInput].filter(Boolean).forEach(input => {
    input.disabled = !basePanEnabledInput?.checked;
  });
  if (basePanOptions && basePanEnabledInput) {
    basePanOptions.style.opacity = basePanEnabledInput.checked ? '1' : '0.5';
    basePanOptions.style.pointerEvents = basePanEnabledInput.checked ? 'auto' : 'none';
  }
}

function applyCameraPreferences(cameraPreferences) {
  if (!viewer?.camera || !viewer?.controls || !cameraPreferences) return;
  const { position, quaternion, target } = cameraPreferences;
  if (![position, quaternion, target].every(Array.isArray)) return;
  if (position.length !== 3 || quaternion.length !== 4 || target.length !== 3) return;
  viewer.camera.position.fromArray(position);
  viewer.camera.quaternion.fromArray(quaternion);
  viewer.controls.target.fromArray(target);
  viewer.controls.update();
  viewer.requestRender();
}

function registerPreferenceListeners() {
  const persistedControls = [
    layerHeightInput, normalExposureInput, bottomLayersInput, bottomExposureInput, liftHeightInput, liftSpeedInput,
    overhangAngleInput, autoDensityInput, supportDensityInput, tipDiameterInput, supportThicknessInput, autoThicknessInput,
    supportScopeInput, supportApproachInput, supportMaxAngleInput, supportClearanceInput, supportMaxOffsetInput,
    crossBracingInput, basePanEnabledInput, basePanMarginInput, basePanThicknessInput, basePanLipWidthInput, basePanLipHeightInput,
  ].filter(Boolean);

  persistedControls.forEach(input => {
    listen(input, 'input', scheduleSavePreferences);
    listen(input, 'change', scheduleSavePreferences);
  });
  viewer?.controls?.addEventListener('end', scheduleSavePreferences);
  window.addEventListener('beforeunload', savePreferences);
}

function scheduleProjectAutosave() {
  if (!projectAutosaveReady) return;
  clearTimeout(projectAutosaveTimer);
  projectAutosaveTimer = setTimeout(saveProjectAutosave, 900);
}

async function saveProjectAutosave() {
  if (!projectAutosaveReady) return;
  try {
    await saveAutosavedProject(collectProjectSnapshot());
  } catch (error) {
    console.warn('Could not autosave project:', error);
  }
}

function collectProjectSnapshot() {
  saveSliceRefsToActivePlate();
  return {
    version: PROJECT_AUTOSAVE_VERSION,
    app: 'SliceLab',
    selectedPrinterKey,
    selectedMaterialId,
    activePlateId: project.activePlateId,
    camera: getCameraPreferences(),
    plates: project.plates.map(plate => ({
      id: plate.id,
      name: plate.name,
      selectedIds: [...(plate.selectedIds || [])],
      originX: plate.originX || 0,
      originZ: plate.originZ || 0,
      dirty: true,
      objects: plate.objects.map(serializeObject),
    })),
  };
}

function serializeObject(obj) {
  return {
    id: obj.id,
    elevation: obj.elevation,
    materialId: obj.materialPreset?.id || DEFAULT_RESIN_MATERIAL_ID,
    geometry: serializeGeometry(obj.mesh.geometry),
    transform: serializeObject3D(obj.mesh),
    supports: obj.supportsMesh ? {
      geometry: serializeGeometry(obj.supportsMesh.geometry),
      transform: serializeObject3D(obj.supportsMesh),
    } : null,
  };
}

function serializeObject3D(object) {
  return {
    position: object.position.toArray(),
    quaternion: object.quaternion.toArray(),
    scale: object.scale.toArray(),
  };
}

function serializeGeometry(geometry) {
  const position = geometry.attributes.position;
  if (!position) return null;
  return {
    position: position.array.slice(0),
    index: geometry.index ? geometry.index.array.slice(0) : null,
    indexType: geometry.index?.array?.constructor?.name || null,
  };
}

function deserializeGeometry(snapshot) {
  if (!snapshot?.position) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(snapshot.position), 3));
  if (snapshot.index) {
    const IndexArray = snapshot.indexType === 'Uint32Array' ? Uint32Array : Uint16Array;
    geometry.setIndex(new THREE.BufferAttribute(new IndexArray(snapshot.index), 1));
  }
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();
  return geometry;
}

function applyObjectTransform(object, transform) {
  if (!transform) return;
  if (Array.isArray(transform.position) && transform.position.length === 3) object.position.fromArray(transform.position);
  if (Array.isArray(transform.quaternion) && transform.quaternion.length === 4) object.quaternion.fromArray(transform.quaternion);
  if (Array.isArray(transform.scale) && transform.scale.length === 3) object.scale.fromArray(transform.scale);
  object.updateMatrixWorld(true);
}

function createSupportMaterial() {
  return new THREE.MeshPhongMaterial({
    color: 0x9b59b6,
    specular: 0x222222,
    shininess: 30,
    transparent: true,
    opacity: 0.55,
  });
}

function disposeCurrentProjectObjects() {
  project.plates.forEach(plate => {
    plate.objects.forEach(obj => {
      obj.mesh.parent?.remove(obj.mesh);
      obj.supportsMesh?.parent?.remove(obj.supportsMesh);
      obj.mesh.geometry?.dispose?.();
      obj.mesh.material?.dispose?.();
      obj.supportsMesh?.geometry?.dispose?.();
      obj.supportsMesh?.material?.dispose?.();
    });
  });
  viewer.transformControl?.detach?.();
  viewer.selected = [];
  viewer.objects = [];
  viewer.activePlate = null;
}

function restoreProjectSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== PROJECT_AUTOSAVE_VERSION || !Array.isArray(snapshot.plates)) return false;
  disposeCurrentProjectObjects();

  selectedPrinterKey = PRINTERS[snapshot.selectedPrinterKey] ? snapshot.selectedPrinterKey : selectedPrinterKey;
  selectedMaterialId = RESIN_MATERIALS.some(material => material.id === snapshot.selectedMaterialId)
    ? snapshot.selectedMaterialId
    : selectedMaterialId;

  const restoredPlates = snapshot.plates.map((plateSnapshot, index) => {
    const plate = {
      ...createPlate(index + 1),
      id: plateSnapshot.id || `plate_restore_${index}`,
      name: plateSnapshot.name || `Plate ${index + 1}`,
      selectedIds: Array.isArray(plateSnapshot.selectedIds) ? plateSnapshot.selectedIds : [],
      originX: Number(plateSnapshot.originX) || 0,
      originZ: Number(plateSnapshot.originZ) || 0,
      slicedLayers: null,
      slicedVolumes: null,
      dirty: true,
      objects: [],
    };

    (plateSnapshot.objects || []).forEach(objectSnapshot => {
      const geometry = deserializeGeometry(objectSnapshot.geometry);
      if (!geometry) return;
      const materialPreset = RESIN_MATERIALS.find(material => material.id === objectSnapshot.materialId) || RESIN_MATERIALS[0];
      const mesh = new THREE.Mesh(geometry, createResinMaterial(materialPreset));
      const objectId = objectSnapshot.id || `obj_restore_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      mesh.userData.id = objectId;
      applyObjectTransform(mesh, objectSnapshot.transform);
      viewer.scene.add(mesh);

      let supportsMesh = null;
      if (objectSnapshot.supports?.geometry) {
        const supportGeometry = deserializeGeometry(objectSnapshot.supports.geometry);
        if (supportGeometry) {
          supportsMesh = new THREE.Mesh(supportGeometry, createSupportMaterial());
          applyObjectTransform(supportsMesh, objectSnapshot.supports.transform);
          viewer.scene.add(supportsMesh);
        }
      }

      plate.objects.push({
        id: objectId,
        mesh,
        supportsMesh,
        elevation: Number(objectSnapshot.elevation) || 5,
        materialPreset,
      });
    });

    return plate;
  });

  project.plates.splice(0, project.plates.length, ...(restoredPlates.length ? restoredPlates : [createPlate(1)]));
  project.activePlateId = project.plates.some(plate => plate.id === snapshot.activePlateId)
    ? snapshot.activePlateId
    : project.plates[0].id;
  viewer.bindInitialPlate(project.plates[0]);
  viewer.setPlates(project.plates);
  viewer.activePlate = null;
  viewer.setActivePlate(getActivePlate());
  applyPrinter(selectedPrinterKey, { resetSlice: false });
  const defaultMaterial = RESIN_MATERIALS.find(material => material.id === selectedMaterialId);
  viewer.setDefaultMaterialPreset(defaultMaterial);
  syncSliceRefsFromActivePlate();
  renderPlateTabs();
  updateArrangeButtonText();
  updateEstimate();
  syncMaterialPicker();
  applyCameraPreferences(snapshot.camera);
  return true;
}

function askRestoreAutosavedProject(autosave, preferences) {
  return new Promise((resolve) => {
    if (!restoreProjectModal) {
      resolve('skip');
      return;
    }

    const savedAt = autosave.savedAt ? new Date(autosave.savedAt).toLocaleString() : 'a previous session';
    if (restoreProjectCopy) {
      restoreProjectCopy.textContent = `A saved SliceLab session from ${savedAt} is available.`;
    }
    if (restoreProjectAuto) {
      restoreProjectAuto.checked = !!preferences?.autoRestoreAutosave;
    }

    let settled = false;
    const finish = (action) => {
      if (settled) return;
      settled = true;
      restoreProjectModal.hidden = true;
      cleanup();
      resolve(action);
    };
    const load = () => finish('load');
    const skip = () => finish('skip');
    const clear = () => finish('clear');
    const autoChange = () => setAutoRestorePreference(restoreProjectAuto.checked);
    const modalClick = (event) => {
      if (event.target === restoreProjectModal) skip();
    };
    const keydown = (event) => {
      if (event.key === 'Escape' && !restoreProjectModal.hidden) skip();
    };
    const cleanup = () => {
      restoreProjectLoad?.removeEventListener('click', load);
      restoreProjectSkip?.removeEventListener('click', skip);
      restoreProjectClose?.removeEventListener('click', skip);
      restoreProjectClear?.removeEventListener('click', clear);
      restoreProjectAuto?.removeEventListener('change', autoChange);
      restoreProjectModal.removeEventListener('click', modalClick);
      document.removeEventListener('keydown', keydown);
    };

    restoreProjectLoad?.addEventListener('click', load);
    restoreProjectSkip?.addEventListener('click', skip);
    restoreProjectClose?.addEventListener('click', skip);
    restoreProjectClear?.addEventListener('click', clear);
    restoreProjectAuto?.addEventListener('change', autoChange);
    restoreProjectModal.addEventListener('click', modalClick);
    document.addEventListener('keydown', keydown);
    restoreProjectModal.hidden = false;
    restoreProjectLoad?.focus();
  });
}

async function clearAutosavedProjectState({ updateButton = true } = {}) {
  clearTimeout(projectAutosaveTimer);
  const wasReady = projectAutosaveReady;
  projectAutosaveReady = false;
  try {
    await deleteAutosavedProject();
    setAutoRestorePreference(false);
    if (updateButton && clearAutosaveBtn) {
      const previousTitle = clearAutosaveBtn.title;
      clearAutosaveBtn.title = 'Saved project state cleared';
      clearAutosaveBtn.setAttribute('aria-label', 'Saved project state cleared');
      setTimeout(() => {
        clearAutosaveBtn.title = previousTitle || 'Clear saved project state';
        clearAutosaveBtn.setAttribute('aria-label', 'Clear saved project state');
      }, 1800);
    }
  } catch (error) {
    console.warn('Could not clear autosaved project:', error);
  } finally {
    projectAutosaveReady = wasReady;
  }
}

async function maybeRestoreAutosavedProject(preferences) {
  try {
    const autosave = await loadAutosavedProject();
    const objectCount = autosave?.plates?.reduce((sum, plate) => sum + (plate.objects?.length || 0), 0) || 0;
    if (!autosave || objectCount === 0) return false;
    let action = preferences?.autoRestoreAutosave ? 'load' : await askRestoreAutosavedProject(autosave, preferences);
    if (action === 'clear') {
      await clearAutosavedProjectState({ updateButton: false });
      return false;
    }
    if (action !== 'load') return false;
    return restoreProjectSnapshot(autosave);
  } catch (error) {
    console.warn('Could not restore autosaved project:', error);
    return false;
  }
}

function registerProjectAutosaveListeners() {
  viewer.canvas.addEventListener('mesh-changed', scheduleProjectAutosave);
  viewer.canvas.addEventListener('material-changed', scheduleProjectAutosave);
  viewer.canvas.addEventListener('plate-changed', scheduleProjectAutosave);
  viewer.canvas.addEventListener('selection-changed', scheduleProjectAutosave);
  viewer?.controls?.addEventListener('end', scheduleProjectAutosave);
  window.addEventListener('beforeunload', () => {
    if (projectAutosaveReady) {
      saveAutosavedProject(collectProjectSnapshot());
    }
  });
}

function getActivePlate() {
  return project.plates.find(plate => plate.id === project.activePlateId) || project.plates[0];
}

function syncSliceRefsFromActivePlate() {
  const plate = getActivePlate();
  slicedLayers = plate.slicedLayers;
  slicedVolumes = plate.slicedVolumes;
  updateOutputButtons();
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
  inspectorAreaData = null;
  inspectorIssueMap = null;
  inspectorIssueLayers = [];
  updateOutputButtons();
  layerPreviewPanel.hidden = true;
}

function updateOutputButtons() {
  if (exportBtn) exportBtn.hidden = !viewer || viewer.objects.length === 0;
  if (exportAllBtn) exportAllBtn.hidden = true;
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
  scheduleProjectAutosave();
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
  scheduleProjectAutosave();
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
  scheduleSavePreferences();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  setSidebarCollapsed(!sidebar.classList.contains('collapsed'));
}

// --- Init ---
async function init() {
  const canvas = document.getElementById('viewport');
  viewer = new Viewer(canvas);
  initCanvasPlateDrop(canvas);
  viewer.bindInitialPlate(getActivePlate());
  slicer = new Slicer();
  const savedPreferences = loadPreferences();
  applyPreferenceGlobals(savedPreferences);

  initPrinterPicker();
  applyPrinter(selectedPrinterKey, { resetSlice: false });
  const defaultMaterial = RESIN_MATERIALS.find(material => material.id === selectedMaterialId);
  viewer.setDefaultMaterialPreset(defaultMaterial);
  initMaterialPicker();
  applyControlPreferences(savedPreferences);
  setSidebarCollapsed(!!savedPreferences?.sidebarCollapsed);

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
  const healthBtn = document.getElementById('health-btn');
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
    viewer.setDefaultMaterialPreset(preset);
    viewer.setMaterialPreset(preset, 'all');
  });
  listen(clearAutosaveBtn, 'click', () => clearAutosavedProjectState());

  document.addEventListener('keydown', (e) => {
    // Don't interfere with text input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Let the layer inspector handle its own keys when open
    if (inspectorModal && !inspectorModal.hidden) return;

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
        handleExport();
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
      const panelOrder = ['edit', 'transform', 'orient', 'supports', 'materials', 'health', 'slice'];
      const currentIndex = panelOrder.indexOf(activeToolPanel);
      const nextIndex = e.shiftKey
        ? (currentIndex - 1 + panelOrder.length) % panelOrder.length
        : (currentIndex + 1) % panelOrder.length;
      showToolPanel(panelOrder[nextIndex]);
      return;
    }

    // 1-6 keys - quick switch to tool panels
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const panelShortcuts = { '1': 'edit', '2': 'transform', '3': 'orient', '4': 'supports', '5': 'materials', '6': 'health', '7': 'slice' };
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
    openMeshExportMenu(e.clientX, e.clientY);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!contextMenu?.contains(e.target)) {
      hideContextMenu();
    }
  });
  contextMenu?.addEventListener('click', (e) => {
    const button = e.target.closest('[data-menu-action]');
    if (!button) return;
    handleMenuAction(button.dataset.menuAction);
  });

  // --- Panel toggle logic ---
  const toolButtons = {
    edit: editBtn,
    transform: transformBtn,
    orient: orientBtn,
    supports: supportToolBtn,
    materials: materialBtn,
    health: healthBtn,
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
    if (name === 'slice') {
      runPreflightChecks();
    }
    scheduleSavePreferences();
  }
  showToolPanelByName = showToolPanel;

  listen(editBtn, 'click', () => showToolPanel('edit'));
  listen(transformBtn, 'click', () => showToolPanel('transform'));
  listen(orientBtn, 'click', () => showToolPanel('orient'));
  listen(supportToolBtn, 'click', () => showToolPanel('supports'));
  listen(materialBtn, 'click', () => showToolPanel('materials'));
  listen(healthBtn, 'click', () => showToolPanel('health'));
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

    setButtonDisabled(transformBtn, !hasSelection);

    // Model tools can process one selected mesh or batch over a multi-selection.
    [orientBtn, supportToolBtn].forEach(btn => {
      setButtonDisabled(btn, !hasSelection);
    });

    // Workflow steps that need plate content
    setButtonDisabled(editBtn, !(hasSelection || viewer.objects.length > 0));
    setButtonDisabled(materialBtn, viewer.objects.length === 0);
    setButtonDisabled(healthBtn, viewer.objects.length === 0);
    setButtonDisabled(sliceToolBtn, viewer.objects.length === 0);

    // Within edit panel, enable/disable individual buttons
    setButtonDisabled(duplicateBtn, !hasSelection);
    setButtonDisabled(fillBtn, !singleSelected);

    // Auto Arrange/Distribute button - enabled when there are objects
    const canArrange = viewer.objects.length > 0;
    if (arrangeBtn) {
      setButtonDisabled(arrangeBtn, !canArrange);

      // Update button text based on plate count
      const btnText = arrangeBtn.querySelector('span') || arrangeBtn.lastChild;
      if (btnText && btnText.nodeType === Node.TEXT_NODE) {
        btnText.textContent = project.plates.length > 1 ? 'Auto Distribute' : 'Auto Arrange';
      }
    }

    setButtonDisabled(deleteBtn, !hasSelection);

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
    updateSliceButtonState();
  });

  canvas.addEventListener('material-changed', () => {
    selectedMaterialId = viewer.getActiveMaterialPreset().id;
    viewer.setDefaultMaterialPreset(viewer.getActiveMaterialPreset());
    syncMaterialPicker();
    scheduleSavePreferences();
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

  canvas.addEventListener('mesh-changed', (event) => {
    invalidatePreflight();
    updateWorkspaceInfo(event);
  });
  canvas.addEventListener('mesh-changed', () => {
    if (activeToolPanel === 'slice') runPreflightChecks();
  });
  canvas.addEventListener('protected-face-picked', handleProtectedFacePicked);
  canvas.addEventListener('plate-changed', (event) => {
    const plate = event.detail?.plate;
    if (!plate) return;
    project.activePlateId = plate.id;
    syncSliceRefsFromActivePlate();
    updateEstimate();
    renderPlateTabs();
  });

  const savedPanel = savedPreferences?.activeToolPanel;
  showToolPanel(toolPanels[savedPanel] ? savedPanel : 'edit');

  // Support controls
  listen(overhangAngleInput, 'input', () => {
    if (overhangAngleVal) overhangAngleVal.textContent = overhangAngleInput.value + '°';
  });
  listen(supportDensityInput, 'input', () => {
    if (supportDensityVal) supportDensityVal.textContent = supportDensityInput.value;
  });
  listen(autoDensityInput, 'change', () => {
    syncSupportControlUi();
  });
  listen(autoThicknessInput, 'change', () => {
    syncSupportControlUi();
  });
  listen(basePanEnabledInput, 'change', () => {
    syncSupportControlUi();
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
    scheduleProjectAutosave();
  });
  listen(zElevationInput, 'change', () => {
    viewer.setElevation(parseFloat(zElevationInput.value));
    clearActivePlateSlice();
    updateEstimate();
  });

  // Slice controls
  listen(sliceBtn, 'click', handleSlice);
  listen(sliceAllBtn, 'click', handleSliceAll);
  listen(exportBtn, 'click', (event) => {
    const rect = exportBtn.getBoundingClientRect();
    openExportMenu(rect.left, rect.bottom + 4);
    event.preventDefault();
  });
  listen(exportAllBtn, 'click', handleExportAll);

  // Settings change -> update estimate
  [layerHeightInput, normalExposureInput, bottomLayersInput,
   bottomExposureInput, liftHeightInput, liftSpeedInput].filter(Boolean).forEach(el => {
    listen(el, 'change', () => {
      invalidatePreflight();
      updateEstimate();
    });
  });

  // Layer preview slider
  listen(layerSlider, 'input', showLayer);
  listen(addPlateBtn, 'click', () => switchToPlate(addPlate()));
  listen(removePlateBtn, 'click', () => deletePlate(getActivePlate()));
  initPlateDragTargets();
  listen(toggleSidebarBtn, 'click', toggleSidebar);
  registerPreferenceListeners();
  registerProjectAutosaveListeners();
  renderPlateTabs();

  // Model Health panel
  initModelHealth();

  const restoredProject = await maybeRestoreAutosavedProject(savedPreferences);
  if (!restoredProject) {
    await loadDefaultModel();
    applyCameraPreferences(savedPreferences?.camera);
  }
  preferencesReady = true;
  projectAutosaveReady = true;
  savePreferences();
  saveProjectAutosave();
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
  const showPlateControls = project.plates.length > 1;
  plateTabs.hidden = !showPlateControls;
  if (removePlateBtn) {
    removePlateBtn.hidden = !showPlateControls;
    removePlateBtn.title = 'Remove active plate';
    removePlateBtn.setAttribute('aria-label', 'Remove active plate');
  }
  plateTabs.innerHTML = '';
  if (!showPlateControls) return;
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
      openPlateMenu(plate, event.clientX, event.clientY);
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
    inspectorAreaData = null;
  }
  if (switchAfterMove) {
    switchToPlate(plate);
  } else {
    syncSliceRefsFromActivePlate();
  }
  renderPlateTabs();
  scheduleProjectAutosave();
}

function renamePlate(plate) {
  const nextName = prompt('Plate name', plate.name);
  if (!nextName) return;
  plate.name = nextName.trim() || plate.name;
  renderPlateTabs();
  scheduleProjectAutosave();
}

function getPlateMenuOptions(plate) {
  return {
    title: plate?.name || 'Plate',
    context: { type: 'plate', plateId: plate?.id },
    items: [
      { action: 'plate-rename', label: 'Rename' },
      { action: 'plate-duplicate', label: 'Duplicate' },
      { action: 'plate-delete', label: project.plates.length === 1 ? 'Clear Plate' : 'Delete Plate', danger: true },
    ],
  };
}

function openPlateMenu(plate, clientX = window.innerWidth / 2, clientY = window.innerHeight / 2) {
  showContextMenu(clientX, clientY, getPlateMenuOptions(plate));
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
  scheduleProjectAutosave();
}

function deletePlate(plate) {
  if (project.plates.length === 1) {
    if (plate.objects.length > 0 && !confirm(`Clear ${plate.name}?`)) return;
    viewer.clearPlate();
    clearActivePlateSlice();
    renderPlateTabs();
    updateArrangeButtonText();
    scheduleProjectAutosave();
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
  scheduleProjectAutosave();
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
  scheduleProjectAutosave();
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
  scheduleSavePreferences();
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
      viewer.setDefaultMaterialPreset(material);
      viewer.setMaterialPreset(material, 'selection');
      syncMaterialPicker();
      scheduleSavePreferences();
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

// --- Model Health Panel ---
function initModelHealth() {
  // Wire up analyze button
  listen(healthAnalyzeBtn, 'click', runModelHealthAnalysis);
  
  // Wire up auto-repair button
  listen(healthAutorepairBtn, 'click', runAutoRepair);

  listen(healthSupportHeatmapBtn, 'click', toggleSupportHeatmap);
  
  // Update health panel when selection changes (events are dispatched on the viewer canvas)
  const canvas = viewer?.canvas;
  if (canvas) {
    canvas.addEventListener('selection-changed', updateHealthPanelState);
    canvas.addEventListener('mesh-changed', () => {
      // Clear cached report when geometry changes
      lastInspectionReport = null;
      lastInspectionReportTarget = null;
      clearIssueHighlights();
      clearSupportHeatmap();
      updateHealthPanelState();
    });
  }
  
  // Initialize state
  updateHealthPanelState();
}

function updateHealthPanelState() {
  const hasObjects = viewer.objects.length > 0;
  const hasSingleSelection = viewer.selected.length === 1;
  const reportMatchesSelection = hasSingleSelection &&
    lastInspectionReportTarget?.type === 'selection' &&
    lastInspectionReportTarget?.objectId === viewer.selected[0].id;
  const hasRepairableIssues = getImplementedAutoFixIssues(lastInspectionReport).length > 0;
  
  healthAnalyzeBtn.disabled = !hasObjects;
  healthAnalyzeBtn.textContent = hasSingleSelection ? 'Analyze Selected' : 'Analyze Plate';
  healthAutorepairBtn.disabled = !reportMatchesSelection || !hasRepairableIssues;
  healthSupportHeatmapBtn.disabled = !hasObjects;
  healthSupportHeatmapBtn.textContent = supportHeatmapMesh ? 'Hide Support Heatmap' : 'Show Support Heatmap';
  
  // Update printer context
  if (hasObjects && viewer.printer) {
    healthPrinterContext.hidden = false;
    const spec = viewer.printer;
    const pixelSize = spec.buildWidthMM / spec.resolutionX;
    healthPrinterSpecs.innerHTML = `
      <div>Build: ${spec.buildWidthMM} × ${spec.buildDepthMM} × ${spec.buildHeightMM} mm</div>
      <div>Pixel size: ${(pixelSize * 1000).toFixed(1)} µm</div>
      <div>Resolution: ${spec.resolutionX} × ${spec.resolutionY}</div>
    `;
  } else {
    healthPrinterContext.hidden = true;
  }
}

async function runModelHealthAnalysis() {
  if (viewer.objects.length === 0) return;
  const target = getHealthAnalysisTarget();
  
  // Show analyzing state
  healthAnalyzeBtn.disabled = true;
  healthAnalyzeBtn.textContent = 'Analyzing...';
  healthScoreValue.textContent = '...';
  healthScoreLabel.textContent = 'Analyzing model...';
  healthScoreSvg.classList.add('health-analyzing');
  
  // Clear previous highlights
  clearIssueHighlights();
  
  // Run analysis asynchronously to not block UI
  await new Promise(resolve => setTimeout(resolve, 50));
  
  try {
    const geometry = target.geometry;
    if (!geometry) {
      throw new Error('No geometry available');
    }
    
    // Run inspection
    const inspector = new ModelInspector(geometry, {
      printerSpec: viewer.printer,
      thinFeatureThreshold: 0.3,
      overhangAngle: 45,
    });
    
    const report = inspector.runFullInspection();
    lastInspectionReport = report;
    lastInspectionReportTarget = {
      type: target.type,
      objectId: target.objectId,
      label: target.label,
    };
    
    // Update UI with results
    displayHealthReport(report);
    
  } catch (error) {
    console.error('Health analysis failed:', error);
    lastInspectionReport = null;
    lastInspectionReportTarget = null;
    healthScoreValue.textContent = 'Err';
    healthScoreLabel.textContent = 'Analysis failed';
    healthIssues.innerHTML = '<div class="health-empty-state">Analysis failed. Please try again.</div>';
  } finally {
    healthAnalyzeBtn.disabled = false;
    healthAnalyzeBtn.textContent = viewer.selected.length === 1 ? 'Analyze Selected' : 'Analyze Plate';
    healthScoreSvg.classList.remove('health-analyzing');
    updateHealthPanelState();
  }
}

function getHealthAnalysisTarget() {
  if (viewer.selected.length === 1) {
    return {
      type: 'selection',
      objectId: viewer.selected[0].id,
      label: 'Selected model',
      geometry: viewer.getModelGeometry(),
    };
  }

  return {
    type: 'plate',
    objectId: null,
    label: 'Plate',
    geometry: viewer.getMergedModelGeometry(),
  };
}

function getImplementedAutoFixIssues(report) {
  if (!report) return [];
  return report.issues.filter(issue => IMPLEMENTED_AUTO_REPAIR_ISSUE_IDS.has(issue.id));
}

function displayHealthReport(report) {
  // Update score display
  const score = report.getHealthScore();
  healthScoreValue.textContent = `${score}%`;
  healthScoreLabel.textContent = report.overallHealth.charAt(0).toUpperCase() + report.overallHealth.slice(1);
  
  // Update score ring
  healthScoreArc.setAttribute('stroke-dasharray', `${score}, 100`);
  
  // Update colors based on health (SVG elements need setAttribute, not .className)
  healthScoreSvg.setAttribute('class', 'health-score-svg health-' + report.overallHealth);
  healthScoreValue.className = 'health-score-value health-' + report.overallHealth;
  
  // Display issues
  if (report.issues.length === 0) {
    healthIssues.innerHTML = '<div class="health-empty-state" style="background: #dcfce7; color: #166534;">✓ No issues found. Model is ready to print.</div>';
    return;
  }
  
  // Group issues by severity
  const errors = report.issues.filter(i => i.severity === 'error');
  const warnings = report.issues.filter(i => i.severity === 'warning');
  const infos = report.issues.filter(i => i.severity === 'info');
  const locatableIssueCount = report.issues.filter(issue => issue.locations?.length > 0).length;
  
  let html = '';
  if (lastInspectionReportTarget?.label) {
    html += `<div class="health-target-label">${escapeHtml(lastInspectionReportTarget.label)} analysis</div>`;
  }
  
  if (errors.length > 0) {
    html += `
      <div class="health-issue-group error">
        <div class="health-issue-group-header" onclick="this.parentElement.classList.toggle('expanded')">
          <svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          <span>Errors</span>
          <span class="health-issue-group-count">${errors.length}</span>
        </div>
        <div class="health-issue-list">
          ${errors.map(issue => renderHealthIssue(issue)).join('')}
        </div>
      </div>
    `;
  }
  
  if (warnings.length > 0) {
    html += `
      <div class="health-issue-group warning">
        <div class="health-issue-group-header" onclick="this.parentElement.classList.toggle('expanded')">
          <svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-6h2v6z"/></svg>
          <span>Warnings</span>
          <span class="health-issue-group-count">${warnings.length}</span>
        </div>
        <div class="health-issue-list">
          ${warnings.map(issue => renderHealthIssue(issue)).join('')}
        </div>
      </div>
    `;
  }
  
  if (infos.length > 0) {
    html += `
      <div class="health-issue-group info">
        <div class="health-issue-group-header" onclick="this.parentElement.classList.toggle('expanded')">
          <svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
          <span>Info</span>
          <span class="health-issue-group-count">${infos.length}</span>
        </div>
        <div class="health-issue-list">
          ${infos.map(issue => renderHealthIssue(issue)).join('')}
        </div>
      </div>
    `;
  }
  
  if (locatableIssueCount > 0) {
    html += `<button class="btn btn-secondary health-show-issues-btn" onclick="highlightAllIssues()">Show Issues in 3D View</button>`;
  } else {
    html += `<button class="btn btn-secondary health-show-issues-btn" disabled>No 3D locations for these issues</button>`;
  }
  
  healthIssues.innerHTML = html;
  
  // Store report globally for access from inline handlers
  window.__lastHealthReport = report;
}

function renderHealthIssue(issue) {
  const autofix = IMPLEMENTED_AUTO_REPAIR_ISSUE_IDS.has(issue.id) ? '<span class="autofix-badge">Auto-fix</span>' : '';
  const occurrenceCount = issue.occurrences?.length || 0;
  const occurrenceControls = occurrenceCount > 0
    ? `<div class="health-occurrence-list">
        ${issue.occurrences.slice(0, 40).map((occurrence, index) =>
          `<button type="button" class="health-occurrence-btn" onclick="event.stopPropagation(); highlightIssueOccurrence('${issue.id}', ${index})">${escapeHtml(occurrence.label || `${index + 1}`)}</button>`
        ).join('')}
        ${occurrenceCount > 40 ? `<span class="health-occurrence-more">+${occurrenceCount - 40} more</span>` : ''}
      </div>`
    : '';
  return `
    <div class="health-issue-item" data-issue-id="${issue.id}" onclick="highlightIssue('${issue.id}')">
      <div class="health-issue-item-content">
        <div class="health-issue-item-title">${escapeHtml(issue.description)}${autofix}</div>
        <div class="health-issue-item-desc">${escapeHtml(issue.impact)}</div>
        ${occurrenceControls}
      </div>
    </div>
  `;
}

// Make functions available globally for inline handlers
window.highlightIssue = function(issueId) {
  if (!lastInspectionReport) return;
  const issue = lastInspectionReport.issues.find(i => i.id === issueId);
  if (issue && issue.locations) {
    highlightIssueLocations(issue.locations, issue.severity);
  } else if (issue) {
    alert('This issue type does not have a specific 3D location yet.');
  }
};

window.highlightIssueOccurrence = function(issueId, occurrenceIndex) {
  if (!lastInspectionReport) return;
  const issue = lastInspectionReport.issues.find(i => i.id === issueId);
  const occurrence = issue?.occurrences?.[occurrenceIndex];
  if (!issue || !occurrence?.locations) return;
  clearIssueHighlights();
  highlightIssueLocations(new Float32Array(occurrence.locations), issue.severity, {
    markerSize: 8,
    focus: true,
  });
};

window.highlightAllIssues = function() {
  if (!lastInspectionReport) return;
  clearIssueHighlights();
  let highlighted = 0;
  
  for (const issue of lastInspectionReport.issues) {
    if (issue.locations) {
      highlightIssueLocations(issue.locations, issue.severity);
      highlighted++;
    }
  }

  if (highlighted === 0) {
    alert('No reported issues have 3D locations yet.');
  }
};

function highlightIssueLocations(locations, severity, options = {}) {
  if (!locations || locations.length === 0) return;
  
  // Color based on severity
  let color = 0xffdd44; // info - yellow
  if (severity === 'error') color = 0xff4444;
  else if (severity === 'warning') color = 0xff9944;
  
  // Create point cloud or sphere markers for locations
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(locations, 3));
  geometry.computeBoundingSphere();
  
  const material = new THREE.PointsMaterial({
    color: color,
    size: options.markerSize || 7,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.98,
    depthTest: false,
    depthWrite: false,
  });
  
  const points = new THREE.Points(geometry, material);
  points.renderOrder = 1000;
  viewer.scene.add(points);
  issueHighlightMeshes.push(points);

  const haloMaterial = new THREE.PointsMaterial({
    color: color,
    size: options.haloSize || (options.markerSize ? options.markerSize * 2.4 : 17),
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.28,
    depthTest: false,
    depthWrite: false,
  });
  const halo = new THREE.Points(geometry.clone(), haloMaterial);
  halo.renderOrder = 999;
  viewer.scene.add(halo);
  issueHighlightMeshes.push(halo);

  if (locations.length === 3 || options.focus) {
    const ring = createIssueFocusRing(locations, color, options);
    if (ring) {
      viewer.scene.add(ring);
      issueHighlightMeshes.push(ring);
    }
  }

  if (options.focus) {
    const first = new THREE.Vector3(locations[0], locations[1], locations[2]);
    viewer.controls?.target.copy(first);
    viewer.controls?.update();
  }
  
  viewer.requestRender();
}

function createIssueFocusRing(locations, color, options = {}) {
  if (locations.length < 3) return null;
  const center = new THREE.Vector3(locations[0], locations[1], locations[2]);
  const radius = options.ringRadius || 5;
  const ringGeometry = new THREE.RingGeometry(radius * 0.72, radius, 40);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.position.copy(center);
  ring.quaternion.copy(viewer.camera.quaternion);
  ring.renderOrder = 1001;
  return ring;
}

function clearIssueHighlights() {
  for (const mesh of issueHighlightMeshes) {
    viewer.scene.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) mesh.material.dispose();
  }
  issueHighlightMeshes = [];
  viewer.requestRender();
}

function toggleSupportHeatmap() {
  if (supportHeatmapMesh) {
    clearSupportHeatmap();
    updateHealthPanelState();
    return;
  }

  const targets = viewer.selected.length > 0 ? viewer.selected : viewer.objects;
  const result = buildSupportHeatmapGeometry(targets, parseFloat(overhangAngleInput?.value) || 30);
  if (!result?.geometry || result.triangleCount === 0) {
    alert('No support-heavy overhang areas found for the current orientation.');
    return;
  }

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  supportHeatmapMesh = new THREE.Mesh(result.geometry, material);
  supportHeatmapMesh.renderOrder = 900;
  supportHeatmapMesh.userData = {
    supportAreaMm2: result.area,
    supportTriangleCount: result.triangleCount,
  };
  viewer.scene.add(supportHeatmapMesh);
  viewer.requestRender();
  updateHealthPanelState();
}

function clearSupportHeatmap() {
  if (!supportHeatmapMesh) return;
  viewer.scene.remove(supportHeatmapMesh);
  supportHeatmapMesh.geometry?.dispose();
  supportHeatmapMesh.material?.dispose();
  supportHeatmapMesh = null;
  viewer.requestRender();
}

function buildSupportHeatmapGeometry(targets, overhangAngleDeg) {
  const geos = [];
  for (const obj of targets) {
    if (!obj?.mesh?.geometry) continue;
    const geometry = obj.mesh.geometry.clone();
    obj.mesh.updateMatrixWorld(true);
    geometry.applyMatrix4(obj.mesh.matrixWorld);
    geos.push(geometry);
  }

  if (geos.length === 0) return null;
  const merged = geos.length === 1 ? geos[0] : BufferGeometryUtils.mergeGeometries(geos, false);
  geos.forEach(geometry => {
    if (geometry !== merged) geometry.dispose();
  });
  if (!merged) return null;

  const source = merged.index ? merged.toNonIndexed() : merged;
  if (source !== merged) merged.dispose();

  const pos = source.attributes.position;
  const overhangThreshold = Math.cos(THREE.MathUtils.degToRad(90 - overhangAngleDeg));
  const heatPositions = [];
  const heatColors = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const center = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const normal = new THREE.Vector3();
  let supportArea = 0;
  let triangleCount = 0;

  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    edge1.subVectors(b, a);
    edge2.subVectors(c, a);
    normal.crossVectors(edge1, edge2);
    const area = normal.length() * 0.5;
    if (area <= 1e-8) continue;
    normal.normalize();

    const downness = -normal.y;
    if (downness <= overhangThreshold) continue;

    center.copy(a).add(b).add(c).divideScalar(3);
    if (center.y <= 0.5) continue;

    const angleDemand = THREE.MathUtils.clamp((downness - overhangThreshold) / (1 - overhangThreshold), 0, 1);
    const heightDemand = THREE.MathUtils.clamp(center.y / 50, 0, 1);
    const areaDemand = THREE.MathUtils.clamp(area / 35, 0, 1);
    const demand = THREE.MathUtils.clamp(
      Math.max(angleDemand, angleDemand * 0.82 + heightDemand * 0.12 + areaDemand * 0.06),
      0,
      1
    );
    const color = supportDemandColor(demand);
    const offset = normal.clone().multiplyScalar(0.04);

    for (const v of [a, b, c]) {
      heatPositions.push(v.x + offset.x, v.y + offset.y, v.z + offset.z);
      heatColors.push(color.r, color.g, color.b);
    }
    supportArea += area;
    triangleCount++;
  }

  source.dispose();
  if (triangleCount === 0) return { geometry: null, area: 0, triangleCount: 0 };

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(heatPositions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(heatColors, 3));
  geometry.computeBoundingSphere();
  return { geometry, area: supportArea, triangleCount };
}

function supportDemandColor(demand) {
  const low = new THREE.Color(0x00e676);
  const mid = new THREE.Color(0xffea00);
  const hot = new THREE.Color(0xff6d00);
  const high = new THREE.Color(0xff1744);
  if (demand < 0.35) {
    return low.lerp(mid, demand / 0.35);
  }
  if (demand < 0.68) {
    return mid.lerp(hot, (demand - 0.35) / 0.33);
  }
  return hot.lerp(high, (demand - 0.68) / 0.32);
}

async function runAutoRepair() {
  if (viewer.selected.length !== 1) {
    alert('Please select one analyzed model to repair.');
    return;
  }
  
  if (
    !lastInspectionReport ||
    lastInspectionReportTarget?.type !== 'selection' ||
    lastInspectionReportTarget?.objectId !== viewer.selected[0].id
  ) {
    alert('Please analyze the selected model first.');
    return;
  }
  
  // Check if there are any auto-fixable issues
  const fixableIssues = getImplementedAutoFixIssues(lastInspectionReport);
  if (fixableIssues.length === 0) {
    alert('No auto-fixable issues found.');
    return;
  }
  
  const confirmed = confirm(
    `Auto-repair will attempt to fix:\n${fixableIssues.map(i => '• ' + i.description).join('\n')}\n\n` +
    'This will modify the selected model. Continue?'
  );
  if (!confirmed) return;
  
  healthAutorepairBtn.disabled = true;
  healthAutorepairBtn.textContent = 'Repairing...';
  
  try {
    const sel = viewer.selected[0];
    const geometry = sel?.mesh?.geometry?.clone();
    if (!geometry) {
      throw new Error('No geometry available');
    }
    
    // Run repair
    const repairer = new ModelRepairer(geometry);
    const result = repairer.autoRepair();
    
    if (result.success && result.geometry) {
      // Update the selected mesh with repaired geometry
      if (sel && sel.mesh) {
        viewer._saveUndoState?.();
        sel.mesh.geometry.dispose();
        sel.mesh.geometry = result.geometry;
        sel.mesh.geometry.computeBoundingBox();
        sel.mesh.geometry.computeVertexNormals();
        sel._cachedLocalVolume = undefined;
        viewer.clearSupports();
        sel.mesh.updateMatrixWorld(true);
        viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
      }
      
      // Clear cached report
      lastInspectionReport = null;
      clearIssueHighlights();
      
      // Show results
      alert(`Repair completed:\n${result.message}`);
      
      // Re-run analysis
      await runModelHealthAnalysis();
    } else {
      alert('Repair failed: ' + (result.message || 'Unknown error'));
    }
  } catch (error) {
    console.error('Auto-repair failed:', error);
    alert('Repair failed: ' + error.message);
  } finally {
    healthAutorepairBtn.textContent = 'Auto-Repair';
    updateHealthPanelState();
  }
}
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
  scheduleProjectAutosave();
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
  scheduleProjectAutosave();
  hideProgress();
}

// --- Preflight checks ---

const PREFLIGHT_ICONS = {
  pass:    '✓',
  warn:    '⚠',
  error:   '✖',
  running: '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 1a6 6 0 1 1-6 6"/></svg>',
};

function preflightCheckBounds() {
  if (!viewer || viewer.objects.length === 0) return { severity: 'pass', detail: 'No objects' };
  const { inBounds } = viewer.checkBounds();
  return inBounds
    ? { severity: 'pass', detail: 'Within build volume' }
    : { severity: 'error', detail: 'Objects exceed build volume' };
}

function preflightFirstLayer() {
  if (!viewer || viewer.objects.length === 0) return { severity: 'pass', detail: 'No objects' };
  const eps = 0.05;
  for (const obj of viewer.objects) {
    obj.mesh.updateMatrixWorld(true);
    const bb = obj.mesh.geometry.boundingBox.clone().applyMatrix4(obj.mesh.matrixWorld);
    if (bb.min.y <= eps) continue;
    if (obj.supportsMesh) {
      const sbb = new THREE.Box3().setFromObject(obj.supportsMesh);
      if (sbb.min.y <= eps) continue;
    }
    return { severity: 'error', detail: `Object floating ${bb.min.y.toFixed(1)}mm above plate` };
  }
  return { severity: 'pass', detail: 'Base contact confirmed' };
}

function preflightFloatingParts() {
  if (!viewer || viewer.objects.length === 0) return { severity: 'pass', detail: 'No objects' };
  const eps = 0.05;
  let floating = 0;
  for (const obj of viewer.objects) {
    obj.mesh.updateMatrixWorld(true);
    const bb = obj.mesh.geometry.boundingBox.clone().applyMatrix4(obj.mesh.matrixWorld);
    if (bb.min.y <= eps) continue;
    if (obj.supportsMesh) continue; // has supports — assume they anchor it
    floating++;
  }
  if (floating === 0) return { severity: 'pass', detail: 'All parts anchored' };
  return { severity: 'error', detail: `${floating} part${floating > 1 ? 's' : ''} floating — needs supports` };
}

function preflightLargeCrossSection() {
  if (!viewer || viewer.objects.length === 0) return { severity: 'pass', detail: 'No objects' };
  const spec = slicer.getPrinterSpec();
  if (!spec) return { severity: 'pass', detail: 'No printer' };
  const plateArea = spec.buildWidthMM * spec.buildDepthMM;

  let totalFlat = 0;
  for (const obj of viewer.objects) {
    const geo = obj.mesh.geometry.clone();
    obj.mesh.updateMatrixWorld(true);
    geo.applyMatrix4(obj.mesh.matrixWorld);
    const metrics = analyzeCurrentOrientation(geo);
    totalFlat += metrics.overhangArea; // total downward-facing area ≈ max layer area proxy
    geo.dispose();
  }
  const ratio = totalFlat / plateArea;
  if (ratio < 0.15) return { severity: 'pass', detail: 'Cross-section OK' };
  if (ratio < 0.40) return { severity: 'warn', detail: `~${(ratio * 100).toFixed(0)}% plate coverage — moderate peel force` };
  return { severity: 'error', detail: `~${(ratio * 100).toFixed(0)}% plate coverage — high peel force` };
}

async function preflightUnsupportedOverhangs() {
  if (!viewer || viewer.objects.length === 0) return { severity: 'pass', detail: 'No objects' };
  const overhangAngle = parseFloat(overhangAngleInput?.value) || 30;
  const overhangThreshold = Math.cos(THREE.MathUtils.degToRad(90 - overhangAngle));
  const UP = new THREE.Vector3(0, 1, 0);
  const DOWN = new THREE.Vector3(0, -1, 0);
  const raycaster = new THREE.Raycaster();

  let unsupportedArea = 0;
  let totalOverhangArea = 0;

  for (const obj of viewer.objects) {
    obj.mesh.updateMatrixWorld(true);
    const geo = obj.mesh.geometry;
    const pos = geo.attributes.position;
    const norm = geo.attributes.normal;
    if (!pos || !norm) continue;
    const triCount = pos.count / 3;
    const matrix = obj.mesh.matrixWorld;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);

    // Build BVH on support mesh if it exists
    let supportMeshForRay = null;
    if (obj.supportsMesh) {
      obj.supportsMesh.updateMatrixWorld(true);
      if (!obj.supportsMesh.geometry.boundsTree) {
        obj.supportsMesh.geometry.computeBoundsTree();
      }
      supportMeshForRay = obj.supportsMesh;
    }

    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const n = new THREE.Vector3(), centroid = new THREE.Vector3();
    const edge1 = new THREE.Vector3(), edge2 = new THREE.Vector3(), cross = new THREE.Vector3();

    // Sample every Nth triangle for speed
    const step = Math.max(1, Math.floor(triCount / 2000));

    for (let i = 0; i < triCount; i += step) {
      const idx = i * 3;
      n.set(norm.getX(idx), norm.getY(idx), norm.getZ(idx)).applyMatrix3(normalMatrix).normalize();
      const dot = n.dot(UP);
      if (dot >= -overhangThreshold) continue; // not an overhang

      a.set(pos.getX(idx), pos.getY(idx), pos.getZ(idx)).applyMatrix4(matrix);
      b.set(pos.getX(idx + 1), pos.getY(idx + 1), pos.getZ(idx + 1)).applyMatrix4(matrix);
      c.set(pos.getX(idx + 2), pos.getY(idx + 2), pos.getZ(idx + 2)).applyMatrix4(matrix);

      edge1.subVectors(b, a);
      edge2.subVectors(c, a);
      cross.crossVectors(edge1, edge2);
      const area = cross.length() * 0.5 * step; // scale up for sampled faces

      totalOverhangArea += area;

      // Check if supports exist beneath this point
      if (supportMeshForRay) {
        centroid.set((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3);
        raycaster.set(centroid, DOWN);
        raycaster.far = centroid.y + 1; // ray to plate
        const hits = raycaster.intersectObject(supportMeshForRay, false);
        if (hits.length > 0) continue; // support found beneath
      }

      unsupportedArea += area;
    }

    // Clean up BVH if we created it
    if (supportMeshForRay && obj.supportsMesh.geometry.boundsTree) {
      obj.supportsMesh.geometry.disposeBoundsTree();
    }
  }

  if (totalOverhangArea < 1) return { severity: 'pass', detail: 'No significant overhangs' };
  if (unsupportedArea < 1) return { severity: 'pass', detail: `${totalOverhangArea.toFixed(0)} mm² covered` };

  const pct = (unsupportedArea / totalOverhangArea * 100).toFixed(0);
  if (unsupportedArea < totalOverhangArea * 0.1) {
    return { severity: 'warn', detail: `${unsupportedArea.toFixed(0)} mm² unsupported (${pct}%)` };
  }
  return { severity: 'error', detail: `${unsupportedArea.toFixed(0)} mm² unsupported (${pct}%)` };
}

async function preflightThinWalls() {
  if (!viewer || viewer.objects.length === 0) return { severity: 'pass', detail: 'No objects' };
  const spec = slicer.getPrinterSpec();
  if (!spec) return { severity: 'pass', detail: 'No printer' };
  const pixelPitch = spec.buildWidthMM / spec.resolutionX;
  const raycaster = new THREE.Raycaster();
  let thinCount = 0;
  let sampledCount = 0;

  for (const obj of viewer.objects) {
    obj.mesh.updateMatrixWorld(true);
    const geo = obj.mesh.geometry;
    const pos = geo.attributes.position;
    const norm = geo.attributes.normal;
    if (!pos || !norm) continue;

    if (!geo.boundsTree) geo.computeBoundsTree();

    const triCount = pos.count / 3;
    const matrix = obj.mesh.matrixWorld;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const step = Math.max(1, Math.floor(triCount / 1500));

    const centroid = new THREE.Vector3();
    const n = new THREE.Vector3();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();

    for (let i = 0; i < triCount; i += step) {
      const idx = i * 3;
      n.set(norm.getX(idx), norm.getY(idx), norm.getZ(idx)).applyMatrix3(normalMatrix).normalize();

      // Only check near-vertical or angled faces (skip top/bottom faces)
      if (Math.abs(n.y) > 0.7) continue;

      a.set(pos.getX(idx), pos.getY(idx), pos.getZ(idx)).applyMatrix4(matrix);
      b.set(pos.getX(idx + 1), pos.getY(idx + 1), pos.getZ(idx + 1)).applyMatrix4(matrix);
      c.set(pos.getX(idx + 2), pos.getY(idx + 2), pos.getZ(idx + 2)).applyMatrix4(matrix);
      centroid.set((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3);

      // Raycast inward (opposite of face normal) to find opposing wall
      const inward = n.clone().negate();
      const origin = centroid.clone().addScaledVector(inward, 0.01); // small offset to avoid self-hit
      raycaster.set(origin, inward);
      raycaster.far = pixelPitch * 2; // only check for walls thinner than 2x pixel pitch
      const hits = raycaster.intersectObject(obj.mesh, false);

      sampledCount++;
      if (hits.length > 0 && hits[0].distance < pixelPitch) {
        thinCount++;
      }
    }
  }

  const pitchUm = (pixelPitch * 1000).toFixed(0);
  if (thinCount === 0) return { severity: 'pass', detail: `No features below ${pitchUm}μm` };
  const pct = sampledCount > 0 ? (thinCount / sampledCount * 100).toFixed(0) : 0;
  if (thinCount < sampledCount * 0.05) {
    return { severity: 'warn', detail: `~${pct}% of walls below ${pitchUm}μm pixel pitch` };
  }
  return { severity: 'error', detail: `~${pct}% of walls below ${pitchUm}μm — may not resolve` };
}

const PREFLIGHT_CHECKS = [
  { id: 'bounds',       label: 'Build volume',       run: preflightCheckBounds },
  { id: 'first-layer',  label: 'First layer',        run: preflightFirstLayer },
  { id: 'floating',     label: 'Floating parts',     run: preflightFloatingParts },
  { id: 'peel',         label: 'Peel force',         run: preflightLargeCrossSection },
  { id: 'overhangs',    label: 'Overhangs',          run: preflightUnsupportedOverhangs },
  { id: 'thin-walls',   label: 'Thin walls',         run: preflightThinWalls },
];

function getPreflightSignature() {
  const settings = [
    layerHeightInput?.value,
    normalExposureInput?.value,
    bottomLayersInput?.value,
    bottomExposureInput?.value,
    liftHeightInput?.value,
    liftSpeedInput?.value,
  ].join('|');
  const plate = getActivePlate();
  const objectState = viewer?.objects.map(obj => {
    const p = obj.mesh.position;
    const s = obj.mesh.scale;
    const r = obj.mesh.rotation;
    return `${obj.id}:${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}:${s.x.toFixed(3)},${s.y.toFixed(3)},${s.z.toFixed(3)}:${r.x.toFixed(3)},${r.y.toFixed(3)},${r.z.toFixed(3)}:${!!obj.supportsMesh}`;
  }).join(';') || '';
  return `${plate?.id || ''}|${settings}|${objectState}`;
}

function invalidatePreflight() {
  if (preflightState.state === 'running') return;
  preflightState = {
    ...preflightState,
    state: 'stale',
    signature: '',
    errors: [],
    warnings: [],
    promise: null,
  };
  updateSliceButtonState();
}

function updateSliceButtonState() {
  const hasObjects = !!viewer && viewer.objects.length > 0;
  const running = preflightState.state === 'running';
  if (sliceBtn) {
    sliceBtn.disabled = !hasObjects || running;
    sliceBtn.textContent = running ? 'Checking...' : 'Slice Plate';
  }
  if (sliceAllBtn) {
    sliceAllBtn.disabled = !project.plates.some(plate => plate.objects.length > 0) || running;
  }
  updateOutputButtons();
}

async function runPreflightChecks() {
  if (!viewer || viewer.objects.length === 0) {
    preflightSection.hidden = true;
    preflightState = { state: 'idle', signature: '', errors: [], warnings: [], promise: null };
    updateSliceButtonState();
    return preflightState;
  }
  preflightSection.hidden = false;
  const gen = ++preflightGeneration;
  const signature = getPreflightSignature();
  preflightState = { state: 'running', signature, errors: [], warnings: [], promise: null };
  updateSliceButtonState();
  const runPromise = (async () => {
    const errors = [];
    const warnings = [];

    // Render initial rows
    preflightResults.innerHTML = PREFLIGHT_CHECKS.map(check =>
      `<div class="preflight-row preflight-running" data-check="${check.id}">` +
      `<span class="preflight-icon">${PREFLIGHT_ICONS.running}</span>` +
      `<span class="preflight-label">${check.label}</span>` +
      `<span class="preflight-detail">Checking...</span>` +
      `</div>`
    ).join('');

    for (const check of PREFLIGHT_CHECKS) {
      if (gen !== preflightGeneration) return preflightState; // stale run
      const row = preflightResults.querySelector(`[data-check="${check.id}"]`);
      if (!row) continue;
      try {
        const result = await check.run();
        if (gen !== preflightGeneration) return preflightState;
        row.className = `preflight-row preflight-${result.severity}`;
        row.querySelector('.preflight-icon').textContent = PREFLIGHT_ICONS[result.severity];
        row.querySelector('.preflight-detail').textContent = result.detail;
        if (result.severity === 'error') errors.push(check.label);
        if (result.severity === 'warn') warnings.push(check.label);
      } catch (err) {
        console.warn(`Preflight "${check.id}" failed:`, err);
        if (gen !== preflightGeneration) return preflightState;
        row.className = 'preflight-row preflight-warn';
        row.querySelector('.preflight-icon').textContent = PREFLIGHT_ICONS.warn;
        row.querySelector('.preflight-detail').textContent = 'Check failed';
        warnings.push(check.label);
      }
      await new Promise(r => setTimeout(r, 0)); // yield
    }

    if (gen === preflightGeneration) {
      preflightState = {
        state: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'pass',
        signature,
        errors,
        warnings,
        promise: null,
      };
      updateSliceButtonState();
    }
    return preflightState;
  })();

  preflightState.promise = runPromise;
  updateSliceButtonState();
  return runPromise;
}

listen(preflightRecheckBtn, 'click', runPreflightChecks);

async function ensureCurrentPreflight() {
  if (!viewer || viewer.objects.length === 0) return null;
  const signature = getPreflightSignature();
  if (preflightState.state === 'running' && preflightState.promise) {
    return preflightState.promise;
  }
  if (preflightState.signature !== signature || !['pass', 'warn', 'error'].includes(preflightState.state)) {
    return runPreflightChecks();
  }
  return preflightState;
}

// --- Slicing ---
async function handleSlice() {
  const preflight = await ensureCurrentPreflight();
  if (!preflight) return false;
  if (preflight.errors.length > 0) {
    if (!confirm(`Preflight issues: ${preflight.errors.join(', ')}. Slice anyway?`)) return false;
  }

  const layerHeight = parseFloat(layerHeightInput.value);

  showProgress('Merging & Uploading geometry...');
  await new Promise(r => setTimeout(r, 50));

  const mergedModelGeo = viewer.getMergedModelGeometry();
  const mergedSupportGeo = viewer.getMergedSupportGeometry();

  if (!mergedModelGeo) {
      hideProgress();
      return false;
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
  const perLayerWhite = [];
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
    onLayer: (pixels) => { const w = countWhitePixels(pixels); filledPx += w; perLayerWhite.push(w); },
  });

  // Pre-cache area data so the inspector opens instantly
  inspectorAreaData = new Float64Array(perLayerWhite);

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
  layerSlider.max = slicedLayers.length - 1;
  layerSlider.value = 0;
  showLayer();
  renderPlateTabs();
  updateOutputButtons();
  return true;
}

async function handleSliceAll() {
  const startPlateId = project.activePlateId;
  const platesToSlice = project.plates.filter(plate => plate.objects.length > 0);
  for (let i = 0; i < platesToSlice.length; i++) {
    const plate = platesToSlice[i];
    switchToPlate(plate);
    showProgress(`Slicing ${plate.name} (${i + 1} / ${platesToSlice.length})...`);
    const sliced = await handleSlice();
    if (!sliced) break;
  }
  const startPlate = project.plates.find(plate => plate.id === startPlateId);
  if (startPlate) switchToPlate(startPlate);
  updateOutputButtons();
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

// --- Layer Inspector ---

/** Create a flipped full-res canvas from a raw RGBA Uint8Array */
function layerToCanvas(pixels, resX, resY) {
  // Flip rows in-place into an ImageData — no buffer copy, no extra canvas
  const rowBytes = resX * 4;
  const img = new ImageData(resX, resY);
  const dst = img.data;
  const src = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  for (let y = 0; y < resY; y++) {
    const srcOff = y * rowBytes;
    const dstOff = (resY - 1 - y) * rowBytes;
    dst.set(src.subarray(srcOff, srcOff + rowBytes), dstOff);
  }
  const c = document.createElement('canvas');
  c.width = resX;
  c.height = resY;
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}

/** Count white pixels in an RGBA buffer */
function countWhite(pixels) {
  let n = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] > 127) n++;
  }
  return n;
}

/** Flood-fill island detection on an RGBA buffer. Returns island count and per-island pixel counts. */
function detectIslands(pixels, w, h, prevPixels) {
  // work on a 1-bit grid downsampled 4x for speed on huge printer resolutions
  const scale = 4;
  const sw = Math.ceil(w / scale);
  const sh = Math.ceil(h / scale);
  const grid = new Uint8Array(sw * sh);
  // also build a downsampled grid for the previous layer (if any)
  const prevGrid = prevPixels ? new Uint8Array(sw * sh) : null;
  for (let y = 0; y < sh; y++) {
    const srcY = Math.min(y * scale, h - 1);
    for (let x = 0; x < sw; x++) {
      const srcX = Math.min(x * scale, w - 1);
      const idx = (srcY * w + srcX) * 4;
      grid[y * sw + x] = pixels[idx] > 127 ? 1 : 0;
      if (prevGrid) prevGrid[y * sw + x] = prevPixels[idx] > 127 ? 1 : 0;
    }
  }

  const labels = new Int32Array(sw * sh);
  let componentCount = 0;
  const sizes = [];
  const supported = []; // per-component: does it overlap previous layer?
  const stack = [];

  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === 1 && labels[i] === 0) {
      componentCount++;
      let size = 0;
      let hasSupport = !prevGrid; // layer 0 is always on the build plate
      stack.push(i);
      labels[i] = componentCount;
      while (stack.length > 0) {
        const p = stack.pop();
        size++;
        if (prevGrid && !hasSupport && prevGrid[p] === 1) {
          hasSupport = true;
        }
        const px = p % sw;
        const py = (p - px) / sw;
        const neighbors = [
          py > 0 ? p - sw : -1,
          py < sh - 1 ? p + sw : -1,
          px > 0 ? p - 1 : -1,
          px < sw - 1 ? p + 1 : -1,
        ];
        for (const n of neighbors) {
          if (n >= 0 && grid[n] === 1 && labels[n] === 0) {
            labels[n] = componentCount;
            stack.push(n);
          }
        }
      }
      sizes.push(size * scale * scale); // approximate real pixel count
      supported.push(hasSupport);
    }
  }

  const unsupportedIndices = [];
  for (let i = 0; i < supported.length; i++) {
    if (!supported[i]) unsupportedIndices.push(i + 1); // 1-based label
  }

  return {
    count: componentCount,
    sizes,
    labels,
    sw, sh, scale,
    supported,
    unsupportedCount: unsupportedIndices.length,
    unsupportedLabels: new Set(unsupportedIndices),
  };
}

/** Render the inspector canvas for a given layer index */
function renderInspectorLayer(idx) {
  if (!slicedLayers || idx < 0 || idx >= slicedLayers.length) return;

  const spec = slicer.getPrinterSpec();
  const resX = spec.resolutionX;
  const resY = spec.resolutionY;
  const pixels = slicedLayers[idx];
  const base = layerToCanvas(pixels, resX, resY);

  // Determine display size — use full resolution
  inspectorCanvas.width = resX;
  inspectorCanvas.height = resY;
  const ctx = inspectorCanvas.getContext('2d');
  ctx.drawImage(base, 0, 0);

  const layerHeight = parseFloat(document.getElementById('layer-height')?.value) || 0.05;
  const whitePx = inspectorAreaData ? inspectorAreaData[idx] : countWhite(pixels);
  const totalPx = resX * resY;
  const pxWidthMm = spec.buildWidthMM / resX;
  const pxHeightMm = spec.buildDepthMM / resY;
  const areaMm2 = whitePx * pxWidthMm * pxHeightMm;
  const coverage = (whitePx / totalPx) * 100;

  // Update stats
  inspectorArea.textContent = areaMm2 < 100 ? `${areaMm2.toFixed(2)} mm²` : `${areaMm2.toFixed(1)} mm²`;
  inspectorCoverage.textContent = `${coverage.toFixed(1)}%`;
  inspectorHeight.textContent = `${((idx + 1) * layerHeight).toFixed(2)} mm`;

  // Island detection — compare against previous layer to find unsupported regions
  const prevPixels = idx > 0 ? slicedLayers[idx - 1] : null;
  const islands = detectIslands(pixels, resX, resY, prevPixels);
  // Show unsupported / total (e.g. "2 / 5" or just "3" if none unsupported)
  if (islands.unsupportedCount > 0) {
    inspectorIslands.textContent = `${islands.unsupportedCount} unsupported`;
    inspectorIslands.style.color = '#ef9a9a';
  } else {
    inspectorIslands.textContent = `${islands.count}`;
    inspectorIslands.style.color = '';
  }

  // Highlight unsupported islands in red, supported regions get a subtle tint
  if (inspectorHighlightIslands.checked && islands.count > 0) {
    const unsupportedColor = [239, 100, 100]; // warm red for unsupported
    const supportedColor = [102, 194, 165];   // soft teal for supported
    const overlay = ctx.getImageData(0, 0, resX, resY);
    const od = overlay.data;
    for (let sy = 0; sy < islands.sh; sy++) {
      for (let sx = 0; sx < islands.sw; sx++) {
        const label = islands.labels[sy * islands.sw + sx];
        if (label > 0) {
          const isUnsupported = islands.unsupportedLabels.has(label);
          const col = isUnsupported ? unsupportedColor : supportedColor;
          const blend = isUnsupported ? 0.65 : 0.25; // unsupported stands out more
          // paint the scale×scale block in the full-res canvas
          for (let dy = 0; dy < islands.scale && sy * islands.scale + dy < resY; dy++) {
            for (let dx = 0; dx < islands.scale && sx * islands.scale + dx < resX; dx++) {
              const fy = resY - 1 - (sy * islands.scale + dy); // flip Y back
              const fx = sx * islands.scale + dx;
              const pi = (fy * resX + fx) * 4;
              if (od[pi] > 127) { // only overlay on white pixels
                od[pi] = Math.round(od[pi] * (1 - blend) + col[0] * blend);
                od[pi + 1] = Math.round(od[pi + 1] * (1 - blend) + col[1] * blend);
                od[pi + 2] = Math.round(od[pi + 2] * (1 - blend) + col[2] * blend);
              }
            }
          }
        }
      }
    }
    ctx.putImageData(overlay, 0, 0);
  }

  // Show outlines (edge detection)
  if (inspectorShowOutline.checked) {
    const src = ctx.getImageData(0, 0, resX, resY);
    const sd = src.data;
    const overlay = ctx.createImageData(resX, resY);
    const od = overlay.data;
    // Copy source
    od.set(sd);
    for (let y = 1; y < resY - 1; y++) {
      for (let x = 1; x < resX - 1; x++) {
        const i = (y * resX + x) * 4;
        if (sd[i] > 127) {
          // check 4-connected neighbors
          const up = ((y - 1) * resX + x) * 4;
          const dn = ((y + 1) * resX + x) * 4;
          const lt = (y * resX + (x - 1)) * 4;
          const rt = (y * resX + (x + 1)) * 4;
          if (sd[up] <= 127 || sd[dn] <= 127 || sd[lt] <= 127 || sd[rt] <= 127) {
            od[i] = 255; od[i + 1] = 200; od[i + 2] = 60; od[i + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(overlay, 0, 0);
  }

  // Diff with previous layer
  if (inspectorDiffMode.checked && idx > 0) {
    const prevPixels = slicedLayers[idx - 1];
    const overlay = ctx.getImageData(0, 0, resX, resY);
    const od = overlay.data;
    for (let y = 0; y < resY; y++) {
      for (let x = 0; x < resX; x++) {
        const fi = (y * resX + x) * 4;
        const srcY = resY - 1 - y; // un-flip for raw pixel lookup
        const ri = (srcY * resX + x) * 4;
        const curOn = pixels[ri] > 127;
        const prevOn = prevPixels[ri] > 127;
        if (curOn && !prevOn) {
          // new pixel — soft green
          od[fi] = 102; od[fi + 1] = 187; od[fi + 2] = 106; od[fi + 3] = 255;
        } else if (!curOn && prevOn) {
          // removed pixel — soft red
          od[fi] = 239; od[fi + 1] = 154; od[fi + 2] = 154; od[fi + 3] = 200;
        } else if (curOn && prevOn) {
          // unchanged — dim
          od[fi] = Math.round(od[fi] * 0.5);
          od[fi + 1] = Math.round(od[fi + 1] * 0.5);
          od[fi + 2] = Math.round(od[fi + 2] * 0.5);
        }
      }
    }
    ctx.putImageData(overlay, 0, 0);
  }

  // Issues detection — with fix callbacks for actionable issues
  const issues = [];
  if (islands.count === 0) {
    issues.push({ type: 'info', text: `Empty layer` });
  }
  if (islands.unsupportedCount > 0) {
    const unsLabels = Array.from(islands.unsupportedLabels);
    issues.push({
      type: 'error',
      text: `${islands.unsupportedCount} unsupported island${islands.unsupportedCount > 1 ? 's' : ''} — will float free`,
      fix: () => eraseLabelsFromLayer(idx, unsLabels, islands),
    });
  }
  if (islands.count > 1) {
    const tinyThreshold = totalPx * 0.0001; // < 0.01% of build area
    const tinyLabels = [];
    for (let c = 0; c < islands.sizes.length; c++) {
      if (islands.sizes[c] < tinyThreshold) tinyLabels.push(c + 1);
    }
    if (tinyLabels.length > 0) {
      issues.push({
        type: 'warn',
        text: `${tinyLabels.length} tiny region${tinyLabels.length > 1 ? 's' : ''} — may detach during peel`,
        fix: () => eraseLabelsFromLayer(idx, tinyLabels, islands),
      });
    }
    if (islands.count > 5) {
      issues.push({ type: 'info', text: `${islands.count} separate regions` });
    }
  }
  if (coverage > 60) {
    issues.push({ type: 'warn', text: `High coverage (${coverage.toFixed(0)}%) — peel force risk` });
  }
  // Check for large area change from previous layer
  if (idx > 0 && inspectorAreaData) {
    const prevWhite = inspectorAreaData[idx - 1];
    if (prevWhite > 0) {
      const change = ((whitePx - prevWhite) / prevWhite) * 100;
      if (change > 50) {
        issues.push({ type: 'warn', text: `Area jumped +${change.toFixed(0)}% from prev layer` });
      }
    }
  }

  renderIssues(issues, idx);
}

function renderIssues(issues, layerIdx) {
  if (issues.length === 0) {
    inspectorIssues.innerHTML = '<span class="inspector-no-issues">No issues detected</span>';
    return;
  }
  const icons = { warn: '⚠', error: '✖', info: 'ℹ' };
  inspectorIssues.innerHTML = issues.map((iss, i) => {
    const fixBtn = iss.fix
      ? `<button class="inspector-fix-btn" data-fix-idx="${i}">Fix</button>`
      : '';
    return `<div class="inspector-issue inspector-issue-${iss.type}">` +
      `<span class="inspector-issue-icon">${icons[iss.type] || ''}</span>` +
      `<span class="inspector-issue-text">${iss.text}</span>${fixBtn}</div>`;
  }).join('');

  // Wire up fix buttons
  inspectorIssues.querySelectorAll('.inspector-fix-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fixIdx = parseInt(btn.dataset.fixIdx, 10);
      const iss = issues[fixIdx];
      if (iss && iss.fix) {
        iss.fix();
        // Re-render the layer & re-detect issues
        renderInspectorLayer(layerIdx);
        drawAreaGraph(layerIdx);
      }
    });
  });
}

// --- Issue scanning across all layers ---

let _scanAbort = false;

function resetIssueScan() {
  inspectorIssueMap = null;
  inspectorIssueLayers = [];
  inspectorIssueNavIdx = -1;
  inspectorIssuePrev.disabled = true;
  inspectorIssueNext.disabled = true;
  inspectorIssuePos.textContent = '';
  inspectorScanStatus.textContent = '';
  _scanAbort = false;
}

async function scanAllLayersForIssues() {
  if (!slicedLayers || slicedLayers.length === 0) return;

  _scanAbort = false;
  inspectorScanAll.disabled = true;
  inspectorScanStatus.textContent = 'Scanning…';

  const spec = slicer.getPrinterSpec();
  const resX = spec.resolutionX;
  const resY = spec.resolutionY;
  const totalPx = resX * resY;
  const map = new Map();
  const chunkSize = 8; // layers per frame to stay responsive

  for (let start = 0; start < slicedLayers.length; start += chunkSize) {
    if (_scanAbort) break;
    const end = Math.min(start + chunkSize, slicedLayers.length);
    for (let idx = start; idx < end; idx++) {
      const pixels = slicedLayers[idx];
      const prevPixels = idx > 0 ? slicedLayers[idx - 1] : null;
      const islands = detectIslands(pixels, resX, resY, prevPixels);
      const whitePx = inspectorAreaData ? inspectorAreaData[idx] : countWhite(pixels);
      const coverage = (whitePx / totalPx) * 100;
      const layerIssues = [];

      if (islands.count === 0) {
        layerIssues.push({ type: 'info', text: 'Empty layer' });
      }
      if (islands.unsupportedCount > 0) {
        layerIssues.push({
          type: 'error',
          text: `${islands.unsupportedCount} unsupported island${islands.unsupportedCount > 1 ? 's' : ''}`,
          fixType: 'remove-unsupported',
        });
      }
      if (islands.count > 1) {
        const tinyThreshold = totalPx * 0.0001;
        const tinyLabels = [];
        for (let c = 0; c < islands.sizes.length; c++) {
          if (islands.sizes[c] < tinyThreshold) tinyLabels.push(c + 1);
        }
        if (tinyLabels.length > 0) {
          layerIssues.push({
            type: 'warn',
            text: `${tinyLabels.length} tiny region${tinyLabels.length > 1 ? 's' : ''}`,
            fixType: 'remove-tiny',
          });
        }
      }
      if (coverage > 60) {
        layerIssues.push({ type: 'warn', text: `High coverage (${coverage.toFixed(0)}%)` });
      }
      if (idx > 0 && inspectorAreaData) {
        const prevWhite = inspectorAreaData[idx - 1];
        if (prevWhite > 0) {
          const change = ((whitePx - prevWhite) / prevWhite) * 100;
          if (change > 50) {
            layerIssues.push({ type: 'warn', text: `Area jumped +${change.toFixed(0)}%` });
          }
        }
      }
      if (layerIssues.length > 0) map.set(idx, layerIssues);
    }
    inspectorScanStatus.textContent = `Scanning… ${end} / ${slicedLayers.length}`;
    // yield to browser
    await new Promise(r => requestAnimationFrame(r));
  }

  inspectorIssueMap = map;
  inspectorIssueLayers = Array.from(map.keys()).sort((a, b) => a - b);
  inspectorScanAll.disabled = false;

  if (inspectorIssueLayers.length === 0) {
    inspectorScanStatus.textContent = 'No issues found';
    inspectorIssuePrev.disabled = true;
    inspectorIssueNext.disabled = true;
    inspectorIssuePos.textContent = '';
  } else {
    inspectorScanStatus.textContent = `${inspectorIssueLayers.length} layer${inspectorIssueLayers.length > 1 ? 's' : ''} with issues`;
    inspectorIssuePrev.disabled = false;
    inspectorIssueNext.disabled = false;
    // Jump to the first issue layer from the current position
    navigateIssue(1);
  }

  // Mark issue layers on the area graph
  drawAreaGraph(parseInt(inspectorSlider.value, 10));
}

function navigateIssue(direction) {
  if (inspectorIssueLayers.length === 0) return;
  const cur = parseInt(inspectorSlider.value, 10);

  if (direction > 0) {
    // Find next issue layer after current
    const next = inspectorIssueLayers.find(l => l > cur);
    inspectorIssueNavIdx = next !== undefined
      ? inspectorIssueLayers.indexOf(next)
      : 0; // wrap to first
  } else {
    // Find previous issue layer before current
    let prev;
    for (let i = inspectorIssueLayers.length - 1; i >= 0; i--) {
      if (inspectorIssueLayers[i] < cur) { prev = i; break; }
    }
    inspectorIssueNavIdx = prev !== undefined
      ? prev
      : inspectorIssueLayers.length - 1; // wrap to last
  }

  const targetLayer = inspectorIssueLayers[inspectorIssueNavIdx];
  inspectorIssuePos.textContent = `${inspectorIssueNavIdx + 1}/${inspectorIssueLayers.length}`;
  inspectorGoToLayer(targetLayer);
}

// --- Fix functions: erase pixels matching certain labels ---

function eraseLabelsFromLayer(layerIdx, labelsToErase, islands) {
  if (!slicedLayers || !slicedLayers[layerIdx]) return;
  const spec = slicer.getPrinterSpec();
  const resX = spec.resolutionX;
  const resY = spec.resolutionY;
  const pixels = slicedLayers[layerIdx];
  const eraseSet = new Set(labelsToErase);

  for (let sy = 0; sy < islands.sh; sy++) {
    for (let sx = 0; sx < islands.sw; sx++) {
      const label = islands.labels[sy * islands.sw + sx];
      if (label > 0 && eraseSet.has(label)) {
        for (let dy = 0; dy < islands.scale && sy * islands.scale + dy < resY; dy++) {
          for (let dx = 0; dx < islands.scale && sx * islands.scale + dx < resX; dx++) {
            const ry = sy * islands.scale + dy;
            const rx = sx * islands.scale + dx;
            const pi = (ry * resX + rx) * 4;
            pixels[pi] = 0;
            pixels[pi + 1] = 0;
            pixels[pi + 2] = 0;
            pixels[pi + 3] = 255;
          }
        }
      }
    }
  }

  // Update cached area data
  if (inspectorAreaData) {
    inspectorAreaData[layerIdx] = countWhite(pixels);
  }
  // Invalidate scan results for this layer
  if (inspectorIssueMap && inspectorIssueMap.has(layerIdx)) {
    inspectorIssueMap.delete(layerIdx);
    inspectorIssueLayers = Array.from(inspectorIssueMap.keys()).sort((a, b) => a - b);
    if (inspectorIssueLayers.length === 0) {
      inspectorScanStatus.textContent = 'No issues found';
      inspectorIssuePrev.disabled = true;
      inspectorIssueNext.disabled = true;
      inspectorIssuePos.textContent = '';
    } else {
      inspectorScanStatus.textContent = `${inspectorIssueLayers.length} layer${inspectorIssueLayers.length > 1 ? 's' : ''} with issues`;
    }
  }
}

/** Build and cache per-layer area data, then draw the area graph.
 *  Data is normally pre-computed at slice time; the fallback loop only
 *  runs if somehow the cache is missing (e.g. loaded from file). */
function buildAreaGraph() {
  if (!slicedLayers || slicedLayers.length === 0) return;

  if (!inspectorAreaData || inspectorAreaData.length !== slicedLayers.length) {
    // Fallback — compute in async chunks so the UI stays responsive
    inspectorAreaData = new Float64Array(slicedLayers.length);
    let i = 0;
    const chunkSize = 64;
    const processChunk = () => {
      const end = Math.min(i + chunkSize, slicedLayers.length);
      for (; i < end; i++) {
        inspectorAreaData[i] = countWhite(slicedLayers[i]);
      }
      drawAreaGraph(parseInt(inspectorSlider.value, 10));
      if (i < slicedLayers.length) {
        requestAnimationFrame(processChunk);
      }
    };
    requestAnimationFrame(processChunk);
    return;
  }

  drawAreaGraph();
}

function drawAreaGraph(highlightIdx) {
  if (!inspectorAreaData) return;
  const canvas = inspectorGraph;
  const w = canvas.clientWidth * (window.devicePixelRatio || 1);
  const h = canvas.clientHeight * (window.devicePixelRatio || 1);
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const max = inspectorAreaData.reduce((a, b) => Math.max(a, b), 1);
  const len = inspectorAreaData.length;
  const barW = w / len;

  // Draw bars
  ctx.fillStyle = 'rgba(0, 112, 243, 0.35)';
  for (let i = 0; i < len; i++) {
    const barH = (inspectorAreaData[i] / max) * (h - 4);
    ctx.fillRect(i * barW, h - barH, Math.max(barW - 0.5, 0.5), barH);
  }

  // Draw issue markers on the graph
  if (inspectorIssueLayers && inspectorIssueLayers.length > 0) {
    for (const li of inspectorIssueLayers) {
      const issues = inspectorIssueMap.get(li);
      const hasError = issues && issues.some(i => i.type === 'error');
      ctx.fillStyle = hasError ? 'rgba(239, 100, 100, 0.7)' : 'rgba(255, 183, 77, 0.55)';
      const x = li * barW;
      ctx.fillRect(x, 0, Math.max(barW, 1.5), h);
    }
  }

  // Highlight current layer
  if (highlightIdx !== undefined && highlightIdx >= 0 && highlightIdx < len) {
    ctx.fillStyle = 'rgba(0, 112, 243, 0.9)';
    const barH = (inspectorAreaData[highlightIdx] / max) * (h - 4);
    ctx.fillRect(highlightIdx * barW, h - barH, Math.max(barW, 1.5), barH);
  }
}

function inspectorGoToLayer(idx) {
  if (!slicedLayers) return;
  idx = Math.max(0, Math.min(idx, slicedLayers.length - 1));
  inspectorSlider.value = idx;
  inspectorLayerInfo.textContent = `${idx + 1} / ${slicedLayers.length}`;
  inspectorGoto.value = idx + 1;
  renderInspectorLayer(idx);
  drawAreaGraph(idx);
}

function openLayerInspector() {
  if (!slicedLayers || slicedLayers.length === 0) return;

  // Show modal instantly — don't block on rendering
  inspectorModal.hidden = false;
  inspectorSlider.max = slicedLayers.length - 1;
  inspectorGoto.max = slicedLayers.length;

  const idx = parseInt(layerSlider.value, 10) || 0;
  inspectorSlider.value = idx;
  inspectorLayerInfo.textContent = `${idx + 1} / ${slicedLayers.length}`;
  inspectorGoto.value = idx + 1;

  // Defer heavy work so the modal paints first
  requestAnimationFrame(() => {
    buildAreaGraph();
    renderInspectorLayer(idx);
    drawAreaGraph(idx);
  });
}

function closeLayerInspector() {
  inspectorModal.hidden = true;
  _scanAbort = true; // stop any running scan
  // Sync back to small slider
  if (slicedLayers) {
    layerSlider.value = inspectorSlider.value;
    showLayer();
  }
}

// Inspector event wiring
listen(layerExpandBtn, 'click', openLayerInspector);
listen(inspectorClose, 'click', closeLayerInspector);
listen(inspectorSlider, 'input', () => {
  inspectorGoToLayer(parseInt(inspectorSlider.value, 10));
});
listen(inspectorPrev, 'click', () => {
  inspectorGoToLayer(parseInt(inspectorSlider.value, 10) - 1);
});
listen(inspectorNext, 'click', () => {
  inspectorGoToLayer(parseInt(inspectorSlider.value, 10) + 1);
});
listen(inspectorGoto, 'change', () => {
  inspectorGoToLayer(parseInt(inspectorGoto.value, 10) - 1);
});

// Analysis toggles re-render
listen(inspectorHighlightIslands, 'change', () => renderInspectorLayer(parseInt(inspectorSlider.value, 10)));
listen(inspectorShowOutline, 'change', () => renderInspectorLayer(parseInt(inspectorSlider.value, 10)));
listen(inspectorDiffMode, 'change', () => renderInspectorLayer(parseInt(inspectorSlider.value, 10)));

// Issue scan & navigation
listen(inspectorScanAll, 'click', scanAllLayersForIssues);
listen(inspectorIssuePrev, 'click', () => navigateIssue(-1));
listen(inspectorIssueNext, 'click', () => navigateIssue(1));

// Click on graph to jump to layer
listen(inspectorGraph, 'click', (e) => {
  if (!slicedLayers) return;
  const rect = inspectorGraph.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const ratio = x / rect.width;
  const idx = Math.floor(ratio * slicedLayers.length);
  inspectorGoToLayer(idx);
});

// Keyboard nav inside inspector
document.addEventListener('keydown', (e) => {
  if (!inspectorModal || inspectorModal.hidden) return;

  if (e.key === 'Escape') {
    closeLayerInspector();
    e.preventDefault();
    return;
  }

  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    if (e.shiftKey && inspectorIssueLayers.length > 0) {
      // Shift+Arrow: jump to prev/next issue layer
      navigateIssue(e.key === 'ArrowRight' ? 1 : -1);
    } else {
      const cur = parseInt(inspectorSlider.value, 10);
      inspectorGoToLayer(e.key === 'ArrowRight' ? cur + 1 : cur - 1);
    }
    return;
  }

  // Page up/down for jumping 10 layers
  if (e.key === 'PageUp' || e.key === 'PageDown') {
    e.preventDefault();
    const cur = parseInt(inspectorSlider.value, 10);
    inspectorGoToLayer(e.key === 'PageDown' ? cur + 10 : cur - 10);
    return;
  }

  // Home/End for first/last layer
  if (e.key === 'Home') { e.preventDefault(); inspectorGoToLayer(0); return; }
  if (e.key === 'End') { e.preventDefault(); inspectorGoToLayer(slicedLayers.length - 1); return; }
});

// Also allow double-click on small layer canvas to open inspector
listen(layerCanvas, 'dblclick', openLayerInspector);

// --- Export ---
function meshExportItems() {
  const disabled = !viewer || viewer.objects.length === 0;
  return [
    { action: 'mesh-stl', label: 'Export STL', disabled },
    { action: 'mesh-3mf', label: 'Export 3MF', disabled },
    { action: 'mesh-obj', label: 'Export OBJ', disabled },
  ];
}

function openMeshExportMenu(clientX, clientY) {
  showContextMenu(clientX, clientY, {
    title: 'Export plate mesh',
    context: { type: 'mesh-export' },
    items: meshExportItems(),
  });
}

function openExportMenu(clientX, clientY) {
  showContextMenu(clientX, clientY, {
    title: 'Export',
    context: { type: 'export' },
    items: [
      { action: 'export-zip', label: 'Export print package', disabled: !slicedLayers },
      { action: 'export-all-zip', label: 'Export all sliced plates', disabled: !project.plates.some(plate => plate.slicedLayers) },
      ...meshExportItems(),
    ],
  });
}

function handleMenuAction(action) {
  const context = activeMenuContext;
  hideContextMenu();

  if (action === 'export-zip') {
    handleExport();
    return;
  }
  if (action === 'export-all-zip') {
    handleExportAll();
    return;
  }
  if (action?.startsWith('mesh-')) {
    handleMeshExport(action.replace('mesh-', ''));
    return;
  }

  if (context?.type === 'plate') {
    const plate = project.plates.find(p => p.id === context.plateId);
    if (!plate) return;
    if (action === 'plate-rename') {
      renamePlate(plate);
    } else if (action === 'plate-duplicate') {
      duplicatePlate(plate);
    } else if (action === 'plate-delete') {
      deletePlate(plate);
    }
  }
}

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

function showContextMenu(clientX, clientY, { title = 'Actions', items = [], context = null } = {}) {
  if (!contextMenu) return;
  activeMenuContext = context;
  contextMenu.innerHTML = `<div class="context-menu-label">${escapeHtml(title)}</div>` +
    items.map(item => (
      `<button type="button" class="context-menu-item${item.danger ? ' danger' : ''}" ` +
      `data-menu-action="${escapeHtml(item.action)}"${item.disabled ? ' disabled' : ''}>` +
      `${escapeHtml(item.label)}</button>`
    )).join('');
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
  activeMenuContext = null;
}

// --- Start ---
init().catch(error => {
  console.error('Failed to initialize SliceLab:', error);
});
