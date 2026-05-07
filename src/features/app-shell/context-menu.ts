/**
 * Context menu — shared popup menu used by export, plates, etc.
 * Enhanced with rich viewport right-click menus (Pattern 4).
 */
import type { AppContext } from '@core/types';
import { escapeHtml } from './utils';

export interface MenuItem {
  action: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
}

interface MenuOptions {
  title?: string;
  items?: MenuItem[];
  context?: { type: string; plateId?: string; [k: string]: unknown };
}

let activeMenuContext: MenuOptions['context'] | null = null;

export function getActiveMenuContext(): MenuOptions['context'] | null {
  return activeMenuContext;
}

// ─── Low-level menu renderer ────────────────────────────────────────────────

/**
 * Build raw HTML for a menu. Supports separators (`action === '---'`),
 * group labels (`action === 'label'`), and regular items.
 */
function renderMenuHtml(title: string, items: MenuItem[]): string {
  const rows = items
    .map((item) => {
      if (item.action === '---') return `<div class="context-menu-sep"></div>`;
      if (item.action === 'label')
        return `<div class="context-menu-group-label">${escapeHtml(item.label)}</div>`;
      return (
        `<button type="button" class="context-menu-item${item.danger ? ' danger' : ''}" ` +
        `data-menu-action="${escapeHtml(item.action)}"${item.disabled ? ' disabled' : ''}>` +
        `${escapeHtml(item.label)}</button>`
      );
    })
    .join('');
  return `<div class="context-menu-label">${escapeHtml(title)}</div>${rows}`;
}

export function showContextMenu(clientX: number, clientY: number, opts: MenuOptions = {}): void {
  const menu = document.getElementById('context-menu');
  if (!menu) return;
  const { title = 'Actions', items = [], context = null } = opts;
  activeMenuContext = context;

  menu.innerHTML = renderMenuHtml(title, items);
  positionAndShow(menu, clientX, clientY);
}

function positionAndShow(menu: HTMLElement, clientX: number, clientY: number): void {
  menu.hidden = false;
  // Force layout so getBoundingClientRect is accurate
  const rect = menu.getBoundingClientRect();
  const x = Math.min(clientX, window.innerWidth - rect.width - 8);
  const y = Math.min(clientY, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, x)}px`;
  menu.style.top = `${Math.max(8, y)}px`;
}

export function hideContextMenu(): void {
  const menu = document.getElementById('context-menu');
  if (menu) menu.hidden = true;
  activeMenuContext = null;
}

/** Wire global dismiss on outside click. Returns cleanup. */
export function mountContextMenu(): () => void {
  const menu = document.getElementById('context-menu');
  const onPointerDown = (e: PointerEvent): void => {
    if (menu && !menu.contains(e.target as Node)) hideContextMenu();
  };
  document.addEventListener('pointerdown', onPointerDown);
  return () => document.removeEventListener('pointerdown', onPointerDown);
}

// ─── Pattern 4: Viewport right-click hub ───────────────────────────────────

/** Convenience — click a sidebar button by ID */
function clickById(id: string): void {
  (document.getElementById(id) as HTMLElement | null)?.click();
}

const MODEL_MENU_ITEMS: MenuItem[] = [
  { action: 'label', label: 'Model' },
  { action: 'duplicate', label: 'Duplicate' },
  { action: 'delete', label: 'Delete', danger: true },
  { action: 'drop-bed', label: 'Drop to Bed' },
  { action: '---', label: '' },
  { action: 'label', label: 'Orient' },
  { action: 'orient-fastest', label: '⚡  Fastest' },
  { action: 'orient-balanced', label: '◆  Least Support' },
  { action: 'orient-quality', label: '✦  Best Quality' },
  { action: '---', label: '' },
  { action: 'label', label: 'Tools' },
  { action: 'generate-supports', label: 'Generate Supports' },
  { action: 'analyze-health', label: 'Analyze Mesh Health' },
  { action: '---', label: '' },
  { action: 'label', label: 'Export' },
  { action: 'export-stl', label: 'Export as STL' },
  { action: 'export-3mf', label: 'Export as 3MF' },
  { action: 'export-zip', label: 'Export Slice ZIP' },
];

const EMPTY_MENU_ITEMS: MenuItem[] = [
  { action: 'add-model', label: 'Add Model…' },
  { action: 'auto-arrange', label: 'Auto Arrange All' },
  { action: '---', label: '' },
  { action: 'clear-all', label: 'Clear All', danger: true },
];

function handleMenuAction(action: string, ctx: AppContext): void {
  switch (action) {
    case 'duplicate':
      clickById('duplicate-btn');
      break;
    case 'delete':
      clickById('delete-btn');
      break;
    case 'drop-bed':
      clickById('drop-bed-btn');
      break;
    case 'orient-fastest':
      (document.querySelector('.preset-btn[data-preset="fastest"]') as HTMLElement | null)?.click();
      break;
    case 'orient-balanced':
      (
        document.querySelector('.preset-btn[data-preset="least-support"]') as HTMLElement | null
      )?.click();
      break;
    case 'orient-quality':
      (
        document.querySelector('.preset-btn[data-preset="best-quality"]') as HTMLElement | null
      )?.click();
      break;
    case 'generate-supports':
      ctx.showToolPanel('supports');
      clickById('generate-supports-btn');
      break;
    case 'analyze-health':
      ctx.showToolPanel('slice');
      clickById('health-analyze-btn');
      break;
    case 'export-stl':
      clickById('export-btn');
      break;
    case 'export-3mf':
      clickById('export-btn');
      break;
    case 'export-zip':
      clickById('export-btn');
      break;
    case 'add-model':
      clickById('browse-stl-btn');
      break;
    case 'auto-arrange':
      clickById('arrange-btn');
      break;
    case 'clear-all':
      clickById('clear-btn');
      break;
  }
}

/**
 * Mount the viewport right-click context menu. Call once after panels are mounted.
 * Uses selected model count as a proxy for "clicked on model vs empty space"
 * (the viewer's pick event fires before contextmenu in most engines).
 */
export function mountViewportContextMenu(ctx: AppContext): () => void {
  const viewport = document.getElementById('viewport');
  const menu = document.getElementById('context-menu');
  if (!viewport || !menu) return () => {};

  const onContextMenu = (e: Event): void => {
    const me = e as MouseEvent;
    me.preventDefault();

    // Determine context: model selected = model menu, otherwise empty-space menu
    const viewer = ctx.viewer as unknown as Record<string, unknown>;
    const selectedModels: unknown[] =
      (typeof viewer.getSelectedModels === 'function'
        ? (viewer.getSelectedModels as () => unknown[])()
        : null) ??
      (typeof viewer.getObjects === 'function'
        ? ((viewer.getObjects as () => unknown[])() ?? []).filter(Boolean)
        : []);

    const hasSelection = selectedModels.length > 0;

    if (hasSelection) {
      menu.innerHTML = renderMenuHtml('Model', MODEL_MENU_ITEMS);
    } else {
      menu.innerHTML = renderMenuHtml('Viewport', EMPTY_MENU_ITEMS);
    }

    activeMenuContext = { type: hasSelection ? 'model' : 'empty' };
    positionAndShow(menu, me.clientX, me.clientY);

    // Wire menu item clicks
    const handler = (evt: Event): void => {
      const target = evt.target as HTMLElement;
      const action = target.closest('[data-menu-action]')?.getAttribute('data-menu-action');
      if (action) {
        handleMenuAction(action, ctx);
        hideContextMenu();
      }
    };
    menu.addEventListener('click', handler, { once: true });
  };

  viewport.addEventListener('contextmenu', onContextMenu);
  return () => viewport.removeEventListener('contextmenu', onContextMenu);
}
