// Playback: spreads each received batch over the time span the drawer spent producing it,
// so remote strokes animate smoothly instead of jumping in 40 ms lumps.

import type { CanvasEngine } from './engine.ts';
import { OpLog } from './oplog.ts';
import type { Op } from './ops.ts';

interface Item { units: number; start: number; span: number; done: number }

export class Playback {
  private q: Item[] = [];
  private lastEnd = 0;

  /** maxSpan: clamp for one batch; maxLag: never let the canvas trail the network by more than this. */
  private engine: CanvasEngine;
  private maxSpan: number;
  private maxLag: number;

  constructor(engine: CanvasEngine, maxSpan = 250, maxLag = 500) {
    this.engine = engine; this.maxSpan = maxSpan; this.maxLag = maxLag;
  }

  get idle(): boolean { return this.q.length === 0; }

  /** Log the ops now (hash is complete) and schedule their rendering. Returns an error code or null. */
  enqueue(ops: Op[], spanMs: number, now: number): string | null {
    const err = this.engine.receive(ops);
    if (err) return err;
    const units = OpLog.units(ops);
    const span = Math.max(0, Math.min(Number.isFinite(spanMs) ? spanMs : 0, this.maxSpan));
    const start = Math.min(Math.max(now, this.lastEnd), now + this.maxLag);
    this.q.push({ units, start, span, done: 0 });
    this.lastEnd = start + span;
    return null;
  }

  /** Advance rendering to time `now`. Call from requestAnimationFrame. */
  tick(now: number): void {
    while (this.q.length) {
      const it = this.q[0];
      const frac = it.span <= 0 ? 1 : Math.min(1, Math.max(0, (now - it.start) / it.span));
      const target = Math.floor(it.units * frac);
      if (target > it.done) { this.engine.step(target - it.done); it.done = target; }
      if (it.done >= it.units) this.q.shift(); else break;
    }
  }

  /** Render everything immediately (before undo bookkeeping, snapshots, tab becoming visible, ...). */
  flush(): void { this.engine.flush(); this.q = []; this.lastEnd = 0; }

  /** Drop pending work (after the engine is reset or reloaded). */
  clear(): void { this.q = []; this.lastEnd = 0; }
}
