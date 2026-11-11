// The drawing surface lives OUTSIDE Preact: one <canvas>, the deterministic engine, playback, pointer input and
// keyboard shortcuts. Preact only renders toolbars; no component re-renders per stroke.
import { CANVAS_H, CANVAS_W } from '../../../shared/constants.ts';
import { CanvasEngine } from '../../../shared/canvas/engine.ts';
import { Playback } from '../../../shared/canvas/playback.ts';
import type { GameClient } from '../net.ts';
import { prefs, setPrefs } from '../prefs.ts';

export type Tool = 'pen' | 'eraser' | 'fill' | 'pick';
/** Brush sizes in logical canvas px (1200 x 900). */
export const SIZES = [4, 10, 20, 36, 60] as const;

export class DrawSurface {
  readonly canvas = document.createElement('canvas');
  readonly engine: CanvasEngine;
  readonly playback: Playback;
  client: GameClient | null = null;
  tool: Tool = 'pen';
  color = 0x1e1b18;
  size = 1; // index into SIZES
  /** true when this client may draw right now (drawer, drawing, not paused) */
  enabled = false;
  private subs = new Set<() => void>();
  private pid = -1;
  private rect: DOMRect | null = null;
  private raw = { x: 0, y: 0 };
  private sm = { x: 0, y: 0 };
  private sent = { x: 0, y: 0 };
  private pending: number[] = [];
  private raf = 0;
  private flushRaf = 0;

  constructor() {
    const cv = this.canvas;
    cv.width = CANVAS_W; cv.height = CANVAS_H;
    cv.className = 'cv'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Bảng vẽ');
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    this.engine = new CanvasEngine(ctx as never);
    this.engine.reset();
    this.playback = new Playback(this.engine);
    cv.addEventListener('pointerdown', this.down);
    cv.addEventListener('pointermove', this.move);
    cv.addEventListener('pointerup', this.up);
    cv.addEventListener('pointercancel', this.up);
    cv.addEventListener('lostpointercapture', this.up);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    cv.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    addEventListener('keydown', this.key);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.playback.flush(); });
    const loop = (): void => { this.playback.tick(Date.now()); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  attach(client: GameClient): void { this.client = client; client.attachEngine(this.engine, this.playback); }

  subscribe(f: () => void): () => void { this.subs.add(f); return () => { this.subs.delete(f); }; }
  private emit(): void { this.subs.forEach((f) => f()); }
  set(p: Partial<{ tool: Tool; color: number; size: number }>): void {
    if (p.tool) this.tool = p.tool;
    if (p.size !== undefined) this.size = p.size;
    if (p.color !== undefined) {
      this.color = p.color;
      const hex = '#' + p.color.toString(16).padStart(6, '0');
      const r = prefs().recent.filter((c) => c !== hex);
      setPrefs({ recent: [hex, ...r].slice(0, 6) });
    }
    this.emit();
  }

  get canUndo(): boolean { return this.engine.depth > 0; }
  get canRedo(): boolean { return this.engine.redoDepth > 0; }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.canvas.classList.toggle('can-draw', on);
    if (!on) this.endStroke();
    this.emit();
  }

  // ---------------------------------------------------------------- input

  private pos(x: number, y: number): { x: number; y: number } {
    const r = this.rect ?? this.canvas.getBoundingClientRect();
    return {
      x: Math.min(CANVAS_W, Math.max(0, Math.round(((x - r.left) * CANVAS_W) / r.width))),
      y: Math.min(CANVAS_H, Math.max(0, Math.round(((y - r.top) * CANVAS_H) / r.height))),
    };
  }

  private down = (e: PointerEvent): void => {
    if (!this.enabled || !this.client?.isDrawer || this.pid !== -1) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.rect = this.canvas.getBoundingClientRect();
    const p = this.pos(e.clientX, e.clientY);
    if (this.tool === 'pick') { this.pickColor(p.x, p.y); return; }
    if (this.tool === 'fill') { this.send([{ k: 'f', x: p.x, y: p.y, c: this.color }]); return; }
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.pid = e.pointerId;
    this.raw = p; this.sm = p; this.sent = p; this.pending = [];
    const eraser = this.tool === 'eraser';
    this.send([{ k: 'b', t: eraser ? 1 : 0, c: eraser ? 0xffffff : this.color, w: SIZES[this.size], x: p.x, y: p.y }]);
  };

  private move = (e: PointerEvent): void => {
    if (e.pointerId !== this.pid) return;
    e.preventDefault();
    const list = e.getCoalescedEvents?.() ?? [];
    for (const ev of list.length ? list : [e]) {
      const p = this.pos(ev.clientX, ev.clientY);
      this.raw = p;
      // exponential smoothing; the exact end point is added on pointerup
      this.sm = { x: this.sm.x + (p.x - this.sm.x) * 0.55, y: this.sm.y + (p.y - this.sm.y) * 0.55 };
      this.addPoint(Math.round(this.sm.x), Math.round(this.sm.y), 2);
    }
    this.scheduleFlush();
  };

  private up = (e: PointerEvent): void => {
    if (e.pointerId !== this.pid) return;
    this.endStroke();
  };

  private addPoint(x: number, y: number, minDist: number): void {
    if (Math.hypot(x - this.sent.x, y - this.sent.y) < minDist) return;
    this.pending.push(x - this.sent.x, y - this.sent.y);
    this.sent = { x, y };
  }

  private endStroke(): void {
    if (this.pid === -1) return;
    this.addPoint(this.raw.x, this.raw.y, 1);
    this.flushPoints();
    this.pid = -1;
  }

  private scheduleFlush(): void {
    if (this.flushRaf) return;
    this.flushRaf = requestAnimationFrame(() => { this.flushRaf = 0; this.flushPoints(); });
  }

  private flushPoints(): void {
    const p = this.pending;
    if (!p.length) return;
    this.pending = [];
    const ops = [];
    for (let i = 0; i < p.length; i += 128) ops.push({ k: 'm' as const, p: p.slice(i, i + 128) }); // <= 64 points per op
    this.send(ops);
  }

  private send(ops: Parameters<GameClient['draw']>[0]): void {
    if (this.client?.draw(ops)) return;
    this.emit(); // undo/redo availability
  }

  private pickColor(x: number, y: number): void {
    this.playback.flush();
    const d = this.canvas.getContext('2d')!.getImageData(x, y, 1, 1).data;
    this.set({ color: (d[0] << 16) | (d[1] << 8) | d[2], tool: 'pen' });
  }

  // ---------------------------------------------------------------- actions

  undo(): void { this.endStroke(); this.send([{ k: 'u' }]); }
  redo(): void { this.endStroke(); this.send([{ k: 'r' }]); }
  clear(): void { this.endStroke(); this.send([{ k: 'x' }]); }

  private key = (e: KeyboardEvent): void => {
    if (!this.enabled || !this.client?.isDrawer) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); this.redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'b') this.set({ tool: 'pen' });
    else if (k === 'e') this.set({ tool: 'eraser' });
    else if (k === 'f') this.set({ tool: 'fill' });
    else if (k === 'i') this.set({ tool: 'pick' });
    else if (k === '[') this.set({ size: Math.max(0, this.size - 1) });
    else if (k === ']') this.set({ size: Math.min(SIZES.length - 1, this.size + 1) });
  };

  /** White-backed PNG of the current picture (the engine leaves nothing transparent, but be safe). */
  toBlob(): Promise<Blob | null> {
    this.playback.flush();
    return new Promise((res) => this.canvas.toBlob((b) => res(b), 'image/png'));
  }
}
