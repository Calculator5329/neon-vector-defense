# Roadmap

Current build status and near-term priorities. For the full historical 80-idea
audit backlog, see [idea_backlog.md](./idea_backlog.md).

Last updated: 2026-07-26 (agent-guide hygiene)

## Repository hygiene

- [x] Complete the 2026-09-04 anti-slop cleanup and replay/menu repairs. Final lane verification: browser 81 passed/27 platform or preview skips, engine 139/139, replay three seeds, meta isolation, security 82/82, focused layout/unlock 4/4, and build passed. Canonical integration is the root session's next step; evidence is in docs/archive/anti-slop-20260904/README.md. *(verified 2026-09-04)*

- [x] <!-- workspace:id=work:5bb5bee5-4be9-5177-b097-d481c9224123 --> Replace the malformed centralization-era agent-guide scaffold with the
  repository's current mission, verification matrix, replay/security
  boundaries, and owner-only operations. *(done 2026-07-26)*

## Special editions

- [x] <!-- workspace:id=work:a836fee9-5271-5a49-ab12-cd878af381ca --> **THE YAKKOB** — dwarf-unlock special challenge (Prism Array + Watchfire Beacon only,
  squished icons, local-ranked). *(done 2026-07-20; see changelog. Built on branch
  `agent/claude/yakkob-special-edition-20260720`.)*
- [ ] <!-- workspace:id=work:2a095de4-8e17-54f8-a163-5bbb76144378 --> **THE YAKKOB — optional online leaderboard.** Currently local-only because a fixed
  challenge id is rejected by the date-keyed daily boards. A persistent online board would
  need a `submitYakkobScore`-style Cloud Function + Firestore rules + collection — an
  **Ethan-only deploy**. Left as a follow-up.

## Now — owner bug report (Ethan, 2026-07-16 audit review)

- [x] <!-- workspace:id=work:d51dcfb3-b60b-506c-8b1b-14e7f8930d48 --> **BUG: replay playback is inaccurate — enemies don't die accurately.**
  *(done 2026-07-18, bal-replay-sweep-0718)* Root cause was NOT determinism
  drift — the fixed-timestep accumulator makes the tick sequence pacing-
  independent (locked by `tests/unit/replay-determinism.test.ts`, byte-identical
  kill frames under jittered vs uniform dt across seeds). The owner symptom was
  the viewer *silently* falling back to a cosmetic reconstruction; the viewer now
  labels "COSMETIC PREVIEW — not a frame-accurate replay" and logs the reason
  (`createReplayPlaybackDiagnostic`). Frame parity on ≥3 seeds is asserted by
  `npm run test:replay-e2e` (driver reproduces identical kills/leaks/wave).
- [x] <!-- workspace:id=work:3432ffc8-1216-5648-a5d5-0fec633edd74 --> **BUG: replay verification gets stuck in simulating loops.**
  *(done 2026-07-18, bal-replay-sweep-0718)* Root cause: the server verify path
  had a tick-count guard but no wall-clock deadline, so a dense marathon could
  burn to the Cloud Function timeout under the tick cap. `reSimulate` now takes a
  `wallClockMs` budget and returns `unverifiable` (not `divergent`) on deadline;
  `verifyRunCore` caps it at 30s. The bounded/anti-hang case is asserted in
  `npm run test:replay-e2e`.

## Now — feedback pass (Ethan, 2026-07-20)

- [x] <!-- workspace:id=work:b906f7ab-c877-5774-b562-1de4354aeb5e --> **Replays: "he shoots but enemies don't die / starts at end / shows victory".**
  *(done 2026-07-20)* Marathon/Extinction runs exceeded the 3,600s playback duration
  cap (below the 80-wave campaign length!) → cosmetic fallback that can't show kills;
  raised to 10,800s. Fixed cosmetic-path start-at-end (lone synthetic keyframe now
  starts at 0) and the persistent VICTORY stamp (gated on playhead reaching the end).
  See `docs/changelog.md`.
- [ ] <!-- workspace:id=work:604904ef-f1f9-5bea-a460-50af21eb2f2e --> **Replay re-sim determinism (pre-existing, filed as a task).** `reSimulate`
  returns `divergent` for deep-freeplay-with-relic and Recalibrate ability_cast runs
  (tests/unit/reSimulate.test.ts, 19 of 21 passing as of 2026-08-12). Core to "get replays right" — a divergent run
  plays back wrong even when the driver runs.
- [ ] <!-- workspace:id=work:b5ae06ba-3ae3-59aa-ae9c-5e57c364ebd2 --> **Old runs are orphaned by engine/balance version drift.** Any run recorded
  before an engine bump can never be re-simulated frame-accurately (correct by design,
  but it means historical replays are cosmetic-only). Consider recording a compact
  death/kill timeline so the cosmetic reconstruction can at least show enemies dying.


- [x] <!-- workspace:id=work:f869e439-bd76-5605-b6b3-e0fbc5edb538 --> **Debrief "NEW INSTRUMENTS UNLOCKED" overflowed off-screen.** A full clear
  banks 7+ instruments at once; the vertical list with per-row descriptions
  pushed later unlocks (EMP Spire onward) below the fold. Redesigned to a compact
  horizontal grid of icon chips (icon + short name + hover tooltip). *(done
  2026-07-20)*
- [x] <!-- workspace:id=work:385159ae-ee5e-5c1f-8b43-2b95fd612303 --> **Phase Anchor "push forward" upgrade track removed.** The Repulsor Field
  track pushed hulls *toward* the exit (trash). Replaced with the Warden Array
  track (detection + slow + range lockdown), preserving the cloak-detection
  utility. Track structure stays a 2-tuple (`tracks[0|1]` is load-bearing). *(done
  2026-07-20)*
- [x] <!-- workspace:id=work:3e521911-fc41-57f9-918f-39f338f0023c --> **Intro to Veteran mode on first deploy.** *(done 2026-07-20)* One-time
  "THE ARMADA ADAPTS" briefing on first Veteran (normal) campaign deploy —
  phase-cloaks (~wave 14), adaptive armada, leaner economy. `veteranIntroSeen`
  flag in `storage.ts`. This is the actual fix for the Recruit→Veteran onboarding
  gap (the "HP cliff" premise was corrected — see below).
- [x] <!-- workspace:id=work:73f75cf2-80f2-5832-8200-9985f86a550f --> **Mastery-routing nudge.** *(done 2026-07-20)* Dominant Recruit clear →
  "you've outgrown Recruit, try Veteran" debrief callout.
- [x] <!-- workspace:id=work:1d9e31c4-3c9c-5f39-a162-b675577200e7 --> **Recruit→Veteran HP cliff — corrected, no change made.** Difficulty HP
  already ramps over 25 waves; early Veteran ≈ early Recruit. The "+56%" was the
  wave-25+ asymptote misapplied. No HP nerf (would undercut "not too easy").
- [x] <!-- workspace:id=work:72493635-f851-591b-95b3-a8394e3c443f --> **Wave 13–16 "wall" — sim-bot artifact, closed.** No real difficulty spike
  in the per-wave model; the bot is just weak there.
- [ ] <!-- workspace:id=work:f61e5c48-4730-5142-9fdb-181c874543cb --> **Validate late-game scaling (still open).** The sim bot is too weak to
  reproduce the "2-tower minimal clear" exploit; needs fresh real-player runs or a
  hand-authored 2-tower Throat/Recruit scenario test. Apex/Extinction stay
  untouched (Ethan constraint).
- [ ] <!-- workspace:id=work:10279839-e5ce-5757-a044-8de084b38e53 --> **Mass-unlock dump smell.** One 60-wave Veteran clear (66k kills) crosses
  ~7 unlock thresholds at once, dumping every early instrument in a single
  debrief — anticlimactic vs. the BTD-style progressive reveal. Consider staging
  the reveal or rebalancing early `unlockAt` thresholds. (Layout no longer hides
  them; this is the pacing question.)
- [ ] <!-- workspace:id=work:ef205c7b-c63d-542c-b3c0-7395680452e4 --> **Pre-existing test failure (not from this pass):** `tests/unit/
  game-correctness.test.ts` › "watchfire sweep marks cloaked hulls as revealed"
  fails on clean master (`placeTower` returns null in headless node —
  `assert.ok(watchfire)` at :260 (re-measured 2026-08-12)). Triage separately.

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
| Core tower-defense loop | 16 sectors, 4 protocols, 21 towers, 7 abilities, 19 enemy archetypes, deterministic elite variants, phased Umbra boss | `engine.ts`, `maps.ts`, `towers.ts`, `enemies.ts`, `waves.ts`, `eliteAffixes.ts` |
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

- [x] <!-- workspace:id=work:f9c14dab-4912-51e8-8fe5-403a10653a2e --> Battle Plan read path, public replay chunks, and shareable run deep links
- [x] <!-- workspace:id=work:bb0afdf3-ef5a-593b-9a97-43d0aff07a81 --> Meta retention loop (rank, quests, streak)
- [x] <!-- workspace:id=work:f615422d-1c07-5310-8ae8-72c54fb487bf --> Reduced motion, colorblind palette, focus-visible, and contrast baseline
- [x] <!-- workspace:id=work:7305985c-f617-5776-9a89-f2ae0afb212f --> Server-validated leaderboard writes with replay-token verification
- [x] <!-- workspace:id=work:edf6e53e-8d8c-5518-93be-890038cd1140 --> Remote balance hot-patch and admin editor
- [x] <!-- workspace:id=work:95aa3edf-4e3d-550a-a967-81dce69b00fe --> Replay-of-the-Day menu spotlight
- [x] <!-- workspace:id=work:543eaee1-44b7-5923-84d2-aca028095e78 --> Daily Challenge protocol
- [x] <!-- workspace:id=work:71c86388-31c6-552f-85cd-636776455a2f --> App Check staged-enforcement runbook and deploy preflight
- [x] <!-- workspace:id=work:bee21c84-1330-59b1-a446-b32b4db7bdb3 --> Touch-first responsive command layout (short-landscape tier)
- [x] <!-- workspace:id=work:9dffe927-e5fb-53bb-8464-63e85e2f4f4a --> Replay completion manifest and chunk validation (manifests now REQUIRED)
- [x] <!-- workspace:id=work:02378904-5a25-5800-8392-544413f01f72 --> Replay v3 action stream covered by the manifest
- [x] <!-- workspace:id=work:64ffcae3-2480-565a-987d-e3dd7cbd1139 --> Gameplay correctness audit fixes
- [x] <!-- workspace:id=work:bac888f7-6fc3-54d5-9c3b-7d770e32edfe --> Guided onboarding funnel (action-gated coach)
- [x] <!-- workspace:id=work:77542534-7787-595e-85c0-8b7dfbe5ac0f --> Balance CI gate on PRs
- [x] <!-- workspace:id=work:5700f869-95ec-56a4-b779-351ef0ce2c32 --> Production deploy hardening checks
- [x] <!-- workspace:id=work:526f0f27-072e-54de-b910-35d63dc9d5f5 --> Build-tag reload toast (conservative shell precache retained by design)
- [x] <!-- workspace:id=work:d989eb44-648c-58c2-a0df-be7ebd16ad31 --> CrazyGames/Poki SDK adapter and portal build flavors
- [ ] <!-- workspace:id=work:8b1ea672-f61f-57b9-975e-4d1fc5a2a490 --> [ETHAN] Portal account setup, store copy, thumbnails, screenshots, and external-request approvals
  *(Ethan 2026-08-16: took recommendation via waiting-on-you packet, ask
  2426f25f — agents may draft the store copy, thumbnails and screenshots now
  so they are waiting; the portal ACCOUNT and the upload stay owner-only, and
  per his same-day inbox answer 4a630a05 the launch itself is parked, so the
  drafts queue as low-priority agent work and nothing gets listed until he
  unparks.)*

- [x] <!-- workspace:id=work:42d16144-cc53-538e-a45e-472a0d3687b4 --> **Replay pipeline E2E verification (Ethan directive 2026-07-11).**
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
- [x] <!-- workspace:id=work:a7bf5e3f-50da-5790-b78b-2485d8ec1715 --> **Signal Skins — towers & projectiles.** *(done 2026-07-10)* Generalize `AccentPalette` into
  a `CosmeticSet` (tower body/glow, projectile trail, impact particles) with a
  registry like `PALETTES[]`, Salvage-priced tiers, applied purely in
  `render.ts` lookups; replay playback renders the *viewer's* skin, never the
  runner's, so replays stay verification-identical.
- [x] <!-- workspace:id=work:61baf87e-4176-5546-85d6-e52e324d4bab --> **Map theme packs.** *(done 2026-07-10)* The per-map `theme` block (`bg1/bg2/path/pathEdge`)
  becomes selectable: ship 3–4 alternate themes per sector (e.g. Ember,
  Glacier, Void) as pure palette swaps on existing maps.
- [ ] <!-- workspace:id=work:50f7383a-b9b3-5157-9b6a-417cc10f5448 --> **HQ/base customization.** Player-chosen core visual (shape shader +
  idle animation + death effect) from a cosmetic registry; visible in replays
  via manifest-carried cosmetic ids (display-only metadata, excluded from
  `actionHash`).
- [ ] <!-- workspace:id=work:07b0dcca-21ac-5fcd-bc7d-93d06464682d --> **Victory/defeat flourishes.** Purchasable end-of-run effects (particle
  bursts, banner styles) — pure UI layer.
  *Plan landed 2026-07-18: `docs/plans/unblock-victory-defeat-flourishes-purchasable-en-20260718/` (lane `victory-defeat-flourishes`); implementation dispatch pending.*

### Maps & content
- [x] <!-- workspace:id=work:1a2a269f-27b2-5d83-a125-9e2164f81fb2 --> **Map pack: Sectors 13–16.** *(done 2026-07-11)* Four new `GameMap` entries exercising
  underused mechanics (multi-entrance paths, narrow pathWidth, heavy blocker
  fields); versioned in `mapVersions.ts`; balance-CI gate must pass.
  > **Only half of this shipped. Measured 2026-08-13.** The client has all 16 maps.
  > The server does not: `firestore.rules:106` and `functions/src/index.ts:63-64` both
  > allowlist 12 map ids, and `crossfeed`, `needleglass`, `bastion` and `eventide` are
  > not among them. A player who reaches sector 13-16 and posts a score is rejected by
  > the deployed rules. The tick above stands for the client work, which is done; the
  > server half was never deployed. The fix is two one-line allowlist edits plus a
  > `firebase deploy --only firestore:rules,functions`, both written out in
  > `~/projects/planning/owner-actions/deploy-drift-20260813.md`. Deploying is
  > Ethan-only, and this repo's agent fence is `docs-only`, so no agent will do either
  > half without a decision. Filed under owner ruling `q-deploy-drift=record_and_stage`
  > (doc-truth-packet-20260812).
- [ ] <!-- workspace:id=work:a7258872-7b1d-59ce-a3aa-20e1f05e8e14 --> <!-- filed 2026-08-13, id sweep will stamp it --> **Ship the server half of the
      Sectors 13-16 map pack.** Add `crossfeed`, `needleglass`, `bastion`, `eventide`
      to the Firestore rules allowlist and the Cloud Function allowlist, then deploy.
      Commands and undo: `~/projects/planning/owner-actions/deploy-drift-20260813.md`.
      Blocked on Ethan: the deploy is owner-only.
- [ ] <!-- workspace:id=work:0b2d10a1-316a-5b64-a8f9-12d1f0ecd639 --> **Custom-map format + local editor (foundation for UGC).** Schema-
  validated JSON (same shape as `MAPS[]` entries + version hash), a dev-mode
  editor screen for path/blocker painting, local-only play. Sharing/upload is
  a LATER step gated on moderation + replay-integrity design (map hash must
  join the replay manifest before any shared-map leaderboard exists).
  *Plan landed 2026-07-18: `docs/plans/unblock-custom-map-format-local-editor-foundatio-20260718/` (lane `custom-map-format-local-editor`); implementation dispatch pending.*

### Mini-games (reuse Daily/Gauntlet infrastructure)
- [x] <!-- workspace:id=work:369bad04-0bfb-5a89-b651-3abf5607d4fb --> **Protocol Drills.** *(done 2026-07-10)* Short single-mechanic challenges (e.g. "slows
  only", "no abilities", fixed loadout) generated date-seeded like Daily
  Challenge; own small leaderboard per drill using the existing
  replay-token path.
- [x] <!-- workspace:id=work:3cc1da44-0402-598c-b420-fc12b55294f1 --> **Retire the between-wave target-practice popup.** *(built 2026-07-10;
  removed 2026-08-06 at Ethan's direction)* New runs no longer offer or record
  the 15-second interlude. Historical replay actions remain supported so old
  Battle Plans still verify and play accurately.

### Monetization scaffolding (sequence-gated)
- [ ] <!-- workspace:id=work:d83cda8f-c8ad-5786-bb16-542a0447ec2c --> **Account upgrade path.** Anonymous Auth → linked account
  (email/Google) preserving uid + Salvage + cosmetics; required before any
  real-money purchase (entitlements must key to an authenticated uid —
  priority #2's own rule).
  *(Ethan 2026-08-16: took recommendation via waiting-on-you packet, ask
  2426f25f — build it now, regardless of Stripe; losing progress on a device
  change is a bug whether or not money is involved. [ETHAN] gate cleared;
  this is now ordinary agent work.)*
- [x] <!-- workspace:id=work:54edc4fc-d147-58c3-8655-980a901eea28 --> **Entitlement model (server-side).** *(done 2026-07-11)* Firestore `entitlements/{uid}`
  written only by Cloud Functions, read by the client cosmetic registry;
  Salvage purchases and (later) Stripe purchases both funnel through it —
  one grant path, auditable.
- [x] <!-- workspace:id=work:496916b9-ab22-5ca3-8396-cc95692c912f --> [ETHAN] **Stripe MVP** (already a launch-gate item in the business
  plan): web checkout for cosmetic bundles + supporter pack; webhooks →
  entitlement grants; no gameplay advantage, ever.
  *(Ethan 2026-08-16: took recommendation via waiting-on-you packet, ask
  2426f25f — PARKED until the game has players worth charging; matches his
  same-day inbox answer 4a630a05 "Park the Neon launch until you have time
  for Stripe; agents stop surfacing it". Wake condition: Ethan unparks
  explicitly. Do not build or re-surface before then.)*
- [ ] <!-- workspace:id=work:48399282-9e9d-5d41-b995-cb7540e7ff2e --> **Seasonal cosmetic track ("Recovered-Signal Pass" v1).** Time-boxed
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

- [ ] <!-- workspace:id=work:c35bfb36-8b60-52eb-86f2-04ba20a74cbb --> (G1) `assets/incoming/` intake for Signal Skin concept batches from local-ai-lab — manifest-validated and review-gated; concepts only, nothing auto-ships to the live game (guardrails above apply)
  *Plan landed 2026-07-18: `docs/plans/unblock-g1-assets-incoming-intake-for-signal-ski-20260718/` (lane `g1-assets-incoming-intake`); implementation dispatch pending.*
- [x] <!-- workspace:id=work:e278b4e6-eef9-53f6-a7f0-697f6ebaf5c4 --> (G1) Publish skin-concept constraints (dimensions, format, neon palette rules) for the lab's NVD prompt matrices. *(done 2026-07-18, g1-publish-skin-concept-constraints)*

- [ ] <!-- workspace:id=work:8e0fc7ca-cfcb-5307-81e9-613be760745a --> [refactor] Module-stub Firestore reads in the qa-screens scaffold (added via Visions, 2026-07-19)

- [ ] <!-- workspace:id=work:46c75774-4594-59f2-8c39-22a5b50de35d --> [lost] Queue the [ETHAN] agents-fence promotion so the P0 replay fixes can dispatch (added via Visions, 2026-07-19)
  *(Ethan 2026-08-16: took recommendation via waiting-on-you packet, ask
  2426f25f — raise the fence to `agents: full`. DECIDED but NOT yet executed:
  the agent edit to ~/projects/workspace.json was blocked by the permission
  guard, so the one-line flip `"agents": "docs-only"` → `"agents": "full"` on
  the games/neon-vector-defense entry needs Ethan's hands or an allowed
  session. Once flipped, the P0 replay fixes can dispatch.)*

- [ ] Investigate freeplay replay drift: unchanged seed-337 fixture disagrees on live versus replay kills/cash. Preserve the exact replay-equality assertion; see `archive/anti-slop-20260904/replay-base.log`.

- [ ] Diagnose the 10 browser failures measured during anti-slop verification (weekly card, atlas/recruiter flow, palette purchase); preserve assertions and classify against original behavior. See `archive/anti-slop-20260904/e2e.log`.
