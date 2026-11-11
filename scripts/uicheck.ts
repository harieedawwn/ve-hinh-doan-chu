// UI layout check: home, lobby, drawing and podium at four viewports. Fails on horizontal overflow, elements outside the
// viewport, overlapping/covered controls, text overflowing its box, missing Vietnamese glyphs, or page errors.
// Screenshots go to reports/screens/. Env: TARGET_URL to test a running server.
import { mkdirSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';
import type { Page } from 'playwright-core';
import { GameClient } from '../client/src/net.ts';
import { ensureServer } from './lib/dev-server.ts';
import { launch, newPlayer, sleep, waitFor } from './lib/ui-helpers.ts';
import { initialJs } from './size-check.ts';
import type { Browser } from 'playwright-core';

const VIEWS = [
  { name: '360x740', w: 360, h: 740, touch: true }, { name: '390x844', w: 390, h: 844, touch: true },
  { name: '768x1024', w: 768, h: 1024, touch: true }, { name: '1440x900', w: 1440, h: 900, touch: false },
];
const BOTS = Number(process.env.UI_BOTS ?? 20);
const LONG = ['Nguyễn Thị Phương Thảo Vy', 'Trần Quốc Bảo Khánh', 'Lê Ngọc Ánh Dương', 'Phạm Hữu Nghĩa'];

type Problem = string;
/** Runs inside the page. */
function audit(): Problem[] {
  const probs: string[] = [];
  const root = document.documentElement;
  const vw = root.clientWidth, vh = root.clientHeight;
  if (root.scrollWidth > vw + 1) probs.push(`horizontal overflow: scrollWidth ${root.scrollWidth} > ${vw}`);
  if (root.scrollHeight > vh + 1 || document.body.scrollHeight > vh + 1) probs.push(`page scrolls vertically: ${root.scrollHeight} > ${vh}`);
  const name = (el: Element): string => { const t = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24); return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}[${t}]`; };
  const vis = (el: Element): boolean => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0; };
  const scroller = (el: Element): Element | null => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p); if (/(auto|scroll)/.test(o.overflowY) && p.scrollHeight > p.clientHeight + 1) return p; } return null; };
  // while a sheet is open only the sheet is interactive: audit it alone
  const scope = (document.querySelector('.sheet') ?? document) as unknown as Document;
  // rect of the part of an element that is actually visible inside its scrolling ancestors (null when scrolled out of view)
  const clipped = (el: Element): DOMRect | null => {
    let { left, top, right, bottom } = el.getBoundingClientRect();
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(o.overflowY) || /(auto|scroll|hidden|clip)/.test(o.overflowX)) {
        const q = p.getBoundingClientRect();
        left = Math.max(left, q.left); top = Math.max(top, q.top); right = Math.min(right, q.right); bottom = Math.min(bottom, q.bottom);
      }
    }
    const r0 = el.getBoundingClientRect();
    if (right - left < r0.width * 0.5 || bottom - top < r0.height * 0.5) return null;
    return new DOMRect(left, top, right - left, bottom - top);
  };
  const controls = [...scope.querySelectorAll('button,input,textarea,a[href],[role=slider]')].filter(vis);
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    let out = r.left < -1 || r.right > vw + 1;
    if (!scroller(el)) out = out || r.top < -1 || r.bottom > vh + 1;
    if (out) probs.push(`outside viewport: ${name(el)} (${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}) vs ${vw}x${vh}`);
    if (!(el as HTMLInputElement).disabled && r.width < 30 || r.height < 30) { if (el.tagName !== 'INPUT' || r.height < 30) probs.push(`tiny control: ${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`); }
  }
  // overlapping controls (neither contains the other)
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
    const a = controls[i], b = controls[j];
    if (a.contains(b) || b.contains(a)) continue;
    const ra = clipped(a), rb = clipped(b);
    if (!ra || !rb) continue;
    const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (w > 3 && h > 3) probs.push(`overlap: ${name(a)} x ${name(b)} (${Math.round(w)}x${Math.round(h)})`);
  }
  // covered controls (only those fully inside the viewport and visible)
  for (const el of controls) {
    const r = clipped(el);
    if (!r) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue;
    const top = document.elementFromPoint(cx, cy);
    if (top && !(el.contains(top) || top.contains(el)) && !(el as HTMLElement).closest('label')?.contains(top)) probs.push(`covered: ${name(el)} by ${name(top)}`);
  }
  // text overflowing its box
  const all = [...(scope === document ? document.body : (scope as unknown as Element)).querySelectorAll('*')].filter((e) => vis(e) && !(e instanceof SVGElement));
  for (const el of all) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent!.trim());
    if (!own.length) continue;
    const cs = getComputedStyle(el);
    const rg = document.createRange();
    let l = Infinity, t = Infinity, rr = -Infinity, bb = -Infinity;
    for (const n of own) { rg.selectNodeContents(n); for (const q of rg.getClientRects()) { l = Math.min(l, q.left); t = Math.min(t, q.top); rr = Math.max(rr, q.right); bb = Math.max(bb, q.bottom); } }
    if (!isFinite(l)) continue;
    const r = el.getBoundingClientRect();
    const ell = cs.textOverflow === 'ellipsis';
    const clipX = /(hidden|clip)/.test(cs.overflowX);
    if (!ell && (rr > r.right + 1.5 || l < r.left - 1.5)) probs.push(`text overflows box (x): ${name(el)}`);
    const tol = Math.max(2, parseFloat(cs.fontSize) * 0.45); // web fonts with tall ascent/descent report taller text boxes than their ink
    if (!ell && !/(auto|scroll|hidden)/.test(cs.overflowY) && (bb > r.bottom + tol || t < r.top - tol)) probs.push(`text overflows box (y): ${name(el)}`);
    if (!ell && clipX && el.scrollWidth > el.clientWidth + 1) probs.push(`text clipped: ${name(el)}`);
    if (!ell && (rr > vw + 1 || l < -1)) probs.push(`text outside viewport: ${name(el)}`);
  }
  return [...new Set(probs)];
}

async function glyphCheck(p: Page): Promise<string[]> {
  return p.evaluate(async () => {
    const out: string[] = [];
    await Promise.all(['700 40px "Baloo 2"', '800 40px "Baloo 2"', '400 40px "Be Vietnam Pro"', '700 40px "Be Vietnam Pro"'].map((f) => document.fonts.load(f, 'ẵữộĐ')));
    const c = document.createElement('canvas').getContext('2d')!;
    const w = (font: string, ch: string) => { c.font = font; return c.measureText(ch).width; };
    for (const fam of ['Baloo 2', 'Be Vietnam Pro']) for (const wt of [400, 700]) for (const ch of ['ẵ', 'ữ', 'ộ', 'Đ', 'ặ', 'ừ']) {
      const own = w(`${wt} 40px "${fam}", monospace`, ch), mono = w(`${wt} 40px monospace`, ch), serif = w(`${wt} 40px serif`, ch);
      if (Math.abs(own - mono) < 0.01 && Math.abs(own - serif) < 0.01) out.push(`glyph ${ch} falls back in ${fam} ${wt}`);
    }
    const faces = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family}`);
    if (!faces.length) out.push('no web font loaded');
    return out;
  });
}


/** Behaviour checks that are not layout: first-entry fullscreen question, Zalo/iPhone alternative, code paste, refused join, size budget. */
async function behaviours(browser: Browser, url: string, log: (s: string) => void): Promise<number> {
  let bad = 0;
  const ok = (name: string, pass: boolean, detail = ''): void => { if (!pass) bad++; log(`${pass ? 'PASS' : 'FAIL'} behaviour: ${name}${detail ? ' — ' + detail : ''}`); };
  const size = initialJs();
  ok('initial JS under 150 KB gzip', size.ok, `${size.totalKb.toFixed(1)} KB (${size.files.map((f) => f.f.split('/').pop()).join(', ')})`);
  // first entry asks "Chơi toàn màn hình?", remembers "Không", does not ask again
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'vi-VN' });
  const p = await fresh.newPage();
  await p.goto(url + '/?utm_source=zalo&zarsrc=1');
  await p.waitForSelector('.sheet[aria-label="Chơi toàn màn hình?"]', { timeout: 8000 }).then(() => ok('first entry asks "Chơi toàn màn hình?"', true)).catch(() => ok('first entry asks "Chơi toàn màn hình?"', false));
  await p.click('.sheet button:has-text("Không")');
  await p.reload(); await p.waitForSelector('.home');
  ok('answer is remembered (no second question)', (await p.locator('.sheet').count()) === 0);
  // code boxes accept a pasted link and a pasted code
  const filled = async (text: string) => {
    await p.evaluate((t) => { const el = document.querySelector('.cbox') as HTMLInputElement; el.focus(); const dt = new DataTransfer(); dt.setData('text', t); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, text);
    await sleep(100);
    return (await p.locator('.cbox').evaluateAll((els) => (els as HTMLInputElement[]).map((e) => e.value).join('')));
  };
  ok('code boxes accept a pasted code', (await filled('abcde')) === 'ABCDE');
  ok('code boxes accept a pasted link', (await filled('https://example.com/r/k7m2p?zarsrc=9')) === 'K7M2P');
  // refused join (room does not exist) shows a Vietnamese message instead of hanging
  await p.fill('#name', 'Lan'); await p.click('button:has-text("Vào phòng")');
  await p.waitForSelector('.notice', { timeout: 8000 }).then(async () => ok('missing room shows a Vietnamese refusal', /phòng/i.test((await p.locator('.notice').textContent()) ?? ''), (await p.locator('.notice p').textContent()) ?? '')).catch(() => ok('missing room shows a Vietnamese refusal', false));
  await fresh.close();
  // fullscreen unavailable (iPhone UA): "Có" explains the working alternative instead of failing silently
  for (const [label, ua, expect] of [['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo', 'Thêm vào MH chính'], ['Android Zalo', 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 Zalo/12.0', 'Mở bằng trình duyệt']] as const) {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: ua });
    if (label === 'Android Zalo') await c.addInitScript(() => { Object.defineProperty(document, 'fullscreenEnabled', { value: false }); Object.defineProperty(document, 'webkitFullscreenEnabled', { value: false }); });
    const q = await c.newPage();
    await q.goto(url + '/');
    await q.waitForSelector('.sheet');
    await q.click('.sheet button:has-text("Có")');
    await q.waitForSelector(`.sheet :text("${expect}")`, { timeout: 5000 }).then(() => ok(`${label}: "Có" offers the alternative (${expect})`, true)).catch(() => ok(`${label}: "Có" offers the alternative (${expect})`, false));
    await c.close();
  }
  return bad;
}

async function main(): Promise<void> {
  mkdirSync('reports/screens', { recursive: true });
  const server = await ensureServer();
  const browser = await launch();
  const report: string[] = [];
  let fails = 0;
  const bots: GameClient[] = [];
  const log = (s: string): void => { console.log(s); report.push(s); };
  const run = async (view: typeof VIEWS[number], dark: boolean): Promise<void> => {
    const tag = view.name + (dark ? '-dark' : '');
    const A = await newPlayer(browser, { name: 'Lan', w: view.w, h: view.h, touch: view.touch, dark, dsf: 1 });
    const B = await newPlayer(browser, { name: 'Minh', w: 390, h: 844, touch: true });
    const pg = A.page;
    const states: Record<string, Problem[]> = {};
    const snap = async (state: string, check = true): Promise<void> => {
      await pg.evaluate(() => document.fonts.ready); await sleep(250);
      await pg.screenshot({ path: `reports/screens/${state}-${tag}.png` });
      if (check) states[state] = await pg.evaluate(audit);
    };
    try {
      await pg.goto(server.url + '/?zarsrc=1&utm_source=zalo');
      await waitFor(pg, '.home');
      if (new URL(pg.url()).search) states['query'] = ['query params not stripped: ' + pg.url()];
      if (!dark && view.name === '360x740') states['fonts'] = await glyphCheck(pg);
      await snap('home');
      await pg.click('button:has-text("Tạo phòng")');
      await waitFor(pg, '.lobby');
      const code = (await pg.locator('.room-chip b').allTextContents()).join('');
      await B.page.goto(`${server.url}/r/${code}?zarsrc=2`);
      await waitFor(B.page, '.home button:has-text("Vào phòng")');
      await B.page.click('.home button:has-text("Vào phòng")');
      await waitFor(B.page, '.lobby');
      for (let i = 0; i < BOTS; i++) {
        const c = new GameClient({ url: `${server.wsUrl}/ws/${code}`, code, name: i < LONG.length ? LONG[i] : `Bạn ${i + 1}`, avatar: i, WebSocketImpl: WebSocket as never });
        c.connect(); bots.push(c);
      }
      await pg.waitForFunction((n) => (window as never as { __vhdc: { client: { room: { players: unknown[] } } } }).__vhdc.client.room.players.length >= n, BOTS + 2, { timeout: 15000 });
      await sleep(300);
      await snap('lobby');
      await pg.evaluate(() => (window as never as { __vhdc: { client: { send(m: unknown): void } } }).__vhdc.client.send({ t: 'settings', patch: { mode: 'hostOnly', wordChoices: 3, drawTime: 120 } }));
      await sleep(300);
      await pg.click('button:has-text("Bắt đầu")');
      await waitFor(pg, '.choose');
      await snap('choose');
      await pg.click('.choose .btn.big >> nth=0');
      await waitFor(pg, '.tools');
      // draw a few strokes with the real pointer
      const box = (await pg.locator('canvas.cv').boundingBox())!;
      const pt = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;
      // a closed circle, then a colour fill inside it, then a wavy line
      await pg.mouse.move(...pt(0.5 + 0.2, 0.5)); await pg.mouse.down();
      for (let i = 1; i <= 36; i++) await pg.mouse.move(...pt(0.5 + 0.2 * Math.cos((i / 36) * 2 * Math.PI), 0.5 + 0.27 * Math.sin((i / 36) * 2 * Math.PI)));
      await pg.mouse.up();
      await pg.click('.tools-recent .recent .swatch >> nth=0'); await pg.click('button[aria-label^="Sơn"]'); await pg.mouse.click(...pt(0.5, 0.5));
      await pg.click('button[aria-label^="Bút"]');
      await pg.mouse.move(...pt(0.1, 0.9)); await pg.mouse.down();
      for (let i = 0; i <= 20; i++) await pg.mouse.move(...pt(0.1 + i * 0.04, 0.9 - Math.sin(i / 2) * 0.05));
      await pg.mouse.up();
      await B.page.fill('.guess input', 'chắc là con mèo'); await B.page.keyboard.press('Enter');
      await sleep(700);
      await snap('drawing');
      await pg.click('button[aria-label="Chọn màu khác"]'); await waitFor(pg, '.sheet');
      await snap('palette'); await pg.click('.sheet button:has-text("Xong")');
      await pg.click('button[aria-label="Cài đặt"]'); await waitFor(pg, '.sheet');
      await snap('settings'); await pg.keyboard.press('Escape');
      await pg.evaluate(() => (window as never as { __vhdc: { client: { send(m: unknown): void } } }).__vhdc.client.send({ t: 'end' }));
      await waitFor(pg, '.podium');
      await sleep(300);
      await snap('podium');
    } catch (e) { states['flow'] = [`flow failed: ${(e as Error).message.split('\n')[0]}`]; await pg.screenshot({ path: `reports/screens/fail-${tag}.png` }).catch(() => {}); }
    for (const x of [A, B]) if (x.errors.length) states['pageerror'] = [...(states['pageerror'] ?? []), ...x.errors];
    for (const [s, p] of Object.entries(states)) {
      if (p.length) { fails += p.length; log(`FAIL ${tag} ${s}\n` + p.map((x) => '   - ' + x).join('\n')); } else log(`PASS ${tag} ${s}`);
    }
    for (const b of bots.splice(0)) b.close();
    await A.ctx.close(); await B.ctx.close();
  };
  try {
    for (const v of VIEWS) await run(v, false);
    await run(VIEWS[2], true);
    fails += await behaviours(browser, server.url, log);
  } finally { await browser.close(); server.stop(); }
  writeFileSync('reports/uicheck.md', `# uicheck\n\n\`\`\`\n${report.join('\n')}\n\`\`\`\n\n${fails ? `**${fails} problem(s)**` : '**All checks passed.**'}\n`);
  console.log(fails ? `uicheck: ${fails} problem(s)` : 'uicheck: all passed');
  process.exit(fails ? 1 : 0);
}
void main();
