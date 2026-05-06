/**
 * File handling — STL loading via browse button, drag-drop, and sample models.
 */
import type { AppContext } from '@core/types';
import { listen } from './utils';

function loadStlBuffer(ctx: AppContext, buffer: ArrayBuffer): void {
  ctx.showProgress('Parsing STL...');
  setTimeout(() => {
    ctx.viewer.loadSTL(buffer);
    ctx.clearActivePlateSlice();
    ctx.updateEstimate();
    ctx.hideProgress();
  }, 50);
}

export function mountFileHandling(ctx: AppContext): void {
  const stlInput = document.getElementById('stl-input') as HTMLInputElement | null;
  const browseBtn = document.getElementById('browse-stl-btn');
  const container = document.getElementById('viewport-container');
  const sampleGrid = document.querySelector('.sample-model-grid');

  // Browse button triggers hidden file input
  listen(browseBtn, 'click', () => {
    stlInput?.click();
  });

  listen(stlInput, 'change', (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    ctx.showProgress('Reading STL...');
    file.arrayBuffer().then((buffer) => {
      loadStlBuffer(ctx, buffer);
    });
  });

  // Drag and drop
  listen(container, 'dragover', (e) => {
    e.preventDefault();
    container?.classList.add('drag-over');
  });
  listen(container, 'dragleave', () => {
    container?.classList.remove('drag-over');
  });
  listen(container, 'drop', (e) => {
    e.preventDefault();
    container?.classList.remove('drag-over');
    const dt = (e as DragEvent).dataTransfer;
    const file = dt?.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'stl') return;
    ctx.showProgress('Reading STL...');
    file.arrayBuffer().then((buffer) => {
      loadStlBuffer(ctx, buffer);
    });
  });

  // Sample model cards
  listen(sampleGrid, 'click', (e) => {
    const card = (e.target as HTMLElement).closest('[data-model]') as HTMLElement | null;
    if (!card) return;
    const modelName = card.dataset.model;
    if (!modelName) return;

    const url = `${import.meta.env.BASE_URL}models/${modelName}.stl`;
    ctx.showProgress(`Loading ${modelName}...`);
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buffer) => {
        loadStlBuffer(ctx, buffer);
      })
      .catch((err) => {
        console.error('Failed to load sample model:', err);
        ctx.hideProgress();
      });
  });
}
