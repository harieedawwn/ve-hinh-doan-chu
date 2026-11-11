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

## Stage 2 — Full UI (Vietnamese, mobile first)
- [ ] Landing: create room / join by code or `/r/CODE`, name + avatar, remembered name
- [ ] Lobby: player list, share link/code (copy, Zalo share), all settings (SPEC §3) with sensible presets (class of 42: fixed turns), custom word editor, kick/mute/lock
- [ ] Game screen: canvas (scaled 1200×900, pointer events, palette, brush sizes, eraser, fill, undo/redo/clear), word choice, mask + hints, timer from server clock, scoreboard with guessed marks, chat/guess box with the separate team channel, "Gần đúng" feedback, reveal and podium screens, MC controls (pause/skip/end)
- [ ] Phone ergonomics: touch drawing without scroll, safe areas, landscape, small screens, Zalo in-app browser quirks, Vietnamese fonts from npm (e.g. `@fontsource/*`), reduced-motion, dark mode
- [ ] Connection UX: reconnect banner, "phòng đầy / đã khóa / không tồn tại" errors, over-quota friendly message
- [ ] Sound/animation polish (optional), accessibility pass
- [ ] Keep the debug page reachable (e.g. `/debug`) or remove it; update the Playwright e2e to the new selectors

## Stage 3 — Review and deploy
- [ ] Code review (`/code-review`, security review of the WebSocket surface: validation, rate limits, origin check)
- [ ] Connect the repo to Cloudflare Workers Builds (build `npm run build`, deploy `npx wrangler deploy`), first deploy, check the DO migration
- [ ] Re-run load test and e2e against the deployed URL (`TARGET_URL=…`); real phones on mobile data (latency, reconnect, Zalo browser)
- [ ] Watch the Cloudflare dashboard for requests / duration / rows after a real 42-player session; compare with SPEC §1; tune batch interval/persist debounce if needed
- [ ] Optional custom domain; `wrangler tail` sanity check

## Stage 4 — Optional: telephone mode ("Truyền tin")
- [ ] New mode: chain of draw → describe → draw rounds (each player works on the previous player's output), reveal of the chains at the end
- [ ] Needs new phases/messages in SPEC, a per-player canvas model (one op log per chain link) and storage budget review (rows/bytes)
