// Shared Playwright helpers for uicheck / e2e / load test page probes.
import { existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

export const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const launch = (): Promise<Browser> => chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

export interface Ctx { ctx: BrowserContext; page: Page; errors: string[] }

/** New context + page with prefs preset (name, fullscreen answer already given, optional dark theme). */
export async function newPlayer(browser: Browser, o: { name: string; w: number; h: number; touch?: boolean; dark?: boolean; dsf?: number; avatar?: number }): Promise<Ctx> {
  const ctx = await browser.newContext({ viewport: { width: o.w, height: o.h }, hasTouch: !!o.touch, isMobile: !!o.touch, deviceScaleFactor: o.dsf ?? 1, locale: 'vi-VN', colorScheme: o.dark ? 'dark' : 'light' });
  await ctx.addInitScript((p) => {
    try { if (!localStorage.getItem('vhdc:prefs')) localStorage.setItem('vhdc:prefs', JSON.stringify({ name: p.name, avatar: p.avatar, fs: 'no', sound: false, vibrate: false, theme: p.dark ? 'dark' : 'light' })); } catch { /* ignore */ }
  }, { name: o.name, dark: !!o.dark, avatar: o.avatar ?? 3 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${o.name}: ${e.message}`));
  return { ctx, page, errors };
}

export const waitFor = (p: Page, sel: string, ms = 15000) => p.waitForSelector(sel, { timeout: ms, state: 'visible' });
