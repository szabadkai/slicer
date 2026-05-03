/**
 * File handling — STL loading via drag-drop and file input.
 */
import type { AppContext } from '@core/types';
import { listen } from './utils';

export function mountFileHandling(ctx: AppContext): void {
  const { viewer } = ctx;
  const stlInput = document.getElementById('stl-input') as HTMLInputElement | null;
  const container = document.getElementById('viewport-container');

  listen(stlInput, 'change', (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    ctx.showProgress('Reading STL...');
    const reader = new FileReader();
    reader.onload = (evt) => {
      ctx.showProgress('Parsing STL...');
      setTimeout(() => {
        const buffer = evt.target?.result as ArrayBuffer;
        viewer.loadSTL(buffer);
        ctx.clearActivePlateSlice();
        ctx.updateEstimate();
        ctx.hideProgress();
      }, 50);
    };
    reader.readAsArrayBuffer(file);
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
    const reader = new FileReader();
    reader.onload = (evt) => {
      ctx.showProgress('Parsing STL...');
      setTimeout(() => {
        const buffer = evt.target?.result as ArrayBuffer;
        viewer.loadSTL(buffer);
        ctx.clearActivePlateSlice();
        ctx.updateEstimate();
        ctx.hideProgress();
      }, 50);
    };
    reader.readAsArrayBuffer(file);
  });
}
