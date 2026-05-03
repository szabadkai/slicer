import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  startAutosave,
  saveSnapshot,
  loadSnapshot,
  restoreSnapshot,
  discardSnapshot,
  hasAutosave,
  type AutosaveSnapshot,
} from './autosave';
import {
  plates,
  activePlateId,
  selectedMaterialId,
  selectedPrinterKey,
  sliceParams,
} from '@core/state';
import type { SliceParams } from '@core/types';

const defaultParams: SliceParams = {
  layerHeightMM: 0.05,
  normalExposureS: 2.5,
  bottomLayers: 6,
  bottomExposureS: 30,
  liftHeightMM: 6,
  liftSpeedMMs: 3,
};

beforeEach(() => {
  plates.value = [];
  activePlateId.value = '';
  selectedMaterialId.value = 'siraya-fast-navy-grey';
  selectedPrinterKey.value = 'photon-mono';
  sliceParams.value = defaultParams;
  localStorage.clear();
});

describe('autosave', () => {
  describe('saveSnapshot', () => {
    it('saves current state to localStorage', () => {
      plates.value = [];
      activePlateId.value = 'p1';
      selectedMaterialId.value = 'custom-material';

      saveSnapshot();

      const raw = localStorage.getItem('slicelab-autosave');
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!) as AutosaveSnapshot;
      expect(parsed.version).toBe(1);
      expect(parsed.activePlateId).toBe('p1');
      expect(parsed.materialId).toBe('custom-material');
    });

    it('includes a timestamp', () => {
      saveSnapshot();
      const parsed = JSON.parse(localStorage.getItem('slicelab-autosave')!) as AutosaveSnapshot;
      expect(parsed.timestamp).toBeGreaterThan(0);
      expect(parsed.timestamp).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('loadSnapshot', () => {
    it('returns null when no saved data', () => {
      expect(loadSnapshot()).toBeNull();
    });

    it('returns parsed snapshot', () => {
      const snapshot: AutosaveSnapshot = {
        version: 1,
        timestamp: 1000,
        plates: [],
        activePlateId: 'p1',
        materialId: 'test',
        printerKey: 'mars-3',
        sliceParams: defaultParams,
      };
      localStorage.setItem('slicelab-autosave', JSON.stringify(snapshot));

      const loaded = loadSnapshot();
      expect(loaded).not.toBeNull();
      expect(loaded!.activePlateId).toBe('p1');
      expect(loaded!.printerKey).toBe('mars-3');
    });

    it('returns null for corrupted data', () => {
      localStorage.setItem('slicelab-autosave', 'not-valid-json{{{');
      expect(loadSnapshot()).toBeNull();
    });
  });

  describe('restoreSnapshot', () => {
    it('restores all signals from snapshot', () => {
      const snapshot: AutosaveSnapshot = {
        version: 1,
        timestamp: 1000,
        plates: [],
        activePlateId: 'restored-plate',
        materialId: 'restored-material',
        printerKey: 'restored-printer',
        sliceParams: { ...defaultParams, layerHeightMM: 0.1 },
      };

      restoreSnapshot(snapshot);

      expect(activePlateId.value).toBe('restored-plate');
      expect(selectedMaterialId.value).toBe('restored-material');
      expect(selectedPrinterKey.value).toBe('restored-printer');
      expect(sliceParams.value.layerHeightMM).toBe(0.1);
    });
  });

  describe('discardSnapshot', () => {
    it('removes saved data from localStorage', () => {
      localStorage.setItem('slicelab-autosave', '{}');
      discardSnapshot();
      expect(localStorage.getItem('slicelab-autosave')).toBeNull();
    });
  });

  describe('hasAutosave', () => {
    it('returns false when empty', () => {
      expect(hasAutosave()).toBe(false);
    });

    it('returns true when data exists', () => {
      localStorage.setItem('slicelab-autosave', '{}');
      expect(hasAutosave()).toBe(true);
    });
  });

  describe('startAutosave', () => {
    it('returns a dispose function', () => {
      const dispose = startAutosave();
      expect(typeof dispose).toBe('function');
      dispose();
    });

    it('saves after signal change and debounce', async () => {
      vi.useFakeTimers();
      const dispose = startAutosave();

      activePlateId.value = 'changed';
      vi.advanceTimersByTime(1100);

      const raw = localStorage.getItem('slicelab-autosave');
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!) as AutosaveSnapshot;
      expect(parsed.activePlateId).toBe('changed');

      dispose();
      vi.useRealTimers();
    });

    it('debounces rapid changes', () => {
      vi.useFakeTimers();
      const dispose = startAutosave();

      activePlateId.value = 'first';
      vi.advanceTimersByTime(500);
      activePlateId.value = 'second';
      vi.advanceTimersByTime(500);
      activePlateId.value = 'third';
      vi.advanceTimersByTime(1100);

      const parsed = JSON.parse(localStorage.getItem('slicelab-autosave')!) as AutosaveSnapshot;
      expect(parsed.activePlateId).toBe('third');

      dispose();
      vi.useRealTimers();
    });
  });
});
