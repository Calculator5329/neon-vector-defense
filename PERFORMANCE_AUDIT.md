# Performance And Live Metrics Audit

Date: 2026-06-17

## Measured Baselines

Required verification:

| Command | Result | Notes |
| --- | --- | --- |
| `npm.cmd run build` | Pass | Vite still warns that the main JS chunk is larger than 500 kB. |
| `npm.cmd test` | Pass | 15 passed, 5 expected skips across desktop/mobile Playwright projects. |
| `npm.cmd run perf` | Pass | All eight maps stayed far under an 8 ms average update budget. |
| `npm.cmd run perf:browser` | Pass | Throat/hard perf route recorded desktop and mobile render counters. |

Engine stress output from `npm.cmd run perf`:

| Map | End | Wave | Avg ms | P99 ms | Max ms | Peak hulls | Peak fx |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Orbital Relay | gameover | 66 | 0.03 | 0.19 | 1.5 | 240 | 350 |
| Twin Reactor | gameover | 65 | 0.03 | 0.16 | 1.1 | 251 | 351 |
| Hyperlane Junction | gameover | 66 | 0.03 | 0.19 | 1.8 | 343 | 354 |
| Mobius Drift | gameover | 68 | 0.03 | 0.14 | 3.5 | 291 | 346 |
| Blackout Reach | gameover | 61 | 0.03 | 0.13 | 1.5 | 284 | 347 |
| The Throat | gameover | 64 | 0.03 | 0.16 | 1.3 | 421 | 358 |
| Umbral Reach | gameover | 61 | 0.02 | 0.13 | 1.3 | 271 | 351 |
| Cinder Causeway | gameover | 64 | 0.03 | 0.15 | 1.0 | 456 | 367 |

Browser throat/hard pass from `npm.cmd run perf:browser`:

| View | Viewport | DPR | FPS avg | Long frames | Quality drops | Quality recoveries | Wave | Phase | Hulls | FX |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| Desktop | 1365x768 | 1 | 60 | 0 | 0 | 0 | 1 | wave | 5 | 0 |
| Mobile | 390x844 | 1 | 60 | 0 | 0 | 0 | 1 | wave | 4 | 0 |

## Changed Hotspots

- Live run checkpoints now write compact append-only chunks under `/runCheckpoints/{runId}/chunks/{chunkId}`. Flush points are wave end, 30 second live interval, terminal state, abort, freeplay bank, and visibility/page hide when the browser allows it.
- Score submit remains focused on public replay plus leaderboard score. Private analytics continue to flush live/final and get a final score-result merge.
- Per-tick allocation churn was reduced by replacing pickup expiry, spawn queue cleanup, and nova cleanup `.filter()` calls with in-place `compact`.
- Rift and rail candidate selection now uses spatial-grid scoped candidates instead of full enemy-array scans.
- Leaderboard reads are cached briefly per board/global mode and invalidated on score submit, reducing repeated multi-board reads while players move in and out of menus.
- Feedback reply polling is lazy: faster while the widget is open, slower in menu, and paused while actively in-game.
- PWA support now includes a conservative static-shell service worker, richer manifest metadata, and install/display-mode counters in private analytics.

## Deferred Risks

- The main bundle is still large. A later pass should code-split admin, AI/help, and freeplay-heavy UI so first load is smaller.
- Browser perf currently samples early throat/hard stress. A longer late-freeplay browser run would be useful once checkpoint writes are deployed and admin data starts showing real device pressure.
- Checkpoint writes use normal Firestore writes, so `pagehide` is best effort. A future sendBeacon or server endpoint could improve final background delivery.
- Service worker caching is intentionally conservative. Static app-shell caching should stay boring until telemetry confirms no stale-build confusion after deploys.
