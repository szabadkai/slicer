/**
 * Trap analysis actions — analyze and auto-suggest drain positions.
 * Extracted from panel.ts for LOC compliance.
 */
import type * as THREE from 'three';
import { detectTraps, type TrapResult } from './trap-detector';
import { addDrainHole, removeDrainHole, type DrainHole } from './drain';

export interface TrapActionDeps {
  getGeometry(): THREE.BufferGeometry | null;
  getMesh(): THREE.Mesh | null;
  getScene(): THREE.Scene;
  getDrainHoles(): DrainHole[];
  pushDrainHole(hole: DrainHole): void;
  popDrainHole(): DrainHole | undefined;
  getDiameter(): number;
  getWallThickness(): number;
  showProgress(msg: string): void;
  updateProgress(f: number, msg: string): void;
  hideProgress(): void;
  rebuildDrainCuts(): Promise<boolean>;
  renderDrainList(): void;
  requestRender(): void;
}

export async function runTrapAnalysis(
  deps: TrapActionDeps,
  trapResults: HTMLElement,
  trapBadge: HTMLElement | null,
): Promise<TrapResult | null> {
  const geo = deps.getGeometry();
  if (!geo) return null;
  const mesh = deps.getMesh();
  if (!mesh) return null;

  deps.showProgress('Analyzing resin traps…');
  await yieldThread();

  try {
    const result = detectTraps(geo, mesh, deps.getDrainHoles(), {
      voxelSizeMM: 2.0,
      onProgress: (f) => deps.updateProgress(f, 'Flood filling…'),
    });

    const drainableML = (result.drainableVolumeMM3 / 1000).toFixed(1);
    const trappedML = (result.trappedVolumeMM3 / 1000).toFixed(1);
    const hasTraps = result.pockets.length > 0;

    if (trapBadge) {
      trapBadge.textContent = hasTraps ? `⚠ ${result.pockets.length}` : '✓';
      trapBadge.className = hasTraps ? 'step-badge step-badge-warn' : 'step-badge step-badge-done';
    }

    trapResults.innerHTML = `
      <div class="trap-stat trap-stat-ok">🟢 Drainable: ${drainableML} mL</div>
      <div class="trap-stat trap-stat-bad">🔴 Trapped: ${trappedML} mL</div>
      ${result.pockets
        .map(
          (p, i) => `
        <div class="trap-pocket">
          <span>Pocket ${i + 1} — ${(p.volumeMM3 / 1000).toFixed(2)} mL</span>
          <button class="btn btn-small trap-add-hole-btn" data-pocket="${i}">+ Add hole here</button>
        </div>
      `,
        )
        .join('')}
      ${!hasTraps ? '<div class="trap-ok">✅ All interior volume is drainable.</div>' : ''}
    `;

    // Wire "Add hole here" buttons
    trapResults.querySelectorAll('.trap-add-hole-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = parseInt((btn as HTMLElement).dataset.pocket ?? '0', 10);
        const pocket = result.pockets[i];
        if (!pocket) return;
        const hole = addDrainHole(
          deps.getScene(),
          pocket.suggestedHolePos,
          pocket.suggestedHoleNormal,
          deps.getDiameter(),
          deps.getWallThickness(),
        );
        deps.pushDrainHole(hole);
        void deps.rebuildDrainCuts();
        deps.renderDrainList();
        deps.requestRender();
      });
    });

    return result;
  } finally {
    deps.hideProgress();
  }
}

export async function autoSuggestDrains(
  deps: TrapActionDeps,
  trapResults: HTMLElement | null,
): Promise<void> {
  const geo = deps.getGeometry();
  if (!geo) return;
  const mesh = deps.getMesh();
  if (!mesh) return;

  deps.showProgress('Auto-suggesting drain positions…');
  await yieldThread();

  try {
    const result = detectTraps(geo, mesh, deps.getDrainHoles(), {
      voxelSizeMM: 2.0,
      onProgress: (f) => deps.updateProgress(f * 0.8, 'Analyzing traps…'),
    });

    if (result.pockets.length === 0) {
      if (trapResults) {
        trapResults.innerHTML =
          '<div class="trap-ok">✅ No trapped pockets found — no additional drains needed.</div>';
      }
      return;
    }

    const diameter = deps.getDiameter();
    let placed = 0;
    for (const pocket of result.pockets) {
      const hole = addDrainHole(
        deps.getScene(),
        pocket.suggestedHolePos,
        pocket.suggestedHoleNormal,
        diameter,
        deps.getWallThickness(),
      );
      deps.pushDrainHole(hole);
      placed++;
    }

    deps.updateProgress(0.9, 'Cutting drain holes…');
    await yieldThread();
    const didCut = await deps.rebuildDrainCuts();
    if (!didCut) {
      for (let i = 0; i < placed; i++) {
        const hole = deps.popDrainHole();
        if (hole) removeDrainHole(deps.getScene(), hole);
      }
    }

    deps.renderDrainList();
    deps.requestRender();

    if (trapResults) {
      trapResults.innerHTML = didCut
        ? `<div class="trap-ok">✅ Added ${placed} drain hole${placed > 1 ? 's' : ''} at trapped pockets.</div>`
        : `<div class="trap-stat trap-stat-bad">⚠ Could not cut suggested drain holes.</div>`;
    }
  } finally {
    deps.hideProgress();
  }
}

function yieldThread(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}
