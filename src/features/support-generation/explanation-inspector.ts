// ─── Support explanation inspector ──────────────────────────
// Click-to-inspect support pillars: shows why a support exists,
// which intent influenced it, and how it was modified.

import { signal, effect } from '@preact/signals-core';
import type { SupportExplanation } from '@features/surface-intent/engine-types';
import type { SupportPillar } from './build';

// ─── Reactive state ─────────────────────────────────────────

export const inspectedPillar = signal<{
  pillar: SupportPillar;
  explanation: SupportExplanation;
  screenX: number;
  screenY: number;
} | null>(null);

// ─── Pillar storage for click-to-inspect ────────────────────

/** Per-model pillar data, keyed by object ID */
const pillarsByModel = new Map<string, SupportPillar[]>();

/** Store generated pillar data for later click-to-inspect lookup */
export function storePillars(modelId: string, pillars: SupportPillar[]): void {
  pillarsByModel.set(modelId, pillars);
}

/** Clear stored pillar data for a model */
export function clearStoredPillars(modelId: string): void {
  pillarsByModel.delete(modelId);
}

/** Find the nearest pillar to a world-space point, across all stored models */
export function findNearestPillar(
  x: number,
  y: number,
  z: number,
  maxDistMM: number = 5.0,
): { pillar: SupportPillar; explanation: SupportExplanation } | null {
  let bestDist2 = maxDistMM * maxDistMM;
  let bestPillar: SupportPillar | null = null;

  for (const pillars of pillarsByModel.values()) {
    for (const p of pillars) {
      const dx = p.contact.x - x;
      const dy = p.contact.y - y;
      const dz = p.contact.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestPillar = p;
      }
    }
  }

  if (!bestPillar || !bestPillar.contact.explanation) return null;
  return { pillar: bestPillar, explanation: bestPillar.contact.explanation };
}

/** Show the explanation popup for a pillar at the given screen position */
export function inspectPillar(
  pillar: SupportPillar,
  explanation: SupportExplanation,
  screenX: number,
  screenY: number,
): void {
  inspectedPillar.value = { pillar, explanation, screenX, screenY };
}

/** Close the explanation popup */
export function clearInspection(): void {
  inspectedPillar.value = null;
}

// ─── Modification labels ────────────────────────────────────

const MODIFICATION_LABELS: Record<SupportExplanation['modification'], string> = {
  enhanced: 'Enhanced',
  reduced: 'Reduced',
  standard: 'Standard',
  avoided: 'Avoided',
};

const MODIFICATION_CLASSES: Record<SupportExplanation['modification'], string> = {
  enhanced: 'mod-enhanced',
  reduced: 'mod-reduced',
  standard: 'mod-standard',
  avoided: 'mod-avoided',
};

// ─── DOM rendering ──────────────────────────────────────────

/**
 * Mount the explanation inspector popup.
 * Returns a dispose function that cleans up the effect and DOM.
 */
export function mountExplanationInspector(container: HTMLElement): () => void {
  const popup = document.createElement('div');
  popup.className = 'explanation-popup';
  popup.style.display = 'none';
  popup.style.position = 'absolute';
  popup.style.zIndex = '1000';
  container.appendChild(popup);

  // Close on click outside
  const handleClickOutside = (e: MouseEvent): void => {
    if (!popup.contains(e.target as Node)) {
      clearInspection();
    }
  };

  document.addEventListener('click', handleClickOutside, { capture: true });

  const dispose = effect(() => {
    const data = inspectedPillar.value;

    if (!data) {
      popup.style.display = 'none';
      return;
    }

    const { explanation, screenX, screenY, pillar } = data;
    popup.style.display = 'block';
    popup.style.left = `${screenX + 12}px`;
    popup.style.top = `${screenY - 8}px`;

    popup.innerHTML = '';

    // Reason header
    const header = document.createElement('div');
    header.className = 'explanation-header';
    header.textContent = explanation.reason.replaceAll('-', ' ');
    popup.appendChild(header);

    // Full explanation text
    const text = document.createElement('div');
    text.className = 'explanation-text';
    text.textContent = explanation.text;
    popup.appendChild(text);

    // Modification badge
    const modBadge = document.createElement('span');
    modBadge.className = `explanation-mod ${MODIFICATION_CLASSES[explanation.modification]}`;
    modBadge.textContent = MODIFICATION_LABELS[explanation.modification];
    popup.appendChild(modBadge);

    // Intent info (if present)
    if (explanation.influencedBy) {
      const intentInfo = document.createElement('div');
      intentInfo.className = 'explanation-intent';
      intentInfo.textContent = `Intent: ${explanation.influencedBy} (${explanation.priority})`;
      popup.appendChild(intentInfo);
    }

    // Tip diameter (if scaled)
    if (pillar.tipDiameterMM !== undefined) {
      const tipInfo = document.createElement('div');
      tipInfo.className = 'explanation-tip';
      tipInfo.textContent = `Tip: ${pillar.tipDiameterMM.toFixed(2)} mm`;
      popup.appendChild(tipInfo);
    }
  });

  return () => {
    dispose();
    document.removeEventListener('click', handleClickOutside, { capture: true });
    popup.remove();
  };
}
