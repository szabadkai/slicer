/**
 * Tour engine — step sequencing, tooltip positioning, spotlight wiring.
 */
import type { AppContext } from '@core/types';
import { effect } from '@preact/signals-core';
import { tourActive, tourStepIndex, advanceTour, endTour } from './state';
import { TOUR_STEPS } from './tour-steps';
import { highlight, clear as clearSpotlight } from './spotlight';

const TOOLTIP_WIDTH = 300;
const TOOLTIP_MARGIN = 16;
const TOOLTIP_HEIGHT_ESTIMATE = 180;

let tooltip: HTMLDivElement | null = null;

function createTooltip(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'ob-tooltip ob-hidden';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'false');
  document.body.appendChild(el);
  return el;
}

function positionTooltip(targetSelector: string): void {
  if (!tooltip) return;
  const target = document.querySelector<HTMLElement>(targetSelector);
  const rect = target?.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 6;

  if (!rect) {
    // Fallback: centre on screen
    tooltip.style.left = `${(vw - TOOLTIP_WIDTH) / 2}px`;
    tooltip.style.top = `${vh / 2 - TOOLTIP_HEIGHT_ESTIMATE / 2}px`;
    return;
  }

  // Horizontal: centre on target, clamped to viewport
  const idealLeft = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
  const left = Math.max(TOOLTIP_MARGIN, Math.min(idealLeft, vw - TOOLTIP_WIDTH - TOOLTIP_MARGIN));

  // Vertical: prefer below, fall back to above
  const spaceBelow = vh - rect.bottom - pad;
  const top =
    spaceBelow >= TOOLTIP_HEIGHT_ESTIMATE + TOOLTIP_MARGIN
      ? rect.bottom + pad + TOOLTIP_MARGIN
      : rect.top - pad - TOOLTIP_HEIGHT_ESTIMATE - TOOLTIP_MARGIN;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${Math.max(TOOLTIP_MARGIN, top)}px`;
}

function renderTooltip(ctx: AppContext): void {
  if (!tooltip) return;
  const idx = tourStepIndex.value;
  const step = TOUR_STEPS[idx];
  if (!step) return;

  const total = TOUR_STEPS.length;
  const isLast = idx === total - 1;

  const dots = TOUR_STEPS.map(
    (_, i) => `<span class="ob-dot${i === idx ? ' ob-dot-active' : ''}"></span>`,
  ).join('');

  const learnMore = step.docsUrl
    ? `<a class="ob-tooltip-learn-more" href="${step.docsUrl}" target="_blank" rel="noopener noreferrer">Learn more →</a>`
    : '';

  tooltip.innerHTML = `
    <div class="ob-tooltip-counter">Step ${idx + 1} of ${total}</div>
    <div class="ob-tooltip-title">${step.title}</div>
    <p class="ob-tooltip-body">${step.body}</p>
    ${learnMore}
    <div class="ob-tooltip-footer">
      <div class="ob-dots">${dots}</div>
      <div style="display:flex;align-items:center;gap:10px">
        <button class="ob-skip" type="button">Skip tour</button>
        <button class="ob-btn-next" type="button">${isLast ? 'Done' : 'Next →'}</button>
      </div>
    </div>
  `;

  tooltip.querySelector('.ob-btn-next')?.addEventListener('click', () => {
    if (isLast) {
      finishTour();
    } else {
      advanceTour();
    }
  });

  tooltip.querySelector('.ob-skip')?.addEventListener('click', () => {
    finishTour();
  });

  // Switch to the correct panel if needed
  if (step.panelName) {
    ctx.showToolPanel(step.panelName);
  }

  // Highlight target
  highlight(step.targetSelector);
  positionTooltip(step.targetSelector);

  // Animate in
  requestAnimationFrame(() => {
    tooltip?.classList.remove('ob-hidden');
  });
}

function finishTour(): void {
  endTour();
  clearSpotlight();
  if (tooltip) {
    tooltip.classList.add('ob-hidden');
    setTimeout(() => {
      tooltip?.remove();
      tooltip = null;
    }, 200);
  }
}

function isMaybeEmpty(ctx: AppContext): boolean {
  return ctx.viewer.objects.length === 0;
}

async function ensureSampleModel(ctx: AppContext): Promise<void> {
  if (!isMaybeEmpty(ctx)) return;
  try {
    const base = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL;
    const resp = await fetch(base + 'models/d20v2_thick.stl');
    if (!resp.ok) return;
    const buffer = await resp.arrayBuffer();
    ctx.viewer.loadSTL(buffer, 2);
  } catch {
    console.warn('Onboarding: could not load sample model');
  }
}

export function mountTour(ctx: AppContext): void {
  // React to step changes
  effect(() => {
    const active = tourActive.value;
    const idx = tourStepIndex.value;

    if (!active || idx < 0) {
      clearSpotlight();
      return;
    }

    const step = TOUR_STEPS[idx];
    if (!step) {
      finishTour();
      return;
    }

    if (!tooltip) tooltip = createTooltip();

    // Load sample model on first step if scene is empty
    if (step.sampleModel) {
      ensureSampleModel(ctx)
        .then(() => renderTooltip(ctx))
        .catch(() => renderTooltip(ctx));
    } else {
      renderTooltip(ctx);
    }
  });

  // Keyboard: Escape ends tour
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && tourActive.value) {
      finishTour();
    }
  });
}
