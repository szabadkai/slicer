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

export interface ManualSupportState {
  pickMode: PickMode;
  tipDiameter: number;
}

export function mountManualSupport(ctx: AppContext): ManualSupportState {
  const { viewer } = ctx;
  const canvas = viewer.canvas as HTMLCanvasElement;
  const toggleBtn = document.getElementById('manual-support-btn') as HTMLButtonElement | null;
  const tipInput = document.getElementById('manual-support-tip') as HTMLInputElement | null;

  const state: ManualSupportState = {
    tipDiameter: 0.4,
    pickMode: createPickMode(canvas, {
      getMesh() {
        if (viewer.selected.length !== 1) return null;
        // LegacyObject.mesh is compatible with THREE.Mesh at runtime
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
      async onPick(position, normal) {
        if (viewer.selected.length !== 1) return;
        const obj = viewer.selected[0];

        const { addManualPillar } = await import('./manual-pillar');
        addManualPillar(
          viewer as unknown as Parameters<typeof addManualPillar>[0],
          obj as unknown as Parameters<typeof addManualPillar>[1],
          position,
          normal,
          state.tipDiameter,
        );

        ctx.clearActivePlateSlice();
        ctx.updateEstimate();
        ctx.scheduleProjectAutosave();
      },
      requestRender() {
        viewer.requestRender();
      },
    }),
  };

  // Wire toggle button
  listen(toggleBtn, 'click', () => {
    state.pickMode.active = !state.pickMode.active;
    toggleBtn?.classList.toggle('active', state.pickMode.active);

    if (!state.pickMode.active) {
      state.pickMode.clearCursor();
    }
  });

  // Wire tip diameter input
  listen(tipInput, 'input', () => {
    state.tipDiameter = parseFloat(tipInput?.value ?? '0.4');
  });

  // Deactivate on panel switch
  document.addEventListener('tool-panel-changed', () => {
    if (state.pickMode.active) {
      state.pickMode.active = false;
      state.pickMode.clearCursor();
      toggleBtn?.classList.remove('active');
    }
  });

  // Wire mouse events
  canvas.addEventListener('mousemove', (e) => state.pickMode.handleMouseMove(e));
  canvas.addEventListener('click', (e) => state.pickMode.handleClick(e));

  return state;
}
