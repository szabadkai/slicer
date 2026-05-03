import { describe, it, expect, vi } from 'vitest';
import { createCommandBus } from './commands';

describe('command bus', () => {
  it('dispatches to registered handler', () => {
    const bus = createCommandBus();
    const handler = vi.fn();
    bus.on('slice', handler);

    bus.dispatch('slice', { plateId: 'p1' });
    expect(handler).toHaveBeenCalledWith({ plateId: 'p1' });
  });

  it('supports multiple handlers for the same command', () => {
    const bus = createCommandBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('slice', h1);
    bus.on('slice', h2);

    bus.dispatch('slice', { plateId: 'p1' });
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('unsubscribe removes handler', () => {
    const bus = createCommandBus();
    const handler = vi.fn();
    const unsub = bus.on('slice', handler);

    unsub();
    bus.dispatch('slice', { plateId: 'p1' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('dispatch with no handlers does not throw', () => {
    const bus = createCommandBus();
    expect(() => bus.dispatch('cancel-slice', undefined)).not.toThrow();
  });

  it('handlers for different commands are isolated', () => {
    const bus = createCommandBus();
    const sliceHandler = vi.fn();
    const exportHandler = vi.fn();
    bus.on('slice', sliceHandler);
    bus.on('export', exportHandler);

    bus.dispatch('slice', { plateId: 'p1' });
    expect(sliceHandler).toHaveBeenCalledOnce();
    expect(exportHandler).not.toHaveBeenCalled();
  });
});
