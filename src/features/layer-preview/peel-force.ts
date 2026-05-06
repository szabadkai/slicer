/**
 * Peel force estimator — computes per-layer cross-section area
 * as a proxy for peel (separation) force.
 *
 * Peel force ≈ cross-section area × suction coefficient.
 * Layers with large cross-sections require more force to separate
 * from the FEP film, risking print failures.
 */

export interface PeelForceProfile {
  /** Cross-section area per layer in mm² */
  areaPerLayer: Float64Array;
  /** Maximum cross-section area across all layers */
  maxAreaMM2: number;
  /** Layer index with the maximum area */
  peakLayerIndex: number;
  /** Pixel area in mm² (for converting pixel counts to area) */
  pixelAreaMM2: number;
}

/**
 * Build a peel force profile from per-layer white pixel counts.
 */
export function computePeelForceProfile(
  perLayerWhitePixels: Float64Array,
  pixelAreaMM2: number,
): PeelForceProfile {
  const layerCount = perLayerWhitePixels.length;
  const areaPerLayer = new Float64Array(layerCount);
  let maxAreaMM2 = 0;
  let peakLayerIndex = 0;

  for (let i = 0; i < layerCount; i++) {
    const area = perLayerWhitePixels[i] * pixelAreaMM2;
    areaPerLayer[i] = area;
    if (area > maxAreaMM2) {
      maxAreaMM2 = area;
      peakLayerIndex = i;
    }
  }

  return { areaPerLayer, maxAreaMM2, peakLayerIndex, pixelAreaMM2 };
}

/**
 * Render a peel force bar chart into a canvas element.
 * Red bars indicate layers exceeding the threshold.
 */
export function renderPeelForceChart(
  canvas: HTMLCanvasElement,
  profile: PeelForceProfile,
  highlightLayerIndex?: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { areaPerLayer, maxAreaMM2 } = profile;
  const layerCount = areaPerLayer.length;
  if (layerCount === 0 || maxAreaMM2 === 0) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const barW = Math.max(1, w / layerCount);
  const dangerThreshold = maxAreaMM2 * 0.85;

  for (let i = 0; i < layerCount; i++) {
    const area = areaPerLayer[i];
    const barH = (area / maxAreaMM2) * h;
    const x = (i / layerCount) * w;

    if (i === highlightLayerIndex) {
      ctx.fillStyle = '#ffffff';
    } else if (area >= dangerThreshold) {
      ctx.fillStyle = '#ef4444';
    } else if (area >= maxAreaMM2 * 0.6) {
      ctx.fillStyle = '#f59e0b';
    } else {
      ctx.fillStyle = '#22c55e';
    }

    ctx.fillRect(x, h - barH, Math.ceil(barW), barH);
  }

  // Draw threshold line
  const threshY = h - (dangerThreshold / maxAreaMM2) * h;
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, threshY);
  ctx.lineTo(w, threshY);
  ctx.stroke();
  ctx.setLineDash([]);
}
