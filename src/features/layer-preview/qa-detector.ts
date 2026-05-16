import type { IslandResult } from './island-detector';
import type { PeelForceProfile } from './peel-force';

export type SliceQaIssueType = 'island' | 'empty-layer' | 'touching-bounds' | 'peel-spike';
export type SliceQaSeverity = 'info' | 'warning' | 'error';

export interface SliceQaIssue {
  id: string;
  type: SliceQaIssueType;
  severity: SliceQaSeverity;
  layerIndex: number;
  title: string;
  detail: string;
}

export interface SliceQaOptions {
  boundsMarginPx?: number;
  peelSpikeRatio?: number;
}

export function buildSliceQaIssues(
  layers: Uint8Array[],
  width: number,
  islands: IslandResult[],
  peelProfile?: PeelForceProfile | null,
  options: SliceQaOptions = {},
): SliceQaIssue[] {
  const issues: SliceQaIssue[] = [
    ...islands.map(islandToIssue),
    ...detectEmptyLayers(layers),
    ...detectTouchingBounds(layers, width, options.boundsMarginPx ?? 2),
    ...detectPeelSpikes(peelProfile, options.peelSpikeRatio ?? 0.85),
  ];

  return issues.sort((a, b) => a.layerIndex - b.layerIndex || severityRank(b) - severityRank(a));
}

export function summarizeQaIssues(issues: SliceQaIssue[]): string {
  if (issues.length === 0) return 'No slice issues detected.';
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  if (errors > 0)
    return `${errors} error${errors === 1 ? '' : 's'} and ${warnings} warning${warnings === 1 ? '' : 's'} found.`;
  return `${warnings} warning${warnings === 1 ? '' : 's'} found.`;
}

function islandToIssue(result: IslandResult): SliceQaIssue {
  return {
    id: `island:${result.layerIndex}`,
    type: 'island',
    severity: 'error',
    layerIndex: result.layerIndex,
    title: `${result.islandCount} floating island${result.islandCount === 1 ? '' : 's'}`,
    detail: `${result.floatingPixels} unsupported pixel${result.floatingPixels === 1 ? '' : 's'} on layer ${result.layerIndex + 1}.`,
  };
}

function detectEmptyLayers(layers: Uint8Array[]): SliceQaIssue[] {
  const filled = layers.map((layer) => countFilledPixels(layer));
  const issues: SliceQaIssue[] = [];

  for (let i = 1; i < layers.length - 1; i++) {
    if (filled[i] !== 0) continue;
    if (filled[i - 1] === 0 || filled[i + 1] === 0) continue;
    issues.push({
      id: `empty-layer:${i}`,
      type: 'empty-layer',
      severity: 'error',
      layerIndex: i,
      title: 'Empty layer in print body',
      detail: `Layer ${i + 1} is empty between printable layers.`,
    });
  }
  return issues;
}

function detectTouchingBounds(layers: Uint8Array[], width: number, margin: number): SliceQaIssue[] {
  const issues: SliceQaIssue[] = [];

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layer = layers[layerIndex];
    const height = layer.length / 4 / width;
    let count = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x >= margin && x < width - margin && y >= margin && y < height - margin) continue;
        if (layer[(y * width + x) * 4] > 128) count++;
      }
    }

    if (count > 0) {
      issues.push({
        id: `touching-bounds:${layerIndex}`,
        type: 'touching-bounds',
        severity: 'warning',
        layerIndex,
        title: 'Pixels near print bounds',
        detail: `${count} printable pixel${count === 1 ? '' : 's'} within ${margin}px of the boundary.`,
      });
    }
  }

  return issues;
}

function detectPeelSpikes(
  profile: PeelForceProfile | null | undefined,
  ratio: number,
): SliceQaIssue[] {
  if (!profile || profile.maxAreaMM2 <= 0) return [];
  const threshold = profile.maxAreaMM2 * ratio;
  const issues: SliceQaIssue[] = [];

  for (let i = 0; i < profile.areaPerLayer.length; i++) {
    const area = profile.areaPerLayer[i];
    if (area < threshold || i === profile.peakLayerIndex) continue;
    issues.push({
      id: `peel-spike:${i}`,
      type: 'peel-spike',
      severity: 'warning',
      layerIndex: i,
      title: 'High peel-force layer',
      detail: `${area.toFixed(1)} mm² cross-section is close to the print peak.`,
    });
  }

  if (profile.peakLayerIndex >= 0) {
    issues.push({
      id: `peel-spike:${profile.peakLayerIndex}:peak`,
      type: 'peel-spike',
      severity: 'info',
      layerIndex: profile.peakLayerIndex,
      title: 'Peak peel-force layer',
      detail: `${profile.maxAreaMM2.toFixed(1)} mm² maximum cross-section.`,
    });
  }

  return issues;
}

function countFilledPixels(layer: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < layer.length; i += 4) {
    if (layer[i] > 128) count++;
  }
  return count;
}

function severityRank(issue: SliceQaIssue): number {
  if (issue.severity === 'error') return 3;
  if (issue.severity === 'warning') return 2;
  return 1;
}
