/**
 * Manual support placement — click-to-place individual support pillars.
 * Uses the same pick-mode pattern as hollow-drain for raycasting.
 */
import {
  createPickMode,
  type PickMode,
  type PickModeCallbacks,
} from '@features/hollow-drain/pick-mode';
import type { AppContext } from '@core/types';
import { listen } from '@features/app-shell/utils';

interface Vec3Like {
  x: number;
  y: number;
  z: number;
  clone(): Vec3Like;
}

export interface ManualSupportState {
  pickMode: PickMode;
  bridgePickMode: PickMode;
  branchPickMode: PickMode;
  tipDiameter: number;
  shaftDiameter: number;
  /** Pending source point for a bridge placement (set by first click). */
  bridgeSourcePending: { position: Vec3Like; normal: Vec3Like } | null;
  /** Pending touchpoints for a branching support structure. */
  branchTouchpoints: { position: Vec3Like; normal: Vec3Like }[];
}

export function mountManualSupport(ctx: AppContext): ManualSupportState {
  const { viewer } = ctx;
  const canvas = viewer.canvas as HTMLCanvasElement;
  const toggleBtn = document.getElementById('manual-support-btn') as HTMLButtonElement | null;
  const bridgeBtn = document.getElementById('manual-bridge-btn') as HTMLButtonElement | null;
  const branchBtn = document.getElementById('manual-branch-btn') as HTMLButtonElement | null;
  const branchFinishBtn = document.getElementById(
    'manual-branch-finish-btn',
  ) as HTMLButtonElement | null;
  const tipInput = document.getElementById('manual-support-tip') as HTMLInputElement | null;
  const shaftInput = document.getElementById('manual-support-shaft') as HTMLInputElement | null;
  const maxAngleInput = document.getElementById('support-max-angle') as HTMLInputElement | null;
  const clearanceInput = document.getElementById('support-clearance') as HTMLInputElement | null;
  const maxOffsetInput = document.getElementById('support-max-offset') as HTMLInputElement | null;

  function getManualOpts(): {
    tipDiameterMM: number;
    shaftDiameterMM: number;
    maxPillarAngle: number;
    modelClearance: number;
    maxContactOffset: number;
  } {
    return {
      tipDiameterMM: state.tipDiameter,
      shaftDiameterMM: state.shaftDiameter,
      maxPillarAngle: parseFloat(maxAngleInput?.value ?? '45'),
      modelClearance: parseFloat(clearanceInput?.value ?? '1.5'),
      maxContactOffset: parseFloat(maxOffsetInput?.value ?? '18'),
    };
  }

  function pickCallbacks(): Omit<PickModeCallbacks, 'onPick'> {
    return {
      getMesh() {
        if (viewer.selected.length !== 1) return null;
        return viewer.selected[0].mesh as unknown as ReturnType<PickModeCallbacks['getMesh']>;
      },
      getCamera() {
        return viewer.camera as ReturnType<PickModeCallbacks['getCamera']>;
      },
      getScene() {
        return viewer.scene as ReturnType<PickModeCallbacks['getScene']>;
      },
      getDiameter() {
        return state.tipDiameter;
      },
      requestRender() {
        viewer.requestRender();
      },
    };
  }

  function updateBranchButtons(): void {
    const count = state.branchTouchpoints.length;
    if (branchBtn) branchBtn.textContent = count > 0 ? `Branch Points (${count})` : 'Branch Points';
    if (branchFinishBtn) branchFinishBtn.disabled = count < 2;
  }

  function clearBranchPending(): void {
    state.branchTouchpoints = [];
    updateBranchButtons();
  }

  function deactivateBranchMode(): void {
    if (!state.branchPickMode.active) return;
    state.branchPickMode.active = false;
    state.branchPickMode.clearCursor();
    branchBtn?.classList.remove('active');
    clearBranchPending();
  }

  const state: ManualSupportState = {
    tipDiameter: 0.4,
    shaftDiameter: 0.8,
    bridgeSourcePending: null,
    branchTouchpoints: [],

    pickMode: createPickMode(canvas, {
      ...pickCallbacks(),
      async onPick(position, normal) {
        if (viewer.selected.length !== 1) return;
        const obj = viewer.selected[0];
        const modelGeometry = viewer.getModelGeometry?.() ?? null;
        const { addManualPillar } = await import('./manual-pillar');
        addManualPillar(
          viewer as unknown as Parameters<typeof addManualPillar>[0],
          obj as unknown as Parameters<typeof addManualPillar>[1],
          position,
          normal,
          modelGeometry as Parameters<typeof addManualPillar>[4],
          getManualOpts(),
        );
        ctx.clearActivePlateSlice();
        ctx.updateEstimate();
        ctx.scheduleProjectAutosave();
        document.dispatchEvent(new CustomEvent('manual-support-placed'));
      },
    }),

    bridgePickMode: createPickMode(canvas, {
      ...pickCallbacks(),
      async onPick(position, normal) {
        if (viewer.selected.length !== 1) return;
        const obj = viewer.selected[0];

        if (!state.bridgeSourcePending) {
          // First click — store source.
          state.bridgeSourcePending = {
            position: position.clone(),
            normal: normal.clone(),
          };
          if (bridgeBtn) bridgeBtn.textContent = 'Click target...';
          return;
        }

        // Second click — place bridge.
        const source = state.bridgeSourcePending;
        state.bridgeSourcePending = null;
        if (bridgeBtn) bridgeBtn.textContent = 'Bridge (2-click)';

        const modelGeometry = viewer.getModelGeometry?.() ?? null;
        const { addBridgePillar } = await import('./manual-pillar');
        addBridgePillar(
          viewer as unknown as Parameters<typeof addBridgePillar>[0],
          obj as unknown as Parameters<typeof addBridgePillar>[1],
          source.position as Parameters<typeof addBridgePillar>[2],
          position,
          modelGeometry as Parameters<typeof addBridgePillar>[4],
          getManualOpts(),
        );
        ctx.clearActivePlateSlice();
        ctx.updateEstimate();
        ctx.scheduleProjectAutosave();
        document.dispatchEvent(new CustomEvent('manual-support-placed'));
      },
    }),

    branchPickMode: createPickMode(canvas, {
      ...pickCallbacks(),
      onPick(position, normal) {
        if (viewer.selected.length !== 1) return;
        state.branchTouchpoints.push({
          position: position.clone(),
          normal: normal.clone(),
        });
        updateBranchButtons();
      },
    }),
  };

  // --- Single-pillar toggle ---
  listen(toggleBtn, 'click', () => {
    // Deactivate bridge mode if active.
    if (state.bridgePickMode.active) {
      state.bridgePickMode.active = false;
      state.bridgePickMode.clearCursor();
      state.bridgeSourcePending = null;
      bridgeBtn?.classList.remove('active');
      if (bridgeBtn) bridgeBtn.textContent = 'Bridge (2-click)';
    }
    deactivateBranchMode();
    state.pickMode.active = !state.pickMode.active;
    toggleBtn?.classList.toggle('active', state.pickMode.active);
    if (!state.pickMode.active) state.pickMode.clearCursor();
  });

  // --- Bridge toggle ---
  listen(bridgeBtn, 'click', () => {
    // Deactivate single-pillar mode if active.
    if (state.pickMode.active) {
      state.pickMode.active = false;
      state.pickMode.clearCursor();
      toggleBtn?.classList.remove('active');
    }
    deactivateBranchMode();
    state.bridgePickMode.active = !state.bridgePickMode.active;
    bridgeBtn?.classList.toggle('active', state.bridgePickMode.active);
    if (!state.bridgePickMode.active) {
      state.bridgePickMode.clearCursor();
      state.bridgeSourcePending = null;
      if (bridgeBtn) bridgeBtn.textContent = 'Bridge (2-click)';
    }
  });

  // --- Branch support toggle ---
  listen(branchBtn, 'click', () => {
    if (state.pickMode.active) {
      state.pickMode.active = false;
      state.pickMode.clearCursor();
      toggleBtn?.classList.remove('active');
    }
    if (state.bridgePickMode.active) {
      state.bridgePickMode.active = false;
      state.bridgePickMode.clearCursor();
      state.bridgeSourcePending = null;
      bridgeBtn?.classList.remove('active');
      if (bridgeBtn) bridgeBtn.textContent = 'Bridge (2-click)';
    }
    state.branchPickMode.active = !state.branchPickMode.active;
    branchBtn?.classList.toggle('active', state.branchPickMode.active);
    if (!state.branchPickMode.active) {
      state.branchPickMode.clearCursor();
      clearBranchPending();
    }
  });

  listen(branchFinishBtn, 'click', async () => {
    if (viewer.selected.length !== 1 || state.branchTouchpoints.length < 2) return;
    const obj = viewer.selected[0];
    const { addBranchSupportStructure } = await import('./manual-pillar');
    const placed = addBranchSupportStructure(
      viewer as unknown as Parameters<typeof addBranchSupportStructure>[0],
      obj as unknown as Parameters<typeof addBranchSupportStructure>[1],
      state.branchTouchpoints as Parameters<typeof addBranchSupportStructure>[2],
      getManualOpts(),
    );
    if (!placed) return;
    clearBranchPending();
    ctx.clearActivePlateSlice();
    ctx.updateEstimate();
    ctx.scheduleProjectAutosave();
    document.dispatchEvent(new CustomEvent('manual-support-placed'));
  });

  // Wire tip diameter input
  listen(tipInput, 'input', () => {
    state.tipDiameter = parseFloat(tipInput?.value ?? '0.4');
  });

  // Wire shaft diameter input
  listen(shaftInput, 'input', () => {
    state.shaftDiameter = parseFloat(shaftInput?.value ?? '0.8');
  });

  // Deactivate on panel switch
  document.addEventListener('tool-panel-changed', () => {
    if (state.pickMode.active) {
      state.pickMode.active = false;
      state.pickMode.clearCursor();
      toggleBtn?.classList.remove('active');
    }
    if (state.bridgePickMode.active) {
      state.bridgePickMode.active = false;
      state.bridgePickMode.clearCursor();
      state.bridgeSourcePending = null;
      bridgeBtn?.classList.remove('active');
      if (bridgeBtn) bridgeBtn.textContent = 'Bridge (2-click)';
    }
    deactivateBranchMode();
  });

  // Wire mouse events — dispatch to whichever mode is active.
  canvas.addEventListener('mousemove', (e) => {
    if (state.pickMode.active) state.pickMode.handleMouseMove(e);
    if (state.bridgePickMode.active) state.bridgePickMode.handleMouseMove(e);
    if (state.branchPickMode.active) state.branchPickMode.handleMouseMove(e);
  });
  canvas.addEventListener('click', (e) => {
    if (state.pickMode.active) state.pickMode.handleClick(e);
    if (state.bridgePickMode.active) state.bridgePickMode.handleClick(e);
    if (state.branchPickMode.active) state.branchPickMode.handleClick(e);
  });

  // Cancel pending manual interactions on right-click / Escape.
  canvas.addEventListener('contextmenu', () => {
    if (state.bridgePickMode.active && state.bridgeSourcePending) {
      state.bridgeSourcePending = null;
      if (bridgeBtn) bridgeBtn.textContent = 'Bridge (2-click)';
    }
    if (state.branchPickMode.active && state.branchTouchpoints.length > 0) {
      clearBranchPending();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.bridgePickMode.active && state.bridgeSourcePending) {
      state.bridgeSourcePending = null;
      if (bridgeBtn) bridgeBtn.textContent = 'Bridge (2-click)';
    }
    if (e.key === 'Escape' && state.branchPickMode.active && state.branchTouchpoints.length > 0) {
      clearBranchPending();
    }
  });

  updateBranchButtons();
  return state;
}
