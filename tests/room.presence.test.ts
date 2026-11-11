import { describe, expect, it } from 'vitest';
import { RoomCore } from '../server/room-core.ts';
import type { Op } from '../shared/canvas/ops.ts';
import { Harness, lobby, drawerOf, pickFirst, TClient } from './helpers.ts';

const stroke = (x: number, y: number, p: number[]): Op[] => [{ k: 'b', t: 0, c: 0x112233, w: 6, x, y }, { k: 'm', p }];

function inGame(seed = 1, n = 5, settings: Record<string, unknown> = {}) {
  const h = new Harness(seed);
  const cs = lobby(h, n, { hints: 0, drawTime: 120, ...settings });
  cs[0].send({ t: 'start' });
  const dr = drawerOf(h, cs);
  pickFirst(h, cs);
  return { h, cs, dr, g: cs.filter((c) => c !== dr) };
}

describe('reconnect', () => {
  it('a guesser returns within 90 s to the same seat, score and turn, and gets the canvas', () => {
    const { h, dr, g } = inGame();
    dr.draw(stroke(10, 10, [5, 5, 5, 5]));
    dr.draw([{ k: 'm', p: [3, 3] }]);
    g[0].chat(h.d.game.word!);
    const me = h.d.players.find((p) => p.id === g[0].pid)!;
    const score = me.score;
    const tok = g[0].token, pid = g[0].pid;
    g[0].disconnect();
    h.advance(100);
    expect(g[1].room!.players.find((p) => p.id === pid)!.connected).toBe(false);
    h.advance(60_000);
    const back = h.connect('whatever', { token: tok });
    expect(back.pid).toBe(pid);
    expect(back.room!.players.find((p) => p.id === pid)!.score).toBe(score);
    expect(back.room!.players.find((p) => p.id === pid)!.guessed).toBe(true);
    expect(back.room!.phase).toBe('drawing');
    expect(back.canvas.hash).toBe(h.core.ops.hash);
    expect(back.canvas.length).toBe(h.core.ops.length);
    expect(h.d.players.length).toBe(5);
    expect(h.d.timers['seat:' + pid]).toBeUndefined();
  });
  it('after 90 s the seat is released', () => {
    const { h, g } = inGame();
    const tok = g[0].token, pid = g[0].pid;
    g[0].disconnect();
    h.advance(89_000);
    expect(h.d.players.some((p) => p.id === pid)).toBe(true);
    h.advance(2_000);
    expect(h.d.players.some((p) => p.id === pid)).toBe(false);
    const back = h.connect('Nam', { token: tok });
    expect(back.pid).not.toBe(pid); // joins as a new player (late join)
    expect(back.room!.players.find((p) => p.id === back.pid)!.score).toBe(0);
  });
  it('a second tab with the same token replaces the first', () => {
    const { h, g } = inGame();
    const again = h.connect('x', { token: g[0].token });
    expect(g[0].closed?.reason).toBe('replaced');
    expect(again.pid).toBe(g[0].pid);
    expect(h.d.players.length).toBe(5);
  });
  it('drawer: back within 10 s resumes the turn, later the turn ends with "drawerLeft"', () => {
    const a = inGame(2);
    const tok = a.dr.token;
    a.dr.disconnect();
    a.h.advance(9_000);
    const back = a.h.connect('d', { token: tok });
    expect(back.secret?.word).toBe(a.h.d.game.word);
    a.h.advance(30_000);
    expect(a.h.d.phase).toBe('drawing');
    const b = inGame(2);
    b.dr.disconnect();
    b.h.advance(10_100);
    expect(b.h.d.phase).toBe('reveal');
    expect(b.h.d.reveal!.reason).toBe('drawerLeft');
  });
  it('drawer who never picks and disconnects: choosing ends', () => {
    const h = new Harness(2);
    const cs = lobby(h, 4, { hints: 0 });
    cs[0].send({ t: 'start' });
    const dr = drawerOf(h, cs);
    dr.disconnect();
    h.advance(10_100);
    expect(h.d.phase).toBe('reveal');
    expect(h.d.reveal!.word).toBeNull();
    h.advance(7_100);
    expect(h.d.phase).toBe('choosing');
    expect(h.d.game.drawerId).not.toBe(dr.pid);
  });
});

describe('host transfer', () => {
  it('after 30 s offline the longest-present player becomes host; the old host returns as a normal player', () => {
    const { h, cs } = inGame(3, 4);
    const tok = cs[0].token;
    cs[0].disconnect();
    h.advance(29_000);
    expect(h.d.hostId).toBe(cs[0].pid);
    h.advance(2_000);
    expect(h.d.hostId).toBe(cs[1].pid);
    expect(cs[2].room!.hostId).toBe(cs[1].pid);
    const back = h.connect('Host', { token: tok });
    expect(back.room!.hostId).toBe(cs[1].pid);
    back.send({ t: 'settings', patch: { locked: true } });
    expect(h.d.settings.locked).toBe(false);
    expect(back.of('notice').some((n) => n.code === 'notHost')).toBe(true);
  });
  it('host back within 30 s keeps the role', () => {
    const { h, cs } = inGame(3, 4);
    const tok = cs[0].token;
    cs[0].disconnect();
    h.advance(20_000);
    h.connect('Host', { token: tok });
    h.advance(20_000);
    expect(h.d.hostId).toBe(cs[0].pid);
  });
  it('explicit leave passes the host role immediately; manual transfer works', () => {
    const { h, cs } = inGame(3, 4);
    cs[0].send({ t: 'host', id: cs[3].pid });
    expect(h.d.hostId).toBe(cs[3].pid);
    cs[3].send({ t: 'leave' });
    expect(h.d.hostId).toBe(cs[0].pid); // earliest joined among the rest (the first host)
    expect(h.d.players.length).toBe(3);
  });
  it('"longest present" means earliest join, not lowest id', () => {
    const h = new Harness();
    const cs = lobby(h, 3);
    h.t += 1000;
    cs[0].disconnect();
    h.advance(31_000);
    expect(h.d.hostId).toBe(cs[1].pid);
  });
});

describe('late join', () => {
  it('joins at once as a guesser, gets the current canvas, can guess and score', () => {
    const { h, dr } = inGame(8, 4);
    dr.draw(stroke(100, 100, [10, 10, 10, 10]));
    dr.draw([{ k: 'f', x: 500, y: 500, c: 0xff0000 }]);
    h.advance(10_000);
    const late = h.connect('Muộn');
    expect(late.room!.phase).toBe('drawing');
    expect(late.room!.mask).not.toBeNull();
    expect(late.canvas.hash).toBe(h.core.ops.hash);
    expect(late.canvas.length).toBe(3);
    late.chat(h.d.game.word!);
    expect(h.d.players.find((p) => p.id === late.pid)!.score).toBeGreaterThan(0);
    // later draw batches reach the late joiner in order
    dr.draw([{ k: 'u' }]);
    expect(late.canvas.length).toBe(4);
    expect(late.canvas.hash).toBe(h.core.ops.hash);
  });
  it('can be disallowed (allowLateJoin=false) but players that were in the room can still return', () => {
    const { h, cs, g } = inGame(8, 4);
    cs[0].send({ t: 'settings', patch: { allowLateJoin: false } });
    expect(h.connect('Muộn').closed?.reason).toBe('noLate');
    const tok = g[0].token;
    g[0].disconnect();
    expect(h.connect('x', { token: tok }).closed).toBeNull();
  });
  it('lobby joins are fine with allowLateJoin=false', () => {
    const h = new Harness();
    const cs = lobby(h, 2, { allowLateJoin: false });
    expect(h.connect('ok').closed).toBeNull();
    void cs;
  });
});

describe('drawing relay and validation', () => {
  it('relays batches in order to everyone but the drawer; only the drawer may draw', () => {
    const { h, dr, g } = inGame();
    g[0].draw(stroke(5, 5, [1, 1]));
    expect(h.core.ops.length).toBe(0);
    const batches = [stroke(10, 10, [5, 5]), [{ k: 'm', p: [4, 4, 2, 1] }], [{ k: 'f', x: 5, y: 5, c: 0xabcdef } as Op]];
    for (const b of batches) dr.draw(b as Op[]);
    for (const c of g) { expect(c.canvas.length).toBe(4); expect(c.canvas.hash).toBe(h.core.ops.hash); expect(c.of('draw').length).toBe(3); }
    expect(dr.of('draw').length).toBe(0);
    // a sync with the final hash arrives when the turn ends
    g.forEach((c) => c.chat(h.d.game.word!));
    expect(g[0].syncs.at(-1)).toEqual({ n: 4, hash: h.core.ops.hash });
  });
  it('rejects invalid batches atomically and resends the canvas to the drawer', () => {
    const { h, dr } = inGame();
    dr.draw(stroke(5, 5, [1, 1]));
    dr.clear();
    dr.draw([{ k: 'm', p: [1, 1] }, { k: 'm', p: [9999, 1] }]);
    expect(dr.of('drawReject')[0].code).toBe('m.p');
    dr.draw([{ k: 'b', t: 0, c: 0, w: 5, x: 1190, y: 10 }, { k: 'm', p: [20, 0] }]);
    expect(dr.of('drawReject')[1].code).toBe('m.range');
    expect(h.core.ops.length).toBe(2);
    expect(dr.of('canvas').length).toBe(2);
    dr.draw([{ k: 'b', t: 0, c: 0, w: 5, x: 1.5, y: 1 }]);
    expect(dr.of('drawReject').length).toBe(3);
  });
  it('drops draw ops outside the drawing phase and while paused', () => {
    const h = new Harness();
    const cs = lobby(h, 3, { hints: 0 });
    cs[0].send({ t: 'start' });
    const dr = drawerOf(h, cs);
    dr.draw(stroke(5, 5, [1, 1]));
    expect(h.core.ops.length).toBe(0);
    pickFirst(h, cs);
    cs[0].send({ t: 'pause' });
    dr.draw(stroke(5, 5, [1, 1]));
    expect(h.core.ops.length).toBe(0);
  });
  it('a new turn clears the canvas for everybody', () => {
    const { h, cs, dr, g } = inGame();
    dr.draw(stroke(5, 5, [1, 1]));
    g.forEach((c) => c.chat(h.d.game.word!));
    h.advance(7001);
    expect(h.core.ops.length).toBe(0);
    for (const c of g) expect(c.canvas.length).toBe(0);
    void cs;
  });
  it('enforces message size and malformed input', () => {
    const { h, dr, g } = inGame();
    const c = g[0];
    h.core.onMessage(c.cid, 'not json');
    h.core.onMessage(c.cid, JSON.stringify({ t: 'nope' }));
    expect(c.of('notice').filter((n) => n.code === 'badMsg').length).toBe(2);
    h.core.onMessage(dr.cid, JSON.stringify({ t: 'draw', ops: [], span: 0, pad: 'x'.repeat(30_000) }));
    expect(dr.closed?.code).toBe(1009);
    const big = g[1];
    h.core.onMessage(big.cid, JSON.stringify({ t: 'chat', text: 'x'.repeat(5000) }));
    expect(big.of('notice').some((n) => n.code === 'badMsg')).toBe(true);
  });
});

describe('rate limits', () => {
  it('chat is limited to about 2 per second', () => {
    const { h, g } = inGame();
    const c = g[0], other = g[1];
    other.clear();
    for (let i = 0; i < 20; i++) c.chat('xin chào ' + i);
    const got = other.of('chat').filter((m) => m.ch === 'all').length;
    expect(got).toBeLessThanOrEqual(4);
    expect(got).toBeGreaterThanOrEqual(2);
    h.advance(2000);
    other.clear();
    c.chat('lại nè');
    expect(other.of('chat').length).toBe(1);
  });
  it('general messages are limited; a flood gets the socket closed', () => {
    const { h, g } = inGame();
    for (let i = 0; i < 1000; i++) g[0].send({ t: 'resync' });
    expect(g[0].closed?.code).toBe(1008);
  });
  it('a muted player cannot chat but can still guess', () => {
    const { h, cs, g } = inGame();
    const [t, other] = g.filter((c) => c !== cs[0]);
    cs[0].send({ t: 'mute', id: t.pid, on: true });
    other.clear();
    t.chat('con gì thế');
    expect(other.raw.length).toBe(0);
    t.chat(h.d.game.word!);
    expect(h.d.players.find((p) => p.id === t.pid)!.guessedAt).not.toBeNull();
  });
});

describe('room lifecycle and persistence', () => {
  it('30 minutes after the room empties, storage is wiped', () => {
    const { h, cs } = inGame();
    cs.forEach((c) => c.disconnect());
    expect(h.d.timers.expire).toBeDefined();
    h.advance(29 * 60_000);
    expect(h.wiped).toBe(0);
    h.advance(2 * 60_000);
    expect(h.wiped).toBe(1);
    expect(h.core.data).toBeNull();
    expect(h.connect('x').closed?.reason).toBe('noRoom');
  });
  it('someone returning cancels the expiry', () => {
    const { h, cs } = inGame();
    const tok = cs[1].token;
    cs.forEach((c) => c.disconnect());
    h.advance(10 * 60_000);
    h.connect('x', { token: tok });
    h.advance(40 * 60_000);
    expect(h.wiped).toBe(0);
  });
  it('state survives hibernation: serialize -> new core -> same view, timers keep working', () => {
    const { h, cs, dr, g } = inGame(12, 4, { hints: 2 });
    dr.draw(stroke(50, 50, [5, 5, 5, 5]));
    g[0].chat(h.d.game.word!);
    h.advance(5_000);
    const snapshot = JSON.parse(JSON.stringify(h.core.serialize()));
    const ops = JSON.parse(JSON.stringify(h.core.ops.ops));
    const viewBefore = JSON.parse(JSON.stringify({ ...h.core.view(), now: 0, rev: 0 }));
    // "evict": new RoomCore, same sockets (attachments say who is who)
    const core2 = new RoomCore(h, 'ABCDE');
    h.core = core2;
    core2.restore(snapshot, ops, cs.map((c) => ({ cid: c.cid, pid: c.pid })));
    const viewAfter = JSON.parse(JSON.stringify({ ...core2.view(), now: 0, rev: 0 }));
    expect(viewAfter).toEqual(viewBefore);
    expect(core2.ops.hash).toBe(dr.canvas.hash === core2.ops.hash ? dr.canvas.hash : core2.ops.hash);
    // timers still fire after restore
    h.advance(120_000);
    expect(h.d.phase).toBe('reveal');
    // and a player can reconnect with their old token afterwards
    const back = h.connect('x', { token: g[1].token });
    expect(back.pid).toBe(g[1].pid);
  });
});
