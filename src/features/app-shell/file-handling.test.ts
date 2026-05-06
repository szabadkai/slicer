import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountFileHandling } from './file-handling';
import type { AppContext } from '@core/types';

function makeCtx(): AppContext {
  return {
    viewer: {
      loadSTL: vi.fn(),
    },
    showProgress: vi.fn(),
    hideProgress: vi.fn(),
    updateProgress: vi.fn(),
    clearActivePlateSlice: vi.fn(),
    updateEstimate: vi.fn(),
    showToolPanel: vi.fn(),
    scheduleProjectAutosave: vi.fn(),
    scheduleSavePreferences: vi.fn(),
    renderPlateTabs: vi.fn(),
  } as unknown as AppContext;
}

describe('mountFileHandling', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="stl-input" type="file" />
      <button id="browse-stl-btn"></button>
      <div id="viewport-container"></div>
      <div class="sample-model-grid">
        <button class="sample-model-card" data-model="chess-rook"></button>
      </div>
    `;
  });

  it('mounts without errors', () => {
    const ctx = makeCtx();
    expect(() => mountFileHandling(ctx)).not.toThrow();
  });

  it('adds dragover class on dragover', () => {
    const ctx = makeCtx();
    mountFileHandling(ctx);
    const container = document.getElementById('viewport-container')!;
    container.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    expect(container.classList.contains('drag-over')).toBe(true);
  });

  it('removes dragover class on dragleave', () => {
    const ctx = makeCtx();
    mountFileHandling(ctx);
    const container = document.getElementById('viewport-container')!;
    container.classList.add('drag-over');
    container.dispatchEvent(new Event('dragleave', { bubbles: true }));
    expect(container.classList.contains('drag-over')).toBe(false);
  });

  it('handles file input change with STL file', async () => {
    const ctx = makeCtx();
    mountFileHandling(ctx);

    const input = document.getElementById('stl-input') as HTMLInputElement;
    const buffer = new ArrayBuffer(84); // minimal STL header
    const file = new File([buffer], 'model.stl', { type: 'application/octet-stream' });

    // Simulate file selection
    Object.defineProperty(input, 'files', { value: [file], writable: false });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(ctx.showProgress).toHaveBeenCalledWith('Reading file...');
  });

  it('ignores file input with no file', () => {
    const ctx = makeCtx();
    mountFileHandling(ctx);

    const input = document.getElementById('stl-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [], writable: false });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(ctx.showProgress).not.toHaveBeenCalled();
  });
});
