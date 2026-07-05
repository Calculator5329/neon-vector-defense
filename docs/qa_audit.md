# QA Audit

Last updated: 2026-07-05

## 2026-07-05 Sector Atlas Screen Inventory Note

The DEPLOY menu screenshot inventory now captures the Sector Atlas instead of
the former sector card grid. Existing menu-polish viewports remain the same
(`1920x930`, `1440x900`, `844x390`, and Pixel portrait), but assertions and
screens should evaluate atlas node hit targets, dock protocol rows, internal
portrait panning, and the Weekly Ops beacon/cards rather than the old grid.

## 2026-07-03 Replay v3 Launch-Gate Regression Audit

Scope: post-churn regression pass for the live replay v3 state from `.codex/shared-context.md`. Primary viewports were desktop `1440x900` and landscape-mobile `844x390`. The audit used real Playwright flows where churn risk was highest, including an actual game run, actual recorder output, score submission through the debrief UI, and replay viewing through `?run=`.

Artifacts refreshed under `test-results/qa/` by `tests/e2e/qa-screens.spec.ts`. The new real-flow regression coverage is in `tests/e2e/qa-regression.spec.ts`.

## Prioritized Findings

| severity (P0 blocks launch / P1 player-visible / P2 polish) | screen/flow | viewport | repro | proposed fix | status |
| --- | --- | --- | --- | --- | --- |
| P0 blocks launch | Launch blocker sweep | Desktop 1440x900 and landscape-mobile 844x390 | Ran the full gate plus screen inventory and real replay/debrief flows. No blank screen, uncaught exception, broken deploy, broken debrief submit, or broken replay viewer path was found. | None. | VERIFIED |
| P1 player-visible | Replay viewer speed controls | Desktop 1440x900 and landscape-mobile 844x390 | Open a real submitted v3 run via `?run=<runId>` and inspect playback speeds. The viewer had 1x and 2x but did not offer the required 4x control. | Add `4` to `REPLAY_SPEEDS` without changing other playback behavior. | FIXED in `src/ReplayViewer.tsx`; covered by `tests/e2e/qa-regression.spec.ts`. |
| P1 player-visible | Replay v3 round trip | Desktop 1440x900 and landscape-mobile 844x390 | Drive the app from menu to game, place a tower, launch a wave, force a terminal victory, submit the debrief, then open the returned `?run=` viewer. | No product fix required after the 4x control fix. Keep real recorder payload coverage. | VERIFIED. Test asserts schema v3, replay engine 3, 8-char hex `mapHash`, `r3` actions, complete manifest/hash, no `events`/`snapshots`/`deathRecords`, no `undefined`, frame-accurate viewer text, play/pause, 1x/2x/4x, deterministic seek, and no submit/view console errors. |
| P1 player-visible | Run-end debrief | Desktop 1440x900 and landscape-mobile 844x390 | Finish a real victory run and submit the score; separately finish a defeat, click Retry Sector, finish again, and click Main Menu. | No product fix required. | VERIFIED by `qa-regression.spec.ts`; stats preview renders Credits/Kills, submitted row shows the real callsign, Retry returns to a fresh build state, and Main Menu returns to deploy without overflow or console errors. |
| P1 player-visible | Replay-of-the-Day dead pinned run | Desktop 1440x900 and landscape-mobile 844x390 | Seed the spotlight card with a dead legacy/v2 run id and click Watch. | No product fix required. | VERIFIED. The menu remains usable, the viewer shows `REPLAY UNAVAILABLE`, and Return to the Grid restores the deploy menu. |
| P1 player-visible | Steepened unlocks and arsenal state | Desktop, mobile, and 844x390 short landscape | Inspect early-game arsenal and seeded unlocked states through the existing UX suites. | No product fix required. | VERIFIED by `ux-ui.spec.ts` and `qa-screens.spec.ts`: 21-tower arsenal renders, locked/unlocked gates hold, unlock curve guard passes, and short-landscape arsenal stays complete. |
| P1 player-visible | Tesla chain and targeted ability churn | Engine suite plus desktop/mobile e2e surfaces | Run the engine correctness suite and game UI coverage. | No product fix required. | VERIFIED by unit coverage for targeted strike requiring a target and no-oping after game over, plus Tesla chain not re-hitting already chained hulls. Full e2e still passes game controls and telemetry paths. |
| P1 player-visible | Daily Challenge, Veteran Deploy, wave preview, keyboard placement, leaderboard tabs, Operations, settings, bestiary, age gate, privacy | Desktop 1440x900, mobile project, and 844x390 menu/game captures | Run the screen inventory, UX suite, and UI-stability guards. | No product fix required. | VERIFIED. Daily starts as wave-one daily protocol, Veteran Deploy gates and spends projected credits, keyboard placement works, leaderboard and Operations tabs render, modals/routes render, and CLS guardrails pass. |
| P2 polish | QA screenshot scaffold console noise under blocked Firestore | Desktop and mobile scaffold rows only | `qa-screens.spec.ts` intentionally aborts Firestore reads for shell screenshots, which causes expected Firestore offline console noise in the runner output. | Optional harness improvement: module-stub read-only leaderboard/replay calls in the screenshot scaffold, matching the stricter regression spec. | DOCUMENTED. Not a product bug; `qa-regression.spec.ts` asserts no console errors on the real submit/view flows. |

## Validation Evidence

Focused QA:

```sh
node ./tests/e2e/run-playwright.mjs tests/e2e/qa-regression.spec.ts
node ./tests/e2e/run-playwright.mjs tests/e2e/qa-screens.spec.ts
```

Results: `qa-regression` 6 passed across desktop and landscape-mobile; `qa-screens` 5 passed / 1 expected skip.

Full gate:

| Command | Result |
| --- | --- |
| `npm.cmd run typecheck:all` | PASS |
| `npm.cmd run build` | PASS, existing Vite chunk-size warning only |
| `npm.cmd run test:jest` | PASS, 16 tests |
| `npm.cmd run test:engine` | PASS, 77 tests |
| `npm.cmd run test:worker` | PASS, 9 tests |
| `npm.cmd run test:rules` | PASS, 33 tests with Java 21 and workspace `XDG_CONFIG_HOME` after configstore EPERM |
| `npm.cmd --prefix functions ci` | PASS, existing 6 moderate npm audit advisories reported |
| `npm.cmd run test:functions` | PASS, 16 tests |
| `npm.cmd run test:callables` | PASS, 17 tests with Java 21 and workspace `XDG_CONFIG_HOME` |
| `npm.cmd test` | PASS, 62 passed / 24 skipped |
| `npm.cmd run test:e2e:prod` | PASS, 6 tests |
| `npm.cmd run perf:quick` | PASS, avg update 0.04 ms in quick stress output |
| `npm.cmd run meta:sim` | PASS |
| `npm.cmd run balance:gate` | PASS, no balance regressions |

Notes:

- PowerShell blocked `npm.ps1`, so validation used `npm.cmd`.
- Firebase Tools attempted to read the user-profile configstore during emulator suites; reruns used workspace-local `XDG_CONFIG_HOME` and `npm_config_cache` as requested.
- No deploy, no push, and no master ref write was performed.
