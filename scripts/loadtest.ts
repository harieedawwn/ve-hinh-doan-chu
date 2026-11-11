// 42-bot load test against `wrangler dev` (started automatically; set TARGET_URL to test a running server).
// One drawer (the host, "Chỉ host vẽ") streams realistic strokes for a full turn, the other bots chat and guess,
// 5 bots drop and reconnect mid-turn, 1 bot joins late. Writes reports/loadtest.md and exits non-zero on any failure.
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import { GameClient } from '../client/src/net.ts';
import { ROOM_CODE_ALPHABET } from '../shared/constants.ts';
import type { Op } from '../shared/canvas/ops.ts';
import type { Browser, Page } from 'playwright-core';
import { ensureServer } from './lib/dev-server.ts';
import { launch, newPlayer, waitFor as waitSel } from './lib/ui-helpers.ts';

const BOTS = Number(process.env.BOTS ?? 42);
const WITH_PAGE = process.env.PAGE !== '0'; // one real Chromium page (phone viewport) joins the room and probes frame times
const DRAW_SECONDS = Number(process.env.DRAW_SECONDS ?? 60);
const DROPPERS = 5;
const HOLDOUTS = 4; // never guess: keeps the turn running to the full time limit
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pct = (a: number[], p: number) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : 'n/a');

// every client->server frame is time-stamped so we can compute messages/s arriving at the Durable Object
const sendTimes: number[] = [];
class CountingWS extends WebSocket {
  override send(data: never, ...rest: never[]): void { sendTimes.push(performance.now()); (super.send as (...a: unknown[]) => void)(data, ...rest); }
}

const code = Array.from({ length: 5 }, () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)]).join('');

interface Bot { i: number; c: GameClient; role: 'drawer' | 'guesser' | 'dropper' | 'holdout' | 'late'; rxAtStart: number; txAtStart: number; bytesRx: number; }
const lat: number[] = [];            // drawer -> receiver latency, ms (includes the <=40 ms client batching interval)
const sentAt: number[] = [];         // op index -> performance.now() when the drawer queued it

function makeClient(server: string, i: number): GameClient {
  const c = new GameClient({ url: `${server}/ws/${code}`, code, name: i === 0 ? 'Chủ phòng' : `Bot ${i}`, avatar: i % 24, create: i === 0, WebSocketImpl: CountingWS as never });
  c.on('draw', (n, ops) => { const t0 = sentAt[n + ops.length - 1]; if (t0 !== undefined) lat.push(performance.now() - t0); });
  return c;
}

async function waitFor(f: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!f()) { if (Date.now() > end) throw new Error('timeout: ' + what); await sleep(20); }
}

// ---- realistic drawer: 60 Hz pointer samples, 1 op per sample, smooth curves, pauses, fills, undo/redo
function startDrawing(drawer: GameClient, stopAt: number): () => void {
  let x = rnd(200, 1000), y = rnd(150, 750), vx = 0, vy = 0, stroking = false, left = 0, pause = 0;
  let lastX = x, lastY = y, fills = 0, strokes = 0;
  const emit = (ops: Op[]): void => {
    const base = drawer.log.length;
    const err = drawer.draw(ops);
    if (err) throw new Error('drawer op rejected locally: ' + err);
    const t = performance.now();
    for (let k = 0; k < ops.length; k++) sentAt[base + k] = t;
  };
  const id = setInterval(() => {
    if (performance.now() > stopAt) return;
    if (!stroking) {
      if (pause-- > 0) return;
      const r = Math.random();
      if (r < 0.06 && strokes > 3) { emit([{ k: 'f', x: Math.round(rnd(50, 1150)), y: Math.round(rnd(50, 850)), c: Math.floor(rnd(0, 0xffffff)) }]); fills++; pause = 12; return; }
      if (r < 0.12 && strokes > 3) { emit([{ k: 'u' }]); pause = 10; return; }
      if (r < 0.16 && strokes > 3) { emit([{ k: 'r' }]); pause = 10; return; }
      x = Math.round(rnd(60, 1140)); y = Math.round(rnd(60, 840));
      const a = rnd(0, Math.PI * 2), sp = rnd(5, 14); vx = Math.cos(a) * sp; vy = Math.sin(a) * sp;
      emit([{ k: 'b', t: Math.random() < 0.1 ? 1 : 0, c: Math.floor(rnd(0, 0xffffff)), w: Math.round(rnd(3, 26)), x, y }]);
      lastX = x; lastY = y; stroking = true; left = Math.round(rnd(25, 140)); strokes++;
      return;
    }
    const turn = rnd(-0.18, 0.18); const c = Math.cos(turn), s = Math.sin(turn);
    [vx, vy] = [vx * c - vy * s, vx * s + vy * c];
    x += vx; y += vy;
    if (x < 5 || x > 1195) { vx = -vx; x = Math.min(1195, Math.max(5, x)); }
    if (y < 5 || y > 895) { vy = -vy; y = Math.min(895, Math.max(5, y)); }
    const px = Math.round(x), py = Math.round(y);
    if (px !== lastX || py !== lastY) { emit([{ k: 'm', p: [px - lastX, py - lastY] }]); lastX = px; lastY = py; }
    if (--left <= 0) { stroking = false; pause = Math.round(rnd(6, 30)); }
  }, 16);
  return () => clearInterval(id);
}

async function main(): Promise<void> {
  mkdirSync('reports', { recursive: true });
  const server = await ensureServer();
  console.log(`server ${server.url}, room ${code}, ${BOTS} bots, ${DRAW_SECONDS}s turn`);
  const bots: Bot[] = [];
  let browser: Browser | null = null, page: Page | null = null;
  const failures: string[] = [];
  const check = (ok: boolean, msg: string): void => { if (!ok) failures.push(msg); console.log(ok ? 'PASS' : 'FAIL', msg); };
  try {
    // ---------------- join
    const host = makeClient(server.wsUrl, 0);
    bots.push({ i: 0, c: host, role: 'drawer', rxAtStart: 0, txAtStart: 0, bytesRx: 0 });
    host.connect();
    await waitFor(() => host.status === 'open', 10_000, 'host open');
    for (let i = 1; i < BOTS; i++) {
      const c = makeClient(server.wsUrl, i);
      const role: Bot['role'] = i <= DROPPERS ? 'dropper' : i <= DROPPERS + HOLDOUTS ? 'holdout' : 'guesser';
      bots.push({ i, c, role, rxAtStart: 0, txAtStart: 0, bytesRx: 0 });
      c.connect();
      await sleep(15);
    }
    await waitFor(() => bots.every((b) => b.c.status === 'open'), 20_000, 'all bots open');
    await waitFor(() => host.room?.players.length === BOTS, 5_000, 'all players in room');
    check(host.room!.players.length === BOTS, `${BOTS} players joined one room`);

    // ---------------- start the game: host draws ("Chỉ host vẽ"), one turn
    host.send({ t: 'settings', patch: { mode: 'hostOnly', endBy: 'turns', turns: 1, drawTime: DRAW_SECONDS, hints: 2, wordChoices: 3, maxPlayers: 50 } });
    await sleep(200);
    if (WITH_PAGE) {
      browser = await launch();
      const pl = await newPlayer(browser, { name: 'Trình duyệt', w: 390, h: 844, touch: true, dsf: 2 });
      page = pl.page;
      await page.goto(`${server.url}/r/${code}`);
      await page.click('button:has-text("Vào phòng")');
      await waitSel(page, '.lobby');
      await waitFor(() => host.room?.players.length === BOTS + 1, 5_000, 'page joined');
    }
    host.send({ t: 'start' });
    await waitFor(() => host.secret?.choices !== undefined, 5_000, 'word choices');
    host.send({ t: 'pick', i: 0 });
    await waitFor(() => host.room?.phase === 'drawing', 5_000, 'drawing phase');
    const word = host.secret!.word!;
    const t0 = performance.now(), t0wall = Date.now();
    const endsAt = host.room!.phaseEndsAt!;
    for (const b of bots) { b.rxAtStart = b.c.stats.rxBytes; b.txAtStart = b.c.stats.txBytes; }
    const sendsBefore = sendTimes.length;
    const stopDrawing = startDrawing(host, t0 + DRAW_SECONDS * 1000 - 800);
    if (page) {
      await waitSel(page, '.game');
      await page.evaluate(() => {
        const w = window as unknown as { __frames: number[]; __long: number[]; __probe: boolean };
        w.__frames = []; w.__long = []; w.__probe = true;
        let last = performance.now();
        const loop = (t: number): void => { if (!w.__probe) return; w.__frames.push(t - last); last = t; requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
        try { new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__long.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch { /* unsupported */ }
      });
    }

    // ---------------- chatters / guessers / droppers
    const timers: ReturnType<typeof setTimeout>[] = [];
    let expectedGuessers = 0;
    for (const b of bots) {
      if (b.role === 'drawer') continue;
      // chat: a wrong guess every 5-12 s
      const chatLoop = (): void => { timers.push(setTimeout(() => { if (b.c.status === 'open') b.c.send({ t: 'chat', text: ['con gì vậy', 'khó quá', 'mèo hả', 'cái nhà', 'xe đạp?'][Math.floor(Math.random() * 5)] }); if (performance.now() < t0 + DRAW_SECONDS * 1000) chatLoop(); }, rnd(5000, 12000))); };
      chatLoop();
      if (b.role === 'guesser' || b.role === 'dropper') {
        expectedGuessers++;
        timers.push(setTimeout(() => { b.c.send({ t: 'chat', text: word.toUpperCase() }); }, rnd(0.25, 0.85) * DRAW_SECONDS * 1000 + (b.role === 'dropper' ? 0 : 0)));
      }
      if (b.role === 'dropper') {
        const dropAt = rnd(0.15, 0.55) * DRAW_SECONDS * 1000;
        timers.push(setTimeout(() => b.c.simulateDrop(), dropAt));
      }
    }
    // ---------------- late joiner at ~40% of the turn
    let late: GameClient | null = null;
    timers.push(setTimeout(() => { late = makeClient(server.wsUrl, BOTS); (late as GameClient).connect(); bots.push({ i: BOTS, c: late, role: 'late', rxAtStart: 0, txAtStart: 0, bytesRx: 0 }); }, 0.4 * DRAW_SECONDS * 1000));

    // ---------------- wait for the turn to finish
    let syncMsg: { n: number; hash: string } | null = null;
    host.on('message', (m) => { if (m.t === 'sync') syncMsg = { n: m.n, hash: m.hash }; });
    await waitFor(() => host.room?.phase === 'reveal' || syncMsg !== null, (DRAW_SECONDS + 15) * 1000, 'turn end');
    const t1 = performance.now();
    stopDrawing(); timers.forEach(clearTimeout);
    let fr: { frames: number[]; long: number[]; hash: string; px: string; n: number; secret: boolean } | null = null;
    if (page) {
      fr = await page.evaluate(async () => {
        const w = window as unknown as { __frames: number[]; __long: number[]; __probe: boolean; __vhdc: { client: { log: { hash: string; length: number } }; pixelHash(): Promise<string> } };
        w.__probe = false;
        return { frames: w.__frames.slice(1), long: w.__long, hash: w.__vhdc.client.log.hash, px: await w.__vhdc.pixelHash(), n: w.__vhdc.client.log.length, secret: false };
      });
    }
    const sendsAfter = sendTimes.length;
    await sleep(2000); // let in-flight frames, reconnect snapshots and the end-of-turn sync settle
    const reason = host.room?.reveal?.reason;
    const sm = syncMsg as { n: number; hash: string } | null;
    check(!!sm, 'server sent the end-of-turn sync (op count + hash)');
    check(reason === 'timeUp', `turn ran to the time limit (reason: ${reason})`);

    // ---------------- verification
    const serverN = sm!.n, serverHash = sm!.hash;
    const bad: string[] = [];
    for (const b of bots) {
      const c = b.c;
      if (c.status !== 'open') bad.push(`${c.me?.name ?? b.i}: not connected (${c.status})`);
      else if (c.log.length !== serverN || c.log.hash !== serverHash) bad.push(`${c.me?.name ?? b.i}: ops ${c.log.length}/${serverN} hash ${c.log.hash}/${serverHash}`);
    }
    check(bad.length === 0, `every client's final op-log hash == server's (${serverHash}, ${serverN} ops) on ${bots.length}/${bots.length} clients${bad.length ? ' — ' + bad.join('; ') : ''}`);
    const gaps = bots.reduce((s, b) => s + b.c.stats.gaps, 0), resyncs = bots.reduce((s, b) => s + b.c.resyncs, 0);
    check(gaps === 0, `0 lost / reordered ops (sequence gaps detected: ${gaps}, resyncs requested: ${resyncs})`);
    const reconnected = bots.filter((b) => b.role === 'dropper' && b.c.stats.reconnects >= 1).length;
    check(reconnected === DROPPERS, `${DROPPERS} bots dropped and reconnected mid-turn (${reconnected} did)`);
    const lateBot = bots.find((b) => b.role === 'late')!;
    check(lateBot.c.status === 'open' && lateBot.c.log.hash === serverHash, 'late joiner received the snapshot and matches the server');
    const sameSeat = bots.filter((b) => b.role === 'dropper').every((b) => host.room!.players.find((p) => p.id === b.c.you)?.connected);
    check(sameSeat && host.room!.players.length === BOTS + 1 + (WITH_PAGE ? 1 : 0), `reconnected bots kept their seats (${host.room!.players.length} players total incl. late joiner)`);
    const guessed = host.room!.players.filter((p) => p.guessed).length;
    check(guessed >= expectedGuessers - DROPPERS, `guessers scored (${guessed} correct guesses)`);

    if (fr) {
      check(fr.n === serverN && fr.hash === serverHash, `browser page's op-log hash == server's (${fr.hash}, ${fr.n} ops)`);
      check(fr.frames.length > 100, `rAF probe collected ${fr.frames.length} frames`);
    }

    // ---------------- metrics
    const dur = (t1 - t0) / 1000;
    const rxRates = bots.filter((b) => b.role !== 'late').map((b) => (b.c.stats.rxBytes - b.rxAtStart) / dur);
    const txRates = bots.filter((b) => b.role !== 'late' && b.role !== 'drawer').map((b) => (b.c.stats.txBytes - b.txAtStart) / dur);
    const drawerTx = (host.stats.txBytes - bots[0].txAtStart) / dur;
    const bins = new Map<number, number>();
    for (let i = sendsBefore; i < sendsAfter; i++) { const s = Math.floor((sendTimes[i] - t0) / 1000); bins.set(s, (bins.get(s) ?? 0) + 1); }
    const perSec = [...bins.values()];
    const totalMsgs = sendsAfter - sendsBefore;
    const rxMsgsPerClient = bots.filter((b) => b.role !== 'late').map((b) => b.c.stats.rxMsgs);
    const avgMsgs = totalMsgs / dur;
    const billedReqPerTurn = (totalMsgs / dur) * DRAW_SECONDS / 20;
    const report = `# Load test report

Generated by \`npm run loadtest\` on ${new Date(t0wall).toISOString()} against **wrangler dev** (local workerd, loopback network).
Room \`${code}\`, ${BOTS} bots (+1 late joiner), "Chỉ host vẽ" mode, one ${DRAW_SECONDS}-second drawing turn, hints on.

## Scenario
- Drawer (host bot) streams realistic strokes: 60 Hz pointer samples (one op per sample, the worst case for op count), smooth curves 25-140 points long, pauses between strokes, occasional fill / undo / redo / eraser. Client batches every 40 ms.
- ${bots.filter((b) => b.role === 'guesser').length} guessers answer correctly at random times; every bot also sends a wrong guess every 5-12 s; ${HOLDOUTS} never guess so the turn runs to the time limit.
- ${DROPPERS} bots lose their connection at random moments (socket terminated, no close frame) and reconnect with their session token. 1 bot joins at 40 % of the turn.

## Results
| Check | Result |
|---|---|
${[
  ['Players in one room', `${BOTS} (+1 late joiner)`],
  ['Turn ended by', String(reason)],
  ['Ops in the turn (server log)', String(serverN)],
  ['Final op-log hash, server', `\`${serverHash}\``],
  ['Clients whose hash equals the server', `${bots.length - bad.length} / ${bots.length}`],
  ['Lost or reordered ops (sequence gaps)', String(gaps)],
  ['Resync requests', String(resyncs)],
  ['Reconnects (dropped bots)', `${reconnected} / ${DROPPERS}`],
].map(([a, b]) => `| ${a} | ${b} |`).join('\n')}

### Relay latency (drawer queues an op -> receiver gets it)
Measured in one process (shared clock), ${lat.length} deliveries. Includes the drawer client's 40 ms batching interval; excludes real-world network round trips (loopback here).

| p50 | p95 | p99 | max |
|---|---|---|---|
| ${fmt(pct(lat, 50))} ms | ${fmt(pct(lat, 95))} ms | ${fmt(pct(lat, 99))} ms | ${fmt(Math.max(...lat))} ms |

### Bandwidth per client (during the turn, ${fmt(dur)} s)
| | avg | p95 | max |
|---|---|---|---|
| Receive, bytes/s per client | ${fmt(rxRates.reduce((a, b) => a + b, 0) / rxRates.length, 0)} | ${fmt(pct(rxRates, 95), 0)} | ${fmt(Math.max(...rxRates), 0)} |
| Send, bytes/s per guesser | ${fmt(txRates.reduce((a, b) => a + b, 0) / txRates.length, 0)} | ${fmt(pct(txRates, 95), 0)} | ${fmt(Math.max(...txRates), 0)} |
| Send, bytes/s drawer | ${fmt(drawerTx, 0)} | | |

### Messages into the Durable Object
| total frames | avg msgs/s | peak msgs/s (1 s bin) | frames received per client (avg) |
|---|---|---|---|
| ${totalMsgs} | ${fmt(avgMsgs)} | ${Math.max(...perSec)} | ${fmt(rxMsgsPerClient.reduce((a, b) => a + b, 0) / rxMsgsPerClient.length, 0)} |

Cloudflare bills incoming WebSocket messages 20:1 as requests, outgoing are free: this turn = **${fmt(billedReqPerTurn, 0)} billed requests** (+ ${bots.length} connection requests) out of the free 100,000/day.

${fr ? (() => {
  const f = fr.frames, secs = f.reduce((a, b) => a + b, 0) / 1000;
  const over = (ms: number) => f.filter((x) => x > ms).length;
  return `### Browser page in the room (Chromium headless, 390x844 phone emulation, software rendering, same machine as the server and all ${BOTS} bots)
One real page played the guesser role through the whole turn while the drawer streamed strokes; a \`requestAnimationFrame\` probe recorded every frame interval.

| frames | avg fps | p50 | p95 | p99 | max | > 20 ms | > 33 ms | > 50 ms | > 100 ms | long tasks (>50 ms) |
|---|---|---|---|---|---|---|---|---|---|---|
| ${f.length} | ${fmt(f.length / secs, 1)} | ${fmt(pct(f, 50))} ms | ${fmt(pct(f, 95))} ms | ${fmt(pct(f, 99))} ms | ${fmt(Math.max(...f))} ms | ${over(20)} | ${over(33)} | ${over(50)} | ${over(100)} | ${fr.long.length} |

Page canvas: ${fr.n} ops, op-log hash \`${fr.hash}\` (= server), pixel hash \`${fr.px}\`.
Caveat: the probe shares CPU with ${BOTS} bots, wrangler/workerd and the drawer, so on a real phone frame times will differ; the numbers show the UI does not re-render per stroke under a 42-player stream.
`; })() : ''}
## Verdict
${failures.length ? '**FAILED**:\n' + failures.map((f) => '- ' + f).join('\n') : '**PASS** — all checks above succeeded.'}
`;
    writeFileSync('reports/loadtest.md', report);
    console.log(report);
    void word;
  } finally {
    for (const b of bots) b.c.close();
    await browser?.close();
    server.stop();
  }
  if (failures.length) { console.error('FAILED:\n' + failures.join('\n')); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
