# QA Audit Scaffold

Last updated: 2026-07-01

This audit is a screenshot scaffold for the current screen inventory. The Playwright spec at `tests/e2e/qa-screens.spec.ts` captures named screenshots into `test-results/qa/<playwright-project>/` with explicit `page.screenshot()` calls. It does not change the global Playwright screenshot policy.

## Viewports

| Viewport | Playwright project | Approximate size | Artifact directory |
| --- | --- | --- | --- |
| Desktop | `chromium-desktop` | 1440 x 900 | `test-results/qa/chromium-desktop/` |
| Mobile | `chromium-mobile` | Pixel 5 profile | `test-results/qa/chromium-mobile/` |
| Short landscape | run-once viewport override | 844 x 390 | `test-results/qa/short-landscape/` |

## Acceptance Criteria

| Criterion | Status |
| --- | --- |
| Automated rows have explicit screenshot artifacts in `test-results/qa/` for every applicable viewport. | READY |
| Screenshots are produced by the QA spec itself, not by changing Playwright's global screenshot config. | READY |
| External Firestore reads are isolated from live data; live-data rows are marked deferred instead of passed. | READY |
| Write-path coverage uses anonymous auth and callable mocks. | READY |
| Rows that cannot be truly verified locally are marked `DEFERRED` or `NEEDS MANUAL` with a reason. | READY |

## Inventory

| ID | Screen / state | Route or entry | Desktop | Mobile | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | Age gate entry | `/` with empty local storage | `01-age-gate-entry.png` | `01-age-gate-entry.png` | AUTOMATED | Verifies the blocking entry dialog only. |
| 02 | Deploy menu | `/?demo=1` with seeded local state | `02-deploy-menu.png` | `02-deploy-menu.png` | AUTOMATED | Demo mode exposes the full sector/protocol inventory deterministically. |
| 03 | Leaderboard tab shell | Menu `LEADERBOARD` tab | `03-leaderboard-tab-shell.png` | `03-leaderboard-tab-shell.png` | AUTOMATED SHELL | Firestore reads are blocked, so live rows/replay links are not verified. |
| 04 | Operations board | Menu `OPERATIONS` tab | `04-operations-board.png` | `04-operations-board.png` | AUTOMATED | Uses seeded local progress/meta only. |
| 05 | How to play modal | Menu `?` control | `05-how-to-play-modal.png` | `05-how-to-play-modal.png` | AUTOMATED | Modal visibility and layout shell. |
| 06 | Settings modal | Menu settings control | `06-settings-modal.png` | `06-settings-modal.png` | AUTOMATED | Modal visibility and layout shell. |
| 07 | Bestiary modal | Menu bestiary control | `07-bestiary-modal.png` | `07-bestiary-modal.png` | AUTOMATED | Uses seeded enemy discovery. |
| 08 | Warden AI widget | Menu AI control | `08-ai-help-widget.png` | `08-ai-help-widget.png` | AUTOMATED SHELL | Does not send an AI request. |
| 09 | Feedback compose | Menu message control | `09-feedback-compose.png` | `09-feedback-compose.png` | AUTOMATED | Adult consent fixture. |
| 10 | Feedback submitted | Mocked feedback callable | `10-feedback-submitted.png` | `10-feedback-submitted.png` | AUTOMATED | Uses `mockAnonAuth` plus callable mocks. |
| 11 | Privacy route | `/privacy` | `11-privacy-route.png` | `11-privacy-route.png` | AUTOMATED | Static route shell and controls. |
| 12 | Admin login shell | `/admin` | `12-admin-login-shell.png` | `12-admin-login-shell.png` | AUTOMATED SHELL | Authenticated dashboard is not verified. |
| 13 | Game briefing overlay | Campaign deploy | `13-game-briefing-overlay.png` | `13-game-briefing-overlay.png` | AUTOMATED | Uses adult consent and seeded progress. |
| 14 | Game board HUD | Acknowledged campaign briefing | `14-game-board-hud.png` | `14-game-board-hud.png` | AUTOMATED | Captures canvas, topbar, arsenal, and utility dock. |
| 15 | Portrait rotate guidance | Mobile campaign game | N/A | `15-game-portrait-rotate.png` | AUTOMATED MOBILE | Mobile-only state; desktop has no corresponding overlay. |
| 15b | Short-landscape game layout | 844 x 390 viewport override | N/A | `short-landscape/15b-short-landscape-game.png` | AUTOMATED SHORT | Verifies game layout in the required short-landscape viewport without expanding every Playwright project. |
| 16 | After-action report shell | Demo game with dev-state terminal phase | `16-after-action-report.png` | `16-after-action-report.png` | AUTOMATED SHELL | Does not submit score or generate a dossier. |
| 17 | Replay unavailable shell | `/?run=r_qaunavailable01` | `17-replay-unavailable-route.png` | `17-replay-unavailable-route.png` | AUTOMATED SHELL | Verifies the route/error shell with Firestore blocked. |
| 18 | Loaded replay viewer | `/?run=<live run id>` | DEFERRED | DEFERRED | DEFERRED | Needs a valid replay document or a purpose-built Firestore fixture. |
| 19 | Authenticated admin dashboard | `/admin` after Google auth | NEEDS MANUAL | NEEDS MANUAL | NEEDS MANUAL | Requires an allowlisted Google account and live Firestore reads. |
| 20 | Score submit success and dossier share | Terminal eligible run | NEEDS MANUAL | NEEDS MANUAL | NEEDS MANUAL | Needs either a deterministic full terminal run with replay upload mocks or manual live validation. |
| 21 | Live leaderboard rows and watch links | Menu leaderboard with production data | DEFERRED | DEFERRED | DEFERRED | Current automation only proves the tab shell under blocked Firebase reads. |

## Current Status

The QA screenshot scaffold is implemented and was verified on 2026-07-01.

Focused checks run:

```sh
npm.cmd run typecheck:all
node .\tests\e2e\run-playwright.mjs tests/e2e/qa-screens.spec.ts
```

Results: typecheck passed; Playwright passed 2/2 projects. The run produced 16 desktop screenshots and 17 mobile screenshots, with the extra mobile artifact covering the portrait rotate guidance.

Run the focused spec with:

```sh
node ./tests/e2e/run-playwright.mjs tests/e2e/qa-screens.spec.ts
```

Expected output artifacts are under `test-results/qa/`. The generated screenshots are intentionally ignored by git through the existing `test-results/` rule.
