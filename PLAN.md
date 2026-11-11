# PLAN

Status legend: [x] done · [ ] todo

## Stage 1 — Core (server, game logic, protocol, canvas engine, tests, load test) — DONE
- [x] Scaffold: Cloudflare Worker + SQLite DO, Vite + Preact client, Vitest, `.gitignore`, `wrangler.jsonc` (SPA fallback, `run_worker_first: ["/ws/*"]`)
- [x] Cloudflare limits researched, recorded with links + 42-player hours/day estimate (SPEC §1)
- [x] Shared protocol, settings (clamped), Vietnamese text utils (normalize, near-miss, masks)
- [x] Word packs: 1,038 words, 12 categories × 3 difficulties, checker script
- [x] Canvas engine: op log + hash, deterministic renderer, fill with tolerance/halo removal, checkpointed undo/redo, playback, SoftContext
- [x] `RoomCore` state machine: 3 modes, fair drawers, scoring, hints, guess/near-miss/privacy, chat channels, pause/skip/end, kick/mute, host transfer, reconnect, late join, rate limits, expiry
- [x] Durable Object adapter: hibernation, attachments, alarms, debounced SQLite persistence, restore
- [x] Client library (`GameClient`) + debug page
- [x] Tests: 78 Vitest tests; 42-bot load test (`reports/loadtest.md`); Playwright two-browser check (`reports/e2e.md`)
- [x] SPEC.md (acceptance list with evidence), CLAUDE.md, PLAN.md; clean-clone build + `wrangler deploy --dry-run`

### Stage 1 hand-over notes
- UI must follow SPEC §5–§7: render from `GameClient.room`, countdown from `phaseEndsAt` + `serverNow()`, keep `m` ops small.
- Open: `state` is a full ≈ 6 KB snapshot (avg 8 KB/s/client at 42 players) — add diffs only if real-device testing shows a need.
- Open: everything measured on local workerd; stage 3 must re-run `TARGET_URL=https://… npm run loadtest` and `npm run e2e` against the deployed Worker.

## Stage 2 — Full UI (Vietnamese, mobile first) — DONE
- [x] Landing: create room / join by code (5 boxes, paste) or `/r/CODE`, name + avatar remembered, query params stripped
- [x] Lobby: player grid, share (Web Share, copy, local QR), all SPEC §3 settings in collapsible groups, custom words, kick/mute/host transfer
- [x] Game: canvas outside Preact, pointer input with smoothing, 7 tools + 5 sizes + 24 presets + recent + HSV, word choice, mask, timer from server clock, compact scoreboard, chat/guess with team channel, "Gần đúng", reveal, podium, gallery with PNG save
- [x] Phone ergonomics: portrait/landscape/tablet layouts, left-handed mirror, safe areas, visualViewport, Wake Lock, reduced motion, dark theme, first-entry fullscreen question + alternatives, Zalo handling (SPEC §10)
- [x] Connection UX: reconnect banner keeping the canvas, Vietnamese refusal screen, "Máy chủ đang bận" after repeated failures
- [x] Sounds (lazy, tactile) + vibration, both toggleable
- [x] Debug page removed; `scripts/e2e-game.ts` replaces the old canvas e2e; `scripts/uicheck.ts`; load test now includes a real browser page

### Stage 2 results
`npm test` 78/78 · `npm run typecheck` clean · `npm run uicheck` all passed (see `reports/uicheck.md`) · `npm run e2e` all passed (3 modes, `reports/e2e.md`) · `npm run loadtest` passed with a browser page (`reports/loadtest.md`) · initial JS 36.7 KB gzip.

### Stage 2 hand-over notes
- Zalo specifics are unverified (research found almost nothing): test on real iOS/Android Zalo, log UA and `location.href`, and bump `og-image.png?v=` after any preview change (Zalo caches).
- iOS keyboard / `visualViewport`, Wake Lock, vibration and Web Share cannot be proven in headless Chromium.
- Possible polish: avatar picker screen, chat in the lobby, haptics tuning, landscape-phone toolbar scrolls when the screen is under ~420 px high.

## Stage 3 — Review and deploy
- [x] Code review (Opus read-only review, 10 findings fixed with regression tests, SPEC §11); `/version` + quota screen (SPEC §1)
- [x] Workers Builds deploy from main works; `/version` polled until live
- [x] Load test, e2e and link-preview check re-run against production (reports/loadtest.md); real phones still to do (TEST_ON_PHONES.md)
- [ ] Watch the Cloudflare dashboard for requests / duration / rows after a real 42-player session; compare with SPEC §1; tune batch interval/persist debounce if needed
- [ ] Optional custom domain; `wrangler tail` sanity check

## Stage 4 — Optional: telephone mode ("Truyền tin")
- [ ] New mode: chain of draw → describe → draw rounds (each player works on the previous player's output), reveal of the chains at the end
- [ ] Needs new phases/messages in SPEC, a per-player canvas model (one op log per chain link) and storage budget review (rows/bytes)
