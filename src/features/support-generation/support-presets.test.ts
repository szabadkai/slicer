import { describe, expect, it } from 'vitest';
import { getSupportPreset, SUPPORT_PRESETS } from './support-presets';

describe('support presets', () => {
  it('defines presets from smallest to largest', () => {
    expect(SUPPORT_PRESETS.map((preset) => preset.id)).toEqual([
      'nano',
      'micro',
      'light',
      'medium',
      'heavy',
    ]);
    for (let i = 1; i < SUPPORT_PRESETS.length; i++) {
      expect(SUPPORT_PRESETS[i].tipDiameter).toBeGreaterThan(SUPPORT_PRESETS[i - 1].tipDiameter);
      expect(SUPPORT_PRESETS[i].shaftDiameter).toBeGreaterThan(
        SUPPORT_PRESETS[i - 1].shaftDiameter,
      );
    }
  });

  it('returns null for unknown preset ids', () => {
    expect(getSupportPreset('light')?.label).toBe('Light');
    expect(getSupportPreset('unknown')).toBeNull();
  });
});
