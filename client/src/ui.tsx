// Small shared UI pieces in the sketchbook style.
import type { ComponentChildren, JSX } from 'preact';
import type * as preact from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons.tsx';
import { cue } from './sound.ts';

type BtnProps = Omit<preact.ButtonHTMLAttributes<HTMLButtonElement>, 'size'> & { tone?: 'tomato' | 'mustard' | 'teal' | 'cobalt' | 'paper'; big?: boolean; icon?: string };

export function Button({ tone = 'paper', big, icon, children, class: cls, onClick, ...rest }: BtnProps): JSX.Element {
  return (
    <button type="button" class={`btn tone-${tone}${big ? ' big' : ''}${cls ? ' ' + cls : ''}`}
      onClick={(e) => { cue('click'); (onClick as ((e: MouseEvent) => void) | undefined)?.(e); }} {...rest}>
      {icon ? <Icon n={icon} size={big ? 24 : 20} /> : null}
      {children ? <span class="lbl">{children}</span> : null}
    </button>
  );
}

/** Icon-only button: aria-label + tooltip are mandatory. */
export function IconButton({ icon, label, on, class: cls, onClick, tone, ...rest }: { icon: string; label: string; on?: boolean; tone?: string } & preact.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button type="button" class={`btn ibtn${on ? ' on' : ''}${tone ? ' tone-' + tone : ''}${cls ? ' ' + cls : ''}`} aria-label={label} title={label} aria-pressed={on === undefined ? undefined : on}
      onClick={(e) => { cue('click'); (onClick as ((e: MouseEvent) => void) | undefined)?.(e); }} {...rest}>
      <Icon n={icon} />
    </button>
  );
}

export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ComponentChildren; wide?: boolean }): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => { removeEventListener('keydown', k); prev?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <div class="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div class="sheet-head">
          <h2>{title}</h2>
          <IconButton icon="x" label="Đóng" onClick={onClose} />
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Switch({ label, value, onChange, icon }: { label: string; value: boolean; onChange: (v: boolean) => void; icon?: string }): JSX.Element {
  return (
    <button type="button" class="row switch" role="switch" aria-checked={value} onClick={() => { cue('click'); onChange(!value); }}>
      {icon ? <Icon n={icon} size={20} /> : null}
      <span class="grow">{label}</span>
      <span class={`knob${value ? ' on' : ''}`}><i /></span>
    </button>
  );
}

export function Seg<T extends string>({ label, value, options, onChange }: { label?: string; value: T; options: [T, string][]; onChange: (v: T) => void }): JSX.Element {
  return (
    <div class="field">
      {label ? <span class="flabel">{label}</span> : null}
      <div class="seg" role="radiogroup" aria-label={label}>
        {options.map(([v, t]) => (
          <button type="button" role="radio" aria-checked={v === value} class={v === value ? 'on' : ''} onClick={() => { cue('click'); onChange(v); }}>{t}</button>
        ))}
      </div>
    </div>
  );
}

export function Stepper({ label, value, min, max, step = 1, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }): JSX.Element {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return (
    <div class="row stepper">
      <span class="grow">{label}</span>
      <button type="button" class="btn ibtn sm" aria-label={`Giảm ${label}`} title="Giảm" disabled={value <= min} onClick={() => set(value - step)}><Icon n="minus" size={18} /></button>
      <output class="num" aria-live="polite">{value}{unit}</output>
      <button type="button" class="btn ibtn sm" aria-label={`Tăng ${label}`} title="Tăng" disabled={value >= max} onClick={() => set(value + step)}><Icon n="plus" size={18} /></button>
    </div>
  );
}

export function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T[]; options: [T, string][]; onChange: (v: T[]) => void }): JSX.Element {
  return (
    <div class="field">
      <span class="flabel">{label}</span>
      <div class="chips">
        {options.map(([v, t]) => {
          const on = value.includes(v);
          return (
            <button type="button" aria-pressed={on} class={`chip${on ? ' on' : ''}`} onClick={() => { cue('click'); const n = on ? value.filter((x) => x !== v) : [...value, v]; if (n.length) onChange(n); }}>{t}</button>
          );
        })}
      </div>
    </div>
  );
}

export function Accordion({ title, icon, defaultOpen, children }: { title: string; icon?: string; defaultOpen?: boolean; children: ComponentChildren }): JSX.Element {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section class={`acc${open ? ' open' : ''}`}>
      <button type="button" class="acc-head" aria-expanded={open} onClick={() => { cue('click'); setOpen(!open); }}>
        {icon ? <Icon n={icon} size={20} /> : null}
        <span class="grow">{title}</span>
        <Icon n={open ? 'up' : 'down'} size={20} />
      </button>
      {open ? <div class="acc-body">{children}</div> : null}
    </section>
  );
}

// ------------------------------------------------------------ toast
let toastSet: ((t: string) => void) | null = null;
export const toast = (t: string): void => toastSet?.(t);
export function Toaster(): JSX.Element {
  const [t, setT] = useState('');
  useEffect(() => {
    let id = 0;
    toastSet = (x) => { setT(x); clearTimeout(id); id = window.setTimeout(() => setT(''), 2200); };
    return () => { toastSet = null; };
  }, []);
  return <div class="toast" role="status" aria-live="polite">{t ? <span>{t}</span> : null}</div>;
}
