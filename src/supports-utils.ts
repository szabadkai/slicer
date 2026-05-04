// ─── Pure utility helpers extracted from supports.ts ─────────
// These have no THREE.js dependency (except deduplicatePoints uses ContactPoint type).

import type { ContactPoint } from './supports-geometry';

export const ROUTE_DIRECTIONS = 16;

export function halton(index: number, base: number): number {
  let result = 0,
    fraction = 1 / base,
    value = index;
  while (value > 0) {
    result += fraction * (value % base);
    value = Math.floor(value / base);
    fraction /= base;
  }
  return result;
}

export function deduplicatePoints(points: ContactPoint[], minDist: number): ContactPoint[] {
  if (points.length === 0) return points;
  const cellSize = minDist;
  const grid = new Map<string, boolean>();
  const result: ContactPoint[] = [];
  for (const p of points) {
    const k = `${Math.floor(p.position.x / cellSize)},${Math.floor(p.position.y / cellSize)},${Math.floor(p.position.z / cellSize)}`;
    if (!grid.has(k)) {
      grid.set(k, true);
      result.push(p);
    }
  }
  return result;
}

export function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values.map((v) => Number(v.toFixed(3))))].sort((a, b) => a - b);
}

export function directionOffset(index: number): number {
  if (index === 0) return 0;
  const step = Math.ceil(index / 2);
  const sign = index % 2 === 0 ? 1 : -1;
  return sign * step * ((Math.PI * 2) / ROUTE_DIRECTIONS);
}

export function normalizedAngleDelta(a: number, b: number): number {
  let delta = a - b;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function yieldThread(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}
