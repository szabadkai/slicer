import { describe, it, expect, beforeEach } from 'vitest';
import { pushSnapshot, popSnapshot, canUndo, clearHistory, clearAllHistory } from './history';

describe('boolean history', () => {
  beforeEach(() => {
    clearAllHistory();
  });

  it('pushSnapshot + popSnapshot round-trips', () => {
    const positions = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    pushSnapshot('model-1', positions, 'Test Model');

    expect(canUndo('model-1')).toBe(true);
    const snapshot = popSnapshot('model-1');
    expect(snapshot).not.toBeNull();
    expect(snapshot!.name).toBe('Test Model');
    expect(snapshot!.positions).toEqual(positions);
    expect(canUndo('model-1')).toBe(false);
  });

  it('returns null when no history', () => {
    expect(popSnapshot('nonexistent')).toBeNull();
    expect(canUndo('nonexistent')).toBe(false);
  });

  it('stores independent stacks per model', () => {
    const pos1 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const pos2 = new Float32Array([2, 0, 0, 0, 2, 0, 0, 0, 2]);
    pushSnapshot('m1', pos1, 'M1');
    pushSnapshot('m2', pos2, 'M2');

    expect(canUndo('m1')).toBe(true);
    expect(canUndo('m2')).toBe(true);

    const s1 = popSnapshot('m1');
    expect(s1!.positions[0]).toBe(1);
    expect(canUndo('m1')).toBe(false);
    expect(canUndo('m2')).toBe(true);
  });

  it('clearHistory removes a single model', () => {
    pushSnapshot('m1', new Float32Array(9), 'M1');
    pushSnapshot('m2', new Float32Array(9), 'M2');
    clearHistory('m1');
    expect(canUndo('m1')).toBe(false);
    expect(canUndo('m2')).toBe(true);
  });

  it('respects max depth of 10', () => {
    for (let i = 0; i < 15; i++) {
      pushSnapshot('m1', new Float32Array([i, 0, 0, 0, 0, 0, 0, 0, 0]), `Snap ${i}`);
    }

    // Should only have 10 entries; oldest (0-4) were evicted
    let count = 0;
    while (canUndo('m1')) {
      popSnapshot('m1');
      count++;
    }
    expect(count).toBe(10);
  });

  it('makes a defensive copy of positions', () => {
    const positions = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    pushSnapshot('m1', positions, 'Test');

    // Mutate original
    positions[0] = 999;

    const snapshot = popSnapshot('m1');
    expect(snapshot!.positions[0]).toBe(1); // original value preserved
  });
});
