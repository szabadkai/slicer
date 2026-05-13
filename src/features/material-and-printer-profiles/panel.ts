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
  'saturn-s': {
    image: 'printers/elegoo-saturn-s.jpg',
    description:
      '9.1 inch 4K mono LCD with a larger plate and solid build quality for medium-sized resin projects.',
  },
  'mars-5-ultra': {
    image: 'printers/elegoo-mars-5-ultra.jpg',
    description:
      'Fast 9K Mars-series printer with AI camera, Wi-Fi, and ultra-fine 18 micron XY pixels.',
  },
  'saturn-3-ultra': {
    image: 'printers/elegoo-saturn-3-ultra.jpg',
    description:
      'Mid-range 12K Saturn flagship with Wi-Fi and a tall 260 mm Z for larger resin parts.',
  },
  'jupiter-se': {
    image: 'printers/elegoo-jupiter-se.jpg',
    description: 'Large-format 12.8 inch 6K printer with automatic resin feeding for big batches.',
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
  'saturn-4-ultra-16k': {
    image: 'printers/elegoo-saturn-4-ultra-16k.jpg',
    description:
      '10 inch 16K mono LCD with ultra-fine 14×19 micron pixels for extremely detailed resin prints.',
  },
  'photon-mono-x2': {
    image: 'printers/anycubic-photon-mono-x2.jpg',
    description:
      'Mid-range 9.1 inch 4K+ Anycubic printer with dual linear guides and a large plate.',
  },
  'photon-mono-m7-pro': {
    image: 'printers/anycubic-photon-mono-m7-pro.jpg',
    description:
      'High-speed 14K Anycubic flagship with auto resin refill and up to 170 mm/h print speed.',
  },
  'photon-mono-m7-max': {
    image: 'printers/anycubic-photon-mono-m7-max.jpg',
    description:
      'Large-format 13.6 inch 7K Anycubic printer for big models and high-volume production.',
  },
  'halot-mage-8k': {
    image: 'printers/creality-halot-mage-8k.jpg',
    description: 'Creality 10.3 inch 8K MSLA printer with a flip lid and generous build height.',
  },
  'uniformation-gktwo': {
    image: 'printers/uniformation-gktwo.png',
    description: 'UniFormation 8K printer with a heated chamber and tall 245 mm Z capacity.',
  },
  'sonic-mega-8k-s': {
    image: 'printers/phrozen-sonic-mega-8k-s.png',
    description: 'Extra-large 15 inch 8K Phrozen printer — fits 80+ miniatures per plate.',
  },
  'sonic-mini-8k': {
    image: 'printers/phrozen-sonic-mini-8k.png',
    description: 'High-detail compact printer with dense 8K resolution for fine miniatures.',
  },
  'sonic-mighty-8k': {
    image: 'printers/phrozen-sonic-mighty-8k.png',
    description: 'Large Phrozen 8K printer for high-detail batches and larger resin parts.',
  },
  'sl1s-speed': {
    image: 'printers/prusa-sl1s-speed.jpg',
    description:
      'Premium Prusa mSLA printer with motorized tilting bed and up to 80 mm/h print speed.',
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
