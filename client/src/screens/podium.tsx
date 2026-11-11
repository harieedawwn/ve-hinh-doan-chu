import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { GameClient } from '../net.ts';
import { Avatar, Icon } from '../icons.tsx';
import { Button, IconButton, Sheet, toast } from '../ui.tsx';
import { env } from '../platform.ts';
import { leaveRoom, useSession, type GalleryItem } from '../session.ts';

export function Podium({ c, onGallery, onSettings }: { c: GameClient; onGallery: () => void; onSettings: () => void }): JSX.Element {
  const r = c.room!;
  const pod = r.podium ?? [];
  const top = pod.slice(0, 3);
  const order = [top[1], top[0], top[2]]; // 2nd, 1st, 3rd
  const isHost = r.hostId === c.you;
  const { gallery } = useSession();
  return (
    <main class="screen podium">
      <header class="bar">
        <IconButton icon="leave" label="Rời phòng" onClick={() => leaveRoom()} />
        <h1 class="bar-title">Kết quả</h1>
        <IconButton icon="settings" label="Cài đặt" onClick={onSettings} />
      </header>
      <div class="scroll">
        <ol class="steps" aria-label="Top 3">
          {order.map((p, k) => p ? (
            <li class={`step s${[2, 1, 3][k]}${p.id === c.you ? ' me' : ''}`}>
              <Avatar i={p.avatar} size={48} ring />
              <span class="pname">{p.name}</span>
              <b class="num pts">{p.score}</b>
              <span class="block"><span class="place num">{p.rank}</span></span>
            </li>
          ) : <li class="step empty" />)}
        </ol>
        {pod.length > 3 ? (
          <ol class="plist full card" start={4}>
            {pod.slice(3).map((p) => (
              <li class={`prow${p.id === c.you ? ' me' : ''}`}>
                <span class="rank num">{p.rank}</span><Avatar i={p.avatar} size={28} /><span class="pname">{p.name}</span><span class="score num">{p.score}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
      <footer class="dock btnrow">
        {gallery.length ? <Button icon="images" onClick={onGallery}>Tranh ({gallery.length})</Button> : null}
        {isHost ? <Button big tone="tomato" icon="again" onClick={() => c.send({ t: 'again' })}>Chơi lại</Button> : <p class="wait">Chờ host…</p>}
      </footer>
    </main>
  );
}

async function save(g: GalleryItem): Promise<void> {
  const file = new File([g.blob], `${g.word || 've-hinh'}.png`, { type: 'image/png' });
  try {
    if (env.touch && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: g.word }); return; }
  } catch { /* cancelled or unsupported: fall through */ }
  try {
    const a = document.createElement('a');
    a.href = g.url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    toast(env.inApp ? 'Nhấn giữ ảnh để lưu' : 'Đã lưu ảnh');
  } catch { toast('Nhấn giữ ảnh để lưu'); }
}

export function Gallery({ onBack }: { onBack: () => void }): JSX.Element {
  const { gallery } = useSession();
  const [open, setOpen] = useState<GalleryItem | null>(null);
  return (
    <main class="screen gallery">
      <header class="bar">
        <IconButton icon="back" label="Quay lại" onClick={onBack} />
        <h1 class="bar-title">Tranh của ván</h1>
        <span class="bar-spacer" />
      </header>
      <div class="scroll">
        <ul class="ggrid">
          {gallery.map((g) => (
            <li>
              <button type="button" class="gcard" onClick={() => setOpen(g)} aria-label={`Xem tranh ${g.word}`}>
                <img src={g.url} alt={`Tranh: ${g.word}`} width={300} height={225} loading="lazy" />
                <span class="gcap"><b>{g.word}</b><small>{g.drawer}</small></span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.word ?? ''} wide>
        {open ? <>
          <img class="gfull" src={open.url} alt={`Tranh: ${open.word}`} />
          <p class="by"><Icon n="pen" size={14} /> {open.drawer}</p>
          {env.inApp ? <p class="by">Nhấn giữ ảnh để lưu</p> : null}
          <div class="actions"><Button tone="teal" icon="download" onClick={() => void save(open)}>Lưu ảnh</Button></div>
        </> : null}
      </Sheet>
    </main>
  );
}
