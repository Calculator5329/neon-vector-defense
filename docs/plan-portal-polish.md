# Portal Polish Plan

Tactical launch-polish checklist grounded in the current code. For the broader
source-of-truth status, see [roadmap.md](./roadmap.md); for historical ideation,
see [idea_backlog.md](./idea_backlog.md).

Updated: 2026-07-03.

## Status

- [x] Bestiary codex and first-hostile reveal.
- [x] Damage-type resistance matrix: soft resistances and energy counterplay are
  present in source/tests.
- [x] Replay-of-the-Day spotlight: menu card and `replaySpotlight.ts` shipped.
- [x] Balance CI gate: semantic `public/balance-report.json` diff in CI.
- [x] Responsive touch layout: short-landscape command surface is live and
  covered by QA.
- [x] Guided first build: action-gated coach replaced the static tutorial wall.
- [ ] Remaining portal work is ops and polish: external account submission,
  screenshots/store copy, and additional mid-band viewport QA.

## Balance CI Gate

Shipped. `npm run balance:gate` writes a quick report under `test-results/` and
compares it against committed `public/balance-report.json` with
`scripts/balance-check.ts`. Intentional tuning still updates the committed
baseline with `npm run balance`.

## Damage Resistance Follow-Up

The first implementation is shipped. Remaining work is tuning:

- Re-run `npm run balance` after any resistance, tower, or enemy stat change.
- Watch energy/arc tower dominance in both bot reports and admin analytics.
- Keep shred semantics explicit in tests: shred bypasses soft resistance.
- Update `tower-balance-deep-dive.md` only when a new broad report is generated.

## Replay-of-the-Day Follow-Up

The menu spotlight is shipped and uses public leaderboard rows with `runId`.

Open decisions:

- If the spotlight must be identical for every player all day, pin a daily
  Firestore spotlight document rather than deriving from a mutable leaderboard.
- Add admin observability for watch attempts and failed replay loads if this
  becomes a major acquisition surface.

## Responsive Touch Layout

Already present:

- Mobile/portrait rotate guidance.
- Touch mapping through the canvas letterbox transform.
- Two-step touch placement preview.
- Many responsive CSS breakpoints and safe-area-aware controls.

Remaining work:

- Replace the desktop sidebar with a bottom-dock arsenal on small landscape
  screens.
- Convert upgrade/details into a bottom sheet with stable touch targets.
- Increase select/upgrade radii under coarse pointers.
- Reflow ability buttons and wave controls so they do not collide with the
  canvas or safe areas.
- Add optional haptics behind settings.

## Guided First Build

Shipped. The in-run coach advances on real actions: first placement, first wave
launch, and first upgrade. The full How To Play reference remains available
from the menu.

## Remaining Portal Polish

- Run dedicated QA at 560-820 px and 981-1024 px widths in addition to the
  short-landscape tier.
- Revisit bottom-dock arsenal and bottom-sheet upgrades if portal iframe tests
  show repeated touch friction.
- Consider optional haptics behind settings after core submission work.
