// OpLog: ordered, validated list of canvas ops plus an incremental integrity hash.
// Used by the server (no pixels) and by every client (together with CanvasEngine).

import {
  MAX_FILLS_PER_TURN, MAX_OPS_PER_BATCH, MAX_OPS_PER_TURN, MAX_POINTS_PER_BATCH,
  MAX_POINTS_PER_STROKE, MAX_POINTS_PER_TURN, CANVAS_H, CANVAS_W,
} from '../constants.ts';
import { ChainHash } from './hash.ts';
import { checkOpShape, opToString, opUnits, type Op } from './ops.ts';

export interface OpLogSnapshot { ops: Op[]; hash: string }

export class OpLog {
  ops: Op[] = [];
  private h = new ChainHash();
  // validation state
  private open = false;        // is a stroke currently open
  private px = 0; private py = 0;
  private strokePoints = 0;
  private totalPoints = 0;
  private fills = 0;

  get length(): number { return this.ops.length; }
  get hash(): string { return this.h.hex(); }

  reset(): void {
    this.ops = []; this.h = new ChainHash();
    this.open = false; this.px = this.py = 0; this.strokePoints = 0; this.totalPoints = 0; this.fills = 0;
  }

  /**
   * Validate and append a batch atomically (all or nothing).
   * Returns null on success or a short error code.
   */
  tryAppend(batch: unknown): string | null {
    if (!Array.isArray(batch) || batch.length === 0) return 'empty';
    if (batch.length > MAX_OPS_PER_BATCH) return 'batchOps';
    if (this.ops.length + batch.length > MAX_OPS_PER_TURN) return 'turnOps';
    let open = this.open, px = this.px, py = this.py, sp = this.strokePoints, tp = this.totalPoints, fills = this.fills;
    let batchPoints = 0;
    for (const op of batch as Op[]) {
      const bad = checkOpShape(op);
      if (bad) return bad;
      switch (op.k) {
        case 'b':
          open = true; px = op.x; py = op.y; sp = 1; tp += 1; batchPoints += 1;
          break;
        case 'm': {
          if (!open) return 'mNoStroke';
          for (let i = 0; i < op.p.length; i += 2) {
            px += op.p[i]; py += op.p[i + 1];
            if (px < 0 || px > CANVAS_W || py < 0 || py > CANVAS_H) return 'm.range';
          }
          const n = op.p.length / 2;
          sp += n; tp += n; batchPoints += n;
          if (sp > MAX_POINTS_PER_STROKE) return 'strokePoints';
          break;
        }
        case 'f':
          open = false;
          if (++fills > MAX_FILLS_PER_TURN) return 'fills';
          break;
        default: open = false;
      }
      if (tp > MAX_POINTS_PER_TURN) return 'turnPoints';
    }
    if (batchPoints > MAX_POINTS_PER_BATCH) return 'batchPoints';
    // commit
    for (const op of batch as Op[]) { this.ops.push(op); this.h.update(opToString(op)); }
    this.open = open; this.px = px; this.py = py; this.strokePoints = sp; this.totalPoints = tp; this.fills = fills;
    return null;
  }

  /** Total stroke work for a list of ops (playback units). */
  static units(ops: readonly Op[]): number {
    let n = 0; for (const o of ops) n += opUnits(o); return n;
  }

  /** Rebuild from a persisted / transmitted op list (validated). Returns an error code or null. */
  load(ops: Op[]): string | null {
    this.reset();
    let start = 0, pts = 0;
    const flush = (end: number): string | null => (end > start ? this.tryAppend(ops.slice(start, end)) : null);
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      const u = o && o.k === 'm' && Array.isArray(o.p) ? o.p.length / 2 : 1;
      if (i - start >= MAX_OPS_PER_BATCH || (pts + u > MAX_POINTS_PER_BATCH && i > start)) {
        const e = flush(i);
        if (e) { this.reset(); return e; }
        start = i; pts = 0;
      }
      pts += u;
    }
    const e = flush(ops.length);
    if (e) { this.reset(); return e; }
    return null;
  }

  snapshot(): OpLogSnapshot { return { ops: this.ops.slice(), hash: this.hash }; }
}
