// Durable Object adapter: one instance per room. Uses the WebSocket Hibernation API, DO alarms and SQLite-backed storage.
// All game logic lives in RoomCore; this file only wires sockets, alarm and persistence to it.

import { DurableObject } from 'cloudflare:workers';
import { OPS_PERSIST_DEBOUNCE_MS, PERSIST_DEBOUNCE_MS } from '../shared/constants.ts';
import type { Op } from '../shared/canvas/ops.ts';
import { RoomCore, type Io, type RoomData } from './room-core.ts';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

interface Attachment { cid: string; pid: string | null }

const OPS_CHUNK = 200;

export class Room extends DurableObject<Env> implements Io {
  private core: RoomCore;
  private sockets = new Map<string, WebSocket>();
  private persistedOps = 0;          // ops already written to storage (count)
  private lastRoomJson = '';
  private roomTimer: ReturnType<typeof setTimeout> | null = null;
  private opsTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.core = new RoomCore(this, 'XXXXX');
    // Free keep-alive that does not wake the object: clients send "ka" every ~25 s.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ka', 'ka'));
    ctx.blockConcurrencyWhile(async () => {
      const got = await ctx.storage.get<RoomData | number>(['room', 'opsCount']);
      const data = (got.get('room') as RoomData | undefined) ?? null;
      const count = (got.get('opsCount') as number | undefined) ?? 0;
      const ops: Op[] = [];
      if (data && count > 0) {
        const keys: string[] = [];
        for (let i = 0; i * OPS_CHUNK < count; i++) keys.push('ops:' + i);
        const chunks = await ctx.storage.get<Op[]>(keys);
        for (const k of keys) ops.push(...(chunks.get(k) ?? []));
      }
      this.persistedOps = ops.length;
      if (data) { this.core.code = data.code; this.lastRoomJson = JSON.stringify(data); }
      const conns: { cid: string; pid: string | null }[] = [];
      for (const ws of ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as Attachment | null;
        if (!a) continue;
        this.sockets.set(a.cid, ws);
        conns.push({ cid: a.cid, pid: a.pid });
      }
      this.core.restore(data, ops, conns);
      console.log(`[room ${data?.code ?? '?'}] woke: players=${data?.players.length ?? 0} sockets=${conns.length} ops=${ops.length}`);
    });
  }

  // ---------------------------------------------------------------- HTTP / WebSocket entry

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('x-probe')) return new Response('ok');
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const code = request.headers.get('x-room-code');
    if (!code) return new Response('Missing room code', { status: 400 });
    if (!this.core.serialize()) this.core.code = code;
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const cid = crypto.randomUUID().slice(0, 12);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ cid, pid: null } satisfies Attachment);
    this.sockets.set(cid, server);
    this.core.onOpen(cid);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a) return;
    this.core.onMessage(a.cid, message);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.dropSocket(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason.slice(0, 100)); } catch { /* already closed */ }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.dropSocket(ws);
  }

  private dropSocket(ws: WebSocket): void {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a) return;
    if (this.sockets.get(a.cid) === ws) this.sockets.delete(a.cid);
    this.core.onClose(a.cid);
  }

  async alarm(): Promise<void> {
    this.core.onAlarm();
  }

  // ---------------------------------------------------------------- Io

  now(): number { return Date.now(); }
  random(): number { return Math.random(); }
  token(): string {
    const b = new Uint8Array(18);
    crypto.getRandomValues(b);
    return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!);
  }

  send(cid: string, data: string): void {
    const ws = this.sockets.get(cid);
    if (!ws) return;
    try { ws.send(data); } catch { /* socket closing; the close handler cleans up */ }
  }

  close(cid: string, code: number, reason: string): void {
    const ws = this.sockets.get(cid);
    if (!ws) return;
    // Closing ourselves does not always raise webSocketClose, so release the player here too.
    this.sockets.delete(cid);
    try { ws.close(code, reason.slice(0, 100)); } catch { /* ignore */ }
    this.core.onClose(cid);
  }

  bind(cid: string, pid: string | null): void {
    const ws = this.sockets.get(cid);
    if (ws) { try { ws.serializeAttachment({ cid, pid } satisfies Attachment); } catch { /* closed */ } }
  }

  setAlarm(at: number | null): void {
    const p = at === null ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(Math.max(at, Date.now() + 1));
    p.catch(() => { this.core.invalidateAlarm(); /* the next event writes it again */ });
  }

  requestFlush(delayMs: number): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; this.core.flushState(); }, Math.max(1, delayMs));
  }

  persist(kind: 'room' | 'ops' | 'now'): void {
    if (kind === 'now') { void this.writeRoom(); void this.writeOps(); return; }
    if (kind === 'room' && !this.roomTimer) this.roomTimer = setTimeout(() => { this.roomTimer = null; void this.writeRoom(); }, PERSIST_DEBOUNCE_MS);
    if (kind === 'ops' && !this.opsTimer) this.opsTimer = setTimeout(() => { this.opsTimer = null; void this.writeOps(); }, OPS_PERSIST_DEBOUNCE_MS);
  }

  wipe(): void {
    for (const t of [this.roomTimer, this.opsTimer, this.flushTimer]) if (t) clearTimeout(t);
    this.roomTimer = this.opsTimer = this.flushTimer = null;
    this.persistedOps = 0; this.lastRoomJson = '';
    void this.ctx.storage.deleteAll();
    void this.ctx.storage.deleteAlarm();
  }

  private async writeRoom(): Promise<void> {
    const data = this.core.serialize();
    if (!data) return;
    const json = JSON.stringify(data);
    if (json === this.lastRoomJson) return; // unchanged: no rows written
    this.lastRoomJson = json;
    await this.ctx.storage.put('room', data);
  }

  private async writeOps(): Promise<void> {
    const log = this.core.ops.ops;
    const n = log.length, prev = this.persistedOps;
    if (n === prev) return;
    const put: Record<string, unknown> = { opsCount: n };
    if (n < prev) {
      // the log was reset (new turn): drop chunks that are no longer used
      const del: string[] = [];
      for (let i = Math.ceil(n / OPS_CHUNK); i * OPS_CHUNK < prev; i++) del.push('ops:' + i);
      if (del.length) await this.ctx.storage.delete(del);
    }
    for (let i = Math.floor(Math.min(n, prev) / OPS_CHUNK); i * OPS_CHUNK < n; i++) put['ops:' + i] = log.slice(i * OPS_CHUNK, (i + 1) * OPS_CHUNK);
    this.persistedOps = n;
    await this.ctx.storage.put(put);
  }
}
