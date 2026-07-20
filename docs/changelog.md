# Changelog

Running log of notable changes. Most recent first.

## 2026-07-20 - Fix THE YAKKOB debrief attempting a global leaderboard submit

Owner report: a YAKKOB run's debrief showed "GLOBAL LEADERBOARD — FOUNDRY FLOOR /
VETERAN" and its replay/score submit failed with `FirebaseError: Missing or
insufficient permissions`.

- **Root cause.** THE YAKKOB is a local-ranked special edition (`yakkob.ts`), but
  `game.isDailyChallenge` is just `dailyChallenge !== null` → true for a YAKKOB run,
  while its `dailyId` resolves to empty (special editions are excluded from the daily
  boards). So `SubmitScore` fell through to the **global** campaign board
  (`boardId(foundry, normal)`) and called `submitRunReplay` + `submitScore`, which
  Firestore rules reject for the modified run.
- **Fix (`GameScreen.tsx`).** `SubmitScore` now short-circuits for `isYakkob(...)` runs
  to a "THE YAKKOB · LOCAL RANKING" panel (best wave / this run / kills) that sends
  nothing off-device — no `submitRunReplay`, no `submitScore`. The wave is already
  banked locally via `meta.creditRun({ yakkob })`, so the panel just surfaces it.

Owner feedback pass on the challenges dock and THE YAKKOB special edition.

- **Removed Protocol Drills from the challenges dock.** They padded the stack and
  forced a scrollbar; the dock now reads DAILY CHALLENGE → THE YAKKOB → CHAMPION
  GAUNTLET → GAUNTLET PROTOCOL. (Drill run-mode plumbing is untouched — this is a
  menu-surface removal.)
- **Unlock flow.** Clicking the digging dwarf now flips the dock to CHALLENGES,
  scrolls THE YAKKOB card (row 2, under DAILY) into view, focuses it, and fires a
  one-shot shimmer sweep as it lands. THE YAKKOB replaces the WEEKLY MUTATION slot
  and the separate dashed "SPECIAL BOX" card is gone — net card count stays flat, so
  no scrollbar at normal window heights. (`MainMenu.tsx`, `App.css`.)
- **Tap-to-deploy.** THE YAKKOB card carries a stronger attention beckon + a pulsing
  "▶ TAP TO DEPLOY" pill, and tapping it now launches the run immediately instead of
  only selecting the mode. (`MainMenu.tsx`, `App.css`.)
- **Squished towers on the battlefield, not just in the shop.** The Prism Array and
  Watchfire Beacon now render at 0.75× height on the field and in the placement-preview
  ghost, matching their squashed shop icons. Threaded a `squishY` param through
  `drawTowerBody`. (`render.ts`.)

## 2026-07-20 - Replays: marathon runs play for real + fix start-at-end / persistent VICTORY

Owner report: replays show towers firing but enemies never die, open at the end,
and stamp VICTORY. Root-caused to three separate issues.

- **Marathon/Extinction runs fell back to the hollow cosmetic path (primary cause
  of "enemies don't die").** The frame-accurate driver is correct — it reproduces
  exact kills — but a run is ~48s/wave, so a wave-80 run is ~3,845s and exceeded the
  `PLAYBACK_MAX_DURATION_S` cap of **3,600s**, which is *below* the game's own longest
  campaign (Extinction = 80 waves). So every Extinction clear and any deep marathon
  dropped to the cosmetic reconstruction (arrows flow, nothing dies, victory stamp).
  Raised the cap to **10,800s** (`durationS` is sim-time, so idle build phases barely
  cost re-sim ticks; the 250k kill cap + wall-clock-budgeted seeking remain the real
  guards). Exported `REPLAY_PLAYBACK_MAX_DURATION_S`; regression test asserts an
  80-wave-length (3,840s) run stays frame-accurate. (`reSimulate.ts`, `replay-fidelity.test.ts`.)
- **"It starts at the end."** In the cosmetic path, `t0` was `snaps[0].t`; when the
  only keyframe is the synthetic run-end (v3 docs carry no snapshots, or a lone-snapshot
  legacy doc), that equals `durationS`, opening the replay already finished. Now a lone
  synthetic keyframe starts at 0, and the freeplay deep-open skip can never land on/past
  the final keyframe. (`ReplayViewer.tsx` t0 memo.)
- **Persistent "VICTORY" stamp over an early wave.** `reconstructAt` reports
  `terminal = idx === snaps.length - 1`, which is always true for the single synthetic
  keyframe, so `showStamp` was true from t=0. Gated the stamp on the playhead actually
  reaching `tEnd`. The driver path (phase-based terminal) was already correct. (`ReplayViewer.tsx`.)
- Seeded `veteranIntroSeen: true` in the e2e progress seeds (ux-ui, qa-regression,
  qa-screens, ui-stability, portal-sdk): a returning player defaults to Veteran, whose
  new one-time intro would otherwise block the briefing those flows deploy into. Also
  un-stale'd the frame-accurate replay e2e (`replayEngine` 6 → current `REPLAY_ENGINE_VERSION`);
  it now passes end-to-end (verifies start-at-0 + full scrub domain).

Known-still-broken (pre-existing, filed separately, NOT from this change): `reSimulate`
returns `divergent` for a deep-freeplay-with-relic run and a Recalibrate ability_cast
case (real determinism defects in the marathon/freeplay family).

## 2026-07-20 - Veteran onboarding: first-deploy intro + mastery nudge

Balance follow-up (Ethan-approved directions). Corrects the earlier "Recruit→
Veteran HP cliff" premise: the engine already ramps difficulty HP in over the
first 25 waves (`engine.ts` `ramp = min(1, wave/25)`), so early Veteran ≈ early
Recruit — the real step-change is informational (phase-cloaks from ~wave 14 +
leaner economy), not enemy HP. So this ships onboarding, **not** an HP nerf, and
touches **no** enemy HP / no Apex/Extinction values (per Ethan's constraint).

- **Veteran intro (one-time).** On a player's first Veteran (normal) campaign
  deploy, a briefing modal ("THE ARMADA ADAPTS") names the three real changes:
  phase-cloaks incoming (~wave 14 — bring a detector), adaptive armada, leaner
  economy. Gated by a new persistent `veteranIntroSeen` flag (`storage.ts`),
  suppressed in demo/daily/weekly/gauntlet, shown before the sector briefing.
  Verified: fires once on first Veteran deploy, never again, never on Recruit.
- **Mastery-routing nudge.** A dominant Recruit clear (kept ≥70% cores, not
  freeplay, no Veteran progress yet) shows a debrief callout routing the player
  up to Veteran — rewards mastery by routing, not by nerfing.
- Analysis + the corrected findings (incl. the wave 13–16 "wall" being a sim-bot
  artifact, and late-game-scaling validation still open) in
  `docs/plans/BALANCE-2026-07-20-followup.md`.

## 2026-07-20 - Debrief unlocks grid + Phase Anchor push-forward removal

Feedback pass (Ethan).

- **Debrief "NEW INSTRUMENTS UNLOCKED" no longer overflows off-screen.** A full
  60-wave clear banks 7+ instruments at once; the old vertical list (badge +
  name + type + full description per row) grew past the viewport and hid the
  later unlocks (EMP Spire onward). Rebuilt as a compact horizontal grid of icon
  chips — icon badge + short name, with the type/cost/description on hover
  (`title`) and an `aria-label`. Header now counts the unlocks. 7 instruments now
  render in 2 rows (~170px tall) inside the debrief column instead of a
  420px+ stack. (`GameScreen.tsx` `debrief-unlocks`, `App.css`.)
- **Phase Anchor "push forward" upgrade track removed.** The Repulsor Field track
  (Reverse Polarity / Hard Shove / Dispersion Field / SCATTER ENGINE / THE EXILE
  GATE) shoved hulls *toward* the exit — counterproductive and weak. Replaced
  with the **Warden Array** track (Phase Detector → Resonant Lattice → Deep Sap →
  Graviton Mesh → WARDEN FIELD → THE UNBLINKING EYE): detection + slow + range
  lockdown, no forward push anywhere. Cloak-detection utility that was buried in
  the old track is preserved and elevated. The tower's top-line description was
  updated to drop the forward-hurl copy. Structure stays a 2-track tuple
  (`tracks[0|1]` is load-bearing across engine/UI/AI). (`towers.ts`.)
- Follow-ups filed in `docs/roadmap.md`: Veteran-mode intro on first unlock
  (owner "maybe"), the mass-unlock dump pacing smell, and a pre-existing
  unrelated `watchfire sweep` unit-test failure on clean master.

## 2026-07-20 - Fix RECOMMENDED protocol pill spacing + layout regression guard

Feedback fix: the first-time "RECOMMENDED" pill in the difficulty dock overlapped
the protocol name.

- **Root cause.** `.diff-card.atlas-protocol-row` is a two-column grid
  (`name | desc`), but the static `.start-pill` was emitted as a plain third
  child. Grid auto-placement dropped the pill into col-1/row-1 and shoved the
  name ("Recruit") into col-2 beside it, with the description wrapping to row-2.
- **Fix (`src/App.css`).** `.diff-card.atlas-protocol-row .start-pill` now spans
  `grid-column: 1 / -1` (`justify-self: start`), so the badge sits on its own
  top row and name+desc keep the normal two-column row beneath. The map-node
  "START HERE" pill was unaffected (it stays `position: absolute`, so it never
  became a grid child).
- **Regression guard (`tests/e2e/menu-recommended-pill.spec.ts`).** New Playwright
  spec seeds a first-time player, exposes the pill, and asserts the layout
  invariant (pill sits above the name, name+desc share a row on desktop, no
  overlaps) plus a frozen-animation pixel snapshot of the dock. Verified the
  guard fails on the pre-fix CSS and passes on the fix, desktop + mobile.

## 2026-07-20 - THE YAKKOB special edition (dwarf-unlock challenge)

A hand-authored "special edition" challenge, unlocked by a bit of theatre and ranked
locally on-device (its fixed id never touches the date-keyed online daily boards, so no
Functions/Firestore changes and no deploy).

- **Unlock ritual.** A procedurally-drawn pixelated dwarf digs a hole in the corner of
  the main-menu deploy tab (`src/menu/YakkobDwarf.tsx`), arriving with a synthesized
  medieval lute fanfare (`sfx.yakkobArrival` in `sound.ts`) and a pulsing "!" to pull the
  eye. Clicking him sets `meta.yakkobUnlocked` (persisted in localStorage) and opens the
  vault. Respects `prefers-reduced-motion`.
- **Dock swap.** Once unlocked, THE YAKKOB takes the Weekly Mutation's slot as a glowing
  gold card; the displaced Weekly is re-skinned as a sealed **"❓ SPECIAL BOX"**
  (contents + open window undisclosed) — the weekly logic underneath is untouched.
- **The challenge** (`src/game/yakkob.ts`). Arsenal is locked to exactly the **Prism
  Array + Watchfire Beacon** (both premium beams at 40% requisition so the opening is
  playable), Glass Cannon twist, double drops. Runs on the existing daily-challenge engine
  path; `dailyMeta()` withholds the online board id for it and `meta.creditRun` routes its
  score to a local `bestYakkobWave`.
- **The gag.** Inside THE YAKKOB only, the two towers' shop icons render squished to
  **0.75× height, full width** — they look short (`TowerIcon squish` in `GameScreen.tsx`).
- Tests: `tests/unit/yakkob.test.ts` (pool is exactly the two towers, no pulse injection,
  cost/affordability, local-only id). Typecheck clean; no regressions to existing suites.

## 2026-07-18 - Replay pipeline E2E: real script + viewer fidelity label + determinism lock

Closes Gaps A–D from `docs/plans/unblock-replay-pipeline-e2e-verification-ethan-d-20260718/`
(Balance round finding 4 — "fix ALL remaining replay issues"). Verification,
viewer-label, and test scaffolding only; no combat/score/bot/unlock math touched.

- **Gap A — the named E2E now actually runs and exercises combat.** Rewrote
  `scripts/replay-e2e.ts` from a combat-free smoke gate into a real proof:
  records seeded bot campaigns through waves with enemy deaths on **3 seeds
  (123/223/987) under jittered variable frame pacing**, and per seed asserts
  `reSimulate` → `verified` with exact summary parity, the client
  `createReplayPlayback` driver reproduces identical kill frames, a tampered
  player action → `divergent`, and a zero wall-clock budget returns a bounded
  `unverifiable` (never hangs). Wired as `npm run test:replay-e2e` and into
  `npm run ci`. Replaced the grep-only `tests/jest/replay-e2e.test.cjs` (which
  read the script as text and matched string literals) with a real subprocess
  run that requires exit 0 + the `replay-e2e: PASS` sentinel.
- **Gap B — the viewer no longer presents a cosmetic reconstruction as the real
  battle.** `createReplayPlaybackDiagnostic` now returns the *reason* a run can't
  be driven frame-accurately (schema/engine/balance drift, duration/kill caps,
  missing tick timing, setup error); `ReplayViewer` logs it and shows a visible
  "COSMETIC PREVIEW — not a frame-accurate replay" label. This is a fidelity
  notice, never a `verifyRun` verdict (no verified/divergent leaked to players).
  `createReplayPlayback` keeps its historical `ReplayPlayback | null` contract.
- **Gap C — server verify path can no longer hang (owner "stuck simulating"
  root cause).** `reSimulate(bundle, { wallClockMs })` adds a wall-clock deadline
  to the re-sim advance loop (every 64 ticks, mirroring the playback stepper); on
  deadline it returns `unverifiable: 're-simulation wall-clock budget exceeded'`,
  never `divergent` (a slow run is not a dishonest one). The tick-count guard
  stays as a belt-and-suspenders bound. `verifyRunCore` caps re-sim at 30s, well
  under the smallest caller (post-accept) Function timeout.
- **Gap D — determinism-under-variable-pacing regression lock.** New
  `tests/unit/replay-determinism.test.ts` records the same autoNext run twice —
  once with uniform `update(SIM_STEP)`, once with a seeded jittered dt stream —
  and requires byte-identical kill frames, action/tick timeline (actionHash), and
  summary, locking the fixed-timestep accumulator invariant (`engine.ts:1662-1681`).
- Added a server-side tampered-**action** → `divergent` case to the callable
  emulator test (all three verdicts already proven server-side; this adds the
  action-rejection path alongside the existing summary/hash cases).
- **Ghost-run artifact explained (r_mr2q0g0p: wave 61 / kills 0 / 381 boss leak
  cores / 113s).** 113s is impossible for a real wave-61 freeplay run, and
  kills 0 with 381 leaks is a summary populated without the sim actually running
  — i.e., a viewer cosmetic reconstruction / desync, not a verified battle. It is
  prevented on two fronts now surfaced+tested: (1) the viewer no longer presents a
  reconstruction as the real run (Gap B label), and (2) the re-sim verify path
  reproduces the recorded actions and flags any such summary as `divergent`/
  `unverifiable` (tampered-summary, impossible-action, and a **named regression
  anchored to the exact ghost shape** — wave 61 / kills 0 / 381 leaks / 113s —
  in `reSimulate.test.ts`, plus the server action-rejection case in
  `callables-emulator.test.ts`); it can no longer hang on a dense run (Gap C). No
  valid late-wave freeplay data existed to re-balance from — re-collect after this
  lands, per `docs/plans/BALANCE-2026-07-18.md`.

## 2026-07-18 - Unblock lane planning updates

- Marked roadmap lane status for all five landed unblock deliveries from
  `docs/plans/`:
  - `g1-assets-incoming-intake`: plan landed at `docs/plans/unblock-g1-assets-incoming-intake-for-signal-ski-20260718/`; implementation dispatch pending.
  - `g1-publish-skin-concept-constraints`: item fully executed and marked done in `docs/roadmap.md`.
  - `victory-defeat-flourishes`: plan landed at `docs/plans/unblock-victory-defeat-flourishes-purchasable-en-20260718/`; implementation dispatch pending.
  - `seasonal-cosmetic-track`: plan landed at `docs/plans/unblock-seasonal-cosmetic-track-recovered-signal-20260718/`; implementation dispatch pending.
  - `custom-map-format-local-editor`: plan landed at `docs/plans/unblock-custom-map-format-local-editor-foundatio-20260718/`; implementation dispatch pending.

## 2026-07-11 - Mount the Signal Skin and Map Theme pickers

- Wired `SignalSkinPicker` and `MapThemePicker` (built 2026-07-10 but never
  mounted) into the Operations Board as SIGNAL SKINS and MAP THEMES shop
  sections alongside the existing Signal Palettes, so players can now buy and
  equip them with Salvage in-game. Viewer-side only; no sim/score/replay
  paths touched.

## 2026-06-28 - Audit backlog implementation pass

- Removed the visible owned-palette equip status while preserving purchase and
  insufficient-salvage feedback.
- Added Operations Board palette regression tests.
- Wired current-player leaderboard row highlighting and included replay score
  tokens in `/privacy` local export/delete.
- Added the active multi-agent audit backlog to `roadmap.md`, `idea_backlog.md`,
  and `decision_log.md`.

## 2026-06-28 - Source-of-truth documentation audit

- Added `docs/decision_log.md` for replay, score, freeplay, privacy, AI, meta,
  and accessibility decisions.
- Updated `README.md`, `architecture.md`, `tech_spec.md`, and `roadmap.md` to
  match current source behavior.
- Reconciled the current branch timeline from recent commits after the prior
  documentation audit.

## 2026-06-28 - Recent branch timeline

| Commit | Theme | Documentation impact |
| --- | --- | --- |
| `8a2a214` | Design tokens, AA contrast, global focus-visible ring | Accessibility baseline is now a shipped platform feature, not only a roadmap item. |
| `932fdfe` | Replay fidelity | Public Battle Plan replays include richer event data/chunks; replay docs must stay compact and Firestore-safe. |
| `8290fbb` | AI-rival modal layout | Bot-rival ghosts are polished user-facing telemetry, including modal comparison views. |
| `4a04390` | Server time for score ordering | Leaderboards order by server-written timestamps; client time is retained only as metadata. |
| `d46caa7` | Deploy verification gates | Release docs should mention Node/Java/Firebase preflight and CI guardrails. |
| `dd890bb` | AI helper privacy flow | AI help docs must describe compact gameplay context, optional Worker endpoint, and privacy posture. |
| `52da266` | Deeper AI-rival comparisons | Rival docs should reference bundled profiles rather than one expert-only curve. |

## 2026-06-27 - Documentation audit

- Added `docs/architecture.md`, `docs/tech_spec.md`, `docs/roadmap.md`, `docs/changelog.md`.
- Renamed `docs/ROADMAP.md` to `docs/idea_backlog.md` (full 80-idea audit; status header updated).
- Consolidated root docs into `docs/`: `performance_audit.md`, `asset_provenance.md`.
- Updated `README.md`: 8 sectors, 19 towers, shipped features (Battle Plan, meta, ghosts, remote balance), docs index.

## 2026-06 - Feature buildout before the audit

- Battle Plan replay viewer and `?run=` deep links.
- Mission Dossier share cards.
- Warden Rank, Salvage, Operations Board, and Watch Streak.
- Remote balance config via Firestore `config/balance`.
- Bot-rival ghost HUD and "out-warded the AI" result badge.
- Phase Anchor tower and broader tower roster additions.
- Server-side score gate through Cloud Functions.
- Admin telemetry/balance views and live balance canary.
- Accessibility settings, smart fast-forward, music packs, and unlock progress surfaces.

## 2026-06-17 - Performance audit

See [performance_audit.md](./performance_audit.md). Engine stress passed under
the update budget on all eight maps; the main bundle remained the primary
deferred performance risk.
