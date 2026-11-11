// SoftContext: a tiny deterministic software implementation of Ctx2D (anti-aliased round strokes,
// discs, rect fill, image data). Used by tests and by tooling that has no real canvas.

import type { Ctx2D, ImageDataLike } from './ctx.ts';

type Seg = [number, number, number, number];

function parseCss(c: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) throw new Error('SoftContext supports #rrggbb only, got ' + c);
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export class SoftContext implements Ctx2D {
  fillStyle: string = '#000000';
  strokeStyle: string = '#000000';
  lineWidth = 1;
  lineCap: CanvasLineCap = 'butt';
  lineJoin: CanvasLineJoin = 'miter';
  readonly data: Uint8ClampedArray;
  private segs: Seg[] = [];
  private discs: [number, number, number][] = [];
  private cx = 0; private cy = 0;

  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width; this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  beginPath(): void { this.segs = []; this.discs = []; }
  moveTo(x: number, y: number): void { this.cx = x; this.cy = y; }
  lineTo(x: number, y: number): void { this.segs.push([this.cx, this.cy, x, y]); this.cx = x; this.cy = y; }
  arc(x: number, y: number, r: number): void { this.discs.push([x, y, r]); }

  stroke(): void {
    const col = parseCss(this.strokeStyle as string), r = this.lineWidth / 2;
    for (const [x0, y0, x1, y1] of this.segs) this.paintCapsule(x0, y0, x1, y1, r, col);
  }
  fill(): void {
    const col = parseCss(this.fillStyle as string);
    for (const [x, y, r] of this.discs) this.paintCapsule(x, y, x, y, r, col);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    const col = parseCss(this.fillStyle as string);
    for (let py = Math.max(0, y); py < Math.min(this.height, y + h); py++)
      for (let px = Math.max(0, x); px < Math.min(this.width, x + w); px++) {
        const o = (py * this.width + px) * 4;
        this.data[o] = col[0]; this.data[o + 1] = col[1]; this.data[o + 2] = col[2]; this.data[o + 3] = 255;
      }
  }
  getImageData(x: number, y: number, w: number, h: number): ImageDataLike {
    if (x !== 0 || y !== 0 || w !== this.width || h !== this.height) throw new Error('SoftContext: full-frame only');
    return { width: w, height: h, data: this.data.slice() };
  }
  putImageData(img: ImageDataLike): void { this.data.set(img.data); }

  private paintCapsule(x0: number, y0: number, x1: number, y1: number, r: number, col: [number, number, number]): void {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - r - 1)), maxX = Math.min(this.width - 1, Math.ceil(Math.max(x0, x1) + r + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - r - 1)), maxY = Math.min(this.height - 1, Math.ceil(Math.max(y0, y1) + r + 1));
    const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const qx = px + 0.5, qy = py + 0.5;
        let t = len2 === 0 ? 0 : ((qx - x0) * dx + (qy - y0) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = x0 + t * dx - qx, ey = y0 + t * dy - qy;
        const a = Math.min(1, Math.max(0, r + 0.5 - Math.sqrt(ex * ex + ey * ey)));
        if (a <= 0) continue;
        const o = (py * this.width + px) * 4;
        for (let k = 0; k < 3; k++) this.data[o + k] = Math.round(this.data[o + k] * (1 - a) + col[k] * a);
        this.data[o + 3] = 255;
      }
    }
  }
}
