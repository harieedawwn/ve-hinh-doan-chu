// Worker entry: routes /ws/CODE to the room's Durable Object. Everything else is served by static assets
// (wrangler `run_worker_first: ["/ws/*"]` keeps asset requests off the Worker, so they never count against it).

import { ROOM_CODE_RE } from '../shared/constants.ts';
import type { Env } from './room.ts';

export { Room } from './room.ts';

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
    const code = decodeURIComponent(m[1]).toUpperCase();
    if (!ROOM_CODE_RE.test(code)) return new Response('Bad room code', { status: 400 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    if (!originOk(req)) return new Response('Forbidden origin', { status: 403 });
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const headers = new Headers(req.headers);
    headers.set('x-room-code', code);
    return stub.fetch(new Request(req, { headers }));
  },
} satisfies ExportedHandler<Env>;
