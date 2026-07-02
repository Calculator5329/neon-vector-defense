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
| `VITE_FIREBASE_APPCHECK_SITE_KEY` | Build-time (Vite) | Optional reCAPTCHA Enterprise site key. When present, the browser sends Firebase App Check tokens. |
| `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` | Local dev only | Optional App Check debug token; honored only by Vite dev builds. |
| `ENFORCE_APP_CHECK` | Cloud Functions runtime | Set to `true` after App Check tokens are confirmed in production to make callable Functions reject missing/invalid tokens. |
| `OPENROUTER_API_KEY` | `.env.local` / Worker secret | Image, audio, voice generation scripts only — never in `VITE_*` |
| `VITE_*` | Build-time | All exposed to the browser; no secrets |

## Firestore collections

### `boards/{board}/scores/{id}`

Public leaderboard entries. **Client writes are denied** — only the `submitScore` Cloud Function writes here.

Board ID pattern: `{map}_{diff}` or `{map}_{diff}_fp` for freeplay.

Valid maps: `orbital`, `reactor`, `hyperlane`, `mobius`, `blackout`, `throat`, `umbral`, `cinder`

Valid diffs: `easy`, `normal`, `hard`, `extinction`

### `dailyBoards/{daily}/scores/{id}`

Daily freeplay boards. Pattern: `daily-YYYY-MM-DD`. Server-written via `submitDailyScore`.

### `runs/{runId}`

Public run replay documents consumed by Battle Plan viewer and score validation.

Run ID pattern: `r_[A-Za-z0-9_-]{8,80}`

Key fields (`PublicRunDoc`):

```typescript
{
  schemaVersion: 2;
  runId: string;
  replayTokenHash?: string;
  createdAt: number;
  endedAt: number;
  build: string;
  chunkCount: number;
  eventCount: number;
  manifest: { chunkEventCounts: number[], eventHash: string, complete: true };
  setup: { map, mapName, mapHash, diff, diffName, startingCash, startingLives, availableTowerIds, balanceVersion };
  summary: { callsign, map, diff, freeplay, wave, kills, credits, cashEarned, outcome, durationS, ... };
  snapshots: RunWaveSnapshot[];  // lean tower rows per wave
  events: RunEvent[];            // first public event window
  final: { towers, damageByTower, killsByEnemy, ... };
}
```

Per-wave snapshots omit heavy tower fields to stay under Firestore's 1 MB document limit. Public replay docs must include a completion manifest so server validation can compare chunk event counts and event hash before accepting score claims. Optional fields must be omitted or `null`, not `undefined`, because Firestore rejects undefined field values.

### `runs/{runId}/chunks/c{n}`

Public overflow replay event chunks. `ReplayViewer` reads these after loading the
main run doc when `chunkCount > 0`. Replay docs and chunks use telemetry schema
version 2.

### `replayOwners/{uid}/runs/{runId}`

Small replay ownership index used for admin/operator deletion. It stores the
anonymous uid, run id, creation time, and build tag. This index has its own
small schema and is separate from telemetry schema versions.

### `runCheckpoints/{runId}/chunks/{chunkId}`

Private live/diagnostic checkpoint chunks for long runs. Flushed at wave end,
30 s intervals, score attempts, freeplay bank events, aborts, terminal state,
and visibility hide. These are not the public Battle Plan replay chunks.

### `runAnalytics/{id}`

Private per-run analytics (consent-gated writes, admin-only reads). New writes
must use schema version 2 and include the `menu`, `controls`, `combat`,
`placement`, `assistance`, and `freeplay` sections.

### `feedback/{id}`

Anonymous player feedback. Created only by the `submitFeedback` Cloud Function; admin can read and attach replies. Players fetch replies through a private local receipt token via `fetchFeedbackReplies`, so replied documents are not public by id.

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
| `submitFeedback` | Rate-limit feedback, write server-only feedback doc, return private reply receipt token |
| `fetchFeedbackReplies` | Return admin replies only when the browser presents the matching private receipt token |
| `deleteMyData` | Admin-only cascade delete for docs keyed by anonymous uid |

Score submit contract:

1. Client uploads a public replay with `submitRunReplay`.
2. Client keeps a private replay token in localStorage and sends it with the score claim.
3. The callable hashes the token, checks `runs/{runId}.replayTokenHash`, verifies map/diff/freeplay/daily consistency, sanity-bounds duration and claimed stats, then canonicalizes accepted values from the replay summary.
4. Accepted leaderboard rows include `serverTs` for ordering and retain client time as `clientTs`.

**Trust model:** Player callables (`submitScore`, `submitDailyScore`, `submitFeedback`) require Firebase Anonymous Auth; the uid comes from the verified callable auth context and payload uids are ignored. Rate limits key on that verified identity. A hand-crafted fake replay can still pass if it is internally consistent. Full re-simulation is deferred (see roadmap).

Deploy:

```bash
firebase deploy --only functions
```

## Security rules summary

- All player creates require Firebase Anonymous Auth (`isPlayer()`); uid-carrying
  docs bind `uid == request.auth.uid`. Enable the **Anonymous** sign-in provider
  in the Firebase console before deploying these rules.
- Leaderboards: public read, **no client writes**
- Runs: append-only public replay upload (signed-in only); public get, admin list
- Replay owners: creates bound to the authenticated uid (blocks planting
  ownership rows under a victim's uid)
- Feedback: server-only create/read helpers; admin read/update
- Telemetry / analytics: bounded client append or merge; admin read
- Admin gate: verified Google email in allowlist (sync `firestore.rules` ↔ `src/game/firebaseClient.ts`)
- Updates and deletes denied except admin feedback replies and admin-only deletion tooling

Deploy rules before release:

```bash
firebase deploy --only firestore:rules
```

## Retention / TTL policies

Raw streams carry an `expiresAt` **Timestamp** field (Firestore TTL ignores
plain-number fields like `ts`):

| Data | Field | Retention |
| --- | --- | --- |
| `runCheckpoints/{runId}/chunks` | `expiresAt` | 30 days (live diagnostics) |
| `telemetry/{id}` | `expiresAt` | 180 days (compact outcome rows) |
| `rateLimits/{key}` | `expiresAt` | 24 hours (server-written) |

Public replays (`runs` + chunks) are NOT expired — they back leaderboard
verification and WATCH links. TTL policies are configured once per
collection group (the `chunks` policy only affects docs that carry the
field, so public replay chunks are untouched):

```bash
gcloud firestore fields ttls update expiresAt --collection-group=chunks --enable-ttl
gcloud firestore fields ttls update expiresAt --collection-group=telemetry --enable-ttl
gcloud firestore fields ttls update expiresAt --collection-group=rateLimits --enable-ttl
```

## Client localStorage keys

Keys that store player state, consent, score retry state, or private reply
receipts must be included in `/privacy` local export/delete controls.

| Key | Module | Contents |
| --- | --- | --- |
| `nvd-progress-v1` | `storage.ts` | Progression, settings, blueprints, session days |
| `nvd-meta-v2` | `meta.ts` | Rank XP, Salvage, quests, streak, cosmetics |
| `nvd-consent-v1` | `consent.ts` | Age band, analytics consent, GPC |
| `nvd-replay-tokens-v1` | `leaderboard.ts` | Private replay tokens for score submit/retry |
| `nvd-feedback-receipts-v2` | `App.tsx` | Private feedback reply receipts and local submitted-message quotes |

Demo mode (`?demo=1`) skips meta and progression writes.

## Game content inventory

| Category | Count | Notes |
| --- | ---: | --- |
| Sectors (maps) | 8 | Orbital Relay through Cinder Causeway |
| Protocols (difficulties) | 4 | Recruit through Extinction |
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
