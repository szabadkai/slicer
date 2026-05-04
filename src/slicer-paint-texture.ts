// ─── Paint texture helpers for slicer ───────────────────────
// Pure math functions for procedural paint patterns (mirroring GLSL logic)
// and pixel-level mask operations used during slice compositing.

export function slHash(x: number, y: number): number {
  let px = fract(x * 0.1031);
  let py = fract(y * 0.1031);
  const pz = fract(x * 0.1031);
  const d = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
  px += d;
  py += d;
  return fract((px + py) * (pz + d));
}

export function slNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = slHash(ix, iy);
  const b = slHash(ix + 1, iy);
  const c = slHash(ix, iy + 1);
  const d = slHash(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function slFbm(x: number, y: number): number {
  let v = 0.5 * slNoise(x, y);
  v += 0.25 * slNoise(x * 2 + 17, y * 2 + 31);
  v += 0.125 * slNoise(x * 4 + 53, y * 4 + 97);
  return v / 0.875;
}

export function fract(value: number): number {
  return value - Math.floor(value);
}

export function paintPatternHeightAt(
  x: number,
  z: number,
  pattern: number,
  scaleMM: number,
): number {
  if (pattern <= 0) return 1;
  const scale = Math.max(scaleMM, 0.001);
  const u = x / scale;
  const v = z / scale;
  if (pattern === 1) {
    const weaveA = Math.floor((u + v) * 0.5) & 1;
    const weaveB = Math.floor((u - v) * 0.5) & 1;
    return ((Math.floor(v * 0.25) & 1) === 0 ? weaveA : weaveB) ? 1 : -1;
  }
  if (pattern === 2) {
    const diagA = Math.abs(fract(u + v) - 0.5);
    const diagB = Math.abs(fract(u - v) - 0.5);
    return diagA < 0.16 || diagB < 0.16 ? 1 : -1;
  }
  if (pattern === 3) {
    return Math.abs(fract(u) - 0.5) < 0.22 ? 1 : -1;
  }
  if (pattern === 4) {
    return slFbm(u * 3, v * 3) > 0.5 ? 1 : -1;
  }
  if (pattern === 5) {
    const fx = fract(u) - 0.5;
    const fz = fract(v) - 0.5;
    return Math.sqrt(fx * fx + fz * fz) < 0.35 ? 1 : -1;
  }
  return 1;
}

export function isFilledMask(mask: Uint8Array, w: number, x: number, y: number): boolean {
  return mask[y * w + x] > 128;
}

export function hasFilledWithin(
  mask: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  radiusPx: number,
): boolean {
  const radiusSq = radiusPx * radiusPx;
  const minX = Math.max(0, Math.floor(x - radiusPx));
  const maxX = Math.min(w - 1, Math.ceil(x + radiusPx));
  const minY = Math.max(0, Math.floor(y - radiusPx));
  const maxY = Math.min(h - 1, Math.ceil(y + radiusPx));
  for (let yy = minY; yy <= maxY; yy++) {
    const dy = yy - y;
    for (let xx = minX; xx <= maxX; xx++) {
      const dx = xx - x;
      if (dx * dx + dy * dy <= radiusSq && isFilledMask(mask, w, xx, yy)) return true;
    }
  }
  return false;
}

// ─── Column-major 4×4 matrix helpers (no THREE.js) ─────────

export function mat4Multiply(a: Float32Array, b: Float32Array, out: Float32Array): Float32Array {
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}
