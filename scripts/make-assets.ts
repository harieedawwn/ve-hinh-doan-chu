// Generates the app icon family from one SVG design: favicon.svg, icon-192/512.png (maskable), apple-touch-icon.png (180)
// and og-image.png (1200x630) into client/public. Run: node --experimental-strip-types scripts/make-assets.ts
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const OUT = 'client/public';
const INK = '#1E1B18', MUSTARD = '#F2B134', PAPER = '#FFFAF0', TOMATO = '#E4572E';

// Art on a 512 grid: speech bubble (paper) with a pencil (tomato) drawing a squiggle (ink). Colours: mustard, paper, tomato + ink.
const art = `
  <path d="M104 96h304a40 40 0 0 1 40 40v176a40 40 0 0 1-40 40H250l-92 72v-72h-54a40 40 0 0 1-40-40V136a40 40 0 0 1 40-40z" fill="${PAPER}" stroke="${INK}" stroke-width="24" stroke-linejoin="round"/>
  <path d="M128 296c28-70 52-70 76 0s52 70 82-6" fill="none" stroke="${INK}" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M286 290l52-52 62 62-52 52z" fill="${TOMATO}" stroke="${INK}" stroke-width="22" stroke-linejoin="round" transform="translate(40 -88) rotate(0)"/>
`;
// Pencil as a rotated group: body along a 45deg axis, tip pointing down-left at the end of the squiggle.
const pencil = `
  <g transform="translate(286 290) rotate(-45)">
    <path d="M0 0l34-26h140v52H34z" fill="${TOMATO}" stroke="${INK}" stroke-width="20" stroke-linejoin="round"/>
    <path d="M34-26v52" stroke="${INK}" stroke-width="20"/>
    <path d="M0 0l17-13v26z" fill="${INK}" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/>
  </g>`;
const squiggle = `<path d="M118 290c26-66 50-66 74 0s48 66 94 0" fill="none" stroke="${INK}" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>`;
const bubble = `<path d="M104 96h304a40 40 0 0 1 40 40v176a40 40 0 0 1-40 40H250l-92 72v-72h-54a40 40 0 0 1-40-40V136a40 40 0 0 1 40-40z" fill="${PAPER}" stroke="${INK}" stroke-width="24" stroke-linejoin="round"/>`;
const scene = `${bubble}${squiggle}${pencil}`;
void art;

const svg = (tile: 'round' | 'full', scale = 1) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" ${tile === 'round' ? 'rx="112"' : ''} fill="${MUSTARD}"/>
  <g transform="translate(${256 - 256 * scale} ${256 - 256 * scale}) scale(${scale})">${scene}</g>
</svg>`;

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/favicon.svg`, svg('round'));
  const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const png = async (markup: string, w: number, h: number, file: string) => {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<html><body style="margin:0;background:transparent">${markup}</body></html>`);
    await page.screenshot({ path: `${OUT}/${file}`, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  };
  const sized = (s: string, px: number) => s.replace('width="512" height="512"', `width="${px}" height="${px}"`);
  // maskable: full-bleed tile, art inside the central safe zone (80%)
  await png(sized(svg('full', 0.74), 192), 192, 192, 'icon-192.png');
  await png(sized(svg('full', 0.74), 512), 512, 512, 'icon-512.png');
  await png(sized(svg('full', 0.86), 180), 180, 180, 'apple-touch-icon.png');
  // 16px preview for the clarity check

  const font = (file: string) => pathToFileURL(resolve('node_modules/@fontsource', file)).href;
  const og = `<style>
    @font-face{font-family:'Baloo 2';font-weight:800;src:url(${font('baloo-2/files/baloo-2-latin-800-normal.woff2')})}
    @font-face{font-family:'Baloo 2';font-weight:800;src:url(${font('baloo-2/files/baloo-2-vietnamese-800-normal.woff2')});unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB}
    @font-face{font-family:'Be Vietnam Pro';font-weight:500;src:url(${font('be-vietnam-pro/files/be-vietnam-pro-latin-500-normal.woff2')})}
    @font-face{font-family:'Be Vietnam Pro';font-weight:500;src:url(${font('be-vietnam-pro/files/be-vietnam-pro-vietnamese-500-normal.woff2')});unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB}
  </style>
  <div style="width:1200px;height:630px;background:#F5EFE3;position:relative;overflow:hidden;font-family:'Baloo 2'">
    <svg width="1200" height="630" style="position:absolute;inset:0"><path d="M40 560c120-60 200 60 330 0s210 60 340 0 220 40 450-10" fill="none" stroke="#1F8A84" stroke-width="10" stroke-linecap="round"/><path d="M60 80c90 40 140-30 220 10" fill="none" stroke="#2F5DAB" stroke-width="10" stroke-linecap="round"/></svg>
    <div style="position:absolute;left:90px;top:110px;transform:rotate(-2deg)">
      <div style="font-weight:800;font-size:165px;line-height:0.9;color:#E4572E;text-shadow:8px 8px 0 #1E1B18">Vẽ hình</div>
      <div style="font-weight:800;font-size:165px;line-height:0.95;color:#1E1B18">đoán chữ</div>
    </div>
    <div style="position:absolute;right:90px;top:150px;width:300px;height:300px;transform:rotate(4deg);border:8px solid #1E1B18;border-radius:72px;box-shadow:14px 14px 0 #1E1B18;overflow:hidden">${sized(svg('full'), 300)}</div>
    <div style="position:absolute;left:96px;bottom:52px;font:500 36px 'Be Vietnam Pro';color:#1E1B18;background:#FFFAF0;border:5px solid #1E1B18;border-radius:16px;padding:8px 22px;box-shadow:6px 6px 0 #1E1B18">Chơi cùng cả lớp, ngay trên điện thoại</div>
  </div>`;
  // fonts load from file:// only when the page itself is a file
  mkdirSync('.wrangler', { recursive: true });
  const ogFile = resolve('.wrangler/og.html');
  writeFileSync(ogFile, `<html><body style="margin:0">${og}</body></html>`);
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto(pathToFileURL(ogFile).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}/og-image.png`, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await browser.close();
  console.log('assets written to', OUT, readFileSync(`${OUT}/favicon.svg`).length, 'bytes svg');
}
void main();
