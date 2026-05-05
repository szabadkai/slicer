/**
 * Material picker panel.
 * Populates material cards, handles selection, syncs with viewer.
 */
import type { AppContext } from '@core/types';
import { RESIN_MATERIALS } from './materials';
import { listen, escapeHtml } from '@features/app-shell/utils';

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
      const transLabel =
        mat.transmission > 0.45 ? 'transparent' : mat.opacity < 0.85 ? 'translucent' : 'opaque';
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
  const defaultMat =
    RESIN_MATERIALS.find((m) => m.id === getSelectedMaterialId()) ?? RESIN_MATERIALS[0];
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
