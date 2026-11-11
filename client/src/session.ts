// Session: owns the GameClient, the drawing surface, the gallery of finished drawings and sound/vibration cues.
// Preact subscribes through useSession(); high-rate canvas traffic never triggers a render.
import { useEffect, useState } from 'preact/hooks';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../shared/constants.ts';
import { GameClient } from './net.ts';
import { DrawSurface } from './draw/surface.ts';
import { prefs } from './prefs.ts';
import { setAwake, store } from './platform.ts';
import { cue } from './sound.ts';
import { probeServer } from './health.ts';

export interface GalleryItem { turn: number; word: string; drawer: string; url: string; blob: Blob }

let surface: DrawSurface | null = null;
export const getSurface = (): DrawSurface => (surface ??= new DrawSurface());

export const randomCode = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH)), (b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join('');

export const session = {
  client: null as GameClient | null,
  gallery: [] as GalleryItem[],
  /** consecutive failed attempts before the first welcome (server down / over quota) */
  gaveUp: false,
  /** the server answers but refuses: the free daily quota is used up */
  quota: false,
};

const subs = new Set<() => void>();
let queued = false;
function notify(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; subs.forEach((f) => f()); });
}
export function useSession(): typeof session {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return session;
}

export function leaveRoom(goHome = true): void {
  const c = session.client;
  if (c) {
    try { c.send({ t: 'leave' }); } catch { /* ignore */ }
    store.removeItem('vhdc:' + c.room?.code);
    c.close();
  }
  session.client = null; session.gaveUp = false; session.quota = false;
  clearGallery();
  setAwake(false);
  getSurface().setEnabled(false);
  if (goHome) history.replaceState(null, '', '/');
  notify();
}

function clearGallery(): void {
  for (const g of session.gallery) URL.revokeObjectURL(g.url);
  session.gallery = [];
}

export function enterRoom(code: string, opts: { name: string; avatar: number; create: boolean }): void {
  if (session.client) session.client.close();
  clearGallery();
  session.gaveUp = false; session.quota = false;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const c = new GameClient({ url: `${proto}://${location.host}/ws/${code}`, code, name: opts.name, avatar: opts.avatar, create: opts.create, storage: store });
  const s = getSurface();
  s.attach(c);
  session.client = c;
  history.replaceState(null, '', '/r/' + code);

  let lastPhase = '', lastTurn = 0, lastGuessPts = 0, lastClose = 0;
  c.on('change', () => {
    const r = c.room;
    if (r) {
      const myTurn = r.drawerId === c.you && (r.phase === 'choosing' || r.phase === 'drawing');
      s.setEnabled(c.isDrawer && !r.paused);
      setAwake(r.phase !== 'lobby');
      if (r.phase !== lastPhase || r.turnNo !== lastTurn) {
        if (r.phase === 'choosing' && myTurn) cue('turn');
        if (r.phase === 'podium') cue('end');
        if (r.phase === 'lobby') clearGallery();
        lastPhase = r.phase; lastTurn = r.turnNo;
      }
    }
    if (c.lastGuessPts !== lastGuessPts) { lastGuessPts = c.lastGuessPts; cue('correct'); }
    if (c.closeHint !== lastClose) { lastClose = c.closeHint; }
    if (!c.you && c.stats.reconnects >= 3 && !c.fatal) session.gaveUp = true;
    if (c.you && c.status === 'open') { session.gaveUp = false; session.quota = false; }
    if (!c.fatal && c.failures >= 3 && !probing) void checkQuota(c);
    notify();
  });
  c.on('message', (m) => {
    if (m.t === 'sync') setTimeout(() => void capture(c), 140);
  });
  c.on('fatal', () => notify());
  c.on('status', () => notify());
  c.connect();
  notify();
}

let probing = false;
/** After 3 failed attempts ask the health endpoint whether the free quota is gone (once per streak, again after 20 s). */
async function checkQuota(c: GameClient): Promise<void> {
  probing = true;
  try {
    const h = await probeServer();
    if (session.client === c && c.status !== 'open') { session.quota = h === 'quota'; notify(); }
  } finally { setTimeout(() => { probing = false; }, 20_000); }
}

async function capture(c: GameClient): Promise<void> {
  const r = c.room;
  if (!r || !c.log.length || r.phase !== 'reveal') return;
  if (session.gallery.some((g) => g.turn === r.turnNo)) return;
  const blob = await getSurface().toBlob();
  if (!blob || session.gallery.some((g) => g.turn === r.turnNo)) return;
  const drawer = r.players.find((p) => p.id === r.drawerId)?.name ?? '';
  session.gallery.push({ turn: r.turnNo, word: r.reveal?.word ?? '', drawer, url: URL.createObjectURL(blob), blob });
  notify();
}

/** Seconds left in the current phase on the server clock. */
export function secondsLeft(c: GameClient): number | null {
  const r = c.room;
  if (!r) return null;
  if (r.paused) return r.pausedRemaining !== null ? Math.ceil(r.pausedRemaining / 1000) : null;
  return r.phaseEndsAt ? Math.max(0, Math.ceil((r.phaseEndsAt - c.serverNow()) / 1000)) : null;
}

export function useSeconds(c: GameClient | null): number | null {
  const [v, setV] = useState<number | null>(c ? secondsLeft(c) : null);
  useEffect(() => {
    if (!c) return;
    const t = () => setV(secondsLeft(c));
    t();
    const id = setInterval(t, 250);
    return () => clearInterval(id);
  }, [c]);
  return v;
}

export const myName = (): string => prefs().name.trim() || 'Khách';
