/**
 * Welcome modal — shown once on first visit.
 * Reuses existing CSS variables so it looks native.
 */
import type { AppContext } from '@core/types';
import { hasSeenWelcome, markWelcomeSeen, startTour } from './state';

const DOCS_URL = 'https://github.com/szabadkai/slicer/blob/main/docs/guides/README.md';

export function mountWelcomeModal(ctx: AppContext, onStartTour: () => void): void {
  if (hasSeenWelcome.value) return;

  const overlay = document.createElement('div');
  overlay.className = 'ob-welcome-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'ob-welcome-title');

  overlay.innerHTML = `
    <div class="ob-welcome-card">
      <div class="ob-welcome-logo">SliceLab</div>
      <p class="ob-welcome-tagline">
        A browser-based SLA/DLP slicer. No install, no account —
        just open it and start slicing.
      </p>
      <ul class="ob-welcome-features">
        <li>Orient with a genetic algorithm, generate supports in one click</li>
        <li>GPU-accelerated WebGL slicing with real-time layer preview</li>
        <li>Hollow, drain, inspect, and export — all in the browser</li>
      </ul>
      <div class="ob-welcome-actions">
        <button class="ob-btn-tour" id="ob-start-tour" type="button">Take the tour →</button>
        <div class="ob-welcome-links">
          <a class="ob-welcome-docs-link" href="${DOCS_URL}" target="_blank" rel="noopener noreferrer">Browse guides</a>
          <button class="ob-btn-skip-welcome" id="ob-skip-welcome" type="button">Skip</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  function dismiss(): void {
    markWelcomeSeen();
    overlay.remove();
  }

  overlay.querySelector('#ob-start-tour')?.addEventListener('click', () => {
    dismiss();
    startTour();
    onStartTour();
  });

  overlay.querySelector('#ob-skip-welcome')?.addEventListener('click', dismiss);

  // Close on backdrop click (outside the card)
  overlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === overlay) dismiss();
  });

  // Close on Escape
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      dismiss();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);

  // Suppress unused ctx warning — ctx is available for future use (e.g. load sample)
  void ctx;
}
