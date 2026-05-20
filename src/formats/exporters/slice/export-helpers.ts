import type { LayerSource, ProgressCallback } from '@core/format-registry';
import { cloneCompactGrayLayer, getSharedPngEncodePool } from '../../../png-encode-pool';
import type { CompactGrayLayer } from '../../../png-encode-pool';

const MAX_EXPORT_IN_FLIGHT_BYTES = 384 * 1024 * 1024;

export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function encodePixelLayersToPngs(
  source: Extract<LayerSource, { kind: 'pixels' }>,
  width: number,
  height: number,
  onProgress?: ProgressCallback,
): Promise<Uint8Array[]> {
  const pool = getSharedPngEncodePool();
  const layerCount = source.layers.length;
  const pngs: Uint8Array[] = new Array(layerCount);
  const inFlight = new Set<Promise<void>>();
  const maxEncodeJobs = pool.size;
  const pixelByteCount = width * height * 4;
  let bytesInFlight = 0;
  let dispatched = 0;
  let completed = 0;

  const canDispatch = (): boolean => {
    if (dispatched >= layerCount || inFlight.size >= maxEncodeJobs) return false;
    return bytesInFlight === 0 || bytesInFlight + pixelByteCount <= MAX_EXPORT_IN_FLIGHT_BYTES;
  };

  while (completed < layerCount) {
    while (canDispatch()) {
      const i = dispatched++;
      onProgress?.(completed + 1, layerCount, `Rendering layer ${i + 1} / ${layerCount}`);
      await yieldToBrowser();

      const rgba = source.layers[i];
      bytesInFlight += rgba.byteLength;
      onProgress?.(completed + 1, layerCount, `Encoding layer ${i + 1} / ${layerCount}`);

      const task = pool
        .encode(rgba, width, height)
        .then((png) => {
          pngs[i] = png;
          completed++;
          onProgress?.(completed, layerCount, `Encoded layer ${completed} / ${layerCount}`);
        })
        .finally(() => {
          bytesInFlight -= rgba.byteLength;
          inFlight.delete(task);
        });
      inFlight.add(task);
    }

    if (inFlight.size === 0) break;
    await Promise.race(inFlight);
    await yieldToBrowser();
  }

  await Promise.all(inFlight);
  return pngs;
}

export async function encodeCompactLayersToPngs(
  source: Extract<LayerSource, { kind: 'compact' }>,
  width: number,
  height: number,
  onProgress?: ProgressCallback,
): Promise<Uint8Array[]> {
  const pool = getSharedPngEncodePool();
  const layerCount = source.layers.length;
  const pngs: Uint8Array[] = new Array(layerCount);
  const inFlight = new Set<Promise<void>>();
  const maxEncodeJobs = pool.size;
  let dispatched = 0;
  let completed = 0;

  while (completed < layerCount) {
    while (dispatched < layerCount && inFlight.size < maxEncodeJobs) {
      const i = dispatched++;
      onProgress?.(completed + 1, layerCount, `Encoding layer ${i + 1} / ${layerCount}`);
      await yieldToBrowser();

      const compact = cloneCompactGrayLayer(source.layers[i]);
      const task = pool
        .encode(compact, width, height)
        .then((png) => {
          pngs[i] = png;
          completed++;
          onProgress?.(completed, layerCount, `Encoded layer ${completed} / ${layerCount}`);
        })
        .finally(() => {
          inFlight.delete(task);
        });
      inFlight.add(task);
    }

    if (inFlight.size === 0) break;
    await Promise.race(inFlight);
    await yieldToBrowser();
  }

  await Promise.all(inFlight);
  return pngs;
}

export function getLayerSourceCount(source: LayerSource): number {
  if (source.kind === 'pixels') return source.layers.length;
  if (source.kind === 'compact') return source.layers.length;
  if (source.kind === 'png') return source.pngs.length;
  return source.layerCount;
}

export async function resolveLayerSourcePngs(
  source: LayerSource,
  width: number,
  height: number,
  onProgress?: ProgressCallback,
): Promise<Uint8Array[]> {
  if (source.kind === 'png') return source.pngs;
  if (source.kind === 'png-renderer') return source.renderPngs(onProgress);
  if (source.kind === 'compact-renderer') {
    const compactLayers = await source.renderCompactLayers(onProgress);
    return encodeCompactLayersToPngs(
      { kind: 'compact', layers: compactLayers },
      width,
      height,
      onProgress,
    );
  }
  if (source.kind === 'compact')
    return encodeCompactLayersToPngs(source, width, height, onProgress);
  return encodePixelLayersToPngs(source, width, height, onProgress);
}

export async function resolveLayerSourceCompactLayers(
  source: LayerSource,
  onProgress?: ProgressCallback,
): Promise<CompactGrayLayer[] | null> {
  if (source.kind === 'compact') return source.layers;
  if (source.kind === 'compact-renderer') return source.renderCompactLayers(onProgress);
  return null;
}

export async function addPngFilesToZip(
  zip: { file(name: string, data: Uint8Array, options?: { compression: 'STORE' }): unknown },
  pngs: Uint8Array[],
  fileName: (index: number) => string,
  onProgress?: ProgressCallback,
): Promise<void> {
  for (let i = 0; i < pngs.length; i++) {
    onProgress?.(i + 1, pngs.length, `Packing layer ${i + 1} / ${pngs.length}`);
    zip.file(fileName(i), pngs[i], { compression: 'STORE' });
    if (i % 10 === 0) await yieldToBrowser();
  }
}
