import type { AppContext } from '@core/types';
import { listen } from '@features/app-shell/utils';
import { getPillarSet } from './pillar-store';
import { detectSupportIslands, type SupportIsland, type Vec3 } from './support-island-navigator';
import { overhangOverlayVisible } from './store';

interface BufferGeometryLike {
  attributes?: {
    position?: {
      array: ArrayLike<number>;
    };
  };
}

interface FocusableViewer {
  camera?: { position: { set(x: number, y: number, z: number): void } };
  controls?: { target: { set(x: number, y: number, z: number): void }; update(): void };
  requestRender(): void;
}

export interface SupportIslandPanel {
  reset(): void;
}

export function mountSupportIslandNavigator(
  ctx: AppContext,
  deps: {
    overhangAngle: HTMLInputElement | null;
    showOverhangsCb: HTMLInputElement | null;
    refreshOverhangOverlay(): void;
  },
): SupportIslandPanel {
  const { viewer } = ctx;
  const detectBtn = document.getElementById('support-island-detect-btn');
  const prevBtn = document.getElementById('support-island-prev-btn') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('support-island-next-btn') as HTMLButtonElement | null;
  const resolveBtn = document.getElementById(
    'support-island-resolve-btn',
  ) as HTMLButtonElement | null;
  const countEl = document.getElementById('support-island-count');
  const detailEl = document.getElementById('support-island-detail');
  let islands: SupportIsland[] = [];
  let activeIndex = 0;
  const resolvedIds = new Set<string>();

  function detect(): void {
    if (viewer.selected.length !== 1) {
      islands = [];
      render('Select one model to scan.');
      return;
    }
    const obj = viewer.selected[0];
    const positions = geometryPositions(viewer.getModelGeometry() as BufferGeometryLike | null);
    if (!positions) {
      islands = [];
      render('No model geometry available.');
      return;
    }

    islands = detectSupportIslands(
      positions,
      positions.length / 9,
      collectSupportContacts(obj.id),
      {
        overhangParams: { angleDeg: parseFloat(deps.overhangAngle?.value ?? '45') },
        resolvedIds,
      },
    );
    activeIndex = firstUnresolvedIndex();
    if (deps.showOverhangsCb) deps.showOverhangsCb.checked = true;
    overhangOverlayVisible.value = true;
    deps.refreshOverhangOverlay();
    render();
    focusActive();
  }

  function render(message?: string): void {
    const unresolved = islands.filter((island) => !island.resolved);
    const active = islands[activeIndex] ?? null;
    if (countEl) {
      countEl.textContent =
        islands.length === 0 ? 'No regions' : `${unresolved.length} open / ${islands.length}`;
    }
    if (detailEl) {
      if (message) detailEl.textContent = message;
      else if (!active) detailEl.textContent = 'No unsupported overhang clusters detected.';
      else {
        detailEl.textContent = `Region ${activeIndex + 1} of ${islands.length}: ${active.triangleCount} overhang face${active.triangleCount === 1 ? '' : 's'}.`;
      }
    }

    const canNavigate = islands.length > 1;
    if (prevBtn) prevBtn.disabled = !canNavigate;
    if (nextBtn) nextBtn.disabled = !canNavigate;
    if (resolveBtn) resolveBtn.disabled = !active || active.resolved;
  }

  function step(delta: number): void {
    if (islands.length === 0) return;
    activeIndex = (activeIndex + delta + islands.length) % islands.length;
    render();
    focusActive();
  }

  function resolveActive(): void {
    const active = islands[activeIndex];
    if (!active) return;
    active.resolved = true;
    resolvedIds.add(active.id);
    activeIndex = firstUnresolvedIndex();
    render();
    focusActive();
  }

  function firstUnresolvedIndex(): number {
    const index = islands.findIndex((island) => !island.resolved);
    return index >= 0 ? index : 0;
  }

  function focusActive(): void {
    const island = islands[activeIndex];
    if (!island) return;
    const focusable = viewer as unknown as FocusableViewer;
    if (!focusable.camera || !focusable.controls) return;
    const span = Math.max(
      island.max.x - island.min.x,
      island.max.y - island.min.y,
      island.max.z - island.min.z,
      8,
    );
    focusable.controls.target.set(island.center.x, island.center.y, island.center.z);
    focusable.camera.position.set(
      island.center.x + span * 1.5,
      island.center.y + span * 1.1,
      island.center.z + span * 1.5,
    );
    focusable.controls.update();
    focusable.requestRender();
  }

  function reset(): void {
    islands = [];
    activeIndex = 0;
    resolvedIds.clear();
    render('Scan the selected model to navigate unsupported overhang clusters.');
  }

  listen(detectBtn, 'click', detect);
  listen(prevBtn, 'click', () => step(-1));
  listen(nextBtn, 'click', () => step(1));
  listen(resolveBtn, 'click', resolveActive);
  listen(viewer.canvas, 'selection-changed', reset);
  reset();
  return { reset };
}

export function collectSupportContacts(modelId: string, fallback: Vec3[] = []): Vec3[] {
  const set = getPillarSet(modelId);
  const contacts: Vec3[] = set.pillars.map((pillar) => pillar.contact);
  for (const structure of set.supportStructures ?? []) {
    for (const touchpoint of structure.touchpoints) {
      if (touchpoint.enabled) contacts.push(touchpoint.position);
    }
  }
  return contacts.length > 0 ? contacts : fallback;
}

function geometryPositions(geometry: BufferGeometryLike | null): Float32Array | null {
  const array = geometry?.attributes?.position?.array;
  if (!array) return null;
  if (array instanceof Float32Array) return array;
  return Float32Array.from(Array.from(array));
}
