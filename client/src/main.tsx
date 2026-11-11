// Minimal DEBUG page: proves the server, protocol and canvas engine. The real UI is built in stage 2.
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CANVAS_H, CANVAS_W } from '../../shared/constants.ts';
import { CanvasEngine, pixelHash } from '../../shared/canvas/engine.ts';
import { Playback } from '../../shared/canvas/playback.ts';
import type { Op } from '../../shared/canvas/ops.ts';
import { GameClient } from './net.ts';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../shared/constants.ts';


const codeFromPath = (): string | null => /^\/r\/([A-Za-z0-9]{5})\/?$/.exec(location.pathname)?.[1]?.toUpperCase() ?? null;
const randomCode = (): string => Array.from(crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH)), (b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join('');

function App() {
  const [code, setCode] = useState<string | null>(codeFromPath());
  const [name, setName] = useState(() => { try { return localStorage.getItem('vhdc:name') ?? ''; } catch { return ''; } });
  const [client, setClient] = useState<GameClient | null>(null);
  const [, bump] = useState(0);
  const [tool, setTool] = useState<'pen' | 'eraser' | 'fill'>('pen');
  const [color, setColor] = useState('#e03131');
  const [size, setSize] = useState(8);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const toolRef = useRef({ tool, color, size });
  toolRef.current = { tool, color, size };

  function enter(c: string, create: boolean) {
    try { localStorage.setItem('vhdc:name', name); } catch { /* ignore */ }
    history.replaceState(null, '', '/r/' + c);
    setCode(c);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const gc = new GameClient({ url: `${proto}://${location.host}/ws/${c}`, code: c, name: name || 'Khách', avatar: Math.floor(Math.random() * 24), create, storage: localStorage });
    gc.on('change', () => bump((n) => n + 1));
    setClient(gc);
  }

  // returning visitor (page reload / reopened link): rejoin the same seat automatically
  useEffect(() => {
    const c = codeFromPath();
    let has = false;
    try { has = !!c && !!localStorage.getItem('vhdc:' + c); } catch { /* ignore */ }
    if (c && has) enter(c, false);
  }, []);

  // canvas engine bound to the <canvas> once it exists
  useEffect(() => {
    if (!client || !cvRef.current) return;
    const cv = cvRef.current;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    const engine = new CanvasEngine(ctx as never);
    const playback = new Playback(engine);
    client.attachEngine(engine, playback);
    client.connect();
    let raf = 0;
    const loop = () => { playback.tick(Date.now()); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    (window as unknown as Record<string, unknown>).__vhdc = {
      client, engine,
      pixelHash: () => { playback.flush(); return pixelHash(engine.pixels()); },
      opHash: () => client.log.hash,
      opCount: () => client.log.length,
    };
    return () => { cancelAnimationFrame(raf); client.close(); };
  }, [client]);

  // pointer drawing
  useEffect(() => {
    const cv = cvRef.current;
    if (!client || !cv) return;
    let down = false, lx = 0, ly = 0;
    let pending: number[] = [];
    const pos = (e: PointerEvent): [number, number] => {
      const r = cv.getBoundingClientRect();
      return [Math.min(CANVAS_W, Math.max(0, Math.round(((e.clientX - r.left) * CANVAS_W) / r.width))), Math.min(CANVAS_H, Math.max(0, Math.round(((e.clientY - r.top) * CANVAS_H) / r.height)))];
    };
    const flush = () => { if (pending.length) { client.draw([{ k: 'm', p: pending }]); pending = []; } };
    const colorInt = () => parseInt(toolRef.current.color.slice(1), 16);
    const onDown = (e: PointerEvent) => {
      if (!client.isDrawer) return;
      const [x, y] = pos(e);
      const t = toolRef.current;
      if (t.tool === 'fill') { client.draw([{ k: 'f', x, y, c: colorInt() }]); return; }
      cv.setPointerCapture(e.pointerId);
      down = true; lx = x; ly = y;
      client.draw([{ k: 'b', t: t.tool === 'eraser' ? 1 : 0, c: t.tool === 'eraser' ? 0xffffff : colorInt(), w: t.size, x, y }]);
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const evs = e.getCoalescedEvents?.() ?? [e];
      for (const ev of evs.length ? evs : [e]) {
        const [x, y] = pos(ev);
        if (x === lx && y === ly) continue;
        pending.push(x - lx, y - ly); lx = x; ly = y;
        if (pending.length >= 64) flush();
      }
      flush();
    };
    const onUp = () => { if (down) { flush(); down = false; } };
    cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp);
    return () => { cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerup', onUp); cv.removeEventListener('pointercancel', onUp); };
  }, [client]);

  const room = client?.room;
  const [chatText, setChatText] = useState('');
  const [settingsText, setSettingsText] = useState('');
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const id = setInterval(() => { if (client?.room?.phaseEndsAt) setLeft(Math.max(0, Math.round((client.room.phaseEndsAt - client.serverNow()) / 1000))); else setLeft(0); }, 250);
    return () => clearInterval(id);
  }, [client]);

  if (!client) {
    return (
      <div>
        <h1>Vẽ hình đoán chữ (trang thử nghiệm)</h1>
        <div class="row">
          <input id="name" placeholder="Tên của bạn" value={name} maxLength={20} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <button id="create" onClick={() => enter(randomCode(), true)}>Tạo phòng</button>
        </div>
        <div class="row">
          <input id="code" placeholder="Mã phòng" value={code ?? ''} maxLength={5} onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())} />
          <button id="join" onClick={() => code && enter(code, false)}>Vào phòng</button>
        </div>
      </div>
    );
  }

  const isHost = room?.hostId === client.you;
  const secret = client.secret;
  const canDraw = client.isDrawer;
  const send = client.send.bind(client);
  const sendDraw = (ops: Op[]) => client.draw(ops);
  return (
    <div>
      <h1>Phòng <b id="roomcode">{code}</b> · <span id="status">{client.status}</span>{client.fatal ? ` · LỖI: ${client.fatal.msg}` : ''}</h1>
      <div class="players" id="players">
        {room?.players.map((p) => (
          <span class={`${p.connected ? '' : 'off'} ${p.guessed ? 'ok' : ''} ${p.drawer ? 'dr' : ''}`}>{p.host ? '👑 ' : ''}{p.name}: {p.score}{p.delta ? ` (+${p.delta})` : ''}</span>
        ))}
      </div>
      <div class="row">
        <span id="phase">{room?.phase}</span>
        {room?.phaseEndsAt ? <b id="timer">{left}s</b> : null}
        {room?.paused ? <b>⏸ tạm dừng</b> : null}
        <span class="word" id="mask">{canDraw ? secret?.word : room?.mask}</span>
        {room?.reveal ? <b id="reveal">Từ: {room.reveal.word ?? '—'}</b> : null}
      </div>
      {room?.phase === 'choosing' && secret?.choices ? (
        <div class="row" id="choices">{secret.choices.map((w, i) => <button onClick={() => send({ t: 'pick', i })}>{w}</button>)}</div>
      ) : null}
      {isHost ? (
        <div class="row">
          {room?.phase === 'lobby' ? <button id="start" onClick={() => send({ t: 'start' })}>Bắt đầu</button> : null}
          {room?.phase === 'podium' ? <button onClick={() => send({ t: 'again' })}>Chơi lại</button> : null}
          <button onClick={() => send({ t: 'pause' })}>Tạm dừng</button>
          <button onClick={() => send({ t: 'skip' })}>Bỏ qua lượt</button>
          <button onClick={() => send({ t: 'end' })}>Kết thúc</button>
        </div>
      ) : null}
      <canvas id="cv" ref={cvRef} width={CANVAS_W} height={CANVAS_H} />
      <div class="row" id="tools" style={{ opacity: canDraw ? 1 : 0.5 }}>
        {(['pen', 'eraser', 'fill'] as const).map((t) => <button class={tool === t ? 'on' : ''} onClick={() => setTool(t)}>{t === 'pen' ? 'Bút' : t === 'eraser' ? 'Tẩy' : 'Đổ màu'}</button>)}
        <input type="color" value={color} onInput={(e) => setColor((e.target as HTMLInputElement).value)} />
        <input type="range" min="2" max="60" value={size} onInput={(e) => setSize(+(e.target as HTMLInputElement).value)} />
        <button id="undo" onClick={() => sendDraw([{ k: 'u' }])}>Hoàn tác</button>
        <button id="redo" onClick={() => sendDraw([{ k: 'r' }])}>Làm lại</button>
        <button id="clear" onClick={() => sendDraw([{ k: 'x' }])}>Xóa hết</button>
      </div>
      <div id="chat" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
        {client.chat.map((c) => <div class={c.ch}>{c.name ? <b>{c.name}: </b> : null}{c.text}</div>)}
      </div>
      <form class="row" onSubmit={(e) => { e.preventDefault(); if (chatText.trim()) { send({ t: 'chat', text: chatText }); setChatText(''); } }}>
        <input id="chatin" style={{ flex: 1 }} placeholder="Đoán hoặc chat…" value={chatText} maxLength={120} onInput={(e) => setChatText((e.target as HTMLInputElement).value)} />
        <button>Gửi</button>
        {client.closeHint ? <small>Gần đúng! ({client.closeHint})</small> : null}
      </form>
      {isHost && room?.phase === 'lobby' ? (
        <details>
          <summary>Cài đặt (JSON)</summary>
          <textarea rows={8} style={{ width: '100%' }} value={settingsText || JSON.stringify({ ...room.settings, customWords: client.customWords }, null, 1)} onInput={(e) => setSettingsText((e.target as HTMLTextAreaElement).value)} />
          <button onClick={() => { try { send({ t: 'settings', patch: JSON.parse(settingsText) }); } catch { /* invalid json */ } }}>Áp dụng</button>
        </details>
      ) : null}
      <details><summary>Trạng thái</summary><pre>{JSON.stringify(room, null, 1)}</pre></details>
      <small id="net">rtt {Math.round(client.rtt)}ms · offset {Math.round(client.offset)}ms · rx {client.stats.rxMsgs} · resync {client.resyncs}</small>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
