// End-to-end: three real browser pages play one full game per drawer mode (rotate, hostOnly, hostMC) through the UI to the
// podium: draw, fill, undo, redo, clear + undo, custom colour (HSV sheet hex field), correct / near-miss / wrong guesses,
// reload-reconnect, canvas hash equality on every page, gallery. Writes reports/e2e.md + screenshots.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { ensureServer } from './lib/dev-server.ts';
import { launch, newPlayer, sleep, waitFor, type Ctx } from './lib/ui-helpers.ts';

type Mode = 'rotate' | 'hostOnly' | 'hostMC';
const results: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  results.push(`- [${ok ? 'x' : ' '}] ${name}${detail ? ' — ' + detail : ''}`);
  console.log(ok ? 'PASS' : 'FAIL', name, detail);
  if (!ok) failed++;
};

const ev = <T,>(p: Page, fn: string, arg?: unknown): Promise<T> => p.evaluate(`(async (arg) => { const d = window.__vhdc; ${fn} })(${JSON.stringify(arg ?? null)})`) as Promise<T>;
const phase = (p: Page) => ev<string>(p, 'return d.client?.room?.phase ?? ""');
const hashes = (p: Page) => ev<{ op: string; px: string; n: number }>(p, 'return { op: d.client.log.hash, px: await d.pixelHash(), n: d.client.log.length }');
const px = (p: Page, x: number, y: number) => ev<number[]>(p, 'const c = d.surface.canvas.getContext("2d").getImageData(arg[0], arg[1], 1, 1).data; return [c[0], c[1], c[2]]', [x, y]);
const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

async function settle(pages: Page[], ms = 1200): Promise<boolean> {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    await sleep(ms);
    const h = await Promise.all(pages.map(hashes));
    if (h.every((x) => x.op === h[0].op && x.px === h[0].px)) return true;
  }
  return false;
}

async function stroke(p: Page, pts: [number, number][]): Promise<void> {
  const box = (await p.locator('canvas.cv').boundingBox())!;
  const at = ([fx, fy]: [number, number]) => [box.x + box.width * fx, box.y + box.height * fy] as const;
  await p.mouse.move(...at(pts[0])); await p.mouse.down();
  for (const q of pts.slice(1)) await p.mouse.move(...at(q), { steps: 2 });
  await p.mouse.up();
}
const circle = (cx: number, cy: number, r: number): [number, number][] => Array.from({ length: 41 }, (_, i) => [cx + r * Math.cos((i / 40) * 6.2832), cy + (r * 1.1) * Math.sin((i / 40) * 6.2832)]);

async function playMode(browser: Awaited<ReturnType<typeof launch>>, url: string, mode: Mode): Promise<void> {
  const tag = `[${mode}]`;
  const turns = mode === 'rotate' ? 3 : 2;
  const names = ['Lan', 'Minh', 'Hoa'];
  const P: Ctx[] = [];
  for (const [i, n] of names.entries()) P.push(await newPlayer(browser, { name: n, w: i === 0 ? 1100 : 900, h: 900, avatar: i * 5 }));
  const [A, B, C] = P;
  try {
    await A.page.goto(url + '/');
    await A.page.click('button:has-text("Tạo phòng")');
    await waitFor(A.page, '.lobby');
    const code = (await A.page.locator('.room-chip b').allTextContents()).join('');
    check(`${tag} room created with 5-char code`, /^[A-HJ-KM-NP-Z2-9]{5}$/.test(code), code);
    for (const x of [B, C]) { await x.page.goto(`${url}/r/${code}?zarsrc=1`); await x.page.click('button:has-text("Vào phòng")'); await waitFor(x.page, '.lobby'); }
    await A.page.waitForFunction('window.__vhdc.client.room.players.length === 3');
    check(`${tag} share link joins the lobby (3 players, query stripped)`, !new URL(B.page.url()).search);
    await ev(A.page, 'd.client.send({ t: "settings", patch: arg })', { mode, endBy: 'turns', turns, drawTime: 60, hints: 1, wordChoices: 2, chooseTime: 20 });
    await sleep(400);
    await A.page.click('button:has-text("Bắt đầu")');

    const handled = new Set<number>();
    const t0 = Date.now();
    let reloaded = false, drawerSeen = new Set<string>();
    while (Date.now() - t0 < 150_000) {
      const st = await Promise.all(P.map((x) => ev<{ ph: string; me: boolean; turn: number }>(x.page, 'const r = d.client.room; return { ph: r.phase, me: r.drawerId === d.client.you, turn: r.turnNo }')));
      if (st[0].ph === 'podium') break;
      const di = st.findIndex((s) => s.me && s.ph === 'choosing');
      if (di >= 0) { const sel = P[di].page.locator('.choose .btn.big'); if (await sel.count()) await sel.first().click().catch(() => {}); }
      const dj = st.findIndex((s) => s.me && s.ph === 'drawing');
      if (dj >= 0 && !handled.has(st[dj].turn)) {
        const turn = st[dj].turn; handled.add(turn); drawerSeen.add(names[dj]);
        if (mode === 'hostMC') check(`${tag} MC host never draws`, dj !== 0);
        if (mode === 'hostOnly') check(`${tag} host draws turn ${turn}`, dj === 0);
        await waitFor(P[dj].page, '.tools');
        const D = P[dj].page, others = P.filter((_, i) => i !== dj);
        const word = await ev<string>(D, 'return d.client.secret.word');
        check(`${tag} turn ${turn}: drawer sees the word, guessers see a mask`, !!word && (await ev<string>(others[0].page, 'return d.client.room.mask')).includes('_'), word);
        await stroke(D, circle(0.5, 0.5, 0.2));
        if (turn === 1) {
          // fill with a preset colour from the palette sheet
          await D.click('button[aria-label="Chọn màu khác"]'); await waitFor(D, '.palette');
          await D.click('.palette .swatch >> nth=4'); // tomato; picking a preset closes the sheet
          await D.click('button[aria-label^="Sơn"]'); await D.mouse.click(...(await (async () => { const b = (await D.locator('canvas.cv').boundingBox())!; return [b.x + b.width * 0.5, b.y + b.height * 0.5] as const; })()));
          await sleep(300);
          const inside = await px(D, 600, 450), outside = await px(D, 40, 40);
          check(`${tag} fill: red inside the circle, white outside`, inside[0] > 200 && inside[1] < 120 && outside[0] === 255 && outside[1] === 255, `${inside} / ${outside}`);
          // custom colour via the HSV sheet hex field, then a stroke
          await D.click('button[aria-label^="Bút"]');
          await D.click('button[aria-label="Chọn màu khác"]'); await waitFor(D, '.hsv');
          await D.fill('.hexf input', '#2F5DA8');
          check(`${tag} custom colour applied`, (await ev<number>(D, 'return d.surface.color')) === 0x2f5da8);
          await D.click('.sheet button:has-text("Xong")');
          await stroke(D, [[0.1, 0.9], [0.2, 0.85], [0.3, 0.9], [0.4, 0.85]]);
          await sleep(300);
          const blue = await px(D, 120, 810 - 0);
          check(`${tag} custom colour stroke drawn`, (await ev<number[]>(D, 'const c = d.surface.canvas.getContext("2d"); let hit = 0; const im = c.getImageData(0, 700, 600, 200).data; for (let i = 0; i < im.length; i += 4) if (Math.abs(im[i] - 0x2f) < 6 && Math.abs(im[i + 2] - 0xa8) < 6) hit++; return [hit]'))[0] > 200, String(blue));
          check(`${tag} canvases identical after draw+fill`, await settle(P.map((x) => x.page)));
          // undo / redo
          const before = await hashes(D);
          await D.click('button[aria-label^="Hoàn tác"]'); await sleep(300);
          const undone = await hashes(D);
          check(`${tag} undo changes the picture`, undone.px !== before.px);
          check(`${tag} canvases identical after undo`, await settle(P.map((x) => x.page)));
          await D.click('button[aria-label^="Làm lại"]'); await sleep(300);
          check(`${tag} redo restores the picture`, (await hashes(D)).px === before.px);
          // clear with confirmation, then undo the clear
          await D.click('button[aria-label="Xóa hết"]'); await waitFor(D, '.sheet'); await D.click('.sheet button:has-text("Xóa hết")'); await sleep(300);
          const cleared = await px(D, 600, 450);
          check(`${tag} clear (confirmed) empties the canvas`, cleared[0] === 255 && cleared[1] === 255);
          await D.click('button[aria-label^="Hoàn tác"]'); await sleep(300);
          check(`${tag} undo brings the clear back`, (await hashes(D)).px === before.px);
          check(`${tag} canvases identical after clear+undo`, await settle(P.map((x) => x.page)));
          await D.screenshot({ path: `reports/e2e-${mode}-drawer.png` });
        }
        // guessers
        const near = word.length > 2 ? word.slice(0, -1) : word + 'x';
        const g0 = others[0].page;
        await g0.fill('.guess input', near); await g0.keyboard.press('Enter');
        if (strip(word).replace(/[^a-z0-9]/gi, '').length >= 3) { // server rule: near-miss needs a key of >= 3 chars
          await g0.waitForSelector('.near', { timeout: 5000 }).then(() => check(`${tag} turn ${turn}: near-miss shows "Gần đúng!"`, true)).catch(() => check(`${tag} turn ${turn}: near-miss shows "Gần đúng!"`, false, `guess "${near}" for "${word}"`));
        }
        await g0.fill('.guess input', 'qwzxv'); await g0.keyboard.press('Enter');
        await sleep(300);
        await g0.fill('.guess input', turn === 1 ? strip(word) : word); await g0.keyboard.press('Enter');
        await g0.waitForSelector('.prow.ok, .chat .cl.sys', { timeout: 5000 }).catch(() => {});
        if (!reloaded && turn === 1) {
          reloaded = true;
          const gi = others[1];
          const idBefore = await ev<string>(gi.page, 'return d.client.you');
          await gi.page.reload();
          await waitFor(gi.page, '.game');
          await gi.page.waitForFunction('window.__vhdc.client?.room && window.__vhdc.client.status === "open"');
          const idAfter = await ev<string>(gi.page, 'return d.client.you');
          check(`${tag} reload reconnects to the same seat`, idBefore === idAfter && (await ev<number>(gi.page, 'return d.client.room.players.length')) === 3);
          check(`${tag} canvas restored after reload`, await settle(P.map((x) => x.page)));
          await gi.page.screenshot({ path: `reports/e2e-${mode}-guesser-after-reload.png` });
        }
        await others[1].page.fill('.guess input', word); await others[1].page.keyboard.press('Enter');
        await waitFor(others[1].page, '.reveal', 12000).then(() => check(`${tag} turn ${turn}: everyone guessed -> reveal shows the word`, true)).catch(() => check(`${tag} turn ${turn}: reveal`, false));
        const shown = await others[1].page.locator('.reveal .bigword').textContent().catch(() => '');
        check(`${tag} turn ${turn}: revealed word is correct`, shown === word, `${shown}`);
        if (turn === 1) await others[1].page.screenshot({ path: `reports/e2e-${mode}-reveal.png` });
      }
      await sleep(250);
    }
    await waitFor(A.page, '.podium', 5000);
    check(`${tag} game reaches the podium`, true);
    if (mode === 'rotate') check(`${tag} every player drew once (fair rotation)`, drawerSeen.size === 3, [...drawerSeen].join(','));
    check(`${tag} podium lists all players with scores`, (await A.page.locator('.step, .prow').count()) >= 3);
    await A.page.screenshot({ path: `reports/e2e-${mode}-podium.png` });
    await A.page.click('button:has-text("Tranh")');
    await waitFor(A.page, '.ggrid');
    const shots = await A.page.locator('.gcard').count();
    check(`${tag} gallery has one drawing per turn`, shots === turns, `${shots}/${turns}`);
    await A.page.click('.gcard >> nth=0'); await waitFor(A.page, '.gfull');
    check(`${tag} gallery image opens with a save button`, (await A.page.locator('button:has-text("Lưu ảnh")').count()) === 1);
    if (mode === 'rotate') { await A.page.screenshot({ path: 'reports/e2e-gallery.png' }); }
    const dl = A.page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await A.page.click('button:has-text("Lưu ảnh")');
    check(`${tag} save PNG downloads a file`, !!(await dl));
    for (const x of P) if (x.errors.length) check(`${tag} no page errors`, false, x.errors.join('; '));
  } catch (e) {
    check(`${tag} flow`, false, (e as Error).message.split('\n').slice(0, 6).join(' / '));
    await A.page.screenshot({ path: `reports/e2e-${mode}-FAIL.png` }).catch(() => {});
  } finally { for (const x of P) await x.ctx.close(); }
}

async function main(): Promise<void> {
  mkdirSync('reports', { recursive: true });
  const server = await ensureServer();
  const browser = await launch();
  try { for (const m of ['rotate', 'hostOnly', 'hostMC'] as Mode[]) await playMode(browser, server.url, m); }
  finally { await browser.close(); server.stop(); }
  writeFileSync('reports/e2e.md', `# E2E: 3 browser pages, one game per drawer mode\n\n${results.join('\n')}\n\n${failed ? `**${failed} failed**` : '**All checks passed.**'}\n`);
  console.log(failed ? `e2e: ${failed} failed` : 'e2e: all passed');
  process.exit(failed ? 1 : 0);
}
void main();
