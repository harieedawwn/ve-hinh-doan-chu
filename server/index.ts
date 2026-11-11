// Worker entry: routes /ws/CODE to the room's Durable Object. Everything else is served by static assets
// (wrangler `run_worker_first: ["/ws/*"]` keeps asset requests off the Worker, so they never count against it).

import { ROOM_CODE_RE } from '../shared/constants.ts';
import type { Env } from './room.ts';

export { Room } from './room.ts';

const PROBE_PATH = '_probe';

async function probe(env: Env): Promise<Response> {
  try {
    const r = await env.ROOM.get(env.ROOM.idFromName(PROBE_PATH)).fetch('https://room/probe', { headers: { 'x-probe': '1' } });
    return new Response(r.ok ? 'ok' : 'unavailable', { status: r.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.log('[worker] probe failed:', String(e));
    return new Response('unavailable', { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } });
  }
}

function originOk(req: Request): boolean {
  const o = req.headers.get('Origin');
  if (!o) return true; // non-browser clients (bots, curl)
  try { return new URL(o).host === new URL(req.url).host; } catch { return false; }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = /^\/ws\/([^/]+)$/.exec(url.pathname);
    if (!m) return env.ASSETS.fetch(req);
    // Health probe used by the client after repeated connection failures: touches the Worker and one DO, so it fails
    // (429 from the platform, or 503 here) exactly when the free quota is used up. Not a room code (6 chars).
    if (m[1] === PROBE_PATH) return probe(env);
    const code = decodeURIComponent(m[1]).toUpperCase();
    if (!ROOM_CODE_RE.test(code)) return new Response('Bad room code', { status: 400 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    if (!originOk(req)) return new Response('Forbidden origin', { status: 403 });
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const headers = new Headers(req.headers);
    headers.set('x-room-code', code);
    try {
      return await stub.fetch(new Request(req, { headers }));
    } catch (e) {
      // Free daily Durable Object quota used up (or the object is overloaded): a plain 503 the client can recognise.
      console.log('[worker] DO fetch failed:', String(e));
      return new Response('Room unavailable', { status: 503, headers: { 'Retry-After': '60', 'x-vhdc': 'unavailable' } });
    }
  },
} satisfies ExportedHandler<Env>;
