# Technical Specification

Contracts, schemas, and environment configuration for Neon Vector Defense.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript 6, Vite 8 |
| Rendering | Canvas 2D (1280×720 logical, supersampled offscreen sprites) |
| Backend | Firebase Hosting, Firestore, Auth, Cloud Functions (Node 22) |
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

Daily Challenge boards. Pattern: `daily-YYYY-MM-DD`. Server-written via
`submitDailyScore`. Rows require replay `summary.daily` to match the board,
`summary.freeplay == false`, and no freeplay score multiplier fields.

### `weeklyBoards/{weekly}/scores/{id}`

Weekly Mutation boards. Pattern: `weekly-YYYY-Www` using UTC ISO weeks.
Server-written via `submitWeeklyScore`. Rows require replay `summary.weekly`
to match the board, `summary.freeplay == false`, and a replay setup whose
weekly snapshot authenticates against the deterministic weekly challenge for
that ISO week plus any matching `config/weeklyOverride`.

### `gauntletBoards/{weekly}/scores/{id}`

Weekly Champion's Gauntlet boards. Pattern: `weekly-YYYY-Www`. Server-written
via `submitGauntletScore`. Rows require replay `summary.gauntlet` to match the
board, `summary.freeplay == false`, and replay setup `gauntlet` metadata that
matches the current `config/weeklyGauntlet` doc.

### `runs/{runId}`

Public run replay documents consumed by Battle Plan viewer and score validation.

Run ID pattern: `r_[A-Za-z0-9_-]{8,80}`

Key fields (`PublicRunDoc`):

```typescript
{
  schemaVersion: 3;
  runId: string;
  replayTokenHash: string;
  createdAt: number;
  endedAt: number;
  build: string;
  chunkCount: number;
  eventCount: number;
  manifest: { chunkEventCounts: number[], actionHash: string, complete: true };
  setup: {
    map, mapName, mapHash, diff, diffName, seed,
    startingCash, startingLives, availableTowerIds,
    balanceVersion, balance?, daily?, weekly?, gauntlet?, replayEngine?
  };
  summary: { callsign, map, diff, freeplay, daily?, weekly?, gauntlet?, wave, kills, credits, cashEarned, outcome, durationS, ... };
  actions: { codec: 'r3', count: number, towerIds: string[], data: string };
  final: { towers, damageByTower, killsByEnemy, ... };
}
```

Public replay docs must include a completion manifest so server validation can
compare chunk action counts and the compact action hash before accepting score
claims. `eventHash`, `deathHash`, `deathRecords`, `events`, and `snapshots` are
v2 fields and are rejected for new public writes. Optional fields must be
omitted or `null`, not `undefined`, because Firestore rejects undefined field
values. Existing v2 replay links are intentionally unwatchable after the schema
3 cutover; re-pin any Replay of the Day that points at a v2 run.

The `r3` codec stores only player actions consumed by `reSimulate`:

| Action | Args |
| --- | --- |
| `wave_start` | simTick delta, wave, speed |
| `tower_place` | tower table index, tower uid, x/y in tenths |
| `tower_upgrade` | tower uid, track |
| `tower_sell` | tower uid |
| `target_mode` | tower uid, target-mode enum |
| `ability_cast` | ability enum, optional x/y in tenths |
| `pickup_collect` | pickup enum, x/y in tenths |
| `freeplay_enter` | contract enum |
| `freeplay_relic_select` | relic enum |
| `freeplay_risk_accept` / `freeplay_risk_decline` | risk enum |
| `speed_change` | speed enum |
| `run_end` | outcome enum |

All actions encode monotonic simTick deltas plus small enum/integer args into
the base64url-like `data` string. Tower ids are stored once in `towerIds`; chunk
packs reuse that root table. Agent A measured a seeded freeplay wave-81 run at
1,304,761 bytes for the old verbose public bundle, 5,569 bytes for verbose
action JSON, 942 bytes for the r3 action payload object, and 701 bytes for the
r3 `data` string.

### `runs/{runId}/chunks/c{n}`

Public overflow replay action chunks. `ReplayViewer` reads these after loading
the main run doc when `chunkCount > 0`. Replay docs and chunks use telemetry
schema version 3 and contain `{ schemaVersion, runId, chunk, actions }`.

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
must use schema version 3 and include the `menu`, `controls`, `combat`,
`placement`, `assistance`, and `freeplay` sections.

### `runVerificationReasons/{runId}`

Admin-only replay re-simulation triage rows written by the `verifyRun` callable
for non-verified outcomes. The document id is the public run id. Linked
leaderboard rows receive compact server-written `verify` and `verifyTs` fields,
so admin-only surfaces can badge known `verified`, `divergent`, or
`unverifiable` runs without re-running the simulation.

```typescript
{
  runId: string;
  verdict: 'verified' | 'divergent' | 'unverifiable';
  reason?: string;
  divergence?: { field?: string; expected?: unknown; actual?: unknown; at?: { eventIndex?, t?, wave?, type? } };
  rowCount: number;
  rowPaths?: string[];
  source: 'callable' | 'post-accept';
  verifyTs: Timestamp;
}
```

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
  global?: { abilityCooldownMult? };
  diffs?: { [diffId]: { hpMult?, lateScale?, costMult?, cashMult?, livesMult? } };
  enemies?: { [enemyId]: { hpMult?, rewardMult?, speedMult? } };
  towers?: {
    [towerId]: {
      costMult?, damageMult?, rangeMult?, fireRateMult?,
      projectileSpeedMult?, splashMult?, slowMult?, burnMult?
    }
  };
}
```

Values are clamped to `[0.25, 4]`. Firestore rules allow public reads, deny
listing, and allow only admin create/update/delete with an explicit key allowlist
for current protocols, enemies, and towers. The admin dashboard Balance editor
loads this document, prunes identity values, previews tower stats at tier 0/3/6,
publishes after confirmation, and can reset by deleting the doc.

### `config/dailyOverride`

Optional Daily Challenge live-ops override. Public clients may `get` this single
doc; listing is denied. Admins may create/update/delete it when the sparse shape
matches the modifier catalogs in `src/game/dailyChallenge.ts`.

```typescript
{
  date: 'YYYY-MM-DD';
  arsenalId?: 'fixedPool' | 'banDamage' | 'tierCap4' | 'noSupport' | 'budgetBuild';
  twistId?: 'fogProtocol' | 'rushHour' | 'glassCannon' | 'thrifty' | 'veteranHulls';
  boonId?: 'salvageCache' | 'abilityRecharge' | 'doublePickups';
  note?: string; // <= 240 chars, operator-facing
}
```

The doc pins only the modifier combo for the matching UTC date. Map/protocol,
daily id, and leaderboard identity remain the deterministic `daily-YYYY-MM-DD`
challenge, so `submitDailyScore` needs no contract change.

### `config/weeklyOverride`

Optional Weekly Mutation live-ops override. Public clients may `get` this
single doc; listing is denied. Admins may create/update/delete it when the
sparse shape matches the daily modifier catalogs.

```typescript
{
  week: 'weekly-YYYY-Www';
  arsenalId?: 'fixedPool' | 'banDamage' | 'tierCap4' | 'noSupport' | 'budgetBuild';
  twistIds?: ('fogProtocol' | 'rushHour' | 'glassCannon' | 'thrifty' | 'veteranHulls')[]; // exactly 3 when present
  boonId?: 'salvageCache' | 'abilityRecharge' | 'doublePickups';
  note?: string; // <= 240 chars, operator-facing
}
```

The doc pins only the modifier combo for the matching UTC ISO week. The weekly
id and board remain `weekly-YYYY-Www`.

### `config/weeklyGauntlet`

Public Champion's Gauntlet seed doc. Admins publish it manually or through the
`crownWeeklyGauntlet` callable after reviewing verified replay candidates.

```typescript
{
  week: 'weekly-YYYY-Www';
  runId: string;
  callsign: string;
  map: 'orbital' | 'reactor' | 'hyperlane' | 'mobius' | 'blackout' | 'throat' | 'umbral' | 'cinder';
  diff: 'easy' | 'normal' | 'hard' | 'extinction';
  seed: number;
  wave: number;
  kills: number;
  crownedAt?: number;
  crownedBy?: string;
  source?: 'callable' | 'manual';
}
```

## Cloud Functions

Region: `us-central1`

| Callable | Purpose |
| --- | --- |
| `submitScore` | Validate replay exists, sanity-bound claimed stats, rate-limit per uid, write board entry |
| `submitDailyScore` | Validate same-day/yesterday Daily Challenge replay and write the daily board row |
| `submitWeeklyScore` | Validate current/previous Weekly Mutation replay and write the weekly board row |
| `submitGauntletScore` | Validate current Champion's Gauntlet replay and write the gauntlet board row |
| `crownWeeklyGauntlet` | Admin-only select a verified prior-week campaign run and publish `config/weeklyGauntlet` |
| `verifyRun` | Admin-only re-simulate a public replay and persist a verification verdict |
| `submitFeedback` | Rate-limit feedback, write server-only feedback doc, return private reply receipt token |
| `fetchFeedbackReplies` | Return admin replies only when the browser presents the matching private receipt token |
| `deleteMyData` | Admin-only cascade delete for docs keyed by anonymous uid |

Score submit contract:

1. Client uploads a public replay with `submitRunReplay`.
2. Client keeps a private replay token in localStorage and sends it with the score claim.
3. The callable hashes the token, checks `runs/{runId}.replayTokenHash`, verifies map/diff/freeplay/daily consistency, sanity-bounds duration and claimed stats, then canonicalizes accepted values from the replay summary.
4. Accepted leaderboard rows include `serverTs` for ordering and retain client time as `clientTs`.

Daily Challenge submit contract:

1. Client starts `src/game/dailyChallenge.ts` from the current UTC date and records
   `summary.daily = daily-YYYY-MM-DD` with `summary.freeplay = false`.
   If `config/dailyOverride.date` matches that UTC date, only the modifier ids
   are replaced before the run starts.
2. `submitDailyScore` accepts only today or yesterday's daily id to allow near-
   rollover submissions.
3. Accepted daily rows force `freeplay: false` and rank by wave, then kills, then
   server time.

Weekly Arena submit contract:

1. Weekly Mutation runs record `summary.weekly = weekly-YYYY-Www` and
   `setup.weekly`. `submitWeeklyScore` accepts only the current or previous UTC
   ISO week, authenticates the setup snapshot against the deterministic weekly
   challenge plus `config/weeklyOverride`, and writes `weeklyBoards/{weekly}`.
2. Champion's Gauntlet runs record `summary.gauntlet = weekly-YYYY-Www` and
   `setup.gauntlet`. `submitGauntletScore` requires the board to match the
   current `config/weeklyGauntlet.week`, authenticates the gauntlet metadata,
   and writes `gauntletBoards/{weekly}`.
3. `crownWeeklyGauntlet` is admin-only. By default it looks at verified,
   non-freeplay campaign rows from the prior ISO week, loads the source replay
   setup, and publishes the week/map/protocol/seed/callsign target doc.

**Trust model:** Player callables (`submitScore`, `submitDailyScore`,
`submitWeeklyScore`, `submitGauntletScore`, `submitFeedback`) require Firebase
Anonymous Auth; the uid comes from the verified callable auth context and
payload uids are ignored. Rate limits key on that verified identity. Replay
re-simulation is flag-first: accepted score rows can be annotated with
`verify`, but divergent verdicts do not reject scores until the enforcement
flip.

Replay re-simulation contract:

1. Admin calls `verifyRun({ runId })` from the Operations Console.
2. The callable loads `runs/{runId}` plus public chunks, validates the replay
   action manifest, and replays exact recorded player actions through the deterministic
   engine build compiled into Functions.
3. Result shape is `{ runId, verdict, reason?, divergence? }`.
4. `verified` means the action stream and summary matched. `divergent` means the run
   was readable but the simulated result disagreed; `divergence` is the first
   meaningful mismatch. `unverifiable` means the run cannot be compared
   confidently, for example due to missing chunks, unsupported schema, balance
   mismatch, invalid timing, or simulation guard limits.
5. Runs use exact summary comparison after applying the recorded action stream at
   exact simTicks. `setup.balance`, `setup.daily`, `setup.weekly`, and
   `setup.gauntlet` snapshots are preferred over live config fallback so future
   live-ops publishes do not invalidate honest replays.
6. Enforcement is not automatic at launch. Admin badges and audit docs come
   first, soft flagging comes next, and score rejection is a later operator flip
   after production false positives are understood.

Functions packaging runs `scripts/bundle-resim.mjs` from the `functions`
`prebuild` script. It bundles `src/game/reSimulate.ts` and its headless engine
dependencies into `functions/src/generated/reSimulate.js`; Functions imports
only that generated entrypoint.

Deploy:

```bash
npm run build
npm --prefix functions run build
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
- Balance config: public get, no list, admin-only validated sparse writes
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
| `nvd-progress-v1` | `storage.ts` | Progression, settings, blueprints, QoL preferences, session days |
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
| Towers | 21 | 2 upgrade tracks each; kill-gated unlock ladder |
| Commander abilities | 6 | Q/W/E/R/T/Y |
| Enemy archetypes | 18 | Armored, cloaked, boss, heal, nested hull, etc. |

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
