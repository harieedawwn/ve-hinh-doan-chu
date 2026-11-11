import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { TurnEndReason } from '../../../shared/protocol.ts';
import type { GameClient } from '../net.ts';
import { Avatar, Icon } from '../icons.tsx';
import { Button, IconButton } from '../ui.tsx';
import { Toolbar } from '../draw/toolbar.tsx';
import { Chat, GuessBox, Scoreboard } from '../panels.tsx';
import { getSurface, useSeconds } from '../session.ts';
import { cue } from '../sound.ts';

const REASON: Record<TurnEndReason, string> = { allGuessed: 'Cả phòng đoán đúng', timeUp: 'Hết giờ', skipped: 'Host bỏ qua lượt', drawerLeft: 'Người vẽ đã rời' };

function MaskView({ text, word }: { text: string; word?: boolean }): JSX.Element {
  const groups = text.split(word ? / +/ : / {2,}/).filter(Boolean);
  return (
    <div class={`mask${word ? ' word' : ''}`} aria-label={word ? text : 'Từ cần đoán'}>
      {groups.map((g) => (
        <span class="mword" aria-hidden="true">
          {[...g.replace(/ /g, '')].map((ch) => (ch === '_' ? <i class="blank" /> : <b>{ch}</b>))}
        </span>
      ))}
    </div>
  );
}

function Choose({ c }: { c: GameClient }): JSX.Element {
  const ch = c.secret?.choices ?? [];
  const [own, setOwn] = useState('');
  return (
    <div class="overlay card choose">
      <h2 class="h2">Chọn từ để vẽ</h2>
      {ch.map((w, i) => <Button big tone={(['tomato', 'mustard', 'teal', 'cobalt', 'paper'] as const)[i % 5]} onClick={() => c.send({ t: 'pick', i })}>{w}</Button>)}
      {c.secret?.canCustom ? (
        <form class="guess" onSubmit={(e) => { e.preventDefault(); if (own.trim().length >= 2) c.send({ t: 'pick', word: own.trim() }); }}>
          <input class="input" value={own} maxLength={40} placeholder="Từ của bạn" aria-label="Từ của bạn" onInput={(e) => setOwn((e.target as HTMLInputElement).value)} />
          <IconButton icon="check" label="Dùng từ này" tone="teal" onClick={() => own.trim().length >= 2 && c.send({ t: 'pick', word: own.trim() })} />
        </form>
      ) : null}
    </div>
  );
}

function Reveal({ c }: { c: GameClient }): JSX.Element {
  const r = c.room!;
  const rv = r.reveal!;
  const gains = rv.deltas.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 4);
  return (
    <div class="overlay card reveal" role="status">
      <span class="flabel">{REASON[rv.reason]}</span>
      <div class="bigword">{rv.word ?? '—'}</div>
      <ul class="gains">
        {gains.map((g) => { const p = r.players.find((x) => x.id === g.id); return p ? <li><Avatar i={p.avatar} size={22} /><span class="pname">{p.name}</span><b class="num">+{g.delta}</b></li> : null; })}
      </ul>
    </div>
  );
}

export function Game({ c, onSettings }: { c: GameClient; onSettings: () => void }): JSX.Element {
  const r = c.room!;
  const s = getSurface();
  const host = useRef<HTMLDivElement>(null);
  const secs = useSeconds(c);
  const isHost = r.hostId === c.you;
  const iDraw = r.drawerId === c.you;
  const drawerName = r.players.find((p) => p.id === r.drawerId)?.name ?? '';
  const me = r.players.find((p) => p.id === c.you);
  useEffect(() => { const h = host.current; if (h && s.canvas.parentElement !== h) h.appendChild(s.canvas); }, []);
  useEffect(() => { if (r.phase === 'drawing' && !r.paused && secs !== null && secs <= 10 && secs > 0) cue('tick'); }, [secs, r.phase, r.paused]);
  const low = r.phase === 'drawing' && secs !== null && secs <= 10;
  const showTools = iDraw && r.phase === 'drawing';
  const turnTxt = r.turnsTotal ? `${r.turnNo}/${r.turnsTotal}` : String(r.turnNo);

  let maskEl: JSX.Element;
  if (r.phase === 'choosing') maskEl = <p class="maskmsg">{iDraw ? 'Chọn từ để vẽ' : `${drawerName} đang chọn từ…`}</p>;
  else if (r.phase === 'reveal') maskEl = <p class="maskmsg">Từ là: <b>{r.reveal?.word ?? '—'}</b></p>;
  else if (iDraw && c.secret?.word) maskEl = <div class="drawword"><span class="flabel">Vẽ</span><MaskView text={c.secret.word} word /></div>;
  else maskEl = <MaskView text={r.mask ?? ''} />;

  const placeholder = iDraw || me?.guessed ? 'Nhắn cho nhóm…' : r.phase === 'drawing' ? 'Đoán chữ…' : 'Nhắn mọi người…';

  return (
    <main class={`screen game${showTools ? ' has-tools' : ''}`}>
      <header class="bar">
        <span class="chip code" aria-label={`Mã phòng ${r.code}`}>{r.code}</span>
        <span class="chip" aria-label="Lượt">Lượt {turnTxt}</span>
        <span class="grow" />
        {secs !== null ? <span class={`timer num${low ? ' low' : ''}`} role="timer" aria-label="Thời gian còn lại"><Icon n="clock" size={16} /> {secs}</span> : null}
        {isHost ? <>
          <IconButton icon={r.paused ? 'play' : 'pause'} label={r.paused ? 'Tiếp tục' : 'Tạm dừng'} onClick={() => c.send({ t: 'pause' })} />
          <IconButton icon="skip" label="Bỏ qua lượt" onClick={() => c.send({ t: 'skip' })} />
        </> : null}
        <IconButton icon="settings" label="Cài đặt" onClick={onSettings} />
      </header>
      <div class="maskbar">{maskEl}</div>
      <div class="board">
        <div class="cv-wrap">
          <div class="cv-box" ref={host}>
            {r.phase === 'choosing' && iDraw ? <Choose c={c} /> : null}
            {r.phase === 'choosing' && !iDraw ? <div class="overlay card wait"><Avatar i={r.players.find((p) => p.id === r.drawerId)?.avatar ?? 0} size={40} /><p>{drawerName} đang chọn từ</p></div> : null}
            {r.phase === 'reveal' && r.reveal ? <Reveal c={c} /> : null}
            {r.paused ? <div class="overlay card wait"><Icon n="pause" size={28} /><p>Tạm dừng</p></div> : null}
          </div>
        </div>
      </div>
      {showTools ? <Toolbar s={s} /> : null}
      <aside class="side">
        <Scoreboard c={c} />
        <Chat c={c} />
        <GuessBox c={c} placeholder={placeholder} />
      </aside>
    </main>
  );
}
