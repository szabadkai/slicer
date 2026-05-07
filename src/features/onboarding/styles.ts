/**
 * Injects onboarding CSS into the document — keeps style.css untouched.
 *
 * Uses the app's CSS custom properties so everything adapts to light/dark
 * mode automatically. The theme is toggled via [data-theme="dark"] on
 * <html>, so all var() calls here inherit the correct values.
 *
 * Tokens in use (see :root / [data-theme="dark"] in style.css):
 *   --surface      card / tooltip background
 *   --surface-2    subtle inset background (checklist)
 *   --border       border colour
 *   --text         primary text
 *   --text-dim     secondary / muted text
 *   --accent       brand blue (differs between light and dark)
 *   --sidebar-shadow  ambient shadow colour
 */
export function injectOnboardingStyles(): void {
  if (document.getElementById('onboarding-styles')) return;

  const style = document.createElement('style');
  style.id = 'onboarding-styles';
  style.textContent = `
    /* ── Spotlight backdrop (four panels) ─────────────────────────────── */
    .ob-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      pointer-events: none;
    }

    /* ── Highlight ring around target ─────────────────────────────────── */
    .ob-ring {
      position: fixed;
      border: 2px solid var(--accent);
      border-radius: 6px;
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent);
      pointer-events: none;
      z-index: 1002;
      transition: top 0.2s ease, left 0.2s ease, width 0.2s ease, height 0.2s ease;
    }

    /* ── Tour tooltip ─────────────────────────────────────────────────── */
    .ob-tooltip {
      position: fixed;
      z-index: 1003;
      width: 300px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: 0 8px 32px var(--sidebar-shadow), 0 2px 8px rgba(0,0,0,0.08);
      padding: 18px 20px 16px;
      font-family: inherit;
      color: var(--text);
      transition: opacity 0.18s ease, transform 0.18s ease;
    }

    .ob-tooltip.ob-hidden {
      opacity: 0;
      transform: translateY(6px);
      pointer-events: none;
    }

    .ob-tooltip-counter {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 8px;
    }

    .ob-tooltip-title {
      font-size: 15px;
      font-weight: 700;
      margin: 0 0 8px;
      color: var(--text);
    }

    .ob-tooltip-body {
      font-size: 13px;
      line-height: 1.55;
      margin: 0 0 8px;
      color: var(--text-dim);
    }

    .ob-tooltip-learn-more {
      display: inline-block;
      font-size: 12px;
      color: var(--accent);
      text-decoration: none;
      margin-bottom: 14px;
    }

    .ob-tooltip-learn-more:hover {
      text-decoration: underline;
    }

    .ob-tooltip-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .ob-dots {
      display: flex;
      gap: 5px;
    }

    .ob-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--border);
      transition: background 0.15s;
    }

    .ob-dot.ob-dot-active {
      background: var(--accent);
    }

    .ob-btn-next {
      padding: 6px 16px;
      border-radius: 6px;
      border: none;
      background: var(--accent);
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }

    .ob-btn-next:hover {
      opacity: 0.88;
    }

    .ob-skip {
      font-size: 11px;
      color: var(--text-dim);
      cursor: pointer;
      background: none;
      border: none;
      padding: 0;
      text-decoration: underline;
    }

    .ob-skip:hover {
      color: var(--text);
    }

    /* ── Welcome modal ────────────────────────────────────────────────── */
    .ob-welcome-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 1100;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .ob-welcome-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: 0 16px 48px var(--sidebar-shadow), 0 4px 16px rgba(0,0,0,0.1);
      width: 420px;
      max-width: calc(100vw - 32px);
      padding: 32px 32px 28px;
      font-family: inherit;
      color: var(--text);
    }

    .ob-welcome-logo {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 6px;
      color: var(--text);
    }

    .ob-welcome-tagline {
      font-size: 14px;
      color: var(--text-dim);
      line-height: 1.5;
      margin-bottom: 24px;
    }

    .ob-welcome-features {
      list-style: none;
      padding: 0;
      margin: 0 0 28px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .ob-welcome-features li {
      font-size: 13px;
      color: var(--text);
      padding-left: 20px;
      position: relative;
    }

    .ob-welcome-features li::before {
      content: '→';
      position: absolute;
      left: 0;
      color: var(--accent);
    }

    .ob-welcome-actions {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .ob-btn-tour {
      padding: 9px 22px;
      border-radius: 7px;
      border: none;
      background: var(--accent);
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
    }

    .ob-btn-tour:hover {
      opacity: 0.88;
    }

    .ob-welcome-links {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .ob-btn-skip-welcome {
      font-size: 13px;
      color: var(--text-dim);
      cursor: pointer;
      background: none;
      border: none;
      padding: 0;
      text-decoration: underline;
    }

    .ob-btn-skip-welcome:hover {
      color: var(--text);
    }

    .ob-welcome-docs-link {
      font-size: 13px;
      color: var(--accent);
      text-decoration: none;
    }

    .ob-welcome-docs-link:hover {
      text-decoration: underline;
    }

    /* ── Getting-started checklist ────────────────────────────────────── */
    .ob-checklist {
      margin: 12px 0 0;
      padding: 12px 14px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 8px;
    }

    .ob-checklist-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--text-dim);
      margin-bottom: 10px;
    }

    .ob-checklist-items {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .ob-checklist-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--text);
    }

    .ob-checklist-item.ob-done {
      color: var(--text-dim);
      text-decoration: line-through;
    }

    .ob-check-icon {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    .ob-checklist-fade {
      animation: ob-fade-out 0.6s ease forwards;
    }

    @keyframes ob-fade-out {
      to { opacity: 0; max-height: 0; margin: 0; padding: 0; overflow: hidden; }
    }
  `;
  document.head.appendChild(style);
}
