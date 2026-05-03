import { signal } from '@preact/signals-core';
import type { GenerateResult } from './build';

// ─── Per-model support storage ─────────────────────────────

export interface ModelSupports {
  result: GenerateResult;
  visible: boolean;
}

export const supportsByModel = signal<Map<string, ModelSupports>>(new Map());

export function setSupports(modelId: string, result: GenerateResult): void {
  const next = new Map(supportsByModel.value);
  next.set(modelId, { result, visible: true });
  supportsByModel.value = next;
}

export function clearSupports(modelId: string): void {
  const next = new Map(supportsByModel.value);
  next.delete(modelId);
  supportsByModel.value = next;
}

export function toggleSupportVisibility(modelId: string): void {
  const current = supportsByModel.value.get(modelId);
  if (!current) return;
  const next = new Map(supportsByModel.value);
  next.set(modelId, { ...current, visible: !current.visible });
  supportsByModel.value = next;
}

export function getSupports(modelId: string): ModelSupports | undefined {
  return supportsByModel.value.get(modelId);
}
