/**
 * Layer preview — canvas rendering + slider + inspector modal opening.
 */
import type { AppContext } from '@core/types';
import type { LegacySlicer } from '@core/legacy-types';
import { listen } from '@features/app-shell/utils';
import { getSlicedLayerCount } from '@features/app-shell/mount';
import { slicedLayers } from './ops';
import { detectIslands, summarizeIslands } from './island-detector';
import { computePeelForceProfile, renderPeelForceChart, type PeelForceProfile } from './peel-force';
import { buildSliceQaIssues, summarizeQaIssues, type SliceQaIssue } from './qa-detector';

export function mountLayerPreview(ctx: AppContext, slicer: LegacySlicer): void {
  const { viewer } = ctx;
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
  const inspectorScanAll = document.getElementById('inspector-scan-all');
  const inspectorScanStatus = document.getElementById('inspector-scan-status');
  const inspectorIssues = document.getElementById('inspector-issues');
  const inspectorIssuePrev = document.getElementById(
    'inspector-issue-prev',
  ) as HTMLButtonElement | null;
  const inspectorIssueNext = document.getElementById(
    'inspector-issue-next',
  ) as HTMLButtonElement | null;
  const inspectorIssuePos = document.getElementById('inspector-issue-pos');
  let currentQaIssues: SliceQaIssue[] = [];
  let activeQaIssueIndex = 0;

  function runSliceQa(): SliceQaIssue[] {
    const layers = slicedLayers.value;
    if (layers.length === 0) return [];

    const spec = slicer.getPrinterSpec();
    const results = detectIslands(layers, spec.resolutionX);
    const issues = buildSliceQaIssues(layers, spec.resolutionX, results, currentPeelProfile);
    currentQaIssues = issues;
    activeQaIssueIndex = 0;
    renderQaSummary(issues, summarizeIslands(results));
    renderInspectorIssues();
    return issues;
  }

  function renderQaSummary(issues: SliceQaIssue[], islandSummary: string): void {
    if (!islandResults) return;
    const summary = summarizeQaIssues(issues);
    if (issues.length === 0) {
      islandResults.innerHTML = `<div class="island-ok">${escapeHtml(summary)}</div><div class="island-detail">${escapeHtml(islandSummary)}</div>`;
      return;
    }
    islandResults.innerHTML = `
      <div class="island-warn">${escapeHtml(summary)}</div>
      <div class="qa-issue-list">
        ${issues.slice(0, 8).map(renderQaIssueButton).join('')}
      </div>
    `;
    islandResults.querySelectorAll<HTMLButtonElement>('[data-qa-layer]').forEach((button) => {
      listen(button, 'click', () => {
        goToQaIssue(Number.parseInt(button.dataset.qaIndex ?? '0', 10), false);
      });
    });
  }

  function renderQaIssueButton(issue: SliceQaIssue, index: number): string {
    return `<button type="button" class="qa-issue qa-issue-${issue.severity}" data-qa-layer="${issue.layerIndex}" data-qa-index="${index}">
      <span class="qa-issue-title">${escapeHtml(issue.title)}</span>
      <span class="qa-issue-detail">L${issue.layerIndex + 1} · ${escapeHtml(issue.detail)}</span>
    </button>`;
  }

  function renderInspectorIssues(): void {
    if (inspectorScanStatus) inspectorScanStatus.textContent = summarizeQaIssues(currentQaIssues);
    if (inspectorIssuePrev) inspectorIssuePrev.disabled = currentQaIssues.length < 2;
    if (inspectorIssueNext) inspectorIssueNext.disabled = currentQaIssues.length < 2;
    if (inspectorIssuePos) {
      inspectorIssuePos.textContent =
        currentQaIssues.length === 0 ? '' : `${activeQaIssueIndex + 1} / ${currentQaIssues.length}`;
    }
    if (!inspectorIssues) return;
    if (currentQaIssues.length === 0) {
      inspectorIssues.innerHTML = '<span class="inspector-no-issues">No issues detected</span>';
      return;
    }
    inspectorIssues.innerHTML = currentQaIssues.map(renderInspectorIssue).join('');
    inspectorIssues
      .querySelectorAll<HTMLButtonElement>('[data-inspector-issue]')
      .forEach((button) => {
        listen(button, 'click', () => {
          goToQaIssue(Number.parseInt(button.dataset.inspectorIssue ?? '0', 10), true);
        });
      });
  }

  function renderInspectorIssue(issue: SliceQaIssue, index: number): string {
    const active = index === activeQaIssueIndex ? ' active' : '';
    return `<button type="button" class="inspector-issue-item qa-issue-${issue.severity}${active}" data-inspector-issue="${index}">
      <span>${escapeHtml(issue.title)}</span>
      <small>L${issue.layerIndex + 1} · ${escapeHtml(issue.detail)}</small>
    </button>`;
  }

  function goToQaIssue(index: number, keepInspectorOpen: boolean): void {
    if (currentQaIssues.length === 0) return;
    activeQaIssueIndex = Math.max(0, Math.min(index, currentQaIssues.length - 1));
    const issue = currentQaIssues[activeQaIssueIndex];
    if (layerSlider) {
      layerSlider.value = String(issue.layerIndex);
      showLayer();
    }
    if (keepInspectorOpen || inspectorModal?.hidden === false) {
      openInspector();
      inspectorGoToLayer(issue.layerIndex);
    }
    renderInspectorIssues();
  }

  function stepQaIssue(delta: number): void {
    if (currentQaIssues.length === 0) return;
    goToQaIssue(
      (activeQaIssueIndex + delta + currentQaIssues.length) % currentQaIssues.length,
      true,
    );
  }

  listen(islandDetectBtn, 'click', () => {
    runSliceQa();
  });
  listen(inspectorScanAll, 'click', runSliceQa);
  listen(inspectorIssuePrev, 'click', () => stepQaIssue(-1));
  listen(inspectorIssueNext, 'click', () => stepQaIssue(1));

  // ─── Peel force chart ────────────────────────────────────────────
  const peelCanvas = document.getElementById('peel-force-canvas') as HTMLCanvasElement | null;
  const peelSection = document.getElementById('peel-force-section');
  const peelPeak = document.getElementById('peel-force-peak');
  let currentPeelProfile: PeelForceProfile | null = null;

  const viewerCanvas = document.getElementById('viewer-canvas') ?? viewer.canvas;
  viewerCanvas?.addEventListener('slice-complete', ((
    e: CustomEvent<{ perLayerWhitePixels: Float64Array; layerCount: number }>,
  ) => {
    const { perLayerWhitePixels } = e.detail;
    const spec = slicer.getPrinterSpec();
    const pixelAreaMM2 =
      (spec.buildWidthMM / spec.resolutionX) * (spec.buildDepthMM / spec.resolutionY);

    currentPeelProfile = computePeelForceProfile(perLayerWhitePixels, pixelAreaMM2);

    if (peelSection) peelSection.hidden = false;
    if (peelPeak) {
      peelPeak.textContent = `Peak: ${currentPeelProfile.maxAreaMM2.toFixed(1)} mm² (L${currentPeelProfile.peakLayerIndex + 1})`;
    }
    if (peelCanvas) renderPeelForceChart(peelCanvas, currentPeelProfile);
    runSliceQa();
  }) as EventListener);

  // Highlight current layer on slider change
  listen(layerSlider, 'input', () => {
    if (currentPeelProfile && peelCanvas) {
      const idx = parseInt(layerSlider?.value ?? '0', 10);
      renderPeelForceChart(peelCanvas, currentPeelProfile, idx);
    }
  });

  // ─── Print time display ──────────────────────────────────────────
  const printTimeSection = document.getElementById('print-time-estimate');
  const printTimeValue = document.getElementById('print-time-value');

  viewerCanvas?.addEventListener('slice-complete', ((e: CustomEvent<{ layerCount: number }>) => {
    const { layerCount: count } = e.detail;
    if (count <= 0 || !printTimeSection || !printTimeValue) return;

    const layerHeightInput = document.getElementById('layer-height') as HTMLInputElement | null;
    const normalExposure = parseFloat(
      (document.getElementById('normal-exposure') as HTMLInputElement)?.value ?? '2',
    );
    const bottomLayers = parseInt(
      (document.getElementById('bottom-layers') as HTMLInputElement)?.value ?? '6',
      10,
    );
    const bottomExposure = parseFloat(
      (document.getElementById('bottom-exposure') as HTMLInputElement)?.value ?? '30',
    );
    const liftHeight = parseFloat(
      (document.getElementById('lift-height') as HTMLInputElement)?.value ?? '5',
    );
    const liftSpeed = parseFloat(
      (document.getElementById('lift-speed') as HTMLInputElement)?.value ?? '1',
    );

    const bottomCount = Math.min(bottomLayers, count);
    const normalCount = count - bottomCount;
    const liftTimePerLayer = liftHeight / liftSpeed;
    const totalS =
      bottomCount * (bottomExposure + liftTimePerLayer) +
      normalCount * (normalExposure + liftTimePerLayer);

    const h = Math.floor(totalS / 3600);
    const m = Math.floor((totalS % 3600) / 60);
    printTimeValue.textContent = h > 0 ? `${h}h ${m}m` : `${m}m`;
    printTimeSection.hidden = false;

    // Also store on the layer height input for reference
    if (layerHeightInput) layerHeightInput.dataset.layerCount = String(count);
  }) as EventListener);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
