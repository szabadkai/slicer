import { describe, it, expect, beforeEach, vi } from 'vitest';
import { selectedModelIds, selectedPrinterKey } from '@core/state';
import type { ViewerService, PrinterSpec } from '@core/types';
import {
  selectModel,
  clearSelection,
  hasSelection,
  syncBuildVolume,
  currentCameraView,
  mountSceneViewer,
} from './ops';

function mockViewer(): ViewerService {
  return {
    init: vi.fn(() => Promise.resolve()),
    addModel: vi.fn(() => 'mock-id'),
    removeModel: vi.fn(),
    getModel: vi.fn(() => ({ id: 'mock-id', name: 'test' })),
    setLayerImage: vi.fn(),
    setPrinter: vi.fn(),
    render: vi.fn(),
    canvas: document.createElement('canvas'),
    legacy: null,
    addCutterPreview: vi.fn(() => 'cutter-1'),
    updateCutterPreview: vi.fn(),
    removeCutterPreview: vi.fn(),
    setCutterGizmo: vi.fn(),
    clearCutterGizmo: vi.fn(),
    onCutterGizmoChange: vi.fn(() => () => {}),
    getModelPositions: vi.fn(() => null),
  };
}

const testPrinter: PrinterSpec = {
  name: 'Test',
  resolutionX: 2560,
  resolutionY: 1620,
  buildWidthMM: 130,
  buildDepthMM: 80,
  buildHeightMM: 165,
};

beforeEach(() => {
  selectedModelIds.value = [];
  selectedPrinterKey.value = 'test-printer';
  currentCameraView.value = 'perspective';
});

describe('scene-viewer ops', () => {
  it('selectModel sets single selection', () => {
    selectModel('m1', false);
    expect(selectedModelIds.value).toEqual(['m1']);
  });

  it('selectModel additive adds to selection', () => {
    selectModel('m1', false);
    selectModel('m2', true);
    expect(selectedModelIds.value).toEqual(['m1', 'm2']);
  });

  it('selectModel additive toggles off existing', () => {
    selectedModelIds.value = ['m1', 'm2'];
    selectModel('m1', true);
    expect(selectedModelIds.value).toEqual(['m2']);
  });

  it('clearSelection empties selection', () => {
    selectedModelIds.value = ['m1'];
    clearSelection();
    expect(selectedModelIds.value).toEqual([]);
  });

  it('hasSelection computed tracks state', () => {
    expect(hasSelection.value).toBe(false);
    selectedModelIds.value = ['m1'];
    expect(hasSelection.value).toBe(true);
  });

  it('syncBuildVolume calls viewer.setPrinter', () => {
    const viewer = mockViewer();
    syncBuildVolume(viewer, testPrinter);
    expect(viewer.setPrinter).toHaveBeenCalledWith(testPrinter);
  });

  it('mountSceneViewer syncs printer on signal change', () => {
    const viewer = mockViewer();
    const getPrinter = vi.fn((key: string) => {
      void key;
      return testPrinter;
    });

    const { dispose } = mountSceneViewer(viewer, getPrinter);
    expect(viewer.setPrinter).toHaveBeenCalledWith(testPrinter);

    // Change printer key → should call again
    selectedPrinterKey.value = 'other';
    expect(getPrinter).toHaveBeenCalledWith('other');

    dispose();
  });
});
