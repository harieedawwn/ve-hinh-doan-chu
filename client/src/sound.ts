// Short tactile UI sounds from the vendored procedural engine (loaded lazily after the first tap).
import { prefs } from './prefs.ts';
import { vibrate } from './platform.ts';

interface Sfx { play(name: string, o?: Record<string, unknown>): void; autoUnlock(): void; setMuted(m: boolean): void }
let sfx: Sfx | null = null;
let loading: Promise<void> | null = null;

function ensure(): void {
  if (loading) return;
  loading = import('./vendor/sfx.js').then(() => {
    const S = (window as unknown as { SFX?: new () => Sfx }).SFX;
    if (S) { sfx = new S(); sfx.autoUnlock(); }
  }).catch(() => { /* audio unavailable */ });
}

/** Call once; the engine downloads on the first pointer/key event so it never counts toward the initial bundle. */
export function initSound(): void {
  const go = (): void => { ensure(); removeEventListener('pointerdown', go, true); removeEventListener('keydown', go, true); };
  addEventListener('pointerdown', go, true); addEventListener('keydown', go, true);
}

export type Cue = 'click' | 'turn' | 'correct' | 'tick' | 'end' | 'error';
const MAP: Record<Cue, [string, Record<string, unknown>]> = {
  click: ['ui_click', {}],
  turn: ['ui_notify', { vol: 1.4 }],
  correct: ['ui_success', { vol: 1.3 }],
  tick: ['ui_click', { vol: 0.9, pitch: 1.25 }],
  end: ['reward', {}],
  error: ['ui_error', {}],
};
const VIB: Partial<Record<Cue, number | number[]>> = { turn: [60, 40, 60], correct: 80, end: [80, 50, 80, 50, 160] };

export function cue(name: Cue): void {
  const p = prefs();
  if (p.sound) { ensure(); const [n, o] = MAP[name]; try { sfx?.play(n, o); } catch { /* ignore */ } }
  const v = VIB[name];
  if (p.vibrate && v) vibrate(v);
}
