// Starts `wrangler dev` (local workerd, no Cloudflare account needed) unless TARGET_URL points at a running server.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}

async function waitHttp(url: string, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('server did not start: ' + url);
}

export interface Server { url: string; wsUrl: string; stop(): void }

export async function ensureServer(): Promise<Server> {
  const given = process.env.TARGET_URL;
  if (given) return { url: given, wsUrl: given.replace(/^http/, 'ws'), stop() {} };
  if (!existsSync('dist/index.html')) {
    await new Promise<void>((res, rej) => spawn('npm', ['run', 'build'], { stdio: 'inherit' }).on('exit', (c) => (c === 0 ? res() : rej(new Error('build failed')))));
  }
  const port = await freePort();
  const child: ChildProcess = spawn('npx', ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--log-level', 'warn', '--persist-to', '.wrangler/loadtest-state'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  child.stdout?.on('data', (d) => (log += d));
  child.stderr?.on('data', (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  try { await waitHttp(url + '/', 90_000); } catch (e) { console.error(log); throw e; }
  return {
    url, wsUrl: `ws://127.0.0.1:${port}`,
    stop() { try { process.kill(-child.pid!, 'SIGTERM'); } catch { child.kill('SIGTERM'); } },
  };
}
