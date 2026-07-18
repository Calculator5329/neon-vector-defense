# DISPATCH — HQ Core Customization (Slice A, executable)

Follow-up implementation task derived from [`DESIGN.md`](./DESIGN.md). This is
the full **visible feature**, needs **no** server / schema / firestore.rules
change, and is agent-executable end-to-end. Slice B (runner-id-in-replay) is a
separate card-gated task, specified at the bottom.

---

## Task spec

- **title:** `Implement HQ core customization — player-chosen core visual (Slice A)`
- **owns:**
  - `src/game/coreCosmetics.ts` (new)
  - `src/ui/CoreStylePicker.tsx` (new)
  - `src/game/meta.ts` (add `core` equip slot + `equippedCore` getter)
  - `src/game/render.ts` (add `drawCore`; call from `drawMarkers` for the exit)
  - the cosmetics-surface component that mounts the other pickers
    (grep the render site of `SignalSkinPicker` — currently
    `src/OperationsBoard.tsx`) to mount `CoreStylePicker`
  - `tests/unit/core-cosmetics.test.ts` (new)
  - optional: `tests/e2e/qa-screens.spec.ts` (extend with core-picker asserts)
- **test-cmd:** `npm run typecheck:all && npm run test:jest`
  (and `npm test` for the e2e slice if the picker assertions are added)
- **model tier:** smart
- **est. cap:** ~$25 (complex multi-file, cosmetic only)

## Goal

Add a player-chosen HQ core cosmetic — shape shader + idle animation + death
effect — selectable from a Salvage-priced registry, following the existing
Signal-Skins / map-theme cosmetic pattern exactly. Rendered at the path exit
(`map.path[last]`, the "core" enemies leak into). **Cosmetic/display only** — no
simulation, score, tower, bot, or replay-hash path may import or read it.

## Implementation steps

1. **`src/game/coreCosmetics.ts`** — registry per DESIGN §4:
   `CoreShape`/`CoreIdle`/`CoreDeath` unions, `CoreStyle`, `CORE_STYLES`
   (`standard` cost 0 + ≥3 paid), `coreStyleById`, `ownsCoreStyle`
   (`s.cost === 0 || meta.owns('core-'+s.id)`), `displayedCoreStyle(id =
   meta.equippedCore)`. Lead with the "viewer/display paint only — never read by
   sim/score/replay-hash" header comment copied from `cosmeticSets.ts`.

2. **`src/game/meta.ts`** — add getter beside `equippedSignalSkin` (meta.ts:344):
   `get equippedCore(): string { return cache.cosmeticEquipped['core'] ?? 'standard'; }`.
   No other meta change (equip/owns/recordServerEntitlement already generic).

3. **`src/game/render.ts`** — `drawCore(ctx, style, p, time, game)`:
   - `switch (style.shape)` — small canvas-path silhouettes (idiom of the
     `drawTowerBody` per-style switch, render.ts:1099+); reuse `circle`, `poly`,
     `path`, `withAlpha`, `shade`. Clamp position exactly like `marker()`
     (render.ts:916-917).
   - `switch (style.idle)` off `time`; gate motion on `reducedMotion`
     (render.ts:26).
   - death effect: scale a burst by `game.hurtFlash` (spikes per leak,
     engine.ts:1930) and a one-shot implosion on `game.phase === 'gameover'`.
     Additive, no `shadowBlur` in the loop.
   - Keep exit legibility (retain/`OUT` label or equivalent).
   Wire `drawMarkers(ctx, map, time, game?)` to call `drawCore` for the exit
   when `game` is passed (render.ts:512 passes `game.time`; thread `game`), and
   keep the plain `OUT` `marker()` for the background/preview path so
   `buildBackground` and previews still work without a `game`.
   `runnerCoreId(game)` returns `meta.equippedCore` for Slice A.

4. **`src/ui/CoreStylePicker.tsx`** — clone `SignalSkinPicker.tsx` with slot
   `'core'`, entitlement id `core-<id>`, `data-testid="core-style-picker"` and
   `core-style-<id>` buttons, `ownsCoreStyle`, `purchaseEntitlement('core-'+id)`
   → `meta.recordServerEntitlement`, `meta.equip('core', id)`. Swatch = the
   style's `glow`/`color` (or a mini `drawCore` on a small canvas).

5. **Mount** `CoreStylePicker` next to `SignalSkinPicker`/`MapThemePicker` on the
   cosmetics surface under a "Core" heading.

6. **Tests** — `tests/unit/core-cosmetics.test.ts` per DESIGN §8 (registry
   integrity, ownership/equip round-trip + fallback, guardrail import-scan,
   `actionHash` invariance). Extend the e2e cosmetics screen test if cheap.

## Guardrails (verification will check)

- `coreCosmetics.ts` / `CoreStylePicker.tsx` imported by **render + UI only** —
  never `engine.ts`, `towers.ts`, `bot.ts`, `waves.ts`, or the score/replay-hash
  modules.
- No change to lives/`coresLeft`/`startingCores`, cash, or unlock thresholds.
- `actionHash` output identical with any core id (locked by a test).
- Reduced-motion honored; no per-frame `shadowBlur` added to the hot path.

## Definition of done

All DESIGN §9 acceptance boxes checked; `npm run typecheck:all` +
`npm run test:jest` green; `npm test` e2e green; a screenshot/GIF of three
distinct cores (idle + a leak death effect) attached to the run evidence.

---

## Deferred / gated follow-on — Slice B (runner id in replays)

**Do NOT bundle into Slice A.** Needs an Ethan card (public-surface schema /
firestore.rules change). Ready-to-queue card content:

> **[ETHAN] Card — HQ core: show the runner's core in replays.**
> Adds `coreStyle?: string` (≤40 chars) to `PublicRunDoc['summary']`
> (`runTelemetry.ts:156`), written from `meta.equippedCore` at run finish, and
> extends the `firestore.rules` `isRunSummary` `hasAll`/`hasOnly` allowlist
> (`firestore.rules:245-246`) to permit it. Display-only: `actionHash` hashes
> only action packs, so verification verdicts are provably unaffected
> (`reSimulate` compares only `actionHash` + `chunkEventCounts`). `ReplayViewer`
> then resolves `runnerCoreId` from `run.summary.coreStyle` (fallback
> `standard`). **Gate:** firestore.rules schema change → deploy of updated
> rules is Ethan-only. Ask before implementing.

- **owns (when approved):** `src/game/runTelemetry.ts`, `firestore.rules`,
  `src/ReplayViewer.tsx`, `tests/unit/reSimulate.test.ts` (assert verdict
  unaffected by `coreStyle`).
- **test-cmd:** `npm run typecheck:all && npm run test:jest && npm run test:security`
