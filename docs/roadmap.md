# Roadmap

Current build status and near-term priorities. For the full historical 80-idea
audit backlog, see [idea_backlog.md](./idea_backlog.md).

Last updated: 2026-07-20 (THE YAKKOB special edition shipped)

## Special editions

- [x] **THE YAKKOB** — dwarf-unlock special challenge (Prism Array + Watchfire Beacon only,
  squished icons, local-ranked). *(done 2026-07-20; see changelog. Built on branch
  `agent/claude/yakkob-special-edition-20260720`.)*
- [ ] **THE YAKKOB — optional online leaderboard.** Currently local-only because a fixed
  challenge id is rejected by the date-keyed daily boards. A persistent online board would
  need a `submitYakkobScore`-style Cloud Function + Firestore rules + collection — an
  **Ethan-only deploy**. Left as a follow-up.

## Now — owner bug report (Ethan, 2026-07-16 audit review)

- [x] **BUG: replay playback is inaccurate — enemies don't die accurately.**
  *(done 2026-07-18, bal-replay-sweep-0718)* Root cause was NOT determinism
  drift — the fixed-timestep accumulator makes the tick sequence pacing-
  independent (locked by `tests/unit/replay-determinism.test.ts`, byte-identical
  kill frames under jittered vs uniform dt across seeds). The owner symptom was
  the viewer *silently* falling back to a cosmetic reconstruction; the viewer now
  labels "COSMETIC PREVIEW — not a frame-accurate replay" and logs the reason
  (`createReplayPlaybackDiagnostic`). Frame parity on ≥3 seeds is asserted by
  `npm run test:replay-e2e` (driver reproduces identical kills/leaks/wave).
- [x] **BUG: replay verification gets stuck in simulating loops.**
  *(done 2026-07-18, bal-replay-sweep-0718)* Root cause: the server verify path
  had a tick-count guard but no wall-clock deadline, so a dense marathon could
  burn to the Cloud Function timeout under the tick cap. `reSimulate` now takes a
  `wallClockMs` budget and returns `unverifiable` (not `divergent`) on deadline;
  `verifyRunCore` caps it at 30s. The bounded/anti-hang case is asserted in
  `npm run test:replay-e2e`.

## Next up (owner-triaged, 2026-07-04)

- **Wave 1 — DONE:** Weekly Champion's Gauntlet + Weekly Mutation (weekly seed
  + boards); Exposed stacking debuff + target-priority filters through replay
  v4 with bestiary/help copy and regenerated balance-gate artifacts.
- **Wave 2 - DONE:** Mirror Hull adaptive flagship + Recalibrate ability
  through replay v5; Gauntlet Protocol weekly route through replay v6.
- **Wave 3 - DONE:** Four new authored sectors plus Sector Atlas expansion:
  The Carousel, Splice Junction, Mirror Array, and Foundry Floor.
- **Owner-side launch gate (unchanged):** App Check console registration,
  Stripe MVP (with owner), CrazyGames/Poki accounts + art.


## Current shipped pillars

| Pillar | Status | Source-of-truth files |
| --- | --- | --- |
| Core tower-defense loop | 12 sectors, 4 protocols, 21 towers, 7 abilities, 19 enemy archetypes, deterministic elite variants, phased Umbra boss | `engine.ts`, `maps.ts`, `towers.ts`, `enemies.ts`, `waves.ts`, `eliteAffixes.ts` |
| Battle Plan replays | Public schema-v3 `runs/{runId}` docs with setup snapshots, r3 player-action packs, manifest `actionHash`, public chunks, `?run=` viewer, replay-of-the-day card | `runTelemetry.ts`, `replayCodec.ts`, `reSimulate.ts`, `leaderboard.ts`, `ReplayViewer.tsx`, `replaySpotlight.ts` |
| Replay-backed leaderboards | Server-only board writes, replay token verification, admin `verifyRun` re-simulation badges, canonical score values, server-time ordering | `leaderboard.ts`, `reSimulate.ts`, `functions/src/index.ts`, `firestore.rules` |
| Weekly Arena | UTC ISO-week Weekly Mutation boards, admin-crowned Champion's Gauntlet seeded from verified campaign runs, replay-backed weekly/gauntlet score submission | `weeklyChallenge.ts`, `leaderboard.ts`, `engine.ts`, `functions/src/index.ts`, `AdminDashboard.tsx` |
| Gauntlet Protocol | Weekly three-leg route, shortened 20/25/30-wave tables, core carry, 60% credit carry, relic drafts, aggregate protocol leaderboard | `gauntletProtocol.ts`, `GameScreen.tsx`, `leaderboard.ts`, `functions/src/index.ts`, `firestore.rules` |
| Freeplay | Campaign continuation, contracts, relics, risk packets, rivals, checkpoint banking | `freeplay.ts`, `engine.ts`, `App.tsx` |
| Daily Challenge | UTC daily protocol with fixed modifiers, normal wave-1 start, daily leaderboard | `dailyChallenge.ts`, `engine.ts`, `MainMenu.tsx`, `functions/src/index.ts` |
| Meta loop | Warden Rank, Salvage, Operations Board, Watch Streak; cosmetic/QoL only | `meta.ts`, `OperationsBoard.tsx`, `tests/e2e/ux-ui.spec.ts` |
| In-run QoL | Engine-backed wave preview, keyboard placement/cycling, Veteran Deploy batch upgrades | `GameScreen.tsx`, `engine.ts`, `runTelemetry.ts`, `storage.ts` |
| AI rival ghosts | In-run HUD and modal comparing current run to bundled bot profiles | `BotGhostHud.tsx`, `ghostCurve.ts`, `ghostCurveData.ts` |
| Privacy and admin | Age/consent gate, private feedback receipts, admin replies, admin-only deletion tooling | `consent.ts`, `leaderboard.ts`, `functions/src/index.ts`, `PrivacyView.tsx` |
| Accessibility baseline | Reduced motion, colorblind palette, global focus-visible ring, stronger contrast tokens | `settings.ts`, `src/index.css`, `App.css` |
| Live-ops hardening | Admin-editable remote balance config, deploy preflight, CI/security/audit gates, App Check staged-rollout path | `balanceConfig.ts`, `adminBalanceConfig.ts`, `scripts/deploy-preflight.ts`, `.github/workflows/ci.yml`, `docs/runbooks/app-check-rollout.md` |
| Portal distribution | Build-time CrazyGames/Poki SDK adapter, portal CSP flavors, natural-pause ad hooks, portal submission runbook | `portal.ts`, `vite.config.ts`, `GameScreen.tsx`, `docs/runbooks/portal-submission.md` |

## Recently shipped since the prior doc audit

- Long Watch and Diplomat's Gambit were retired; the campaign now has one
  ending path through Extinction, with a one-time Sunset Signal palette and
  Salvage bonus for the capstone clear.
- Public replay manifests are now mandatory for new uploads, and score
  validation treats missing manifests as incomplete data rather than legacy
  compatibility.
- Daily Challenge now appears as a fifth deploy protocol, starts as a normal
  wave-1 run, and writes non-freeplay daily leaderboard rows ranked by wave and
  kills.
- AI-rival comparisons were deepened and the modal layout was polished.
- AI helper privacy copy now explains what the assistant sends and why.
- Deploy checks now verify Node/Java/Firebase project prerequisites before rules/deploy work.
- Leaderboard rows now use server timestamps for ordering instead of trusting client clocks.
- Battle Plan replay integrity moved past the short-lived compact death ledger:
  schema v3 now stores only the manifest-hashed r3 action stream and re-simulates
  enemies from setup.
- Admin replay re-simulation now has an Operations Console path: inspect a run,
  press VERIFY, review `verified` / `divergent` / `unverifiable`, and badge
  admin board or spotlight candidate rows when stored verification data exists.
- Global focus-visible styling and design tokens improved the contrast/accessibility baseline.
- Operations palette re-equips are now silent while purchase/error feedback remains visible.
- Leaderboard rows can highlight the current browser's anonymous uid, and privacy export/delete includes replay score tokens.
- Harmonic Siphon and Vector Lure complete the 21-tower arsenal, with a
  regenerated balance baseline and an admin console for validated
  `config/balance` hot-patches.
- Build-phase wave preview, keyboard placement/cycling, and Veteran Deploy
  shipped as QoL layers over the canonical engine placement and upgrade actions.
- CrazyGames and Poki portal SDK builds now share a no-op-default adapter,
  portal-only CSP injection, lifecycle events, and natural-pause ad hooks.
- Replay v3 replaces public events, snapshots, and death ledgers with the
  compact r3 action stream. Old v2 replay links are unwatchable after this
  cutover and pinned spotlight runs should be refreshed to v3.
- Weekly Mutation and Weekly Champion's Gauntlet now share the deploy surface,
  leaderboards, replay metadata, Firestore rules, and callable validation with
  the existing daily/replay-backed score paths.

- Elite variants add capped Shielded, Frenzied, Splitting, and Bulwark hulls to
  regular waves, and the Umbra now has lattice, phase-shift, and enrage phases
  with replay-visible transitions.
- Exposed replaces instant shred bypass, target-priority filters can prefer
  boss/armored/cloaked/healer/spawner hulls with fallback targeting, and replay
  engine v4 records those filter actions in the r3 action stream.
- Mirror Hull exposes adaptive armor as a late-game flagship that mirrors the
  run's leading damage type, while Recalibrate lets players clear current
  adaptation pressure and temporarily soften living Mirror Hulls through replay
  engine v5.
- Gauntlet Protocol adds a weekly three-leg route from the Weekly Ops strip:
  shortened 20/25/30-wave legs, full core carry, 60% credit carry, between-leg
  relic drafts, aggregate protocol leaderboards, and replay engine v6
  verification.
- Four new sectors expand the Sector Atlas to twelve nodes: The Carousel as an
  early long-path breather, Splice Junction as a braided midgame choke, Mirror
  Array as a symmetric coverage puzzle, and Foundry Floor as the blocker-heavy
  Forge Belt capstone.

## Shipped 2026-07-01 (review-plan implementation pass)

- **Security tier**: Firebase Anonymous Auth required on every player write
  (uid binding in rules; rate limits keyed to verified identity); operator
  deletion corroborates ownership; Worker quota keyed by IP; TTL retention
  with real Timestamp fields; allowlist single-sourced.
- **Gameplay correctness audit fixes** (was #2): cloaked-reveal collision,
  burn attribution/stacking, same-tick terminal leaks, engine-enforced
  campaign unlocks — all fixed with regression tests.
- **Deterministic simulation**: seeded RNG recorded in replay setup, true
  fixed timestep, per-Game uids, save-file decoupling — unblocks server
  re-simulation.
- **Touch-first game surface** (was #3): short-landscape command layout,
  pause-behind-rotate-overlay, pinch-zoom allowed.
- **Guided first build** (was #4): action-gated coach (place → launch →
  upgrade) replaces the tutorial modal wall; skip/completion recorded.
- **PWA build freshness** (was #7): build-tag reload toast + 192/512
  maskable icons; production-bundle + service-worker e2e in the deploy gate.
- **Perf/cost**: Firestore SDK lazy (−55KB gzip first paint), art WebP
  (63.7MB → 3.2MB), fonts self-hosted, global-top aggregate doc (1 read vs
  ~400), 11MB internal report evicted, perf smoke is a real CI gate.
- **App Check staged-enforcement path**: deploy preflight now reports client
  token and callable enforcement expectations, the operator runbook covers
  reCAPTCHA Enterprise setup, production token probes, metrics watch, enforcement
  flip, and rollback, and a Functions drift test guards callable App Check
  options.
- **Production release hardening**: callable integration tests now run against
  Firebase emulators, manual deploy workflows fail outside `master` and record
  audit summaries, and CI dry-runs the Cloudflare Worker before merge.
- **Sector Atlas deploy menu**: the old sector card grid is replaced by the
  Lantern Seven starmap with real path glyph nodes, docked protocol selection,
  mastery stars from existing progress, and the existing Weekly Ops cards
  reached from a gold beacon.

## Near-term priorities

1. **Execute App Check enforcement** - use the staged rollout runbook's metrics window, then flip `ENFORCE_APP_CHECK` and Firebase console enforcement after production token flow is clean.
2. **Monetization MVP** - web checkout (cosmetics + premium unlock), server-side entitlements keyed to the authenticated uid (see business_plan.md).
3. **Replay re-simulation enforcement** - collect admin `verifyRun` samples, soft-flag divergent leaderboard rows, then flip rejection only after high-volume freeplay and balance-version false positives are understood.

## Deferred / bigger bets

- Automated score rejection from replay re-simulation once admin audit data shows the false-positive rate is acceptable.
- Severance Campaign, with fixed mission nodes and alternate objectives.
- Async duel or ghost-armada modes based on public replay data.
- Seasonal Recovered-Signal Pass and cosmetic store using Salvage/entitlements.
- More authored Hollow encounters beyond the Umbra.

## Portal launch checklist

- [x] Battle Plan read path, public replay chunks, and shareable run deep links
- [x] Meta retention loop (rank, quests, streak)
- [x] Reduced motion, colorblind palette, focus-visible, and contrast baseline
- [x] Server-validated leaderboard writes with replay-token verification
- [x] Remote balance hot-patch and admin editor
- [x] Replay-of-the-Day menu spotlight
- [x] Daily Challenge protocol
- [x] App Check staged-enforcement runbook and deploy preflight
- [x] Touch-first responsive command layout (short-landscape tier)
- [x] Replay completion manifest and chunk validation (manifests now REQUIRED)
- [x] Replay v3 action stream covered by the manifest
- [x] Gameplay correctness audit fixes
- [x] Guided onboarding funnel (action-gated coach)
- [x] Balance CI gate on PRs
- [x] Production deploy hardening checks
- [x] Build-tag reload toast (conservative shell precache retained by design)
- [x] CrazyGames/Poki SDK adapter and portal build flavors
- [ ] [ETHAN] Portal account setup, store copy, thumbnails, screenshots, and external-request approvals

- [x] **Replay pipeline E2E verification (Ethan directive 2026-07-11).**
  *(done 2026-07-18, bal-replay-sweep-0718)* `npm run test:replay-e2e`
  (wired into `npm run ci`, and run as a subprocess by `test:jest`) records
  seeded combat runs under jittered pacing → manifest + actionHash →
  mock upload → `reSimulate` → `verified` with summary + driver frame parity,
  a tampered action → `divergent`, and a zero-budget → bounded `unverifiable`,
  on 3 seeds. Both verdicts reproduce on demand; Gaps A–D closed (see
  `docs/plans/unblock-replay-pipeline-e2e-verification-ethan-d-20260718/`).

## Customization & paid-features backlog (added 2026-07-10)

Owner direction: build out skins, maps, mini-games, and customization as the
future paid surface. Everything here obeys the Guardrails below — **cosmetic /
content / QoL only, never touching combat stats, score math, bot plans, or
unlock thresholds** — and is sequenced so items sell through Salvage today and
flip to real entitlements when the Monetization MVP (priority #2) lands.

### Cosmetics (extend the existing `palette.ts` pattern)
- [x] **Signal Skins — towers & projectiles.** *(done 2026-07-10)* Generalize `AccentPalette` into
  a `CosmeticSet` (tower body/glow, projectile trail, impact particles) with a
  registry like `PALETTES[]`, Salvage-priced tiers, applied purely in
  `render.ts` lookups; replay playback renders the *viewer's* skin, never the
  runner's, so replays stay verification-identical.
- [x] **Map theme packs.** *(done 2026-07-10)* The per-map `theme` block (`bg1/bg2/path/pathEdge`)
  becomes selectable: ship 3–4 alternate themes per sector (e.g. Ember,
  Glacier, Void) as pure palette swaps on existing maps.
- [ ] **HQ/base customization.** Player-chosen core visual (shape shader +
  idle animation + death effect) from a cosmetic registry; visible in replays
  via manifest-carried cosmetic ids (display-only metadata, excluded from
  `actionHash`).
- [ ] **Victory/defeat flourishes.** Purchasable end-of-run effects (particle
  bursts, banner styles) — pure UI layer.
  *Plan landed 2026-07-18: `docs/plans/unblock-victory-defeat-flourishes-purchasable-en-20260718/` (lane `victory-defeat-flourishes`); implementation dispatch pending.*

### Maps & content
- [x] **Map pack: Sectors 13–16.** *(done 2026-07-11)* Four new `GameMap` entries exercising
  underused mechanics (multi-entrance paths, narrow pathWidth, heavy blocker
  fields); versioned in `mapVersions.ts`; balance-CI gate must pass.
- [ ] **Custom-map format + local editor (foundation for UGC).** Schema-
  validated JSON (same shape as `MAPS[]` entries + version hash), a dev-mode
  editor screen for path/blocker painting, local-only play. Sharing/upload is
  a LATER step gated on moderation + replay-integrity design (map hash must
  join the replay manifest before any shared-map leaderboard exists).
  *Plan landed 2026-07-18: `docs/plans/unblock-custom-map-format-local-editor-foundatio-20260718/` (lane `custom-map-format-local-editor`); implementation dispatch pending.*

### Mini-games (reuse Daily/Gauntlet infrastructure)
- [x] **Protocol Drills.** *(done 2026-07-10)* Short single-mechanic challenges (e.g. "slows
  only", "no abilities", fixed loadout) generated date-seeded like Daily
  Challenge; own small leaderboard per drill using the existing
  replay-token path.
- [x] **Between-wave bonus round (opt-in).** *(done 2026-07-10)* 15-second target-shooting
  interlude for bonus Salvage — deterministic, seeded from the run, recorded
  in the replay action stream so verification still reproduces it.

### Monetization scaffolding (sequence-gated)
- [ ] [ETHAN] **Account upgrade path.** Anonymous Auth → linked account
  (email/Google) preserving uid + Salvage + cosmetics; required before any
  real-money purchase (entitlements must key to an authenticated uid —
  priority #2's own rule).
- [x] **Entitlement model (server-side).** *(done 2026-07-11)* Firestore `entitlements/{uid}`
  written only by Cloud Functions, read by the client cosmetic registry;
  Salvage purchases and (later) Stripe purchases both funnel through it —
  one grant path, auditable.
- [ ] [ETHAN] **Stripe MVP** (already a launch-gate item in the business
  plan): web checkout for cosmetic bundles + supporter pack; webhooks →
  entitlement grants; no gameplay advantage, ever.
- [ ] **Seasonal cosmetic track ("Recovered-Signal Pass" v1).** Time-boxed
  cosmetic unlock ladder fed by existing quest/streak meta — free tier +
  premium tier (entitlement-gated); zero gameplay deltas, per Guardrails.
  *Plan landed 2026-07-18: `docs/plans/unblock-seasonal-cosmetic-track-recovered-signal-20260718/` (lane `seasonal-cosmetic-track`); implementation dispatch pending.*

## Guardrails

- `meta.ts` must stay off the combat, score, and bot paths.
- QoL preferences may improve control flow, but must not change tower/enemy
  stats, score math, bot plans, or unlock thresholds.
- Public replay docs must remain compact, schema-v3 only, and free of `undefined` values.
- Replay read paths must reject or clearly label incomplete/malformed chunks; partial data should not masquerade as a full Battle Plan.
- New public replay uploads must carry a manifest with action chunk counts and `actionHash`; missing manifests are incomplete and cannot back accepted scores.
- Leaderboard score claims must include a matching replay token.
- `verifyRun` verdicts are admin audit data until the enforcement flip; player-facing
  views must not expose verification badges or divergence details.
- Privacy export/delete must cover every local key that can affect score retry, identity, consent, or private replies.
- Admin allowlists in `firestore.rules`, Functions helpers, and client admin code must stay synchronized.
- AI help remains optional and must keep secrets in the Worker, not in Vite-exposed variables.

## Cross-project: AI asset intake (G1, added 2026-07-10)

- [ ] (G1) `assets/incoming/` intake for Signal Skin concept batches from local-ai-lab — manifest-validated and review-gated; concepts only, nothing auto-ships to the live game (guardrails above apply)
  *Plan landed 2026-07-18: `docs/plans/unblock-g1-assets-incoming-intake-for-signal-ski-20260718/` (lane `g1-assets-incoming-intake`); implementation dispatch pending.*
- [x] (G1) Publish skin-concept constraints (dimensions, format, neon palette rules) for the lab's NVD prompt matrices. *(done 2026-07-18, g1-publish-skin-concept-constraints)*

- [ ] [refactor] Module-stub Firestore reads in the qa-screens scaffold (added via Visions, 2026-07-19)

- [ ] [lost] Queue the [ETHAN] agents-fence promotion so the P0 replay fixes can dispatch (added via Visions, 2026-07-19)
