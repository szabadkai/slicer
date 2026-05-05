/**
 * Printer picker panel.
 * Populates printer cards, handles selection modal.
 */
import type { AppContext, PrinterSpec } from '@core/types';
import {
  listen,
  escapeHtml,
  assetUrl,
  formatBuildVolume,
  formatPixelSize,
} from '@features/app-shell/utils';

const PRINTER_DETAILS: Record<string, { image: string; description: string }> = {
  'photon-mono': {
    image: 'printers/anycubic-photon-mono-4k.jpg',
    description: 'Compact Anycubic machine with a small plate for quick tabletop resin prints.',
  },
  'photon-mono-m5s': {
    image: 'printers/anycubic-photon-mono-m5s.jpg',
    description: 'Leveling-free 12K Anycubic printer with a larger mid-size build area.',
  },
  'mars-3': {
    image: 'printers/elegoo-mars-3.jpg',
    description: 'Balanced desktop resin printer with a sharper 4K screen and moderate plate size.',
  },
  'mars-4-ultra': {
    image: 'printers/elegoo-mars-4-ultra.jpg',
    description: 'Fast 9K Mars-series printer with Wi-Fi and very fine 18 micron XY pixels.',
  },
  'saturn-2': {
    image: 'printers/elegoo-saturn-2.jpg',
    description: 'Large-format 8K machine for bigger models or batching many parts at once.',
  },
  'halot-mage-8k': {
    image: 'printers/creality-halot-mage-8k.jpg',
    description: 'Creality 10.3 inch 8K MSLA printer with a flip lid and generous build height.',
  },
  'uniformation-gktwo': {
    image: 'printers/uniformation-gktwo.png',
    description: 'UniFormation 8K printer with a heated chamber and tall 245 mm Z capacity.',
  },
  'sonic-mini-8k': {
    image: 'printers/phrozen-sonic-mini-8k.png',
    description: 'High-detail compact printer with dense 8K resolution for fine miniatures.',
  },
  'sonic-mighty-8k': {
    image: 'printers/phrozen-sonic-mighty-8k.png',
    description: 'Large Phrozen 8K printer for high-detail batches and larger resin parts.',
  },
  'form-4': {
    image: 'printers/formlabs-form-4.jpg',
    description: 'Industrial Formlabs LFD resin printer profile with a 50 micron pixel pitch.',
  },
};

export function mountPrinterPanel(
  _ctx: AppContext,
  applyPrinter: (key: string, opts?: { resetSlice?: boolean }) => void,
  PRINTERS: Record<string, PrinterSpec>,
): void {
  const grid = document.getElementById('printer-grid');
  const selectBtn = document.getElementById('printer-select-btn');
  const modal = document.getElementById('printer-modal');
  const modalClose = document.getElementById('printer-modal-close');

  if (!grid) return;

  grid.innerHTML = '';
  for (const [key, spec] of Object.entries(PRINTERS)) {
    const details = PRINTER_DETAILS[key] ?? { image: '', description: 'Resin printer profile.' };
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'printer-card';
    card.dataset.printer = key;
    card.innerHTML = `
      <img class="printer-card-image" src="${assetUrl(details.image)}" alt="${escapeHtml(spec.name)}">
      <div class="printer-card-title">
        <strong>${escapeHtml(spec.name)}</strong>
        <span class="printer-active-badge">Selected</span>
      </div>
      <p class="printer-card-desc">${escapeHtml(details.description)}</p>
      <div class="printer-card-specs">
        <span>Build <b>${formatBuildVolume(spec)}</b></span>
        <span>LCD <b>${spec.resolutionX} × ${spec.resolutionY}</b></span>
        <span>Pixel <b>${formatPixelSize(spec)}</b></span>
      </div>
    `;
    card.addEventListener('click', () => {
      applyPrinter(key);
      closeModal();
    });
    grid.appendChild(card);
  }

  function openModal(): void {
    if (!modal) return;
    modal.hidden = false;
    selectBtn?.setAttribute('aria-expanded', 'true');
    const active = grid?.querySelector('.printer-card.active') as HTMLElement | null;
    active?.focus();
  }

  function closeModal(): void {
    if (!modal) return;
    modal.hidden = true;
    selectBtn?.setAttribute('aria-expanded', 'false');
    selectBtn?.focus();
  }

  listen(selectBtn, 'click', openModal);
  listen(modalClose, 'click', closeModal);
  listen(modal, 'click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.hidden) closeModal();
  });
}
