import type { AppContext } from '@core/types';
import { listen } from '@features/app-shell/utils';

/** Physical area (mm) shown in each pattern preview tile. */
const PREVIEW_VIEW_MM = 12;

/** Fixed defaults for removed sliders. */
const DEFAULT_RADIUS_MM = 4;
const DEFAULT_DENSITY = 0.8;
const DEFAULT_BUMP = 0.6;

// --- GLSL math helpers (matching the shader exactly) ---

function fract(v: number): number {
  return v - Math.floor(v);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// --- Value noise (matching the GLSL slHash / slNoise / slFbm) ---

function hash21(x: number, y: number): number {
  let px = fract(x * 0.1031);
  let py = fract(y * 0.1031);
  const pz = fract(x * 0.1031);
  const d = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
  px += d; py += d;
  return fract((px + py) * (pz + d));
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash21(ix, iy);
  const b = hash21(ix + 1, iy);
  const c = hash21(ix, iy + 1);
  const d = hash21(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x: number, y: number): number {
  let v = 0.5 * valueNoise(x, y);
  v += 0.25 * valueNoise(x * 2 + 17, y * 2 + 31);
  v += 0.125 * valueNoise(x * 4 + 53, y * 4 + 97);
  return v / 0.875;
}

/**
 * Evaluate pattern intensity at a point, replicating the fragment shader logic.
 * Returns 0..1 where 1 = fully raised.
 */
function evalPattern(patternId: number, u: number, v: number): number {
  if (patternId <= 0) return 1;
  if (patternId === 1) {
    // carbon fiber weave
    const carbonA = fract((u + v) * 0.5) >= 0.5 ? 1 : 0;
    const carbonB = fract((u - v) * 0.5) >= 0.5 ? 1 : 0;
    return (Math.floor(v * 0.25) & 1) === 0 ? carbonA : carbonB;
  }
  if (patternId === 2) {
    // knurl — dual diagonal ridges
    const diagA = Math.abs(fract(u + v) - 0.5);
    const diagB = Math.abs(fract(u - v) - 0.5);
    return Math.max(
      1 - smoothstep(0.04, 0.16, diagA),
      1 - smoothstep(0.04, 0.16, diagB),
    );
  }
  if (patternId === 3) {
    // ribbed — vertical lines
    return 1 - smoothstep(0.08, 0.22, Math.abs(fract(u) - 0.5));
  }
  if (patternId === 4) {
    // noise — organic multi-octave value noise
    return fbm(u * 3, v * 3);
  }
  if (patternId === 5) {
    // bumps — soft hemispheres on a grid
    const fx = fract(u) - 0.5;
    const fy = fract(v) - 0.5;
    return 1 - smoothstep(0, 0.35, Math.sqrt(fx * fx + fy * fy));
  }
  return 1;
}

/** Render a pattern preview into a small canvas. */
function renderPreview(
  canvas: HTMLCanvasElement,
  patternId: number,
  scaleMM: number,
): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cssW = canvas.clientWidth || 64;
  const cssH = canvas.clientHeight || 64;
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const imageData = ctx.createImageData(w, h);
  const data = imageData.data;
  const scale = Math.max(scaleMM, 0.001);

  // Background: neutral warm-gray
  const bgR = 52, bgG = 55, bgB = 62;
  // Foreground: the fixed paint red
  const fgR = 239, fgG = 68, fgB = 68;

  for (let py = 0; py < h; py++) {
    const z = (py / h) * PREVIEW_VIEW_MM;
    const pv = z / scale;
    for (let px = 0; px < w; px++) {
      const x = (px / w) * PREVIEW_VIEW_MM;
      const pu = x / scale;

      const patterned = evalPattern(patternId, pu, pv);
      // Match shader mask: density * mix(0.35, 1.0, patterned)
      const mask = DEFAULT_DENSITY * lerp(0.35, 1.0, patterned);

      const i = (py * w + px) * 4;
      data[i] = Math.round(lerp(bgR, fgR, mask));
      data[i + 1] = Math.round(lerp(bgG, fgG, mask));
      data[i + 2] = Math.round(lerp(bgB, fgB, mask));
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

export function mountPaintPanel(ctx: AppContext): void {
  const { viewer } = ctx;
  const patternScaleInput = document.getElementById('paint-pattern-scale') as HTMLInputElement | null;
  const depthInput = document.getElementById('paint-depth') as HTMLInputElement | null;
  const patternScaleValue = document.getElementById('paint-pattern-scale-value');
  const depthValue = document.getElementById('paint-depth-value');
  const status = document.getElementById('paint-status');
  const undoBtn = document.getElementById('paint-undo-btn') as HTMLButtonElement | null;
  const clearBtn = document.getElementById('paint-clear-btn') as HTMLButtonElement | null;
  const color = 0xef4444;
  let pattern = 0;

  // Collect pattern buttons and their canvases
  const patternButtons = document.querySelectorAll<HTMLButtonElement>('.paint-pattern-btn');
  const previewCanvases: { canvas: HTMLCanvasElement; patternId: number }[] = [];
  patternButtons.forEach((btn) => {
    const canvas = btn.querySelector<HTMLCanvasElement>('.paint-pattern-preview');
    if (canvas) {
      previewCanvases.push({
        canvas,
        patternId: Number.parseInt(btn.dataset.pattern ?? '0', 10),
      });
    }
  });

  function getScale(): number {
    return Number.parseFloat(patternScaleInput?.value ?? '2');
  }

  function updatePreviews(): void {
    const scaleMM = getScale();
    for (const { canvas, patternId } of previewCanvases) {
      renderPreview(canvas, patternId, scaleMM);
    }
  }

  function syncBrush(): void {
    const patternScaleMM = getScale();
    const depthMM = Number.parseFloat(depthInput?.value ?? '0.5');
    if (patternScaleValue) patternScaleValue.textContent = patternScaleMM.toFixed(2);
    if (depthValue) depthValue.textContent = depthMM.toFixed(2);
    viewer.setPaintBrush?.({
      radiusMM: DEFAULT_RADIUS_MM,
      color,
      density: DEFAULT_DENSITY,
      depthMM,
      bumpStrength: DEFAULT_BUMP,
      pattern,
      patternScaleMM,
    });
  }

  function syncStatus(): void {
    const count = viewer.getPaintStrokeCount?.() ?? 0;
    if (status) status.textContent = `${count} stroke${count === 1 ? '' : 's'}`;
  }

  patternButtons.forEach((btn) => {
    listen(btn, 'click', () => {
      patternButtons.forEach((el) => el.classList.remove('active'));
      btn.classList.add('active');
      pattern = Number.parseInt(btn.dataset.pattern ?? '0', 10);
      syncBrush();
    });
  });

  listen(patternScaleInput, 'input', () => {
    syncBrush();
    updatePreviews();
  });
  listen(depthInput, 'input', syncBrush);
  listen(undoBtn, 'click', () => {
    viewer.undoPaintStroke?.();
    syncStatus();
  });
  listen(clearBtn, 'click', () => {
    viewer.clearPaint?.();
    syncStatus();
  });
  listen(viewer.canvas, 'paint-changed', syncStatus);
  listen(viewer.canvas, 'selection-changed', syncStatus);

  syncBrush();
  syncStatus();
  // Defer first render so layout has resolved canvas sizes
  requestAnimationFrame(updatePreviews);
}
