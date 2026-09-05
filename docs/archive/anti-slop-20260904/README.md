# Anti-slop cleanup and repairs — 2026-09-04

Ethan authorized cleanup and subsequent repairs in this named project for this
work block; `docs/intent.md` records scope and review corrections. The retained
lane is `anti-slop-nvd-20260904`. Verification below covers the reviewed lane;
Git history records canonical integration.

## Repaired and verified

- Removed unused aliases and redundant assertions; retained useful checks.
- Corrected map/funding/survival fixtures while preserving their assertions.
- Fixed late replay actions by retaining the recorder's integer tick boundary.
  No combat, map, action codec, or replay-version change.
- Matched the weekly beacon to its real slot; preserved the portrait unlock;
  fixed scrollable layout sizing and narrow protocol text.
- Routed palette purchases through the existing server grant path, preserving
  ownership on rejection. Demo load and purchase stop before auth/network writes.
- Corrected stale browser state/label assumptions and URL-query-sensitive mocks.

| Check | Evidence |
| --- | --- |
| Engine: 139 passed, no failures/skips | [engine-final.log](engine-final.log) |
| Replay: three seeds, honest + tampered + bounded | [replay-final.log](replay-final.log) |
| Meta isolation: all checks passed | [meta-final.log](meta-final.log) |
| Security: 82 passed, no failures/skips | [security-verification.log](security-verification.log) |
| Earlier focused menu checks: 8 passed, 2 desktop-only skips | [browser-focused.log](browser-focused.log) |
| Final browser: 81 passed, 27 platform/preview skips | [browser-final.log](browser-final.log) |
| Final application build: passed | [build-final.log](build-final.log) |
| Final layout/unlock: 4 passed | [layout-final.log](layout-final.log) |

Root ran the exact `npm run test:security` after `npm run check:deploy-env` passed
using Java 21 at `/home/ethan/.local/share/PrismLauncher/java/java-runtime-delta/bin`.
Its 82 tests comprise 35 rules, 9 Worker, 16 Functions, and 22 callable checks.
Host Node 24 produced the existing Functions Node 22 engine warning; no deployment
or production Firebase change was performed. Security log SHA-256:
`54f2f2618cd13aad17f33e82301929059b76d2c4bb1b1bd46af7324f8acc215d`.

## Visual review

[Short-landscape dock](weekly-dock.png) shows the dwarf in its rail, clear of the
dock controls. [Portrait unlocked dock](portrait-unlocked-dock.png) follows an
actual visible dwarf click and shows the focused YAKKOB slot. Final Recruit-card
baselines live under `tests/e2e/menu-recommended-pill.spec.ts-snapshots/`; the
mobile image keeps the name intact above its description. Root reviewed these
images. The original dock baselines and intermediate card images are retained
here. Geometric pill/name/description checks remain active on both platforms.

## Deliberately retained

Potential future retirement: unused consent subscriptions and client source
string policing tests, after equivalent real caller behavior checks exist.
Server emulator checks alone do not prove correct client append-only calls.
No production asset or gameplay feature was retired in this pass. Standing
owner-only deployment and broader fence decisions remain outside this cleanup.

## Earlier evidence

`initial-handoff.md.txt`, `e2e.log`, `engine-before-fixture-repairs.log`,
`engine-after-fixture-repairs.log`, and `replay-base.log` preserve the original
red baseline and diagnosis. They describe earlier states, not the final result.
Source/test `.txt` files and nested source archives preserve original bytes.
