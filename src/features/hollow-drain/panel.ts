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
import type { DrainHole, DrainPlug } from './drain';
import {
  runTrapAnalysis as runTrapAnalysisAction,
  autoSuggestDrains as autoSuggestDrainsAction,
  type TrapActionDeps,
} from './trap-actions';
import {
  getScene,
  getMesh,
  getGeometry,
  setMeshGeometry,
  addWorldModel,
  removeSceneObjectById,
} from './viewer-helpers';
import { mountSplitStep } from './split-step';
import { createPickMode } from './pick-mode';
export function mountHollowDrainPanel(ctx: AppContext): void {
  const { viewer } = ctx;

  // ─── Element refs ────────────────────────────────────────────────
  // Shell step
  const thicknessSlider = document.getElementById('hollow-thickness') as HTMLInputElement | null;
  const thicknessVal = document.getElementById('hollow-thickness-val');
  const xsectionToggle = document.getElementById('hollow-xsection') as HTMLInputElement | null;
  const thinWarning = document.getElementById('hollow-thin-warning');
  const applyBtn = document.getElementById('hollow-apply-btn');
  const clearBtn = document.getElementById('hollow-clear-btn');
  const shellBadge = document.getElementById('hollow-shell-badge');

  // Drain step
  const drainDiamSlider = document.getElementById('drain-diameter') as HTMLInputElement | null;
  const drainDiamVal = document.getElementById('drain-diameter-val');
  const pickBtn = document.getElementById('drain-pick-btn');
  const drainClearBtn = document.getElementById('drain-clear-btn');
  const drainAutoBtn = document.getElementById('drain-auto-btn');
  const drainHoleList = document.getElementById('drain-hole-list');
  const drainBadge = document.getElementById('hollow-drain-badge');
  const plugCheckbox = document.getElementById('drain-generate-plugs') as HTMLInputElement | null;

  // Trap step
  const trapResults = document.getElementById('trap-results');
  const trapAnalyzeBtn = document.getElementById('trap-analyze-btn');
  const trapBadge = document.getElementById('hollow-trap-badge');

  // Split step — mounted separately
  mountSplitStep(ctx);

  // ─── Panel state ─────────────────────────────────────────────────
  let drainHoles: DrainHole[] = [];
  let drainPicks: DrainPlug[] = [];
  let drainPlugObjectIds: string[] = [];
  let wallThickness = 2.0;
  let isHollowed = false;

  // Pristine original geometry (before any hollow or drain), keyed by object id
  const originalGeoMap = new Map<string, THREE.BufferGeometry>();
  const drainBaseGeoMap = new Map<string, THREE.BufferGeometry>();

  // ─── Shell step ──────────────────────────────────────────────────
  listen(thicknessSlider, 'input', () => {
    if (thicknessVal && thicknessSlider)
      thicknessVal.textContent = parseFloat(thicknessSlider.value).toFixed(1);
  });

  listen(xsectionToggle, 'change', () => {
    toggleCrossSection(xsectionToggle?.checked ?? false);
  });

  listen(applyBtn, 'click', () => {
    applyHollow();
  });
  listen(clearBtn, 'click', () => {
    clearHollow();
  });

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
      if (shellBadge) {
        shellBadge.textContent = '✓';
        shellBadge.className = 'step-badge step-badge-done';
      }

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
      const preset = ((sel as unknown as { materialPreset?: Record<string, unknown> })
        .materialPreset ?? {}) as Record<string, unknown>;
      const t = (preset.transmission as number) ?? 0;
      const mat = mesh.material as THREE.MeshPhysicalMaterial;
      mat.transmission = t;
      mat.thickness = t > 0 ? 0.8 : 0;
      mat.needsUpdate = true;
    }
    if (thinWarning) thinWarning.hidden = true;
    if (shellBadge) {
      shellBadge.textContent = '';
      shellBadge.className = 'step-badge';
    }
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
    if (drainDiamVal && drainDiamSlider)
      drainDiamVal.textContent = parseFloat(drainDiamSlider.value).toFixed(1);
  });

  // ─── Pick mode (delegated to pick-mode.ts) ───────────────────────
  const pick = createPickMode(viewer.canvas, {
    getMesh: () => getMesh(viewer),
    getCamera: () => (viewer as unknown as { camera: THREE.Camera }).camera,
    getScene: () => getScene(viewer),
    getDiameter: () => parseFloat(drainDiamSlider?.value ?? '3'),
    onPick: (position, normal) => void handlePickResult(position, normal),
    requestRender: () => viewer.requestRender(),
  });

  function setPickMode(active: boolean): void {
    pick.active = active;
    pickBtn?.classList.toggle('active', active);
    if (!active) pick.clearCursor();
  }

  listen(pickBtn, 'click', () => {
    setPickMode(!pick.active);
  });

  listen(viewer.canvas, 'mousemove', ((e: MouseEvent) => pick.handleMouseMove(e)) as EventListener);
  listen(viewer.canvas, 'click', ((e: MouseEvent) => pick.handleClick(e)) as EventListener);

  async function handlePickResult(position: THREE.Vector3, normal: THREE.Vector3): Promise<void> {
    const diameter = parseFloat(drainDiamSlider?.value ?? '3');
    const targetId = viewer.selected[0]?.id;
    const hole = addDrainHole(getScene(viewer), position, normal, diameter, wallThickness);
    drainHoles.push(hole);
    setPickMode(false);
    const didCut = await rebuildDrainCuts();
    if (!didCut) {
      drainHoles = drainHoles.filter((h) => h !== hole);
      removeDrainHole(getScene(viewer), hole);
      renderDrainList();
      alert(
        'The drain hole could not be cut as a closed manifold. Try a flatter surface or a larger diameter.',
      );
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

  // Listen for drain-hole-placed events (dispatched by viewer in pick mode)
  listen(viewer.canvas, 'drain-hole-placed', async (event: Event) => {
    const detail = (event as CustomEvent<{ position: THREE.Vector3; normal: THREE.Vector3 }>)
      .detail;
    const diameter = parseFloat(drainDiamSlider?.value ?? '3');
    const hole = addDrainHole(
      getScene(viewer),
      detail.position,
      detail.normal,
      diameter,
      wallThickness,
    );
    drainHoles.push(hole);
    setPickMode(false);
    const didCut = await rebuildDrainCuts();
    if (!didCut) {
      drainHoles.pop();
      removeDrainHole(getScene(viewer), hole);
      alert(
        'The drain hole could not be cut as a closed manifold. Try a flatter surface or a larger diameter.',
      );
    }
    renderDrainList();
    viewer.requestRender();
  });

  listen(drainAutoBtn, 'click', () => {
    handleAutoPlace();
  });
  listen(drainClearBtn, 'click', () => {
    clearAllDrainHoles();
  });

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
        count: 2,
        diameter,
        wallThickness,
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
    drainHoleList.innerHTML = drainHoles
      .map(
        (h, i) => `
      <div class="drain-hole-row" data-id="${h.id}">
        <span class="drain-hole-icon">●</span>
        <span class="drain-hole-label">Hole ${i + 1} — ⌀${h.diameter.toFixed(1)} mm</span>
        <button class="drain-hole-remove icon-btn" data-id="${h.id}" aria-label="Remove hole">✕</button>
      </div>
    `,
      )
      .join('');

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

  const trapAutoSuggestBtn = document.getElementById('trap-auto-suggest-btn');

  // ─── Trap analysis ───────────────────────────────────────────────
  listen(trapAnalyzeBtn, 'click', () => {
    runTrapAnalysis();
  });

  listen(trapAutoSuggestBtn, 'click', () => {
    autoSuggestDrains();
  });

  const trapDeps: TrapActionDeps = {
    getGeometry: () => getGeometry(viewer),
    getMesh: () => getMesh(viewer),
    getScene: () => getScene(viewer),
    getDrainHoles: () => drainHoles,
    pushDrainHole: (h) => drainHoles.push(h),
    popDrainHole: () => drainHoles.pop(),
    getDiameter: () => parseFloat(drainDiamSlider?.value ?? '3'),
    getWallThickness: () => wallThickness,
    showProgress: (m) => ctx.showProgress(m),
    updateProgress: (f, m) => ctx.updateProgress(f, m),
    hideProgress: () => ctx.hideProgress(),
    rebuildDrainCuts: () => rebuildDrainCuts(),
    renderDrainList,
    requestRender: () => viewer.requestRender(),
  };

  async function runTrapAnalysis(): Promise<void> {
    if (!viewer.selected[0] || !trapResults) return;
    await runTrapAnalysisAction(trapDeps, trapResults, trapBadge);
  }

  async function autoSuggestDrains(): Promise<void> {
    if (!viewer.selected[0]) return;
    await autoSuggestDrainsAction(trapDeps, trapResults);
  }

  // ─── Selection change: populate smart defaults ───────────────────
  listen(viewer.canvas, 'selection-changed', () => {
    const hasSel = viewer.selected.length > 0;
    // Disable buttons when nothing selected
    const controlBtns = [
      applyBtn,
      clearBtn,
      pickBtn,
      drainAutoBtn,
      drainClearBtn,
      trapAnalyzeBtn,
      trapAutoSuggestBtn,
      document.getElementById('split-apply-btn'),
    ];
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
    for (const id of drainPlugObjectIds) removeSceneObjectById(viewer, id);
    drainPlugObjectIds = [];
    drainPicks = [];
    if (options.restoreGeometry) restoreDrainBaseGeometry();
  }

  function clearViewerMarkers(): void {
    (
      viewer as unknown as { clearSignificantFaceMarkers?: () => void }
    ).clearSignificantFaceMarkers?.();
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
