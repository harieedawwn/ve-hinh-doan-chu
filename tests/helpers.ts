import { OpLog } from '../shared/canvas/oplog.ts';
import type { Op } from '../shared/canvas/ops.ts';
import type { ClientMsg, RoomView, SecretView, ServerMsg } from '../shared/protocol.ts';
import { RoomCore, type Io, type RoomData } from '../server/room-core.ts';

export function mulberry32(a: number): () => number {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class TClient {
  cid: string; pid = ''; token = ''; closed: { code: number; reason: string } | null = null;
  inbox: ServerMsg[] = []; room: RoomView | null = null; secret: SecretView | null = null;
  canvas = new OpLog(); canvasResets = 0; syncs: { n: number; hash: string }[] = [];
  h: Harness;
  constructor(h: Harness, cid: string) { this.h = h; this.cid = cid; }
  get all(): string[] { return this.raw; }
  raw: string[] = [];
  receive(data: string): void {
    this.raw.push(data);
    const m = JSON.parse(data) as ServerMsg;
    this.inbox.push(m);
    switch (m.t) {
      case 'welcome': this.pid = m.you; this.token = m.token; this.room = m.room; this.secret = m.secret ?? null; break;
      case 'state': this.room = m.room; if (m.room.phase !== 'choosing' && m.room.phase !== 'drawing') this.secret = null; break;
      case 'secret': this.secret = m.secret; break;
      case 'canvas': {
        if (m.reset) { this.canvas.reset(); this.canvasResets++; }
        expectNull(this.canvas.tryAppendBulk(m.ops), 'canvas snapshot');
        break;
      }
      case 'draw': {
        if (m.n !== this.canvas.length) throw new Error(`draw out of order: n=${m.n} have=${this.canvas.length}`);
        expectNull(this.canvas.tryAppend(m.ops), 'draw relay');
        break;
      }
      case 'sync': this.syncs.push({ n: m.n, hash: m.hash }); break;
    }
  }
  send(m: ClientMsg | Record<string, unknown>): void { this.h.core.onMessage(this.cid, JSON.stringify(m)); }
  chat(text: string): void { this.send({ t: 'chat', text }); }
  draw(ops: Op[], span = 40): void { this.send({ t: 'draw', ops, span }); }
  of<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }>[] { return this.inbox.filter((m) => m.t === t) as Extract<ServerMsg, { t: T }>[]; }
  clear(): void { this.inbox = []; this.raw = []; }
  disconnect(): void { this.h.disconnect(this); }
}

function expectNull(v: string | null, what: string): void { if (v) throw new Error(`${what}: ${v}`); }

// OpLog helper for tests: load a snapshot page without batch caps
declare module '../shared/canvas/oplog.ts' { interface OpLog { tryAppendBulk(ops: Op[]): string | null } }
(OpLog.prototype as OpLog).tryAppendBulk = function (this: OpLog, ops: Op[]) {
  // append page by page, validating via a temporary full load to keep caps meaningful
  const all = this.ops.concat(ops);
  const err = this.load(all);
  return err;
};

export class Harness implements Io {
  t = 1_700_000_000_000;
  rnd: () => number;
  core: RoomCore;
  clients = new Map<string, TClient>();
  alarm: number | null = null;
  wiped = 0; persists: string[] = []; flushReq: number | null = null;
  private n = 0; private tokN = 0;
  constructor(seed = 1, code = 'ABCDE') { this.rnd = mulberry32(seed); this.core = new RoomCore(this, code); }
  now(): number { return this.t; }
  random(): number { return this.rnd(); }
  token(): string { return 'tok' + ++this.tokN + Math.floor(this.rnd() * 1e9).toString(36); }
  send(cid: string, data: string): void { this.clients.get(cid)?.receive(data); }
  close(cid: string, code: number, reason: string): void {
    const c = this.clients.get(cid); if (!c) return;
    c.closed = { code, reason }; this.clients.delete(cid);
    this.core.onClose(cid);
  }
  setAlarm(at: number | null): void { this.alarm = at; }
  persist(kind: string): void { this.persists.push(kind); }
  requestFlush(ms: number): void { this.flushReq = this.t + ms; }
  wipe(): void { this.wiped++; }
  bind(): void { /* attachments are a Durable Object concern */ }

  connect(name = 'Khách', opts: { create?: boolean; token?: string; avatar?: number } = {}): TClient {
    const cid = 'c' + ++this.n;
    const c = new TClient(this, cid);
    this.clients.set(cid, c);
    this.core.onOpen(cid);
    c.send({ t: 'hello', name, avatar: opts.avatar ?? 0, create: opts.create, token: opts.token });
    return c;
  }
  disconnect(c: TClient): void { this.clients.delete(c.cid); this.core.onClose(c.cid); }

  /** Advance the clock, firing the alarm (and throttled state flushes) at the right moments. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (let guard = 0; guard < 100000; guard++) {
      const nextAlarm = this.alarm !== null ? this.alarm : Infinity;
      const nextFlush = this.flushReq !== null ? this.flushReq : Infinity;
      const next = Math.min(nextAlarm, nextFlush);
      if (next > end) break;
      this.t = Math.max(this.t, next);
      if (nextFlush <= nextAlarm) { this.flushReq = null; this.core.flushState(); }
      else { this.alarm = null; this.core.onAlarm(); }
    }
    this.t = end;
    this.core.flushState();
  }

  get d(): RoomData { return this.core.data!; }
}

/** Create a room with the host + N guests, all connected. */
export function lobby(h: Harness, n: number, settings: Record<string, unknown> = {}): TClient[] {
  const host = h.connect('Host', { create: true });
  const out = [host];
  for (let i = 1; i < n; i++) out.push(h.connect('P' + i));
  if (Object.keys(settings).length) host.send({ t: 'settings', patch: settings });
  h.core.flushState();
  return out;
}

export function drawerOf(h: Harness, cs: TClient[]): TClient { return cs.find((c) => c.pid === h.d.game.drawerId)!; }
export function pickFirst(h: Harness, cs: TClient[]): string {
  const dr = drawerOf(h, cs);
  dr.send({ t: 'pick', i: 0 });
  return h.d.game.word!;
}
