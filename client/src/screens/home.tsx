import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_CODE_RE } from '../../../shared/constants.ts';
import { Avatar, Icon } from '../icons.tsx';
import { Button, IconButton } from '../ui.tsx';
import { prefs, setPrefs, usePrefs } from '../prefs.ts';
import { enterRoom, randomCode } from '../session.ts';
import { cue } from '../sound.ts';

const OK = new Set(ROOM_CODE_ALPHABET);
export const cleanCode = (t: string): string => {
  const i = t.toLowerCase().lastIndexOf('/r/');
  const src = i >= 0 ? t.slice(i + 3) : t;
  return [...src.toUpperCase()].filter((c) => OK.has(c)).join('').slice(0, ROOM_CODE_LENGTH);
};

export function Title({ small }: { small?: boolean }): JSX.Element {
  return (
    <h1 class={`title${small ? ' small' : ''}`}>
      <span>Vẽ hình</span>
      <span>đoán chữ</span>
    </h1>
  );
}

export function AppMark({ size = 56 }: { size?: number }): JSX.Element {
  return <img class="mark" src="/favicon.svg" width={size} height={size} alt="" />;
}

function CodeBoxes({ value, onChange, onDone }: { value: string; onChange: (v: string) => void; onDone: () => void }): JSX.Element {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const chars = value.padEnd(ROOM_CODE_LENGTH, ' ').split('');
  const focus = (i: number) => refs.current[Math.max(0, Math.min(ROOM_CODE_LENGTH - 1, i))]?.focus();
  const setAt = (i: number, ch: string) => { const a = chars.slice(); a[i] = ch || ' '; onChange(a.join('').replace(/ +$/, '').replace(/ /g, '')); };
  return (
    <div class="code-boxes" role="group" aria-label="Mã phòng">
      {chars.map((c, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} class="cbox" inputMode="text" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck={false}
          maxLength={2} aria-label={`Ký tự ${i + 1} của mã phòng`} value={c === ' ' ? '' : c}
          onFocus={(e) => (e.target as HTMLInputElement).select()}
          onPaste={(e) => { e.preventDefault(); const v = cleanCode(e.clipboardData?.getData('text') ?? ''); onChange(v); focus(v.length >= ROOM_CODE_LENGTH ? ROOM_CODE_LENGTH - 1 : v.length); }}
          onInput={(e) => {
            const raw = (e.target as HTMLInputElement).value;
            const v = cleanCode(raw);
            if (!v) { setAt(i, ''); (e.target as HTMLInputElement).value = ''; return; }
            if (v.length > 1) { const nv = (value.slice(0, i) + v).slice(0, ROOM_CODE_LENGTH); onChange(nv); focus(nv.length >= ROOM_CODE_LENGTH ? ROOM_CODE_LENGTH - 1 : nv.length); return; }
            const a = value.padEnd(i, ' ').split(''); a[i] = v; onChange(a.join('').replace(/ /g, '').slice(0, ROOM_CODE_LENGTH));
            if (i < ROOM_CODE_LENGTH - 1) focus(i + 1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !(e.target as HTMLInputElement).value) { e.preventDefault(); setAt(i - 1, ''); focus(i - 1); }
            else if (e.key === 'ArrowLeft') focus(i - 1);
            else if (e.key === 'ArrowRight') focus(i + 1);
            else if (e.key === 'Enter') onDone();
          }} />
      ))}
    </div>
  );
}

export function NameField({ value, onChange, invalid, onEnter }: { value: string; onChange: (v: string) => void; invalid: boolean; onEnter?: () => void }): JSX.Element {
  const p = usePrefs();
  return (
    <div class="field">
      <label class="flabel" for="name">Tên bạn</label>
      <div class="namerow">
        <button type="button" class="avatar-btn" aria-label="Đổi hình đại diện" title="Đổi hình đại diện" onClick={() => { cue('click'); setPrefs({ avatar: (p.avatar + 1) % 24 }); }}>
          <Avatar i={p.avatar} size={44} />
        </button>
        <input id="name" class="input" value={value} maxLength={20} autocomplete="nickname" aria-invalid={invalid} placeholder="Nhập tên"
          onInput={(e) => onChange((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.(); }} />
      </div>
      {invalid ? <span class="err" role="alert">Nhập tên bạn</span> : null}
    </div>
  );
}

export function Home({ onSettings }: { onSettings: () => void }): JSX.Element {
  const p = usePrefs();
  const [name, setName] = useState(p.name);
  const [bad, setBad] = useState(false);
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState(false);
  const nameRef = useRef(name);
  nameRef.current = name;
  const go = (create: boolean, c: string) => {
    const n = nameRef.current.trim();
    if (!n) { setBad(true); document.getElementById('name')?.focus(); return; }
    setPrefs({ name: n });
    enterRoom(c, { name: n, avatar: prefs().avatar, create });
  };
  useEffect(() => setBad(false), [name]);
  return (
    <main class="screen home">
      <div class="top-actions"><IconButton icon="settings" label="Cài đặt" onClick={onSettings} /></div>
      <header class="hero">
        <AppMark size={64} />
        <Title />
      </header>
      <section class="card stack">
        <NameField value={name} onChange={setName} invalid={bad} onEnter={() => go(true, randomCode())} />
        <Button big tone="tomato" icon="plus" onClick={() => go(true, randomCode())}>Tạo phòng</Button>
      </section>
      <section class="card stack">
        <span class="flabel">Mã phòng</span>
        <CodeBoxes value={code} onChange={(v) => { setCode(v); setCodeErr(false); }} onDone={() => { if (ROOM_CODE_RE.test(code)) go(false, code); else setCodeErr(true); }} />
        {codeErr ? <span class="err" role="alert">Mã gồm 5 ký tự</span> : null}
        <Button big tone="teal" icon="users" onClick={() => { if (ROOM_CODE_RE.test(code)) go(false, code); else setCodeErr(true); }}>Vào phòng</Button>
      </section>
    </main>
  );
}

export function JoinLink({ code, onSettings }: { code: string; onSettings: () => void }): JSX.Element {
  const p = usePrefs();
  const [name, setName] = useState(p.name);
  const [bad, setBad] = useState(false);
  const join = () => {
    const n = name.trim();
    if (!n) { setBad(true); document.getElementById('name')?.focus(); return; }
    setPrefs({ name: n });
    enterRoom(code, { name: n, avatar: prefs().avatar, create: false });
  };
  return (
    <main class="screen home">
      <div class="top-actions"><IconButton icon="settings" label="Cài đặt" onClick={onSettings} /></div>
      <header class="hero"><AppMark size={64} /><Title /></header>
      <section class="card stack">
        <div class="room-chip" aria-label={`Phòng ${code}`}>
          {code.split('').map((c) => <b>{c}</b>)}
        </div>
        <NameField value={name} onChange={(v) => { setName(v); setBad(false); }} invalid={bad} onEnter={join} />
        <Button big tone="teal" icon="users" onClick={join}>Vào phòng</Button>
        <a class="link" href="/" onClick={(e) => { e.preventDefault(); history.replaceState(null, '', '/'); dispatchEvent(new Event('vhdc:home')); }}><Icon n="back" size={16} /> Trang chủ</a>
      </section>
    </main>
  );
}
