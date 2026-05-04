// ─── Surface intent panel ───────────────────────────────────
// Mounts the intent painting UI: intent buttons, priority dropdown,
// brush controls, tradeoff sliders, and conflict list.

import type { AppContext } from '@core/types';
import type { LegacyObject } from '@core/legacy-types';
import { listen } from '@features/app-shell/utils';
import { type IntentPriority, ALL_INTENTS, hasAnyIntent } from './types';
import {
  activeIntentBrush,
  appearanceReliabilityBalance,
  cleanupMaterialBalance,
  ensureIntentBuffer,
  setFaceIntents,
  clearIntents,
  getIntentBuffer,
} from './store';
import { mountConflictInspector } from './conflict-inspector';

export function mountIntentPanel(ctx: AppContext): void {
  const { viewer } = ctx;

  // ─── Intent buttons ──────────────────────────────────────
  for (const intent of ALL_INTENTS) {
    const btn = document.getElementById(`intent-btn-${intent}`);
    listen(btn, 'click', () => {
      activeIntentBrush.value = { ...activeIntentBrush.value, intent };
      _updateActiveButton();
    });
  }

  // ─── Priority selector ───────────────────────────────────
  const prioritySelect = document.getElementById('intent-priority') as HTMLSelectElement | null;
  listen(prioritySelect, 'change', () => {
    if (!prioritySelect) return;
    activeIntentBrush.value = {
      ...activeIntentBrush.value,
      priority: prioritySelect.value as IntentPriority,
    };
  });

  // ─── Brush radius ────────────────────────────────────────
  const brushRadiusInput = document.getElementById(
    'intent-brush-radius',
  ) as HTMLInputElement | null;
  const brushRadiusVal = document.getElementById('intent-brush-radius-val');
  listen(brushRadiusInput, 'input', () => {
    if (!brushRadiusInput) return;
    if (brushRadiusVal) brushRadiusVal.textContent = brushRadiusInput.value;
    viewer.intentBrushRadiusMM = parseFloat(brushRadiusInput.value);
  });

  // ─── Paint / Clear buttons ────────────────────────────────
  const paintBtn = document.getElementById('intent-paint-btn');
  const clearBtn = document.getElementById('intent-clear-btn');

  listen(paintBtn, 'click', () => {
    const enabled = !viewer.intentPaintMode;
    viewer.setIntentPaintMode(enabled);
    if (paintBtn) paintBtn.classList.toggle('active', enabled);
  });

  listen(clearBtn, 'click', () => {
    const targets = viewer.selected.length > 0 ? viewer.selected : [];
    for (const obj of targets) {
      clearIntents(obj.id);
      obj.intentBuffer = undefined;
    }
    _refreshOverlay();
  });

  // ─── Select all / Clear all buttons ──────────────────────
  const selectAllBtn = document.getElementById('intent-select-all-btn');
  const clearAllBtn = document.getElementById('intent-clear-all-btn');

  listen(selectAllBtn, 'click', () => {
    const targets = viewer.selected.length > 0 ? viewer.selected : [];
    for (const obj of targets) {
      const triCount = viewer.getObjectTriangleCount(obj.id);
      if (!triCount) continue;
      ensureIntentBuffer(obj.id, triCount);
      const allIndices = Array.from({ length: triCount }, (_, i) => i);
      const { intent, priority } = activeIntentBrush.value;
      setFaceIntents(obj.id, allIndices, intent, priority);
      const buf = getIntentBuffer(obj.id);
      if (buf) obj.intentBuffer = buf;
    }
    _refreshOverlay();
    _updatePanelState();
  });

  listen(clearAllBtn, 'click', () => {
    for (const obj of viewer.objects) {
      clearIntents(obj.id);
      obj.intentBuffer = undefined;
    }
    _refreshOverlay();
    _updatePanelState();
  });

  // ─── Tradeoff sliders ────────────────────────────────────
  const appearanceSlider = document.getElementById(
    'intent-appearance-reliability',
  ) as HTMLInputElement | null;
  const cleanupSlider = document.getElementById(
    'intent-cleanup-material',
  ) as HTMLInputElement | null;

  listen(appearanceSlider, 'input', () => {
    if (!appearanceSlider) return;
    appearanceReliabilityBalance.value = parseFloat(appearanceSlider.value);
  });

  listen(cleanupSlider, 'input', () => {
    if (!cleanupSlider) return;
    cleanupMaterialBalance.value = parseFloat(cleanupSlider.value);
  });

  // ─── Intent overlay management ────────────────────────────

  function _refreshOverlay(): void {
    viewer.clearIntentOverlay();

    const targets = viewer.selected.length > 0 ? viewer.selected : [];
    if (targets.length === 0) {
      viewer.requestRender();
      return;
    }

    // Show overlay for first selected object that has intents
    for (const obj of targets) {
      const buffer = getIntentBuffer(obj.id);
      if (!buffer || !hasAnyIntent(buffer)) continue;
      viewer.showIntentOverlay(obj.id, buffer);
      break; // one overlay at a time for now
    }
    viewer.requestRender();
  }

  // ─── Handle paint events from viewer ───────────────────────
  listen(viewer.canvas, 'intent-paint-faces', ((
    e: CustomEvent<{ objectId: string; faceIndices: number[] }>,
  ) => {
    const { objectId, faceIndices } = e.detail;
    const obj = [...viewer.selected, ...viewer.objects].find(
      (o: LegacyObject) => o.id === objectId,
    );
    if (!obj) return;

    // Get triangle count from viewer
    const triCount = viewer.getObjectTriangleCount(objectId);
    if (!triCount) return;
    ensureIntentBuffer(objectId, triCount);

    // Write the active brush intent to the selected faces
    const { intent, priority } = activeIntentBrush.value;
    setFaceIntents(objectId, faceIndices, intent, priority);

    // Also sync to the SceneObject's intentBuffer for serialization
    const buf = getIntentBuffer(objectId);
    if (buf) obj.intentBuffer = buf;

    _refreshOverlay();
    _updatePanelState();
  }) as EventListener);

  listen(viewer.canvas, 'intent-painted', () => {
    _refreshOverlay();
    _updatePanelState();
  });

  listen(viewer.canvas, 'selection-changed', () => {
    _refreshOverlay();
    _updatePanelState();
  });

  // ─── UI helpers ───────────────────────────────────────────
  function _updateActiveButton(): void {
    for (const intent of ALL_INTENTS) {
      const btn = document.getElementById(`intent-btn-${intent}`);
      if (btn) btn.classList.toggle('active', intent === activeIntentBrush.value.intent);
    }
  }

  function _updatePanelState(): void {
    const hasSel = viewer.selected.length > 0;
    const elems = [paintBtn, clearBtn];
    for (const el of elems) {
      if (el instanceof HTMLButtonElement) el.disabled = !hasSel;
    }

    // Show intent stats
    const statsEl = document.getElementById('intent-stats');
    if (statsEl && hasSel) {
      const obj = viewer.selected[0];
      const buffer = getIntentBuffer(obj.id);
      if (buffer && hasAnyIntent(buffer)) {
        const total = buffer.length;
        let assigned = 0;
        for (let i = 0; i < buffer.length; i++) {
          if (buffer[i] !== 0) assigned++;
        }
        statsEl.textContent = `${assigned} / ${total} faces assigned`;
      } else {
        statsEl.textContent = 'No intents assigned';
      }
    }
  }

  _updateActiveButton();
  _updatePanelState();

  // ─── Mount conflict inspector ────────────────────────────
  const conflictContainer = document.getElementById('intent-conflicts');
  if (conflictContainer) {
    mountConflictInspector(conflictContainer);
  }
}
