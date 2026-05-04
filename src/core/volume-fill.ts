/**
 * Shared volume fill controller — manages a primitive preview + gizmo
 * for paint and intent volume-based selection.
 *
 * Each consumer (paint panel, intent panel) creates its own instance.
 * Only one volume fill can be active at a time (enforced by the cutter
 * gizmo system in viewer-cutter-preview.ts).
 */
import type { LegacyViewer } from './legacy-types';
import type { PrimitiveType, PrimitiveParams, PrimitiveTransform } from './primitives';
import { defaultParams, identityTransform, createPositions } from './primitives';

export interface VolumeFillState {
  type: PrimitiveType;
  params: PrimitiveParams;
  transform: PrimitiveTransform;
}

export interface VolumeFillController {
  readonly active: boolean;
  readonly state: VolumeFillState | null;
  start(type: PrimitiveType): void;
  setGizmoMode(mode: 'translate' | 'rotate' | 'scale'): void;
  cancel(): void;
  dispose(): void;
}

export function createVolumeFill(viewer: LegacyViewer): VolumeFillController {
  let previewId: string | null = null;
  let gizmoDispose: (() => void) | null = null;
  let current: VolumeFillState | null = null;

  function syncPreview(): void {
    if (!current) return;
    const positions = createPositions(current.params);

    if (previewId) {
      viewer.removeCutterPreview?.(previewId);
    }
    previewId = viewer.addCutterPreview?.(positions) ?? null;

    if (previewId) {
      const t = current.transform;
      viewer.updateCutterPreview?.(
        previewId,
        { x: t.position[0], y: t.position[1], z: t.position[2] },
        { x: t.rotation[0], y: t.rotation[1], z: t.rotation[2] },
        { x: t.scale[0], y: t.scale[1], z: t.scale[2] },
      );
      viewer.setCutterGizmo?.(previewId, 'translate');
      setupGizmoCallback();
    }
  }

  function setupGizmoCallback(): void {
    if (gizmoDispose) gizmoDispose();
    if (!previewId) return;

    gizmoDispose =
      viewer.onCutterGizmoChange?.((pos, rot, scl) => {
        if (!current) return;
        current = {
          ...current,
          transform: {
            position: [pos.x, pos.y, pos.z],
            rotation: [rot.x, rot.y, rot.z],
            scale: [scl.x, scl.y, scl.z],
          },
        };
      }) ?? null;
  }

  function cancel(): void {
    if (previewId) {
      viewer.clearCutterGizmo?.();
      viewer.removeCutterPreview?.(previewId);
      previewId = null;
    }
    if (gizmoDispose) {
      gizmoDispose();
      gizmoDispose = null;
    }
    current = null;
  }

  return {
    get active(): boolean {
      return current !== null;
    },
    get state(): VolumeFillState | null {
      return current;
    },
    start(type: PrimitiveType): void {
      cancel();
      const center = viewer.getSelectionWorldCenter();
      const pos: [number, number, number] = center ? [center.x, center.y, center.z] : [0, 10, 0];
      const transform = identityTransform();
      transform.position = pos;
      current = {
        type,
        params: defaultParams(type),
        transform,
      };
      syncPreview();
    },
    setGizmoMode(mode: 'translate' | 'rotate' | 'scale'): void {
      if (previewId) {
        viewer.setCutterGizmo?.(previewId, mode);
      }
    },
    cancel,
    dispose(): void {
      cancel();
    },
  };
}
