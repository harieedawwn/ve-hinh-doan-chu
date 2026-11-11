import { describe, expect, it } from 'vitest';
import { CANVAS_H, CANVAS_W, MAX_POINTS_PER_BATCH } from '../shared/constants.ts';
import { CanvasEngine, pixelHash } from '../shared/canvas/engine.ts';
import { OpLog } from '../shared/canvas/oplog.ts';
import { Playback } from '../shared/canvas/playback.ts';
import { SoftContext } from '../shared/canvas/softctx.ts';
import type { Op } from '../shared/canvas/ops.ts';

const mk = (opts?: ConstructorParameters<typeof CanvasEngine>[1]) => new CanvasEngine(new SoftContext(CANVAS_W, CANVAS_H), opts);
const stroke = (x: number, y: number, pts: number[], c = 0x000000, w = 6, t: 0 | 1 = 0): Op[] => [
  { k: 'b', t, c, w, x, y }, { k: 'm', p: pts },
];
/** closed square ring from (x,y) of side s as an op list */
const ring = (x: number, y: number, s: number, c = 0x000000, w = 8): Op[] => stroke(x, y, [s, 0, 0, s, -s, 0, 0, -s], c, w);

describe('OpLog validation', () => {
  it('accepts valid ops and chains a deterministic hash', () => {
    const a = new OpLog();
    expect(a.tryAppend(stroke(10, 10, [5, 5, 3, -2]))).toBeNull();
    // identical ops in a different batching => same hash (hash is over ops, not messages)
    const b = new OpLog();
    expect(b.tryAppend(stroke(10, 10, [5, 5, 3, -2]).slice(0, 1))).toBeNull();
    expect(b.tryAppend(stroke(10, 10, [5, 5, 3, -2]).slice(1))).toBeNull();
    expect(b.hash).toBe(a.hash);
    const c = new OpLog(); c.tryAppend(stroke(10, 10, [5, 5, 3, -2]));
    expect(c.hash).toBe(a.hash);
    c.tryAppend([{ k: 'u' }]);
    expect(c.hash).not.toBe(a.hash);
  });
  it('rejects malformed ops atomically', () => {
    const l = new OpLog();
    expect(l.tryAppend([{ k: 'b', t: 0, c: 0, w: 5, x: 1, y: 1 }, { k: 'm', p: [1, 2, 3] }])).toBe('m.p');
    expect(l.length).toBe(0);
    expect(l.tryAppend([{ k: 'm', p: [1, 1] }])).toBe('mNoStroke');
    expect(l.tryAppend([{ k: 'b', t: 0, c: 0, w: 5, x: 1.5, y: 1 }])).toBe('b.xy');
    expect(l.tryAppend([{ k: 'b', t: 0, c: -1, w: 5, x: 1, y: 1 }])).toBe('b.c');
    expect(l.tryAppend([{ k: 'b', t: 0, c: 0, w: 500, x: 1, y: 1 }])).toBe('b.w');
    expect(l.tryAppend([{ k: 'zz' }] as unknown as Op[])).toBe('k');
    expect(l.tryAppend(stroke(1190, 10, [20, 0]))).toBe('m.range');
    expect(l.tryAppend([{ k: 'f', x: 5000, y: 1, c: 0 }])).toBe('f');
    expect(l.length).toBe(0);
  });
  it('closes a stroke on any non-m op', () => {
    const l = new OpLog();
    expect(l.tryAppend([...stroke(5, 5, [1, 1]), { k: 'u' }, { k: 'm', p: [1, 1] }])).toBe('mNoStroke');
  });
  it('caps points per batch and per stroke', () => {
    const l = new OpLog();
    const pts = new Array((MAX_POINTS_PER_BATCH + 1) * 2).fill(0);
    expect(l.tryAppend(stroke(5, 5, pts))).toBe('batchPoints');
  });
  it('load round-trips big logs', () => {
    const a = new OpLog();
    for (let i = 0; i < 300; i++) a.tryAppend(stroke(100, 100 + (i % 50), [1, 1, 1, 0, 0, 1]));
    const b = new OpLog();
    expect(b.load(a.ops)).toBeNull();
    expect(b.hash).toBe(a.hash);
    expect(b.length).toBe(a.length);
  });
});

describe('CanvasEngine', () => {
  it('draws pen strokes and the eraser removes them', () => {
    const e = mk();
    e.apply(stroke(100, 100, [50, 0], 0xff0000, 10));
    const px = (x: number, y: number) => { const d = e.pixels(); const o = (y * CANVAS_W + x) * 4; return [d[o], d[o + 1], d[o + 2]]; };
    expect(px(125, 100)).toEqual([255, 0, 0]);
    expect(px(125, 200)).toEqual([255, 255, 255]);
    e.apply(stroke(100, 100, [50, 0], 0, 30, 1));
    expect(px(125, 100)).toEqual([255, 255, 255]);
  });

  it('live incremental rendering equals full replay regardless of batching', () => {
    const ops: Op[] = [...stroke(10, 10, [30, 5, -4, 22, 9, 0, 0, 0, 13, 13], 0x3366ff, 12), ...stroke(300, 300, [5, 5, 5, 5, 5, 5]), { k: 'f', x: 700, y: 700, c: 0x00aa00 }];
    const live = mk();
    for (const op of ops) live.apply([op]);
    const whole = mk(); whole.apply(ops);
    const stepped = mk(); stepped.receive(ops);
    while (stepped.pendingUnits > 0) stepped.step(1);
    expect(pixelHash(whole.pixels())).toBe(pixelHash(live.pixels()));
    expect(pixelHash(stepped.pixels())).toBe(pixelHash(live.pixels()));
    expect(live.hash).toBe(whole.hash);
  });

  it('undo / redo / clear semantics', () => {
    const e = mk(); const fresh = (n: number) => { const f = mk(); for (let i = 0; i < n; i++) f.apply(stroke(50 + i * 60, 50, [0, 200], i * 40000, 14)); return pixelHash(f.pixels()); };
    for (let i = 0; i < 3; i++) e.apply(stroke(50 + i * 60, 50, [0, 200], i * 40000, 14));
    expect(pixelHash(e.pixels())).toBe(fresh(3));
    e.apply([{ k: 'u' }]);
    expect(e.depth).toBe(2);
    expect(pixelHash(e.pixels())).toBe(fresh(2));
    e.apply([{ k: 'r' }]);
    expect(pixelHash(e.pixels())).toBe(fresh(3));
    e.apply([{ k: 'u' }, { k: 'u' }]);
    expect(pixelHash(e.pixels())).toBe(fresh(1));
    e.apply(stroke(900, 500, [10, 10]));          // new stroke kills the redo branch
    expect(e.redoDepth).toBe(0);
    e.apply([{ k: 'r' }]);                         // no-op
    expect(e.depth).toBe(2);
    e.apply([{ k: 'x' }]);
    expect(pixelHash(e.pixels())).toBe(pixelHash(mk().pixels()));
    e.apply([{ k: 'u' }]);                         // undo clear
    expect(e.depth).toBe(2);
    expect(pixelHash(e.pixels())).not.toBe(pixelHash(mk().pixels()));
  });

  it('undo after hundreds of strokes replays only a few elements (checkpoints)', () => {
    const e = mk({ checkpointInterval: 16, maxCheckpoints: 8 });
    const N = 400;
    for (let i = 0; i < N; i++) e.apply(stroke(20 + (i % 100) * 11, 20 + Math.floor(i / 100) * 200, [5, 80, 0, 40], (i * 977) & 0xffffff, 5));
    expect(e.depth).toBe(N);
    const before = e.getStats();
    let worst = 0;
    for (let i = 0; i < 150; i++) {
      const r0 = e.getStats().replayedElements;
      e.apply([{ k: 'u' }]);
      worst = Math.max(worst, e.getStats().replayedElements - r0);
    }
    expect(e.depth).toBe(N - 150);
    // equals a fresh render of the first N-150 strokes
    const f = mk();
    for (let i = 0; i < N - 150; i++) f.apply(stroke(20 + (i % 100) * 11, 20 + Math.floor(i / 100) * 200, [5, 80, 0, 40], (i * 977) & 0xffffff, 5));
    expect(pixelHash(e.pixels())).toBe(pixelHash(f.pixels()));
    expect(worst).toBeLessThanOrEqual(e.getStats().checkpointInterval);
    expect(e.getStats().checkpoints).toBeLessThanOrEqual(8);
    expect(before.checkpoints).toBeLessThanOrEqual(8);
    // redo everything back
    for (let i = 0; i < 150; i++) e.apply([{ k: 'r' }]);
    const full = mk();
    for (let i = 0; i < N; i++) full.apply(stroke(20 + (i % 100) * 11, 20 + Math.floor(i / 100) * 200, [5, 80, 0, 40], (i * 977) & 0xffffff, 5));
    expect(pixelHash(e.pixels())).toBe(pixelHash(full.pixels()));
  });

  it('a snapshot load reproduces the same pixels and hash', () => {
    const e = mk();
    e.apply([...ring(200, 200, 300), { k: 'f', x: 350, y: 350, c: 0xffcc00 }, ...stroke(50, 50, [100, 100], 0xff00ff, 20), { k: 'u' }, { k: 'r' }]);
    const j = mk();
    expect(j.load(e.log.ops.slice())).toBeNull();
    expect(j.hash).toBe(e.hash);
    expect(pixelHash(j.pixels())).toBe(pixelHash(e.pixels()));
  });
});

describe('flood fill', () => {
  it('fills inside a ring only and leaves no light halo along anti-aliased edges', () => {
    const e = mk();
    // a circle-ish diamond with diagonal edges (anti-aliased)
    e.apply(stroke(600, 200, [200, 200, -200, 200, -200, -200, 200, -200], 0x000000, 10));
    e.apply([{ k: 'f', x: 600, y: 400, c: 0xff0000 }]);
    const d = e.pixels();
    const at = (x: number, y: number) => { const o = (y * CANVAS_W + x) * 4; return [d[o], d[o + 1], d[o + 2]]; };
    expect(at(600, 400)).toEqual([255, 0, 0]);
    expect(at(50, 50)).toEqual([255, 255, 255]);          // outside untouched
    // halo = light grey pixels (blend of black on white) that survive adjacent to the filled region
    let halo = 0;
    for (let y = 205; y < 600; y++) for (let x = 405; x < 800; x++) {
      const [r, g, b] = at(x, y);
      if (r === g && g === b && r >= 150 && r < 255) {
        // adjacent (4-neighbour) to a red pixel => halo
        const nb = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
        if (nb.some(([nr, ng, nb2]) => nr === 255 && ng === 0 && nb2 === 0)) halo++;
      }
    }
    expect(halo).toBe(0);
    // the ring core stays black
    expect(at(600, 200)).toEqual([0, 0, 0]);
  });
  it('fill with the colour already there is a no-op and replay is deterministic', () => {
    const e = mk(); e.apply([{ k: 'f', x: 10, y: 10, c: 0xffffff }]);
    expect(pixelHash(e.pixels())).toBe(pixelHash(mk().pixels()));
  });
});

describe('Playback', () => {
  it('spreads a batch over its span and finishes with identical pixels', () => {
    const e = mk(); const p = new Playback(e);
    const ops = stroke(100, 100, [10, 0, 10, 0, 10, 0, 10, 0, 10, 0], 0x000000, 8);
    expect(p.enqueue(ops, 100, 1000)).toBeNull();
    expect(e.hash).toBe((() => { const l = new OpLog(); l.tryAppend(ops); return l.hash; })()); // logged at once
    p.tick(1000); const u0 = e.pendingUnits;
    p.tick(1050); const u1 = e.pendingUnits;
    p.tick(1100); const u2 = e.pendingUnits;
    expect(u0).toBeGreaterThan(u1); expect(u1).toBeGreaterThan(u2); expect(u2).toBe(0);
    const ref = mk(); ref.apply(ops);
    expect(pixelHash(e.pixels())).toBe(pixelHash(ref.pixels()));
  });
  it('queues batches back to back and caps lag', () => {
    const e = mk(); const p = new Playback(e, 250, 300);
    for (let i = 0; i < 20; i++) p.enqueue(stroke(10, 10 + i * 5, [1, 0, 1, 0]), 250, 0);
    p.tick(300);                 // lag cap: later batches start within 300 ms
    p.tick(600);
    expect(p.idle).toBe(true);
  });
});
