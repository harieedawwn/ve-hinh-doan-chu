import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { CATEGORY_IDS, CATEGORY_LABELS, type CategoryId, type Difficulty } from '../../../shared/words/index.ts';
import { SETTING_RANGES, type DrawerMode, type EndBy, type PlayerView, type Settings } from '../../../shared/protocol.ts';
import type { GameClient } from '../net.ts';
import { Avatar, Icon } from '../icons.tsx';
import { Accordion, Button, Chips, IconButton, Seg, Sheet, Stepper, Switch, toast } from '../ui.tsx';
import { copyText, env, shareLink } from '../platform.ts';
import { leaveRoom } from '../session.ts';

const shareUrl = (code: string): string => `${location.origin}/r/${code}`;

function QrSvg({ text }: { text: string }): JSX.Element | null {
  const [mods, setMods] = useState<boolean[][] | null>(null);
  useEffect(() => {
    let alive = true;
    void import('qrcode-generator').then((m) => {
      const q = m.default(0, 'M'); q.addData(text); q.make();
      const n = q.getModuleCount();
      if (alive) setMods(Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c))));
    });
    return () => { alive = false; };
  }, [text]);
  if (!mods) return <div class="qr" aria-busy="true" />;
  const n = mods.length, pad = 2;
  let d = '';
  mods.forEach((row, r) => row.forEach((on, c) => { if (on) d += `M${c + pad} ${r + pad}h1v1h-1z`; }));
  return (
    <svg class="qr" viewBox={`0 0 ${n + pad * 2} ${n + pad * 2}`} role="img" aria-label="Mã QR vào phòng" shape-rendering="crispEdges">
      <rect width="100%" height="100%" fill="#fff" /><path d={d} fill="#1e1b18" />
    </svg>
  );
}

function ShareCard({ code }: { code: string }): JSX.Element {
  const [qr, setQr] = useState(false);
  const url = shareUrl(code);
  return (
    <section class="card stack share">
      <div class="room-chip" aria-label={`Mã phòng ${code}`}>{code.split('').map((c) => <b>{c}</b>)}</div>
      <div class="btnrow">
        {env.canShare ? <Button tone="cobalt" icon="share" onClick={() => void shareLink(url, 'Vào phòng Vẽ hình đoán chữ')}>Chia sẻ</Button> : null}
        <Button icon="copy" onClick={async () => toast((await copyText(url)) ? 'Đã chép liên kết' : 'Không chép được')}>Chép liên kết</Button>
        <Button icon="qr" onClick={() => setQr(true)}>Mã QR</Button>
      </div>
      <Sheet open={qr} onClose={() => setQr(false)} title="Quét để vào">
        <QrSvg text={url} />
        <p class="mono center">{location.host}/r/{code}</p>
      </Sheet>
    </section>
  );
}

const MODES: [DrawerMode, string][] = [['rotate', 'Lần lượt'], ['hostOnly', 'Chỉ host vẽ'], ['hostMC', 'Host không vẽ']];
const ENDS: [EndBy, string][] = [['auto', 'Tự động'], ['rounds', 'Theo vòng'], ['turns', 'Theo lượt']];
const DIFFS: [Difficulty, string][] = [['easy', 'Dễ'], ['medium', 'Vừa'], ['hard', 'Khó']];

function HostSettings({ c }: { c: GameClient }): JSX.Element {
  const s = c.room!.settings;
  const set = (patch: Partial<Settings>) => c.send({ t: 'settings', patch });
  const [words, setWords] = useState(c.customWords.join('\n'));
  useEffect(() => setWords(c.customWords.join('\n')), [c.customWords]);
  const R = SETTING_RANGES;
  return (
    <div class="settings">
      <Accordion title="Chế độ" icon="users" defaultOpen>
        <Seg label="Ai vẽ" value={s.mode} options={MODES} onChange={(mode) => set({ mode })} />
        <Seg label="Kết thúc" value={s.endBy} options={ENDS} onChange={(endBy) => set({ endBy })} />
        <Stepper label="Số vòng" value={s.rounds} min={R.rounds[0]} max={R.rounds[1]} onChange={(rounds) => set({ rounds })} />
        <Stepper label="Số lượt vẽ" value={s.turns} min={R.turns[0]} max={R.turns[1]} step={s.turns >= 20 ? 5 : 1} onChange={(turns) => set({ turns })} />
      </Accordion>
      <Accordion title="Thời gian" icon="clock">
        <Stepper label="Thời gian vẽ" unit="s" value={s.drawTime} min={R.drawTime[0]} max={R.drawTime[1]} step={10} onChange={(drawTime) => set({ drawTime })} />
        <Stepper label="Thời gian chọn" unit="s" value={s.chooseTime} min={R.chooseTime[0]} max={R.chooseTime[1]} step={5} onChange={(chooseTime) => set({ chooseTime })} />
        <Stepper label="Số gợi ý" value={s.hints} min={R.hints[0]} max={R.hints[1]} onChange={(hints) => set({ hints })} />
        <Stepper label="Số từ để chọn" value={s.wordChoices} min={R.wordChoices[0]} max={R.wordChoices[1]} onChange={(wordChoices) => set({ wordChoices })} />
      </Accordion>
      <Accordion title="Từ vựng" icon="pen">
        <Chips<CategoryId> label="Chủ đề" value={s.categories} options={CATEGORY_IDS.map((id) => [id, CATEGORY_LABELS[id]])} onChange={(categories) => set({ categories })} />
        <Chips<Difficulty> label="Độ khó" value={s.difficulties} options={DIFFS} onChange={(difficulties) => set({ difficulties })} />
        <label class="field">
          <span class="flabel">Từ riêng ({s.customWordCount})</span>
          <textarea class="input area" rows={4} value={words} maxLength={6000} placeholder="Mỗi dòng một từ"
            onInput={(e) => setWords((e.target as HTMLTextAreaElement).value)}
            onBlur={() => set({ customWords: words as unknown as string[] })} />
        </label>
        <Switch label="Chỉ dùng từ riêng" value={s.onlyCustom} onChange={(onlyCustom) => set({ onlyCustom })} />
      </Accordion>
      <Accordion title="Luật chơi" icon="flag">
        <Switch label="Không cần dấu" value={s.accentInsensitive} onChange={(accentInsensitive) => set({ accentInsensitive })} />
        <Switch label="Báo gần đúng" value={s.showClose} onChange={(showClose) => set({ showClose })} />
        {s.mode === 'hostMC' ? <Switch label="Host được đoán" value={s.hostGuesses} onChange={(hostGuesses) => set({ hostGuesses })} /> : null}
      </Accordion>
      <Accordion title="Phòng" icon="settings">
        <Switch label="Khóa phòng" value={s.locked} onChange={(locked) => set({ locked })} />
        <Switch label="Vào giữa ván" value={s.allowLateJoin} onChange={(allowLateJoin) => set({ allowLateJoin })} />
        <Stepper label="Số người tối đa" value={s.maxPlayers} min={R.maxPlayers[0]} max={R.maxPlayers[1]} onChange={(maxPlayers) => set({ maxPlayers })} />
      </Accordion>
    </div>
  );
}

function Summary({ c }: { c: GameClient }): JSX.Element {
  const s = c.room!.settings;
  const mode = MODES.find((m) => m[0] === s.mode)![1];
  return (
    <ul class="tags" aria-label="Luật phòng">
      <li>{mode}</li><li>{s.drawTime}s mỗi lượt</li><li>{s.endBy === 'turns' || (s.endBy === 'auto' && c.room!.players.length > 12) ? `${s.turns} lượt` : `${s.rounds} vòng`}</li>
      {s.locked ? <li>Phòng khóa</li> : null}
    </ul>
  );
}

function PlayerSheet({ c, p, onClose }: { c: GameClient; p: PlayerView | null; onClose: () => void }): JSX.Element {
  const [sure, setSure] = useState(false);
  useEffect(() => setSure(false), [p?.id]);
  if (!p) return <Sheet open={false} onClose={onClose} title="" children={null} />;
  return (
    <Sheet open onClose={onClose} title={p.name}>
      <div class="stack">
        <Button icon="crown" onClick={() => { c.send({ t: 'host', id: p.id }); onClose(); }}>Chuyển host</Button>
        <Button icon="nochat" onClick={() => { c.send({ t: 'mute', id: p.id, on: !p.muted }); onClose(); }}>{p.muted ? 'Bật chat' : 'Tắt chat'}</Button>
        <Button tone="tomato" icon="kick" onClick={() => { if (sure) { c.send({ t: 'kick', id: p.id }); onClose(); } else setSure(true); }}>{sure ? 'Chắc chưa?' : 'Mời ra'}</Button>
      </div>
    </Sheet>
  );
}

export function Lobby({ c, onSettings }: { c: GameClient; onSettings: () => void }): JSX.Element {
  const r = c.room!;
  const isHost = r.hostId === c.you;
  const [pick, setPick] = useState<PlayerView | null>(null);
  const online = r.players.filter((p) => p.connected).length;
  const need = r.settings.mode === 'hostMC' ? 2 : 2;
  return (
    <main class="screen lobby">
      <header class="bar">
        <IconButton icon="leave" label="Rời phòng" onClick={() => leaveRoom()} />
        <h1 class="bar-title">Phòng chờ</h1>
        <IconButton icon="settings" label="Cài đặt" onClick={onSettings} />
      </header>
      <div class="scroll">
        <ShareCard code={r.code} />
        <section class="card stack">
          <h2 class="h2"><Icon n="users" size={20} /> Người chơi <span class="num">{online}/{r.settings.maxPlayers}</span></h2>
          <ul class="pgrid">
            {r.players.map((p) => (
              <li>
                <button type="button" class={`pcard${p.connected ? '' : ' off'}${p.id === c.you ? ' me' : ''}`} disabled={!isHost || p.id === c.you} onClick={() => setPick(p)} aria-label={isHost && p.id !== c.you ? `Quản lý ${p.name}` : p.name}>
                  <Avatar i={p.avatar} size={36} />
                  <span class="pname">{p.name}</span>
                  {p.host ? <Icon n="crown" size={16} aria-label="Host" /> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
        {isHost ? <HostSettings c={c} /> : <section class="card"><Summary c={c} /></section>}
      </div>
      <footer class="dock">
        {isHost ? (
          <Button big tone="tomato" icon="play" disabled={online < need} onClick={() => c.send({ t: 'start' })}>{online < need ? 'Cần thêm người' : 'Bắt đầu'}</Button>
        ) : <p class="wait">Chờ host bắt đầu…</p>}
      </footer>
      <PlayerSheet c={c} p={pick} onClose={() => setPick(null)} />
    </main>
  );
}
