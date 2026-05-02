export function createPlate(index) {
  return {
    id: `plate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: `Plate ${index}`,
    objects: [],
    selectedIds: [],
    originX: 0,
    originZ: 0,
    slicedLayers: null,
    slicedVolumes: null,
    dirty: true,
  };
}

export function clearPlateSlice(plate) {
  if (!plate) return;
  plate.slicedLayers = null;
  plate.slicedVolumes = null;
  plate.dirty = true;
}

export function renumberDefaultPlateNames(plates) {
  plates.forEach((plate, index) => {
    if (/^Plate \d+$/.test(plate.name)) {
      plate.name = `Plate ${index + 1}`;
    }
  });
}
