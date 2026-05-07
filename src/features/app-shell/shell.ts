/**
 * App shell — tool panel switching, keyboard shortcuts, sidebar toggle.
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

const PANEL_IDS: Record<ToolPanel, string[]> = {
  plate: ['load-panel', 'edit-panel', 'transform-panel'],
  orient: ['orientation-panel'],
  modify: ['cut-panel', 'hollow-panel', 'primitive-boolean-panel'],
  supports: ['supports-panel'],
  surface: ['paint-panel', 'materials-panel'],
  slice: ['slice-panel', 'health-panel', 'measure-panel'],
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
