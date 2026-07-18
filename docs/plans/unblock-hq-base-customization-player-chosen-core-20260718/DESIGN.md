# HQ / Base Customization — Player-Chosen Core Visual

**Roadmap item** (`docs/roadmap.md`, Cosmetics section):

> **HQ/base customization.** Player-chosen core visual (shape shader + idle
> animation + death effect) from a cosmetic registry; visible in replays via
> manifest-carried cosmetic ids (display-only metadata, excluded from
> `actionHash`).

**Ethan's decision:** APPROVED (verbatim).

**Status:** design + execution plan. Source changes are specified as a
follow-up task in [`DISPATCH.md`](./DISPATCH.md) (this lease is docs-only).

---

## 1. What the "core" is

The player's HQ is the path **exit** — `map.path[map.path.length - 1]` — the
point enemies breach when they leak. Lives are literally called **cores**
(`summary.coresLeft`, `engine.startingLives`, `vox('low-cores')`). Today it is
drawn as a static red `OUT` ring:

- `src/game/render.ts:909` `drawMarkers()` → `marker(ctx, b, '#ff4757', 'OUT', time)`
- `src/game/render.ts:445` `buildBackground()` draws hazard chevrons near the exit.
- `src/game/engine.ts:1910-1944` a leak decrements `this.lives`, bumps
  `this.hurtFlash` (+0.55) and `this.shake`, plays `sfx.leak()`; on
  `lives <= 0` sets `phase = 'gameover'`.

So "core visual" = replace/augment the exit marker with a player-chosen
structure that has three cosmetic dimensions:

| Dimension | Meaning | Driven by |
| --- | --- | --- |
| **shape shader** | the core silhouette + fill/glow treatment | static per-style draw fn |
| **idle animation** | ambient motion while `phase !== 'gameover'` | `game.time` |
| **death effect** | burst on each leak + implosion on defeat | `game.hurtFlash`, `game.phase` |

Crucially **no new engine state is required for the FX**: `game.hurtFlash`
already spikes on every leak and decays each frame, and `game.phase` already
signals defeat. The death effect is a pure render read of existing state.

## 2. Mandatory guardrails (from the roadmap's Customization block)

> cosmetic / content / QoL only, never touching combat stats, score math, bot
> plans, or unlock thresholds.

- The core registry is imported by **render + UI only**. It must never be
  imported by `engine.ts`, `towers.ts`, `bot.ts`, `waves.ts`, or the
  score/replay-hash path. (Mirror the header comment in `cosmeticSets.ts`.)
- Equipping/owning a core changes **zero** simulation inputs: no lives, no
  `startingCores`, no cash, no thresholds. `drawCore` receives the same
  geometry as `marker()` does today.
- Verification identity: `actionHash` (`replayCodec.ts:304`) hashes only the
  action packs (`stablePackLine`). The runner's core id is display metadata and
  is **excluded from `actionHash` by construction** — nothing in the hash path
  ever reads it.

## 3. Follows the established cosmetic pattern

Three shipped cosmetics already define the pattern this reuses verbatim:

- **Signal Skins** — `src/game/cosmeticSets.ts` + `src/ui/SignalSkinPicker.tsx`
  (registry `COSMETIC_SETS`, `ownsCosmeticSet`, `displayedCosmeticSet`).
- **Map themes** — `src/game/mapThemes.ts` + `src/ui/MapThemePicker.tsx`.
- **Accent palettes** — `src/game/palette.ts`.

Shared plumbing this feature plugs into unchanged:

- Equip: `meta.equip(slot, id)` / `meta.cosmeticEquipped[slot]`
  (`src/game/meta.ts:340`). Add a `core` slot + `meta.equippedCore` getter
  (mirrors `equippedSignalSkin` at meta.ts:344).
- Ownership: `meta.owns('core-<id>')` → `ownsEntitlement(...)` with the
  anonymous-offline fallback (`src/game/entitlements.ts:76`).
- Purchase: `purchaseEntitlement('core-<id>')` → the server
  `purchaseCosmeticEntitlement` Cloud Function → `meta.recordServerEntitlement`.
  **No Cloud Function change is needed** — the callable takes an opaque
  `cosmeticId` string and the entitlement doc stores a generic `cosmeticIds[]`.

## 4. Registry shape (`src/game/coreCosmetics.ts`)

```ts
// Core cosmetics are viewer/display paint only. Never read by simulation,
// score, tower, bot, or the replay-hash path.
export type CoreShape = 'ring' | 'bastion' | 'spire' | 'singularity' | 'aegis';
export type CoreIdle   = 'pulse' | 'rotate' | 'orbit' | 'breathe';
export type CoreDeath  = 'shatter' | 'implode' | 'emp' | 'flare';

export interface CoreStyle {
  id: string;            // registry id; entitlement id is `core-${id}`
  name: string;
  cost: number;          // Salvage; 0 = free default ("standard")
  shape: CoreShape;
  idle: CoreIdle;
  death: CoreDeath;
  color: string;         // primary neon
  glow: string;          // secondary/glow
}

export const CORE_STYLES: CoreStyle[] = [
  { id: 'standard',    name: 'Standard Core', cost: 0,    shape: 'ring',        idle: 'pulse',   death: 'flare',   color: '#ff4757', glow: '#ff7a86' },
  { id: 'bastion',     name: 'Aegis Bastion', cost: 500,  shape: 'bastion',     idle: 'breathe', death: 'shatter', color: '#2ed573', glow: '#7bffb0' },
  { id: 'prism-spire', name: 'Prism Spire',   cost: 750,  shape: 'spire',       idle: 'rotate',  death: 'emp',     color: '#54a0ff', glow: '#b8dcff' },
  { id: 'singularity', name: 'Singularity',   cost: 1100, shape: 'singularity', idle: 'orbit',   death: 'implode', color: '#8b70ff', glow: '#58f5d2' },
];

export function coreStyleById(id: string): CoreStyle { /* find ?? [0] */ }
export function ownsCoreStyle(s: CoreStyle): boolean { return s.cost === 0 || meta.owns(`core-${s.id}`); }
export function displayedCoreStyle(id = meta.equippedCore): CoreStyle { return coreStyleById(id); }
```

Registry sizing (4 styles) and Salvage pricing sit between Signal Skins
(0/450/700/1000) and map themes — no new pricing policy.

## 5. Render integration

`drawCore(ctx, style, p, time, game)` in `render.ts`, called from
`drawMarkers()` for the exit point (the entrance keeps the plain `IN` marker):

```ts
export function drawMarkers(ctx, map, time, game?) {
  marker(ctx, map.path[0], '#2ed573', 'IN', time);
  const b = map.path[map.path.length - 1];
  if (game) drawCore(ctx, displayedCoreStyle(runnerCoreId(game)), b, time, game);
  else marker(ctx, b, '#ff4757', 'OUT', time);   // background/preview fallback
}
```

- **shape shader**: a `switch (style.shape)` of small canvas-path draws (same
  idiom as `drawTowerBody`'s per-style `switch` at render.ts:1099+). Reuse
  helpers `circle`, `poly`, `path`, `withAlpha`, `shade`.
- **idle animation**: `switch (style.idle)` off `time` (rotate ring, breathe
  scale via `sin`, orbit satellites) — respect `reducedMotion`
  (render.ts:26) exactly like the animated lane does.
- **death effect**: read `game.hurtFlash` (spikes on leak) to scale a burst,
  and `game.phase === 'gameover'` for the one-shot implosion. Additive draw,
  no `shadowBlur` in the hot path (matches the perf note at render.ts:2107).
- Keep the `OUT` label legibility (or fold it into the shape) so the exit is
  still readable — accessibility parity with today.

`runnerCoreId(game)` resolves the id to draw (see §6).

## 6. Replay visibility — the "manifest-carried cosmetic id"

The roadmap explicitly wants replays to show the **runner's** chosen core (this
differs from Signal Skins, which deliberately render the *viewer's* skin). This
splits cleanly into two slices by risk:

### Slice A — feature core (no schema/rules change) — **the DISPATCH**

Registry + `core` equip slot + `CoreStylePicker` + `drawCore` (shape + idle +
death FX). During a live run, `runnerCoreId(game)` returns
`meta.equippedCore` — the local player's choice, shown while they play. In the
replay viewer with no runner id available, it falls back to the viewer's
equipped core (Signal-Skins semantics). **Fully replay-verification-safe and
ships with zero server/schema/rules change.** This is the executable follow-up.

### Slice B — runner id in replays (card-gated schema slice) — deferred

To show the *runner's* core in someone else's replay, carry the id as
display-only run metadata:

- Add `coreStyle?: string` (≤ 40 chars) to `PublicRunDoc['summary']`
  (`runTelemetry.ts:156`), written from `meta.equippedCore` at run finish.
- `actionHash` already ignores it (hashes only action packs) → verification
  identity preserved; `reSimulate.ts` compares only `actionHash` +
  `chunkEventCounts`, so the field never affects a verdict.
- `ReplayViewer` sets `runnerCoreId` from `run.summary.coreStyle` (fallback
  `standard`).
- **Requires** extending the `firestore.rules` `isRunSummary` allowlist
  (`firestore.rules:245-246` `hasAll`/`hasOnly`) to permit `coreStyle`. That is
  a public-surface schema/rules change and is **card-gated** under the trust
  contract ("master.db schema changes … card-gated — ask first").

Because Slice B needs an Ethan card, the DISPATCH covers **Slice A only** (the
whole visible feature). Slice B is captured in [`DISPATCH.md`](./DISPATCH.md)
§"Deferred / gated follow-on" with the exact card content so the harvesting
session can queue it — nothing is lost.

## 7. Where the picker surfaces

`CoreStylePicker.tsx` (clone of `SignalSkinPicker.tsx`, slot `'core'`,
entitlement id `core-<id>`, `data-testid="core-style-picker"`). Mount it on the
same cosmetics surface as the existing pickers — grep the render site of
`SignalSkinPicker` / `MapThemePicker` (currently `src/OperationsBoard.tsx`) and
add the Core picker beside them under a "Core" heading. A tiny inline
swatch/preview (or a mini `drawCore` on a small canvas) mirrors the swatch other
pickers show.

## 8. Test plan (see DISPATCH for exact asserts)

New `tests/unit/core-cosmetics.test.ts` (jest — `npm run test:jest`):

1. **Registry integrity** — unique ids; exactly one `cost === 0` default
   (`standard`); every `shape/idle/death` is a legal union member; valid hex
   colors.
2. **Ownership/equip** — `ownsCoreStyle(standard)` true without entitlement;
   paid style false until `meta.owns('core-<id>')`; `meta.equip('core', id)`
   round-trips via `meta.equippedCore`; `displayedCoreStyle()` returns it and
   falls back to `standard` for unknown ids.
3. **Guardrail (grep test, extend existing pattern)** — assert
   `coreCosmetics.ts` / `CoreStylePicker.tsx` are **not** imported by
   `engine.ts`, `towers.ts`, `bot.ts`, `waves.ts`, or the score/replay-hash
   modules. (Model on any existing "cosmetic never touches sim" guard; if none,
   a source-scan test in the new file.)
4. **actionHash invariance** — `actionHash(pack, chunks)` is byte-identical
   regardless of any core id (Slice A adds nothing to the pack; this locks the
   invariant before Slice B).

E2E (`npm test` / Playwright, optional but cheap): the cosmetics screen renders
`core-style-picker`, equipping toggles `aria-pressed`, unaffordable styles are
disabled — mirror the Signal-Skins assertions in `tests/e2e/qa-screens.spec.ts`.

## 9. Acceptance criteria

- [ ] `CORE_STYLES` registry with ≥3 paid + 1 free style, each a distinct
      shape + idle + death combination.
- [ ] Core drawn at the exit with per-style shape, idle animation
      (reduced-motion respected), and a leak/defeat death effect.
- [ ] `core` equip slot + `meta.equippedCore`; purchase via existing
      entitlement callable; picker on the cosmetics surface with owned/afford
      states and a11y labels matching the other pickers.
- [ ] `actionHash` unchanged by any core id; registry imported by render/UI
      only.
- [ ] `npm run test:jest` (incl. new `core-cosmetics.test.ts`) and
      `npm run typecheck:all` pass; `npm test` e2e green.

## 10. Out of scope / explicitly deferred

- Slice B runner-id-in-replay (card-gated schema change) — spec ready, queued.
- Victory/defeat flourishes (separate roadmap item).
- Any change to lives/cores counts or `startingCores`.
