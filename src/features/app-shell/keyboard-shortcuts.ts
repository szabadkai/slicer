/**
 * Data-driven keyboard shortcut dispatch.
 * Each binding declares its key, modifiers, and action — no if-else cascade.
 */
import type { LegacyViewer } from '@core/legacy-types';
import { activeCutter } from '@core/state';

interface ShortcutBinding {
  key: string;
  mod?: boolean;
  shift?: boolean;
  action: (ctx: ShortcutContext) => void;
}

export interface ShortcutContext {
  viewer: LegacyViewer;
  showToolPanel: (name: string) => void;
  getActiveToolPanel: () => string;
  hasSlicedLayers: () => boolean;
  toggleSidebar: () => void;
}

const TOOL_PANEL_KEYS: Record<string, string> = {
  '1': 'scene',
  '2': 'orient',
  '3': 'modify',
  '4': 'supports',
  '5': 'surface',
  '6': 'material',
  '7': 'inspect',
  '8': 'slice',
};

const TOOL_PANELS = [
  'scene',
  'orient',
  'modify',
  'supports',
  'surface',
  'material',
  'inspect',
  'slice',
] as const;

const MOD_SHIFT_BINDINGS: ShortcutBinding[] = [
  { key: 'a', mod: true, shift: true, action: ({ viewer }) => viewer.autoArrange() },
  {
    key: 's',
    mod: true,
    shift: true,
    action: () => document.getElementById('slice-all-btn')?.click(),
  },
  {
    key: 'e',
    mod: true,
    shift: true,
    action: () => document.getElementById('export-all-btn')?.click(),
  },
];

const MOD_BINDINGS: ShortcutBinding[] = [
  { key: 'a', mod: true, action: ({ viewer }) => viewer.selectAll() },
  { key: 'd', mod: true, action: ({ viewer }) => viewer.duplicateSelected() },
  { key: 'c', mod: true, action: ({ viewer }) => viewer.copySelected() },
  { key: 'v', mod: true, action: ({ viewer }) => viewer.paste() },
  { key: 'z', mod: true, action: ({ viewer }) => viewer.undo() },
  { key: 's', mod: true, action: () => document.getElementById('slice-btn')?.click() },
  { key: 'e', mod: true, action: () => document.getElementById('export-btn')?.click() },
];

const SIMPLE_BINDINGS: ShortcutBinding[] = [
  { key: 'g', action: ({ viewer }) => viewer.autoArrange() },
  { key: 'f', action: ({ viewer }) => viewer.fillPlatform() },
];

function handleLayerNavigation(e: KeyboardEvent, hasSlicedLayers: boolean): boolean {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;
  if (!hasSlicedLayers) return false;

  e.preventDefault();
  const slider = document.getElementById('layer-slider') as HTMLInputElement | null;
  if (slider) {
    const cur = Number.parseInt(slider.value, 10);
    const max = Number.parseInt(slider.max, 10);
    slider.value = String(e.key === 'ArrowRight' ? Math.min(cur + 1, max) : Math.max(cur - 1, 0));
    slider.dispatchEvent(new Event('input'));
  }
  return true;
}

function handleTabCycle(e: KeyboardEvent, ctx: ShortcutContext): boolean {
  if (e.key !== 'Tab') return false;

  e.preventDefault();
  const idx = TOOL_PANELS.indexOf(ctx.getActiveToolPanel() as (typeof TOOL_PANELS)[number]);
  const next = e.shiftKey
    ? (idx - 1 + TOOL_PANELS.length) % TOOL_PANELS.length
    : (idx + 1) % TOOL_PANELS.length;
  ctx.showToolPanel(TOOL_PANELS[next]);
  return true;
}

function shouldIgnoreEvent(e: KeyboardEvent): boolean {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return true;
  const inspectorModal = document.getElementById('layer-inspector');
  if (inspectorModal && !inspectorModal.hidden) return true;
  return false;
}

function handleEscape(_e: KeyboardEvent, ctx: ShortcutContext): boolean {
  // Cancel active paint tools first
  if (ctx.viewer.intentPaintMode) {
    ctx.viewer.setIntentPaintMode(false);
    const btn = document.getElementById('intent-paint-btn');
    if (btn) btn.classList.remove('active');
    return true;
  }
  if (ctx.viewer.paintToolEnabled) {
    ctx.viewer.setPaintToolEnabled?.(false);
    const btn = document.getElementById('paint-toggle-btn');
    if (btn) btn.classList.remove('active');
    return true;
  }
  // Cancel primitive boolean cutter
  if (activeCutter.value) {
    activeCutter.value = null;
    return true;
  }
  // Cancel active volume fill (paint or intent)
  const volToolbar = document.getElementById('vol-viewer-toolbar');
  if (volToolbar && !volToolbar.hidden) {
    document.dispatchEvent(new CustomEvent('vol-fill-cancel'));
    return true;
  }
  // Cancel drain hole pick mode
  const drainPick = document.getElementById('drain-pick-btn') as HTMLButtonElement | null;
  if (drainPick?.classList.contains('active')) {
    drainPick.click();
    return true;
  }
  // Clear selection (also dismisses cut plane via selection-changed)
  if (ctx.viewer.selected.length > 0) {
    ctx.viewer.clearSelection();
    return true;
  }
  return true; // consume ESC even if no tool active
}

function handleSpecialKeys(e: KeyboardEvent, ctx: ShortcutContext): boolean {
  if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    ctx.toggleSidebar();
    return true;
  }
  if (e.key === '?') {
    const modal = document.getElementById('shortcuts-modal');
    if (modal) modal.hidden = false;
    return true;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    ctx.viewer.removeSelected();
    return true;
  }
  return false;
}

function handleModifierCombos(e: KeyboardEvent, ctx: ShortcutContext): boolean {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return false;

  if (e.shiftKey) {
    const binding = MOD_SHIFT_BINDINGS.find((b) => b.key === e.key.toLowerCase());
    if (binding) {
      e.preventDefault();
      binding.action(ctx);
      return true;
    }
  }

  const binding = MOD_BINDINGS.find((b) => b.key === e.key.toLowerCase());
  if (binding) {
    e.preventDefault();
    binding.action(ctx);
    return true;
  }
  return false;
}

function handleSimpleKeys(e: KeyboardEvent, ctx: ShortcutContext): boolean {
  const simpleBinding = SIMPLE_BINDINGS.find((b) => b.key === e.key.toLowerCase());
  if (simpleBinding) {
    simpleBinding.action(ctx);
    return true;
  }

  if (handleTabCycle(e, ctx)) return true;

  if (TOOL_PANEL_KEYS[e.key]) {
    ctx.showToolPanel(TOOL_PANEL_KEYS[e.key]);
    return true;
  }

  if (e.key === ' ') {
    e.preventDefault();
    if (ctx.viewer.selected.length > 0 || ctx.viewer.objects.length > 0) {
      ctx.showToolPanel('scene');
    }
    return true;
  }

  return false;
}

export function handleKeydown(e: KeyboardEvent, ctx: ShortcutContext): void {
  if (e.key === 'Escape') {
    handleEscape(e, ctx);
    return;
  }
  if (shouldIgnoreEvent(e)) return;
  if (handleSpecialKeys(e, ctx)) return;
  if (handleModifierCombos(e, ctx)) return;
  if (handleSimpleKeys(e, ctx)) return;

  if (ctx.getActiveToolPanel() === 'slice') {
    handleLayerNavigation(e, ctx.hasSlicedLayers());
  }
}
