/**
 * Spotlight — four-panel backdrop + highlight ring.
 *
 * The four-panel approach surrounds the target rect with fixed divs that
 * cover everything except the highlighted element. More reliable than
 * clip-path in a WebGL/canvas app where compositing can interfere.
 */

interface SpotlightElements {
  top: HTMLDivElement;
  bottom: HTMLDivElement;
  left: HTMLDivElement;
  right: HTMLDivElement;
  ring: HTMLDivElement;
}

let els: SpotlightElements | null = null;

function createElements(): SpotlightElements {
  function panel(): HTMLDivElement {
    const d = document.createElement('div');
    d.className = 'ob-backdrop';
    d.hidden = true;
    document.body.appendChild(d);
    return d;
  }

  const ring = document.createElement('div');
  ring.className = 'ob-ring';
  ring.hidden = true;
  document.body.appendChild(ring);

  return { top: panel(), bottom: panel(), left: panel(), right: panel(), ring };
}

function getOrCreate(): SpotlightElements {
  if (!els) els = createElements();
  return els;
}

export function highlight(selector: string): void {
  const target = document.querySelector<HTMLElement>(selector);
  const e = getOrCreate();

  if (!target) {
    clear();
    return;
  }

  const rect = target.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 6;

  const t = Math.max(0, rect.top - pad);
  const b = Math.min(vh, rect.bottom + pad);
  const l = Math.max(0, rect.left - pad);
  const r = Math.min(vw, rect.right + pad);

  // Top panel
  Object.assign(e.top.style, { top: '0', left: '0', right: '0', height: `${t}px`, width: '' });
  // Bottom panel
  Object.assign(e.bottom.style, {
    top: `${b}px`,
    left: '0',
    right: '0',
    bottom: '0',
    height: '',
    width: '',
  });
  // Left panel (between top and bottom)
  Object.assign(e.left.style, {
    top: `${t}px`,
    left: '0',
    width: `${l}px`,
    height: `${b - t}px`,
    right: '',
    bottom: '',
  });
  // Right panel (between top and bottom)
  Object.assign(e.right.style, {
    top: `${t}px`,
    left: `${r}px`,
    right: '0',
    height: `${b - t}px`,
    width: '',
    bottom: '',
  });

  // Ring
  Object.assign(e.ring.style, {
    top: `${t}px`,
    left: `${l}px`,
    width: `${r - l}px`,
    height: `${b - t}px`,
  });

  [e.top, e.bottom, e.left, e.right, e.ring].forEach((el) => (el.hidden = false));
}

export function clear(): void {
  if (!els) return;
  const { top, bottom, left, right, ring } = els;
  [top, bottom, left, right, ring].forEach((el) => (el.hidden = true));
}

export function destroy(): void {
  if (!els) return;
  const { top, bottom, left, right, ring } = els;
  [top, bottom, left, right, ring].forEach((el) => el.remove());
  els = null;
}
