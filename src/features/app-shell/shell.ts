/**
 * App shell — tool panel switching, keyboard shortcuts, sidebar toggle.
 */
import type { AppContext } from '@core/types';
import { listen } from './utils';
import { getSlicedLayerCount } from './mount';
import { handleKeydown } from './keyboard-shortcuts';

const TOOL_PANELS = ['edit', 'transform', 'orient', 'supports', 'materials', 'health', 'slice'] as const;
type ToolPanel = typeof TOOL_PANELS[number];

const TOOL_BTN_IDS: Record<ToolPanel, string> = {
  edit: 'edit-btn',
  transform: 'transform-btn',
  orient: 'orient-btn',
  supports: 'support-tool-btn',
  materials: 'material-btn',
  health: 'health-btn',
  slice: 'slice-tool-btn',
};

const PANEL_IDS: Record<ToolPanel, string> = {
  edit: 'edit-panel',
  transform: 'transform-panel',
  orient: 'orientation-panel',
  supports: 'supports-panel',
  materials: 'materials-panel',
  health: 'health-panel',
  slice: 'slice-panel',
};

export function mountShell(ctx: AppContext): {
  showToolPanel: (name: string) => void;
  getActiveToolPanel: () => string;
} {
  const { viewer } = ctx;
  let activeToolPanel: ToolPanel = 'edit';

  function showToolPanel(name: string): void {
    const panel = name as ToolPanel;
    if (!TOOL_PANELS.includes(panel)) return;

    // Expand the sidebar if it was collapsed
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('toggle-sidebar-btn');
    if (sidebar?.classList.contains('collapsed')) {
      sidebar.classList.remove('collapsed');
      toggleBtn?.classList.remove('collapsed');
    }

    for (const p of TOOL_PANELS) {
      const panelEl = document.getElementById(PANEL_IDS[p]);
      const btnEl = document.getElementById(TOOL_BTN_IDS[p]);
      if (panelEl) panelEl.hidden = true;
      if (btnEl) btnEl.classList.remove('active');
    }

    const layerPanel = document.getElementById('layer-preview-panel');
    const footerActions = document.getElementById('footer-actions');
    if (layerPanel) layerPanel.hidden = true;
    if (footerActions) footerActions.hidden = panel !== 'slice';

    const activePanel = document.getElementById(PANEL_IDS[panel]);
    const activeBtn = document.getElementById(TOOL_BTN_IDS[panel]);
    if (activePanel) activePanel.hidden = false;
    if (activeBtn) activeBtn.classList.add('active');
    activeToolPanel = panel;

    if (panel === 'transform') {
      const activeMode = document.getElementById('transform-panel')?.querySelector('.mode-btn.active') as HTMLElement | null;
      if (activeMode) viewer.setTransformMode(activeMode.dataset.mode ?? 'translate');
    } else {
      viewer.setTransformMode(null);
    }

    if (panel === 'slice' && getSlicedLayerCount() > 0) {
      if (layerPanel) layerPanel.hidden = false;
    }

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

  // Shortcuts modal
  const shortcutsBtn = document.getElementById('shortcuts-btn');
  const shortcutsModal = document.getElementById('shortcuts-modal');
  const shortcutsClose = document.getElementById('shortcuts-modal-close');
  listen(shortcutsBtn, 'click', () => { if (shortcutsModal) shortcutsModal.hidden = false; });
  listen(shortcutsClose, 'click', () => { if (shortcutsModal) shortcutsModal.hidden = true; });
  listen(shortcutsModal, 'click', (e) => { if (e.target === shortcutsModal && shortcutsModal) shortcutsModal.hidden = true; });

  showToolPanel('edit');

  return {
    showToolPanel,
    getActiveToolPanel: () => activeToolPanel,
  };
}
