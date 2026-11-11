// CanvasEngine: renders an OpLog onto an injected 2D context, deterministically.
//
// - Ops are first appended to the log (receive), then rendered (step/flush). Splitting the two lets
//   Playback spread a received batch over its time span while the log (and its hash) is already complete.
// - Undo/redo keep a stack of "elements" (stroke | fill | clear). Undo restores the nearest cached
//   checkpoint and replays only the elements after it, so it stays fast after hundreds of strokes.
// - Rendering is a pure function of the log: strokes are drawn segment by segment, so live
//   incremental rendering and full replay produce identical pixels.

import { CANVAS_H, CANVAS_W } from '../constants.ts';
import type { Ctx2D, ImageDataLike } from './ctx.ts';
import { floodFill } from './fill.ts';
import { OpLog } from './oplog.ts';
import { colorToCss, WHITE, type BeginOp, type MoreOp, type Op } from './ops.ts';

interface Elem { kind: 'stroke' | 'fill' | 'clear'; start: number; end: number }
interface Pen { x: number; y: number; w: number; css: string }

export interface EngineStats { replays: number; replayedElements: number; checkpoints: number; checkpointInterval: number }

export class CanvasEngine {
  readonly log = new OpLog();
  private rIdx = 0;            // next op to render
  private rPt = 0;            // points already rendered of ops[rIdx] when it is an `m`
  private stack: Elem[] = [];
  private redoStack: Elem[] = [];
  private pen: Pen | null = null;
  private checkpoints = new Map<number, ImageDataLike>();
  private interval: number;
  stats: EngineStats = { replays: 0, replayedElements: 0, checkpoints: 0, checkpointInterval: 0 };

  private ctx: Ctx2D;
  private opts: { checkpointInterval?: number; maxCheckpoints?: number };

  constructor(ctx: Ctx2D, opts: { checkpointInterval?: number; maxCheckpoints?: number } = {}) {
    this.ctx = ctx; this.opts = opts;
    this.interval = opts.checkpointInterval ?? 16;
    this.blank();
  }

  private get maxCheckpoints(): number { return this.opts.maxCheckpoints ?? 8; }

  /** Number of undoable elements currently on the canvas (as rendered). */
  get depth(): number { return this.stack.length; }
  get redoDepth(): number { return this.redoStack.length; }
  get length(): number { return this.log.length; }
  get hash(): string { return this.log.hash; }

  /** Start a fresh, blank canvas and an empty log. */
  reset(): void {
    this.log.reset();
    this.rIdx = 0; this.rPt = 0; this.stack = []; this.redoStack = []; this.pen = null;
    this.checkpoints.clear();
    this.interval = this.opts.checkpointInterval ?? 16;
    this.blank();
  }

  /** Replace everything with `ops` (snapshot for joiners/reconnectors) and render at once. */
  load(ops: Op[]): string | null {
    this.reset();
    const err = this.log.load(ops);
    if (err) { this.reset(); return err; }
    this.flush();
    return null;
  }

  /** Validate + append to the log without rendering. Returns an error code or null. */
  receive(ops: Op[]): string | null { return this.log.tryAppend(ops); }

  /** Append and render immediately (the local drawer). */
  apply(ops: Op[]): string | null {
    const err = this.receive(ops);
    if (!err) this.flush();
    return err;
  }

  /** Units (points / discrete ops) logged but not yet rendered. */
  get pendingUnits(): number {
    let n = 0;
    for (let i = this.rIdx; i < this.log.length; i++) {
      const op = this.log.ops[i];
      n += op.k === 'm' ? op.p.length / 2 : 1;
    }
    return n - this.rPt;
  }

  flush(): void { this.step(Infinity); }

  /** Render up to `maxUnits` pending units. Returns units rendered. */
  step(maxUnits: number): number {
    let done = 0;
    const ops = this.log.ops;
    while (done < maxUnits && this.rIdx < ops.length) {
      const op = ops[this.rIdx];
      if (op.k === 'm') {
        const n = op.p.length / 2;
        const take = Math.min(n - this.rPt, maxUnits - done);
        this.drawMore(op, this.rPt, this.rPt + take);
        const top = this.stack[this.stack.length - 1];
        if (top && top.kind === 'stroke') top.end = this.rIdx + 1;
        this.rPt += take; done += take;
        if (this.rPt >= n) { this.rIdx++; this.rPt = 0; }
      } else {
        this.discrete(op, this.rIdx);
        this.rIdx++; done++;
      }
    }
    return done;
  }

  pixels(): Uint8ClampedArray { return this.ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data; }

  getStats(): EngineStats {
    return { ...this.stats, checkpoints: this.checkpoints.size, checkpointInterval: this.interval };
  }

  // ---- internals -------------------------------------------------------------------------

  private blank(): void {
    this.ctx.fillStyle = colorToCss(WHITE);
    this.ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  private discrete(op: Op, idx: number): void {
    switch (op.k) {
      case 'b':
        this.beforePush();
        this.stack.push({ kind: 'stroke', start: idx, end: idx + 1 });
        this.drawBegin(op);
        break;
      case 'f':
        this.beforePush();
        this.stack.push({ kind: 'fill', start: idx, end: idx + 1 });
        this.drawFill(op.x, op.y, op.c);
        break;
      case 'x':
        this.beforePush();
        this.stack.push({ kind: 'clear', start: idx, end: idx + 1 });
        this.blank();
        break;
      case 'u': {
        this.pen = null;
        const e = this.stack.pop();
        if (e) { this.redoStack.push(e); this.rebuild(this.stack.length); }
        break;
      }
      case 'r': {
        this.pen = null;
        const e = this.redoStack.pop();
        if (e) { this.stack.push(e); this.drawElement(e); }
        break;
      }
      default: break; // 'm' handled in step
    }
  }

  /** Called before a new element is pushed: snapshot if due, then forget the redo branch. */
  private beforePush(): void {
    this.pen = null;
    const n = this.stack.length;
    if (n > 0 && n % this.interval === 0 && !this.checkpoints.has(n)) {
      this.checkpoints.set(n, this.ctx.getImageData(0, 0, CANVAS_W, CANVAS_H));
      if (this.checkpoints.size > this.maxCheckpoints) {
        this.interval *= 2;
        for (const k of [...this.checkpoints.keys()]) if (k % this.interval !== 0) this.checkpoints.delete(k);
      }
    }
    if (this.redoStack.length) {
      this.redoStack = [];
      for (const k of [...this.checkpoints.keys()]) if (k > n) this.checkpoints.delete(k);
    }
  }

  /** Make the canvas show exactly the first `n` stack elements. */
  private rebuild(n: number): void {
    let base = 0;
    for (const k of this.checkpoints.keys()) if (k <= n && k > base) base = k;
    if (base > 0) this.ctx.putImageData(this.checkpoints.get(base)!, 0, 0);
    else this.blank();
    this.stats.replays++;
    for (let i = base; i < n; i++) { this.drawElement(this.stack[i]); this.stats.replayedElements++; }
  }

  private drawElement(e: Elem): void {
    const ops = this.log.ops;
    this.pen = null;
    for (let i = e.start; i < e.end; i++) {
      const op = ops[i];
      if (op.k === 'b') this.drawBegin(op);
      else if (op.k === 'm') this.drawMore(op, 0, op.p.length / 2);
      else if (op.k === 'f') this.drawFill(op.x, op.y, op.c);
      else if (op.k === 'x') this.blank();
    }
    this.pen = null;
  }

  private drawBegin(op: BeginOp): void {
    const c = this.ctx;
    const css = colorToCss(op.t === 1 ? WHITE : op.c);
    this.pen = { x: op.x, y: op.y, w: op.w, css };
    c.fillStyle = css;
    c.beginPath();
    c.arc(op.x, op.y, op.w / 2, 0, Math.PI * 2);
    c.fill();
  }

  private drawMore(op: MoreOp, from: number, to: number): void {
    const pen = this.pen;
    if (!pen) return;
    const c = this.ctx;
    c.strokeStyle = pen.css; c.fillStyle = pen.css; c.lineWidth = pen.w; c.lineCap = 'round'; c.lineJoin = 'round';
    for (let i = from; i < to; i++) {
      const nx = pen.x + op.p[2 * i], ny = pen.y + op.p[2 * i + 1];
      c.beginPath();
      if (nx === pen.x && ny === pen.y) c.arc(nx, ny, pen.w / 2, 0, Math.PI * 2);
      else { c.moveTo(pen.x, pen.y); c.lineTo(nx, ny); }
      if (nx === pen.x && ny === pen.y) c.fill(); else c.stroke();
      pen.x = nx; pen.y = ny;
    }
  }

  private drawFill(x: number, y: number, color: number): void {
    const img = this.ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    if (floodFill(img, x, y, color) > 0) this.ctx.putImageData(img, 0, 0);
  }
}

/** FNV-1a over pixel bytes: compare two canvases cheaply. */
export function pixelHash(data: Uint8ClampedArray): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}
