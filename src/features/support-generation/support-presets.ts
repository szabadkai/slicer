export type SupportPresetId = 'nano' | 'micro' | 'light' | 'medium' | 'heavy';

export interface SupportPreset {
  id: SupportPresetId;
  label: string;
  tipDiameter: number;
  shaftDiameter: number;
  sphereDiameter: number;
  density: number;
}

export const SUPPORT_PRESETS: SupportPreset[] = [
  {
    id: 'nano',
    label: 'Nano',
    tipDiameter: 0.2,
    shaftDiameter: 0.45,
    sphereDiameter: 0.2,
    density: 4,
  },
  {
    id: 'micro',
    label: 'Micro',
    tipDiameter: 0.3,
    shaftDiameter: 0.6,
    sphereDiameter: 0.25,
    density: 5,
  },
  {
    id: 'light',
    label: 'Light',
    tipDiameter: 0.4,
    shaftDiameter: 0.8,
    sphereDiameter: 0.3,
    density: 5,
  },
  {
    id: 'medium',
    label: 'Medium',
    tipDiameter: 0.55,
    shaftDiameter: 1.1,
    sphereDiameter: 0.4,
    density: 6,
  },
  {
    id: 'heavy',
    label: 'Heavy',
    tipDiameter: 0.75,
    shaftDiameter: 1.5,
    sphereDiameter: 0.55,
    density: 7,
  },
];

export function getSupportPreset(id: string | null | undefined): SupportPreset | null {
  return SUPPORT_PRESETS.find((preset) => preset.id === id) ?? null;
}
