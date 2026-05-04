import { describe, it, expect } from 'vitest';
import { effect, batch } from '@preact/signals-core';
import {
  activeStage,
  plates,
  activePlateId,
  activePlate,
  selectedModelIds,
  selectedMaterialId,
  selectedPrinterKey,
  sliceParams,
} from './state';
import type { Plate } from './types';

function makePlate(id: string, name: string): Plate {
  return {
    id,
    name,
    models: [],
    selectedIds: [],
    originX: 0,
    originZ: 0,
    dirty: true,
  };
}

describe('state signals', () => {
  it('activeStage defaults to prepare', () => {
    expect(activeStage.value).toBe('prepare');
  });

  it('activePlate is computed from plates + activePlateId', () => {
    plates.value = [makePlate('p1', 'Plate 1'), makePlate('p2', 'Plate 2')];
    activePlateId.value = 'p2';

    expect(activePlate.value?.id).toBe('p2');
    expect(activePlate.value?.name).toBe('Plate 2');
  });

  it('activePlate returns undefined when id does not match', () => {
    plates.value = [makePlate('p1', 'Plate 1')];
    activePlateId.value = 'nonexistent';

    expect(activePlate.value).toBeUndefined();
  });

  it('effects react to signal changes', () => {
    const log: string[] = [];
    selectedMaterialId.value = 'siraya-fast-navy-grey';
    const dispose = effect(() => {
      log.push(selectedMaterialId.value);
    });

    selectedMaterialId.value = 'siraya-fast-white';
    selectedMaterialId.value = 'siraya-fast-smoky-black';

    expect(log).toEqual(['siraya-fast-navy-grey', 'siraya-fast-white', 'siraya-fast-smoky-black']);

    dispose();
    selectedMaterialId.value = 'another';
    expect(log.length).toBe(3);
  });

  it('batch combines multiple updates into one effect run', () => {
    let runCount = 0;
    const dispose = effect(() => {
      void selectedPrinterKey.value;
      void sliceParams.value;
      runCount++;
    });

    const before = runCount;
    batch(() => {
      selectedPrinterKey.value = 'mars-3';
      sliceParams.value = { ...sliceParams.value, layerHeightMM: 0.03 };
    });

    expect(runCount).toBe(before + 1);
    dispose();
  });

  it('selectedModelIds holds array of model IDs', () => {
    selectedModelIds.value = ['m1', 'm2'];
    expect(selectedModelIds.value).toEqual(['m1', 'm2']);
  });
});
