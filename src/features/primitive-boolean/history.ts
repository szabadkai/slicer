/**
 * Undo history for boolean operations — stores geometry snapshots.
 * Each model gets its own stack of pre-operation positions.
 */
import { signal } from '@preact/signals-core';

const MAX_HISTORY = 10;

interface Snapshot {
  positions: Float32Array;
  name: string;
}

const stacks = signal<Map<string, Snapshot[]>>(new Map());

export function pushSnapshot(modelId: string, positions: Float32Array, name: string): void {
  const map = new Map(stacks.value);
  const stack = [...(map.get(modelId) ?? [])];
  stack.push({ positions: new Float32Array(positions), name });
  if (stack.length > MAX_HISTORY) {
    stack.shift();
  }
  map.set(modelId, stack);
  stacks.value = map;
}

export function popSnapshot(modelId: string): Snapshot | null {
  const map = new Map(stacks.value);
  const stack = map.get(modelId);
  if (!stack || stack.length === 0) return null;

  // Safe — length check above guarantees a value
  const snapshot = stack.pop() as Snapshot;
  if (stack.length === 0) {
    map.delete(modelId);
  } else {
    map.set(modelId, [...stack]);
  }
  stacks.value = map;
  return snapshot;
}

export function canUndo(modelId: string): boolean {
  const stack = stacks.value.get(modelId);
  return !!stack && stack.length > 0;
}

export function clearHistory(modelId: string): void {
  const map = new Map(stacks.value);
  map.delete(modelId);
  stacks.value = map;
}

export function clearAllHistory(): void {
  stacks.value = new Map();
}
