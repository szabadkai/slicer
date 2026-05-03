// ─── Model transform operations & undo/redo ────────────────
import { signal, batch } from '@preact/signals-core';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

export interface Transform {
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

export function identityTransform(): Transform {
  return {
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
  };
}

// ─── Per-model transforms ──────────────────────────────────

export const transforms = signal<Map<string, Transform>>(new Map());
export const gizmoMode = signal<GizmoMode>('translate');
export const uniformScale = signal(true);

export function getTransform(modelId: string): Transform {
  return transforms.value.get(modelId) ?? identityTransform();
}

export function setTransform(modelId: string, transform: Transform): void {
  pushUndo(modelId, getTransform(modelId));
  applyTransform(modelId, transform);
}

export function translate(modelId: string, dx: number, dy: number, dz: number): void {
  const t = getTransform(modelId);
  setTransform(modelId, {
    ...t,
    positionX: t.positionX + dx,
    positionY: t.positionY + dy,
    positionZ: t.positionZ + dz,
  });
}

export function rotate(modelId: string, rx: number, ry: number, rz: number): void {
  const t = getTransform(modelId);
  setTransform(modelId, {
    ...t,
    rotationX: t.rotationX + rx,
    rotationY: t.rotationY + ry,
    rotationZ: t.rotationZ + rz,
  });
}

export function scale(modelId: string, sx: number, sy: number, sz: number): void {
  const t = getTransform(modelId);
  if (uniformScale.value) {
    setTransform(modelId, { ...t, scaleX: sx, scaleY: sx, scaleZ: sx });
  } else {
    setTransform(modelId, { ...t, scaleX: sx, scaleY: sy, scaleZ: sz });
  }
}

export function dropToPlate(modelId: string, minZ: number): void {
  const t = getTransform(modelId);
  setTransform(modelId, {
    ...t,
    positionZ: t.positionZ - minZ,
  });
}

// ─── Undo / redo ───────────────────────────────────────────

interface UndoEntry {
  modelId: string;
  transform: Transform;
}

const MAX_UNDO = 20;
const undoStack = signal<UndoEntry[]>([]);
const redoStack = signal<UndoEntry[]>([]);

function pushUndo(modelId: string, transform: Transform): void {
  const stack = [...undoStack.value, { modelId, transform }];
  if (stack.length > MAX_UNDO) stack.shift();
  undoStack.value = stack;
  redoStack.value = []; // new action clears redo
}

export function undo(): boolean {
  const stack = undoStack.value;
  if (stack.length === 0) return false;

  const entry = stack[stack.length - 1];
  const currentTransform = getTransform(entry.modelId);

  batch(() => {
    undoStack.value = stack.slice(0, -1);
    redoStack.value = [...redoStack.value, { modelId: entry.modelId, transform: currentTransform }];
    applyTransform(entry.modelId, entry.transform);
  });

  return true;
}

export function redo(): boolean {
  const stack = redoStack.value;
  if (stack.length === 0) return false;

  const entry = stack[stack.length - 1];
  const currentTransform = getTransform(entry.modelId);

  batch(() => {
    redoStack.value = stack.slice(0, -1);
    undoStack.value = [...undoStack.value, { modelId: entry.modelId, transform: currentTransform }];
    applyTransform(entry.modelId, entry.transform);
  });

  return true;
}

export function canUndo(): boolean {
  return undoStack.value.length > 0;
}

export function canRedo(): boolean {
  return redoStack.value.length > 0;
}

// Reset (for tests)
export function resetUndoState(): void {
  undoStack.value = [];
  redoStack.value = [];
  transforms.value = new Map();
}

// ─── Internal ──────────────────────────────────────────────

function applyTransform(modelId: string, transform: Transform): void {
  const next = new Map(transforms.value);
  next.set(modelId, transform);
  transforms.value = next;
}
