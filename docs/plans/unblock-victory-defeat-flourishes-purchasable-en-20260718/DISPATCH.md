# DISPATCH — Run-End Flourish v1 (implementation)

Follow-up task spec for [`DESIGN.md`](./DESIGN.md). This roadmap item requires
source changes; this design lane's lease covered **docs only**, so the
implementation is dispatched separately here.

> **Fence note:** if the manifest fences this repo `agents: docs-only`, this
> code task needs an Ethan fence promotion (or an explicitly approved code lane)
> before dispatch. The design and this spec are complete and unblocked
> regardless.

---

## title

`feat(cosmetics): Run-End Flourish v1 — purchasable victory/defeat effects`

## goal

Implement purchasable end-of-run flourishes exactly as specified in
`docs/plans/unblock-victory-defeat-flourishes-purchasable-en-20260718/DESIGN.md`:
a cosmetic-only, viewer-side particle-burst + banner-entrance effect on the
victory/defeat result overlay, sold through the **existing** Salvage entitlement
flow, with **zero** gameplay/score/replay deltas per the roadmap Guardrails.

Deliver:

1. **`src/game/flourishes.ts`** (new, client-side, cosmetic-only). Header comment
   mirroring `src/game/cosmeticSets.ts`'s guardrail banner (imported by nothing
   in engine/towers/bot/score/replay). Exports:
   - types `BurstStyle` (`'spark'|'confetti'|'shard'|'nova'`), `BannerStyle`
     (`'fade'|'cascade'|'glitch'|'nova'`), interface `Flourish`
     (`id, name, cost, burst, banner, accent?`);
   - `FLOURISHES: Flourish[]` — exactly the four tiers in the design
     (`standard` cost 0, `cascade` 400, `glitch` 550, `nova` 800);
   - `flourishById(id)` (find `?? FLOURISHES[0]`), `ownsFlourish(f)`
     (`cost===0 || meta.owns('flourish-'+f.id)`), `displayedFlourish(id = meta.equippedFlourish)`.
   Model the file 1:1 on `cosmeticSets.ts` (same import of `./meta`, same shape).
2. **`src/game/meta.ts`** — add one getter mirroring `equippedSignalSkin`
   (`meta.ts:344`):
   `get equippedFlourish(): string { return cache.cosmeticEquipped['flourish'] ?? 'standard'; }`.
   No other meta change (`equip`/`recordServerEntitlement` already generalize).
3. **`src/game-ui/RunEndFlourish.tsx`** (new) — a self-contained component
   `RunEndFlourish({ outcome: 'victory'|'gameover'; color: string; runId: string })`:
   - resolves `displayedFlourish()`; renders an `aria-hidden` `<canvas>` sized to
     its container; a single `requestAnimationFrame` loop emits the `burst`
     particle field tinted from `color` (+ optional `accent`), runs ≤1.5 s, then
     stops and clears; cleans up RAF on unmount; re-fires only when `runId`
     changes;
   - **no `Math.random` for anything that must stay deterministic-looking** — use
     a fixed per-particle-index spread (lint-clean, replay-irrelevant anyway);
   - under `window.matchMedia('(prefers-reduced-motion: reduce)').matches`, paints
     **one static frame** and no loop;
   - applies the banner class name (`flourish-banner-<banner>`) — either wrapping
     the title or exposing the class for the overlay to add.
4. **`src/game-ui/GameScreen.tsx`** — mount `<RunEndFlourish outcome color runId>`
   inside the result `Overlay`'s `.result-hero` for both terminal branches
   (`GameScreen.tsx:1459` gameover, `:1507` victory). Pass the same `color`
   already given to `Overlay` and `game.runId`. Add the banner class to the
   overlay title. **Do not** change overlay dismissal/focus behavior or any
   run/score/reward logic.
5. **`src/App.css`** — add the four `@keyframes` + `.flourish-banner-{fade,cascade,glitch,nova}`
   classes and any canvas positioning (`.result-hero` needs `position: relative`;
   canvas absolutely positioned, `pointer-events: none`, behind text). Wrap all
   motion in `@media (prefers-reduced-motion: no-preference)` (or guard the loop
   in JS, per item 3) so reduced-motion users get the static variant.
6. **`src/ui/FlourishPicker.tsx`** (new) — clone `src/ui/SignalSkinPicker.tsx`:
   subscribe to entitlements, buy-if-unowned (`purchaseEntitlement('flourish-'+id)`
   → `meta.recordServerEntitlement`) then `meta.equip('flourish', id)`;
   affordability + ownership `aria-label` states; `data-testid="flourish-picker"`
   and `data-testid="flourish-<id>"`. Include a "Preview" control that mounts
   `RunEndFlourish` in a small stage (victory tint) so buyers see it.
7. **`src/OperationsBoard.tsx`** — render `<FlourishPicker />` in the cosmetics
   area next to the Signal Skin picker (match the existing section/heading
   pattern used for `SignalSkinPicker`).
8. **`functions/src/entitlementHelpers.ts`** — add to `COSMETIC_PRICES`:
   `'flourish-cascade': 400, 'flourish-glitch': 550, 'flourish-nova': 800`
   (the free `standard` has no key — never purchasable).
9. **`scripts/meta-sim.ts`** — extend the isolation check (`meta-sim.ts:58-63`) to
   also assert `engine.ts`/`towers.ts`/`bot.ts` do **not** import `./flourishes`
   (add a `!/from ['"]\.\/flourishes['"]/.test(src)` assertion alongside the meta
   one).
10. **Tests:**
    - `tests/unit/flourishes.test.ts` (`node:test` via `tsx --test`, modeled on
      an existing `tests/unit/*.test.ts` cosmetic/registry test): `flourishById`
      unknown-id fallback → `standard`; `FLOURISHES[0].cost === 0`;
      `ownsFlourish(standard) === true` without entitlement; each non-free id has
      a matching `flourish-<id>` and the ids are unique; `displayedFlourish()`
      reflects `meta.equip('flourish', id)`.
    - Extend a `tests/functions/*` catalog test to assert every non-free flourish
      id is a known `COSMETIC_PRICES` key (pattern:
      `tests/functions/aggregate-helpers.test.ts`), and that `flourish-standard`
      is **absent** (earned-free, never sold).

### Hard constraints (verification-failing if violated)

- `flourishes.ts` imported by **nothing** in `engine.ts`, `towers.ts`, `bot.ts`,
  or the score/replay path (enforced by the extended `meta-sim.ts` check).
- No change to tower/enemy stats, score math, bot plans, or unlock thresholds.
- No new run/replay fields; no schema/`actionHash` change; the flourish renders
  viewer-side only and replay playback uses the **viewer's** equipped flourish.
- No new `localStorage` key — equip rides the existing `nvd-meta-v2` blob, so
  **no `PrivacyView` change**.
- `prefers-reduced-motion` honored (static, non-animated variant).
- Overlay stays a keyboard decision screen: canvas `aria-hidden`,
  `pointer-events: none`, no focus trap, no dismissal/backdrop-behavior change.
- Deploys / `firebase` / `npm publish` remain Ethan-only — do not run them.

## owns

```
src/game/flourishes.ts                 # new registry (cosmetic-only)
src/game/meta.ts                       # add equippedFlourish getter only
src/game-ui/RunEndFlourish.tsx         # new burst + banner renderer
src/game-ui/GameScreen.tsx             # mount flourish in result Overlay
src/App.css                            # banner keyframes + canvas positioning
src/ui/FlourishPicker.tsx              # new picker (clone of SignalSkinPicker)
src/OperationsBoard.tsx                # slot the picker into cosmetics area
functions/src/entitlementHelpers.ts    # add flourish-* to COSMETIC_PRICES
scripts/meta-sim.ts                    # extend isolation check to flourishes.ts
tests/unit/flourishes.test.ts          # new
tests/functions/aggregate-helpers.test.ts   # extend catalog assertion (or sibling)
```

## test-cmd

```sh
npm run test:engine
```

Also run before hand-off:
- `npm run meta:sim` — the guardrail isolation check (must show flourishes off
  the engine/score/bot path).
- `npm run test:functions` — `COSMETIC_PRICES` changed.
- `npm test` — the Playwright e2e gate (full verify).

## acceptance

- `npm run test:engine` passes the new flourish registry tests.
- `npm run meta:sim` confirms `flourishes.ts` is off the engine/score/bot path.
- Manually (or via the `run` skill): the Operations Board shows a Flourish picker
  next to Signal Skins; an unowned flourish buys with Salvage and equips; the
  preview plays. Winning a run plays the equipped burst + banner in green; losing
  plays it in red — each once, then it clears. With OS reduced-motion on, a static
  variant renders and nothing animates.
- Zero diff to engine/score/replay/bot files; `docs/roadmap.md:209` ticked by the
  harvesting session from this deliverable.
