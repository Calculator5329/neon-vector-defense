# Portal-polish plan

Four launch-polish workstreams, grounded in the current code. Tracks the work
agreed 2026-06-27. For the broader backlog see [idea_backlog.md](./idea_backlog.md)
and [roadmap.md](./roadmap.md).

Build order: commit Bestiary → balance CI gate + resistance matrix (parallel) →
Replay-of-the-Day → responsive touch layout.

## Status

- [x] Commit the finished Bestiary codex (base for the rest)
- [ ] **#3 Balance CI gate** — `npm run balance` + semantic baseline diff in CI
- [ ] **#2 Damage-type resistance matrix** — soften binary immunity, add an energy counter
- [ ] **#4 Replay-of-the-Day spotlight** — deterministic daily pick + menu card
- [ ] **#1 Responsive touch layout** — complete the mobile/touch surface

---

## #3 Balance CI gate (S)

Prerequisites already met: `public/balance-report.json` is committed + tracked
([scripts/balance.ts:40](../scripts/balance.ts)); the harness is deterministic
(waves hardcoded, `Math.random` only cosmetic). Verdicts to gate on: per-upgrade
`flag: 'dead'|'weak'|'ok'|'strong'|'op'` ([efficiency.ts:252](../scripts/balance/efficiency.ts))
and grid `winRate`/`avgWave`.

- New `scripts/balance-check.ts`: regenerate the report, compare to committed
  baseline **ignoring `generatedAt`**. Fail on `dead↔op` flag flips and grid
  `winRate` swings > 15% (or `avgWave` beyond tolerance); warn on `strong↔ok`.
- `package.json`: `balance:check` script. `ci.yml`: `npm run balance` then
  `npm run balance:check` after the existing `sim -- quick` step.
- Workflow: intentional tuning PRs re-commit the baseline; the gate catches
  *unintentional* drift.

## #2 Damage-type resistance matrix (code S, balance M)

Binary immunity lives at [engine.ts:891-893](../src/game/engine.ts) (`return 0`).
**Key finding: no `immuneEnergy` exists — nothing counters energy**, which is why
the expert bot stacks it. Softening the other three alone won't fix that.

- Mechanic: replace the three `return 0`s with a multiplier (armored → kinetic
  ×0.35, etc.). Prefer a generic `resist?: Partial<Record<DamageType, number>>`
  on `EnemyDef` over more booleans.
- Data: add an energy-resistant archetype so energy has a real counter.
- Decide `shred` semantics (today fully bypasses immunity, [engine.ts:891](../src/game/engine.ts)).
- Update tests asserting `=== 0` ([game-correctness.test.ts:36](../tests/unit/game-correctness.test.ts)).
- Acceptance: `npm run balance` no longer flags energy dominant (validate via #3).

## #4 Replay-of-the-Day spotlight (S)

Mostly exists: `fetchGlobalTop` rows carry `runId`
([leaderboard.ts:751](../src/game/leaderboard.ts)); `?run=` route + `ReplayViewer`
+ `▶ WATCH` anchor already shipped ([App.tsx:817](../src/App.tsx)); daily hash in
[freeplay.ts:155/317](../src/game/freeplay.ts); `recordReplayWatch` fires on viewer
mount ([metrics.ts:183](../src/game/metrics.ts)).

- Selector: filter `fetchGlobalTop` to rows with valid `runId`, pick the
  highest-wave Apex+ run (near-stable intraday; avoids the `hash % rows.length`
  drift as the board mutates). True cross-player-identical picks would need a
  daily Firestore doc — deferred.
- Menu card on the DEPLOY tab above the Daily Freeplay card (~[App.tsx:717](../src/App.tsx)),
  styled like `daily-freeplay-card`, `▶ WATCH` → `/?run=<id>`.

## #1 Responsive touch layout (L — completion, not greenfield)

Already present: 15+ `@media` queries incl. a 980px mobile breakpoint
([App.css:2068](../src/App.css)); `onTouchStart/Move` + `toCanvas()` letterbox
mapping ([App.tsx:1191/1489](../src/App.tsx)); mobile viewport meta
([index.html:8](../index.html)). Genuine gaps:

- **Orientation**: landscape-primary + a "rotate device" overlay in portrait on
  small screens (don't build a separate portrait layout).
- **Touch placement**: two-step on touch (tap previews ghost+range, second tap
  confirms) instead of one-tap-commits ([App.tsx:1209](../src/App.tsx)).
- **Hit targets**: scale select/upgrade radius up under `@media (pointer:coarse)`
  ([App.tsx:1225](../src/App.tsx)).
- **Bottom-dock arsenal** + upgrade bottom-sheet replacing the stacked 392px
  sidebar on small screens ([App.tsx:1619](../src/App.tsx)).
- **Bottom controls**: reflow ability bar + wave button so they don't collide;
  honor safe-area insets.
- **Haptics**: `navigator.vibrate` on place/upgrade/leak behind a settings flag.
