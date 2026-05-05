/**
 * Primitive Boolean panel — UI for adding primitives and applying boolean operations.
 */
import type { AppContext, PrimitiveCutter } from '@core/types';
import type { PrimitiveType } from '@core/primitives';
import { activeCutter } from '@core/state';
import { commands } from '@core/commands';
import { defaultParams, identityTransform, createPositions } from '@core/primitives';
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

  const primBtns = panel.querySelectorAll<HTMLButtonElement>('.primitive-btn');

  // Viewport floating toolbar
  const primToolbar = document.getElementById('prim-viewer-toolbar');
  const primMoveBtn = document.getElementById('prim-viewer-move-btn') as HTMLButtonElement | null;
  const primRotateBtn = document.getElementById(
    'prim-viewer-rotate-btn',
  ) as HTMLButtonElement | null;
  const primScaleBtn = document.getElementById('prim-viewer-scale-btn') as HTMLButtonElement | null;
  const subtractBtn = document.getElementById(
    'prim-viewer-subtract-btn',
  ) as HTMLButtonElement | null;
  const splitBtn = document.getElementById('prim-viewer-split-btn') as HTMLButtonElement | null;

  const disposers: (() => void)[] = [];
  let previewId: string | null = null;
  let gizmoDispose: (() => void) | null = null;
  let currentGizmoMode: 'translate' | 'rotate' | 'scale' = 'translate';
  let targetModelId: string | null = null;

  function setPrimToolbarVisible(visible: boolean): void {
    if (primToolbar) primToolbar.hidden = !visible;
  }

  function setPrimGizmoMode(mode: 'translate' | 'rotate' | 'scale'): void {
    currentGizmoMode = mode;
    primMoveBtn?.classList.toggle('active', mode === 'translate');
    primRotateBtn?.classList.toggle('active', mode === 'rotate');
    primScaleBtn?.classList.toggle('active', mode === 'scale');
    if (previewId) {
      ctx.viewer.setCutterGizmo?.(previewId, mode);
    }
  }

  function addListener(target: EventTarget | null, event: string, handler: EventListener): void {
    if (!target) return;
    target.addEventListener(event, handler);
    disposers.push(() => target.removeEventListener(event, handler));
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
    setPrimToolbarVisible(false);
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
      setPrimToolbarVisible(true);
      setPrimGizmoMode('translate');
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

  // ── Reactive effects ─────────────────────────────────────
  disposers.push(
    effect(() => {
      const cutter = activeCutter.value;
      if (!cutter) {
        if (previewId) {
          ctx.viewer.clearCutterGizmo?.();
          ctx.viewer.removeCutterPreview?.(previewId);
          previewId = null;
        }
        if (gizmoDispose) {
          gizmoDispose();
          gizmoDispose = null;
        }
        targetModelId = null;
        setPrimToolbarVisible(false);
      }
    }),
  );

  // ── Viewport toolbar buttons ─────────────────────────────
  addListener(primMoveBtn, 'click', () => setPrimGizmoMode('translate'));
  addListener(primRotateBtn, 'click', () => setPrimGizmoMode('rotate'));
  addListener(primScaleBtn, 'click', () => setPrimGizmoMode('scale'));

  // Hide toolbar when leaving modify panel
  addListener(document, 'tool-panel-changed', ((event: CustomEvent) => {
    const detail = event.detail as { panel?: string };
    if (detail.panel !== 'modify') {
      cancelCutter();
    }
  }) as EventListener);

  return () => {
    cancelCutter();
    disposers.forEach((d) => d());
  };
}
