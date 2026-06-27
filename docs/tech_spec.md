# Technical Specification

Contracts, schemas, and environment configuration for Neon Vector Defense.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript 6, Vite 8 |
| Rendering | Canvas 2D (1280×720 logical, supersampled offscreen sprites) |
| Backend | Firebase Hosting, Firestore, Auth, Cloud Functions (Node 20) |
| AI proxy | Cloudflare Worker (`worker/`) → OpenRouter |
| Node | ≥ 20 |

Firebase project: `neon-vector-defense-7`

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_AI_HELP_URL` | Build-time (Vite) | Cloudflare Worker endpoint for in-game AI assistant. Omit to hide the widget. |
| `OPENROUTER_API_KEY` | `.env.local` / Worker secret | Image, audio, voice generation scripts only — never in `VITE_*` |
| `VITE_*` | Build-time | All exposed to the browser; no secrets |

## Firestore collections

### `boards/{board}/scores/{id}`

Public leaderboard entries. **Client writes are denied** — only the `submitScore` Cloud Function writes here.

Board ID pattern: `{map}_{diff}` or `{map}_{diff}_fp` for freeplay.

Valid maps: `orbital`, `reactor`, `hyperlane`, `mobius`, `blackout`, `throat`, `umbral`, `cinder`

Valid diffs: `easy`, `normal`, `hard`, `extinction`, `ngplus`

### `dailyBoards/{daily}/scores/{id}`

Daily freeplay boards. Pattern: `daily-YYYY-MM-DD`. Server-written via `submitDailyScore`.

### `runs/{runId}`

Public run replay documents consumed by Battle Plan viewer and score validation.

Run ID pattern: `r_[A-Za-z0-9_-]{8,80}`

Key fields (`PublicRunDoc`):

```typescript
{
  schemaVersion: number;
  runId: string;
  build: string;
  setup: { map, diff, protocol, balanceVersion, ... };
  summary: { callsign, wave, kills, cash, outcome, durationS, ... };
  snapshots: RunWaveSnapshot[];  // lean tower rows per wave
  events: RunEvent[];            // may be chunked under runCheckpoints
  final: { towers, damageByTower, killsByEnemy, ... };
}
```

Per-wave snapshots omit heavy tower fields to stay under Firestore's 1 MB document limit.

### `runCheckpoints/{runId}/chunks/{chunkId}`

Append-only event chunks for long runs. Flushed at wave end, 30 s intervals, terminal state, and visibility hide.

### `runAnalytics/{id}`

Private per-run analytics (consent-gated writes, admin-only reads).

### `feedback/{id}`

Anonymous player feedback. Append-only for clients; admin can read and attach replies.

### `telemetry/{id}`

Aggregate client telemetry (build tag, device hints, metric counters).

### `config/balance`

Optional sparse balance override document. Read once on boot by `balanceConfig.ts`. All fields are multipliers; missing doc = identity (no-op).

```typescript
{
  version?: string;
  income?: { killMult?, waveBonusMult? };
  diffs?: { [diffId]: { hpMult?, lateScale?, costMult?, cashMult?, livesMult? } };
  enemies?: { [enemyId]: { hpMult?, rewardMult? } };
  towers?: { [towerId]: { costMult?, damageMult?, rangeMult?, fireRateMult? } };
}
```

Values clamped to `[0.25, 4]`.

## Cloud Functions

Region: `us-central1`

| Callable | Purpose |
| --- | --- |
| `submitScore` | Validate replay exists, sanity-bound claimed stats, rate-limit per uid, write board entry |
| `submitDailyScore` | Same for daily freeplay boards |
| `deleteMyData` | Cascade-delete all docs keyed by anonymous uid |

**Trust model:** Anonymous uid in payload is for rate-limit bucketing only, not authenticated identity. A hand-crafted fake replay can still pass — accepted MVP posture. Full re-simulation is deferred (see roadmap).

Deploy:

```bash
firebase deploy --only functions
```

## Security rules summary

- Leaderboards: public read, **no client writes**
- Runs: authenticated append for replay upload; public read
- Feedback / telemetry / analytics: append-only for authenticated clients; admin read
- Admin gate: verified Google email in allowlist (sync `firestore.rules` ↔ `src/game/firebaseClient.ts`)
- Updates and deletes denied except admin feedback replies and `deleteMyData`

Deploy rules before release:

```bash
firebase deploy --only firestore:rules
```

## Client localStorage keys

| Key | Module | Contents |
| --- | --- | --- |
| `nvd-progress-v1` | `storage.ts` | Progression, settings, blueprints, session days |
| `nvd-meta-v2` | `meta.ts` | Rank XP, Salvage, quests, streak, cosmetics |
| `nvd-consent-v1` | `consent.ts` | Age band, analytics consent, GPC |

Demo mode (`?demo=1`) skips meta and progression writes.

## Game content inventory

| Category | Count | Notes |
| --- | ---: | --- |
| Sectors (maps) | 8 | Orbital Relay through Cinder Causeway |
| Protocols (difficulties) | 5 | Recruit → Long Watch |
| Towers | 19 | 2 upgrade tracks each; kill-gated unlock ladder |
| Commander abilities | 6 | Q/W/E/R/T/Y |
| Enemy archetypes | 15+ | Armored, cloaked, boss, heal, nested hull, etc. |

## AI Help proxy (Cloudflare Worker)

The Worker holds the OpenRouter API key and enforces:

- 5 turns per conversation
- 5 conversations per signed visitor cookie

Frontend sends compact gameplay context (`aiContext.ts`), not raw local history.

Setup documented in [README.md](../README.md#ai-help-setup).

## Generated assets

See [asset_provenance.md](./asset_provenance.md). Source code is MIT; `public/art/` and `public/audio/` are reserved project assets.

## Balance report artifact

`public/balance-report.json` is committed demo/admin data from `npm run balance`, not live telemetry.
