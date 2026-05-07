/**
 * Getting-started checklist — shown in the sidebar until all 5 actions are done.
 * Listens to events dispatched by other feature panels.
 */
import { effect } from '@preact/signals-core';
import type { AppContext } from '@core/types';
import { checklist, checklistComplete, markChecklist } from './state';

interface ChecklistItem {
  key: keyof typeof checklist.value;
  label: string;
}

const ITEMS: ChecklistItem[] = [
  { key: 'loaded', label: 'Load a model' },
  { key: 'oriented', label: 'Orient it' },
  { key: 'supported', label: 'Generate supports' },
  { key: 'sliced', label: 'Slice a plate' },
  { key: 'exported', label: 'Export a print file' },
];

const CHECK_SVG = `<svg class="ob-check-icon" viewBox="0 0 14 14" fill="none" aria-hidden="true">
  <circle cx="7" cy="7" r="6.5" stroke="currentColor" stroke-opacity="0.4"/>
  <path d="M4 7l2 2 4-4" stroke="var(--accent,#5b9cf6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const EMPTY_SVG = `<svg class="ob-check-icon" viewBox="0 0 14 14" fill="none" aria-hidden="true">
  <circle cx="7" cy="7" r="6.5" stroke="currentColor" stroke-opacity="0.3"/>
</svg>`;

function renderChecklist(container: HTMLElement): void {
  const c = checklist.value;
  container.innerHTML = `
    <div class="ob-checklist-title">Getting started</div>
    <ul class="ob-checklist-items">
      ${ITEMS.map(
        (item) => `
        <li class="ob-checklist-item${c[item.key] ? ' ob-done' : ''}">
          ${c[item.key] ? CHECK_SVG : EMPTY_SVG}
          ${item.label}
        </li>`,
      ).join('')}
    </ul>
  `;
}

export function mountChecklist(ctx: AppContext): void {
  // Don't show if already complete from a previous session
  if (checklistComplete.value) return;

  // Find a sensible mount point — bottom of sidebar above footer
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const container = document.createElement('div');
  container.className = 'ob-checklist';
  sidebar.appendChild(container);

  renderChecklist(container);

  // Reactively re-render when checklist changes
  const dispose = effect(() => {
    renderChecklist(container);

    if (checklistComplete.value) {
      // Fade out and remove after a short delay
      setTimeout(() => {
        container.classList.add('ob-checklist-fade');
        setTimeout(() => {
          container.remove();
          dispose();
        }, 700);
      }, 1800);
    }
  });

  // ── Listen for completion events from other panels ─────────────────────────

  // 1. Model loaded — mesh-changed fires on the canvas
  ctx.viewer.canvas.addEventListener('mesh-changed', () => {
    markChecklist('loaded');
  });

  // 2. Orientation complete
  document.addEventListener('orient-complete', () => {
    markChecklist('oriented');
  });

  // 3. Supports generated
  document.addEventListener('supports-generated', () => {
    markChecklist('supported');
  });

  // 4. Slice complete — dispatched on canvas by gpu-slicing/panel.ts
  ctx.viewer.canvas.addEventListener('slice-complete', () => {
    markChecklist('sliced');
  });

  // 5. Export complete
  document.addEventListener('export-complete', () => {
    markChecklist('exported');
  });
}
