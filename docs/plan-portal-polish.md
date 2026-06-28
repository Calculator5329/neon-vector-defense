# Portal Polish Plan

Tactical launch-polish checklist grounded in the current code. For the broader
source-of-truth status, see [roadmap.md](./roadmap.md); for historical ideation,
see [idea_backlog.md](./idea_backlog.md).

Updated: 2026-06-28.

## Status

- [x] Bestiary codex and first-hostile reveal.
- [x] Damage-type resistance matrix: soft resistances and energy counterplay are
  present in source/tests.
- [x] Replay-of-the-Day spotlight: menu card and `replaySpotlight.ts` shipped.
- [ ] Balance CI gate: semantic `public/balance-report.json` diff in CI.
- [ ] Responsive touch layout: finish the mobile command surface.
- [ ] Guided first build: replace static tutorial with action-gated coaching.

## Balance CI Gate

Prerequisites already exist:

- `public/balance-report.json` is committed demo/admin data.
- `npm run balance` regenerates the report.
- `scripts/balance/` produces tower verdicts, strategy grids, win rates, and
  average progress values.

Recommended implementation:

- Add a semantic balance check that ignores timestamps and generated metadata.
- Fail on dead/op verdict flips, large win-rate swings, and large average-wave
  regressions.
- Allow intentional tuning by committing an updated baseline in the same PR.
- Keep the gate separate from quick unit tests; balance sims are slower and are
  easier to reason about as a named CI step.

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

The static tutorial is still the weak onboarding surface.

Recommended sequence:

1. Pulse the first recommended tower.
2. Show a valid placement ghost/range.
3. Gate progression on first placement, first wave launch, and first upgrade.
4. Introduce cloak detection only when the first cloaked wave is relevant.
5. Stop showing guidance once the player has demonstrated the action.
