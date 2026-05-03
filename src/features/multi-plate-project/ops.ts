import { batch } from '@preact/signals-core';
import { plates, activePlateId } from '@core/state';
import type { Plate } from '@core/types';

export function createPlate(index: number): Plate {
  return {
    id: `plate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: `Plate ${index}`,
    models: [],
    selectedIds: [],
    originX: 0,
    originZ: 0,
    dirty: true,
  };
}

export function addPlate(): Plate {
  const newPlate = createPlate(plates.value.length + 1);
  batch(() => {
    plates.value = [...plates.value, newPlate];
    activePlateId.value = newPlate.id;
  });
  return newPlate;
}

export function removePlate(plateId: string): boolean {
  const current = plates.value;
  if (current.length <= 1) return false;

  const idx = current.findIndex((p) => p.id === plateId);
  if (idx === -1) return false;

  const remaining = current.filter((p) => p.id !== plateId);
  renumberDefaultNames(remaining);

  batch(() => {
    plates.value = remaining;
    if (activePlateId.value === plateId) {
      const newIdx = Math.min(idx, remaining.length - 1);
      activePlateId.value = remaining[newIdx].id;
    }
  });

  return true;
}

export function renamePlate(plateId: string, newName: string): void {
  plates.value = plates.value.map((p) => (p.id === plateId ? { ...p, name: newName } : p));
}

export function switchPlate(plateId: string): void {
  if (plates.value.some((p) => p.id === plateId)) {
    activePlateId.value = plateId;
  }
}

export function clearPlateSlice(plateId: string): void {
  plates.value = plates.value.map((p) =>
    p.id === plateId ? { ...p, dirty: true } : p,
  );
}

export function renumberDefaultNames(plateList: Plate[]): void {
  let defaultIdx = 1;
  for (let i = 0; i < plateList.length; i++) {
    if (/^Plate \d+$/.test(plateList[i].name)) {
      plateList[i] = { ...plateList[i], name: `Plate ${defaultIdx}` };
      defaultIdx++;
    }
  }
}
