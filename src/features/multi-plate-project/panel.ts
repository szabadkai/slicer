/**
 * Plate tab management — render tabs, add/remove/rename/switch plates.
 */
import type { AppContext, ProjectState, Plate } from '@core/types';
import type { LegacyPlate } from '@core/legacy-types';
import { escapeHtml, listen } from '@features/app-shell/utils';
import {
  showContextMenu,
  hideContextMenu,
  getActiveMenuContext,
} from '@features/app-shell/context-menu';
import { renumberDefaultNames } from './ops';

export function mountPlatePanel(
  ctx: AppContext,
  project: ProjectState,
  getActivePlate: () => LegacyPlate,
  saveSliceRefsToActivePlate: () => void,
  syncSliceRefsFromActivePlate: () => void,
  clearActivePlateSlice: () => void,
  layoutPlateOrigins: () => void,
): { renderPlateTabs: () => void } {
  const { viewer } = ctx;
  const plateTabs = document.getElementById('plate-tabs');
  const addPlateBtn = document.getElementById('add-plate-btn');
  const removePlateBtn = document.getElementById('remove-plate-btn');

  function createPlate(index: number): LegacyPlate {
    return {
      id: `plate-${Date.now()}-${index}`,
      name: `Plate ${index}`,
      objects: [],
      selectedIds: [],
      originX: 0,
      originZ: 0,
      dirty: false,
      slicedLayers: null,
      slicedLayerCount: 0,
      slicedVolumes: null,
    };
  }

  function addPlate(): LegacyPlate {
    const plate = createPlate(project.plates.length + 1);
    project.plates.push(plate);
    layoutPlateOrigins();
    renumberDefaultNames(project.plates as unknown as Plate[]);
    viewer.setPlates(project.plates);
    viewer.frameAllPlates();
    renderPlateTabs();
    ctx.scheduleProjectAutosave();
    return plate;
  }

  function switchToPlate(plate: LegacyPlate): void {
    if (!plate || plate.id === project.activePlateId) return;
    saveSliceRefsToActivePlate();
    project.activePlateId = plate.id;
    viewer.setActivePlate(plate);
    syncSliceRefsFromActivePlate();
    ctx.updateEstimate();
    renderPlateTabs();
    ctx.scheduleProjectAutosave();
  }

  function deletePlate(plate: LegacyPlate): void {
    if (project.plates.length === 1) {
      if (plate.objects.length > 0 && !confirm(`Clear ${plate.name}?`)) return;
      viewer.clearPlate();
      clearActivePlateSlice();
      renderPlateTabs();
      ctx.scheduleProjectAutosave();
      return;
    }
    if (!confirm(`Delete ${plate.name}?`)) return;
    const wasActive = plate.id === project.activePlateId;
    const index = project.plates.indexOf(plate);
    const orphanedObjects = [...plate.objects];

    // Move orphaned models to the nearest remaining plate instead of destroying them
    if (orphanedObjects.length > 0) {
      if (wasActive) viewer.replaceActiveObjects([]);
      // Pick the target plate (previous neighbor, or first remaining)
      const targetIndex = Math.max(0, index - 1 === index ? 0 : index - 1);
      const remaining = project.plates.filter((p) => p !== plate);
      const targetPlate = remaining[Math.min(targetIndex, remaining.length - 1)];

      for (const obj of orphanedObjects) {
        targetPlate.objects.push(obj);
      }
      plate.objects = [];
      targetPlate.dirty = true;
    } else {
      if (wasActive) viewer.replaceActiveObjects([]);
    }

    project.plates.splice(index, 1);
    layoutPlateOrigins();
    viewer.setPlates(project.plates);
    renumberDefaultNames(project.plates as unknown as Plate[]);
    if (wasActive) {
      project.activePlateId = project.plates[Math.max(0, index - 1)].id;
      viewer.setActivePlate(getActivePlate());
      syncSliceRefsFromActivePlate();
    }

    // Auto-arrange remaining plates so orphaned models get placed outside build volumes
    if (orphanedObjects.length > 0) {
      viewer.distributeAcrossPlates(project.plates);
    }

    renderPlateTabs();
    ctx.scheduleProjectAutosave();
  }

  function renamePlate(plate: LegacyPlate): void {
    const nextName = prompt('Plate name', plate.name);
    if (!nextName) return;
    plate.name = nextName.trim() || plate.name;
    renderPlateTabs();
    ctx.scheduleProjectAutosave();
  }

  function reorderPlate(sourceId: string, targetId: string): void {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const si = project.plates.findIndex((p) => p.id === sourceId);
    const ti = project.plates.findIndex((p) => p.id === targetId);
    if (si === -1 || ti === -1) return;
    const [plate] = project.plates.splice(si, 1);
    project.plates.splice(ti, 0, plate);
    layoutPlateOrigins();
    viewer.setPlates(project.plates);
    renumberDefaultNames(project.plates as unknown as Plate[]);
    renderPlateTabs();
    ctx.scheduleProjectAutosave();
  }

  function renderPlateTabs(): void {
    if (!plateTabs) return;
    const showControls = project.plates.length > 1;
    plateTabs.hidden = !showControls;
    if (removePlateBtn) {
      (removePlateBtn as HTMLElement).hidden = !showControls;
    }
    plateTabs.innerHTML = '';
    if (!showControls) return;

    project.plates.forEach((plate) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `plate-tab${plate.id === project.activePlateId ? ' active' : ''}`;
      btn.draggable = true;
      btn.dataset.plateId = plate.id;
      const count = plate.objects.length;
      const status = plate.slicedLayers ? 'sliced' : plate.dirty && count > 0 ? 'dirty' : 'ready';
      btn.innerHTML = `
        <span class="plate-tab-title">${escapeHtml(plate.name)}</span>
        <span class="plate-tab-meta">
          <span>${count} item${count === 1 ? '' : 's'}</span>
          <span class="plate-status ${status === 'dirty' ? 'warn' : ''}">${status}</span>
        </span>
      `;
      btn.addEventListener('click', () => switchToPlate(plate));
      btn.addEventListener('dblclick', () => renamePlate(plate));
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, {
          title: plate.name,
          context: { type: 'plate', plateId: plate.id },
          items: [
            { action: 'plate-rename', label: 'Rename' },
            {
              action: 'plate-delete',
              label: project.plates.length === 1 ? 'Clear Plate' : 'Delete Plate',
              danger: true,
            },
          ],
        });
      });
      btn.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plate-reorder', plate.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      btn.addEventListener('dragover', (e) => {
        e.preventDefault();
        btn.classList.add('drag-over');
      });
      btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
      btn.addEventListener('drop', (e) => {
        e.preventDefault();
        btn.classList.remove('drag-over');
        const reorderId = e.dataTransfer?.getData('text/plate-reorder');
        if (reorderId) {
          reorderPlate(reorderId, plate.id);
          return;
        }
        // Move selection to plate
        if (viewer.selected.length > 0) {
          viewer.moveSelectedToPlate(plate);
          switchToPlate(plate);
        }
      });
      plateTabs.appendChild(btn);
    });
  }

  // Wire buttons
  listen(addPlateBtn, 'click', () => switchToPlate(addPlate()));
  listen(removePlateBtn, 'click', () => deletePlate(getActivePlate()));

  // Context menu action handler
  const menu = document.getElementById('context-menu');
  listen(menu, 'click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-menu-action]') as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset.menuAction;
    const menuCtx = getActiveMenuContext();
    hideContextMenu();
    if (menuCtx?.type === 'plate') {
      const plate = project.plates.find((p) => p.id === menuCtx.plateId);
      if (!plate) return;
      if (action === 'plate-rename') renamePlate(plate);
      if (action === 'plate-delete') deletePlate(plate);
    }
  });

  renderPlateTabs();

  return { renderPlateTabs };
}
