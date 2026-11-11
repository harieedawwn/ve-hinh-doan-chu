// Wire protocol, room state and settings. JSON text frames over WebSocket /ws/CODE.
// Everything player-facing in `msg` fields is Vietnamese. See SPEC.md for the full description.

import {
  AVATAR_COUNT, CHAT_MAX_LEN, DEFAULT_MAX_PLAYERS, HARD_MAX_PLAYERS, MAX_DRAW_MSG_LEN, MAX_MSG_LEN,
  MAX_SETTINGS_MSG_LEN, NAME_MAX_LEN, ROOM_CODE_RE,
} from './constants.ts';
import type { Op } from './canvas/ops.ts';
import { cleanText } from './text.ts';
import { CATEGORY_IDS, DIFFICULTIES, type CategoryId, type Difficulty } from './words/index.ts';

// ---------------------------------------------------------------- settings

export type Phase = 'lobby' | 'choosing' | 'drawing' | 'reveal' | 'podium';
export type DrawerMode = 'rotate' | 'hostOnly' | 'hostMC';
export type EndBy = 'auto' | 'rounds' | 'turns';

export interface Settings {
  mode: DrawerMode;
  endBy: EndBy;
  rounds: number;
  turns: number;
  drawTime: number;
  wordChoices: number;
  chooseTime: number;
  hints: number;
  categories: CategoryId[];
  difficulties: Difficulty[];
  customWords: string[];
  onlyCustom: boolean;
  accentInsensitive: boolean;
  showClose: boolean;
  locked: boolean;
  allowLateJoin: boolean;
  maxPlayers: number;
  hostGuesses: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'rotate',
  endBy: 'auto',
  rounds: 3,
  turns: 12,
  drawTime: 80,
  wordChoices: 3,
  chooseTime: 15,
  hints: 2,
  categories: CATEGORY_IDS.slice(),
  difficulties: ['easy', 'medium'],
  customWords: [],
  onlyCustom: false,
  accentInsensitive: true,
  showClose: true,
  locked: false,
  allowLateJoin: true,
  maxPlayers: DEFAULT_MAX_PLAYERS,
  hostGuesses: true,
};

export const SETTING_RANGES = {
  rounds: [1, 10], turns: [1, 200], drawTime: [30, 240], wordChoices: [1, 5],
  chooseTime: [5, 60], hints: [0, 5], maxPlayers: [2, HARD_MAX_PLAYERS],
} as const;
export const MAX_CUSTOM_WORDS = 500;
export const MAX_CUSTOM_WORD_LEN = 40;

/** Settings that the host may change while a game is running. */
export const LIVE_SETTING_KEYS: (keyof Settings)[] = ['locked', 'allowLateJoin', 'maxPlayers', 'showClose'];

const clampInt = (v: unknown, [lo, hi]: readonly [number, number], fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
const bool = (v: unknown, fb: boolean): boolean => (typeof v === 'boolean' ? v : fb);

export function cleanCustomWords(v: unknown): string[] | null {
  let list: unknown[];
  if (typeof v === 'string') list = v.split(/[\n,;]+/);
  else if (Array.isArray(v)) list = v;
  else return null;
  const out: string[] = [], seen = new Set<string>();
  for (const x of list) {
    const w = cleanText(x, MAX_CUSTOM_WORD_LEN);
    const k = w.toLowerCase();
    if (w.length >= 2 && !seen.has(k)) { seen.add(k); out.push(w); }
    if (out.length >= MAX_CUSTOM_WORDS) break;
  }
  return out;
}

/** Merge a (possibly hostile) patch into settings; every field is clamped / filtered. Unknown keys are ignored. */
export function applySettingsPatch(cur: Settings, patch: unknown, only?: readonly (keyof Settings)[]): Settings {
  const p = (typeof patch === 'object' && patch !== null ? patch : {}) as Record<string, unknown>;
  const s: Settings = { ...cur, categories: cur.categories.slice(), difficulties: cur.difficulties.slice(), customWords: cur.customWords.slice() };
  const allowed = (k: keyof Settings): boolean => k in p && (!only || only.includes(k));
  if (allowed('mode') && (p.mode === 'rotate' || p.mode === 'hostOnly' || p.mode === 'hostMC')) s.mode = p.mode;
  if (allowed('endBy') && (p.endBy === 'auto' || p.endBy === 'rounds' || p.endBy === 'turns')) s.endBy = p.endBy;
  if (allowed('rounds')) s.rounds = clampInt(p.rounds, SETTING_RANGES.rounds, s.rounds);
  if (allowed('turns')) s.turns = clampInt(p.turns, SETTING_RANGES.turns, s.turns);
  if (allowed('drawTime')) s.drawTime = clampInt(p.drawTime, SETTING_RANGES.drawTime, s.drawTime);
  if (allowed('wordChoices')) s.wordChoices = clampInt(p.wordChoices, SETTING_RANGES.wordChoices, s.wordChoices);
  if (allowed('chooseTime')) s.chooseTime = clampInt(p.chooseTime, SETTING_RANGES.chooseTime, s.chooseTime);
  if (allowed('hints')) s.hints = clampInt(p.hints, SETTING_RANGES.hints, s.hints);
  if (allowed('maxPlayers')) s.maxPlayers = clampInt(p.maxPlayers, SETTING_RANGES.maxPlayers, s.maxPlayers);
  if (allowed('categories') && Array.isArray(p.categories)) {
    const c = CATEGORY_IDS.filter((id) => (p.categories as unknown[]).includes(id));
    if (c.length) s.categories = c;
  }
  if (allowed('difficulties') && Array.isArray(p.difficulties)) {
    const d = DIFFICULTIES.filter((id) => (p.difficulties as unknown[]).includes(id));
    if (d.length) s.difficulties = d;
  }
  if (allowed('customWords')) { const w = cleanCustomWords(p.customWords); if (w) s.customWords = w; }
  for (const k of ['onlyCustom', 'accentInsensitive', 'showClose', 'locked', 'allowLateJoin', 'hostGuesses'] as const) {
    if (allowed(k)) s[k] = bool(p[k], s[k]);
  }
  return s;
}

// ---------------------------------------------------------------- views (server -> client)

/** Settings as broadcast to everyone: the custom word list itself is host-only (it would leak candidate words). */
export type PublicSettings = Omit<Settings, 'customWords'> & { customWordCount: number };

export interface PlayerView {
  id: string;
  name: string;
  avatar: number;
  score: number;
  connected: boolean;
  host: boolean;
  drawer: boolean;
  /** has guessed the current word */
  guessed: boolean;
  muted: boolean;
  /** MC host who does not guess */
  spectator: boolean;
  /** points gained this turn */
  delta: number;
}

export type TurnEndReason = 'allGuessed' | 'timeUp' | 'skipped' | 'drawerLeft';

export interface RevealView {
  word: string | null;
  reason: TurnEndReason;
  deltas: { id: string; delta: number }[];
}

export interface PodiumEntry { id: string; name: string; avatar: number; score: number; rank: number }

export interface RoomView {
  code: string;
  rev: number;
  phase: Phase;
  settings: PublicSettings;
  players: PlayerView[];
  hostId: string | null;
  drawerId: string | null;
  /** 1-based number of the current/last turn (0 in lobby) */
  turnNo: number;
  /** planned number of turns, or null when unknown */
  turnsTotal: number | null;
  round: number | null;
  roundsTotal: number | null;
  endMode: 'rounds' | 'turns';
  /** server epoch ms when the current phase ends (null if none / paused) */
  phaseEndsAt: number | null;
  phaseStartedAt: number | null;
  paused: boolean;
  /** remaining ms of the phase while paused */
  pausedRemaining: number | null;
  /** public mask of the word while drawing, e.g. "_ _ _  _ _" ("_" hidden letter) */
  mask: string | null;
  hintsGiven: number;
  hintsTotal: number;
  reveal: RevealView | null;
  podium: PodiumEntry[] | null;
  /** server clock when this snapshot was produced */
  now: number;
}

export interface SecretView {
  /** drawer only: word choices during `choosing` */
  choices?: string[];
  /** drawer only: may type a custom word (host in "Chỉ host vẽ") */
  canCustom?: boolean;
  /** drawer only: the secret word while drawing */
  word?: string;
}

// ---------------------------------------------------------------- client -> server

export type ClientMsg =
  | { t: 'hello'; name: string; avatar: number; token?: string; create?: boolean; v?: number }
  | { t: 'ping'; c: number }
  | { t: 'chat'; text: string }
  | { t: 'draw'; ops: Op[]; span: number }
  | { t: 'pick'; i?: number; word?: string }
  | { t: 'settings'; patch: Record<string, unknown> }
  | { t: 'start' }
  | { t: 'again' }
  | { t: 'kick'; id: string }
  | { t: 'mute'; id: string; on: boolean }
  | { t: 'host'; id: string }
  | { t: 'pause' }
  | { t: 'skip' }
  | { t: 'end' }
  | { t: 'leave' }
  | { t: 'resync' };

export type ClientMsgType = ClientMsg['t'];

export interface ParseError { error: string }

export function parseClientMessage(raw: unknown): ClientMsg | ParseError {
  if (typeof raw !== 'string') return { error: 'binary' };
  if (raw.length > MAX_DRAW_MSG_LEN) return { error: 'tooBig' };
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return { error: 'json' }; }
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return { error: 'shape' };
  const o = m as Record<string, unknown>;
  const t = o.t;
  if (typeof t !== 'string') return { error: 'type' };
  const limit = t === 'draw' ? MAX_DRAW_MSG_LEN : t === 'settings' ? MAX_SETTINGS_MSG_LEN : MAX_MSG_LEN;
  if (raw.length > limit) return { error: 'tooBig' };
  const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);
  switch (t) {
    case 'hello': {
      const name = cleanText(o.name, NAME_MAX_LEN);
      const av = typeof o.avatar === 'number' && Number.isInteger(o.avatar) ? ((o.avatar % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT : 0;
      const token = o.token === undefined ? undefined : str(o.token, 64);
      if (token === null) return { error: 'token' };
      return { t, name, avatar: av, token, create: o.create === true, v: typeof o.v === 'number' ? o.v : undefined };
    }
    case 'ping':
      return typeof o.c === 'number' && Number.isFinite(o.c) ? { t, c: o.c } : { error: 'ping' };
    case 'chat': {
      const text = str(o.text, CHAT_MAX_LEN * 4);
      return text === null ? { error: 'chat' } : { t, text };
    }
    case 'draw':
      if (!Array.isArray(o.ops)) return { error: 'draw' };
      return { t, ops: o.ops as Op[], span: typeof o.span === 'number' && Number.isFinite(o.span) ? o.span : 0 };
    case 'pick': {
      if (o.i !== undefined && !(typeof o.i === 'number' && Number.isInteger(o.i))) return { error: 'pick' };
      const word = o.word === undefined ? undefined : str(o.word, 200);
      if (word === null) return { error: 'pick' };
      return { t, i: o.i as number | undefined, word };
    }
    case 'settings':
      return typeof o.patch === 'object' && o.patch !== null && !Array.isArray(o.patch) ? { t, patch: o.patch as Record<string, unknown> } : { error: 'settings' };
    case 'kick': case 'host': {
      const id = str(o.id, 16);
      return id === null ? { error: 'id' } : { t, id };
    }
    case 'mute': {
      const id = str(o.id, 16);
      return id === null || typeof o.on !== 'boolean' ? { error: 'mute' } : { t, id, on: o.on };
    }
    case 'start': case 'again': case 'pause': case 'skip': case 'end': case 'leave': case 'resync':
      return { t };
    default:
      return { error: 'unknownType' };
  }
}

export function isParseError(m: ClientMsg | ParseError): m is ParseError {
  return 'error' in m;
}

// ---------------------------------------------------------------- server -> client

export type ChatChannel = 'all' | 'team' | 'sys' | 'self';

export type ServerMsg =
  | { t: 'welcome'; you: string; token: string; v: number; room: RoomView; secret?: SecretView }
  | { t: 'state'; room: RoomView }
  | { t: 'secret'; secret: SecretView }
  /** host only: the custom word list */
  | { t: 'customWords'; words: string[] }
  | { t: 'chat'; ch: ChatChannel; from?: string; name?: string; text: string; code?: string }
  | { t: 'close' }
  | { t: 'guessOk'; pts: number }
  | { t: 'draw'; n: number; ops: Op[]; span: number }
  | { t: 'canvas'; n: number; ops: Op[]; total: number; hash: string; reset: boolean; last: boolean }
  | { t: 'sync'; n: number; hash: string }
  | { t: 'drawReject'; code: string; n: number }
  | { t: 'pong'; c: number; s: number }
  | { t: 'notice'; code: string; msg: string }
  | { t: 'error'; code: string; msg: string }
  | { t: 'kicked'; msg: string };


export function validRoomCode(code: string): boolean { return ROOM_CODE_RE.test(code); }
