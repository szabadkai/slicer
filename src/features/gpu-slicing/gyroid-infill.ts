/**
 * Gyroid infill — procedural 3D lattice structure for hollow interiors.
 *
 * The gyroid is a triply periodic minimal surface defined by:
 *   sin(x)·cos(y) + sin(y)·cos(z) + sin(z)·cos(x) = 0
 *
 * For slice compositing: at each pixel in a hollow region, evaluate the
 * gyroid SDF at the (x, y, z) coordinate. If the SDF is within a
 * threshold band, the pixel is filled (white); otherwise it stays empty.
 *
 * This produces a self-supporting lattice that strengthens hollow prints
 * while using minimal resin.
 */

export interface GyroidParams {
  /** Cell size in mm — distance between repeating units */
  cellSizeMM: number;
  /** Wall thickness of the gyroid lattice in mm */
  wallThicknessMM: number;
  /** Whether gyroid infill is enabled */
  enabled: boolean;
}

export const DEFAULT_GYROID_PARAMS: GyroidParams = {
  cellSizeMM: 4.0,
  wallThicknessMM: 0.6,
  enabled: false,
};

/**
 * Evaluate the gyroid signed distance field at a point.
 * Returns ~0 at the surface, negative inside, positive outside.
 */
export function gyroidSDF(x: number, y: number, z: number, cellSize: number): number {
  const scale = (2 * Math.PI) / cellSize;
  const sx = x * scale;
  const sy = y * scale;
  const sz = z * scale;
  return Math.sin(sx) * Math.cos(sy) + Math.sin(sy) * Math.cos(sz) + Math.sin(sz) * Math.cos(sx);
}

/**
 * Check if a point should be filled by the gyroid infill.
 * Returns true if the point is within `wallThickness/2` of the gyroid surface.
 */
export function isGyroidFilled(x: number, y: number, z: number, params: GyroidParams): boolean {
  if (!params.enabled) return false;
  const sdf = gyroidSDF(x, y, z, params.cellSizeMM);
  // The SDF range is approximately [-1.5, 1.5] for the standard gyroid.
  // Normalize to physical thickness: threshold = wallThickness / cellSize * π
  const threshold = (params.wallThicknessMM / params.cellSizeMM) * Math.PI;
  return Math.abs(sdf) < threshold;
}

/**
 * Apply gyroid infill to a slice image layer.
 *
 * For each pixel in the image that is currently empty (black) but falls
 * within the model's hollow interior (determined by the `interiorMask`),
 * evaluate the gyroid and fill if on the lattice surface.
 *
 * @param imageData - RGBA pixel data for the layer (modified in place)
 * @param interiorMask - binary mask: 1 = hollow interior, 0 = outside/wall
 * @param layerZ - Z height of this layer in mm
 * @param resX - image width in pixels
 * @param resY - image height in pixels
 * @param pixelSizeMM - size of one pixel in mm (buildWidth / resolutionX)
 * @param params - gyroid parameters
 */
export function applyGyroidToLayer(
  imageData: Uint8Array,
  interiorMask: Uint8Array | null,
  layerZ: number,
  resX: number,
  resY: number,
  pixelSizeMM: number,
  params: GyroidParams,
): void {
  if (!params.enabled || !interiorMask) return;

  for (let y = 0; y < resY; y++) {
    for (let x = 0; x < resX; x++) {
      const pixelIdx = (y * resX + x) * 4;

      // Only fill interior pixels that are currently empty
      if (imageData[pixelIdx] > 0) continue; // Already filled (model wall)
      if (interiorMask[y * resX + x] === 0) continue; // Not in hollow interior

      const worldX = x * pixelSizeMM;
      const worldY = y * pixelSizeMM;

      if (isGyroidFilled(worldX, worldY, layerZ, params)) {
        // Fill with white
        imageData[pixelIdx] = 255;
        imageData[pixelIdx + 1] = 255;
        imageData[pixelIdx + 2] = 255;
        imageData[pixelIdx + 3] = 255;
      }
    }
  }
}

/**
 * Generate a simple interior mask from a slice image.
 *
 * Uses a flood-fill from the image edges to find exterior regions.
 * Everything not exterior and not already filled is interior (hollow).
 *
 * This is an approximation — for a proper mask, the slicer would need
 * to output separate outer/inner shell layers.
 */
export function generateInteriorMask(
  imageData: Uint8Array,
  resX: number,
  resY: number,
): Uint8Array {
  const mask = new Uint8Array(resX * resY);
  const visited = new Uint8Array(resX * resY);

  // Flood fill from edges to mark exterior
  const queue: number[] = [];

  // Seed from all edge pixels that are empty
  for (let x = 0; x < resX; x++) {
    if (imageData[x * 4] === 0) queue.push(x);
    const bottomIdx = (resY - 1) * resX + x;
    if (imageData[bottomIdx * 4] === 0) queue.push(bottomIdx);
  }
  for (let y = 1; y < resY - 1; y++) {
    if (imageData[y * resX * 4] === 0) queue.push(y * resX);
    const rightIdx = y * resX + resX - 1;
    if (imageData[rightIdx * 4] === 0) queue.push(rightIdx);
  }

  // Mark seeded pixels as visited (exterior)
  for (const idx of queue) visited[idx] = 1;

  // BFS flood fill
  while (queue.length > 0) {
    const idx = queue.pop() as number;
    const x = idx % resX;
    const y = Math.floor(idx / resX);

    const neighbors = [
      y > 0 ? idx - resX : -1,
      y < resY - 1 ? idx + resX : -1,
      x > 0 ? idx - 1 : -1,
      x < resX - 1 ? idx + 1 : -1,
    ];

    for (const n of neighbors) {
      if (n < 0 || visited[n]) continue;
      if (imageData[n * 4] > 0) continue; // Filled pixel = wall, don't cross
      visited[n] = 1;
      queue.push(n);
    }
  }

  // Interior = empty pixels that were NOT reached by exterior flood fill
  for (let i = 0; i < resX * resY; i++) {
    if (imageData[i * 4] === 0 && !visited[i]) {
      mask[i] = 1;
    }
  }

  return mask;
}
