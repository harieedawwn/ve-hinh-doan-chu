// Scoreboard (compact: drawer, top 3, you -> full list) and chat/guess box.
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PlayerView } from '../../shared/protocol.ts';
import type { GameClient } from './net.ts';
import { Avatar, Icon } from './icons.tsx';
import { Button, IconButton, Sheet } from './ui.tsx';

function Row({ p, rank, me }: { p: PlayerView; rank: number; me: boolean }): JSX.Element {
  return (
    <li class={`prow${me ? ' me' : ''}${p.guessed ? ' ok' : ''}${p.connected ? '' : ' off'}${p.drawer ? ' dr' : ''}`}>
      <span class="rank num">{rank}</span>
      <Avatar i={p.avatar} size={24} />
      <span class="pname">{p.name}</span>
      {p.drawer ? <Icon n="pen" size={14} aria-label="Đang vẽ" /> : p.guessed ? <Icon n="check" size={14} aria-label="Đã đoán" /> : null}
      <span class="score num">{p.score}</span>
    </li>
  );
}

export function Scoreboard({ c }: { c: GameClient }): JSX.Element {
  const [all, setAll] = useState(false);
  const ps = c.room!.players;
  const sorted = ps.slice().sort((a, b) => b.score - a.score);
  const rank = new Map(sorted.map((p, i) => [p.id, i + 1]));
  const pick = new Map<string, PlayerView>();
  const dr = ps.find((p) => p.drawer);
  if (dr) pick.set(dr.id, dr);
  for (const p of sorted.slice(0, 3)) pick.set(p.id, p);
  const me = ps.find((p) => p.id === c.you);
  if (me) pick.set(me.id, me);
  const compact = [...pick.values()].sort((a, b) => (rank.get(a.id)! - rank.get(b.id)!));
  return (
    <div class="board-compact">
      <ul class="plist compact" aria-label="Bảng điểm">
        {compact.map((p) => <Row p={p} rank={rank.get(p.id)!} me={p.id === c.you} />)}
        <li class="more-li"><button type="button" class="more" onClick={() => setAll(true)} aria-label={`Tất cả ${ps.length} người chơi`}><Icon n="users" size={16} /> {ps.length}</button></li>
      </ul>
      <Sheet open={all} onClose={() => setAll(false)} title={`Bảng điểm (${ps.length})`}>
        <ul class="plist full">{sorted.map((p) => <Row p={p} rank={rank.get(p.id)!} me={p.id === c.you} />)}</ul>
      </Sheet>
    </div>
  );
}

export function Chat({ c }: { c: GameClient }): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lines = c.chat.slice(-60);
  const last = lines.length;
  useEffect(() => { const b = box.current; if (b && stick.current) b.scrollTop = b.scrollHeight; }, [last, lines[last - 1]?.at]);
  return (
    <div class="chat" ref={box} role="log" aria-live="polite" aria-label="Trò chuyện"
      onScroll={(e) => { const b = e.currentTarget; stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 24; }}>
      {lines.filter((l) => !(l.ch === 'sys' && (l.code === 'join' || l.code === 'leave'))).map((l, i) => (
        <p key={l.at + ':' + i} class={`cl ${l.ch}`}>
          {l.ch === 'team' ? <Icon n="users" size={13} /> : null}
          {l.name ? <b>{l.name}</b> : null}
          {l.name ? ' ' : ''}
          <span>{l.text}</span>
        </p>
      ))}
    </div>
  );
}

export function GuessBox({ c, placeholder }: { c: GameClient; placeholder: string }): JSX.Element {
  const [text, setText] = useState('');
  const [near, setNear] = useState(false);
  const seen = useRef(c.closeHint);
  useEffect(() => {
    if (c.closeHint === seen.current) return;
    seen.current = c.closeHint;
    setNear(true);
    const id = setTimeout(() => setNear(false), 2500);
    return () => clearTimeout(id);
  }, [c.closeHint]);
  const submit = (e: Event) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    c.send({ t: 'chat', text: t });
    setText('');
  };
  return (
    <form class="guess" onSubmit={submit}>
      {near ? <span class="near" role="status">Gần đúng!</span> : null}
      <input class="input" value={text} maxLength={120} placeholder={placeholder} aria-label={placeholder} enterkeyhint="send" autocomplete="off" autocorrect="off" spellcheck={false}
        onInput={(e) => setText((e.target as HTMLInputElement).value)} />
      <IconButton icon="send" label="Gửi" tone="tomato" onClick={submit} />
    </form>
  );
}

export { Button };
