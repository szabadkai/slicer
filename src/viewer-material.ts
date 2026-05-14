/**
 * Resin material factory — creates THREE.MeshPhysicalMaterial instances
 * matching resin presets (color, opacity, roughness, transmission, etc.).
 */

import * as THREE from 'three';

export const FALLBACK_PRESET: Record<string, unknown> = {
  color: 0x4f6170,
  opacity: 0.96,
  roughness: 0.52,
  metalness: 0,
  transmission: 0,
  ior: 1.5,
};

export function createResinMaterial(
  preset: Record<string, unknown> = FALLBACK_PRESET,
): THREE.MeshPhysicalMaterial {
  const o = (preset.opacity as number) ?? 1;
  const t = (preset.transmission as number) ?? 0;
  return new THREE.MeshPhysicalMaterial({
    color: (preset.color as number) ?? 0x888888,
    roughness: (preset.roughness as number) ?? 0.5,
    metalness: (preset.metalness as number) ?? 0,
    transparent: o < 1,
    opacity: o,
    depthWrite: o >= 0.55,
    transmission: t,
    thickness: t > 0 ? 0.8 : 0,
    ior: (preset.ior as number) ?? 1.5,
  });
}
