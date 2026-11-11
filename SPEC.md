# SPEC — Vẽ hình đoán chữ

Online multiplayer draw-and-guess game, Vietnamese UI, up to 50 players per room (default 42), mostly phones opened from Zalo links.
This document is the contract between server, shared code and the UI: everything the UI needs is here.

- Stack: Cloudflare Workers + one SQLite-backed Durable Object per room (WebSocket Hibernation API), static client served by the same Worker (Workers static assets, SPA fallback), TypeScript, Vite + Preact, Vitest.
- Code map: `shared/` (constants, protocol, text utils, word packs, canvas engine) · `server/` (`room-core.ts` pure game logic, `room.ts` Durable Object adapter, `index.ts` Worker) · `client/src/net.ts` (connection/canvas sync library, UI independent) · `client/src/` (stage-2 UI, see §10) · `scripts/` (word checker, load test, uicheck, e2e, asset generator) · `tests/`.
- Language rule: code and comments in English, every player-facing string in Vietnamese (server `msg`/chat text is already Vietnamese).

---------------------------------------------------------------------------------------------------

## 1. Cloudflare free-plan facts and capacity estimate

Fetched from the official docs on 2026-11-11 (re-verify before relying on them; Cloudflare changes plans).

| Fact | Value | Source |
|---|---|---|
| DO requests (free) | 100,000 / day (resets 00:00 UTC) | https://developers.cloudflare.com/durable-objects/platform/pricing/ |
| DO duration (free) | 13,000 GB-s / day; each DO is billed at its 128 MB allocation (0.125 GB) | same |
| DO SQLite rows (free) | 5 M read / day, 100 k written / day, 5 GB stored | same |
| WebSocket billing | A connection = 1 request. **Incoming** messages are billed 20:1 as requests (100 msgs = 5 requests). **Outgoing messages are free.** Protocol pings and `setWebSocketAutoResponse` replies are free and use no wall time | same |
| Over the free limit | Operations of that type **fail with an error**; nothing is charged on the Free plan. (No sentence says Free is ever billed.) | same |
| Hibernation | Idle DOs with no timers/in-flight requests are evicted from memory and cost no duration. In-memory state is lost; `serializeAttachment` (max 16 KB) survives while the socket stays open. Alarms, `setTimeout/Interval` and requests keep a DO awake | https://developers.cloudflare.com/durable-objects/best-practices/websockets/ |
| Alarms | One alarm per DO; `setAlarm(ms)`, `getAlarm`, `deleteAlarm`; at-least-once, retried with exponential backoff (6 tries) after an uncaught throw | https://developers.cloudflare.com/durable-objects/api/alarms/ |
| Limits | CPU 30 s per request/alarm (default); max received WebSocket message 32 MiB; SQLite row/blob 8 MB | https://developers.cloudflare.com/durable-objects/platform/limits/ |
| Workers (free) | 100,000 requests/day, 10 ms CPU/invocation. Static asset requests are free and unlimited. A path matched by `run_worker_first` always invokes the Worker (429 when the free quota is exhausted) | https://developers.cloudflare.com/workers/platform/pricing/ · https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ |
| SPA + WebSocket routing | `assets.not_found_handling = "single-page-application"` (wrangler ≥ 4.20) plus `run_worker_first: ["/ws/*"]` | https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/ |

Not confirmed by the docs fetch (we do not rely on them): exact idle time before hibernation, max concurrent sockets per DO (we cap at 50), whether the free-plan per-DO storage cap is 1 GB or 5 GB total (we store < 1 MB per room).

### How the design stays far below the limits
- Only `/ws/*` hits the Worker; the HTML/JS/CSS are free static assets.
- Drawer batches every 40 ms (≈ 25 msgs/s) is the only high-rate inbound stream; guessers send ≈ 0.2 msg/s. Clock-sync pings are sent 5× on connect and then once a minute **only while drawing**; keep-alive is the free auto-response (`"ka"` → `"ka"`).
- Room state is written to SQLite only when the JSON actually changed (debounced 3 s; op log 5 s, in 200-op chunks, only the changed chunk). Lobby/idle rooms hibernate and cost no duration.
- Rooms are deleted 30 min after they empty (`storage.deleteAll()`).

### Measured traffic (reports/loadtest.md, 42 bots + 1 late joiner, 60 s turn, local workerd)
- 1,683 frames into the DO in 60 s = 28 msgs/s average (peak 72/s) → 84 billed requests per turn (+ 43 connection requests).
- Per client: 8.4 KB/s received on average, guessers send ≈ 5 B/s.

### Estimate: 42-player game-hours per day on the free plan
A turn cycle ≈ 15 s choosing + 80 s drawing + 7 s reveal ≈ 100 s → 36 turns/hour.
- **Requests** (binding limit): ≈ 28 msgs/s × 80 s ≈ 2,250 msgs + ≈ 250 pings/guesses/chat ≈ 2,500 msgs ≈ **125 billed requests/turn ≈ 4,500/hour** (+ ≈ 45 connection requests per game) → 100,000 / 4,500 ≈ **22 game-hours per day**.
- **Duration**: a busy DO never hibernates: 0.125 GB × 3,600 s = 450 GB-s/hour → 13,000 / 450 ≈ **29 game-hours per day**.
- **Rows written** (estimate, not measured): ≈ 50–80 rows/turn → ≈ 3,000/hour → ≈ 33 hours per day.
- Result: **≈ 20 hours/day of full 42-player play** (e.g. ten 2-hour class sessions), shared across all rooms; smaller rooms use proportionally less. A typical day (a few hours) uses < 15 % of the quota. Levers if ever needed: batch interval 40 → 60 ms (−33 % requests), longer persist debounce.
- If a limit is hit, Cloudflare returns errors (rooms stop accepting) — it never bills. The UI shows "Máy chủ đang bận" with a retry button after 3 failed connection attempts before the first welcome (stage 2, done).

---------------------------------------------------------------------------------------------------

## 2. Rooms and connections

- **Room code**: 5 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0 O 1 I L`). The client generates one when creating a room (`create: true` in `hello`); the server rejects `create` for a code that already has players (`exists`) and a plain join of a non-existent room (`noRoom`).
- **URLs**: `/r/CODE` is the share link (SPA fallback serves `index.html`, so reload works); WebSocket is `wss://host/ws/CODE` (case-insensitive, invalid codes → HTTP 400; a browser `Origin` that differs from the host → 403).
- **Capacity**: `maxPlayers` setting 2–50 (default 42), hard cap 50.
- **Session token**: `welcome.token` is stored by the client (`localStorage['vhdc:CODE']`) and sent in every later `hello`. Within **90 s** of a disconnect the same token returns to the same seat, score, guessed-state and turn; after 90 s the seat is released and the token joins as a new player (late join). A second tab with the same token replaces the first (`replaced`, fatal for the old tab). Kicked tokens are banned.
- **Host**: the creator. If the host has been disconnected for **30 s** the role passes to the longest-present connected player (earliest join). A returning old host is a normal player. `leave` passes it immediately. The host can also hand it over (`host`).
- **Clocks**: every `RoomView` carries `now` (server epoch ms) and `phaseEndsAt` (server epoch ms). Clients compute `remaining = phaseEndsAt - client.serverNow()` where `serverNow()` uses an offset estimated from `ping/pong` (min-RTT sample of the last 8; `offset = s + rtt/2 - clientNow`). `GameClient` does this; a unit test covers it.
- **Hibernation / persistence**: socket → player mapping lives in `serializeAttachment({cid, pid})`; room data (`RoomData`, including all deadlines) is saved to DO storage (`room`, `opsCount`, `ops:N`) and restored in the constructor (`blockConcurrencyWhile`). Phase timers, hints, drawer/host grace, seat expiry and room expiry are **one DO alarm** set to the earliest of the `timers` map. No `setTimeout` is used for game timing (only for ≤ 5 s persistence/flush debounces).
- **Expiry**: when the last connection leaves, the `expire` deadline (+30 min) is set; if nobody returns the alarm calls `storage.deleteAll()` and the room code becomes free.
- **Close codes**: 4000 hello needed · 4001 replaced · 4002 kicked · 4003 join refused (`error` sent first) · 4004 hello timeout (15 s) · 1008 rate/abuse · 1009 frame too big.

---------------------------------------------------------------------------------------------------

## 3. Settings (`Settings`, host only; clamped server-side)

Changeable in the lobby; while a game runs only `locked`, `allowLateJoin`, `maxPlayers`, `showClose` can change.

| Key | Type / range | Default | Meaning |
|---|---|---|---|
| `mode` | `'rotate' \| 'hostOnly' \| 'hostMC'` | `rotate` | **"Lần lượt"** everyone takes turns · **"Chỉ host vẽ"** the host draws every turn · **"Host không vẽ"** the host is MC and never draws |
| `endBy` | `'auto' \| 'rounds' \| 'turns'` | `auto` | `auto` = fixed turns when the room has more than 12 players, otherwise rounds. `hostOnly` always uses turns |
| `rounds` | 1–10 | 3 | "Số vòng": game ends when every present eligible drawer has drawn `rounds` times |
| `turns` | 1–200 | 12 | "Số lượt vẽ": fixed number of turns; drawers are picked fairly (nobody draws twice before everyone present has drawn once) |
| `drawTime` | 30–240 s | 80 | drawing time |
| `wordChoices` | 1–5 | 3 | words offered to the drawer (1 = no choice phase, except host drawer in `hostOnly`) |
| `chooseTime` | 5–60 s | 15 | time to pick; on timeout a random choice is used |
| `hints` | 0–5 | 2 | maximum letter reveals, spaced evenly over `drawTime` (k/(h+1) of the time). Capped per word at `floor((letters-1)/2)` so a word is never fully revealed |
| `categories` | subset of the 12 category ids | all | word pack categories (see §8) |
| `difficulties` | subset of `easy/medium/hard` | `easy, medium` | difficulty filter |
| `customWords` | ≤ 500 strings, ≤ 40 chars | `[]` | host's own words, mixed into the pool. **Never broadcast** (see `customWordCount` and `customWords` msg) |
| `onlyCustom` | bool | false | "Chỉ dùng từ của host" (start refused with `needCustom` if the list is empty) |
| `accentInsensitive` | bool | true | accept answers without diacritics (`đ` ≡ `d`) |
| `showClose` | bool | true | show "Gần đúng" to the guesser on a near-miss |
| `locked` | bool | false | no new players (returning players still welcome) |
| `allowLateJoin` | bool | true | allow joining while a game is running |
| `maxPlayers` | 2–50 | 42 | |
| `hostGuesses` | bool | true | `hostMC` only: may the MC guess (false ⇒ spectator: not a guesser, not counted for "everyone guessed", cannot chat the word) |

Host tools (not settings): `kick` (+ ban), `mute` (chat only; guessing still works), `host` (transfer), `pause`/resume, `skip`, `end` (to podium). In this build pause/skip/end are available to the host in every mode, not just `hostMC`.

---------------------------------------------------------------------------------------------------

## 4. Game rules

**Phases** (`RoomView.phase`): `lobby → choosing → drawing → reveal → (next turn: choosing …) → podium → (again) lobby`.
- `start` (host, lobby, ≥ 2 connected players; `hostMC` needs ≥ 1 player besides the host).
- **choosing**: only the drawer receives `secret.choices` (and `canCustom` for the host in `hostOnly`, who may also `pick {word}` any text of 2–40 chars). Everyone else sees only that someone is choosing. Canvas is cleared for all.
- **drawing**: `phaseEndsAt = start + drawTime`. Public `mask` shows `_` per hidden letter (spaces/punctuation kept), hints fill letters in. Only the drawer's `draw` messages are accepted.
- **reveal** (7 s): `reveal = {word, reason, deltas}`; reasons `allGuessed | timeUp | skipped | drawerLeft`. A `sync {n, hash}` is broadcast so clients can verify their canvas.
- **podium**: `podium[]` sorted by score with shared ranks; host `again` returns to the lobby (scores/draw counts reset, players kept, settings kept).
- Late joiners are guessers immediately and get the current canvas. Their draw count starts at the current minimum so they do not draw several turns in a row.

**Drawer selection**: among connected eligible players pick uniformly at random from those with the fewest draws. Eligible = everyone (`rotate`), host only (`hostOnly`), everyone but the host (`hostMC`). A skipped/ended turn still counts as drawn (so a bad drawer rotates away).

**Scoring** (server clock):
- Guesser: `100 + round(300 × remaining/drawTime) + max(0, 50 − 10 × orderIndex)` → 100–450.
- Drawer, at turn end: `round(300 × correct / guessers)` where `guessers` = connected non-drawer non-spectator players plus those who guessed.
- A turn ends early when every connected guesser has guessed (also when the last unguessed guesser disconnects), when the drawer is gone > 10 s (`drawerLeft`), on `skip`, on time-up.

**Guess check** (`shared/text.ts`): NFC, lower-case, punctuation → space, whitespace collapsed and **all spaces ignored**; with `accentInsensitive` diacritics are stripped (`đ → d`). *Gần đúng* = edit distance 1 on that key, only for keys of ≥ 3 chars.
Privacy rules (all unit-tested):
1. Non-drawers never receive the word before the reveal — no message other than the drawer's `secret` contains it, and a correct guesser is told only `guessOk {pts}`.
2. A wrong guess is shown to everyone (`chat ch:'all'`). A **near-miss** (or anything within one edit of the word, with or without accents, or containing it) is shown only to its author (`chat ch:'self'` + `close` if `showClose`) and to the drawer and players who already guessed (`ch:'team'`); other guessers never see its text.
3. A correct guess is announced to all as a system line `"<tên> đã đoán đúng!"` (`ch:'sys', code:'guessed'`) without the text.
4. After guessing, a player's chat goes to the **team channel** (drawer + players who guessed). The drawer chats in the same channel only. The drawer's (and a non-guessing MC's) message that equals/contains/nearly equals the word is blocked with notice `noWord`.
5. Outside `drawing`, and while paused, chat is public (while paused words that leak are still blocked).

**Rate limits and caps** (token buckets per socket): chat 2/s (burst 3) · draw batches 40/s (burst 60) · everything else 15/s (burst 30). Frame caps: 4 KB general, 24 KB draw/settings. Chat 120 chars, name 20. Repeated violations close the socket (1008). Draw ops: see §6.

---------------------------------------------------------------------------------------------------

## 5. Protocol (JSON text frames)

Types: `shared/protocol.ts`. Every client frame is validated (`parseClientMessage`) before use.

### Client → server
| `t` | Fields | Who / when | Notes |
|---|---|---|---|
| `hello` | `name`, `avatar` (0–23), `token?`, `create?`, `v?` | first frame, once | join / create / resume. Name sanitized (control chars removed, ≤ 20 chars, made unique with " 2") |
| `ping` | `c` (client ms) | any | reply `pong {c, s}` |
| `chat` | `text` | any | a guess while drawing (see §4) |
| `draw` | `ops: Op[]`, `span` (ms) | current drawer, `drawing`, not paused | batch ≈ every 40 ms; invalid batch ⇒ nothing applied, `drawReject` + fresh `canvas` to the drawer |
| `pick` | `i?` choice index, `word?` custom (host in `hostOnly`) | drawer, `choosing` | |
| `settings` | `patch` | host | partial; see §3 |
| `start` / `again` / `pause` / `skip` / `end` / `leave` | – | host (leave: anyone) | `pause` toggles |
| `kick` `{id}` / `mute` `{id,on}` / `host` `{id}` | | host | |
| `resync` | – | any | server resends the canvas snapshot |
| *(raw string `ka`)* | | any | free keep-alive, answered `ka` by the runtime without waking the DO |

### Server → client
| `t` | Fields | Sent to | Notes |
|---|---|---|---|
| `welcome` | `you`, `token`, `v`, `room: RoomView`, `secret?` | the joiner | followed by `canvas` (if a turn exists) and `customWords` (host) |
| `state` | `room: RoomView` | all | full snapshot; sent on every change, throttled to one per 80 ms (phase changes immediately). ≈ 6 KB at 42 players |
| `secret` | `secret: SecretView` | drawer only | `{choices, canCustom}` in `choosing`, `{word}` in `drawing` |
| `customWords` | `words` | host only | the custom list (kept out of `state`) |
| `chat` | `ch: 'all'\|'team'\|'sys'\|'self'`, `from?`, `name?`, `text`, `code?` | per rules in §4 | `sys` codes: `join leave kick host guessed start pause resume end` |
| `close` | – | the guesser | "Gần đúng" |
| `guessOk` | `pts` | the guesser | |
| `draw` | `n`, `ops`, `span` | all except the drawer | `n` = index of the first op in the server log; clients check `n === log.length` |
| `canvas` | `n`, `ops`, `total`, `hash`, `reset`, `last` | joiner / resync / drawer after reject; everyone at turn start (empty) | pages; `reset` on the first page; apply when `last` |
| `sync` | `n`, `hash` | all, at turn end | final op count and log hash; mismatch ⇒ `resync` |
| `drawReject` | `code`, `n` | drawer | |
| `pong` | `c`, `s` | requester | |
| `notice` | `code`, `msg` | one client | non-fatal, Vietnamese `msg`: `notHost badMsg muted noWord needPlayers needDrawer needCustom wrongPhase` |
| `error` | `code`, `msg` | one client, then close | `noRoom exists full locked noLate banned replaced helloTimeout` |
| `kicked` | `msg` | the kicked player | |

### `RoomView` (inside `welcome` / `state`)
`code, rev, phase, settings (PublicSettings: Settings minus customWords plus customWordCount), players[], hostId, drawerId, turnNo (1-based), turnsTotal, round, roundsTotal, endMode ('rounds'|'turns'), phaseEndsAt, phaseStartedAt, paused, pausedRemaining, mask, hintsGiven, hintsTotal, reveal {word, reason, deltas[]} (reveal phase only), podium[] (podium only), now`.
`PlayerView`: `id, name, avatar, score, connected, host, drawer, guessed, muted, spectator, delta` (`delta` = points this turn).

---------------------------------------------------------------------------------------------------

## 6. Canvas engine (`shared/canvas`)

- Logical canvas **1200 × 900**, white background, same for everyone (the view scales it).
- **Ops** (`ops.ts`), all integers:
  - `{k:'b', t:0|1, c:rgb, w:1..80, x, y}` begin stroke (`t` 0 pen, 1 eraser; the eraser paints white) — draws a dot.
  - `{k:'m', p:[dx,dy,…]}` more points, delta-encoded from the previous point of the open stroke (each coordinate must stay inside the canvas, delta within ±1200). A stroke = one `b` + any number of `m`; it is closed by any other op.
  - `{k:'f', x, y, c}` flood fill with tolerance (RGB distance 90) plus a 1-px halo growth over anti-aliased blends (≤ 300), so no light fringe remains; solid strokes are never eaten.
  - `{k:'u'}` undo · `{k:'r'}` redo · `{k:'x'}` clear (clear is itself undoable). A new element clears the redo stack.
- **Limits per turn**: 12,000 ops, 60,000 points, 3,000 points/stroke, 150 fills; per batch 120 ops / 400 points. **UI rule: keep each `m` op ≤ 400 points (≈ 64 is typical); one `m` per frame is fine** — ops are never split in transit because the drawer's log must equal the server's.
- **`OpLog`** (server and every client): validates atomically (`tryAppend`), keeps the incremental chained hash (`hash`, 16 hex chars) over canonical op strings. The server keeps the log for the current turn in memory and persists it in chunks; snapshots (`canvas`) are paged (~120 KB/page).
- **`CanvasEngine(ctx)`** takes any `Ctx2D` (browser canvas, OffscreenCanvas, or the built-in deterministic `SoftContext` used by tests). `receive(ops)` logs, `step(n)/flush()` renders, `apply(ops)` = both (the local drawer). Rendering is a pure function of the log (segment-by-segment strokes with round caps), so live incremental drawing, full replay and snapshots give identical pixels. Undo/redo restore the nearest of ≤ 8 cached checkpoints (interval 16 elements, doubling as the stack grows) and replay only the elements after it (tested with 400 strokes: ≤ one interval replayed per undo).
- **`Playback(engine)`**: `enqueue(ops, span, now)` logs at once and renders units (points / discrete ops) linearly across `span` (clamped to 250 ms; lag capped at 500 ms); call `tick(Date.now())` from `requestAnimationFrame`; `flush()` renders everything.
- **Drawer flow** (`GameClient.draw(ops)`): render locally at once, queue, send a `draw` batch every 40 ms with `span` = time since the previous batch.

---------------------------------------------------------------------------------------------------

## 7. Client library (`client/src/net.ts`)

```ts
const c = new GameClient({ url: `wss://${location.host}/ws/${code}`, code, name, avatar, create, storage: localStorage });
c.attachEngine(new CanvasEngine(ctx), new Playback(engine));   // optional; without it only the OpLog is tracked
c.on('change', render); c.connect();
c.room        // latest RoomView           c.secret   // drawer-only word/choices
c.chat        // ChatLine[] (all channels) c.closeHint // ++ on "Gần đúng"
c.serverNow() // use for countdowns        c.isDrawer
c.send({t:'chat', text}); c.draw([{k:'b',…},{k:'m',…}]);
```
Reconnects automatically with backoff (0.4 s → 8 s) using the stored token; `fatal` is set for `error`/`kicked` and stops reconnecting. Gaps in `draw.n`, bad snapshots and sync mismatches trigger `resync` automatically. `change` is **not** emitted for `draw`, `pong`, `sync` or `canvas` messages, so the UI never re-renders per stroke.
UI notes: show the countdown from `phaseEndsAt`; do not display `reveal.word` before `phase === 'reveal'`; render `mask` with letter spacing; `players[].guessed` for check marks; chat channels `team`/`self` should look distinct; show "Gần đúng" briefly on `closeHint` change; on connection failure show a friendly retry message; keep every `m` op small.

---------------------------------------------------------------------------------------------------

## 8. Word packs (`shared/words`)

1,038 words and short phrases, correct Vietnamese diacritics, 12 categories × 3 difficulties: `object` Đồ vật · `animal` Con vật · `food` Đồ ăn · `job` Nghề nghiệp · `action` Hành động · `place` Địa điểm Việt Nam · `nature` Thiên nhiên · `vehicle` Phương tiện · `festival` Lễ hội & văn hóa · `body` Cơ thể & trang phục · `sport` Thể thao & trò chơi · `school` Trường học & âm nhạc. Source: `shared/words/data.ts` (comma-separated per category/difficulty). `npm run words:check` fails on duplicates (accent-folded), non-NFC text, bad characters, invalid Vietnamese syllable shapes, more than one tone mark per syllable, and stop-final syllables (`c ch p t`) without sắc/nặng; a vitest case runs the same checks. A word is not repeated within a game until the pool is exhausted.

---------------------------------------------------------------------------------------------------

## 9. Acceptance list (with evidence, re-checked at the end of stage 1)

| # | Item | Evidence |
|---|---|---|
| A1 | Vitest covers the state machine in all three modes, scoring, fair drawer selection, hints, guess normalization and near-miss, host transfer, reconnect, late join, word privacy; all pass | `npm test` → 6 files, 78 tests passed. Modes: `room.game.test.ts` "Chỉ host vẽ", "Host không vẽ", `room.basic.test.ts` "rotate mode"; scoring/hints/guesses/privacy in `room.game.test.ts`; fairness (8 players ×2 rounds, 14-player turn mode, late joiner); host transfer, reconnect, late join, relay validation, rate limits, expiry, hibernation round-trip in `room.presence.test.ts`; normalization/near-miss in `text.test.ts`; canvas in `canvas.test.ts`; clock sync in `client.test.ts` |
| A2 | `npm run loadtest`: 42 bots vs `wrangler dev`; drawer streams strokes a full turn; others chat/guess; 5 drop+reconnect; 1 joins late; reports p50/p95 relay latency, bytes/s per client, msgs/s into DO, zero lost/reordered ops, all op-log hashes equal the server's; report in `reports/loadtest.md` | `reports/loadtest.md`: 43/43 hashes equal (2,913 ops), 0 gaps, 5/5 reconnects, late joiner matches, p50 13.9 ms / p95 22.6 ms / p99 42.8 ms, 8.4 KB/s received per client, 28.0 msgs/s (peak 72) into the DO |
| A3 | Two headless Chromium pages on the debug page, one room: draw, fill, undo, redo on one → identical canvas on the other; screenshots in `reports/` | `npm run e2e` → `reports/e2e.md` (12/12 checks: identical op hash, raw RGBA hash and PNG; fill red inside, not outside; reload restores the same canvas and seat) + `reports/e2e-drawer.png`, `e2e-viewer.png`, `e2e-viewer-after-reload.png` |
| A4 | Project `CLAUDE.md` (dev/test/loadtest/build/deploy, gotchas, working rules) and `PLAN.md` (stages 1–4) | files in the repo root |
| A5 | `npm run build` then `npx wrangler deploy` work from a clean clone | `git clone` → `npm ci` → `npm run build` → `npx wrangler deploy --dry-run` succeeds (assets 3 files, bindings `ROOM` DO + `ASSETS`); real deploy needs the user's Cloudflare login (stage 3) |
| A6 | ≥ 800 drawable family-friendly words with categories and difficulty, script-checked | `npm run words:check` → 1,038 words, 0 problems |
| A7 | Hibernation + alarms work on the real runtime | `wrangler dev`: DO constructed, evicted after idle, woke on the next message with `players=1 sockets=1` restored from storage + attachments; a hint alarm fired at 41 s after a 40 s idle gap |
| A8 | CF limits recorded with links and an hours/day estimate | §1 |

### Known gaps / decisions (stage 1)
- Verified on local workerd only; real-network latency and the free-plan quotas are estimated, not measured (stage 3 re-runs the load test with `TARGET_URL`).
- `state` is a full snapshot (≈ 6 KB at 42 players) throttled to 80 ms; a diff protocol is the next bandwidth lever if needed (average 8 KB/s/client now).
- Deploying new code evicts running DOs: an in-progress turn may lose up to ~5 s of strokes (the persisted op log lags by the 5 s debounce); players reconnect automatically.
- Pause/skip/end are allowed for the host in every mode (superset of the MC requirement).


---------------------------------------------------------------------------------------------------

## 10. Client UI (stage 2)

Preact + plain CSS, no router: **routing is by path only** (`/` home, `/r/CODE` join). Every query string / hash that a host app appends is removed at start with `history.replaceState`. Static Open Graph tags + manifest (`display: standalone`) live in `client/index.html`; no service worker.

### Code map (`client/src/`)
`main.tsx` boot · `app.tsx` screen switch, fullscreen question, reconnect banner, error screens · `session.ts` owns the `GameClient`, the drawing surface, the gallery and the sound/vibration cues; `useSession()` re-renders through one rAF-coalesced notification · `platform.ts` safe storage (memory fallback), env detection, visualViewport vars, fullscreen, Wake Lock, vibrate, share/copy · `prefs.ts` player settings (`localStorage['vhdc:prefs']`) · `sound.ts` (+ `vendor/sfx.js`, loaded lazily on the first tap) · `draw/surface.ts` canvas + engine + pointer input + shortcuts, **outside Preact** · `draw/toolbar.tsx` tools, sizes, 24 presets + last 6 used, HSV picker · `screens/{home,lobby,game,podium}.tsx` · `panels.tsx` scoreboard + chat · `ui.tsx` primitives · `icons.tsx` lucide (tree-shaken) + 24 avatars (6 animals x 4 accents).

### Screens
Home (name remembered, avatar tap-to-change, "Tạo phòng", 5-box code input that accepts a pasted code or a pasted link) · join-from-link (name only; a stored session token rejoins silently) · lobby (player grid, host settings in 5 collapsible groups covering every key of §3, share: Web Share API when present, copy link, local QR via `qrcode-generator`) · game: choosing overlay, drawing, reveal overlay (word + top gains) · podium (top 3 + list) · gallery (every drawing this client saw at turn end, PNG save). Player settings sheet: âm thanh, rung (hidden without `navigator.vibrate`), toàn màn hình, thuận tay trái, giao diện tối; host sees "Kết thúc ván" (confirm), everyone "Rời phòng".

### Drawing
Tools bút / tẩy / sơn / hút màu, hoàn tác, làm lại, xóa hết (confirm sheet), 5 sizes (4/10/20/36/60 logical px), 24 presets + last 6 used, custom colour = HSV square + hue slider + hex field. Pointer Events with `getCoalescedEvents`, exponential smoothing (0.55) + 2 px minimum step, one `m` op per animation frame, chunks of <= 64 points; `touch-action: none`, `touchstart/move` prevented on the canvas, `overscroll-behavior: none` on the page, no selection. Shortcuts: B E F I, Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z, `[` `]`. Layout: `html.is-wide` (visual width >= 600 and width/height >= 1.1) = toolbar | canvas | side panel, mirrored by "thuận tay trái"; otherwise a column: bar, word, canvas 4:3 (capped at 56 % of the visible height), toolbar, scoreboard (drawer, top 3, you -> "Tất cả" sheet), chat (last 60 lines), guess input. The app box follows `visualViewport` (`--vv-h`, `--vv-top`) so the iOS keyboard shrinks the chat, never moves the canvas; `html.is-kb` hides the bar and scoreboard while typing.

### Zalo / in-app browser notes (Haiku research, sources; most Zalo facts could NOT be verified)
- UA: no confirmed Zalo token; Android WebViews often contain `wv` ([51degrees](https://51degrees.com/blog/webview-detection)). We match `/Zalo/` and treat it as in-app; everything else is feature-tested, not UA-tested.
- Query params: `zarsrc` not found in any source; `utm_*` generic. -> strip **all** query/hash.
- Fullscreen: Zalo unverified; API needs user activation and `document.fullscreenEnabled` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API)); iPhone has none (from memory). -> feature-test, verify `fullscreenElement` 250 ms after the request, else show the alternative (open in browser, add to home screen).
- Storage: Android in-app browsers can disable DOM storage ([source](https://victorleungtw.github.io/2020/09/07/caveat-on-android-in-app-browser)); logins are not shared with the system browser ([Master](https://blog.master.dev/the-pitfalls-of-in-app-browsers/)). -> every access in try/catch + memory fallback; the session token is lost across browsers.
- Viewport/keyboard: no sources. -> `visualViewport`, `100dvh` fallback, safe-area insets.
- Link previews: Zalo caches them; re-share or add `?v=2` after edits ([ChungDoi](https://chungdoi.com/en/help/articles/fix-share-preview)). -> static OG tags, `og-image.png?v=1` (bump on change).
- `navigator.share` needs HTTPS + a click ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)); blob downloads often fail in in-app browsers ([Master](https://blog.master.dev/the-pitfalls-of-in-app-browsers/)). -> share button only when present; gallery save tries file share, then `<a download>`, and the lightbox says "Nhấn giữ ảnh để lưu" in-app.
- Zalo injects a bridge (`zaloJSV2`); `index.html` stubs it before anything else.
- To do on real devices (stage 3): log `navigator.userAgent` and `location.href` from a shared link on iOS and Android Zalo.

### Acceptance list (stage 2)
| # | Item | Evidence |
|---|---|---|
| B1 | Real client with all screens in the brief, sketchbook look (paper `#F5EFE3`, ink `#1E1B18`, flat accents, solid offset shadows, dark theme through CSS variables, no gradients/glow/blur/emoji except the colour picker's own hue/value ramps), Baloo 2 + Be Vietnam Pro (vietnamese subset) from `@fontsource` | `client/src/`, `reports/screens/*.png`; glyph check `ẵ ữ ộ Đ ặ ừ` renders from the web fonts, not the fallback (uicheck `fonts`) |
| B2 | Title on two lines, original SVG icon (3 colours + ink), `favicon.svg`, maskable PNG 192/512, apple-touch-icon 180, og-image 1200x630 | `client/public/`, regenerate with `npm run assets`; checked at 16 px |
| B3 | uicheck: home, lobby (22 players, long names), drawing, podium + choose/palette/settings at 360x740, 390x844, 768x1024 (touch) and 1440x900, plus 768x1024 dark: no horizontal/vertical page overflow, no controls outside the viewport, overlapping or covered, no text overflowing its box | `npm run uicheck` -> `reports/uicheck.md`, `reports/screens/` |
| B4 | Behaviour: first entry asks "Chơi toàn màn hình?" and remembers it; iPhone and Android-Zalo UAs get the alternative instead of a silent failure; code boxes accept pasted code and link; query params stripped; refused join shows a Vietnamese message; initial JS < 150 KB gzip | uicheck "behaviour" lines (initial JS 36.7 KB gzip; sfx 6.6 KB and QR 7.3 KB load lazily) |
| B5 | 3 real pages play a full game per drawer mode to the podium: draw, fill, custom colour, undo, redo, clear + undo, correct / accent-less / near-miss / wrong guesses, reload-reconnect (same seat, same canvas), identical op + pixel hashes, reveal word, gallery (1 PNG per turn) and PNG download | `npm run e2e` -> `reports/e2e.md` |
| B6 | 42-bot load test with one real Chromium page in the room: hashes equal, frame times from a rAF probe | `reports/loadtest.md`: 43/43 hashes equal (2,936 ops, browser page included), 0 gaps, 5/5 reconnects; page rAF probe 3,596 frames, 60.0 fps, p50 16.7 / p95 16.7 / p99 16.8 ms, max 50 ms, 2 frames > 20 ms, 0 > 50 ms, 1 long task (headless, software rendering, shared CPU) |
| B7 | `npm test` (78), `npm run typecheck`, `npm run build`, `npm run words:check` pass | run at the end of stage 2 |

Known limits: iOS keyboard behaviour, Wake Lock, vibration, Web Share and the Zalo in-app browser are implemented defensively but only verifiable on real devices (stage 3). Chat shows the last 60 lines only. The gallery contains the drawings this client saw (a late joiner misses earlier turns).
