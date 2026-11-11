// One icon set: lucide, imported by name so unused icons are tree-shaken.
import type { JSX } from 'preact';
import {
  Pencil, Eraser, PaintBucket, Pipette, Undo2, Redo2, Trash2, Settings, Share2, Copy, QrCode, Crown, Check, X, Pause, Play,
  SkipForward, Maximize, Minimize, Volume2, VolumeX, Vibrate, Hand, Sun, Moon, Users, ChevronDown, ChevronUp, Download,
  LogOut, Images, SendHorizontal, Palette, UserX, MessageSquareOff, WifiOff, Flag, Plus, Minus, Cat, Dog, Bird, Fish, Rabbit,
  Turtle, ExternalLink, MessageCircle, RotateCcw, ArrowLeft, Clock, Trophy, Smartphone,
} from 'lucide';

type Node = [string, Record<string, string | number>][];
const ICONS = {
  pen: Pencil, eraser: Eraser, fill: PaintBucket, pick: Pipette, undo: Undo2, redo: Redo2, trash: Trash2, settings: Settings,
  share: Share2, copy: Copy, qr: QrCode, crown: Crown, check: Check, x: X, pause: Pause, play: Play, skip: SkipForward,
  maximize: Maximize, minimize: Minimize, sound: Volume2, mute: VolumeX, vibrate: Vibrate, hand: Hand, sun: Sun, moon: Moon,
  users: Users, down: ChevronDown, up: ChevronUp, download: Download, leave: LogOut, images: Images, send: SendHorizontal,
  palette: Palette, kick: UserX, nochat: MessageSquareOff, offline: WifiOff, flag: Flag, plus: Plus, minus: Minus,
  cat: Cat, dog: Dog, bird: Bird, fish: Fish, rabbit: Rabbit, turtle: Turtle, external: ExternalLink, chat: MessageCircle,
  again: RotateCcw, back: ArrowLeft, clock: Clock, trophy: Trophy, phone: Smartphone,
} as unknown as Record<string, Node>;

export type IconName = keyof typeof ICONS;

export function Icon({ n, size = 22, stroke = 2.25, ...rest }: { n: string; size?: number; stroke?: number; 'aria-label'?: string }): JSX.Element {
  const nodes = ICONS[n] ?? [];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={stroke}
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {nodes.map(([tag, attrs], i) => { const T = tag as 'path'; return <T key={i} {...(attrs as object)} />; })}
    </svg>
  );
}

const ANIMALS = ['cat', 'dog', 'bird', 'fish', 'rabbit', 'turtle'];
const TONES = ['tomato', 'mustard', 'teal', 'cobalt'];
/** 24 avatars = 6 animals x 4 accent colours. */
export function Avatar({ i, size = 40, ring = false }: { i: number; size?: number; ring?: boolean }): JSX.Element {
  const k = ((i % 24) + 24) % 24;
  return (
    <span class={`avatar tone-${TONES[k % 4]}${ring ? ' ring' : ''}`} style={{ width: size + 'px', height: size + 'px' }}>
      <Icon n={ANIMALS[Math.floor(k / 4) % 6]} size={Math.round(size * 0.58)} stroke={2.4} />
    </span>
  );
}
