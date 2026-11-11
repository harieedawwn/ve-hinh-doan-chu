import { describe, expect, it } from 'vitest';
import { GameClient } from '../client/src/net.ts';
import type { ServerMsg } from '../shared/protocol.ts';

class FakeWS {
  static last: FakeWS;
  readyState = 1; sent: string[] = [];
  onopen: (() => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor(public url: string) { FakeWS.last = this; queueMicrotask(() => this.onopen?.()); }
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.(); }
  push(m: ServerMsg) { this.onmessage?.({ data: JSON.stringify(m) }); }
}

describe('GameClient clock sync', () => {
  it('estimates the server clock offset from ping round trips (min-RTT sample wins)', async () => {
    let now = 1_000_000;
    const c = new GameClient({ url: 'ws://x/ws/ABCDE', code: 'ABCDE', name: 'a', create: true, WebSocketImpl: FakeWS as never, now: () => now, autoReconnect: false });
    c.connect();
    await Promise.resolve();
    const ws = FakeWS.last;
    expect(JSON.parse(ws.sent[0])).toMatchObject({ t: 'hello', create: true });
    const SERVER_AHEAD = 5000;
    ws.push({ t: 'welcome', you: 'p1', token: 't', v: 1, room: { now: now + SERVER_AHEAD, phase: 'lobby', players: [], phaseEndsAt: null } as never });
    expect(c.status).toBe('open');
    expect(Math.abs(c.offset - SERVER_AHEAD)).toBeLessThan(1);           // coarse estimate from the welcome
    const ping = JSON.parse(ws.sent.find((s) => s.includes('"ping"'))!) as { c: number };
    // slow, asymmetric sample first: 400 ms round trip (would give a wrong offset)
    now += 400;
    ws.push({ t: 'pong', c: ping.c, s: ping.c + SERVER_AHEAD + 350 });
    const wrong = c.offset;
    // then a clean 40 ms round trip
    const t2 = now; now += 40;
    ws.push({ t: 'pong', c: t2, s: t2 + 20 + SERVER_AHEAD });
    expect(c.rtt).toBe(40);
    expect(Math.abs(c.offset - SERVER_AHEAD)).toBeLessThanOrEqual(1);
    expect(Math.abs(wrong - SERVER_AHEAD)).toBeGreaterThan(Math.abs(c.offset - SERVER_AHEAD));
    // two devices with different local clocks agree on the same server deadline
    const endsAt = now + SERVER_AHEAD + 30_000;
    expect(Math.abs(c.serverNow() - (now + SERVER_AHEAD))).toBeLessThanOrEqual(1);
    expect(Math.round((endsAt - c.serverNow()) / 1000)).toBe(30);
    c.close();
  });
});
