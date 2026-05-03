/**
 * Material picker + printer picker panels.
 * Populates cards, handles selection, syncs with viewer.
 */
import type { AppContext, PrinterSpec } from '@core/types';
import { RESIN_MATERIALS } from './materials';
import { listen, escapeHtml, assetUrl, formatBuildVolume, formatPixelSize } from '@features/app-shell/utils';

// ─── Material Panel ────────────────────────────────────────

export function mountMaterialPanel(
  ctx: AppContext,
  getSelectedMaterialId: () => string,
  setSelectedMaterialId: (id: string) => void,
): void {
  const { viewer } = ctx;
  const picker = document.getElementById('material-picker');
  const detail = document.getElementById('material-detail');
  const applyAllBtn = document.getElementById('apply-material-all-btn');

  if (!picker) return;

  // Build cards
  picker.innerHTML = '';
  for (const mat of RESIN_MATERIALS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'material-card';
    card.dataset.materialId = mat.id;
    card.innerHTML = `
      <span class="material-card-top">
        <span class="material-swatch" style="background:${mat.swatch}"></span>
        <span class="material-brand">${escapeHtml(mat.brand)}</span>
      </span>
      <span class="material-product">${escapeHtml(mat.product)}</span>
      <span class="material-color">${escapeHtml(mat.colorName)}</span>
    `;
    card.addEventListener('click', () => {
      setSelectedMaterialId(mat.id);
      viewer.setDefaultMaterialPreset(mat);
      viewer.setMaterialPreset(mat, 'selection');
      syncMaterialPicker();
      ctx.scheduleSavePreferences();
    });
    picker.appendChild(card);
  }

  function syncMaterialPicker(): void {
    const activePreset = viewer.getActiveMaterialPreset();
    const activeId = activePreset?.id ?? getSelectedMaterialId();
    setSelectedMaterialId(activeId);

    if (!picker) return;
    picker.querySelectorAll('.material-card').forEach((card) => {
      const el = card as HTMLElement;
      el.classList.toggle('active', el.dataset.materialId === activeId);
    });

    const mat = RESIN_MATERIALS.find((m) => m.id === activeId) ?? RESIN_MATERIALS[0];
    if (detail && mat) {
      const opacityPct = Math.round(mat.opacity * 100);
      const reflPct = Math.round((1 - mat.roughness) * 100);
      const transLabel = mat.transmission > 0.45 ? 'transparent' : mat.opacity < 0.85 ? 'translucent' : 'opaque';
      detail.innerHTML = `
        <div class="material-detail-title">${escapeHtml(mat.brand)} ${escapeHtml(mat.colorName)}</div>
        <div>${escapeHtml(mat.description)}</div>
        <div class="material-metrics">
          <span>Opacity ${opacityPct}%</span>
          <span>Reflect ${reflPct}%</span>
          <span>${transLabel}</span>
        </div>
      `;
    }
  }

  listen(applyAllBtn, 'click', () => {
    const mat = RESIN_MATERIALS.find((m) => m.id === getSelectedMaterialId());
    if (mat) {
      viewer.setDefaultMaterialPreset(mat);
      viewer.setMaterialPreset(mat, 'all');
    }
  });

  // Set default material on viewer
  const defaultMat = RESIN_MATERIALS.find((m) => m.id === getSelectedMaterialId()) ?? RESIN_MATERIALS[0];
  viewer.setDefaultMaterialPreset(defaultMat);

  // Sync on viewer material-changed event
  listen(viewer.canvas, 'material-changed', () => {
    const preset = viewer.getActiveMaterialPreset();
    if (preset) {
      setSelectedMaterialId(preset.id);
      viewer.setDefaultMaterialPreset(preset);
    }
    syncMaterialPicker();
    ctx.scheduleSavePreferences();
  });

  syncMaterialPicker();
}

// ─── Printer Panel ─────────────────────────────────────────

const PRINTER_DETAILS: Record<string, { image: string; description: string }> = {
  'photon-mono': { image: 'printers/anycubic-photon-mono-4k.jpg', description: 'Compact Anycubic machine with a small plate for quick tabletop resin prints.' },
  'photon-mono-m5s': { image: 'printers/anycubic-photon-mono-m5s.jpg', description: 'Leveling-free 12K Anycubic printer with a larger mid-size build area.' },
  'mars-3': { image: 'printers/elegoo-mars-3.jpg', description: 'Balanced desktop resin printer with a sharper 4K screen and moderate plate size.' },
  'mars-4-ultra': { image: 'printers/elegoo-mars-4-ultra.jpg', description: 'Fast 9K Mars-series printer with Wi-Fi and very fine 18 micron XY pixels.' },
  'saturn-2': { image: 'printers/elegoo-saturn-2.jpg', description: 'Large-format 8K machine for bigger models or batching many parts at once.' },
  'halot-mage-8k': { image: 'printers/creality-halot-mage-8k.jpg', description: 'Creality 10.3 inch 8K MSLA printer with a flip lid and generous build height.' },
  'uniformation-gktwo': { image: 'printers/uniformation-gktwo.png', description: 'UniFormation 8K printer with a heated chamber and tall 245 mm Z capacity.' },
  'sonic-mini-8k': { image: 'printers/phrozen-sonic-mini-8k.png', description: 'High-detail compact printer with dense 8K resolution for fine miniatures.' },
  'sonic-mighty-8k': { image: 'printers/phrozen-sonic-mighty-8k.png', description: 'Large Phrozen 8K printer for high-detail batches and larger resin parts.' },
  'form-4': { image: 'printers/formlabs-form-4.jpg', description: 'Industrial Formlabs LFD resin printer profile with a 50 micron pixel pitch.' },
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
  listen(modal, 'click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.hidden) closeModal();
  });
}
