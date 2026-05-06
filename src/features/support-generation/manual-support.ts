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
  shaftDiameter: number;
}

export function mountManualSupport(ctx: AppContext): ManualSupportState {
  const { viewer } = ctx;
  const canvas = viewer.canvas as HTMLCanvasElement;
  const toggleBtn = document.getElementById('manual-support-btn') as HTMLButtonElement | null;
  const tipInput = document.getElementById('manual-support-tip') as HTMLInputElement | null;
  const shaftInput = document.getElementById('manual-support-shaft') as HTMLInputElement | null;
  const maxAngleInput = document.getElementById('support-max-angle') as HTMLInputElement | null;
  const clearanceInput = document.getElementById('support-clearance') as HTMLInputElement | null;
  const maxOffsetInput = document.getElementById('support-max-offset') as HTMLInputElement | null;

  const state: ManualSupportState = {
    tipDiameter: 0.4,
    shaftDiameter: 0.8,
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

        const modelGeometry = viewer.getModelGeometry?.() ?? null;
        const { addManualPillar } = await import('./manual-pillar');
        addManualPillar(
          viewer as unknown as Parameters<typeof addManualPillar>[0],
          obj as unknown as Parameters<typeof addManualPillar>[1],
          position,
          normal,
          modelGeometry as Parameters<typeof addManualPillar>[4],
          {
            tipDiameterMM: state.tipDiameter,
            shaftDiameterMM: state.shaftDiameter,
            maxPillarAngle: parseFloat(maxAngleInput?.value ?? '45'),
            modelClearance: parseFloat(clearanceInput?.value ?? '1.5'),
            maxContactOffset: parseFloat(maxOffsetInput?.value ?? '18'),
          },
        );

        ctx.clearActivePlateSlice();
        ctx.updateEstimate();
        ctx.scheduleProjectAutosave();
        document.dispatchEvent(new CustomEvent('manual-support-placed'));
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
  });

  // Wire mouse events
  canvas.addEventListener('mousemove', (e) => state.pickMode.handleMouseMove(e));
  canvas.addEventListener('click', (e) => state.pickMode.handleClick(e));

  return state;
}
