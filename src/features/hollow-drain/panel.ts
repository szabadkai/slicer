/**
 * Hollow & Drain panel — shell hollowing, drain hole placement,
 * resin trap analysis, and model splitting.
 */
/* eslint-disable no-restricted-imports */
import * as THREE from 'three';
import type { AppContext } from '@core/types';
import { listen } from '@features/app-shell/utils';
import { hollowMesh, estimateWallThickness, checkThinWalls } from './hollower';
import { addDrainHole, removeDrainHole, autoPlaceHoles } from './drain';
import { createDrainPlugFromGeometry, cutDrainHoleFromGeometry } from './drain-cut';
import { detectTraps } from './trap-detector';
import { splitMesh } from './splitter';
import type { DrainHole, DrainPlug } from './drain';

// Runtime casts for viewer internals — viewer.js exposes these at runtime
// but LegacyViewer types them as `unknown` to avoid pulling THREE into the type graph.
function getScene(viewer: AppContext['viewer']): THREE.Scene {
  return (viewer as unknown as { scene: THREE.Scene }).scene;
}

function getMesh(viewer: AppContext['viewer']): THREE.Mesh | null {
  const sel = viewer.selected[0];
  if (!sel) return null;
  return sel.mesh as unknown as THREE.Mesh;
}

function getGeometry(viewer: AppContext['viewer']): THREE.BufferGeometry | null {
  const mesh = getMesh(viewer);
  return mesh ? mesh.geometry.clone() : null;
}

function setMeshGeometry(viewer: AppContext['viewer'], geo: THREE.BufferGeometry): void {
  const sel = viewer.selected[0];
  if (!sel) return;
  const mesh = sel.mesh as unknown as THREE.Mesh;
  mesh.geometry.dispose();
  mesh.geometry = geo;
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeVertexNormals();
  mesh.updateMatrixWorld(true);
}

function addModel(viewer: AppContext['viewer'], geo: THREE.BufferGeometry): { id: string } | null {
  // viewer.js exposes addModel() at runtime even though LegacyViewer types don't declare it here.
  // The method exists — cast through unknown.
  return (viewer as unknown as { addModel(geo: unknown, elevation?: number): { id: string } }).addModel(geo, 5);
}

function addWorldModel(viewer: AppContext['viewer'], geo: THREE.BufferGeometry): { id: string } | null {
  const raw = viewer as unknown as {
    _addModelRaw(geometry: THREE.BufferGeometry, material: THREE.Material | null, elevation: number): { id: string };
    selectObject(id: string): void;
    canvas: HTMLCanvasElement;
  };
  const obj = raw._addModelRaw(geo, null, 5);
  raw.selectObject(obj.id);
  raw.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  return obj;
}

export function mountHollowDrainPanel(ctx: AppContext): void {
  const { viewer } = ctx;

  // ─── Element refs ────────────────────────────────────────────────
  // Shell step
  const thicknessSlider = document.getElementById('hollow-thickness') as HTMLInputElement | null;
  const thicknessVal    = document.getElementById('hollow-thickness-val');
  const xsectionToggle  = document.getElementById('hollow-xsection') as HTMLInputElement | null;
  const thinWarning     = document.getElementById('hollow-thin-warning');
  const applyBtn        = document.getElementById('hollow-apply-btn');
  const clearBtn        = document.getElementById('hollow-clear-btn');
  const shellBadge      = document.getElementById('hollow-shell-badge');

  // Drain step
  const drainDiamSlider = document.getElementById('drain-diameter') as HTMLInputElement | null;
  const drainDiamVal    = document.getElementById('drain-diameter-val');
  const pickBtn         = document.getElementById('drain-pick-btn');
  const drainClearBtn   = document.getElementById('drain-clear-btn');
  const drainAutoBtn    = document.getElementById('drain-auto-btn');
  const drainHoleList   = document.getElementById('drain-hole-list');
  const drainBadge      = document.getElementById('hollow-drain-badge');
  const plugCheckbox    = document.getElementById('drain-generate-plugs') as HTMLInputElement | null;

  // Trap step
  const trapResults     = document.getElementById('trap-results');
  const trapAnalyzeBtn  = document.getElementById('trap-analyze-btn');
  const trapBadge       = document.getElementById('hollow-trap-badge');

  // Split step
  const splitAxis       = document.getElementById('split-axis') as HTMLSelectElement | null;
  const splitPos        = document.getElementById('split-position') as HTMLInputElement | null;
  const splitPosVal     = document.getElementById('split-position-val');
  const splitConnector  = document.getElementById('split-connector') as HTMLSelectElement | null;
  const splitPinOptions = document.getElementById('split-pin-options');
  const splitPinDiam    = document.getElementById('split-pin-diameter') as HTMLInputElement | null;
  const splitPinCount   = document.getElementById('split-pin-count') as HTMLInputElement | null;
  const splitPreview    = document.getElementById('split-preview') as HTMLInputElement | null;
  const splitApplyBtn   = document.getElementById('split-apply-btn');
  const splitBadge      = document.getElementById('hollow-split-badge');

  // ─── Panel state ─────────────────────────────────────────────────
  let drainHoles: DrainHole[] = [];
  let drainPicks: DrainPlug[] = [];
  let drainPlugObjectIds: string[] = [];
  let pickModeActive = false;
  let pickCursorMesh: THREE.Mesh | null = null;
  let splitPlaneMesh: THREE.Mesh | null = null;
  let wallThickness = 2.0;
  let isHollowed = false;

  // Pristine original geometry (before any hollow or drain), keyed by object id
  const originalGeoMap = new Map<string, THREE.BufferGeometry>();
  const drainBaseGeoMap = new Map<string, THREE.BufferGeometry>();

  // ─── Shell step ──────────────────────────────────────────────────
  listen(thicknessSlider, 'input', () => {
    if (thicknessVal && thicknessSlider) thicknessVal.textContent = parseFloat(thicknessSlider.value).toFixed(1);
  });

  listen(xsectionToggle, 'change', () => {
    toggleCrossSection(xsectionToggle?.checked ?? false);
  });

  listen(applyBtn, 'click', () => { applyHollow(); });
  listen(clearBtn, 'click', () => { clearHollow(); });

  async function applyHollow(): Promise<void> {
    if (!viewer.selected[0]) return;
    const sel = viewer.selected[0];

    wallThickness = parseFloat(thicknessSlider?.value ?? '2');

    // Back up pristine original geometry (before ANY operations)
    if (!originalGeoMap.has(sel.id)) {
      const geo = getGeometry(viewer);
      if (!geo) return;
      originalGeoMap.set(sel.id, geo);
    }

    isHollowed = true;
    clearDrainSceneArtifacts({ restoreGeometry: false });
    clearViewerMarkers();

    ctx.showProgress('Hollowing model…');
    await yieldThread();

    try {
      // Rebuild entire pipeline: original → drain cuts → hollow
      await rebuildGeometry();

      // Thin-wall check
      const origGeo = originalGeoMap.get(sel.id);
      if (!origGeo) return;
      const warn = checkThinWalls(origGeo, wallThickness);
      if (thinWarning) thinWarning.hidden = !warn.hasThinWalls;

      // Badge
      if (shellBadge) { shellBadge.textContent = '✓'; shellBadge.className = 'step-badge step-badge-done'; }

      // Auto-open drain step
      const drainStep = document.getElementById('hollow-step-drain');
      if (drainStep) (drainStep as HTMLDetailsElement).open = true;
    } finally {
      ctx.hideProgress();
    }
  }

  function clearHollow(): void {
    if (!viewer.selected[0]) return;
    const sel = viewer.selected[0];
    const orig = originalGeoMap.get(sel.id);
    if (orig) {
      setMeshGeometry(viewer, orig.clone());
      originalGeoMap.delete(sel.id);
      drainBaseGeoMap.delete(sel.id);
    }
    // Restore material to its preset (undo hollow-specific overrides)
    const mesh = getMesh(viewer);
    if (mesh) {
      const preset = ((sel as unknown as { materialPreset?: Record<string, unknown> }).materialPreset ?? {}) as Record<string, unknown>;
      const t = (preset.transmission as number) ?? 0;
      const mat = mesh.material as THREE.MeshPhysicalMaterial;
      mat.transmission = t;
      mat.thickness = t > 0 ? 0.8 : 0;
      mat.needsUpdate = true;
    }
    if (thinWarning) thinWarning.hidden = true;
    if (shellBadge) { shellBadge.textContent = ''; shellBadge.className = 'step-badge'; }
    clearAllDrainHoles();
    isHollowed = false;
    // Clear cross-section if active
    if (xsectionToggle?.checked) {
      xsectionToggle.checked = false;
      toggleCrossSection(false);
    }
    viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    ctx.updateEstimate();
    ctx.scheduleProjectAutosave();
  }

  function toggleCrossSection(enabled: boolean): void {
    const renderer = (viewer as unknown as { renderer: THREE.WebGLRenderer }).renderer;
    if (enabled) {
      const mesh = getMesh(viewer);
      if (!mesh) return;
      const bb = new THREE.Box3().setFromObject(mesh);
      const center = new THREE.Vector3();
      bb.getCenter(center);
      // Clip from above at the midpoint — reveals interior cross-section
      const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), center.y);
      renderer.clippingPlanes = [plane];
    } else {
      renderer.clippingPlanes = [];
    }
    viewer.requestRender();
  }

  // ─── Drain step ──────────────────────────────────────────────────
  listen(drainDiamSlider, 'input', () => {
    if (drainDiamVal && drainDiamSlider) drainDiamVal.textContent = parseFloat(drainDiamSlider.value).toFixed(1);
  });

  function clearPickCursor(): void {
    if (pickCursorMesh) {
      getScene(viewer).remove(pickCursorMesh);
      pickCursorMesh = null;
      viewer.requestRender();
    }
  }

  function setPickMode(active: boolean): void {
    pickModeActive = active;
    pickBtn?.classList.toggle('active', pickModeActive);
    if (!pickModeActive) clearPickCursor();
  }

  listen(pickBtn, 'click', () => {
    setPickMode(!pickModeActive);
  });

  // Listen for drain-hole-placed events (dispatched by viewer in pick mode)
  listen(viewer.canvas, 'drain-hole-placed', async (event: Event) => {
    const detail = (event as CustomEvent<{ position: THREE.Vector3; normal: THREE.Vector3 }>).detail;
    const diameter = parseFloat(drainDiamSlider?.value ?? '3');
    const hole = addDrainHole(getScene(viewer), detail.position, detail.normal, diameter, wallThickness);
    drainHoles.push(hole);
    setPickMode(false);
    const didCut = await rebuildDrainCuts();
    if (!didCut) {
      drainHoles.pop();
      removeDrainHole(getScene(viewer), hole);
      alert('The drain hole could not be cut as a closed manifold. Try a flatter surface or a larger diameter.');
    }
    renderDrainList();
    viewer.requestRender();
  });

  listen(drainAutoBtn, 'click', () => { handleAutoPlace(); });
  listen(drainClearBtn, 'click', () => { clearAllDrainHoles(); });

  async function handleAutoPlace(): Promise<void> {
    if (!viewer.selected[0]) return;
    const geo = getGeometry(viewer);
    if (!geo) return;
    const mesh = getMesh(viewer);
    if (!mesh) return;

    const diameter = parseFloat(drainDiamSlider?.value ?? '3');
    ctx.showProgress('Placing drain holes…');
    await yieldThread();
    try {
      const placed = autoPlaceHoles(geo, mesh, getScene(viewer), {
        count: 2, diameter, wallThickness,
      });
      drainHoles.push(...placed);
      const didCut = await rebuildDrainCuts();
      if (!didCut) {
        for (const hole of placed) removeDrainHole(getScene(viewer), hole);
        drainHoles.splice(drainHoles.length - placed.length, placed.length);
        alert('The auto-placed drain holes could not be cut as closed manifold holes.');
        return;
      }
      renderDrainList();
      viewer.requestRender();

      // If generate-plugs is checked, create plug objects
      if (plugCheckbox?.checked) {
        const targetId = viewer.selected[0]?.id;
        const plugs: DrainPlug[] = [];
        for (const hole of placed) {
          const plug = await createPlugForHole(hole);
          if (plug) plugs.push(plug);
        }
        for (const plug of plugs) {
          drainPicks.push(plug);
          const obj = addWorldModel(viewer, plug.geometry);
          if (obj) drainPlugObjectIds.push(obj.id);
        }
        if (targetId) viewer.selectObject(targetId);
      }
    } finally {
      ctx.hideProgress();
    }
  }

  function clearAllDrainHoles(): void {
    clearDrainSceneArtifacts({ restoreGeometry: true });
    renderDrainList();
    viewer.requestRender();
  }

  function renderDrainList(): void {
    if (!drainHoleList) return;
    const count = drainHoles.length;
    if (drainBadge) {
      drainBadge.textContent = count > 0 ? String(count) : '';
      drainBadge.className = count > 0 ? 'step-badge step-badge-count' : 'step-badge';
    }
    if (count === 0) {
      drainHoleList.innerHTML = '<p class="hollow-hint">No holes placed yet.</p>';
      return;
    }
    drainHoleList.innerHTML = drainHoles.map((h, i) => `
      <div class="drain-hole-row" data-id="${h.id}">
        <span class="drain-hole-icon">●</span>
        <span class="drain-hole-label">Hole ${i + 1} — ⌀${h.diameter.toFixed(1)} mm</span>
        <button class="drain-hole-remove icon-btn" data-id="${h.id}" aria-label="Remove hole">✕</button>
      </div>
    `).join('');

    drainHoleList.querySelectorAll('.drain-hole-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id;
        const idx = drainHoles.findIndex((h) => h.id === id);
        if (idx >= 0) {
          removeDrainHole(getScene(viewer), drainHoles[idx]);
          drainHoles.splice(idx, 1);
          void rebuildDrainCuts();
          renderDrainList();
          viewer.requestRender();
        }
      });
    });
  }

  // ─── Trap analysis ───────────────────────────────────────────────
  listen(trapAnalyzeBtn, 'click', () => { runTrapAnalysis(); });

  async function runTrapAnalysis(): Promise<void> {
    if (!viewer.selected[0]) return;
    const geo = getGeometry(viewer);
    if (!geo) return;
    const mesh = getMesh(viewer);
    if (!mesh) return;
    if (!trapResults) return;

    ctx.showProgress('Analyzing resin traps…');
    await yieldThread();

    try {
      const result = detectTraps(geo, mesh, drainHoles, {
        voxelSizeMM: 2.0,
        onProgress: (f) => ctx.updateProgress(f, 'Flood filling…'),
      });

      const drainableML = (result.drainableVolumeMM3 / 1000).toFixed(1);
      const trappedML = (result.trappedVolumeMM3 / 1000).toFixed(1);
      const hasTraps = result.pockets.length > 0;

      if (trapBadge) {
        trapBadge.textContent = hasTraps ? `⚠ ${result.pockets.length}` : '✓';
        trapBadge.className = hasTraps ? 'step-badge step-badge-warn' : 'step-badge step-badge-done';
      }

      trapResults.innerHTML = `
        <div class="trap-stat trap-stat-ok">🟢 Drainable: ${drainableML} mL</div>
        <div class="trap-stat trap-stat-bad">🔴 Trapped: ${trappedML} mL</div>
        ${result.pockets.map((p, i) => `
          <div class="trap-pocket">
            <span>Pocket ${i + 1} — ${(p.volumeMM3 / 1000).toFixed(2)} mL</span>
            <button class="btn btn-small trap-add-hole-btn" data-pocket="${i}">+ Add hole here</button>
          </div>
        `).join('')}
        ${!hasTraps ? '<div class="trap-ok">✅ All interior volume is drainable.</div>' : ''}
      `;

      // Wire "Add hole here" buttons
      trapResults.querySelectorAll('.trap-add-hole-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const i = parseInt((btn as HTMLElement).dataset.pocket ?? '0', 10);
          const pocket = result.pockets[i];
          if (!pocket) return;
          const hole = addDrainHole(
            getScene(viewer),
            pocket.suggestedHolePos,
            pocket.suggestedHoleNormal,
            parseFloat(drainDiamSlider?.value ?? '3'),
            wallThickness,
          );
          drainHoles.push(hole);
          void rebuildDrainCuts();
          renderDrainList();
          viewer.requestRender();
        });
      });

    } finally {
      ctx.hideProgress();
    }
  }

  // ─── Split step ──────────────────────────────────────────────────
  listen(splitPos, 'input', () => {
    if (splitPosVal && splitPos) splitPosVal.textContent = splitPos.value + '%';
    if (splitPreview?.checked) updateSplitPreview();
  });

  listen(splitConnector, 'change', () => {
    const usePins = splitConnector?.value === 'pins';
    if (splitPinOptions) {
      splitPinOptions.style.opacity = usePins ? '1' : '0.5';
      splitPinOptions.style.pointerEvents = usePins ? 'auto' : 'none';
    }
    if (splitPinDiam) splitPinDiam.disabled = !usePins;
    if (splitPinCount) splitPinCount.disabled = !usePins;
  });

  listen(splitPreview, 'change', () => {
    if (splitPreview?.checked) updateSplitPreview();
    else clearSplitPreview();
  });

  listen(splitApplyBtn, 'click', () => { applySplit(); });

  function getSplitPositionMM(): number {
    const mesh = getMesh(viewer);
    if (!mesh) return 0;
    const bb = new THREE.Box3().setFromObject(mesh);
    const axis = (splitAxis?.value ?? 'z') as 'x' | 'y' | 'z';
    const pct = parseFloat(splitPos?.value ?? '50') / 100;
    return bb.min[axis] + (bb.max[axis] - bb.min[axis]) * pct;
  }

  function updateSplitPreview(): void {
    clearSplitPreview();
    const mesh = getMesh(viewer);
    if (!mesh) return;
    const bb = new THREE.Box3().setFromObject(mesh);
    const axis = (splitAxis?.value ?? 'z') as 'x' | 'y' | 'z';
    const positionMM = getSplitPositionMM();

    // Build a large semi-transparent plane quad at the split position
    const size = new THREE.Vector3(); bb.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) * 1.5;
    const planeGeo = new THREE.PlaneGeometry(maxDim, maxDim);

    // Orient the plane to the correct axis
    if (axis === 'x') planeGeo.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    else if (axis === 'z') planeGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));

    const center = new THREE.Vector3(
      (bb.min.x + bb.max.x) / 2,
      (bb.min.y + bb.max.y) / 2,
      (bb.min.z + bb.max.z) / 2,
    );
    center[axis] = positionMM;

    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x0070f3, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false,
    });
    splitPlaneMesh = new THREE.Mesh(planeGeo, planeMat);
    splitPlaneMesh.position.copy(center);
    getScene(viewer).add(splitPlaneMesh);
    viewer.requestRender();
  }

  function clearSplitPreview(): void {
    if (splitPlaneMesh) {
      getScene(viewer).remove(splitPlaneMesh);
      splitPlaneMesh.geometry.dispose();
      splitPlaneMesh = null;
      viewer.requestRender();
    }
  }

  async function applySplit(): Promise<void> {
    if (!viewer.selected[0]) return;
    const geo = getGeometry(viewer);
    if (!geo) return;

    const axis = (splitAxis?.value ?? 'z') as 'x' | 'y' | 'z';
    const positionMM = getSplitPositionMM();
    const usePins = splitConnector?.value === 'pins';
    const pinCount = parseInt(splitPinCount?.value ?? '2', 10);
    const pinDiam = parseFloat(splitPinDiam?.value ?? '3');

    ctx.showProgress('Splitting model…');
    await yieldThread();

    try {
      const result = splitMesh(geo, axis, positionMM, usePins, pinCount, pinDiam);

      // Remove original object
      viewer.removeSelected();

      // Add two new objects
      addModel(viewer, result.part1);
      addModel(viewer, result.part2);

      clearSplitPreview();

      if (splitBadge) { splitBadge.textContent = '✓'; splitBadge.className = 'step-badge step-badge-done'; }

      viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
      ctx.updateEstimate();
      ctx.scheduleProjectAutosave();
    } finally {
      ctx.hideProgress();
    }
  }

  // ─── Pick mode: mousemove + click on viewport ───────────────────
  function onCanvasMouseMove(e: MouseEvent): void {
    if (!pickModeActive) return;
    const mesh = getMesh(viewer);
    if (!mesh) return;

    const rect = viewer.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );

    const ray = new THREE.Raycaster();
    const camera = (viewer as unknown as { camera: THREE.Camera }).camera;
    if (!camera) return;
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObject(mesh);
    if (hits.length > 0) {
      const hit = hits[0];
      if (!pickCursorMesh) {
        const cursorGeo = new THREE.RingGeometry(
          parseFloat(drainDiamSlider?.value ?? '3') / 2 * 0.6,
          parseFloat(drainDiamSlider?.value ?? '3') / 2,
          24,
        );
        const cursorMat = new THREE.MeshBasicMaterial({
          color: 0x00e5ff, side: THREE.DoubleSide, depthWrite: false, transparent: true, opacity: 0.8,
        });
        pickCursorMesh = new THREE.Mesh(cursorGeo, cursorMat);
        pickCursorMesh.renderOrder = 20;
        getScene(viewer).add(pickCursorMesh);
      }
      pickCursorMesh.position.copy(hit.point);
      if (!hit.face) return;
      const norm = hit.face.normal.clone().transformDirection(mesh.matrixWorld).normalize();
      pickCursorMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), norm);
      viewer.requestRender();
    }
  }

  async function onCanvasClick(e: MouseEvent): Promise<void> {
    if (!pickModeActive) return;
    const mesh = getMesh(viewer);
    if (!mesh) return;

    const rect = viewer.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );

    const ray = new THREE.Raycaster();
    const camera = (viewer as unknown as { camera: THREE.Camera }).camera;
    if (!camera) return;
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObject(mesh);
    if (hits.length > 0) {
      const hit = hits[0];
      if (!hit.face) return;
      const norm = hit.face.normal.clone().transformDirection(mesh.matrixWorld).normalize();
      const diameter = parseFloat(drainDiamSlider?.value ?? '3');
      const targetId = viewer.selected[0]?.id;
      const hole = addDrainHole(getScene(viewer), hit.point, norm, diameter, wallThickness);
      drainHoles.push(hole);
      setPickMode(false);
      const didCut = await rebuildDrainCuts();
      if (!didCut) {
        drainHoles = drainHoles.filter((h) => h !== hole);
        removeDrainHole(getScene(viewer), hole);
        renderDrainList();
        alert('The drain hole could not be cut as a closed manifold. Try a flatter surface or a larger diameter.');
        return;
      }

      if (plugCheckbox?.checked) {
        const plug = await createPlugForHole(hole);
        if (plug) {
          drainPicks.push(plug);
          const obj = addWorldModel(viewer, plug.geometry);
          if (obj) drainPlugObjectIds.push(obj.id);
          if (targetId) viewer.selectObject(targetId);
        }
      }

      renderDrainList();
      viewer.requestRender();
    }
  }

  listen(viewer.canvas, 'mousemove', onCanvasMouseMove as EventListener);
  listen(viewer.canvas, 'click', (event: Event) => {
    void onCanvasClick(event as MouseEvent);
  });

  // ─── Selection change: populate smart defaults ───────────────────
  listen(viewer.canvas, 'selection-changed', () => {
    const hasSel = viewer.selected.length > 0;
    // Disable buttons when nothing selected
    const controlBtns = [applyBtn, clearBtn, pickBtn, drainAutoBtn, drainClearBtn, trapAnalyzeBtn, splitApplyBtn];
    for (const btn of controlBtns) {
      if (btn instanceof HTMLButtonElement) btn.disabled = !hasSel;
    }
    if (hasSel) {
      // Suggest smart wall thickness
      const geo = getGeometry(viewer);
      if (geo && thicknessSlider) {
        const suggested = estimateWallThickness(geo);
        thicknessSlider.value = String(suggested);
        if (thicknessVal) thicknessVal.textContent = suggested.toFixed(1);
      }
    }
  });

  // Suppress unused variable warning for drainPicks (used for future export)
  void drainPicks;

  function clearDrainSceneArtifacts(options: { restoreGeometry: boolean }): void {
    setPickMode(false);
    for (const h of drainHoles) removeDrainHole(getScene(viewer), h);
    drainHoles = [];
    for (const id of drainPlugObjectIds) removeSceneObjectById(id);
    drainPlugObjectIds = [];
    drainPicks = [];
    if (options.restoreGeometry) restoreDrainBaseGeometry();
  }

  function clearViewerMarkers(): void {
    (viewer as unknown as { clearSignificantFaceMarkers?: () => void }).clearSignificantFaceMarkers?.();
  }

  function removeSceneObjectById(id: string): void {
    const legacy = viewer as unknown as {
      objects: Array<{ id: string; mesh: THREE.Mesh; supportsMesh?: THREE.Mesh | null }>;
      activePlate: { objects: Array<{ id: string }> };
      scene: THREE.Scene;
      selected: Array<{ id: string }>;
      transformControl: { detach(): void };
      canvas: HTMLCanvasElement;
    };
    const obj = legacy.objects.find((item) => item.id === id);
    if (!obj) return;
    legacy.scene.remove(obj.mesh);
    obj.mesh.geometry.dispose();
    disposeMaterial(obj.mesh.material);
    if (obj.supportsMesh) {
      legacy.scene.remove(obj.supportsMesh);
      obj.supportsMesh.geometry.dispose();
      disposeMaterial(obj.supportsMesh.material);
    }
    legacy.objects = legacy.objects.filter((item) => item.id !== id);
    legacy.activePlate.objects = legacy.activePlate.objects.filter((item) => item.id !== id);
    legacy.selected = legacy.selected.filter((item) => item.id !== id);
    legacy.transformControl.detach();
    legacy.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    legacy.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
    if (Array.isArray(material)) {
      for (const item of material) item.dispose();
    } else {
      material.dispose();
    }
  }

  function ensureDrainBaseGeometry(): THREE.BufferGeometry | null {
    const sel = viewer.selected[0];
    if (!sel) return null;
    let base = drainBaseGeoMap.get(sel.id);
    if (!base) {
      base = (sel.mesh as unknown as THREE.Mesh).geometry.clone();
      drainBaseGeoMap.set(sel.id, base);
    }
    return base;
  }

  function restoreDrainBaseGeometry(): void {
    const sel = viewer.selected[0];
    if (!sel) return;
    const base = drainBaseGeoMap.get(sel.id);
    if (!base) return;
    setMeshGeometry(viewer, base.clone());
    viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    ctx.updateEstimate();
    ctx.scheduleProjectAutosave();
  }

  async function createPlugForHole(hole: DrainHole): Promise<DrainPlug | null> {
    const sel = viewer.selected[0];
    if (!sel) return null;
    const mesh = sel.mesh as unknown as THREE.Mesh;
    const base = ensureDrainBaseGeometry();
    if (!base) return null;
    mesh.updateMatrixWorld(true);
    const worldBase = base.clone().applyMatrix4(mesh.matrixWorld);
    const geometry = await createDrainPlugFromGeometry(worldBase, {
      position: hole.position,
      normal: hole.normal,
      diameter: hole.diameter,
      wallThickness,
    });
    worldBase.dispose();
    if (!geometry) return null;
    return {
      holeId: hole.id,
      geometry,
      diameter: hole.diameter - 0.16,
      height: hole.depth,
    };
  }

  async function rebuildGeometry(): Promise<boolean> {
    const sel = viewer.selected[0];
    if (!sel) return false;
    const original = originalGeoMap.get(sel.id);
    if (!original) return false;

    if (!isHollowed) {
      drainBaseGeoMap.delete(sel.id);
      setMeshGeometry(viewer, original.clone());
      return true;
    }

    const result = hollowMesh(original.clone(), wallThickness);
    drainBaseGeoMap.set(sel.id, result.hollowGeo.clone());
    setMeshGeometry(viewer, result.hollowGeo);
    if (drainHoles.length > 0) return rebuildDrainCuts();

    viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    ctx.updateEstimate();
    ctx.scheduleProjectAutosave();
    return true;
  }

  async function rebuildDrainCuts(): Promise<boolean> {
    const sel = viewer.selected[0];
    if (!sel) return false;
    const mesh = sel.mesh as unknown as THREE.Mesh;
    const base = ensureDrainBaseGeometry();
    if (!base) return false;
    mesh.updateMatrixWorld(true);
    let next = base.clone().applyMatrix4(mesh.matrixWorld);
    const inverseWorld = mesh.matrixWorld.clone().invert();

    for (const hole of drainHoles) {
      const cut = await cutDrainHoleFromGeometry(next, {
        position: hole.position,
        normal: hole.normal,
        diameter: hole.diameter,
        wallThickness,
      });
      if (!cut) {
        next.dispose();
        return false;
      }
      next.dispose();
      next = cut;
    }

    next.applyMatrix4(inverseWorld);
    setMeshGeometry(viewer, next);
    viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    ctx.updateEstimate();
    ctx.scheduleProjectAutosave();
    return true;
  }
}

async function yieldThread(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10));
}
