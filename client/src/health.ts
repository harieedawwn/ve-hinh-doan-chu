// Server health probe: tells "free daily quota used up" apart from a plain network problem.
// A browser WebSocket failure carries no HTTP status, so after repeated failures we ask one cheap HTTP endpoint.

export type Health = 'ok' | 'quota' | 'offline';

/** Map a probe HTTP status to a verdict. 429 = Workers free quota (platform), 503/5xx = Durable Object quota or outage. */
export function classifyStatus(status: number): Health {
  if (status >= 200 && status < 300) return 'ok';
  return 'quota'; // 429, 503, 1xxx pages: the server answered but refuses -> quota or overload, never "your network"
}

export async function probeServer(fetchImpl: typeof fetch = fetch, base = ''): Promise<Health> {
  try {
    const r = await fetchImpl(`${base}/ws/_probe`, { cache: 'no-store' });
    return classifyStatus(r.status);
  } catch {
    return 'offline'; // no answer at all: the phone is offline (airplane mode, no signal)
  }
}

/** Vietnam has no daylight saving: the daily reset at 00:00 UTC is 07:00 there. */
export const QUOTA_RESET_TEXT = '7 giờ sáng (giờ Việt Nam)';
