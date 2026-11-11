// Regression tests for the stage-3 code review (one test per confirmed finding).
import { describe, expect, it, vi } from 'vitest';
import { RoomCore, type RoomData } from '../server/room-core.ts';
import { GameClient } from '../client/src/net.ts';
import type { Op } from '../shared/canvas/ops.ts';
import { Harness, lobby, drawerOf, pickFirst } from './helpers.ts';

const dot = (x: number): Op[] => [{ k: 'b', t: 0, c: 0, w: 4, x, y: 10 }];

function inGame(seed = 1, n = 4, settings: Record<string, unknown> = {}, notHost = false) {
  for (; notHost; seed += 100) { // find a seed whose first drawer is not the host (host is needed to pause/resume)
    const t = new Harness(seed); const c = lobby(t, n, settings); c[0].send({ t: 'start' });
    if (drawerOf(t, c) !== c[0]) break;
  }
  const h = new Harness(seed);
  const cs = lobby(h, n, { hints: 0, drawTime: 120, ...settings });
  cs[0].send({ t: 'start' });
  const dr = drawerOf(h, cs);
  return { h, cs, dr, g: cs.filter((c) => c !== dr) };
}

describe('review fixes', () => {
  it('1. a drawer who left during choosing does not keep the drawing turn', () => {
    const { h, dr } = inGame(3, 4, { chooseTime: 15 });
    h.advance(10_000); dr.disconnect();
    h.advance(5_100);                       // choosing times out, a word is picked for the absent drawer
    expect(h.d.phase).toBe('drawing');
    h.advance(5_000);                       // drawer grace (10 s after the drop) expires
    expect(h.d.phase).toBe('reveal');
    expect(h.d.reveal!.reason).toBe('drawerLeft');
  });
  it('1b/7. pause: drawer who drops while paused is dealt with after resume; resume ends a fully guessed turn', () => {
    const a = inGame(4, 4, {}, true);
    pickFirst(a.h, a.cs);
    a.cs[0].send({ t: 'pause' });
    a.dr.disconnect();
    a.h.advance(30_000);
    expect(a.h.d.phase).toBe('drawing');
    a.cs[0].send({ t: 'pause' });           // resume (host may be the dropped drawer: pick whoever is host)
    a.h.advance(10_100);
    expect(a.h.d.phase).toBe('reveal');

    const b = inGame(5, 3, {}, true);
    pickFirst(b.h, b.cs);
    b.g[0].chat(b.h.d.game.word!);
    b.cs[0].send({ t: 'pause' });
    b.g[1].disconnect();                    // the last unguessed guesser leaves while paused
    expect(b.h.d.phase).toBe('drawing');
    b.cs[0].send({ t: 'pause' });
    expect(b.h.d.phase).toBe('reveal');
    expect(b.h.d.reveal!.reason).toBe('allGuessed');
  });
  it('2. a short drop at the end of a turn does not end the game', () => {
    const { h, cs, g } = inGame(6, 2);
    pickFirst(h, cs);
    cs[0].send({ t: 'skip' });
    expect(h.d.phase).toBe('reveal');
    const other = cs.find((c) => c.pid !== cs[0].pid)!; const tok = other.token;
    other.disconnect();
    h.advance(7_500);
    expect(h.d.phase).toBe('reveal');       // held, not podium
    h.connect('x', { token: tok });
    h.advance(2_500);
    expect(h.d.phase).toBe('choosing');
    void g;
  });
  it('3. a fired hint is persisted (else a hibernation replays it with a new letter)', () => {
    const { h, cs } = inGame(7, 3, { hints: 1, drawTime: 90, difficulties: ['easy'] });
    pickFirst(h, cs);
    if (h.d.game.hintsTotal === 0) return;  // short word: nothing to test
    h.persists = [];
    h.advance(46_000);
    expect(h.d.game.hintsGiven).toBe(1);
    expect(h.persists).toContain('now');
  });
  it('4. restore after eviction re-arms host, drawer and expiry deadlines', () => {
    const { h, cs } = inGame(8, 3);
    pickFirst(h, cs);
    const data = JSON.parse(JSON.stringify(h.d)) as RoomData;
    delete data.timers['hostGone']; delete data.timers['drawerGone'];
    const h2 = new Harness(8);
    h2.t = h.t;
    h2.core = new RoomCore(h2, 'ABCDE');
    h2.core.restore(data, [], []);          // no socket survived
    const keys = Object.keys(h2.d.timers);
    expect(keys.some((k) => /host/i.test(k))).toBe(true);
    expect(keys.some((k) => /drawer/i.test(k))).toBe(true);
    expect(keys.some((k) => /expire/i.test(k))).toBe(true);
  });
  it('5. non-drawers cannot flood draw frames: socket closed with 1008', () => {
    const { h, cs, g } = inGame(9);
    pickFirst(h, cs);
    for (let i = 0; i < 1000 && !g[0].closed; i++) g[0].draw(dot(5));
    expect(g[0].closed?.code).toBe(1008);
  });
  it('6. a rate-limited drawer batch is rejected with a fresh canvas, not silently dropped', () => {
    const { h, cs, dr } = inGame(10);
    pickFirst(h, cs);
    dr.clear();
    for (let i = 0; i < 90; i++) dr.draw(dot(10 + i));
    expect(dr.of('drawReject').some((m) => m.code === 'rate')).toBe(true);
    expect(dr.of('canvas').length).toBeGreaterThan(0);
  });
  it('8. while paused a close guess gets no "noWord" notice and is not shown to other guessers', () => {
    const { h, cs, g } = inGame(11);
    pickFirst(h, cs);
    cs[0].send({ t: 'pause' });
    g[0].clear(); g[1].clear();
    const w = h.d.game.word!;
    const guesser = g.find((c) => c.pid !== cs[0].pid)!;
    const other = g.find((c) => c !== guesser)!;
    guesser.chat(w); other.clear(); guesser.clear();
    guesser.chat(w);
    expect(guesser.of('notice').some((m) => m.code === 'noWord')).toBe(false);
    expect(other.raw.join('')).not.toContain(w);
  });
  it('10. the adapter can invalidate the alarm memo so a failed setAlarm is rewritten', () => {
    const { h, cs } = inGame(12);
    pickFirst(h, cs);
    const was = h.alarm;
    h.alarm = null;
    h.core.invalidateAlarm();
    cs[0].send({ t: 'ping', c: 1 });
    expect(h.alarm).toBe(was);
  });
});

describe('client backoff (review 9)', () => {
  class WS {
    static n = 0; readyState = 1; onopen: (() => void) | null = null; onclose: (() => void) | null = null; onmessage = null; onerror = null;
    constructor() { WS.n++; queueMicrotask(() => this.onopen?.()); }
    send() {} close() { this.onclose?.(); }
  }
  it('accept-then-close without a welcome keeps growing the retry delay', async () => {
    vi.useFakeTimers();
    const c = new GameClient({ url: 'ws://x/ws/ABCDE', code: 'ABCDE', name: 'a', WebSocketImpl: WS as never });
    c.connect();
    for (let i = 0; i < 3; i++) { await Promise.resolve(); (c as unknown as { ws: WS }).ws.onclose?.(); await vi.advanceTimersByTimeAsync(12_000); }
    expect(c.failures).toBeGreaterThanOrEqual(3);
    c.close(); vi.useRealTimers();
  });
});
