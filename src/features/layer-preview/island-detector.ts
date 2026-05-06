/**
 * Island detection — find disconnected pixel regions per slice layer.
 *
 * A "floating island" is a connected component in a layer that has NO
 * pixels overlapping with any filled pixel in the layer below. These regions
 * will print unsupported and likely fail.
 */

export interface IslandResult {
  /** Layer index with islands */
  layerIndex: number;
  /** Number of floating islands */
  islandCount: number;
  /** Total pixel count of all floating islands */
  floatingPixels: number;
}

/**
 * Detect floating islands across all layers.
 *
 * Algorithm per layer:
 * 1. Find filled pixels that have NO filled pixel directly below (in prev layer)
 * 2. Run connected-component labeling (flood fill) on those unsupported pixels
 * 3. Each component is a floating island
 *
 * Skips layer 0 (build plate is the support).
 */
export function detectIslands(
  layers: Uint8Array[],
  width: number,
  onProgress?: (f: number) => void,
): IslandResult[] {
  const results: IslandResult[] = [];
  if (layers.length < 2) return results;

  for (let li = 1; li < layers.length; li++) {
    const current = layers[li];
    const below = layers[li - 1];

    // Find unsupported filled pixels (filled in current, empty in below)
    const unsupported = new Uint8Array(width * (current.length / 4 / width));
    const height = current.length / 4 / width;
    let unsupportedCount = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const filled = current[idx] > 128;
        const belowFilled = below[idx] > 128;
        if (filled && !belowFilled) {
          unsupported[y * width + x] = 1;
          unsupportedCount++;
        }
      }
    }

    if (unsupportedCount === 0) continue;

    // Connected-component labeling on unsupported pixels
    const visited = new Uint8Array(width * height);
    let islandCount = 0;
    let floatingPixels = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pi = y * width + x;
        if (!unsupported[pi] || visited[pi]) continue;

        // BFS flood fill
        islandCount++;
        const queue = [pi];
        visited[pi] = 1;
        let componentSize = 0;

        while (queue.length > 0) {
          const cur = queue.pop() as number;
          componentSize++;
          const cx = cur % width;
          const cy = (cur - cx) / width;

          // 4-connected neighbors
          const neighbors = [
            cy > 0 ? cur - width : -1,
            cy < height - 1 ? cur + width : -1,
            cx > 0 ? cur - 1 : -1,
            cx < width - 1 ? cur + 1 : -1,
          ];

          for (const ni of neighbors) {
            if (ni >= 0 && unsupported[ni] && !visited[ni]) {
              visited[ni] = 1;
              queue.push(ni);
            }
          }
        }

        floatingPixels += componentSize;
      }
    }

    if (islandCount > 0) {
      results.push({ layerIndex: li, islandCount, floatingPixels });
    }

    if (onProgress && li % 10 === 0) {
      onProgress(li / layers.length);
    }
  }

  onProgress?.(1);
  return results;
}

/**
 * Summarize island detection results.
 */
export function summarizeIslands(results: IslandResult[]): string {
  if (results.length === 0) return 'No floating islands detected.';
  const totalIslands = results.reduce((s, r) => s + r.islandCount, 0);
  return `${totalIslands} floating island${totalIslands > 1 ? 's' : ''} across ${results.length} layer${results.length > 1 ? 's' : ''}.`;
}
