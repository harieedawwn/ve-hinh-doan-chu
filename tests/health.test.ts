import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));
import { classifyStatus, probeServer, QUOTA_RESET_TEXT } from '../client/src/health.ts';
const { default: worker } = await import('../server/index.ts');

describe('quota detection', () => {
  it('classifies probe statuses', () => {
    expect(classifyStatus(200)).toBe('ok');
    expect(classifyStatus(429)).toBe('quota');
    expect(classifyStatus(503)).toBe('quota');
  });
  it('treats a network error as offline, not quota', async () => {
    const f = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    expect(await probeServer(f)).toBe('offline');
    expect(await probeServer((async () => new Response('x', { status: 429 })) as never)).toBe('quota');
    expect(await probeServer((async () => new Response('ok')) as never)).toBe('ok');
  });
  it('states the Vietnam reset time (00:00 UTC = 07:00 UTC+7)', () => {
    expect(QUOTA_RESET_TEXT).toContain('7 giờ');
  });
  it('worker returns 503 (not a thrown error) when the Durable Object is over quota', async () => {
    const boom = { get: () => ({ fetch: async () => { throw new Error('Exceeded allowed requests'); } }), idFromName: (n: string) => n };
    const env = { ROOM: boom, ASSETS: { fetch: async () => new Response('asset') } } as never;
    const ws = (path: string) => new Request('https://x.test' + path, { headers: { Upgrade: 'websocket' } });
    expect((await worker.fetch(ws('/ws/ABCDE'), env)).status).toBe(503);
    expect((await worker.fetch(new Request('https://x.test/ws/_probe'), env)).status).toBe(503);
  });
});
