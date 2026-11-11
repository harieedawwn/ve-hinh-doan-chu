import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.tsx';
import { Button, Toaster } from './ui.tsx';
import { Home, JoinLink } from './screens/home.tsx';
import { Lobby } from './screens/lobby.tsx';
import { Game } from './screens/game.tsx';
import { Gallery, Podium } from './screens/podium.tsx';
import { FullscreenAsk, SettingsSheet, goFullscreen } from './settings.tsx';
import { enterRoom, leaveRoom, useSession } from './session.ts';
import { prefs, usePrefs } from './prefs.ts';
import { roomCodeFromPath, store } from './platform.ts';

function Notice({ title, text, action, onAction }: { title: string; text: string; action: string; onAction: () => void }): JSX.Element {
  return (
    <main class="screen center-screen">
      <section class="card stack notice" role="alert">
        <Icon n="offline" size={40} />
        <h1 class="h2">{title}</h1>
        <p>{text}</p>
        <Button big tone="tomato" onClick={onAction}>{action}</Button>
      </section>
    </main>
  );
}

export function App(): JSX.Element {
  const { client } = useSession();
  const p = usePrefs();
  const [settings, setSettings] = useState(false);
  const [askFs, setAskFs] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [, setHome] = useState(0);
  const pathCode = roomCodeFromPath();

  // returning player (reload / reopened link): rejoin the same seat without asking again
  useEffect(() => {
    const c = roomCodeFromPath();
    if (c && store.getItem('vhdc:' + c) && prefs().name.trim()) enterRoom(c, { name: prefs().name.trim(), avatar: prefs().avatar, create: false });
    const h = () => setHome((n) => n + 1);
    addEventListener('vhdc:home', h);
    return () => removeEventListener('vhdc:home', h);
  }, []);

  // first visit: ask once; later visits re-enter fullscreen on the first tap (browsers require a gesture)
  useEffect(() => {
    if (p.fs === 'ask') { setAskFs(true); return; }
    if (p.fs === 'yes') {
      const go = () => { void goFullscreen(); removeEventListener('pointerup', go, true); };
      addEventListener('pointerup', go, true);
      return () => removeEventListener('pointerup', go, true);
    }
  }, []);

  useEffect(() => { if (!client || client.room?.phase !== 'podium') setGallery(false); }, [client?.room?.phase, client]);

  const open = () => setSettings(true);
  const c = client;
  let body: JSX.Element;
  if (c?.fatal) {
    body = <Notice title="Không vào được" text={c.fatal.msg} action="Về trang chủ" onAction={() => leaveRoom()} />;
  } else if (c && !c.room) {
    body = (session_gaveUp()
      ? <Notice title="Máy chủ đang bận" text="Thử lại sau ít phút." action="Thử lại" onAction={() => location.reload()} />
      : <main class="screen center-screen"><p class="loading" role="status">Đang vào phòng…</p></main>);
  } else if (c?.room) {
    const ph = c.room.phase;
    body = ph === 'lobby' ? <Lobby c={c} onSettings={open} />
      : ph === 'podium' ? (gallery ? <Gallery onBack={() => setGallery(false)} /> : <Podium c={c} onGallery={() => setGallery(true)} onSettings={open} />)
      : <Game c={c} onSettings={open} />;
  } else if (pathCode) {
    body = <JoinLink code={pathCode} onSettings={open} />;
  } else {
    body = <Home onSettings={open} />;
  }

  return (
    <div class={`app${p.left ? ' lefty' : ''}`}>
      {body}
      {c?.room && c.status !== 'open' && !c.fatal ? (
        <div class="banner" role="status"><Icon n="offline" size={18} /> Đang kết nối lại</div>
      ) : null}
      <SettingsSheet open={settings} onClose={() => setSettings(false)} c={c} />
      {askFs ? <FullscreenAsk onDone={() => setAskFs(false)} /> : null}
      <Toaster />
    </div>
  );
}

import { session } from './session.ts';
function session_gaveUp(): boolean { return session.gaveUp; }
