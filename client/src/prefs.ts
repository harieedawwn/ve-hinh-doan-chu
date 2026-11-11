// Player preferences, persisted as one JSON blob. Tiny pub/sub + hook.
import { useEffect, useState } from 'preact/hooks';
import { store } from './platform.ts';

export interface Prefs {
  name: string;
  avatar: number;
  sound: boolean;
  vibrate: boolean;
  /** 'ask' = never answered; 'yes'/'no' = remembered answer to "Chơi toàn màn hình?" */
  fs: 'ask' | 'yes' | 'no';
  left: boolean;
  theme: 'light' | 'dark';
  recent: string[];
}

const KEY = 'vhdc:prefs';
const systemDark = (): boolean => { try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; } };
const defaults = (): Prefs => ({ name: '', avatar: Math.floor(Math.random() * 24), sound: true, vibrate: true, fs: 'ask', left: false, theme: systemDark() ? 'dark' : 'light', recent: [] });

function load(): Prefs {
  try { return { ...defaults(), ...(JSON.parse(store.getItem(KEY) ?? '{}') as Partial<Prefs>) }; } catch { return defaults(); }
}

let cur: Prefs = load();
const subs = new Set<() => void>();

export const prefs = (): Prefs => cur;
export function setPrefs(p: Partial<Prefs>): void {
  cur = { ...cur, ...p };
  store.setItem(KEY, JSON.stringify(cur));
  applyTheme();
  subs.forEach((f) => f());
}
export function applyTheme(): void {
  document.documentElement.dataset.theme = cur.theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', cur.theme === 'dark' ? '#211d19' : '#f5efe3');
}
export function usePrefs(): Prefs {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return cur;
}

export const reducedMotion = (): boolean => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
