# Decision Log

Source-of-truth decisions for the current app. This file summarizes why the code
is shaped the way it is; `architecture.md` and `tech_spec.md` cover the mechanics.

## 2026-07-05 - Deploy selection is the Sector Atlas

- The DEPLOY tab now presents the Lantern Seven sectors as a starmap rather than
  a card grid. Nodes use the real `GameMap.path` polyline scaled into SVG glyphs,
  and the dashed constellation route follows the existing sequential sector
  unlock order.
- Region membership is intentionally lightweight for v1: Core Relay contains
  Orbital Relay, Twin Reactor, Hyperlane Junction, and The Throat; The Dark
  Reaches contains Mobius Drift, Blackout Reach, Umbral Reach, and Cinder
  Causeway. The visual layout still reads left-to-right by unlock order.
- Weekly Ops keeps its existing cards and logic as the integration point. The
  atlas adds a gold beacon that focuses those cards instead of duplicating
  weekly mutation or gauntlet behavior.
- Mastery stars are derived from existing local progress only: one star for any
  campaign clear (`clearedMaps`) or any protocol best wave meeting that
  protocol's wave count, two stars for an Apex (`hard`) best wave meeting Apex's
  wave count, and three stars for an Extinction best wave meeting Extinction's
  wave count. No new persistence is introduced.

## 2026-07-05 - Adaptation becomes a readable late-game mechanic

- Mirror Hull makes the existing adaptive-armor math visible by snapshotting the
  run's highest damage type at spawn and resisting that type by 85% for its
  lifetime.
- Recalibrate is a seventh commander ability on the long-cooldown tier. It
  clears the current armada adaptation window and drops living Mirror Hull
  snapshots to 40% resistance for 12 seconds.
- Replay engine version 5 is required because Mirror Hull spawn state and
  Recalibrate affect deterministic combat outcomes.
- The Recalibrate ability button uses a drawn in-UI fallback when its
  `/art/ability-recalibrate.webp` bitmap is unavailable.

## 2026-07-05 - Weekly Arena composes existing deterministic challenge systems

- Weekly Mutation uses UTC ISO week ids (`weekly-YYYY-Www`) for both the public
  board and replay metadata. It reuses the Daily Challenge arsenal/twist/boon
  catalogs, but stacks three distinct daily twist ids into one weekly ruleset.
  `config/weeklyOverride` may pin the weekly modifier ids; it does not change
  the week id, replay identity, or board name.
- Weekly Champion's Gauntlet is an admin-crowned ritual, not a cron. The
  `crownWeeklyGauntlet` callable selects from verified campaign runs for the
  prior ISO week by default and writes `config/weeklyGauntlet`; admins can also
  publish a manual gauntlet doc from the Operations Console.
- Gauntlet challengers use their own current campaign unlocks and the champion
  run's map/protocol/seed. We intentionally do not copy the champion's
  `availableTowerIds`, because unlock parity belongs to the challenger profile
  and avoids stale replay snapshots becoming a progression bypass.
- No engine simulation behavior changed for this mission. Weekly Mutation
  starts through the existing Daily Challenge modifier carrier, and Gauntlet
  starts as a seeded campaign run with extra replay/leaderboard metadata.
## 2026-07-05 - Exposed replaces instant shred and target filters enter replay v4

- Shred no longer bypasses resistance for one damage event. It applies Exposed
  for 4 seconds, stacking to 5. Each stack strips 13 percentage points of typed
  resistance and adds 4% follow-up damage taken, so shred towers set up other
  damage types without turning a single hit into a hidden true-damage path.
- Target-priority filters (`boss`, `armored`, `cloaked`, `healer`, `spawner`)
  are deterministic tower preferences layered over the existing target modes. A
  tower picks the best matching target when any filtered target is in range; if
  no filter matches, it falls back to its normal target mode. Empty filters mean
  the old targeting behavior.
- `REPLAY_ENGINE_VERSION` is now 4 because Exposed changes combat math and
  target filters affect deterministic target selection. The r3 action codec adds
  `target_filter` as a bitmask payload, and re-simulation applies the recorded
  filter state exactly. Older engine runs remain `unverifiable` rather than
  being judged divergent under new simulation rules.
- Balance and ghost-curve artifacts were regenerated intentionally for this
  sim-affecting pass; commit this change with `[balance-intended]` in the
  message so future reviewers know the baseline movement was expected.

## 2026-07-02 - Firebase Functions 7 and Admin 14 require Node 22

- Firebase Functions 7 drops Node 16, removes the deprecated
  `functions.config()` API, targets TS/ES2022, changes async `onRequest`
  emulator error handling, supports ESM, and renames the v1 `Event` type to
  `LegacyEvent`. This codebase was already on ESM, v2 `onCall`,
  `CallableRequest`, `HttpsError`, `setGlobalOptions`, and `process.env`, with
  no `functions.config()`, logger, params, or v1 event usage to migrate.
- Firebase Admin 14 drops Node 18/20, removes legacy namespace imports, removes
  Instance ID and legacy messaging types, revamps errors, and upgrades the
  Firestore dependency. The functions already use modular `initializeApp`,
  `getFirestore`, and `FieldValue`; the source fallout was limited to replacing
  `FirebaseFirestore.*` namespace types with explicit `DocumentReference`,
  `DocumentData`, and `Query` type imports.
- Runtime moved from Node 20 to Node 22 in both `functions/package.json` and
  `firebase.json` because Admin 14 requires Node >=22. `firebase-functions@7.2.5`
  still declares a peer range ending at Admin 13, so `functions/.npmrc` enables
  `legacy-peer-deps` until the upstream peer range catches up. The callable
  emulator suite loads `node@22` and exercises the bundled re-sim engine.

## 2026-07-02 - Burn zones no longer stack; replay engine versioning

- The dps-curve nerf barely moved the sims (opScore 5.14→5.12) because the OP
  mechanic was structural: every overlapping burn zone damaged every hull
  independently, so a multi-shell mortar carpeting one choke multiplied zone
  COUNT (~15+ concurrent zones) into hundreds of dps that no per-zone stat
  could balance. Fire no longer stacks — a hull burns under the single
  strongest zone covering it. Deep-dive after: Cinder 4.21 opScore / 17% solo
  win rate, second in the pack behind Flak (4.48/15%) instead of double it.
- Replays are exact re-simulations, so sim-affecting engine changes invalidate
  verification of runs recorded before them. `REPLAY_ENGINE_VERSION` (now 2) is
  recorded in run setup and checked by reSimulate: a mismatch is `unverifiable`,
  never falsely `divergent`. Bump it on every future sim-behavior change.

## 2026-07-02 - Replay v3 stores player actions only

- Public Battle Plan data is now schema v3: setup, summary/final aggregates, and
  the encoded `r3` player-action stream. Enemy events, snapshots, and compact
  death ledgers were removed from public run docs because the deterministic
  engine can reconstruct combat from seed/setup plus exact player actions.
- The manifest keeps per-chunk action counts and one FNV `actionHash` over the
  encoded root/chunk action packs. `eventHash`, `deathHash`, `deathRecords`,
  `events`, and `snapshots` are v2 fields and are rejected for new public
  uploads. Existing v2 replay links are not watchable after this cutover; any
  pinned Replay of the Day should be re-pinned to a v3 run.
- Byte measurements on Agent A's seeded freeplay wave-81 run: verbose public
  bundle 1,304,761 bytes; verbose action JSON 5,569 bytes; r3 action payload
  object 942 bytes; r3 `data` string 701 bytes. That is the reason the new cap
  is sized around compact action chunks instead of Firestore's 1 MB document
  ceiling.

## 2026-07-02 - Cinder Mortar burn-zone curve pulled ~15-18%

- Owner play experience plus `npm run tower:deep-dive` agreed Cinder was still
  the outlier after the arsenal pass: opScore 5.14 and 30% solo win rate versus
  4.33/14% for the next tower, driven by burn-zone dps per credit. The zone dps
  curve came down across both tracks (base 6→5, Thermite 12→10, Magma 16→14,
  Firestorm 22→18, Ashfall 26→22, Long Summer 34→28 with +40% radius instead of
  +50%), staying inside the ≤25% single-stat rule so the tower keeps its
  fire-lane identity. Balance baseline regenerated with the change.
- Owner UI feedback landed with it: the next-wave preview sits below the
  arsenal panel, Standard/Veteran became real tabs under the ARSENAL header,
  and protocol cards top-align title/description (the daily card pins its
  footer with margin auto) instead of stranding space mid-card.

## 2026-07-02 - Portal SDKs live behind a build-time adapter

- `VITE_PORTAL` selects `none`, `crazygames`, or `poki`. The default `none`
  build keeps portal SDK URLs, scripts, lifecycle calls, and CSP additions out of
  the production Firebase bundle.
- CrazyGames and Poki share one `PortalAdapter` contract so app-shell lifecycle,
  ad breaks, and portal celebratory moments stay outside the deterministic
  engine and replay telemetry.
- Portal ad breaks are limited to natural pauses and are consent-gated before
  calling the SDK. Under-13 runs record a local skipped opportunity without
  sending an ad request.
- Portal-specific CSP is injected into portal flavor `index.html`; Firebase
  Hosting keeps its default CSP restricted to first-party/runtime dependencies.
## 2026-07-02 - Replay re-simulation is advisory before enforcement

- `verifyRun` is an admin-only callable used from the Operations Console. It
  re-simulates one public replay and returns `verified`, `divergent`, or
  `unverifiable` with a first-divergence record when available.
- `verified` means the replay manifest, summary, and deterministic re-sim output
  matched within the mode-specific comparison rule. `divergent` means the replay
  was readable but the simulated result disagreed. `unverifiable` means the
  system could not make a trustworthy comparison, such as missing chunks,
  unsupported schema, balance mismatch, malformed action timing, or a step guard.
- Normal campaign, daily, and ordinary freeplay runs require exact summary and
  death-ledger agreement, with only the existing sub-tick death-time tolerance
  used by the compact ledger decoder. Very high-volume freeplay death ledgers
  keep exact summary matching but allow count-level death-ledger acceptance after
  the exact summary has matched; this avoids rejecting dense terminal waves for
  harmless per-uid ordering drift that does not affect the accepted score.
- Enforcement stays staged. First, admins can manually verify suspicious or
  spotlight candidates and review stored badges. Next, the score write path can
  soft-flag divergent rows while still accepting scores. Only after production
  samples show low false-positive risk should leaderboards reject `divergent`
  runs automatically; `unverifiable` should remain a separate operational bucket
  until legacy and balance-version coverage is understood.
- Verification runs under the same live-ops math the player saw: `verifyRun`
  injects the current `config/balance` and `config/dailyOverride` docs into the
  bundled engine, and a run recorded under a balance version we no longer have
  is `unverifiable` — never falsely `divergent`.

## 2026-07-02 - UI chrome reserves space instead of shifting

- Transient player-facing messages must be overlays or permanent reserved slots.
  Status rows, toasts, tips, and in-run advisories should not be conditionally
  inserted in normal flow where they push command surfaces.
- High-churn numbers use tabular figures and, in compact chrome, explicit
  widths sized to realistic maximum labels. This applies to topbar stats,
  leaderboard values, meta rewards, costs, cooldowns, replay stamps, and admin
  telemetry values.
- State-swapped controls keep their box while changing content. Claim, equip,
  submit, feedback, replay-watch, and admin mini-action families reserve enough
  width for their longest expected label.
- Async surfaces reserve their loaded footprint. Leaderboards, local boards,
  score tables, dossier previews, feedback receipt states, and admin status
  rows avoid inserting new height after network or callable settlement.
- `tests/e2e/ui-stability.spec.ts` is now the regression guard for this contract
  using both browser `layout-shift` entries and targeted rect probes.

## 2026-07-02 - Daily overrides pin modifiers, not score identity

- `config/dailyOverride` is a single public-read, admin-write document for live
  events. It can pin `arsenalId`, `twistId`, and `boonId` for one UTC
  `YYYY-MM-DD` date.
- The override intentionally does not alter map, protocol, daily id, or scoring
  identity. Every client still submits `daily-YYYY-MM-DD`, so the existing
  `submitDailyScore` validation remains correct.
- Clients read the doc lazily and cache it per day. Missing, stale-date, or
  malformed docs fall back to the deterministic computed challenge, preserving
  same-day consistency for all players without blocking boot.

## 2026-07-02 - In-run QoL stays on top of canonical engine actions

- Build-phase wave preview is generated through `Game.previewWave()`, which uses
  the same daily, freeplay, rival, and difficulty composition path as
  `startWave()`. The panel may hide unseen enemy identities, but not invent a
  different wave.
- Keyboard placement is a UI surface over the existing grid/map placement rules:
  tower hotkeys enter a snapped placement cursor, arrows move it, Enter calls
  `placeTower`, and Esc cancels.
- Veteran Deploy is unlocked after one campaign victory and is persisted as a
  local QoL preference. It never adds an engine shortcut or combat modifier:
  the UI calls `placeTower` once, then repeatedly calls `upgradeTower` while
  alternating A/B tracks up to tier 4/4 and stopping when credits or upgrade
  rules say stop.
- The Veteran Deploy ghost/shop projection is advisory only and must be computed
  from the same cost and upgrade-state helpers used by the actual purchase path.

## 2026-07-02 - Encounters gain deterministic elites and a phased Umbra

- Elite variants are assigned during `startWave()` from the seeded gameplay RNG
  and encoded in `wave_start.groups[].elites`, rather than as per-enemy replay
  events. This keeps Battle Plan reconstruction honest without expanding replay
  event volume.
- Elites start at wave 12, are capped at one to three per wave, and skip bosses,
  death-spawned children, and healer hulls. This avoids unkillable repair stacks
  while still adding variety inside normal authored waves.
- Shielded, Frenzied, Splitting, and Bulwark are tuned as additive encounter
  pressure: flat shield, speed-for-bounty, two bounded non-elite children, and a
  non-stacking nearby-hull resistance aura.
- The Umbra now owns enemy-local phase state. Lattice, phase-shift, and enrage
  transitions reuse existing damage, cloak/reveal, announcement, and boss-pulse
  systems, with compact `umbra_phase` replay events for reconstruction.
- The boss health bar is rendered inside the canvas post-effects pass so phase
  pips do not shift the React layout or create another overlay collision point.

## 2026-07-02 - Arsenal reaches 21 towers and remote balance gets an admin editor

- Harmonic Siphon is the second resonance-axis tower. It consumes resonance
  stacks for burst damage and spreads echo stacks, making Cantor plus Siphon a
  real combo instead of adding another generic DPS tower.
- Vector Lure is a target-priority support tower. Its focus marks make other
  towers prefer selected hulls while its wake slows or drags escorts; it stays
  intentionally low/no damage so it does not become another economy or nuke tool.
- The balance pass is evidence-led from `npm run balance` and
  `npm run tower:deep-dive`: Cinder and Flak were reduced from OP to strong
  watchlist status, Siphon moved into fair static value, and Requiem's late nova
  upgrades were lifted without changing any single stat by more than 25%.
- New tower ids are not added to bot plans yet. The final reports show Siphon
  and Lure need support context, while the expert bot still clears
  Recruit/Veteran and loses Apex/Extinction without them.
- `config/balance` remains a sparse public-read gameplay document, but the admin
  dashboard now owns validated publish/reset controls and a tiered effective-stat
  preview. Rules mirror the additive shape so unknown live-ops keys are rejected.

## 2026-07-02 - Release hardening runs before deployment

- Callable endpoints are now covered by Firebase emulator-backed integration
  tests so auth, replay validation, rate limits, feedback receipts, and deletion
  behavior are exercised through the real callable surface before merge.
- Manual Firebase deploy workflows are allowed only from `master` and write ref,
  commit SHA, and build-tag details to the job summary for operator auditability.
- Worker deploy syntax is dry-run in CI without secrets, catching Cloudflare
  configuration drift before a production deploy attempt.
- App Check remains a staged rollout: preflight warns about missing production
  site keys, a runbook verifies token issuance and metrics first, and callable
  enforcement flips only after the operator validates production traffic.

## 2026-07-02 - Daily Challenge replaces Daily Freeplay

- Daily Challenge is a fifth deploy protocol on the menu, generated from the UTC
  date with fixed map/protocol/modifier conditions for all players.
- It starts at wave 1 with normal protocol cash and cores, does not enter
  freeplay, and does not mutate campaign progress or blueprints.
- Daily leaderboard rows live under `dailyBoards/daily-YYYY-MM-DD`, are
  submitted with `summary.freeplay == false`, and are ranked by wave, then kills,
  then server time.
- Daily meta rewards are once per daily id and remain cosmetic/progression only:
  they do not feed combat stats, unlock thresholds, score math, or bot pacing.

## 2026-07-02 - Long Watch and Diplomat's Gambit are retired

- The active campaign is a single-ending flow across Recruit, Veteran, Apex, and
  Extinction. Long Watch, receiver construction, escort/courier behaviors, and
  the alternate diplomatic ending are removed from active code paths.
- Existing local saves are normalized so retired progression flags, best-wave
  rows, history rows, and cleared-map markers do not leak into current UI or
  rules.
- Extinction victory is the capstone. Its one-time meta reward grants the
  Sunset Signal palette and a small Salvage bonus without affecting combat,
  score, unlock thresholds, or bot simulation.
- Public replay manifests are required for new uploads. Missing manifests are
  treated as incomplete replay data and cannot back accepted leaderboard scores.

## 2026-06-28 - Replay-backed scores stay pragmatic, not fully deterministic

- Scores are accepted only through Cloud Functions (`submitScore` and
  `submitDailyScore`), not through direct client writes.
- A score must reference a public `runs/{runId}` replay and present the matching
  private replay token. The function hashes the token and checks the uploaded run.
- The function canonicalizes leaderboard values from the replay summary and writes
  `serverTs` for ordering. Client `ts` is retained only as `clientTs`.
- This is a launch posture, not a full anti-cheat system. A forged replay can
  still pass if it is internally consistent. Full server-side replay simulation is
  deferred until traffic and incentives justify the complexity.

## 2026-06-28 - Public replays are for viewing; checkpoints are for operations

- `runs/{runId}` is the public Battle Plan document. It contains the compact run
  summary, setup, recent events, wave snapshots, final tower rows, and a
  `replayTokenHash`.
- Long public event streams spill into `runs/{runId}/chunks/cN`.
- `runCheckpoints/{runId}/chunks/{chunkId}` is private operational telemetry used
  for long-run recovery/analytics and is not the Battle Plan read path.
- Per-wave snapshots intentionally omit heavy tower fields; full tower details
  live once in `final.towers`. This keeps replay docs below Firestore's 1 MB cap.
- Public replay bundles must not contain `undefined`, because Firestore rejects
  those writes. Optional fields should be omitted or set to `null`.

## 2026-06-28 - Freeplay is part of the same run lineage

- A campaign clear can continue into freeplay on the same `Game` instance.
- Campaign progress is persisted once on the initial terminal win; the later
  freeplay death/bank is tracked separately so runs, kills, and unlocks do not
  double-count.
- Freeplay scoring is contract/relic/risk/rival driven. Contracts set the base
  multiplier; relics, risk packets, and rivals can alter income, pressure, and
  score multiplier.
- Daily Challenge is intentionally separate from freeplay. It reuses the replay
  validation path but not freeplay contracts, relics, checkpoint banking, or score
  multipliers.

## 2026-06-28 - Meta progression must remain off the combat path

- `meta.ts` owns Warden Rank, Salvage, quests, and Watch Streak.
- Meta rewards are cosmetic/retention/QoL only. They must not feed tower stats,
  enemy stats, unlock thresholds, score math, or bot simulation.
- `npm run meta:sim` exists to guard this boundary.

## 2026-06-28 - Privacy deletion is operator-run

- Public leaderboard rows expose anonymous uid values, so a public delete-by-uid
  callable would let one player delete another player's anonymous records.
- `deleteMyData` is therefore admin-only and intended for operator-run deletion
  requests. Local privacy controls clear localStorage and local receipts on the
  player's device.

## 2026-06-28 - Spark-friendly AI help stays behind a Worker

- The game can run on Firebase Spark for Hosting/Auth/Firestore.
- AI help is optional and hidden when `VITE_AI_HELP_URL` is missing.
- The Cloudflare Worker holds the OpenRouter key, signs visitor cookies, and
  rate-limits conversations. The client sends compact gameplay context instead
  of raw local history.
- Worker KV quota is optional; without KV, cookie-based limits are still useful
  but resettable by the visitor.

## 2026-06-28 - Accessibility and contrast are baseline UI infrastructure

- The app now carries global focus-visible styling and design tokens for
  legibility/contrast.
- Reduced-motion and colorblind settings remain user-facing controls, not only
  CSS affordances.
- Modal and overlay work should preserve keyboard access, visible focus, and
  non-overlapping text at desktop and mobile viewport sizes.

## 2026-06-28 - Audit backlog is priority-split

- Small player-facing regressions from the audit should ship immediately when
  they are low risk: silent owned-palette equips, current-player leaderboard
  highlighting, and complete local privacy export/delete coverage.
- Replay integrity, score validation, security rules, gameplay correctness, and
  release hardening are tracked as active backlog categories rather than mixed
  into the historical 80-idea archive.
- The shipped Battle Plan viewer remains a reconstruction from public snapshots
  and events. Stronger replay manifests, chunk hashes, and server re-simulation
  are separate hardening steps before high-stakes leaderboard incentives.

## 2026-07-02 - Replay deaths are authoritative compact records

- Superseded by Replay v3 above for new uploads. This section documents the
  short-lived v2 design only; schema v3 no longer stores public death records.
- Battle Plan enemy deaths are stored in `deathRecords`, not as `enemy_kill`
  events. The viewer treats this ledger as authoritative and uses the old
  snapshot-delta inference only for legacy production replays that predate it.
- Encoding `d1` groups deaths by wave and stores a separator-free varint stream:
  real enemy uid delta, enemy type code, spawn decisecond offset, and death
  decisecond offset. Rows are sorted by wave and uid, so identical seeded runs
  produce byte-identical death records.
- The replay manifest now includes `deathHash` alongside the event hash. New
  public replay writes must include `deathRecords`, and server/client integrity
  checks reject mismatched death ledgers.
- Budget math: a 100-wave / 60,000-kill run averages about seven packed
  characters per death (uid delta ~2, type 1, spawn offset ~2, death offset ~2),
  or roughly 420 KB. Per-wave JSON overhead is about 5 KB, leaving more than
  400 KB of the 900 KB run-doc safety budget for snapshots, events, setup, and
  final tower data. Late runs that round closer to nine characters per death
  still land around 540 KB for the ledger.
