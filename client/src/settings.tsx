import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { GameClient } from './net.ts';
import { Button, Sheet, Switch } from './ui.tsx';
import { enterFullscreen, env, exitFullscreen, fullscreenSupported, isFullscreen, openInBrowser } from './platform.ts';
import { setPrefs, usePrefs } from './prefs.ts';
import { leaveRoom } from './session.ts';

/** Turn fullscreen on; if the browser refuses (Zalo / iPhone), explain the working alternatives. */
export async function goFullscreen(): Promise<boolean> {
  if (!fullscreenSupported()) return false;
  return enterFullscreen();
}

export function FullscreenAlt({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div class="stack">
      <p class="note">{env.iphone ? 'iPhone chưa hỗ trợ toàn màn hình.' : 'Trình duyệt này không cho toàn màn hình.'}</p>
      {env.inApp ? <Button icon="external" onClick={() => { openInBrowser(location.href); onClose(); }}>Mở bằng trình duyệt</Button> : null}
      {env.ios ? <p class="note"><b>Chia sẻ</b> → <b>Thêm vào MH chính</b></p> : <p class="note">Menu <b>⋮</b> → <b>Thêm vào màn hình chính</b></p>}
      <Button onClick={onClose}>Đã hiểu</Button>
    </div>
  );
}

export function FullscreenAsk({ onDone }: { onDone: () => void }): JSX.Element {
  const [alt, setAlt] = useState(false);
  const answer = async (yes: boolean) => {
    setPrefs({ fs: yes ? 'yes' : 'no' });
    if (!yes) return onDone();
    if (await goFullscreen()) return onDone();
    setAlt(true);
  };
  return (
    <Sheet open onClose={() => { setPrefs({ fs: 'no' }); onDone(); }} title="Chơi toàn màn hình?">
      {alt ? <FullscreenAlt onClose={onDone} /> : (
        <div class="actions">
          <Button onClick={() => void answer(false)}>Không</Button>
          <Button tone="teal" icon="maximize" onClick={() => void answer(true)}>Có</Button>
        </div>
      )}
    </Sheet>
  );
}

export function SettingsSheet({ open, onClose, c }: { open: boolean; onClose: () => void; c: GameClient | null }): JSX.Element {
  const p = usePrefs();
  const [alt, setAlt] = useState(false);
  const [sure, setSure] = useState(false);
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);
  const room = c?.room;
  const isHost = !!room && room.hostId === c?.you;
  const fsOk = fullscreenSupported();
  return (
    <Sheet open={open} onClose={() => { setAlt(false); setSure(false); onClose(); }} title="Cài đặt">
      <div class="stack">
        <Switch icon={p.sound ? 'sound' : 'mute'} label="Âm thanh" value={p.sound} onChange={(sound) => setPrefs({ sound })} />
        {env.canVibrate ? <Switch icon="vibrate" label="Rung" value={p.vibrate} onChange={(vibrate) => setPrefs({ vibrate })} /> : null}
        <Switch icon="maximize" label="Toàn màn hình" value={p.fs === 'yes' && (isFullscreen() || !fsOk)}
          onChange={async (v) => {
            if (!v) { setPrefs({ fs: 'no' }); await exitFullscreen(); return; }
            setPrefs({ fs: 'yes' });
            if (!(await goFullscreen())) setAlt(true);
          }} />
        {alt || (!fsOk && p.fs === 'yes') ? <FullscreenAlt onClose={() => setAlt(false)} /> : null}
        <Switch icon="hand" label="Thuận tay trái" value={p.left} onChange={(left) => setPrefs({ left })} />
        <Switch icon={p.theme === 'dark' ? 'moon' : 'sun'} label="Giao diện tối" value={p.theme === 'dark'} onChange={(d) => setPrefs({ theme: d ? 'dark' : 'light' })} />
        {room && isHost && room.phase !== 'lobby' && room.phase !== 'podium' ? (
          <Button tone="tomato" icon="flag" onClick={() => { if (sure) { c!.send({ t: 'end' }); setSure(false); onClose(); } else setSure(true); }}>{sure ? 'Chắc chưa?' : 'Kết thúc ván'}</Button>
        ) : null}
        {room ? <Button icon="leave" onClick={() => { onClose(); leaveRoom(); }}>Rời phòng</Button> : null}
      </div>
    </Sheet>
  );
}
