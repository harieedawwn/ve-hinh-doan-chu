// Deterministic scanline flood fill with tolerance and halo removal.

import type { ImageDataLike } from './ctx.ts';

/** Euclidean RGB distance threshold (0..441) for "same region" pixels. Covers anti-aliased edge blends. */
export const FILL_TOLERANCE = 90;
/** Pixels next to the filled region that are at most this far from the seed colour are also painted (kills the halo). */
export const FILL_EDGE_TOLERANCE = 300;

function dist2(d: Uint8ClampedArray, i: number, r: number, g: number, b: number): number {
  const dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b;
  return dr * dr + dg * dg + db * db;
}

/** Fill the region around (x,y) with rgb colour `color`. Mutates img.data. Returns painted pixel count. */
export function floodFill(img: ImageDataLike, x: number, y: number, color: number): number {
  const { width: W, height: H, data } = img;
  if (x < 0 || y < 0 || x >= W || y >= H) return 0;
  const si = (y * W + x) * 4;
  const sr = data[si], sg = data[si + 1], sb = data[si + 2];
  const fr = (color >> 16) & 255, fg = (color >> 8) & 255, fb = color & 255;
  if (sr === fr && sg === fg && sb === fb) return 0;
  const tol2 = FILL_TOLERANCE * FILL_TOLERANCE;
  const edge2 = FILL_EDGE_TOLERANCE * FILL_EDGE_TOLERANCE;
  const mask = new Uint8Array(W * H); // 1 = in region
  const match = (px: number, py: number): boolean => dist2(data, (py * W + px) * 4, sr, sg, sb) <= tol2;

  const stack: number[] = [x, y];
  let painted = 0;
  while (stack.length) {
    const cy = stack.pop()!; const cx = stack.pop()!;
    if (mask[cy * W + cx] || !match(cx, cy)) continue;
    let l = cx, r = cx;
    while (l > 0 && !mask[cy * W + l - 1] && match(l - 1, cy)) l--;
    while (r < W - 1 && !mask[cy * W + r + 1] && match(r + 1, cy)) r++;
    for (let i = l; i <= r; i++) mask[cy * W + i] = 1;
    painted += r - l + 1;
    for (const ny of [cy - 1, cy + 1]) {
      if (ny < 0 || ny >= H) continue;
      let inRun = false;
      for (let i = l; i <= r; i++) {
        const ok = !mask[ny * W + i] && match(i, ny);
        if (ok && !inRun) { stack.push(i, ny); inRun = true; } else if (!ok) inRun = false;
      }
    }
  }
  // Halo removal: grow the region by one pixel over anti-aliased blends (never over solid strokes).
  const grow: number[] = [];
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const idx = py * W + px;
      if (mask[idx]) continue;
      const near = (px > 0 && mask[idx - 1]) || (px < W - 1 && mask[idx + 1]) || (py > 0 && mask[idx - W]) || (py < H - 1 && mask[idx + W]);
      if (near && dist2(data, idx * 4, sr, sg, sb) <= edge2) grow.push(idx);
    }
  }
  for (const idx of grow) mask[idx] = 1;
  painted += grow.length;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) { const o = i * 4; data[o] = fr; data[o + 1] = fg; data[o + 2] = fb; data[o + 3] = 255; }
  }
  return painted;
}
