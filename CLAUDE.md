# CLAUDE.md — Vẽ hình đoán chữ

Online multiplayer draw-and-guess game (Vietnamese UI, up to 50 players/room, phones via Zalo links).
Cloudflare Workers + one SQLite-backed Durable Object per room (WebSocket Hibernation), static client on the same Worker.
Read **SPEC.md** (protocol, state, settings, rules, limits) and **PLAN.md** (stages) before changing anything.

## Layout
- `shared/` — constants, `protocol.ts` (types, validators, settings), `text.ts` (Vietnamese normalize / near-miss / masks), `words/` (word packs), `canvas/` (op log, deterministic engine, fill, playback, SoftContext).
- `server/` — `room-core.ts` (ALL game logic, pure, injected `Io`), `room.ts` (Durable Object adapter), `index.ts` (Worker: `/ws/CODE` → DO; everything else static assets).
- `client/` — Vite + Preact. `src/net.ts` = connection/canvas sync library (UI independent); `src/main.tsx` = stage-1 debug page only.
- `scripts/` — `check-words.ts`, `loadtest.ts`, `e2e-canvas.ts`, `lib/dev-server.ts` (starts `wrangler dev`). `tests/` — Vitest. `reports/` — generated evidence.

## Commands
```bash
npm ci                    # install (clean clone)
npm run dev               # build client, then wrangler dev on http://localhost:8787 (no Cloudflare account needed)
npm run dev:client        # vite dev server on :5173, proxies /ws to :8787 (run wrangler dev too)
npm test                  # vitest (78 tests, ~1 s)
npm run typecheck         # tsc --noEmit
npm run words:check       # validate word packs (dups, NFC, diacritics, syllable shapes)
npm run loadtest          # 42 bots vs a fresh wrangler dev; writes reports/loadtest.md (≈ 80 s). Env: DRAW_SECONDS=60 BOTS=42 TARGET_URL=https://… to test a running/deployed server
npm run e2e               # two headless Chromium pages (Playwright); writes reports/e2e.md + screenshots. Env: TARGET_URL, CHROMIUM_PATH
npm run build             # vite build → dist/ (the Worker's static assets)
npx wrangler deploy       # deploy (needs `wrangler login` or CLOUDFLARE_API_TOKEN); run `npm run build` first
npx wrangler deploy --dry-run   # verify the bundle/config without an account
```

### Production deploy (Cloudflare Workers Builds, connected to this repo; push to `main` deploys)
- Root directory: `/` · Build command: **`npm run build`** · Deploy command: **`npx wrangler deploy`** · Node 22.
- `wrangler.jsonc` already holds everything: `main: server/index.ts`, assets `./dist` with SPA fallback and `run_worker_first: ["/ws/*"]`, DO binding `ROOM`, migration `v1` with `new_sqlite_classes: ["Room"]` (required on the free plan). No secrets, no env vars.
- From a clean clone: `npm ci && npm run build && npx wrangler deploy` works with no manual steps (verified with `--dry-run`).
- Never rename the `Room` class or edit migration `v1`; add a new migration tag for DO schema changes.

## Gotchas
- **Imports use explicit `.ts` extensions** and the tsconfig has `erasableSyntaxOnly`: no enums, namespaces or constructor parameter properties. This lets Node (`--experimental-strip-types`) run `scripts/` against `shared/` code.
- **Durable Objects lose memory when they hibernate.** Anything needed later goes in `RoomData` (persisted) — never in module/instance fields. Per-socket data lives in `serializeAttachment`. Game timing uses the single DO alarm (`RoomData.timers`), never `setTimeout`.
- `RoomCore` is the only place with game rules; keep it free of Cloudflare APIs so tests run with the fake `Io` in `tests/helpers.ts` (fake clock: `h.advance(ms)`).
- **Word privacy**: the secret word may only be sent to the drawer (`secret`) and in `reveal`. `settings.customWords` must never be in broadcast state (it is sent to the host via `customWords`). There is a test that scans every message to non-drawers; keep it green when adding messages.
- The op log hash must equal on server and all clients: ops are never split/merged in transit; the drawer's local log = what it sent. Keep each `m` op ≤ 400 points.
- Canvas rendering must stay deterministic and incremental-safe (segment-by-segment strokes, no smoothing curves, no alpha blending in the engine).
- `wrangler dev` needs `dist/` built first (`npm run dev` does it). Only `/ws/*` runs the Worker; asset requests must not.
- Free-plan billing: incoming WebSocket messages count 20:1 as requests, outgoing are free. Don't add per-second client pings or chatty messages without re-checking SPEC §1.
- Deploying evicts live DOs; clients reconnect automatically with their session token.
- Fonts/libraries come from npm only (the environment may block other hosts). UTF-8 everywhere; word lists must be NFC.
- Playwright: use `playwright-core` with `executablePath` `/opt/pw-browsers/chromium` (pre-installed); do not run `playwright install`.

## Working rules
- Read existing code, SPEC.md and PLAN.md first; follow existing patterns.
- Keep going until the stage is done; ask only on real blockers.
- Stay in scope; never hard-code anything to pass a check.
- Verify for real and show evidence; use Haiku subagents for investigation.
- No secrets in the repo.
- UTF-8 everywhere; Vietnamese text with correct diacritics.
- Commit each verified milestone with a clear message. At the end of the stage, when all checks pass, push to main; if pushing to main is not allowed, push the branch, open a PR and tell the user to merge it.
- Update PLAN.md at the end of every stage. Final report in 5 lines: done, checks and results, files changed, open issues, next step.
- Code and comments in English, every player-facing string in Vietnamese. SPEC.md documents every protocol message, the room state and all settings so the next session can build the UI from it alone.
