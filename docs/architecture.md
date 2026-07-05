# Architecture

Neon Vector Defense is a single-page React app with a headless TypeScript game engine. The same engine powers live play, bot playtests, balance simulations, and admin analytics.

## Layer model

The codebase follows a practical three-layer split. UI components observe game state and dispatch actions; game logic lives in `src/game/` modules; Firebase and external integrations sit behind facades in `leaderboard.ts`, `firebaseClient.ts`, and `balanceConfig.ts`.

```
┌─────────────────────────────────────────────────────────────┐
│  UI (React)                                                 │
│  App.tsx · AdminDashboard · ReplayViewer · OperationsBoard  │
└───────────────────────────┬─────────────────────────────────┘
                            │ reads/writes facades
┌───────────────────────────▼─────────────────────────────────┐
│  Game domain (src/game/)                                    │
│  engine · towers · enemies · waves · render · bot · meta  │
└───────────────────────────┬─────────────────────────────────┘
                            │ network / persistence
┌───────────────────────────▼─────────────────────────────────┐
│  Services & integrations                                  │
│  leaderboard · firebaseClient · balanceConfig · aiHelp      │
│  Cloud Functions (functions/) · Cloudflare Worker (worker/) │
└─────────────────────────────────────────────────────────────┘
```

**Important boundary:** `meta.ts` is cosmetic/QoL only. It must never feed combat math, unlock thresholds, or score. The bot-tuned ladder stays clean by construction.

## Module map

| Module | Role |
| --- | --- |
| `engine.ts` | Core simulation: movement, combat, abilities, freeplay, run recorder hooks |
| `render.ts` | Canvas drawing, camera shake, quality scaling, tower/enemy art |
| `towers.ts` / `enemies.ts` / `waves.ts` | Static content definitions and stat computation |
| `eliteAffixes.ts` | Deterministic elite variant planning, tuning constants, and Bestiary reveal metadata |
| `maps.ts` / `difficulty.ts` | 8 sectors x 4 protocols |
| `bot.ts` | Headless AI at rookie / standard / expert tiers |
| `runTelemetry.ts` | Run setup, compact r3 action streams, public replay chunks, private checkpoint docs |
| `leaderboard.ts` | Firestore facade; replay upload/read; score submit via Cloud Functions |
| `storage.ts` | localStorage progression (kills, archive, blueprints, settings) |
| `meta.ts` | Warden Rank, Salvage, Operations Board quests, Watch Streak |
| `balanceConfig.ts` | Remote Firestore `config/balance` overrides (hot-patch) |
| `dailyChallenge.ts` | UTC daily challenge seed, modifier selection, arsenal/twist/boon helpers |
| `adminBalanceConfig.ts` / `adminBalanceEdit.ts` | Admin-only balance publish/reset helpers plus pure editor diff/preview logic |
| `freeplay.ts` | Freeplay contracts, relics, risk waves, score multiplier |
| `ghostCurve.ts` / `ghostCurveData.ts` | Bot-rival pacing curves for in-run HUD |
| `dossier.ts` / `DossierShare.tsx` | End-of-run share card generation |
| `reSimulate.ts` / `ReplayViewer.tsx` | Deterministic Battle Plan re-simulation model plus canvas flipbook |
| `adminAnalytics.ts` | Admin dashboard metric aggregation |
| `functions/src/index.ts` | Server-side score validation, rate limits, feedback, admin-only data deletion |

## Runtime flow

### Boot (`main.tsx`)

1. `applyAccessibility()` — reduced-motion and colorblind body classes before first paint
2. `loadRemoteBalance()` — fire-and-forget fetch of `config/balance` from Firestore
3. Service worker registration in production (`public/sw.js`)
4. Top-level React error boundary (portal iframe safety)

### Game loop (`App.tsx` + `engine.ts`)

1. Player selects map/protocol or the UTC Daily Challenge protocol from the menu
2. During build phases, `Game.previewWave()` exposes the same composed wave that
   `startWave()` will launch, and keyboard/Veteran Deploy controls still call the
   canonical `placeTower` and `upgradeTower` engine APIs
3. `Game` instance runs a fixed-timestep update loop; `render()` draws to canvas each frame
4. `RunRecorder` captures deterministic player actions and public summary data during play
5. On terminal state: upload replay, optional leaderboard submit (via callable), meta credit, dossier share
6. A campaign victory can continue on the same `Game` instance as freeplay; the

2. `Game` instance runs a fixed-timestep update loop; `render()` draws to canvas each frame
3. `RunRecorder` captures compact r3 player actions during play, including
   ability casts, target modes, target filters, and wave starts for re-simulation
4. On terminal state: upload replay, optional leaderboard submit (via callable), meta credit, dossier share
5. A campaign victory can continue on the same `Game` instance as freeplay; the
   first campaign terminal state and the later freeplay terminal state are
   persisted as separate progression moments so kills/runs do not double-count.

### Score and replay flow

1. `RunRecorder.makePublicRun()` builds a public replay bundle. The main run doc
   carries compact summary/setup/final rows, the first action window, and a
   required completion manifest.
2. Overflow public actions are written under `runs/{runId}/chunks/cN`.
3. `submitRunReplay()` adds a browser-local replay token, stores its hash on the
   public run doc, and records ownership under `replayOwners/{uid}/runs/{runId}`.
4. Score callables verify the replay token, validate manifest chunk counts and
   action hash, check the replay summary against the claimed board, canonicalize
   score values, and write board rows with server timestamps.
5. `ReplayViewer` reads `runs/{runId}` plus public chunks and re-simulates the
   deterministic engine from setup/actions for the Battle Plan flipbook.

### Telemetry flow

Private analytics and live checkpoint data are separate from Battle Plan replays:

- `runAnalytics/{runId}` stores consent-gated per-run analytics for admin views.
- `runCheckpoints/{runId}/chunks/{chunkId}` stores live/interval checkpoint
  diagnostics for long runs, aborts, score attempts, freeplay bank events, and
  visibility-hide flushes.
- `telemetry/{id}` is older aggregate telemetry, still append-only and admin-read.

### Headless harness (`scripts/`)

| Script | Purpose |
| --- | --- |
| `sim.ts` | Bot playtests across map/protocol matrix |
| `balance.ts` | Efficiency, solo viability, strategy matrix → `public/balance-report.json` |
| `tower-deep-dive.ts` | Static and simulated tower audit → `docs/tower-balance-deep-dive.md` |
| `perf.ts` | Engine stress timing (no render) |
| `browserPerf.mjs` | Live FPS / quality-drop sampling via `/?perf=` route |
| `meta-sim.ts` | Guard that `meta.ts` is not imported by engine/score path |

## Routes and URL flags

| Path / query | Behavior |
| --- | --- |
| `/` | Main game (menu + play) |
| `/?demo=1` | Recruiter demo — all unlocks, no persistence, no score submit |
| `/?run=<runId>` | Battle Plan replay viewer (lazy-loaded) |
| `/?perf=<map>&diff=<diff>` | Browser perf harness with expert bot at 4× |
| `/admin` | Owner console (lazy-loaded; Google Auth + allowlist) |
| `/privacy` | Privacy & data choices (lazy-loaded) |

Firebase Hosting rewrites all paths to `index.html` (SPA).

Weekly Ops owns Daily/Weekly/Champion/Gauntlet Protocol entry points. Gauntlet
Protocol intentionally uses a single Weekly Ops card and leaves the sector grid
unchanged.

## Code splitting

Heavy surfaces are lazy-loaded off the player path:

- `AdminDashboard` — `/admin` only
- `PrivacyView` — `/privacy` only
- `ReplayViewer` — `?run=` deep links only

## UI stability rules

Player-facing UI should not move when transient content appears or numbers tick.
Use these rules for all new React chrome:

- Transient messages, tips, toasts, and status chips are fixed/absolute overlays
  or permanently reserved slots. Do not insert them in normal flow where they
  push siblings.
- Counters, timers, scores, XP, salvage, costs, and table metrics use tabular
  figures and, when they live in compact chrome, a min-width sized to the
  largest realistic label.
- State-swapped controls keep the same box. Size button families to the longest
  label (`CLAIMED`, `EQUIPPED`, busy/retry states) and swap only the contents.
- Async tables, leaderboard rows, dossier previews, and empty states reserve the
  loaded footprint. Prefer fixed-height scroll regions for boards whose row
  count changes after network settlement.
- Expanding tactical panels must not resize the game canvas or command layout.
  Use bounded overlays or internal scrolling when content can appear mid-run.
- `tests/e2e/ui-stability.spec.ts` is the CI guard for these rules; add probes
  there when a new transient surface is introduced.

## Data persistence

| Store | Key / collection | Contents |
| --- | --- | --- |
| localStorage | `nvd-progress-v1` | Kills, archive, blueprints, settings, QoL preferences, session days |
| localStorage | `nvd-meta-v2` | XP, Salvage, quest progress, streak |
| localStorage | `nvd-consent-v1` | Age band, analytics consent |
| localStorage | `nvd-replay-tokens-v1` | Private replay tokens used for score retry |
| localStorage | `nvd-feedback-receipts-v2` | Private feedback reply receipts |
| Firestore | `runs/{runId}` | Public run replays (Battle Plan source) |
| Firestore | `runs/{runId}/chunks/cN` | Public overflow replay events |
| Firestore | `replayOwners/{uid}/runs/{runId}` | Replay ownership index for admin deletion |
| Firestore | `boards/{board}/scores` | Leaderboard rows (server-written only) |
| Firestore | `dailyBoards/{daily}/scores` | Daily Challenge leaderboard rows |
| Firestore | `weeklyBoards/{weekly}/scores` | Weekly Mutation leaderboard rows |
| Firestore | `gauntletBoards/{weekly}/scores` | Weekly Champion Gauntlet rows |
| Firestore | `gauntletProtocolBoards/{weekly}/scores` | Gauntlet Protocol aggregate rows |
| Firestore | `runAnalytics`, `runCheckpoints` | Private telemetry/checkpoints (consent-gated) |
| Firestore | `feedback/{id}` | Server-created feedback and admin replies |
| Firestore | `config/balance` | Optional live balance overrides; public-read, admin-write |

## Testing

- **E2E:** Playwright (`tests/e2e/`) - menu, game, ops board, replay viewer, admin analytics unit paths
- **Engine/unit:** `npm run test:engine` - combat, freeplay, replay bundle, bot helpers
- **Security:** `npm run test:security` - rules, worker, and Functions checks
- **Full CI script:** `npm run ci` mirrors the GitHub Actions verification stack

## Related docs

- [tech_spec.md](./tech_spec.md) — Firestore schema, Cloud Function contracts, env vars
- [roadmap.md](./roadmap.md) — shipped features and next priorities
- [idea_backlog.md](./idea_backlog.md) — full 80-idea audit backlog
- [decision_log.md](./decision_log.md) - source-of-truth design decisions
