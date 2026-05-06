/**
 * Layer preview — canvas rendering + slider + inspector modal opening.
 */
import type { AppContext } from '@core/types';
import type { LegacySlicer } from '@core/legacy-types';
import { listen } from '@features/app-shell/utils';
import { getSlicedLayerCount } from '@features/app-shell/mount';
import { slicedLayers } from './ops';
import { detectIslands, summarizeIslands } from './island-detector';

export function mountLayerPreview(_ctx: AppContext, slicer: LegacySlicer): void {
  const layerCanvas = document.getElementById('layer-canvas') as HTMLCanvasElement | null;
  const layerSlider = document.getElementById('layer-slider') as HTMLInputElement | null;
  const layerInfo = document.getElementById('layer-info');
  const layerExpandBtn = document.getElementById('layer-expand-btn');

  const layerHeightInput = document.getElementById('layer-height') as HTMLInputElement | null;
  function getLayerHeight(): number {
    return Number.parseFloat(layerHeightInput?.value ?? '0.05');
  }

  function showLayer(): void {
    const count = getSlicedLayerCount();
    if (count === 0) return;

    const idx = parseInt(layerSlider?.value ?? '0', 10);
    if (layerInfo) layerInfo.textContent = `${idx + 1} / ${count}`;

    if (!layerCanvas) return;
    const spec = slicer.getPrinterSpec();
    const pixels = slicer.renderLayer(idx, getLayerHeight());

    const aspectRatio = spec.resolutionX / spec.resolutionY;
    const previewW = 512;
    const previewH = Math.round(previewW / aspectRatio);
    layerCanvas.width = previewW;
    layerCanvas.height = previewH;

    const drawCtx = layerCanvas.getContext('2d');
    if (!drawCtx) return;

    // Full-res temp canvas, flip vertically (WebGL bottom-up)
    const temp = document.createElement('canvas');
    temp.width = spec.resolutionX;
    temp.height = spec.resolutionY;
    const tempCtx = temp.getContext('2d');
    if (!tempCtx) return;

    const clampedData = new Uint8ClampedArray(pixels.length);
    clampedData.set(pixels);
    const imageData = new ImageData(clampedData, spec.resolutionX, spec.resolutionY);
    tempCtx.putImageData(imageData, 0, 0);

    drawCtx.clearRect(0, 0, previewW, previewH);
    drawCtx.save();
    drawCtx.scale(1, -1);
    drawCtx.drawImage(temp, 0, -previewH, previewW, previewH);
    drawCtx.restore();
  }

  listen(layerSlider, 'input', showLayer);

  // Inspector modal
  const inspectorModal = document.getElementById('layer-inspector');
  const inspectorClose = document.getElementById('layer-inspector-close');
  const inspectorSlider = document.getElementById('inspector-slider') as HTMLInputElement | null;
  const inspectorLayerInfo = document.getElementById('inspector-layer-info');
  const inspectorGoto = document.getElementById('inspector-goto') as HTMLInputElement | null;
  const inspectorPrev = document.getElementById('inspector-prev');
  const inspectorNext = document.getElementById('inspector-next');
  const inspectorCanvas = document.getElementById('inspector-canvas') as HTMLCanvasElement | null;

  function renderInspectorLayer(idx: number): void {
    const count = getSlicedLayerCount();
    if (count === 0 || !inspectorCanvas) return;
    if (idx < 0 || idx >= count) return;
    const spec = slicer.getPrinterSpec();
    const pixels = slicer.renderLayer(idx, getLayerHeight());

    const resX = spec.resolutionX;
    const resY = spec.resolutionY;
    inspectorCanvas.width = resX;
    inspectorCanvas.height = resY;
    const ictx = inspectorCanvas.getContext('2d');
    if (!ictx) return;

    const clampedData = new Uint8ClampedArray(pixels.length);
    clampedData.set(pixels);
    const imageData = new ImageData(clampedData, resX, resY);
    ictx.putImageData(imageData, 0, 0);

    if (inspectorLayerInfo) inspectorLayerInfo.textContent = `${idx + 1} / ${count}`;
    if (inspectorGoto) inspectorGoto.value = String(idx + 1);
  }

  function inspectorGoToLayer(idx: number): void {
    const count = getSlicedLayerCount();
    if (count === 0) return;
    const clamped = Math.max(0, Math.min(idx, count - 1));
    if (inspectorSlider) inspectorSlider.value = String(clamped);
    renderInspectorLayer(clamped);
  }

  function openInspector(): void {
    const count = getSlicedLayerCount();
    if (count === 0 || !inspectorModal) return;
    inspectorModal.hidden = false;
    if (inspectorSlider) inspectorSlider.max = String(count - 1);
    if (inspectorGoto) inspectorGoto.max = String(count);
    const idx = parseInt(layerSlider?.value ?? '0', 10);
    inspectorGoToLayer(idx);
  }

  function closeInspector(): void {
    if (!inspectorModal) return;
    inspectorModal.hidden = true;
    if (getSlicedLayerCount() > 0 && layerSlider && inspectorSlider) {
      layerSlider.value = inspectorSlider.value;
      showLayer();
    }
  }

  listen(layerExpandBtn, 'click', openInspector);
  listen(layerCanvas, 'dblclick', openInspector);
  listen(inspectorClose, 'click', closeInspector);
  listen(inspectorSlider, 'input', () => {
    inspectorGoToLayer(parseInt(inspectorSlider?.value ?? '0', 10));
  });
  listen(inspectorPrev, 'click', () => {
    inspectorGoToLayer(parseInt(inspectorSlider?.value ?? '0', 10) - 1);
  });
  listen(inspectorNext, 'click', () => {
    inspectorGoToLayer(parseInt(inspectorSlider?.value ?? '0', 10) + 1);
  });
  listen(inspectorGoto, 'change', () => {
    inspectorGoToLayer(parseInt(inspectorGoto?.value ?? '1', 10) - 1);
  });

  // Inspector keyboard nav
  document.addEventListener('keydown', (e) => {
    if (!inspectorModal || inspectorModal.hidden) return;
    if (e.key === 'Escape') {
      closeInspector();
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const cur = parseInt(inspectorSlider?.value ?? '0', 10);
      inspectorGoToLayer(e.key === 'ArrowRight' ? cur + 1 : cur - 1);
      return;
    }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const cur = parseInt(inspectorSlider?.value ?? '0', 10);
      inspectorGoToLayer(e.key === 'PageDown' ? cur + 10 : cur - 10);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      inspectorGoToLayer(0);
    }
    if (e.key === 'End') {
      e.preventDefault();
      const count = getSlicedLayerCount();
      if (count > 0) inspectorGoToLayer(count - 1);
    }
  });

  // ─── Island detection ────────────────────────────────────────────
  const islandDetectBtn = document.getElementById('island-detect-btn');
  const islandResults = document.getElementById('island-results');

  listen(islandDetectBtn, 'click', () => {
    const layers = slicedLayers.value;
    if (layers.length === 0 || !islandResults) return;

    const spec = slicer.getPrinterSpec();
    const results = detectIslands(layers, spec.resolutionX);
    const summary = summarizeIslands(results);

    if (results.length === 0) {
      islandResults.innerHTML = `<div class="island-ok">✅ ${summary}</div>`;
    } else {
      const worst = results.reduce((a, b) => (b.islandCount > a.islandCount ? b : a));
      islandResults.innerHTML = `
        <div class="island-warn">⚠ ${summary}</div>
        <div class="island-detail">Worst: layer ${worst.layerIndex + 1} (${worst.islandCount} island${worst.islandCount > 1 ? 's' : ''})</div>
        <button class="btn btn-small island-goto-btn" data-layer="${worst.layerIndex}">Go to layer</button>
      `;
      islandResults.querySelector('.island-goto-btn')?.addEventListener('click', () => {
        if (layerSlider) {
          layerSlider.value = String(worst.layerIndex);
          showLayer();
        }
      });
    }
  });
}
