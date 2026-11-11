// RoomCore: the authoritative game state machine for one room. Pure TypeScript with an injected Io
// (clock, randomness, sockets, alarm, persistence) so it runs identically inside a Durable Object and in unit tests.

import {
  AVATAR_COUNT, CHAT_MAX_LEN, DRAWER_GRACE_MS, HARD_MAX_PLAYERS, HOST_GRACE_MS, MAX_DRAW_MSG_LEN,
  MIN_PLAYERS_TO_START, NAME_MAX_LEN, PROTOCOL_VERSION, RATE, RECONNECT_GRACE_MS, REVEAL_MS, ROOM_EXPIRE_MS,
  SNAPSHOT_PAGE_OPS, STATE_THROTTLE_MS,
} from '../shared/constants.ts';
import { OpLog } from '../shared/canvas/oplog.ts';
import type { Op } from '../shared/canvas/ops.ts';
import {
  applySettingsPatch, DEFAULT_SETTINGS, isParseError, LIVE_SETTING_KEYS, parseClientMessage,
  type ClientMsg, type ChatChannel, type PlayerView, type PodiumEntry, type RevealView, type RoomView,
  type PublicSettings, type SecretView, type ServerMsg, type Settings, type TurnEndReason,
} from '../shared/protocol.ts';
import { buildMask, cleanText, judgeGuess, leaksWord, maskableIndexes } from '../shared/text.ts';
import { builtinPool, pickWords, wordKey } from '../shared/words/index.ts';

// ------------------------------------------------------------------------------------------ types

export interface Io {
  now(): number;
  random(): number;
  token(): string;
  send(cid: string, data: string): void;
  close(cid: string, code: number, reason: string): void;
  /** Schedule the single DO alarm (null = none). */
  setAlarm(at: number | null): void;
  /** Ask the host to persist: 'room' debounced, 'ops' debounced (slower), 'now' immediately. */
  persist(kind: 'room' | 'ops' | 'now'): void;
  /** Ask the host to call core.flushState() after delayMs. */
  requestFlush(delayMs: number): void;
  /** Delete all stored data of the room. */
  wipe(): void;
}

export interface PlayerRec {
  id: string; token: string; name: string; avatar: number; score: number; joinedAt: number;
  muted: boolean; offlineSince: number | null; drawn: number; lastDrew: number;
  guessedAt: number | null; delta: number;
}

export interface GameRec {
  turnNo: number;
  drawerId: string | null;
  word: string | null;
  choices: string[];
  revealed: number[];
  hintTimes: number[];
  hintsTotal: number;
  hintsGiven: number;
  guessOrder: string[];
  usedWords: string[];
  endMode: 'rounds' | 'turns';
}

export interface RoomData {
  v: 1;
  code: string;
  createdAt: number;
  rev: number;
  phase: import('../shared/protocol.ts').Phase;
  settings: Settings;
  players: PlayerRec[];
  hostId: string | null;
  nextPid: number;
  banned: string[];
  game: GameRec;
  phaseStartedAt: number | null;
  paused: { at: number; remaining: Record<string, number> } | null;
  reveal: RevealView | null;
  podium: PodiumEntry[] | null;
  /** named deadlines (epoch ms): phase, hint, drawerGone, hostGone, expire, seat:<pid> */
  timers: Record<string, number>;
}

class Bucket {
  private tokens: number; private last: number; private cap: number; private perSec: number;
  constructor(cap: number, perSec: number, now: number) { this.cap = cap; this.perSec = perSec; this.tokens = cap; this.last = now; }
  take(now: number): boolean {
    this.tokens = Math.min(this.cap, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    return false;
  }
}

interface Conn {
  pid: string | null;
  openedAt: number;
  chat: Bucket; draw: Bucket; gen: Bucket;
  drops: number;
}

const msgs = {
  noRoom: 'Không tìm thấy phòng này.',
  exists: 'Mã phòng đã được dùng, hãy thử lại.',
  full: 'Phòng đã đầy.',
  locked: 'Phòng đã bị khóa.',
  noLate: 'Phòng không cho vào khi ván đang chơi.',
  banned: 'Bạn đã bị mời ra khỏi phòng này.',
  notHost: 'Chỉ chủ phòng mới làm được việc này.',
  badMsg: 'Tin nhắn không hợp lệ.',
  tooFast: 'Bạn thao tác quá nhanh.',
  muted: 'Bạn đã bị tắt chat.',
  noWord: 'Đừng để lộ từ khóa nhé!',
  needPlayers: 'Cần ít nhất 2 người để bắt đầu.',
  needDrawer: 'Cần thêm ít nhất một người chơi để vẽ.',
  needCustom: 'Bạn cần nhập danh sách từ riêng trước.',
  replaced: 'Bạn đã mở phòng ở nơi khác.',
  helloTimeout: 'Hết thời gian chờ đăng nhập.',
  wrongPhase: 'Không làm được việc này lúc này.',
  kicked: 'Bạn đã bị mời ra khỏi phòng.',
};

const EXPIRE = 'expire', HOSTGONE = 'hostGone', DRAWERGONE = 'drawerGone', PHASE = 'phase', HINT = 'hint';

function blankGame(): GameRec {
  return {
    turnNo: 0, drawerId: null, word: null, choices: [], revealed: [], hintTimes: [], hintsTotal: 0,
    hintsGiven: 0, guessOrder: [], usedWords: [], endMode: 'rounds',
  };
}

// ------------------------------------------------------------------------------------------ core

export class RoomCore {
  data: RoomData | null = null;
  readonly ops = new OpLog();
  private conns = new Map<string, Conn>();
  private pidConn = new Map<string, string>();
  private dirty = 0; // 0 clean, 1 throttled, 2 immediate
  private lastStateAt = 0;
  private flushPending = false;
  private lastAlarm: number | null | undefined = undefined;
  private memTimers = new Map<string, number>(); // non-persisted deadlines: hello:<cid>
  private io: Io;
  readonly code: string;

  constructor(io: Io, code: string) { this.io = io; this.code = code; }

  // ------------------------------------------------------------------ persistence

  serialize(): RoomData | null { return this.data; }

  /** Restore after hibernation / restart. `conns` lists live sockets with the player they belong to. */
  restore(data: RoomData | null, ops: Op[], conns: { cid: string; pid: string | null }[]): void {
    this.data = data;
    this.ops.reset();
    if (data && ops.length) {
      const err = this.ops.load(ops);
      if (err) this.ops.reset();
    }
    const now = this.io.now();
    for (const c of conns) {
      this.conns.set(c.cid, this.newConn(now, c.pid));
      if (c.pid && data?.players.some((p) => p.id === c.pid)) this.pidConn.set(c.pid, c.cid);
      else if (!c.pid) this.memTimers.set('hello:' + c.cid, now + 15_000);
    }
    if (data) {
      // players whose socket did not survive are offline; make sure they have a seat timer
      for (const p of data.players) {
        if (!this.pidConn.has(p.id) && p.offlineSince === null) { p.offlineSince = now; data.timers['seat:' + p.id] = now + RECONNECT_GRACE_MS; }
      }
      this.afterEvent();
    }
  }

  private newConn(now: number, pid: string | null = null): Conn {
    return { pid, openedAt: now, chat: new Bucket(RATE.chat.capacity, RATE.chat.perSec, now), draw: new Bucket(RATE.draw.capacity, RATE.draw.perSec, now), gen: new Bucket(RATE.general.capacity, RATE.general.perSec, now), drops: 0 };
  }

  // ------------------------------------------------------------------ socket entry points

  onOpen(cid: string): void {
    const now = this.io.now();
    this.conns.set(cid, this.newConn(now));
    this.memTimers.set('hello:' + cid, now + 15_000);
    this.afterEvent();
  }

  onClose(cid: string): void {
    const c = this.conns.get(cid);
    this.conns.delete(cid);
    this.memTimers.delete('hello:' + cid);
    if (c?.pid && this.pidConn.get(c.pid) === cid) {
      this.pidConn.delete(c.pid);
      this.playerOffline(c.pid);
    }
    this.afterEvent();
  }

  onMessage(cid: string, raw: unknown): void {
    const conn = this.conns.get(cid);
    if (!conn) return;
    const now = this.io.now();
    if (typeof raw === 'string' && raw.length > MAX_DRAW_MSG_LEN) { this.io.close(cid, 1009, 'too big'); return; }
    const m = parseClientMessage(raw);
    if (isParseError(m)) { this.notice(cid, 'badMsg'); if (++conn.drops > 400) this.io.close(cid, 1008, 'bad'); return; }
    // draw batches have their own (larger) bucket; everything else shares the general one
    if (m.t !== 'draw' && !conn.gen.take(now)) { if (++conn.drops > 400) this.io.close(cid, 1008, 'rate'); return; }
    try {
      this.dispatch(cid, conn, m, now);
    } finally {
      this.afterEvent();
    }
  }

  /** Alarm handler: run every due timer. */
  onAlarm(): void {
    const now = this.io.now();
    for (let guard = 0; guard < 200; guard++) {
      const due = this.nextDue(now);
      if (!due) break;
      this.fire(due, now);
    }
    this.afterEvent();
  }

  /** Called by the host after requestFlush. */
  flushState(): void {
    this.flushPending = false;
    if (this.dirty) this.sendState();
    this.rescheduleAlarm();
  }

  // ------------------------------------------------------------------ dispatch

  private dispatch(cid: string, conn: Conn, m: ClientMsg, now: number): void {
    if (m.t === 'hello') return this.onHello(cid, conn, m, now);
    if (m.t === 'ping') { this.sendRaw(cid, { t: 'pong', c: m.c, s: now }); return; }
    const d = this.data;
    const p = conn.pid && d ? d.players.find((x) => x.id === conn.pid) : undefined;
    if (!d || !p) { this.io.close(cid, 4000, 'hello first'); return; }
    switch (m.t) {
      case 'chat': return this.onChat(p, conn, m.text, now);
      case 'draw': return this.onDraw(p, conn, m, now);
      case 'pick': return this.onPick(p, m);
      case 'settings': return this.onSettings(p, m.patch);
      case 'start': return this.onStart(p);
      case 'again': return this.onAgain(p);
      case 'kick': return this.onKick(p, m.id);
      case 'mute': return this.onMute(p, m.id, m.on);
      case 'host': return this.onHostTransfer(p, m.id);
      case 'pause': return this.onPause(p);
      case 'skip': return this.onSkip(p);
      case 'end': return this.onEnd(p);
      case 'leave': return this.removePlayer(p.id, 'leave');
      case 'resync': this.sendCanvas(p.id); return;
    }
  }

  // ------------------------------------------------------------------ hello / join

  private onHello(cid: string, conn: Conn, m: Extract<ClientMsg, { t: 'hello' }>, now: number): void {
    if (conn.pid) return; // already in
    let d = this.data;
    const fail = (code: keyof typeof msgs): void => {
      this.sendRaw(cid, { t: 'error', code, msg: msgs[code] });
      this.io.close(cid, 4003, code);
    };
    // reconnect by token
    let p = d && m.token ? d.players.find((x) => x.token === m.token) : undefined;
    if (!p && d && m.token && d.banned.includes(m.token)) return fail('banned');
    if (!d) {
      if (!m.create) return fail('noRoom');
      d = this.createRoom(now);
    } else if (m.create && !p && d.players.length > 0) {
      return fail('exists');
    } else if (m.create && d.players.length === 0) {
      d = this.createRoom(now);
    }
    let isNew = false;
    if (!p) {
      isNew = true;
      if (d.settings.locked) return fail('locked');
      if (d.players.length >= Math.min(d.settings.maxPlayers, HARD_MAX_PLAYERS)) return fail('full');
      if (d.phase !== 'lobby' && !d.settings.allowLateJoin) return fail('noLate');
      p = this.addPlayer(d, m.name, m.avatar, now);
    } else {
      // reconnect: kick the previous socket if still present
      const old = this.pidConn.get(p.id);
      if (old && old !== cid) {
        this.sendRaw(old, { t: 'error', code: 'replaced', msg: msgs.replaced });
        this.conns.get(old)!.pid = null;
        this.io.close(old, 4001, 'replaced');
      }
      if (m.name) p.name = this.uniqueName(d, m.name, p.id);
      p.avatar = m.avatar;
    }
    conn.pid = p.id;
    this.memTimers.delete('hello:' + cid);
    this.pidConn.set(p.id, cid);
    p.offlineSince = null;
    delete d.timers['seat:' + p.id];
    delete d.timers[EXPIRE];
    if (d.hostId === p.id) delete d.timers[HOSTGONE];
    if (d.game.drawerId === p.id) delete d.timers[DRAWERGONE];
    if (!d.hostId) d.hostId = p.id;
    this.maybeTransferHostOnJoin(now);
    // welcome + current picture
    this.sendRaw(cid, { t: 'welcome', you: p.id, token: p.token, v: PROTOCOL_VERSION, room: this.view(), secret: this.secretFor(p.id) });
    if (d.hostId === p.id) this.sendCustomWords(p.id);
    if (d.phase === 'drawing' || d.phase === 'reveal' || d.phase === 'choosing') this.sendCanvas(p.id);
    if (isNew) this.sys(`${p.name} đã vào phòng`, 'join', p.id);
    this.touch(true);
    this.io.persist('now');
  }

  private createRoom(now: number): RoomData {
    const d: RoomData = {
      v: 1, code: this.code, createdAt: now, rev: 0, phase: 'lobby',
      settings: { ...DEFAULT_SETTINGS, categories: DEFAULT_SETTINGS.categories.slice(), difficulties: DEFAULT_SETTINGS.difficulties.slice(), customWords: [] },
      players: [], hostId: null, nextPid: 1, banned: [], game: blankGame(),
      phaseStartedAt: null, paused: null, reveal: null, podium: null, timers: {},
    };
    this.data = d;
    this.ops.reset();
    return d;
  }

  private addPlayer(d: RoomData, name: string, avatar: number, now: number): PlayerRec {
    const id = 'p' + d.nextPid++;
    const eligible = this.eligibleDrawers(true);
    const p: PlayerRec = {
      id, token: this.io.token(), name: '', avatar: ((avatar % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT, score: 0, joinedAt: now,
      muted: false, offlineSince: null, drawn: eligible.length ? Math.min(...eligible.map((e) => e.drawn)) : 0, lastDrew: -1, guessedAt: null, delta: 0,
    };
    p.name = this.uniqueName(d, name, id);
    d.players.push(p);
    return p;
  }

  private uniqueName(d: RoomData, wanted: string, selfId: string): string {
    const base = cleanText(wanted, NAME_MAX_LEN) || 'Người chơi';
    const taken = new Set(d.players.filter((x) => x.id !== selfId).map((x) => x.name.toLowerCase()));
    let n = base, i = 2;
    while (taken.has(n.toLowerCase())) n = `${base.slice(0, NAME_MAX_LEN - 3)} ${i++}`;
    return n;
  }

  private maybeTransferHostOnJoin(now: number): void {
    const d = this.data!;
    const h = d.players.find((x) => x.id === d.hostId);
    if (!h || (h.offlineSince !== null && now - h.offlineSince >= HOST_GRACE_MS)) this.transferHost(now);
  }

  // ------------------------------------------------------------------ leaving / presence

  private playerOffline(pid: string): void {
    const d = this.data;
    const p = d?.players.find((x) => x.id === pid);
    if (!d || !p) return;
    const now = this.io.now();
    p.offlineSince = now;
    d.timers['seat:' + pid] = now + RECONNECT_GRACE_MS;
    if (d.hostId === pid) d.timers[HOSTGONE] = now + HOST_GRACE_MS;
    if (d.game.drawerId === pid && (d.phase === 'choosing' || d.phase === 'drawing') && !d.paused) d.timers[DRAWERGONE] = now + DRAWER_GRACE_MS;
    if (this.connectedCount() === 0) d.timers[EXPIRE] ??= now + ROOM_EXPIRE_MS;
    this.checkAllGuessed();
    this.touch();
    this.io.persist('room');
  }

  private removePlayer(pid: string, why: 'leave' | 'kick' | 'expired'): void {
    const d = this.data;
    const idx = d ? d.players.findIndex((x) => x.id === pid) : -1;
    if (!d || idx < 0) return;
    const p = d.players[idx];
    const now = this.io.now();
    const wasDrawer = d.game.drawerId === pid && (d.phase === 'choosing' || d.phase === 'drawing');
    d.players.splice(idx, 1);
    delete d.timers['seat:' + pid];
    const cid = this.pidConn.get(pid);
    this.pidConn.delete(pid);
    if (cid) {
      const c = this.conns.get(cid);
      if (c) c.pid = null;
      if (why === 'kick') { this.sendRaw(cid, { t: 'kicked', msg: msgs.kicked }); }
      this.io.close(cid, why === 'kick' ? 4002 : 1000, why);
    }
    if (why === 'leave') this.sys(`${p.name} đã rời phòng`, 'leave', pid);
    if (why === 'kick') this.sys(`${p.name} đã bị mời ra khỏi phòng`, 'kick', pid);
    if (d.hostId === pid) { d.hostId = null; this.transferHost(now); }
    if (wasDrawer) this.endTurn('drawerLeft');
    else this.checkAllGuessed();
    if (d.players.length === 0) {
      // nobody left: back to a fresh lobby, keep the room code for 30 minutes
      this.resetToLobby(false);
      d.timers[EXPIRE] ??= now + ROOM_EXPIRE_MS;
    } else if (this.connectedCount() === 0) d.timers[EXPIRE] ??= now + ROOM_EXPIRE_MS;
    this.touch(true);
    this.io.persist('now');
  }

  private transferHost(now: number): void {
    const d = this.data!;
    const cand = d.players.filter((x) => this.pidConn.has(x.id)).sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id, 'en', { numeric: true }))[0];
    delete d.timers[HOSTGONE];
    if (!cand || cand.id === d.hostId) return;
    d.hostId = cand.id;
    this.sendCustomWords(cand.id);
    this.sys(`${cand.name} là chủ phòng mới`, 'host', cand.id);
    // hostOnly: the drawer role follows the host; current turn (if the old host drew) is handled by drawerGone
    void now;
    this.touch(true);
  }

  private connectedCount(): number { return this.pidConn.size; }

  // ------------------------------------------------------------------ chat & guesses

  private onChat(p: PlayerRec, conn: Conn, raw: string, now: number): void {
    const d = this.data!;
    if (!conn.chat.take(now)) { if (++conn.drops > 400) this.io.close(this.pidConn.get(p.id)!, 1008, 'rate'); return; }
    const text = cleanText(raw, CHAT_MAX_LEN);
    if (!text) return;
    const g = d.game;
    const live = d.phase === 'drawing' && g.word !== null;
    if (!live) {
      if (p.muted) return this.notice(this.pidConn.get(p.id)!, 'muted');
      return this.chatAll(p, text);
    }
    const word = g.word!;
    const isDrawer = g.drawerId === p.id;
    const cid = this.pidConn.get(p.id)!;
    if (isDrawer) {
      if (leaksWord(text, word)) return this.notice(cid, 'noWord');
      if (p.muted) return this.notice(cid, 'muted');
      return this.chatTeam(p, text);
    }
    if (this.isSpectator(p)) {
      if (leaksWord(text, word)) return this.notice(cid, 'noWord');
      if (p.muted) return this.notice(cid, 'muted');
      return this.chatAll(p, text);
    }
    if (p.guessedAt !== null) {
      if (p.muted) return this.notice(cid, 'muted');
      return this.chatTeam(p, text);
    }
    if (d.paused) { // no guessing while paused; plain chat must not leak the word
      if (leaksWord(text, word)) return this.notice(cid, 'noWord');
      if (p.muted) return this.notice(cid, 'muted');
      return this.chatAll(p, text);
    }
    // a guess
    let verdict = judgeGuess(text, word, d.settings.accentInsensitive);
    if (verdict === 'wrong' && leaksWord(text, word)) verdict = 'close';
    if (verdict === 'correct') return this.awardGuess(p, now);
    // visible only to the guesser (+ drawer and those who already guessed, who know the word)
    this.sendRaw(cid, { t: 'chat', ch: 'self', from: p.id, name: p.name, text });
    if (verdict === 'close') {
      if (d.settings.showClose) this.sendRaw(cid, { t: 'close' });
      this.toTeam(p, { t: 'chat', ch: 'team', from: p.id, name: p.name, text, code: 'close' });
      return;
    }
    if (p.muted) return;
    this.bcast({ t: 'chat', ch: 'all', from: p.id, name: p.name, text }, p.id);
  }

  private chatAll(p: PlayerRec, text: string): void {
    this.bcast({ t: 'chat', ch: 'all', from: p.id, name: p.name, text });
  }

  private chatTeam(p: PlayerRec, text: string): void {
    const m: ServerMsg = { t: 'chat', ch: 'team', from: p.id, name: p.name, text };
    this.sendRaw(this.pidConn.get(p.id)!, m);
    this.toTeam(p, m);
  }

  /** Send to the drawer and everyone who already guessed (never to players still guessing). */
  private toTeam(from: PlayerRec, m: ServerMsg): void {
    const d = this.data!;
    const s = JSON.stringify(m);
    for (const q of d.players) {
      if (q.id === from.id) continue;
      if (q.id === d.game.drawerId || q.guessedAt !== null) {
        const cid = this.pidConn.get(q.id);
        if (cid) this.io.send(cid, s);
      }
    }
  }

  private awardGuess(p: PlayerRec, now: number): void {
    const d = this.data!, g = d.game;
    const total = d.settings.drawTime * 1000;
    const remaining = Math.max(0, (d.timers[PHASE] ?? now) - now);
    const order = g.guessOrder.length;
    const pts = 100 + Math.round(300 * Math.min(1, remaining / total)) + Math.max(0, 50 - 10 * order);
    p.score += pts; p.delta = pts; p.guessedAt = now;
    g.guessOrder.push(p.id);
    this.sendRaw(this.pidConn.get(p.id)!, { t: 'guessOk', pts });
    this.sys(`${p.name} đã đoán đúng!`, 'guessed', p.id);
    this.touch();
    if (!this.checkAllGuessed()) this.io.persist('room');
  }

  // ------------------------------------------------------------------ drawing

  private onDraw(p: PlayerRec, conn: Conn, m: Extract<ClientMsg, { t: 'draw' }>, now: number): void {
    const d = this.data!;
    if (d.phase !== 'drawing' || d.paused || d.game.drawerId !== p.id) return;
    if (!conn.draw.take(now)) { if (++conn.drops > 800) this.io.close(this.pidConn.get(p.id)!, 1008, 'rate'); return; }
    const n0 = this.ops.length;
    const err = this.ops.tryAppend(m.ops);
    if (err) {
      this.sendRaw(this.pidConn.get(p.id)!, { t: 'drawReject', code: err, n: this.ops.length });
      this.sendCanvas(p.id);
      return;
    }
    const span = Math.max(0, Math.min(500, Math.round(m.span)));
    this.bcast({ t: 'draw', n: n0, ops: m.ops, span }, p.id);
    this.io.persist('ops');
  }

  private sendCanvas(pid: string): void {
    const cid = this.pidConn.get(pid);
    if (!cid) return;
    const ops = this.ops.ops, hash = this.ops.hash, total = ops.length;
    if (total === 0) { this.sendRaw(cid, { t: 'canvas', n: 0, ops: [], total: 0, hash, reset: true, last: true }); return; }
    let i = 0;
    while (i < total) {
      let j = i, size = 0;
      while (j < total && j - i < SNAPSHOT_PAGE_OPS && size < 120_000) { const o = ops[j]; size += o.k === 'm' ? o.p.length * 5 + 10 : 40; j++; }
      this.sendRaw(cid, { t: 'canvas', n: i, ops: ops.slice(i, j), total, hash, reset: i === 0, last: j >= total });
      i = j;
    }
  }

  private broadcastCanvasReset(): void {
    this.bcast({ t: 'canvas', n: 0, ops: [], total: 0, hash: this.ops.hash, reset: true, last: true });
  }

  // ------------------------------------------------------------------ host actions

  private requireHost(p: PlayerRec): boolean {
    if (this.data!.hostId === p.id) return true;
    this.notice(this.pidConn.get(p.id)!, 'notHost');
    return false;
  }

  private onSettings(p: PlayerRec, patch: Record<string, unknown>): void {
    const d = this.data!;
    if (!this.requireHost(p)) return;
    d.settings = applySettingsPatch(d.settings, patch, d.phase === 'lobby' ? undefined : LIVE_SETTING_KEYS);
    this.sendCustomWords(p.id);
    this.touch(true);
    this.io.persist('room');
  }

  private onStart(p: PlayerRec): void {
    const d = this.data!;
    if (!this.requireHost(p)) return;
    if (d.phase !== 'lobby') return this.notice(this.pidConn.get(p.id)!, 'wrongPhase');
    const cid = this.pidConn.get(p.id)!;
    const conn = d.players.filter((x) => this.pidConn.has(x.id));
    if (conn.length < MIN_PLAYERS_TO_START) return this.notice(cid, 'needPlayers');
    if (d.settings.mode === 'hostMC' && conn.filter((x) => x.id !== d.hostId).length < 1) return this.notice(cid, 'needDrawer');
    if (d.settings.onlyCustom && d.settings.customWords.length === 0) return this.notice(cid, 'needCustom');
    for (const x of d.players) { x.score = 0; x.drawn = 0; x.lastDrew = -1; x.guessedAt = null; x.delta = 0; }
    d.game = blankGame();
    d.reveal = null; d.podium = null;
    d.game.endMode = this.resolveEndMode();
    this.sys('Ván mới bắt đầu!', 'start');
    this.nextTurn();
  }

  private resolveEndMode(): 'rounds' | 'turns' {
    const s = this.data!.settings;
    if (s.mode === 'hostOnly') return 'turns'; // one fixed drawer: "rounds" has no meaning
    if (s.endBy === 'rounds' || s.endBy === 'turns') return s.endBy;
    return this.data!.players.length > 12 ? 'turns' : 'rounds';
  }

  private onAgain(p: PlayerRec): void {
    const d = this.data!;
    if (!this.requireHost(p)) return;
    if (d.phase !== 'podium') return this.notice(this.pidConn.get(p.id)!, 'wrongPhase');
    this.resetToLobby(true);
  }

  private resetToLobby(keepPlayers: boolean): void {
    const d = this.data!;
    d.phase = 'lobby';
    d.game = blankGame(); d.reveal = null; d.podium = null; d.paused = null;
    for (const k of [PHASE, HINT, DRAWERGONE]) delete d.timers[k];
    d.phaseStartedAt = null;
    for (const x of d.players) { x.score = 0; x.drawn = 0; x.lastDrew = -1; x.guessedAt = null; x.delta = 0; }
    if (!keepPlayers) d.players = [];
    this.ops.reset();
    this.broadcastCanvasReset();
    this.touch(true);
    this.io.persist('now');
  }

  private onKick(p: PlayerRec, id: string): void {
    if (!this.requireHost(p)) return;
    const d = this.data!;
    const t = d.players.find((x) => x.id === id);
    if (!t || t.id === p.id) return;
    d.banned.push(t.token);
    this.removePlayer(id, 'kick');
  }

  private onMute(p: PlayerRec, id: string, on: boolean): void {
    if (!this.requireHost(p)) return;
    const t = this.data!.players.find((x) => x.id === id);
    if (!t || t.id === p.id) return;
    t.muted = on;
    this.touch(true);
    this.io.persist('room');
  }

  private onHostTransfer(p: PlayerRec, id: string): void {
    if (!this.requireHost(p)) return;
    const d = this.data!;
    const t = d.players.find((x) => x.id === id);
    if (!t || t.id === p.id || !this.pidConn.has(t.id)) return;
    d.hostId = t.id;
    delete d.timers[HOSTGONE];
    this.sendCustomWords(t.id);
    this.sys(`${t.name} là chủ phòng mới`, 'host', t.id);
    this.touch(true);
    this.io.persist('room');
  }

  private onPause(p: PlayerRec): void {
    const d = this.data!, now = this.io.now();
    if (!this.requireHost(p)) return;
    if (d.phase !== 'choosing' && d.phase !== 'drawing') return this.notice(this.pidConn.get(p.id)!, 'wrongPhase');
    if (!d.paused) {
      const remaining: Record<string, number> = {};
      for (const k of [PHASE, HINT, DRAWERGONE]) {
        if (d.timers[k] !== undefined) { remaining[k] = Math.max(0, d.timers[k] - now); delete d.timers[k]; }
      }
      d.paused = { at: now, remaining };
      this.sys('Chủ phòng đã tạm dừng trò chơi', 'pause');
    } else {
      const shift = now - d.paused.at;
      for (const [k, rem] of Object.entries(d.paused.remaining)) d.timers[k] = now + rem;
      d.game.hintTimes = d.game.hintTimes.map((t) => t + shift);
      d.paused = null;
      this.sys('Trò chơi tiếp tục', 'resume');
    }
    this.touch(true);
    this.io.persist('now');
  }

  private onSkip(p: PlayerRec): void {
    const d = this.data!;
    if (!this.requireHost(p)) return;
    if (d.phase !== 'choosing' && d.phase !== 'drawing') return this.notice(this.pidConn.get(p.id)!, 'wrongPhase');
    if (d.paused) this.unpause();
    this.endTurn('skipped');
  }

  private onEnd(p: PlayerRec): void {
    const d = this.data!;
    if (!this.requireHost(p)) return;
    if (d.phase === 'lobby' || d.phase === 'podium') return this.notice(this.pidConn.get(p.id)!, 'wrongPhase');
    d.paused = null;
    this.endGame();
  }

  private unpause(): void {
    const d = this.data!;
    if (!d.paused) return;
    const now = this.io.now(), shift = now - d.paused.at;
    for (const [k, rem] of Object.entries(d.paused.remaining)) d.timers[k] = now + rem;
    d.game.hintTimes = d.game.hintTimes.map((t) => t + shift);
    d.paused = null;
  }

  // ------------------------------------------------------------------ turn engine

  private isSpectator(p: PlayerRec): boolean {
    const d = this.data!;
    return d.settings.mode === 'hostMC' && d.hostId === p.id && !d.settings.hostGuesses;
  }

  private canDraw(p: PlayerRec): boolean {
    const d = this.data!;
    if (d.settings.mode === 'hostOnly') return d.hostId === p.id;
    if (d.settings.mode === 'hostMC') return d.hostId !== p.id;
    return true;
  }

  /** Players who may be picked to draw (optionally including offline ones). */
  private eligibleDrawers(includeOffline = false): PlayerRec[] {
    const d = this.data;
    if (!d) return [];
    return d.players.filter((p) => this.canDraw(p) && (includeOffline || this.pidConn.has(p.id)));
  }

  private pickDrawer(): PlayerRec | null {
    const el = this.eligibleDrawers();
    if (!el.length) return null;
    const min = Math.min(...el.map((p) => p.drawn));
    const pool = el.filter((p) => p.drawn === min);
    return pool[Math.floor(this.io.random() * pool.length)];
  }

  private shouldEndGame(): boolean {
    const d = this.data!, g = d.game;
    if (g.endMode === 'turns') return g.turnNo >= d.settings.turns;
    const el = this.eligibleDrawers();
    return el.length === 0 || Math.min(...el.map((p) => p.drawn)) >= d.settings.rounds;
  }

  private nextTurn(): void {
    const d = this.data!, g = d.game;
    // need a drawer and at least one guesser present
    const present = d.players.filter((p) => this.pidConn.has(p.id));
    if (present.length < MIN_PLAYERS_TO_START || this.shouldEndGame()) return this.endGame();
    const drawer = this.pickDrawer();
    if (!drawer) return this.endGame();
    g.turnNo++;
    g.drawerId = drawer.id; g.word = null; g.revealed = []; g.hintTimes = []; g.hintsGiven = 0; g.hintsTotal = 0; g.guessOrder = [];
    for (const x of d.players) { x.guessedAt = null; x.delta = 0; }
    d.reveal = null; d.paused = null;
    for (const k of [PHASE, HINT, DRAWERGONE]) delete d.timers[k];
    this.ops.reset();
    this.broadcastCanvasReset();
    g.choices = this.makeChoices();
    const direct = g.choices.length === 1 && d.settings.mode !== 'hostOnly';
    if (direct) return this.startDrawing(g.choices[0]);
    d.phase = 'choosing';
    d.phaseStartedAt = this.io.now();
    d.timers[PHASE] = d.phaseStartedAt + d.settings.chooseTime * 1000;
    this.sendSecret(drawer.id);
    this.touch(true);
    this.io.persist('now');
  }

  private makeChoices(): string[] {
    const d = this.data!, s = d.settings, g = d.game;
    const used = new Set(g.usedWords);
    let pool: string[];
    if (s.onlyCustom && s.customWords.length) pool = s.customWords;
    else pool = builtinPool(s.categories, s.difficulties).concat(s.customWords);
    const n = Math.min(s.wordChoices, pool.length);
    const words = pickWords(pool, n, used, () => this.io.random());
    g.usedWords = [...used];
    return words;
  }

  private onPick(p: PlayerRec, m: Extract<ClientMsg, { t: 'pick' }>): void {
    const d = this.data!, g = d.game;
    if (d.phase !== 'choosing' || g.drawerId !== p.id || d.paused) return;
    let word: string | undefined;
    if (typeof m.word === 'string' && m.word.trim() && d.settings.mode === 'hostOnly' && d.hostId === p.id) {
      word = cleanText(m.word, 40);
      if (word.length < 2) return this.notice(this.pidConn.get(p.id)!, 'badMsg');
    } else if (typeof m.i === 'number' && m.i >= 0 && m.i < g.choices.length) word = g.choices[m.i];
    if (!word) return;
    this.startDrawing(word);
  }

  private startDrawing(word: string): void {
    const d = this.data!, g = d.game, now = this.io.now();
    g.word = word.normalize('NFC');
    const k = wordKey(g.word);
    if (!g.usedWords.includes(k)) g.usedWords.push(k);
    g.revealed = [];
    const letters = maskableIndexes(g.word).length;
    g.hintsTotal = Math.min(d.settings.hints, Math.max(0, Math.floor((letters - 1) / 2)));
    const total = d.settings.drawTime * 1000;
    g.hintTimes = [];
    for (let i = 1; i <= g.hintsTotal; i++) g.hintTimes.push(now + Math.round((total * i) / (g.hintsTotal + 1)));
    g.hintsGiven = 0;
    d.phase = 'drawing';
    d.phaseStartedAt = now;
    d.timers[PHASE] = now + total;
    delete d.timers[DRAWERGONE];
    if (g.hintTimes.length) d.timers[HINT] = g.hintTimes[0]; else delete d.timers[HINT];
    this.sendSecret(g.drawerId!);
    this.touch(true);
    this.io.persist('now');
  }

  private doHint(): void {
    const d = this.data!, g = d.game;
    if (d.phase !== 'drawing' || !g.word) return;
    const hidden = maskableIndexes(g.word).filter((i) => !g.revealed.includes(i));
    if (hidden.length > 1) g.revealed.push(hidden[Math.floor(this.io.random() * hidden.length)]);
    g.hintsGiven++;
    g.hintTimes.shift();
    if (g.hintTimes.length) d.timers[HINT] = g.hintTimes[0]; else delete d.timers[HINT];
    this.touch(true);
  }

  /** True if the turn ended because everyone present has guessed. */
  private checkAllGuessed(): boolean {
    const d = this.data;
    if (!d || d.phase !== 'drawing' || !d.game.word || d.paused) return false;
    const guessers = d.players.filter((p) => p.id !== d.game.drawerId && !this.isSpectator(p) && this.pidConn.has(p.id));
    if (guessers.length === 0) {
      // nobody left to guess; if the drawer is alone the turn can't continue
      if (d.players.some((p) => p.id !== d.game.drawerId && !this.isSpectator(p) && p.guessedAt !== null)) { this.endTurn('allGuessed'); return true; }
      return false;
    }
    if (guessers.every((p) => p.guessedAt !== null)) { this.endTurn('allGuessed'); return true; }
    return false;
  }

  private endTurn(reason: TurnEndReason): void {
    const d = this.data!, g = d.game;
    if (d.phase !== 'choosing' && d.phase !== 'drawing') return;
    const drawer = d.players.find((p) => p.id === g.drawerId);
    const correct = d.players.filter((p) => p.guessedAt !== null).length;
    if (drawer) {
      const guessers = d.players.filter((p) => p.id !== drawer.id && !this.isSpectator(p) && (p.guessedAt !== null || this.pidConn.has(p.id))).length;
      const pts = correct > 0 ? Math.round((300 * correct) / Math.max(1, guessers)) : 0;
      drawer.score += pts; drawer.delta = pts;
      drawer.drawn++; drawer.lastDrew = g.turnNo;
    }
    d.reveal = {
      word: g.word, reason,
      deltas: d.players.filter((p) => p.delta > 0).map((p) => ({ id: p.id, delta: p.delta })),
    };
    d.phase = 'reveal';
    d.paused = null;
    d.phaseStartedAt = this.io.now();
    for (const k of [PHASE, HINT, DRAWERGONE]) delete d.timers[k];
    d.timers[PHASE] = d.phaseStartedAt + REVEAL_MS;
    this.bcast({ t: 'sync', n: this.ops.length, hash: this.ops.hash });
    this.touch(true);
    this.io.persist('now');
  }

  private endGame(): void {
    const d = this.data!;
    d.phase = 'podium';
    d.paused = null;
    for (const k of [PHASE, HINT, DRAWERGONE]) delete d.timers[k];
    d.phaseStartedAt = this.io.now();
    const sorted = d.players.slice().sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
    let rank = 0, prev = -1;
    d.podium = sorted.map((p, i) => {
      if (p.score !== prev) { rank = i + 1; prev = p.score; }
      return { id: p.id, name: p.name, avatar: p.avatar, score: p.score, rank };
    });
    d.reveal = null;
    this.sys('Trò chơi kết thúc!', 'end');
    this.touch(true);
    this.io.persist('now');
  }

  // ------------------------------------------------------------------ timers

  private nextDue(now: number): string | null {
    let best: string | null = null, bt = Infinity;
    const consider = (k: string, t: number): void => { if (t <= now && t < bt) { bt = t; best = k; } };
    if (this.data) for (const [k, t] of Object.entries(this.data.timers)) consider(k, t);
    for (const [k, t] of this.memTimers) consider(k, t);
    return best;
  }

  private nextDeadline(): number | null {
    let min = Infinity;
    if (this.data) for (const t of Object.values(this.data.timers)) if (t < min) min = t;
    for (const t of this.memTimers.values()) if (t < min) min = t;
    return min === Infinity ? null : min;
  }

  private fire(key: string, now: number): void {
    const d = this.data;
    if (key.startsWith('hello:')) {
      this.memTimers.delete(key);
      const cid = key.slice(6), c = this.conns.get(cid);
      if (c && !c.pid) { this.sendRaw(cid, { t: 'error', code: 'helloTimeout', msg: msgs.helloTimeout }); this.io.close(cid, 4004, 'hello timeout'); }
      return;
    }
    if (!d) return;
    delete d.timers[key];
    if (key === PHASE) {
      if (d.phase === 'choosing') {
        const g = d.game;
        if (g.choices.length) this.startDrawing(g.choices[Math.floor(this.io.random() * g.choices.length)]);
        else this.endTurn('timeUp');
      } else if (d.phase === 'drawing') this.endTurn('timeUp');
      else if (d.phase === 'reveal') this.nextTurn();
    } else if (key === HINT) {
      this.doHint();
    } else if (key === DRAWERGONE) {
      const dr = d.players.find((p) => p.id === d.game.drawerId);
      if (dr && !this.pidConn.has(dr.id)) this.endTurn('drawerLeft');
    } else if (key === HOSTGONE) {
      const h = d.players.find((p) => p.id === d.hostId);
      if (!h || !this.pidConn.has(h.id)) this.transferHost(now);
    } else if (key === EXPIRE) {
      if (this.connectedCount() === 0) { this.wipe(); }
    } else if (key.startsWith('seat:')) {
      const pid = key.slice(5);
      if (!this.pidConn.has(pid)) this.removePlayer(pid, 'expired');
    }
  }

  private wipe(): void {
    this.data = null;
    this.ops.reset();
    this.memTimers.clear();
    this.io.wipe();
  }

  // ------------------------------------------------------------------ views & sending

  private secretFor(pid: string): SecretView | undefined {
    const d = this.data!, g = d.game;
    if (g.drawerId !== pid) return undefined;
    if (d.phase === 'choosing') return { choices: g.choices, canCustom: d.settings.mode === 'hostOnly' && d.hostId === pid };
    if (d.phase === 'drawing') return { word: g.word ?? undefined };
    return undefined;
  }

  private publicSettings(): PublicSettings {
    const { customWords, ...rest } = this.data!.settings;
    return { ...rest, customWordCount: customWords.length };
  }

  private sendCustomWords(pid: string): void {
    const cid = this.pidConn.get(pid);
    if (cid && this.data) this.sendRaw(cid, { t: 'customWords', words: this.data.settings.customWords });
  }

  private sendSecret(pid: string): void {
    const cid = this.pidConn.get(pid);
    const s = this.secretFor(pid);
    if (cid && s) this.sendRaw(cid, { t: 'secret', secret: s });
  }

  view(): RoomView {
    const d = this.data!, g = d.game, now = this.io.now();
    const el = this.eligibleDrawers();
    const players: PlayerView[] = d.players.map((p) => ({
      id: p.id, name: p.name, avatar: p.avatar, score: p.score, connected: this.pidConn.has(p.id),
      host: d.hostId === p.id, drawer: g.drawerId === p.id && (d.phase === 'choosing' || d.phase === 'drawing' || d.phase === 'reveal'),
      guessed: p.guessedAt !== null, muted: p.muted, spectator: this.isSpectator(p), delta: p.delta,
    }));
    const endMode = d.phase === 'lobby' ? this.resolveEndMode() : g.endMode;
    const minDrawn = el.length ? Math.min(...el.map((p) => p.drawn)) : 0;
    const inGame = d.phase !== 'lobby';
    return {
      code: d.code, rev: d.rev, phase: d.phase, settings: this.publicSettings(), players, hostId: d.hostId,
      drawerId: d.phase === 'lobby' || d.phase === 'podium' ? null : g.drawerId,
      turnNo: g.turnNo,
      turnsTotal: endMode === 'turns' ? d.settings.turns : el.length ? d.settings.rounds * el.length : null,
      round: endMode === 'rounds' && inGame ? Math.min(d.settings.rounds, minDrawn + 1) : null,
      roundsTotal: endMode === 'rounds' ? d.settings.rounds : null,
      endMode,
      phaseEndsAt: d.paused ? null : d.timers[PHASE] ?? null,
      phaseStartedAt: d.phaseStartedAt,
      paused: d.paused !== null,
      pausedRemaining: d.paused ? d.paused.remaining[PHASE] ?? null : null,
      mask: d.phase === 'drawing' && g.word ? buildMask(g.word, g.revealed) : null,
      hintsGiven: g.hintsGiven, hintsTotal: g.hintsTotal,
      reveal: d.phase === 'reveal' ? d.reveal : null,
      podium: d.phase === 'podium' ? d.podium : null,
      now,
    };
  }

  private touch(immediate = false): void {
    if (!this.data) return;
    this.dirty = Math.max(this.dirty, immediate ? 2 : 1);
  }

  private sendState(): void {
    if (!this.data) { this.dirty = 0; return; }
    this.dirty = 0;
    this.lastStateAt = this.io.now();
    this.data.rev++;
    this.bcast({ t: 'state', room: this.view() });
  }

  private afterEvent(): void {
    if (this.dirty) {
      const now = this.io.now();
      if (this.dirty === 2 || now - this.lastStateAt >= STATE_THROTTLE_MS) this.sendState();
      else if (!this.flushPending) { this.flushPending = true; this.io.requestFlush(STATE_THROTTLE_MS - (now - this.lastStateAt)); }
    }
    this.rescheduleAlarm();
  }

  private rescheduleAlarm(): void {
    const next = this.nextDeadline();
    if (next !== this.lastAlarm) { this.lastAlarm = next; this.io.setAlarm(next); }
  }

  private sendRaw(cid: string, m: ServerMsg): void { this.io.send(cid, JSON.stringify(m)); }

  private bcast(m: ServerMsg, exceptPid?: string): void {
    const s = JSON.stringify(m);
    for (const [pid, cid] of this.pidConn) if (pid !== exceptPid) this.io.send(cid, s);
  }

  private sys(text: string, code: string, from?: string): void {
    const ch: ChatChannel = 'sys';
    this.bcast({ t: 'chat', ch, text, code, from });
  }

  private notice(cid: string | undefined, code: keyof typeof msgs): void {
    if (cid) this.sendRaw(cid, { t: 'notice', code, msg: msgs[code] });
  }
}
