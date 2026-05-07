/**
 * App shell — tool panel switching, keyboard shortcuts, sidebar toggle,
 * Basic/Advanced mode toggle, Tool HUD section switching.
 */
import type { AppContext } from '@core/types';
import { listen } from './utils';
import { getSlicedLayerCount } from './mount';
import { handleKeydown } from './keyboard-shortcuts';

const TOOL_PANELS = ['plate', 'orient', 'modify', 'supports', 'surface', 'slice'] as const;
type ToolPanel = (typeof TOOL_PANELS)[number];

const TOOL_BTN_IDS: Record<ToolPanel, string> = {
  plate: 'plate-btn',
  orient: 'orient-btn',
  modify: 'modify-btn',
  supports: 'support-tool-btn',
  surface: 'surface-btn',
  slice: 'slice-tool-btn',
};

// Reordered to match new DOM order (hollow first for modify, materials first for surface,
// slice before health/measure)
const PANEL_IDS: Record<ToolPanel, string[]> = {
  plate: ['load-panel', 'edit-panel', 'transform-panel'],
  orient: ['orientation-panel'],
  modify: ['hollow-panel', 'cut-panel', 'primitive-boolean-panel'],
  supports: ['supports-panel'],
  surface: ['materials-panel', 'paint-panel'],
  slice: ['slice-panel', 'health-panel', 'measure-panel'],
};

// HUD section IDs per tool (modify has no static section — sub-toolbars manage it)
const HUD_IDS: Partial<Record<ToolPanel, string>> = {
  plate: 'hud-plate',
  orient: 'hud-orient',
  supports: 'hud-supports',
  surface: 'hud-surface',
  slice: 'hud-slice',
};

export function mountShell(ctx: AppContext): {
  showToolPanel: (name: string) => void;
  getActiveToolPanel: () => string;
} {
  const { viewer } = ctx;
  let activeToolPanel: ToolPanel = 'plate';

  function showToolPanel(name: string): void {
    // Support legacy panel names for backward compatibility (saved preferences)
    const LEGACY_MAP: Record<string, string> = {
      load: 'plate',
      scene: 'plate',
      edit: 'plate',
      transform: 'plate',
      hollow: 'modify',
      intent: 'orient',
      materials: 'surface',
      material: 'surface',
      paint: 'surface',
      health: 'slice',
      inspect: 'slice',
      measure: 'slice',
    };
    const resolved = LEGACY_MAP[name] ?? name;
    const panel = resolved as ToolPanel;
    if (!TOOL_PANELS.includes(panel)) return;

    // Expand the sidebar if it was collapsed
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('toggle-sidebar-btn');
    if (sidebar?.classList.contains('collapsed')) {
      sidebar.classList.remove('collapsed');
      toggleBtn?.classList.remove('collapsed');
    }

    for (const p of TOOL_PANELS) {
      for (const id of PANEL_IDS[p]) {
        const panelEl = document.getElementById(id);
        if (panelEl) panelEl.hidden = true;
      }
      const btnEl = document.getElementById(TOOL_BTN_IDS[p]);
      if (btnEl) btnEl.classList.remove('active');
    }

    const layerPanel = document.getElementById('layer-preview-panel');
    const footerActions = document.getElementById('footer-actions');
    const orientFooter = document.getElementById('orient-footer-actions');
    if (layerPanel) layerPanel.hidden = true;
    if (footerActions) footerActions.hidden = panel !== 'slice';
    if (orientFooter) orientFooter.hidden = panel !== 'orient';

    for (const id of PANEL_IDS[panel]) {
      const el = document.getElementById(id);
      if (el) el.hidden = false;
    }
    const activeBtn = document.getElementById(TOOL_BTN_IDS[panel]);
    if (activeBtn) activeBtn.classList.add('active');
    activeToolPanel = panel;

    // ── Swap Tool HUD section ──────────────────────────────────
    // Deactivate all static HUD sections
    for (const hudId of Object.values(HUD_IDS)) {
      document.getElementById(hudId)?.classList.remove('active');
    }
    // Activate the section for the current tool (modify uses sub-toolbars instead)
    const hudId = HUD_IDS[panel];
    if (hudId) document.getElementById(hudId)?.classList.add('active');

    if (panel === 'plate') {
      const activeMode = document
        .getElementById('transform-panel')
        ?.querySelector('.mode-btn.active') as HTMLElement | null;
      if (activeMode) viewer.setTransformMode(activeMode.dataset.mode ?? 'translate');
    } else {
      viewer.setTransformMode(null);
    }

    // Paint tools must only be active when explicitly toggled via their buttons.
    // Leaving the surface/orient panel always disables them.
    if (panel !== 'surface') {
      viewer.setPaintToolEnabled?.(false);
    }
    if (panel !== 'orient') {
      viewer.setIntentPaintMode(false);
      const intentPaintBtn = document.getElementById('intent-paint-btn');
      if (intentPaintBtn) intentPaintBtn.classList.remove('active');
    }

    if (panel === 'slice' && getSlicedLayerCount() > 0) {
      if (layerPanel) layerPanel.hidden = false;
    }

    document.dispatchEvent(new CustomEvent('tool-panel-changed', { detail: { panel } }));
    ctx.scheduleSavePreferences();
  }

  // Wire tool button clicks
  for (const p of TOOL_PANELS) {
    const btn = document.getElementById(TOOL_BTN_IDS[p]);
    listen(btn, 'click', () => showToolPanel(p));
  }

  // Wire sidebar toggle
  const toggleBtn = document.getElementById('toggle-sidebar-btn');
  listen(toggleBtn, 'click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar?.classList.toggle('collapsed');
    toggleBtn?.classList.toggle('collapsed');
    ctx.scheduleSavePreferences();
  });

  // Keyboard shortcuts
  function toggleSidebar(): void {
    document.getElementById('sidebar')?.classList.toggle('collapsed');
    toggleBtn?.classList.toggle('collapsed');
    ctx.scheduleSavePreferences();
  }

  document.addEventListener('keydown', (e) => {
    handleKeydown(e, {
      viewer,
      showToolPanel,
      getActiveToolPanel: () => activeToolPanel,
      hasSlicedLayers: () => getSlicedLayerCount() > 0,
      toggleSidebar,
    });
  });

  // Shortcuts modal (opened via ? key)
  const shortcutsModal = document.getElementById('shortcuts-modal');
  const shortcutsClose = document.getElementById('shortcuts-modal-close');
  listen(shortcutsClose, 'click', () => {
    if (shortcutsModal) shortcutsModal.hidden = true;
  });
  listen(shortcutsModal, 'click', (e) => {
    if (e.target === shortcutsModal && shortcutsModal) shortcutsModal.hidden = true;
  });

  showToolPanel('plate');

  // ── Basic / Advanced mode toggle (Pattern 3) ───────────────
  const app = document.getElementById('app');
  const modeBasicBtn = document.getElementById('mode-basic-btn');
  const modeAdvancedBtn = document.getElementById('mode-advanced-btn');

  function applyMode(mode: 'basic' | 'advanced'): void {
    app?.setAttribute('data-mode', mode);
    modeBasicBtn?.classList.toggle('active', mode === 'basic');
    modeAdvancedBtn?.classList.toggle('active', mode === 'advanced');
    ctx.scheduleSavePreferences();
  }

  // Default to basic; preferences.ts will override on load
  applyMode('basic');

  listen(modeBasicBtn, 'click', () => applyMode('basic'));
  listen(modeAdvancedBtn, 'click', () => applyMode('advanced'));

  // Expose so preferences.ts can call it
  (window as unknown as Record<string, unknown>).__slicelab_applyMode = applyMode;

  // ── HUD button wiring (delegate to existing sidebar controls) ─
  // Helpers
  function clickById(id: string): void {
    (document.getElementById(id) as HTMLElement | null)?.click();
  }
  function clickBySelector(sel: string): void {
    (document.querySelector(sel) as HTMLElement | null)?.click();
  }

  // Plate HUD — transform mode buttons
  const hudModes = ['translate', 'rotate', 'scale'] as const;
  for (const mode of hudModes) {
    const hudBtn = document.getElementById(`hud-mode-${mode}`);
    listen(hudBtn, 'click', () => {
      // Click the matching sidebar mode button (wired by model-transform/panel.ts)
      clickBySelector(`.mode-btn[data-mode="${mode}"]`);
      // Sync HUD active state immediately
      document
        .querySelectorAll('.hud-btn[data-hud-mode]')
        .forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.hudMode === mode));
    });
  }

  // Keep HUD mode buttons in sync when sidebar mode buttons are clicked
  document.querySelectorAll('.mode-btn[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode;
      document
        .querySelectorAll('.hud-btn[data-hud-mode]')
        .forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.hudMode === mode));
    });
  });

  // Plate HUD — layout actions
  listen(document.getElementById('hud-drop-bed'), 'click', () => clickById('drop-bed-btn'));
  listen(document.getElementById('hud-duplicate'), 'click', () => clickById('duplicate-btn'));
  listen(document.getElementById('hud-delete'), 'click', () => clickById('delete-btn'));

  // Orient HUD — preset buttons
  listen(document.getElementById('hud-orient-fastest'), 'click', () =>
    clickBySelector('.preset-btn[data-preset="fastest"]'),
  );
  listen(document.getElementById('hud-orient-balanced'), 'click', () =>
    clickBySelector('.preset-btn[data-preset="least-support"]'),
  );
  listen(document.getElementById('hud-orient-quality'), 'click', () =>
    clickBySelector('.preset-btn[data-preset="best-quality"]'),
  );
  listen(document.getElementById('hud-orient-selected'), 'click', () =>
    clickBySelector('.preset-btn[data-preset="least-support"]'),
  );

  // Supports HUD
  listen(document.getElementById('hud-overhangs-toggle'), 'click', () => {
    const cb = document.getElementById('show-overhangs-cb') as HTMLInputElement | null;
    if (cb) {
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const btn = document.getElementById('hud-overhangs-toggle');
    btn?.classList.toggle('active', !!cb?.checked);
  });
  listen(document.getElementById('hud-generate-supports'), 'click', () =>
    clickById('generate-supports-btn'),
  );
  listen(document.getElementById('hud-clear-supports'), 'click', () =>
    clickById('clear-supports-btn'),
  );

  // Surface HUD — painting toggle
  listen(document.getElementById('hud-paint-toggle'), 'click', () => {
    clickById('paint-toggle-btn');
    const sidebarBtn = document.getElementById('paint-toggle-btn');
    const hudBtn = document.getElementById('hud-paint-toggle');
    if (hudBtn && sidebarBtn) {
      const isActive = sidebarBtn.classList.contains('active');
      hudBtn.textContent = isActive ? 'Start Painting' : 'Stop Painting';
      hudBtn.classList.toggle('active', !isActive);
    }
  });

  // Surface HUD — pattern buttons
  document.querySelectorAll('.hud-pattern-btn[data-pattern]').forEach((hudBtn) => {
    hudBtn.addEventListener('click', () => {
      const pattern = (hudBtn as HTMLElement).dataset.pattern;
      // Sync active state on both HUD and sidebar
      document.querySelectorAll('.hud-pattern-btn').forEach((b) => b.classList.remove('active'));
      hudBtn.classList.add('active');
      // Click corresponding sidebar pattern button
      (
        document.querySelector(
          `.paint-pattern-btn[data-pattern="${pattern}"]`,
        ) as HTMLElement | null
      )?.click();
    });
  });

  // Surface HUD — brush size slider
  const hudBrush = document.getElementById('hud-brush-size') as HTMLInputElement | null;
  if (hudBrush) {
    hudBrush.addEventListener('input', () => {
      const size = parseFloat(hudBrush.value);
      // Forward to viewer if the method exists
      const v = viewer as unknown as { setBrushSize?: (s: number) => void };
      v.setBrushSize?.(size);
    });
  }

  // Slice HUD
  listen(document.getElementById('hud-slice-btn'), 'click', () => clickById('slice-btn'));
  listen(document.getElementById('hud-export-btn'), 'click', () => clickById('export-btn'));

  // Update HUD layer count whenever a slice completes
  document.addEventListener('slice-complete', (e: Event) => {
    const detail = (e as CustomEvent<{ layerCount?: number }>).detail;
    const count = detail?.layerCount ?? getSlicedLayerCount();
    const el = document.getElementById('hud-layer-count');
    if (el) {
      if (count > 0) {
        el.textContent = `${count} layers`;
        el.classList.add('has-layers');
      } else {
        el.textContent = '— layers';
        el.classList.remove('has-layers');
      }
    }
  });

  // Dark mode toggle
  const themeBtn = document.getElementById('theme-toggle-btn');
  const sunIcon = document.getElementById('theme-icon-sun');
  const moonIcon = document.getElementById('theme-icon-moon');

  function applyTheme(dark: boolean): void {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    if (sunIcon) sunIcon.hidden = dark;
    if (moonIcon) moonIcon.hidden = !dark;
  }

  const savedTheme = localStorage.getItem('slicelab.theme');
  const prefersDark =
    savedTheme === 'dark' ||
    (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  applyTheme(prefersDark);

  listen(themeBtn, 'click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    applyTheme(!isDark);
    localStorage.setItem('slicelab.theme', isDark ? 'light' : 'dark');
  });

  return {
    showToolPanel,
    getActiveToolPanel: () => activeToolPanel,
  };
}
