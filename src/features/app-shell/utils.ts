/**
 * Shared utility helpers for the app shell.
 */
export function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return map[char] ?? char;
  });
}

export function listen(
  target: EventTarget | null | undefined,
  event: string,
  handler: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions | boolean,
): void {
  if (target) target.addEventListener(event, handler, options);
}

export function setButtonDisabled(btn: HTMLButtonElement | null, disabled: boolean): void {
  if (!btn) return;
  btn.disabled = disabled;
  btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
}

export function setInputValue(input: HTMLInputElement | null, value: unknown): void {
  if (!input || value === undefined || value === null) return;
  input.value = String(value);
}

export function setInputChecked(input: HTMLInputElement | null, value: unknown): void {
  if (!input || value === undefined || value === null) return;
  input.checked = !!value;
}

export function assetUrl(path: string): string {
  const base = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL;
  return `${base}${path}`;
}

export function formatBuildVolume(spec: { buildWidthMM: number; buildDepthMM: number; buildHeightMM: number }): string {
  return `${spec.buildWidthMM} × ${spec.buildDepthMM} × ${spec.buildHeightMM} mm`;
}

export function formatPixelSize(spec: { buildWidthMM: number; buildDepthMM: number; resolutionX: number; resolutionY: number }): string {
  const xMicron = (spec.buildWidthMM / spec.resolutionX) * 1000;
  const yMicron = (spec.buildDepthMM / spec.resolutionY) * 1000;
  return `${xMicron.toFixed(1)} × ${yMicron.toFixed(1)} μm`;
}
