import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleKeydown, type ShortcutContext } from './keyboard-shortcuts';

function makeCtx(overrides: Partial<ShortcutContext> = {}): ShortcutContext {
  return {
    viewer: {
      selected: [],
      objects: [],
      removeSelected: vi.fn(),
      autoArrange: vi.fn(),
      selectAll: vi.fn(),
      duplicateSelected: vi.fn(),
      copySelected: vi.fn(),
      paste: vi.fn(),
      undo: vi.fn(),
      fillPlatform: vi.fn(),
    } as unknown as ShortcutContext['viewer'],
    showToolPanel: vi.fn(),
    getActiveToolPanel: () => 'edit',
    hasSlicedLayers: () => false,
    toggleSidebar: vi.fn(),
    ...overrides,
  };
}

function keyEvent(key: string, opts: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
}

describe('keyboard-shortcuts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('shouldIgnoreEvent', () => {
    it('ignores events from input elements', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      const ctx = makeCtx();
      const e = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
      Object.defineProperty(e, 'target', { value: input });
      handleKeydown(e, ctx);
      expect(ctx.viewer.autoArrange).not.toHaveBeenCalled();
    });

    it('ignores Escape key', () => {
      const ctx = makeCtx();
      handleKeydown(keyEvent('Escape'), ctx);
      expect(ctx.toggleSidebar).not.toHaveBeenCalled();
    });
  });

  describe('special keys', () => {
    it('h toggles sidebar', () => {
      const ctx = makeCtx();
      handleKeydown(keyEvent('h'), ctx);
      expect(ctx.toggleSidebar).toHaveBeenCalledOnce();
    });

    it('H toggles sidebar (case insensitive)', () => {
      const ctx = makeCtx();
      handleKeydown(keyEvent('H'), ctx);
      expect(ctx.toggleSidebar).toHaveBeenCalledOnce();
    });

    it('Delete calls removeSelected', () => {
      const ctx = makeCtx();
      handleKeydown(keyEvent('Delete'), ctx);
      expect(ctx.viewer.removeSelected).toHaveBeenCalledOnce();
    });

    it('Backspace calls removeSelected', () => {
      const ctx = makeCtx();
      handleKeydown(keyEvent('Backspace'), ctx);
      expect(ctx.viewer.removeSelected).toHaveBeenCalledOnce();
    });
  });

  describe('modifier combos', () => {
    it('Ctrl+A selects all', () => {
      const ctx = makeCtx();
      handleKeydown(keyEvent('a', { ctrlKey: true }), ctx);
      expect(ctx.viewer.selectAll).toHaveBeenCalledOnce();
    });

    it('Cmd+D duplicates selected', () => {
      const ctx = makeCtx();
      handleKeydown(keyEvent('d', { metaKey: true }), ctx);
      expect(ctx.viewer.duplicateSelected).toHaveBeenCalledOnce();
    });

    it('Ctrl+C copies', () => {
      const ctx = makeCtx();
      handleKeydown(keyEvent('c', { ctrlKey: true }), ctx);
      expect(ctx.viewer.copySelected).toHaveBeenCalledOnce();
    });

    it('Ctrl+V pastes', () => {
      const ctx = makeCtx();
      handleKeydown(keyEvent('v', { ctrlKey: true }), ctx);
      expect(ctx.viewer.paste).toHaveBeenCalledOnce();
    });

    it('Ctrl+Z undoes', () => {
      const ctx = makeCtx();
      handleKeydown(keyEvent('z', { ctrlKey: true }), ctx);
      expect(ctx.viewer.undo).toHaveBeenCalledOnce();
    });

    it('Ctrl+Shift+A auto-arranges', () => {
      const ctx = makeCtx();
      handleKeydown(keyEvent('a', { ctrlKey: true, shiftKey: true }), ctx);
      expect(ctx.viewer.autoArrange).toHaveBeenCalledOnce();
    });
  });

  describe('simple key bindings', () => {
    it('g auto-arranges', () => {
      const ctx = makeCtx();
      handleKeydown(keyEvent('g'), ctx);
      expect(ctx.viewer.autoArrange).toHaveBeenCalledOnce();
    });

    it('f fills platform', () => {
      const ctx = makeCtx();
      handleKeydown(keyEvent('f'), ctx);
      expect(ctx.viewer.fillPlatform).toHaveBeenCalledOnce();
    });
  });

  describe('numeric panel switching', () => {
    it('1 shows edit panel', () => {
      const ctx = makeCtx();
      handleKeydown(keyEvent('1'), ctx);
      expect(ctx.showToolPanel).toHaveBeenCalledWith('edit');
    });

    it('7 shows paint panel', () => {
      const ctx = makeCtx();
      handleKeydown(keyEvent('7'), ctx);
      expect(ctx.showToolPanel).toHaveBeenCalledWith('paint');
    });

    it('8 shows health panel', () => {
      const ctx = makeCtx();
      handleKeydown(keyEvent('8'), ctx);
      expect(ctx.showToolPanel).toHaveBeenCalledWith('health');
    });
  });

  describe('Tab panel cycling', () => {
    it('Tab cycles forward', () => {
      const ctx = makeCtx({ getActiveToolPanel: () => 'edit' });
      handleKeydown(keyEvent('Tab'), ctx);
      expect(ctx.showToolPanel).toHaveBeenCalledWith('transform');
    });

    it('Shift+Tab cycles backward', () => {
      const ctx = makeCtx({ getActiveToolPanel: () => 'edit' });
      handleKeydown(keyEvent('Tab', { shiftKey: true }), ctx);
      expect(ctx.showToolPanel).toHaveBeenCalledWith('slice');
    });
  });

  describe('space key', () => {
    it('shows transform panel when objects exist', () => {
      const ctx = makeCtx();
      (ctx.viewer as unknown as { objects: unknown[] }).objects = [{}];
      handleKeydown(keyEvent(' '), ctx);
      expect(ctx.showToolPanel).toHaveBeenCalledWith('transform');
    });

    it('does not show transform when no objects or selection', () => {
      const ctx = makeCtx();
      handleKeydown(keyEvent(' '), ctx);
      expect(ctx.showToolPanel).not.toHaveBeenCalled();
    });
  });
});
