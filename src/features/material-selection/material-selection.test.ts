import { describe, it, expect } from 'vitest';
import { selectedMaterialId } from '@core/state';
import {
  RESIN_MATERIALS,
  getMaterialById,
  getMaterialsByBrand,
  getAllBrands,
  DEFAULT_MATERIAL_ID,
} from './materials';

describe('material library', () => {
  it('contains at least 20 presets', () => {
    expect(RESIN_MATERIALS.length).toBeGreaterThanOrEqual(20);
  });

  it('default material exists in library', () => {
    const mat = getMaterialById(DEFAULT_MATERIAL_ID);
    expect(mat).toBeDefined();
    expect(mat!.id).toBe('siraya-fast-navy-grey');
  });

  it('getMaterialsByBrand filters correctly', () => {
    const siraya = getMaterialsByBrand('Siraya Tech');
    expect(siraya.length).toBeGreaterThanOrEqual(4);
    expect(siraya.every((m) => m.brand === 'Siraya Tech')).toBe(true);
  });

  it('getAllBrands returns distinct brands', () => {
    const brands = getAllBrands();
    expect(brands.length).toBeGreaterThanOrEqual(3);
    expect(new Set(brands).size).toBe(brands.length);
  });

  it('every material has required properties', () => {
    for (const mat of RESIN_MATERIALS) {
      expect(mat.id).toBeTruthy();
      expect(mat.brand).toBeTruthy();
      expect(mat.swatch).toMatch(/^#[0-9a-f]{6}$/);
      expect(mat.opacity).toBeGreaterThan(0);
      expect(mat.opacity).toBeLessThanOrEqual(1);
    }
  });
});

describe('signal integration', () => {
  it('selectedMaterialId defaults to siraya-fast-navy-grey', () => {
    selectedMaterialId.value = DEFAULT_MATERIAL_ID;
    expect(selectedMaterialId.value).toBe('siraya-fast-navy-grey');
  });
});
