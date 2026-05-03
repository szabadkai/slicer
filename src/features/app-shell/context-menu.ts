/**
 * Context menu — shared popup menu used by export, plates, etc.
 */
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

export function showContextMenu(
  clientX: number,
  clientY: number,
  opts: MenuOptions = {},
): void {
  const menu = document.getElementById('context-menu');
  if (!menu) return;
  const { title = 'Actions', items = [], context = null } = opts;
  activeMenuContext = context;

  menu.innerHTML =
    `<div class="context-menu-label">${escapeHtml(title)}</div>` +
    items
      .map(
        (item) =>
          `<button type="button" class="context-menu-item${item.danger ? ' danger' : ''}" ` +
          `data-menu-action="${escapeHtml(item.action)}"${item.disabled ? ' disabled' : ''}>` +
          `${escapeHtml(item.label)}</button>`,
      )
      .join('');
  menu.hidden = false;

  const { innerWidth, innerHeight } = window;
  const rect = menu.getBoundingClientRect();
  const x = Math.min(clientX, innerWidth - rect.width - 8);
  const y = Math.min(clientY, innerHeight - rect.height - 8);
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
