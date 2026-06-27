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
| `maps.ts` / `difficulty.ts` | 8 sectors × 5 protocols |
| `bot.ts` | Headless AI at rookie / standard / expert tiers |
| `runTelemetry.ts` | Run events, wave snapshots, checkpoint chunks, upload bundles |
| `leaderboard.ts` | Firestore reads/writes facade; score submit via Cloud Functions |
| `storage.ts` | localStorage progression (kills, archive, blueprints, settings) |
| `meta.ts` | Warden Rank, Salvage, Operations Board quests, Watch Streak |
| `balanceConfig.ts` | Remote Firestore `config/balance` overrides (hot-patch) |
| `freeplay.ts` | Daily seed, contracts, relics, risk waves, score multiplier |
| `ghostCurve.ts` / `ghostCurveData.ts` | Bot-rival pacing curves for in-run HUD |
| `dossier.ts` / `DossierShare.tsx` | End-of-run share card generation |
| `ReplayViewer.tsx` | Battle Plan flipbook (snapshot reconstruction, not re-sim) |
| `adminAnalytics.ts` | Admin dashboard metric aggregation |
| `functions/src/index.ts` | Server-side score validation, rate limits, data deletion |

## Runtime flow

### Boot (`main.tsx`)

1. `applyAccessibility()` — reduced-motion and colorblind body classes before first paint
2. `loadRemoteBalance()` — fire-and-forget fetch of `config/balance` from Firestore
3. Service worker registration in production (`public/sw.js`)
4. Top-level React error boundary (portal iframe safety)

### Game loop (`App.tsx` + `engine.ts`)

1. Player selects map, protocol, and optional freeplay modifiers from the menu
2. `Game` instance runs a fixed-timestep update loop; `render()` draws to canvas each frame
3. `RunRecorder` captures events and wave snapshots during play
4. On terminal state: upload replay, optional leaderboard submit (via callable), meta credit, dossier share

### Headless harness (`scripts/`)

| Script | Purpose |
| --- | --- |
| `sim.ts` | Bot playtests across map/protocol matrix |
| `balance.ts` | Efficiency, solo viability, strategy matrix → `public/balance-report.json` |
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

## Code splitting

Heavy surfaces are lazy-loaded off the player path:

- `AdminDashboard` — `/admin` only
- `PrivacyView` — `/privacy` only
- `ReplayViewer` — `?run=` deep links only

## Data persistence

| Store | Key / collection | Contents |
| --- | --- | --- |
| localStorage | `nvd-progress-v1` | Kills, archive, blueprints, settings, session days |
| localStorage | `nvd-meta-v2` | XP, Salvage, quest progress, streak |
| localStorage | `nvd-consent-v1` | Age band, analytics consent |
| Firestore | `runs/{runId}` | Public run replays (Battle Plan source) |
| Firestore | `boards/{board}/scores` | Leaderboard rows (server-written only) |
| Firestore | `runAnalytics`, `runCheckpoints` | Private telemetry (consent-gated) |
| Firestore | `config/balance` | Optional live balance overrides |

## Testing

- **E2E:** Playwright (`tests/e2e/`) — menu, game, ops board, replay viewer, admin analytics unit paths
- **Balance CI candidate:** `npm run balance` (not yet wired to GitHub Actions — see [roadmap.md](./roadmap.md))

## Related docs

- [tech_spec.md](./tech_spec.md) — Firestore schema, Cloud Function contracts, env vars
- [roadmap.md](./roadmap.md) — shipped features and next priorities
- [idea_backlog.md](./idea_backlog.md) — full 80-idea audit backlog
