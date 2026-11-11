// Shared constants for client, server and tests.

export const CANVAS_W = 1200;
export const CANVAS_H = 900;
export const PROTOCOL_VERSION = 1;

/** 31 chars: no 0 O 1 I L. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;

export const HARD_MAX_PLAYERS = 50;
export const DEFAULT_MAX_PLAYERS = 42;
export const NAME_MAX_LEN = 20;
export const CHAT_MAX_LEN = 120;
export const AVATAR_COUNT = 24;

// Timing (ms)
export const RECONNECT_GRACE_MS = 90_000;
export const HOST_GRACE_MS = 30_000;
export const DRAWER_GRACE_MS = 10_000;
export const REVEAL_MS = 7_000;
export const ROOM_EXPIRE_MS = 30 * 60_000;
export const STATE_THROTTLE_MS = 80;
export const PERSIST_DEBOUNCE_MS = 3_000;
export const OPS_PERSIST_DEBOUNCE_MS = 5_000;
export const DRAW_BATCH_MS = 40;

// Rate limits (token buckets: capacity, refill per second)
export const RATE = {
  chat: { capacity: 3, perSec: 2 },
  draw: { capacity: 60, perSec: 40 },
  general: { capacity: 30, perSec: 15 },
} as const;

// Message size caps (UTF-16 code units of the raw frame)
export const MAX_MSG_LEN = 4_096;
export const MAX_DRAW_MSG_LEN = 24_000;
export const MAX_SETTINGS_MSG_LEN = 24_000;

// Canvas op limits per turn
export const MAX_OPS_PER_TURN = 6_000;
export const MAX_POINTS_PER_TURN = 40_000;
export const MAX_POINTS_PER_STROKE = 3_000;
export const MAX_OPS_PER_BATCH = 120;
export const MAX_POINTS_PER_BATCH = 400;
export const MAX_FILLS_PER_TURN = 150;
export const MIN_BRUSH = 1;
export const MAX_BRUSH = 80;
export const SNAPSHOT_PAGE_OPS = 1_500;

export const MIN_PLAYERS_TO_START = 2;
