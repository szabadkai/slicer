// ─── Scene-viewer coordination layer ────────────────────────
// Manages selection, camera views, and build-volume sync.
// Does NOT import THREE.js — delegates to viewer-service via ViewerService interface.

import { signal, computed, effect } from '@preact/signals-core';
import { selectedModelIds, selectedPrinterKey } from '@core/state';
import type { ViewerService, PrinterSpec } from '@core/types';

// ─── Camera presets ────────────────────────────────────────

export type CameraView = 'perspective' | 'top' | 'front' | 'right';

export const currentCameraView = signal<CameraView>('perspective');

export interface CameraTarget {
  x: number;
  y: number;
  z: number;
}

export const cameraTarget = signal<CameraTarget>({ x: 0, y: 0, z: 0 });

// ─── Selection logic ───────────────────────────────────────

export function selectModel(modelId: string, additive: boolean): void {
  if (additive) {
    const current = selectedModelIds.value;
    if (current.includes(modelId)) {
      selectedModelIds.value = current.filter((id) => id !== modelId);
    } else {
      selectedModelIds.value = [...current, modelId];
    }
  } else {
    selectedModelIds.value = [modelId];
  }
}

export function clearSelection(): void {
  selectedModelIds.value = [];
}

export const hasSelection = computed(() => selectedModelIds.value.length > 0);

// ─── Build volume sync ─────────────────────────────────────

export function syncBuildVolume(viewer: ViewerService, spec: PrinterSpec): void {
  viewer.setPrinter(spec);
}

// ─── Frame model ───────────────────────────────────────────

export function frameModel(viewer: ViewerService, modelId: string): void {
  const model = viewer.getModel(modelId);
  if (!model) return;
  // Framing is handled by the viewer-service internals (camera animation).
  // This function serves as the coordination entry point.
  void model;
}

// ─── Mount ─────────────────────────────────────────────────

export interface SceneViewerMountResult {
  dispose: () => void;
}

/**
 * Mount the scene viewer coordination layer.
 * Wires signals to viewer-service calls.
 */
export function mountSceneViewer(
  viewer: ViewerService,
  getPrinter: (key: string) => PrinterSpec | undefined,
): SceneViewerMountResult {
  const disposePrinter = effect(() => {
    const key = selectedPrinterKey.value;
    const spec = getPrinter(key);
    if (spec) {
      syncBuildVolume(viewer, spec);
    }
  });

  return {
    dispose: () => {
      disposePrinter();
    },
  };
}
