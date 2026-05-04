// ─── Conflict inspector panel ───────────────────────────────
// Displays detected intent conflicts with severity, description,
// and resolution suggestions. Highlights affected faces in the overlay.

import { signal, effect } from '@preact/signals-core';
import type { IntentConflict } from './engine-types';

// ─── Reactive state ─────────────────────────────────────────

export const detectedConflicts = signal<IntentConflict[]>([]);
export const selectedConflictIndex = signal<number | null>(null);

/** Update the conflict list (typically after support generation or slice) */
export function setConflicts(conflicts: IntentConflict[]): void {
  detectedConflicts.value = conflicts;
  selectedConflictIndex.value = null;
}

/** Clear all conflicts */
export function clearConflicts(): void {
  detectedConflicts.value = [];
  selectedConflictIndex.value = null;
}

// ─── DOM rendering ──────────────────────────────────────────

const SEVERITY_ICONS: Record<IntentConflict['severity'], string> = {
  warning: '⚠',
  error: '✕',
};

const SEVERITY_CLASSES: Record<IntentConflict['severity'], string> = {
  warning: 'conflict-warning',
  error: 'conflict-error',
};

/**
 * Mount the conflict inspector into a container element.
 * Returns a dispose function that cleans up the effect.
 */
export function mountConflictInspector(container: HTMLElement): () => void {
  const dispose = effect(() => {
    const conflicts = detectedConflicts.value;
    const selectedIdx = selectedConflictIndex.value;

    container.innerHTML = '';

    if (conflicts.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';

    // Header
    const header = document.createElement('div');
    header.className = 'conflict-header';
    header.textContent = `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} detected`;
    container.appendChild(header);

    // Conflict list
    const list = document.createElement('ul');
    list.className = 'conflict-list';

    for (let i = 0; i < conflicts.length; i++) {
      const conflict = conflicts[i];
      const li = document.createElement('li');
      li.className = `conflict-item ${SEVERITY_CLASSES[conflict.severity]}`;
      if (i === selectedIdx) li.classList.add('selected');

      // Severity icon + description
      const desc = document.createElement('div');
      desc.className = 'conflict-desc';
      desc.textContent = `${SEVERITY_ICONS[conflict.severity]} ${conflict.description}`;
      li.appendChild(desc);

      // Suggestion
      const suggestion = document.createElement('div');
      suggestion.className = 'conflict-suggestion';
      suggestion.textContent = conflict.suggestion;
      li.appendChild(suggestion);

      // Triangle count badge
      const badge = document.createElement('span');
      badge.className = 'conflict-badge';
      badge.textContent = `${conflict.triangleIndices.length} faces`;
      li.appendChild(badge);

      // Click to select/highlight
      li.addEventListener('click', () => {
        selectedConflictIndex.value = selectedConflictIndex.value === i ? null : i;
      });

      list.appendChild(li);
    }

    container.appendChild(list);
  });

  return dispose;
}

/**
 * Get the triangle indices of the currently selected conflict (for overlay highlighting).
 * Returns empty array if no conflict is selected.
 */
export function getSelectedConflictTriangles(): number[] {
  const idx = selectedConflictIndex.value;
  if (idx === null) return [];
  const conflict = detectedConflicts.value[idx];
  return conflict?.triangleIndices ?? [];
}
