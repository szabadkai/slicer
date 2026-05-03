import { effect } from '@preact/signals-core';
import {
  plates,
  activePlateId,
  selectedMaterialId,
  selectedPrinterKey,
  sliceParams,
} from '@core/state';

const STORAGE_KEY = 'slicelab-autosave';
const DEBOUNCE_MS = 1000;

export interface AutosaveSnapshot {
  version: number;
  timestamp: number;
  plates: typeof plates.value;
  activePlateId: string;
  materialId: string;
  printerKey: string;
  sliceParams: typeof sliceParams.value;
}

export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const dispose = effect(() => {
    // Track all relevant signals so the effect re-runs on any change
    void plates.value;
    void activePlateId.value;
    void selectedMaterialId.value;
    void selectedPrinterKey.value;
    void sliceParams.value;

    if (timer) clearTimeout(timer);
    timer = setTimeout(saveSnapshot, DEBOUNCE_MS);
  });

  return () => {
    dispose();
    if (timer) clearTimeout(timer);
  };
}

export function saveSnapshot(): void {
  const snapshot: AutosaveSnapshot = {
    version: 1,
    timestamp: Date.now(),
    plates: plates.value,
    activePlateId: activePlateId.value,
    materialId: selectedMaterialId.value,
    printerKey: selectedPrinterKey.value,
    sliceParams: sliceParams.value,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    console.warn('Autosave failed: localStorage may be full');
  }
}

export function loadSnapshot(): AutosaveSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AutosaveSnapshot;
  } catch {
    return null;
  }
}

export function restoreSnapshot(snapshot: AutosaveSnapshot): void {
  plates.value = snapshot.plates;
  activePlateId.value = snapshot.activePlateId;
  selectedMaterialId.value = snapshot.materialId;
  selectedPrinterKey.value = snapshot.printerKey;
  sliceParams.value = snapshot.sliceParams;
}

export function discardSnapshot(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasAutosave(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}
