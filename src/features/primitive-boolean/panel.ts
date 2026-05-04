/**
 * Primitive Boolean panel — UI for adding primitives and applying boolean operations.
 */
import type { AppContext, PrimitiveCutter } from '@core/types';
import type { PrimitiveType, PrimitiveParams } from '@core/primitives';
import { activeCutter } from '@core/state';
import { commands } from '@core/commands';
import { defaultParams, identityTransform, createPositions } from '@core/primitives';
import { canUndo } from './history';
import { effect } from '@preact/signals-core';

let nextCutterId = 0;

function createCutter(type: PrimitiveType, ctx: AppContext): PrimitiveCutter {
  const center = ctx.viewer.getSelectionWorldCenter();
  const pos: [number, number, number] = center ? [center.x, center.y, center.z] : [0, 10, 0];
  const transform = identityTransform();
  transform.position = pos;
  return {
    id: `prim-${++nextCutterId}`,
    type,
    params: defaultParams(type),
    transform,
  };
}

export function mountPrimitiveBooleanPanel(ctx: AppContext): () => void {
  const panel = document.getElementById('primitive-boolean-panel');
  if (!panel) return () => {};

  const paramsSection = document.getElementById('primitive-params');
  const subtractBtn = document.getElementById('prim-subtract-btn') as HTMLButtonElement | null;
  const splitBtn = document.getElementById('prim-split-btn') as HTMLButtonElement | null;
  const undoBtn = document.getElementById('prim-undo-btn') as HTMLButtonElement | null;
  const cancelBtn = document.getElementById('prim-cancel-btn') as HTMLButtonElement | null;
  const primBtns = panel.querySelectorAll<HTMLButtonElement>('.primitive-btn');
  const gizmoBtns = panel.querySelectorAll<HTMLButtonElement>('.mode-btn');

  const fieldSets: Record<string, HTMLElement | null> = {
    box: document.getElementById('primitive-box-fields'),
    sphere: document.getElementById('primitive-sphere-fields'),
    cylinder: document.getElementById('primitive-cylinder-fields'),
    cone: document.getElementById('primitive-cone-fields'),
  };

  // Input refs for dimensions
  const boxW = document.getElementById('prim-box-w') as HTMLInputElement | null;
  const boxH = document.getElementById('prim-box-h') as HTMLInputElement | null;
  const boxD = document.getElementById('prim-box-d') as HTMLInputElement | null;
  const sphereR = document.getElementById('prim-sphere-r') as HTMLInputElement | null;
  const cylRt = document.getElementById('prim-cyl-rt') as HTMLInputElement | null;
  const cylRb = document.getElementById('prim-cyl-rb') as HTMLInputElement | null;
  const cylH = document.getElementById('prim-cyl-h') as HTMLInputElement | null;
  const coneR = document.getElementById('prim-cone-r') as HTMLInputElement | null;
  const coneH = document.getElementById('prim-cone-h') as HTMLInputElement | null;

  const disposers: (() => void)[] = [];
  let previewId: string | null = null;
  let gizmoDispose: (() => void) | null = null;
  let currentGizmoMode: 'translate' | 'rotate' | 'scale' = 'translate';
  let targetModelId: string | null = null;

  function addListener(target: EventTarget | null, event: string, handler: EventListener): void {
    if (!target) return;
    target.addEventListener(event, handler);
    disposers.push(() => target.removeEventListener(event, handler));
  }

  function showFieldsForType(type: PrimitiveType): void {
    Object.entries(fieldSets).forEach(([key, el]) => {
      if (el) el.hidden = key !== type;
    });
  }

  function readParamsFromUI(type: PrimitiveType): PrimitiveParams {
    switch (type) {
      case 'box':
        return {
          type: 'box',
          width: parseFloat(boxW?.value ?? '10') || 10,
          height: parseFloat(boxH?.value ?? '10') || 10,
          depth: parseFloat(boxD?.value ?? '10') || 10,
        };
      case 'sphere':
        return {
          type: 'sphere',
          radius: parseFloat(sphereR?.value ?? '5') || 5,
          segments: 24,
        };
      case 'cylinder':
        return {
          type: 'cylinder',
          radiusTop: parseFloat(cylRt?.value ?? '5') || 5,
          radiusBottom: parseFloat(cylRb?.value ?? '5') || 5,
          height: parseFloat(cylH?.value ?? '10') || 10,
          segments: 24,
        };
      case 'cone':
        return {
          type: 'cone',
          radius: parseFloat(coneR?.value ?? '5') || 5,
          height: parseFloat(coneH?.value ?? '10') || 10,
          segments: 24,
        };
    }
  }

  function syncPreview(): void {
    const cutter = activeCutter.value;
    if (!cutter) return;

    const positions = createPositions(cutter.params);

    if (previewId) {
      ctx.viewer.removeCutterPreview?.(previewId);
    }
    previewId = ctx.viewer.addCutterPreview?.(positions) ?? null;

    if (previewId) {
      ctx.viewer.updateCutterPreview?.(
        previewId,
        {
          x: cutter.transform.position[0],
          y: cutter.transform.position[1],
          z: cutter.transform.position[2],
        },
        {
          x: cutter.transform.rotation[0],
          y: cutter.transform.rotation[1],
          z: cutter.transform.rotation[2],
        },
        {
          x: cutter.transform.scale[0],
          y: cutter.transform.scale[1],
          z: cutter.transform.scale[2],
        },
      );
      ctx.viewer.setCutterGizmo?.(previewId, currentGizmoMode);
      setupGizmoCallback();
    }
  }

  function setupGizmoCallback(): void {
    if (gizmoDispose) gizmoDispose();
    if (!previewId) return;

    gizmoDispose =
      ctx.viewer.onCutterGizmoChange?.(
        (
          pos: { x: number; y: number; z: number },
          rot: { x: number; y: number; z: number },
          scl: { x: number; y: number; z: number },
        ) => {
          const cutter = activeCutter.value;
          if (!cutter) return;
          activeCutter.value = {
            ...cutter,
            transform: {
              position: [pos.x, pos.y, pos.z],
              rotation: [rot.x, rot.y, rot.z],
              scale: [scl.x, scl.y, scl.z],
            },
          };
        },
      ) ?? null;
  }

  function cancelCutter(): void {
    if (previewId) {
      ctx.viewer.clearCutterGizmo?.();
      ctx.viewer.removeCutterPreview?.(previewId);
      previewId = null;
    }
    if (gizmoDispose) {
      gizmoDispose();
      gizmoDispose = null;
    }
    activeCutter.value = null;
    targetModelId = null;
  }

  // ── Primitive type buttons ───────────────────────────────
  primBtns.forEach((btn) => {
    addListener(btn, 'click', () => {
      const type = btn.dataset.primitive as PrimitiveType;
      cancelCutter();
      targetModelId = ctx.viewer.selected[0]?.id ?? null;
      const cutter = createCutter(type, ctx);
      activeCutter.value = cutter;
      syncPreview();
    });
  });

  // ── Gizmo mode buttons ──────────────────────────────────
  gizmoBtns.forEach((btn) => {
    addListener(btn, 'click', () => {
      gizmoBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentGizmoMode = (btn.dataset.gizmo as 'translate' | 'rotate' | 'scale') ?? 'translate';
      if (previewId) {
        ctx.viewer.setCutterGizmo?.(previewId, currentGizmoMode);
      }
    });
  });

  // ── Dimension input changes ──────────────────────────────
  const dimInputs = [boxW, boxH, boxD, sphereR, cylRt, cylRb, cylH, coneR, coneH];
  dimInputs.forEach((input) => {
    if (!input) return;
    addListener(input, 'change', () => {
      const cutter = activeCutter.value;
      if (!cutter) return;
      const newParams = readParamsFromUI(cutter.type);
      activeCutter.value = { ...cutter, params: newParams };
      syncPreview();
    });
  });

  // ── Operation buttons ────────────────────────────────────
  addListener(subtractBtn, 'click', () => {
    if (!targetModelId || !activeCutter.value) return;
    commands.dispatch('boolean-subtract', { modelId: targetModelId });
  });

  addListener(splitBtn, 'click', () => {
    if (!targetModelId || !activeCutter.value) return;
    commands.dispatch('boolean-split', { modelId: targetModelId });
  });

  addListener(cancelBtn, 'click', cancelCutter);

  // ── Reactive effects ─────────────────────────────────────
  disposers.push(
    effect(() => {
      const cutter = activeCutter.value;
      if (paramsSection) paramsSection.hidden = !cutter;
      if (cutter) {
        showFieldsForType(cutter.type);
        // NOTE: syncPreview is called explicitly by button/param handlers,
        // NOT here. Calling it from the effect would destroy+recreate the
        // mesh on every gizmo 'change' event, breaking translate dragging.
      } else if (previewId) {
        ctx.viewer.clearCutterGizmo?.();
        ctx.viewer.removeCutterPreview?.(previewId);
        previewId = null;
      }
    }),
  );

  // Undo button reactivity
  disposers.push(
    effect(() => {
      if (undoBtn) {
        undoBtn.disabled = !targetModelId || !canUndo(targetModelId);
      }
    }),
  );

  if (undoBtn) {
    addListener(undoBtn, 'click', () => {
      if (!targetModelId) return;
      undoBtn.dispatchEvent(
        new CustomEvent('boolean-undo', { detail: { modelId: targetModelId }, bubbles: true }),
      );
    });
  }

  return () => {
    cancelCutter();
    disposers.forEach((d) => d());
  };
}
