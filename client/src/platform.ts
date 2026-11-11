// Browser/platform helpers: safe storage, environment detection (Zalo, iOS, ...), viewport vars, fullscreen,
// wake lock, vibration, share/copy. Every call that can throw in an in-app browser is wrapped.

const mem = new Map<string, string>();

/** localStorage that never throws; falls back to memory when storage is blocked (some in-app browsers). */
export const store = {
  getItem(k: string): string | null {
    try { const v = localStorage.getItem(k); if (v !== null) return v; } catch { /* blocked */ }
    return mem.get(k) ?? null;
  },
  setItem(k: string, v: string): void {
    mem.set(k, v);
    try { localStorage.setItem(k, v); } catch { /* blocked: memory only */ }
  },
  removeItem(k: string): void {
    mem.delete(k);
    try { localStorage.removeItem(k); } catch { /* blocked */ }
  },
};

const ua = navigator.userAgent || '';
const iosLike = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void; webkitFullscreenEnabled?: boolean };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export const env = {
  ua,
  zalo: /Zalo/i.test(ua),
  inApp: /Zalo|FBAN|FBAV|FB_IAB|Messenger|Instagram|Line\/|TikTok|MicroMessenger/i.test(ua),
  ios: iosLike,
  iphone: /iPhone|iPod/i.test(ua),
  android: /Android/i.test(ua),
  touch: (() => { try { return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0; } catch { return false; } })(),
  canVibrate: typeof navigator.vibrate === 'function',
  canShare: typeof navigator.share === 'function',
};

/** Route by path only: drop every query string / hash the host app appended (zarsrc, utm_*, fbclid ...). */
export function stripUnknownQuery(): void {
  try {
    if (location.search || location.hash) history.replaceState(null, '', location.pathname);
  } catch { /* ignore */ }
}

export const roomCodeFromPath = (): string | null => /^\/r\/([A-Za-z0-9]{5})\/?$/.exec(location.pathname)?.[1]?.toUpperCase() ?? null;

// ------------------------------------------------------------ viewport (visualViewport keeps the iOS keyboard from moving the canvas)

export function initViewport(): void {
  const root = document.documentElement;
  const vv = window.visualViewport;
  let base = 0;
  const measure = (): void => {
    const h = Math.round(vv ? vv.height : innerHeight), w = Math.round(vv ? vv.width : innerWidth);
    const top = vv ? Math.round(vv.offsetTop) : 0;
    base = Math.max(base * 0.999, h, innerHeight);
    root.style.setProperty('--vv-h', h + 'px');
    root.style.setProperty('--vv-top', top + 'px');
    root.classList.toggle('is-wide', w >= 600 && w / h >= 1.1);
    root.classList.toggle('is-short', h < 480);
    root.classList.toggle('is-kb', h < base * 0.78 && w < 700);
    if (top) window.scrollTo(0, 0);
  };
  measure();
  addEventListener('resize', measure);
  addEventListener('orientationchange', () => setTimeout(() => { base = 0; measure(); }, 300));
  vv?.addEventListener('resize', measure);
  vv?.addEventListener('scroll', measure);
  addEventListener('scroll', () => { if (scrollY) scrollTo(0, 0); });
  root.classList.toggle('is-touch', env.touch);
  root.classList.toggle('is-inapp', env.inApp);
}

// ------------------------------------------------------------ fullscreen

export const fullscreenSupported = (): boolean => {
  const d = document as FsDoc;
  const el = document.documentElement as FsEl;
  if (env.iphone) return false; // iPhone Safari/WebViews only fullscreen <video>
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled) && !!(el.requestFullscreen || el.webkitRequestFullscreen);
};
export const isFullscreen = (): boolean => !!(document.fullscreenElement || (document as FsDoc).webkitFullscreenElement);

/** Must run inside a user gesture. Resolves false when the browser silently refuses (some in-app browsers). */
export async function enterFullscreen(): Promise<boolean> {
  try {
    const el = document.documentElement as FsEl;
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    await new Promise((r) => setTimeout(r, 250));
    return isFullscreen();
  } catch { return false; }
}
export async function exitFullscreen(): Promise<void> {
  try {
    const d = document as FsDoc;
    if (document.exitFullscreen) await document.exitFullscreen(); else await d.webkitExitFullscreen?.();
  } catch { /* ignore */ }
}

// ------------------------------------------------------------ wake lock / vibrate

let lock: WakeLockSentinel | null = null;
export async function keepAwake(on: boolean): Promise<void> {
  try {
    if (!on) { await lock?.release(); lock = null; return; }
    if (lock && !lock.released) return;
    lock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch { lock = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wantAwake) void keepAwake(true); });
let wantAwake = false;
export function setAwake(on: boolean): void { if (on !== wantAwake) { wantAwake = on; void keepAwake(on); } }

export function vibrate(pattern: number | number[]): void {
  try { navigator.vibrate?.(pattern); } catch { /* ignore */ }
}

// ------------------------------------------------------------ share / copy

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

export async function shareLink(url: string, title: string): Promise<boolean> {
  try { await navigator.share({ title, text: title, url }); return true; } catch { return false; }
}

export function openInBrowser(url: string): void {
  try { window.open(url, '_blank', 'noopener'); } catch { /* ignore */ }
}
