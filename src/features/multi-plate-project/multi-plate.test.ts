import { describe, it, expect, beforeEach } from 'vitest';
import { plates, activePlateId } from '@core/state';
import {
  createPlate,
  addPlate,
  removePlate,
  renamePlate,
  switchPlate,
  renumberDefaultNames,
} from './ops';
import { arrangeModels, hasOverlap } from './arrange';
import type { BoundingBox } from './arrange';

beforeEach(() => {
  plates.value = [];
  activePlateId.value = '';
});

describe('plate operations', () => {
  it('createPlate generates unique ids and correct default name', () => {
    const p1 = createPlate(1);
    const p2 = createPlate(2);
    expect(p1.id).not.toBe(p2.id);
    expect(p1.name).toBe('Plate 1');
    expect(p2.name).toBe('Plate 2');
    expect(p1.dirty).toBe(true);
  });

  it('addPlate appends and activates the new plate', () => {
    const initial = createPlate(1);
    plates.value = [initial];
    activePlateId.value = initial.id;

    const added = addPlate();

    expect(plates.value.length).toBe(2);
    expect(activePlateId.value).toBe(added.id);
    expect(added.name).toBe('Plate 2');
  });

  it('removePlate deletes plate and activates a neighbor', () => {
    const p1 = createPlate(1);
    const p2 = createPlate(2);
    const p3 = createPlate(3);
    plates.value = [p1, p2, p3];
    activePlateId.value = p2.id;

    const result = removePlate(p2.id);

    expect(result).toBe(true);
    expect(plates.value.length).toBe(2);
    expect(plates.value.find((p) => p.id === p2.id)).toBeUndefined();
    expect(activePlateId.value).not.toBe(p2.id);
  });

  it('removePlate refuses to delete the last plate', () => {
    const p1 = createPlate(1);
    plates.value = [p1];
    activePlateId.value = p1.id;

    const result = removePlate(p1.id);

    expect(result).toBe(false);
    expect(plates.value.length).toBe(1);
  });

  it('renamePlate updates the plate name', () => {
    const p1 = createPlate(1);
    plates.value = [p1];

    renamePlate(p1.id, 'Bases');

    expect(plates.value[0].name).toBe('Bases');
  });

  it('switchPlate changes the active plate', () => {
    const p1 = createPlate(1);
    const p2 = createPlate(2);
    plates.value = [p1, p2];
    activePlateId.value = p1.id;

    switchPlate(p2.id);

    expect(activePlateId.value).toBe(p2.id);
  });

  it('switchPlate ignores nonexistent id', () => {
    const p1 = createPlate(1);
    plates.value = [p1];
    activePlateId.value = p1.id;

    switchPlate('nonexistent');

    expect(activePlateId.value).toBe(p1.id);
  });
});

describe('renumberDefaultNames', () => {
  it('renumbers default-named plates sequentially', () => {
    const list = [
      { ...createPlate(1), name: 'Plate 1' },
      { ...createPlate(3), name: 'Plate 3' },
    ];

    renumberDefaultNames(list);

    expect(list[0].name).toBe('Plate 1');
    expect(list[1].name).toBe('Plate 2');
  });

  it('preserves custom names during renumbering', () => {
    const list = [
      { ...createPlate(1), name: 'Bases' },
      { ...createPlate(2), name: 'Plate 2' },
    ];

    renumberDefaultNames(list);

    expect(list[0].name).toBe('Bases');
    expect(list[1].name).toBe('Plate 1');
  });
});

describe('arrange algorithm', () => {
  it('places non-overlapping boxes within build area', () => {
    const boxes: BoundingBox[] = [
      { id: 'a', width: 30, depth: 30 },
      { id: 'b', width: 30, depth: 30 },
      { id: 'c', width: 30, depth: 30 },
    ];

    const result = arrangeModels(boxes, 100, 100);

    expect(result.placed.length).toBe(3);
    expect(result.overflow.length).toBe(0);
    expect(hasOverlap(result.placed)).toBe(false);
  });

  it('reports overflow when models exceed build area', () => {
    const boxes: BoundingBox[] = [
      { id: 'a', width: 60, depth: 60 },
      { id: 'b', width: 60, depth: 60 },
    ];

    const result = arrangeModels(boxes, 100, 50);

    expect(result.overflow.length).toBeGreaterThan(0);
  });

  it('rejects models larger than build plate', () => {
    const boxes: BoundingBox[] = [{ id: 'a', width: 200, depth: 50 }];

    const result = arrangeModels(boxes, 100, 100);

    expect(result.overflow).toContain('a');
    // Overflow model is still placed (outside build area) with overflow flag
    expect(result.placed.length).toBe(1);
    expect(result.placed[0].overflow).toBe(true);
    expect(result.placed[0].x).toBeGreaterThanOrEqual(100);
  });

  it('wraps to next row when width is exceeded', () => {
    const boxes: BoundingBox[] = [
      { id: 'a', width: 40, depth: 20 },
      { id: 'b', width: 40, depth: 20 },
      { id: 'c', width: 40, depth: 20 },
    ];

    const result = arrangeModels(boxes, 90, 100);

    expect(result.placed.length).toBe(3);
    expect(hasOverlap(result.placed)).toBe(false);
    // Third box should be on a new row
    const cBox = result.placed.find((p) => p.id === 'c');
    expect(cBox!.z).toBeGreaterThan(0);
  });

  it('places overflow models outside build area without overlap', () => {
    const boxes: BoundingBox[] = [
      { id: 'a', width: 200, depth: 50 },
      { id: 'b', width: 150, depth: 80 },
    ];

    const result = arrangeModels(boxes, 100, 100);

    // Both overflow (larger than build area)
    expect(result.overflow).toContain('a');
    expect(result.overflow).toContain('b');
    // But they are still placed (with overflow flag)
    const overflowPlaced = result.placed.filter((p) => p.overflow);
    expect(overflowPlaced.length).toBe(2);
    // Placed outside build area (+X side)
    for (const p of overflowPlaced) {
      expect(p.x).toBeGreaterThanOrEqual(100);
    }
    // No overlap among overflow placements
    expect(hasOverlap(overflowPlaced)).toBe(false);
  });

  it('overflow models do not overlap in-bounds models', () => {
    // 3 models that fit + 1 that does not
    const boxes: BoundingBox[] = [
      { id: 'a', width: 40, depth: 40 },
      { id: 'b', width: 40, depth: 40 },
      { id: 'c', width: 40, depth: 40 },
      { id: 'd', width: 200, depth: 50 },
    ];

    const result = arrangeModels(boxes, 100, 100);

    expect(result.overflow).toContain('d');
    // All 4 are placed (3 in-bounds + 1 overflow)
    expect(result.placed.length).toBe(4);
    expect(hasOverlap(result.placed)).toBe(false);
  });
});
