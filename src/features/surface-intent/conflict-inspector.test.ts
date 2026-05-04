// ─── Conflict inspector tests ───────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectedConflicts,
  selectedConflictIndex,
  setConflicts,
  clearConflicts,
  getSelectedConflictTriangles,
} from './conflict-inspector';
import type { IntentConflict } from './engine-types';

const MOCK_CONFLICTS: IntentConflict[] = [
  {
    triangleIndices: [0, 1, 2],
    type: 'cosmetic-needs-support',
    severity: 'warning',
    description: '3 cosmetic faces need support',
    suggestion: 'Reorient the model',
  },
  {
    triangleIndices: [10, 11],
    type: 'cosmetic-reliability-overlap',
    severity: 'warning',
    description: '2 faces overlap',
    suggestion: 'Review intent boundaries',
  },
];

describe('conflict inspector state', () => {
  beforeEach(() => {
    clearConflicts();
  });

  it('starts with no conflicts', () => {
    expect(detectedConflicts.value).toEqual([]);
    expect(selectedConflictIndex.value).toBeNull();
  });

  it('setConflicts updates the signal', () => {
    setConflicts(MOCK_CONFLICTS);
    expect(detectedConflicts.value).toHaveLength(2);
    expect(detectedConflicts.value[0].type).toBe('cosmetic-needs-support');
  });

  it('setConflicts resets selection', () => {
    selectedConflictIndex.value = 1;
    setConflicts(MOCK_CONFLICTS);
    expect(selectedConflictIndex.value).toBeNull();
  });

  it('clearConflicts empties everything', () => {
    setConflicts(MOCK_CONFLICTS);
    selectedConflictIndex.value = 0;
    clearConflicts();
    expect(detectedConflicts.value).toEqual([]);
    expect(selectedConflictIndex.value).toBeNull();
  });

  it('getSelectedConflictTriangles returns empty when nothing selected', () => {
    setConflicts(MOCK_CONFLICTS);
    expect(getSelectedConflictTriangles()).toEqual([]);
  });

  it('getSelectedConflictTriangles returns triangle indices of selected conflict', () => {
    setConflicts(MOCK_CONFLICTS);
    selectedConflictIndex.value = 0;
    expect(getSelectedConflictTriangles()).toEqual([0, 1, 2]);
  });

  it('getSelectedConflictTriangles returns correct indices for second conflict', () => {
    setConflicts(MOCK_CONFLICTS);
    selectedConflictIndex.value = 1;
    expect(getSelectedConflictTriangles()).toEqual([10, 11]);
  });

  it('getSelectedConflictTriangles handles out-of-bounds index', () => {
    setConflicts(MOCK_CONFLICTS);
    selectedConflictIndex.value = 99;
    expect(getSelectedConflictTriangles()).toEqual([]);
  });
});
