import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { IconButton, Button, Sheet } from '../ui.tsx';
import { Icon } from '../icons.tsx';
import { usePrefs } from '../prefs.ts';
import { SIZES, type DrawSurface, type Tool } from './surface.ts';

export const PRESETS = [
  '#1E1B18', '#6B6560', '#A8A29A', '#FFFFFF', '#E4572E', '#B3321B', '#F28C6B', '#F4B6C2',
  '#F2B134', '#C98410', '#F7DC6F', '#8B5A2B', '#1F8A84', '#0F5C58', '#7FD1A8', '#3E7D32',
  '#2F5DA8', '#1B3A73', '#6FA8DC', '#8E5BB5', '#E8D9B5', '#D9A066', '#4A3B2F', '#E83E8C',
];

const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0').toUpperCase();
const parse = (h: string): number | null => (/^#?[0-9a-f]{6}$/i.test(h.trim()) ? parseInt(h.trim().replace('#', ''), 16) : null);

function hsv2rgb(h: number, s: number, v: number): number {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  const c = (x: number) => Math.round(x * 255);
  return (c(f(5)) << 16) | (c(f(3)) << 8) | c(f(1));
}
function rgb2hsv(n: number): [number, number, number] {
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, mx ? d / mx : 0, mx];
}

/** HSV square + hue slider + hex field. Pointer-driven, no libraries. */
function HsvPicker({ value, onChange }: { value: number; onChange: (c: number) => void }): JSX.Element {
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgb2hsv(value));
  const [text, setText] = useState(hex(value));
  const sq = useRef<HTMLDivElement>(null), hu = useRef<HTMLDivElement>(null);
  const commit = (n: [number, number, number]) => { setHsv(n); const c = hsv2rgb(...n); setText(hex(c)); onChange(c); };
  const drag = (fn: (x: number, y: number) => void) => (e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const go = (ev: PointerEvent) => { const r = el.getBoundingClientRect(); fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))); };
    go(e);
    const mv = (ev: PointerEvent) => go(ev);
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  const [h, s, v] = hsv;
  return (
    <div class="hsv">
      <div class="hsv-sq" ref={sq} role="slider" aria-label="Độ đậm và sáng" aria-valuetext={hex(hsv2rgb(h, s, v))} tabIndex={0}
        style={{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,${hex(hsv2rgb(h, 1, 1))})` }}
        onPointerDown={drag((x, y) => commit([h, x, 1 - y]))}
        onKeyDown={(e) => { const d = e.shiftKey ? 0.1 : 0.02; if (e.key === 'ArrowLeft') commit([h, Math.max(0, s - d), v]); else if (e.key === 'ArrowRight') commit([h, Math.min(1, s + d), v]); else if (e.key === 'ArrowUp') commit([h, s, Math.min(1, v + d)]); else if (e.key === 'ArrowDown') commit([h, s, Math.max(0, v - d)]); }}>
        <i class="thumb" style={{ left: s * 100 + '%', top: (1 - v) * 100 + '%' }} />
      </div>
      <div class="hsv-hue" ref={hu} role="slider" aria-label="Màu" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(h)} tabIndex={0}
        onPointerDown={drag((x) => commit([x * 359.9, s || 0.01, v || 0.01]))}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft') commit([Math.max(0, h - 6), s, v]); else if (e.key === 'ArrowRight') commit([Math.min(359.9, h + 6), s, v]); }}>
        <i class="thumb" style={{ left: (h / 360) * 100 + '%' }} />
      </div>
      <div class="hsv-row">
        <span class="swatch big" style={{ background: hex(hsv2rgb(h, s, v)) }} aria-hidden="true" />
        <label class="hexf">
          <span class="flabel">Mã màu</span>
          <input value={text} maxLength={7} spellcheck={false} autocapitalize="characters" autocomplete="off"
            onInput={(e) => { const t = (e.target as HTMLInputElement).value; setText(t); const c = parse(t); if (c !== null) { setHsv(rgb2hsv(c)); onChange(c); } }} />
        </label>
      </div>
    </div>
  );
}

function PaletteSheet({ s, open, onClose }: { s: DrawSurface; open: boolean; onClose: () => void }): JSX.Element {
  return (
    <Sheet open={open} onClose={onClose} title="Chọn màu">
      <div class="palette" role="listbox" aria-label="Màu có sẵn">
        {PRESETS.map((c) => (
          <button type="button" class={`swatch${hex(s.color) === c ? ' on' : ''}`} style={{ background: c }} aria-label={`Màu ${c}`} title={c}
            onClick={() => { s.set({ color: parse(c)! }); if (s.tool === 'eraser' || s.tool === 'pick') s.set({ tool: 'pen' }); onClose(); }} />
        ))}
      </div>
      <h3 class="sub">Màu riêng</h3>
      <HsvPicker value={s.color} onChange={(c) => s.set({ color: c })} />
      <div class="actions"><Button tone="teal" icon="check" onClick={onClose}>Xong</Button></div>
    </Sheet>
  );
}

const TOOLS: [Tool, string, string, string][] = [
  ['pen', 'pen', 'Bút', 'B'], ['eraser', 'eraser', 'Tẩy', 'E'], ['fill', 'fill', 'Sơn', 'F'], ['pick', 'pick', 'Hút màu', 'I'],
];

export function Toolbar({ s }: { s: DrawSurface }): JSX.Element {
  const [, bump] = useState(0);
  const [pal, setPal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const p = usePrefs();
  useEffect(() => s.subscribe(() => bump((n) => n + 1)), [s]);
  const css = hex(s.color);
  return (
    <div class="tools" role="toolbar" aria-label="Công cụ vẽ">
      <div class="trow tools-main">
        {TOOLS.map(([t, icon, label, key]) => (
          <IconButton icon={icon} label={`${label} (${key})`} on={s.tool === t} onClick={() => s.set({ tool: t })} />
        ))}
        <IconButton icon="undo" label="Hoàn tác (Ctrl+Z)" disabled={!s.canUndo} onClick={() => s.undo()} />
        <IconButton icon="redo" label="Làm lại (Ctrl+Y)" disabled={!s.canRedo} onClick={() => s.redo()} />
        <IconButton icon="trash" label="Xóa hết" onClick={() => setConfirm(true)} />
      </div>
      <div class="trow tools-size">
        <div class="sizes" role="radiogroup" aria-label="Cỡ nét">
          {SIZES.map((w, i) => (
            <button type="button" role="radio" aria-checked={s.size === i} class={`size${s.size === i ? ' on' : ''}`} aria-label={`Cỡ ${i + 1}`} title={`Cỡ ${i + 1} ([ ])`} onClick={() => s.set({ size: i })}>
              <i style={{ width: 6 + i * 4 + 'px', height: 6 + i * 4 + 'px' }} />
            </button>
          ))}
        </div>
      </div>
      <div class="trow tools-recent">
        <button type="button" class="btn cur" aria-label="Chọn màu khác" title="Chọn màu khác" onClick={() => setPal(true)}>
          <span class="swatch" style={{ background: css }} />
          <Icon n="palette" size={18} />
        </button>
        <div class="recent" role="group" aria-label="Màu vừa dùng">
          {(p.recent.length ? p.recent : PRESETS.slice(4, 10)).slice(0, 6).map((c) => (
            <button type="button" class={`swatch${css === c.toUpperCase() ? ' on' : ''}`} style={{ background: c }} aria-label={`Màu ${c}`} title={c}
              onClick={() => { s.set({ color: parse(c)! }); if (s.tool === 'eraser' || s.tool === 'pick') s.set({ tool: 'pen' }); }} />
          ))}
        </div>
      </div>
      <PaletteSheet s={s} open={pal} onClose={() => setPal(false)} />
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Xóa hết?">
        <div class="actions">
          <Button onClick={() => setConfirm(false)}>Không</Button>
          <Button tone="tomato" icon="trash" onClick={() => { s.clear(); setConfirm(false); }}>Xóa hết</Button>
        </div>
      </Sheet>
    </div>
  );
}
