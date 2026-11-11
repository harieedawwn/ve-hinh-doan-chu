// GameClient: framework-agnostic connection + canvas sync layer (used by the debug page and the load-test bots).
// Handles hello/reconnect with a session token, clock offset estimation, canvas snapshots/relays and drawer batching.

import { DRAW_BATCH_MS, MAX_OPS_PER_BATCH, MAX_POINTS_PER_BATCH } from '../../shared/constants.ts';
import type { CanvasEngine } from '../../shared/canvas/engine.ts';
import { OpLog } from '../../shared/canvas/oplog.ts';
import type { Playback } from '../../shared/canvas/playback.ts';
import type { Op } from '../../shared/canvas/ops.ts';
import type { ClientMsg, RoomView, SecretView, ServerMsg } from '../../shared/protocol.ts';

export type Status = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface ChatLine { ch: 'all' | 'team' | 'sys' | 'self' | 'local'; from?: string; name?: string; text: string; code?: string; at: number }

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

export interface ClientOptions {
  /** ws(s) URL of the room, e.g. wss://host/ws/ABCDE */
  url: string;
  code: string;
  name: string;
  avatar?: number;
  create?: boolean;
  storage?: StorageLike;
  WebSocketImpl?: new (url: string) => WebSocket;
  now?: () => number;
  autoReconnect?: boolean;
  /** extra headers are not possible in browsers; node bots pass them through WebSocketImpl wrappers */
}

type Events = {
  change: () => void;
  draw: (n: number, ops: Op[]) => void;
  canvas: () => void;
  message: (m: ServerMsg) => void;
  status: (s: Status) => void;
  fatal: (code: string, msg: string) => void;
};

export class GameClient {
  status: Status = 'idle';
  room: RoomView | null = null;
  you: string | null = null;
  token: string | null = null;
  secret: SecretView | null = null;
  customWords: string[] = [];
  chat: ChatLine[] = [];
  closeHint = 0; // incremented when the server says "gần đúng"
  lastGuessPts = 0;
  log = new OpLog();
  engine: CanvasEngine | null = null;
  playback: Playback | null = null;
  offset = 0;       // serverNow = now + offset
  rtt = 0;
  fatal: { code: string; msg: string } | null = null;
  resyncs = 0;
  stats = { rxMsgs: 0, rxBytes: 0, txMsgs: 0, txBytes: 0, reconnects: 0, gaps: 0 };

  private o: ClientOptions;
  private ws: WebSocket | null = null;
  private listeners: { [K in keyof Events]?: Events[K][] } = {};
  private pendingPages: Op[][] = [];
  private outbox: Op[] = [];
  private lastFlush = 0;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private kaTimer: ReturnType<typeof setInterval> | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private samples: { rtt: number; off: number }[] = [];
  private attempt = 0;
  private stopped = false;
  private resyncAsked = false;

  constructor(o: ClientOptions) {
    this.o = o;
    try { this.token = o.storage?.getItem('vhdc:' + o.code) ?? null; } catch { /* storage blocked */ }
  }

  on<K extends keyof Events>(ev: K, fn: Events[K]): () => void {
    (this.listeners[ev] ??= [] as never).push(fn as never);
    return () => { this.listeners[ev] = (this.listeners[ev] as Events[K][]).filter((f) => f !== fn) as never; };
  }
  private emit<K extends keyof Events>(ev: K, ...a: Parameters<Events[K]>): void {
    for (const f of (this.listeners[ev] ?? []) as ((...x: unknown[]) => void)[]) f(...(a as unknown[]));
  }

  private nowMs(): number { return (this.o.now ?? Date.now)(); }
  /** Estimated server clock (ms epoch). Use for every countdown: remaining = room.phaseEndsAt - serverNow(). */
  serverNow(): number { return this.nowMs() + this.offset; }

  attachEngine(engine: CanvasEngine, playback: Playback): void {
    this.engine = engine; this.playback = playback; this.log = engine.log;
  }

  get isDrawer(): boolean { return !!this.room && this.room.drawerId === this.you && this.room.phase === 'drawing'; }
  get me() { return this.room?.players.find((p) => p.id === this.you); }

  // ------------------------------------------------------------ connection

  connect(): void {
    this.stopped = false;
    this.open(false);
  }

  /** Test aid: kill the socket without a clean close (as a phone losing signal would); auto-reconnect follows. */
  simulateDrop(): void {
    const ws = this.ws as unknown as { terminate?: () => void; close(): void } | null;
    if (ws?.terminate) ws.terminate(); else ws?.close();
  }

  close(): void {
    this.stopped = true;
    this.clearTimers();
    this.setStatus('closed');
    try { this.ws?.close(1000, 'bye'); } catch { /* ignore */ }
  }

  private open(reconnecting: boolean): void {
    this.setStatus(reconnecting ? 'reconnecting' : 'connecting');
    const Impl = this.o.WebSocketImpl ?? WebSocket;
    const ws = new Impl(this.o.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      const hello: ClientMsg = { t: 'hello', name: this.o.name, avatar: this.o.avatar ?? 0, token: this.token ?? undefined, create: this.o.create && !this.token ? true : undefined, v: 1 };
      this.send(hello);
    };
    ws.onmessage = (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : String(ev.data);
      this.stats.rxMsgs++; this.stats.rxBytes += data.length;
      if (data === 'ka') return;
      this.handle(JSON.parse(data) as ServerMsg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.clearTimers(false);
      if (this.stopped || this.fatal || this.o.autoReconnect === false) { this.setStatus('closed'); return; }
      this.stats.reconnects++;
      const delay = Math.min(8000, 400 * 2 ** this.attempt++) * (0.7 + Math.random() * 0.6);
      this.setStatus('reconnecting');
      this.timers.push(setTimeout(() => this.open(true), delay));
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private setStatus(s: Status): void {
    if (this.status === s) return;
    this.status = s; this.emit('status', s); this.emit('change');
  }

  private clearTimers(all = true): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.kaTimer) clearInterval(this.kaTimer);
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (all && this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
    this.kaTimer = this.syncTimer = null;
  }

  send(m: ClientMsg): void {
    if (this.ws?.readyState !== 1) return;
    const s = JSON.stringify(m);
    this.stats.txMsgs++; this.stats.txBytes += s.length;
    this.ws.send(s);
  }

  // ------------------------------------------------------------ incoming

  private handle(m: ServerMsg): void {
    this.emit('message', m);
    switch (m.t) {
      case 'welcome':
        this.you = m.you; this.token = m.token; this.room = m.room; this.secret = m.secret ?? null;
        try { this.o.storage?.setItem('vhdc:' + this.o.code, m.token); } catch { /* ignore */ }
        this.offset = m.room.now - this.nowMs();
        this.setStatus('open');
        this.startPings();
        break;
      case 'state':
        this.room = m.room;
        if (m.room.phase !== 'choosing' && m.room.phase !== 'drawing') this.secret = null;
        break;
      case 'secret': this.secret = m.secret; break;
      case 'customWords': this.customWords = m.words; break;
      case 'chat':
        this.chat.push({ ch: m.ch, from: m.from, name: m.name, text: m.text, code: m.code, at: this.nowMs() });
        if (this.chat.length > 300) this.chat.splice(0, this.chat.length - 300);
        break;
      case 'close': this.closeHint++; break;
      case 'guessOk': this.lastGuessPts = m.pts; break;
      case 'draw': this.onRelay(m.n, m.ops, m.span); break;
      case 'canvas': this.onCanvas(m); break;
      case 'sync': this.onSync(m.n, m.hash); break;
      case 'drawReject': this.outbox = []; break; // the server follows up with a full canvas
      case 'pong': this.onPong(m.c, m.s); break;
      case 'notice':
        this.chat.push({ ch: 'local', text: m.msg, code: m.code, at: this.nowMs() });
        break;
      case 'error':
        this.fatal = { code: m.code, msg: m.msg }; this.emit('fatal', m.code, m.msg);
        break;
      case 'kicked':
        this.fatal = { code: 'kicked', msg: m.msg }; this.emit('fatal', 'kicked', m.msg);
        break;
    }
    // draw relays / pongs / syncs are high-rate and never change anything the UI renders
    if (m.t !== 'draw' && m.t !== 'pong' && m.t !== 'sync' && m.t !== 'canvas') this.emit('change');
  }

  private onRelay(n: number, ops: Op[], span: number): void {
    if (n !== this.log.length) { this.stats.gaps++; this.requestResync(); return; }
    const err = this.playback ? this.playback.enqueue(ops, span, this.nowMs()) : this.log.tryAppend(ops);
    if (err) { this.requestResync(); return; }
    this.emit('draw', n, ops);
  }

  private onCanvas(m: Extract<ServerMsg, { t: 'canvas' }>): void {
    if (m.reset) this.pendingPages = [];
    this.pendingPages.push(m.ops);
    if (!m.last) return;
    const all = this.pendingPages.flat();
    this.pendingPages = [];
    this.outbox = [];
    if (this.engine) { this.playback?.clear(); const e = this.engine.load(all); if (e) return this.requestResync(); }
    else { const e = this.log.load(all); if (e) return this.requestResync(); }
    this.resyncAsked = false;
    if (this.log.hash !== m.hash) this.requestResync();
    this.emit('canvas');
  }

  private onSync(n: number, hash: string): void {
    this.playback?.flush();
    if (this.isDrawer) return;
    if (this.log.length !== n || this.log.hash !== hash) this.requestResync();
  }

  requestResync(): void {
    if (this.resyncAsked) return;
    this.resyncAsked = true;
    this.resyncs++;
    this.send({ t: 'resync' });
    this.timers.push(setTimeout(() => { this.resyncAsked = false; }, 1500));
  }

  // ------------------------------------------------------------ clock sync / keep-alive

  private startPings(): void {
    this.samples = [];
    let i = 0;
    const burst = () => { this.send({ t: 'ping', c: this.nowMs() }); if (++i < 5) this.timers.push(setTimeout(burst, 150)); };
    burst();
    // plain keep-alive costs nothing (auto-response); clock re-sync only while a turn is running
    this.kaTimer = setInterval(() => { if (this.ws?.readyState === 1) this.ws.send('ka'); }, 25_000);
    this.syncTimer = setInterval(() => { if (this.room?.phase === 'drawing') this.send({ t: 'ping', c: this.nowMs() }); }, 60_000);
  }

  private onPong(c: number, s: number): void {
    const now = this.nowMs();
    const rtt = Math.max(0, now - c);
    this.samples.push({ rtt, off: s + rtt / 2 - now });
    if (this.samples.length > 8) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.rtt = best.rtt; this.offset = best.off;
  }

  // ------------------------------------------------------------ drawer API

  /** Queue ops: they render locally at once and go out in <= 40 ms batches. */
  draw(ops: Op[]): string | null {
    if (!this.isDrawer) return 'notDrawer';
    const err = this.engine ? this.engine.apply(ops) : this.log.tryAppend(ops);
    if (err) return err;
    this.outbox.push(...ops);
    if (!this.flushTimer) {
      this.lastFlush = this.nowMs();
      this.flushTimer = setInterval(() => this.flushOutbox(), DRAW_BATCH_MS);
    }
    return null;
  }

  flushOutbox(): void {
    if (!this.outbox.length) { if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; } return; }
    const now = this.nowMs();
    const span = Math.min(500, now - this.lastFlush);
    this.lastFlush = now;
    // split into protocol-sized batches (same ops, same order); the time span is shared between them
    const batches: Op[][] = [];
    let batch: Op[] = [], pts = 0;
    for (const op of this.outbox) {
      // ops are never split (the drawer's log must equal the server's); draw() already refused ops over the cap
      const u = op.k === 'm' ? op.p.length / 2 : 1;
      if (batch.length >= MAX_OPS_PER_BATCH || pts + u > MAX_POINTS_PER_BATCH) { batches.push(batch); batch = []; pts = 0; }
      batch.push(op); pts += u;
    }
    if (batch.length) batches.push(batch);
    this.outbox = [];
    for (const b of batches) this.send({ t: 'draw', ops: b, span: Math.round(span / batches.length) });
  }
}
