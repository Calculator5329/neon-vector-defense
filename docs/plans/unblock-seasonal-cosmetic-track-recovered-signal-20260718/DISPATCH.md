# DISPATCH — Recovered-Signal Pass v1 (implementation)

Follow-up task spec for the design in [`DESIGN.md`](./DESIGN.md). This item
requires source changes; the design lane's lease covered docs only, so the
implementation is dispatched separately here.

> **Fence note:** `docs/roadmap.md` records this repo may be fenced
> `agents: docs-only` in the manifest (see the Now-section note at
> `roadmap.md:20`). If so, this implementation task needs an Ethan fence
> promotion (or an explicitly approved code lane) before dispatch. The design
> and this spec are complete and unblocked regardless.

---

## title

`feat(cosmetics): Recovered-Signal Pass v1 — seasonal cosmetic track`

## goal

Implement the time-boxed Recovered-Signal Pass exactly as specified in
`docs/plans/unblock-seasonal-cosmetic-track-recovered-signal-20260718/DESIGN.md`:
a two-track (free + entitlement-gated premium) seasonal cosmetic ladder whose
progress is derived from existing `meta.xp`, paying out `unlockOnly` palettes +
lore fragments with **zero gameplay deltas**, per the roadmap Guardrails.

Deliver:

1. **`src/game/seasonPass.ts`** (new, client-side, cosmetic-only). Header
   comment mirroring `meta.ts`'s guardrail banner (imported by nothing in
   engine/towers/bot/score/replay). Exports:
   - types `PassTrack`, `SeasonReward`, `SeasonTier`, `Season`,
     `SeasonProgressState`;
   - `SEASONS: Season[]` with **Season 1 = "Recovered-Signal Pass"**, a fixed
     6-week UTC window (e.g. `2026-07-20` → `2026-08-31`), `premiumEntitlementId:
     'pass-recovered-signal-s1'`, and a tier ladder (free + premium rewards);
   - `currentSeason(now?): { season: Season; phase: 'preview' | 'active' | 'closed' }`
     using the UTC window math from `weeklyChallenge.ts:255` / `meta.ts:169`;
   - `seasonXp(now?): number` = `max(0, meta.xp - baseline)` after rollover;
   - `tierFromXp(seasonXp, season): number`;
   - `claimableTiers(now?)`, `claimTier(track, tier, now?)`,
     `passClaimableCount(now?)`, and a read accessor for the ladder + progress
     for the UI. Persist `SeasonProgressState` to localStorage key
     **`nvd-season-v1`**; rollover is pure/idempotent on read.
2. **`src/game/meta.ts`** — add `grantLocalCosmetic(id: string)` (thin push into
   `cache.cosmetics` + `save()`, mirroring the Extinction-capstone grant at
   `meta.ts:272`). No other meta change; `meta.xp` stays read-only to the pass.
3. **`src/game/palette.ts`** — add the season's `unlockOnly` accent palettes
   (free-track + premium-exclusive), `cost: 0, unlockOnly: true`, ids
   `palette-<slug>`.
4. **Lore data** — a small `SeasonLore[]` table (id, title, body) in
   `seasonPass.ts` or a sibling `src/game/seasonLore.ts` (display-only text).
5. **`functions/src/entitlementHelpers.ts`** — add
   `'pass-recovered-signal-s1': <salvageCost>` to `COSMETIC_PRICES` (e.g. 1200).
   No new callable, rules, or collection.
6. **UI** — a Recovered-Signal Pass panel in `src/OperationsBoard.tsx`: season
   name, time remaining (from `endsAt`), season-XP bar, free/premium tier ladder
   with claim buttons, an "Unlock Premium" CTA wired to
   `purchaseEntitlement('pass-recovered-signal-s1')` →
   `meta.recordServerEntitlement(...)` (canonical flow from
   `src/ui/SignalSkinPicker.tsx`), and a lore reader. Surface claimable tiers in
   the Operations nav badge (extend `meta.claimableCount` usage or add a sibling
   `passClaimableCount`). Equip via existing `meta.equip(slot, id)` / pickers.
7. **`src/PrivacyView.tsx`** — add `'nvd-season-v1'` to `LOCAL_KEYS` (export +
   delete parity).
8. **`scripts/meta-sim.ts`** — extend the structural "not imported by
   engine/score/bot" assertion to also cover `src/game/seasonPass.ts`.
9. **Tests** — `tests/unit/season-pass.test.ts` (`node:test` via `tsx --test`,
   modeled on `tests/unit/weekly-challenge.test.ts`) covering: season window
   phase selection (preview/active/closed on fixed UTC dates); rollover resets
   baseline+claims and `seasonXp === meta.xp - baseline` (never negative);
   `tierFromXp` monotonicity + boundaries; `claimTier` rejects unreached,
   rejects premium without entitlement, grants free without entitlement, grants
   premium with entitlement, is idempotent, and makes `meta.owns(cosmeticId)`
   true; time-box (post-`endsAt` claims are no-ops); and `nvd-season-v1` present
   in `PrivacyView` `LOCAL_KEYS`. If a premium signal skin / catalog entry is
   added, extend a `tests/functions/*` catalog test to assert the pass key is a
   known `COSMETIC_PRICES` key (pattern:
   `tests/functions/aggregate-helpers.test.ts`).

### Hard constraints (verification-failing if violated)

- `seasonPass.ts` imported by **nothing** in `engine.ts`, `towers.ts`,
  `bot.ts`, or the score/replay path (enforced by the `meta-sim.ts` check).
- No change to tower/enemy stats, score math, bot plans, or unlock thresholds.
- No new public replay fields; no schema-v3 / `actionHash` change; cosmetics
  render viewer-side only.
- Premium track gated solely by `ownsEntitlement('pass-recovered-signal-s1')`;
  free track fully playable. No gameplay advantage on the paid tier.
- `unlockOnly` pass palettes must **not** appear in the Salvage store /
  `COSMETIC_PRICES` (earned-only).
- Deploys / `firebase` / `npm publish` remain Ethan-only — do not run them.

## owns

```
src/game/seasonPass.ts
src/game/seasonLore.ts            # if lore split into its own file
src/game/meta.ts                  # add grantLocalCosmetic only
src/game/palette.ts               # add unlockOnly pass palettes
src/game/cosmeticSets.ts          # only if a premium signal skin is added
src/OperationsBoard.tsx           # pass panel + nav badge
src/PrivacyView.tsx               # add nvd-season-v1 to LOCAL_KEYS
functions/src/entitlementHelpers.ts   # add pass-key to COSMETIC_PRICES
scripts/meta-sim.ts               # extend guardrail import check
tests/unit/season-pass.test.ts    # new
tests/functions/entitlement-catalog.test.ts   # optional, if catalog entry added
```

## test-cmd

```sh
npm run test:engine
```

Also run before hand-off:
- `npm run test:functions` — if `COSMETIC_PRICES` was changed.
- `npm run meta:sim` — the guardrail structural check.
- `npm test` — the Playwright e2e gate (full verify).

## acceptance

- New season unit tests pass under `npm run test:engine`.
- `npm run meta:sim` confirms `seasonPass.ts` is off the engine/score/bot path.
- Manually (or via the run skill): entering the Operations Board shows the
  Recovered-Signal Pass with a live XP bar; a reached free tier claims a palette
  that becomes equippable; the premium track is locked until
  `pass-recovered-signal-s1` is owned, then its tiers claim; after `endsAt` the
  pass reads as closed and claims are no-ops.
- No diff to engine/score/replay/bot files; `docs/roadmap.md` item ticked by the
  harvesting session from this deliverable.
