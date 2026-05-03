import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTransform,
  setTransform,
  translate,
  rotate,
  scale,
  dropToPlate,
  undo,
  redo,
  canUndo,
  canRedo,
  resetUndoState,
  identityTransform,
  uniformScale,
  gizmoMode,
} from './ops';

beforeEach(() => {
  resetUndoState();
  uniformScale.value = true;
  gizmoMode.value = 'translate';
});

describe('model-transform ops', () => {
  it('getTransform returns identity for unknown model', () => {
    const t = getTransform('unknown');
    expect(t).toEqual(identityTransform());
  });

  it('translate adds to position', () => {
    translate('m1', 10, 0, 5);
    const t = getTransform('m1');
    expect(t.positionX).toBe(10);
    expect(t.positionZ).toBe(5);
  });

  it('rotate adds to rotation', () => {
    rotate('m1', 0, 0, 90);
    expect(getTransform('m1').rotationZ).toBe(90);
  });

  it('uniform scale applies same value to all axes', () => {
    uniformScale.value = true;
    scale('m1', 2, 3, 4);
    const t = getTransform('m1');
    expect(t.scaleX).toBe(2);
    expect(t.scaleY).toBe(2);
    expect(t.scaleZ).toBe(2);
  });

  it('non-uniform scale applies per-axis', () => {
    uniformScale.value = false;
    scale('m1', 2, 3, 4);
    const t = getTransform('m1');
    expect(t.scaleX).toBe(2);
    expect(t.scaleY).toBe(3);
    expect(t.scaleZ).toBe(4);
  });

  it('dropToPlate sets model min-Z to 0', () => {
    translate('m1', 5, 0, 12);
    dropToPlate('m1', 12);
    const t = getTransform('m1');
    expect(t.positionZ).toBe(0);
    expect(t.positionX).toBe(5); // unchanged
  });

  it('setTransform records in undo stack', () => {
    expect(canUndo()).toBe(false);
    setTransform('m1', { ...identityTransform(), positionX: 10 });
    expect(canUndo()).toBe(true);
  });

  it('undo reverts to previous transform', () => {
    translate('m1', 10, 0, 0);
    translate('m1', 5, 0, 0); // position = 15
    expect(getTransform('m1').positionX).toBe(15);

    undo();
    expect(getTransform('m1').positionX).toBe(10);
  });

  it('redo re-applies undone transform', () => {
    translate('m1', 10, 0, 0);
    undo();
    expect(getTransform('m1').positionX).toBe(0);
    redo();
    expect(getTransform('m1').positionX).toBe(10);
  });

  it('new action after undo clears redo stack', () => {
    translate('m1', 10, 0, 0);
    undo();
    translate('m1', 20, 0, 0);
    expect(canRedo()).toBe(false);
  });

  it('undo returns false on empty stack', () => {
    expect(undo()).toBe(false);
  });

  it('redo returns false on empty stack', () => {
    expect(redo()).toBe(false);
  });
});
