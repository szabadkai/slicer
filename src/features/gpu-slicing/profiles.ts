/**
 * Custom slice profiles — save, load, and manage named parameter sets.
 *
 * Profiles are persisted to localStorage and can be selected from
 * a dropdown in the slice panel. Includes a set of factory presets.
 */
import { signal, computed } from '@preact/signals-core';

export interface SliceProfile {
  id: string;
  name: string;
  layerHeightMM: number;
  normalExposureS: number;
  bottomLayers: number;
  bottomExposureS: number;
  liftHeightMM: number;
  liftSpeedMMs: number;
  isBuiltIn: boolean;
}

const STORAGE_KEY = 'slicelab-custom-profiles';

const BUILT_IN_PROFILES: SliceProfile[] = [
  {
    id: 'fast',
    name: 'Fast',
    layerHeightMM: 0.1,
    normalExposureS: 2,
    bottomLayers: 4,
    bottomExposureS: 30,
    liftHeightMM: 5,
    liftSpeedMMs: 2,
    isBuiltIn: true,
  },
  {
    id: 'standard',
    name: 'Standard',
    layerHeightMM: 0.05,
    normalExposureS: 2,
    bottomLayers: 6,
    bottomExposureS: 60,
    liftHeightMM: 5,
    liftSpeedMMs: 1,
    isBuiltIn: true,
  },
  {
    id: 'high-detail',
    name: 'High Detail',
    layerHeightMM: 0.025,
    normalExposureS: 1.5,
    bottomLayers: 8,
    bottomExposureS: 60,
    liftHeightMM: 6,
    liftSpeedMMs: 0.8,
    isBuiltIn: true,
  },
];

function loadUserProfiles(): SliceProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p: unknown): p is SliceProfile =>
        typeof p === 'object' &&
        p !== null &&
        'id' in p &&
        'name' in p &&
        typeof (p as SliceProfile).id === 'string',
    );
  } catch {
    return [];
  }
}

function persistUserProfiles(profiles: SliceProfile[]): void {
  const userOnly = profiles.filter((p) => !p.isBuiltIn);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(userOnly));
}

/** All available profiles (built-in + user) */
export const allProfiles = signal<SliceProfile[]>([...BUILT_IN_PROFILES, ...loadUserProfiles()]);

/** Currently selected profile ID */
export const activeProfileId = signal<string>('standard');

/** The active profile object */
export const activeProfile = computed(() => {
  return allProfiles.value.find((p) => p.id === activeProfileId.value) ?? BUILT_IN_PROFILES[1];
});

/**
 * Save a new custom profile from current settings.
 */
export function saveProfile(
  name: string,
  params: Omit<SliceProfile, 'id' | 'name' | 'isBuiltIn'>,
): SliceProfile {
  const id = `custom-${Date.now()}`;
  const profile: SliceProfile = { id, name, ...params, isBuiltIn: false };
  allProfiles.value = [...allProfiles.value, profile];
  persistUserProfiles(allProfiles.value);
  activeProfileId.value = id;
  return profile;
}

/**
 * Delete a custom profile.
 */
export function deleteProfile(id: string): boolean {
  const profile = allProfiles.value.find((p) => p.id === id);
  if (!profile || profile.isBuiltIn) return false;

  allProfiles.value = allProfiles.value.filter((p) => p.id !== id);
  persistUserProfiles(allProfiles.value);

  if (activeProfileId.value === id) {
    activeProfileId.value = 'standard';
  }
  return true;
}

/**
 * Apply a profile's settings to the slice panel input fields.
 */
export function applyProfileToInputs(profile: SliceProfile): void {
  const setVal = (id: string, val: number): void => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) {
      el.value = String(val);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  setVal('layer-height', profile.layerHeightMM);
  setVal('normal-exposure', profile.normalExposureS);
  setVal('bottom-layers', profile.bottomLayers);
  setVal('bottom-exposure', profile.bottomExposureS);
  setVal('lift-height', profile.liftHeightMM);
  setVal('lift-speed', profile.liftSpeedMMs);
}

/**
 * Read current settings from the slice panel input fields.
 */
export function readInputsAsParams(): Omit<SliceProfile, 'id' | 'name' | 'isBuiltIn'> {
  const getVal = (id: string, fallback: number): number => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    return el ? parseFloat(el.value) : fallback;
  };

  return {
    layerHeightMM: getVal('layer-height', 0.05),
    normalExposureS: getVal('normal-exposure', 2),
    bottomLayers: getVal('bottom-layers', 6),
    bottomExposureS: getVal('bottom-exposure', 60),
    liftHeightMM: getVal('lift-height', 5),
    liftSpeedMMs: getVal('lift-speed', 1),
  };
}
