/**
 * Progress overlay — showProgress / updateProgress / hideProgress.
 */

const $ = (id: string): HTMLElement | null => document.getElementById(id);

export function showProgress(text: string): void {
  const overlay = $('progress-overlay');
  const textEl = $('progress-text');
  const bar = $('progress-bar') as HTMLElement | null;
  const pct = $('progress-percent');
  if (overlay) overlay.hidden = false;
  if (textEl) textEl.textContent = text;
  if (bar) bar.style.width = '0%';
  if (pct) pct.textContent = '0%';
}

export function updateProgress(fraction: number, text?: string): void {
  const bar = $('progress-bar') as HTMLElement | null;
  const pct = $('progress-percent');
  const textEl = $('progress-text');
  const p = Math.round(fraction * 100);
  if (bar) bar.style.width = `${p}%`;
  if (pct) pct.textContent = `${p}%`;
  if (text && textEl) textEl.textContent = text;
}

export function hideProgress(): void {
  const overlay = $('progress-overlay');
  if (overlay) overlay.hidden = true;
}
