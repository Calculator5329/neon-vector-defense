# Changelog

Running log of notable changes. Most recent first.

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
