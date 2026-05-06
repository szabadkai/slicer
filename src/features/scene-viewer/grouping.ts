/**
 * Model grouping — group/ungroup selected objects for batch operations.
 *
 * Groups are logical overlays on top of individual scene objects.
 * When a grouped object is selected, the entire group is selected.
 */
import type { AppContext } from '@core/types';
import { listen } from '@features/app-shell/utils';
import { signal, computed } from '@preact/signals-core';

export interface ModelGroup {
  id: string;
  name: string;
  memberIds: string[];
}

/** All defined groups */
export const groups = signal<ModelGroup[]>([]);

/** Number of groups */
export const groupCount = computed(() => groups.value.length);

let nextGroupId = 1;

function generateGroupId(): string {
  return `group-${nextGroupId++}`;
}

/**
 * Find which group (if any) a model belongs to.
 */
export function findGroupForModel(modelId: string): ModelGroup | undefined {
  return groups.value.find((g) => g.memberIds.includes(modelId));
}

/**
 * Create a group from the given model IDs.
 */
export function createGroup(memberIds: string[], name?: string): ModelGroup {
  // Remove members from any existing groups first
  ungroupModels(memberIds);

  const group: ModelGroup = {
    id: generateGroupId(),
    name: name ?? `Group ${nextGroupId - 1}`,
    memberIds: [...memberIds],
  };
  groups.value = [...groups.value, group];
  return group;
}

/**
 * Remove models from their groups. If a group becomes empty, it's removed.
 */
export function ungroupModels(modelIds: string[]): void {
  const idSet = new Set(modelIds);
  const updated = groups.value
    .map((g) => ({
      ...g,
      memberIds: g.memberIds.filter((id) => !idSet.has(id)),
    }))
    .filter((g) => g.memberIds.length > 0);
  groups.value = updated;
}

/**
 * Remove a specific group, freeing all its members.
 */
export function removeGroup(groupId: string): void {
  groups.value = groups.value.filter((g) => g.id !== groupId);
}

/**
 * Get all member IDs that should be selected when one member is clicked.
 */
export function expandGroupSelection(selectedIds: string[]): string[] {
  const expanded = new Set(selectedIds);
  for (const id of selectedIds) {
    const group = findGroupForModel(id);
    if (group) {
      for (const memberId of group.memberIds) {
        expanded.add(memberId);
      }
    }
  }
  return [...expanded];
}

/**
 * Mount the grouping UI in the edit panel.
 */
export function mountGrouping(ctx: AppContext): void {
  const { viewer } = ctx;
  const groupBtn = document.getElementById('group-btn');
  const ungroupBtn = document.getElementById('ungroup-btn');
  const groupInfo = document.getElementById('group-info');

  function updateUI(): void {
    const sel = viewer.selected;
    if (groupBtn) groupBtn.classList.toggle('disabled', sel.length < 2);

    const anyGrouped = sel.some((o) => findGroupForModel(o.id));
    if (ungroupBtn) ungroupBtn.classList.toggle('disabled', !anyGrouped);

    if (groupInfo) {
      const count = groupCount.value;
      groupInfo.textContent = count > 0 ? `${count} group${count !== 1 ? 's' : ''}` : '';
    }
  }

  listen(groupBtn, 'click', () => {
    const sel = viewer.selected;
    if (sel.length < 2) return;

    const ids = sel.map((o) => o.id);
    createGroup(ids);
    updateUI();
  });

  listen(ungroupBtn, 'click', () => {
    const sel = viewer.selected;
    if (sel.length === 0) return;

    ungroupModels(sel.map((o) => o.id));
    updateUI();
  });

  // Expand selection to include group members
  listen(viewer.canvas, 'selection-changed', () => {
    const sel = viewer.selected;
    if (sel.length === 0) {
      updateUI();
      return;
    }

    const expandedIds = expandGroupSelection(sel.map((o) => o.id));
    if (expandedIds.length > sel.length) {
      // Select additional group members
      viewer.selectObjects(expandedIds);
    }
    updateUI();
  });

  listen(viewer.canvas, 'mesh-changed', updateUI);
  updateUI();
}
