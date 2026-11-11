// Two headless Chromium pages on the debug page, one room: the drawer draws / fills / undoes / redoes with the real
// mouse, the other page must end up with a pixel-identical canvas. Writes reports/e2e.md and screenshots.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';
import { ensureServer } from './lib/dev-server.ts';

const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  results.push(`- [${ok ? 'x' : ' '}] ${name}${detail ? ' — ' + detail : ''}`);
  console.log(ok ? 'PASS' : 'FAIL', name, detail);
  if (!ok) process.exitCode = 1;
};

type Dbg = { client: { isDrawer: boolean; room: { phase: string } | null }; pixelHash(): string; opHash(): string; opCount(): number };
const dbg = <T,>(p: Page, f: (d: Dbg) => T) => p.evaluate((src) => (new Function('d', 'return (' + src + ')(d)') as (d: unknown) => unknown)((window as never as Record<string, unknown>).__vhdc), f.toString()) as Promise<T>;
const dataUrlHash = (p: Page) => p.evaluate(() => { const c = document.getElementById('cv') as HTMLCanvasElement; return c.toDataURL('image/png'); }).then((u) => createHash('sha256').update(u).digest('hex').slice(0, 16));

async function main(): Promise<void> {
  mkdirSync('reports', { recursive: true });
  const server = await ensureServer();
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  try {
    const mkPage = async (): Promise<Page> => (await (await browser.newContext({ viewport: { width: 1000, height: 1100 }, deviceScaleFactor: 2 })).newPage());
    const a = await mkPage(), b = await mkPage();
    a.on('pageerror', (e) => console.error('pageerror A', e.message));
    b.on('pageerror', (e) => console.error('pageerror B', e.message));

    await a.goto(server.url + '/');
    await a.fill('#name', 'Lan');
    await a.click('#create');
    await a.waitForSelector('#roomcode');
    const code = (await a.textContent('#roomcode'))!.trim();
    check('room created with a 5-char code', /^[A-HJ-KM-NP-Z2-9]{5}$/.test(code), code);

    // second player opens the share link directly (SPA fallback must serve /r/CODE)
    const resp = await b.goto(`${server.url}/r/${code}`);
    check('/r/CODE is served (SPA fallback)', resp?.status() === 200);
    await b.fill('#name', 'Minh');
    await b.click('#join');
    await b.waitForFunction(() => document.querySelectorAll('#players span').length === 2);
    await a.waitForFunction(() => document.querySelectorAll('#players span').length === 2);
    check('both players see each other', true);

    await a.click('#start');
    await a.waitForFunction(() => document.getElementById('phase')?.textContent === 'choosing');
    const drawerPage = (await dbg(a, (d) => d.client.room?.phase === 'choosing' && (document.querySelector('#choices') !== null))) ? a : b;
    const viewerPage = drawerPage === a ? b : a;
    await drawerPage.click('#choices button >> nth=0');
    await drawerPage.waitForFunction(() => document.getElementById('phase')?.textContent === 'drawing');
    await viewerPage.waitForFunction(() => document.getElementById('phase')?.textContent === 'drawing');
    const maskLen = ((await viewerPage.textContent('#mask')) ?? '').length;
    check('viewer sees only a mask while drawing', /^[_ \-]+$/.test((await viewerPage.textContent('#mask')) ?? 'x') && maskLen > 0, await viewerPage.textContent('#mask') ?? '');

    // --- drawing with the real mouse on the drawer's canvas
    const box = (await drawerPage.locator('#cv').boundingBox())!;
    const P = (x: number, y: number) => [box.x + (x / 1200) * box.width, box.y + (y / 900) * box.height] as const;
    const stroke = async (pts: [number, number][]) => {
      await drawerPage.mouse.move(...P(...pts[0])); await drawerPage.mouse.down();
      for (const p of pts.slice(1)) await drawerPage.mouse.move(...P(...p), { steps: 6 });
      await drawerPage.mouse.up();
    };
    await drawerPage.evaluate(() => { const i = document.querySelector('input[type=color]') as HTMLInputElement; i.value = '#000000'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await stroke([[300, 200], [800, 200], [800, 600], [300, 600], [300, 200]]);                   // square
    await sleep(150);
    await drawerPage.click('text=Đổ màu');
    await drawerPage.evaluate(() => { const i = document.querySelector('input[type=color]') as HTMLInputElement; i.value = '#e03131'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await drawerPage.mouse.click(...P(550, 400));                                                  // fill inside
    await sleep(150);
    await drawerPage.click('text=Bút');
    await drawerPage.evaluate(() => { const i = document.querySelector('input[type=color]') as HTMLInputElement; i.value = '#1971c2'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await stroke([[100, 100], [250, 300], [150, 500], [400, 750], [900, 700], [1100, 400]]);         // curvy line
    await sleep(150);
    await drawerPage.click('#undo'); await sleep(100);                                              // remove the curve
    await drawerPage.click('#redo'); await sleep(100);                                              // bring it back
    await stroke([[1000, 100], [1100, 180]]);                                                       // another stroke
    await drawerPage.click('#undo'); await sleep(100);                                              // and undo it again
    await sleep(600);

    const opsA = await dbg(drawerPage, (d) => d.opCount());
    await viewerPage.waitForFunction((n) => (window as never as { __vhdc: { opCount(): number } }).__vhdc.opCount() === n, opsA, { timeout: 8000 });
    const hA = await dbg(drawerPage, (d) => d.opHash()), hB = await dbg(viewerPage, (d) => d.opHash());
    check('op-log hash identical on both pages', hA === hB, `${hA} (${opsA} ops)`);
    const pA = await dbg(drawerPage, (d) => d.pixelHash()), pB = await dbg(viewerPage, (d) => d.pixelHash());
    check('canvas pixels identical (raw RGBA hash)', pA === pB, pA);
    const uA = await dataUrlHash(drawerPage), uB = await dataUrlHash(viewerPage);
    check('canvas PNG identical (toDataURL)', uA === uB, uA);
    const blank = await drawerPage.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const x = c.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 900); return c.toDataURL('image/png'); });
    check('canvas is not blank', createHash('sha256').update(blank).digest('hex').slice(0, 16) !== uA);
    const red = await viewerPage.evaluate(() => { const c = document.getElementById('cv') as HTMLCanvasElement; const d = c.getContext('2d')!.getImageData(550, 400, 1, 1).data; return [d[0], d[1], d[2]]; });
    check('fill painted the inside red on the viewer', red[0] === 224 && red[1] === 49 && red[2] === 49, red.join(','));
    const outside = await viewerPage.evaluate(() => { const c = document.getElementById('cv') as HTMLCanvasElement; const d = c.getContext('2d')!.getImageData(1100, 800, 1, 1).data; return [d[0], d[1], d[2]]; });
    check('fill did not leak outside the square', outside.join(',') === '255,255,255', outside.join(','));
    await drawerPage.screenshot({ path: 'reports/e2e-drawer.png' });
    await viewerPage.screenshot({ path: 'reports/e2e-viewer.png' });

    // --- viewer reloads the page mid-turn: same seat (token in localStorage), same canvas from the snapshot
    await viewerPage.reload();
    await viewerPage.waitForFunction(() => document.getElementById('status')?.textContent === 'open');
    await viewerPage.waitForFunction((n) => (window as never as { __vhdc?: { opCount(): number } }).__vhdc?.opCount() === n, opsA, { timeout: 8000 });
    const pC = await dbg(viewerPage, (d) => d.pixelHash());
    check('after reload the viewer gets the same canvas from the snapshot', pC === pA && (await dbg(viewerPage, (d) => d.opHash())) === hA);
    const players = await viewerPage.locator('#players span').count();
    check('reload kept the same seat (still 2 players)', players === 2, String(players));
    await viewerPage.screenshot({ path: 'reports/e2e-viewer-after-reload.png' });
  } finally {
    await browser.close();
    server.stop();
  }
  writeFileSync('reports/e2e.md', `# Two-browser canvas check\n\nGenerated by \`npm run e2e\` (${new Date().toISOString()}), headless Chromium via Playwright against \`wrangler dev\`.\n\n${results.join('\n')}\n\nScreenshots: reports/e2e-drawer.png, reports/e2e-viewer.png, reports/e2e-viewer-after-reload.png\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
