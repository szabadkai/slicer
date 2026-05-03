import type { LegacyPlate } from '@core/legacy-types';

export function createPlate(index: number): LegacyPlate {
  return {
    id: `plate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: `Plate ${index}`,
    objects: [],
    selectedIds: [],
    originX: 0,
    originZ: 0,
    slicedLayers: null,
    slicedLayerCount: 0,
    slicedVolumes: null,
    dirty: true,
  };
}

export function clearPlateSlice(plate: LegacyPlate | null): void {
  if (!plate) return;
  plate.slicedLayers = null;
  plate.slicedLayerCount = 0;
  plate.slicedVolumes = null;
  plate.dirty = true;
}

export function renumberDefaultPlateNames(plates: LegacyPlate[]): void {
  plates.forEach((plate, index) => {
    if (/^Plate \d+$/.test(plate.name)) {
      plate.name = `Plate ${index + 1}`;
    }
  });
}
