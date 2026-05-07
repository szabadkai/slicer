/**
 * Onboarding state — signals + localStorage persistence.
 */
import { signal, computed } from '@preact/signals-core';

// ─── localStorage keys (namespaced to match rest of app) ────────────────────
export const LS_ONBOARDING_SEEN = 'slicelab.onboarding.seen.v1';
export const LS_TOUR_COMPLETED = 'slicelab.tour.completed.v1';
export const LS_CHECKLIST_ITEMS = 'slicelab.checklist.v1';

// ─── Welcome modal ───────────────────────────────────────────────────────────
export const hasSeenWelcome = signal<boolean>(localStorage.getItem(LS_ONBOARDING_SEEN) === 'true');

export function markWelcomeSeen(): void {
  hasSeenWelcome.value = true;
  localStorage.setItem(LS_ONBOARDING_SEEN, 'true');
}

// ─── Tour ────────────────────────────────────────────────────────────────────
export const tourActive = signal<boolean>(false);
export const tourStepIndex = signal<number>(-1);

export function startTour(): void {
  tourActive.value = true;
  tourStepIndex.value = 0;
}

export function advanceTour(): void {
  tourStepIndex.value += 1;
}

export function endTour(): void {
  tourActive.value = false;
  tourStepIndex.value = -1;
  localStorage.setItem(LS_TOUR_COMPLETED, 'true');
}

// ─── Getting-started checklist ───────────────────────────────────────────────
export interface ChecklistState {
  loaded: boolean;
  oriented: boolean;
  supported: boolean;
  sliced: boolean;
  exported: boolean;
}

function loadChecklist(): ChecklistState {
  try {
    const raw = localStorage.getItem(LS_CHECKLIST_ITEMS);
    if (raw) return JSON.parse(raw) as ChecklistState;
  } catch {
    // ignore parse errors
  }
  return { loaded: false, oriented: false, supported: false, sliced: false, exported: false };
}

export const checklist = signal<ChecklistState>(loadChecklist());

export function saveChecklist(): void {
  localStorage.setItem(LS_CHECKLIST_ITEMS, JSON.stringify(checklist.value));
}

export function markChecklist(key: keyof ChecklistState): void {
  if (checklist.value[key]) return; // already done
  checklist.value = { ...checklist.value, [key]: true };
  saveChecklist();
}

export const checklistComplete = computed<boolean>(() => {
  const c = checklist.value;
  return c.loaded && c.oriented && c.supported && c.sliced && c.exported;
});
