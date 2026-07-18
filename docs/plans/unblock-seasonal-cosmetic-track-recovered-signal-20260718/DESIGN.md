# Recovered-Signal Pass v1 — Design & Execution Plan

**Roadmap item:** "Seasonal cosmetic track (\"Recovered-Signal Pass\" v1). Time-boxed."
(`docs/roadmap.md`, *Customization & paid-features backlog → Monetization scaffolding*)

**Ethan decision:** APPROVED (verbatim, authoritative).

**Status:** design complete; source changes specified in [`DISPATCH.md`](./DISPATCH.md).
This doc is the plan; DISPATCH.md is the exact follow-up implementation task.

---

## 1. What it is

A **time-boxed seasonal cosmetic unlock ladder** with two tracks:

- **Free track** — every player earns these tiers by playing.
- **Premium track** — the same tiers also drop premium-exclusive cosmetics,
  gated behind one **entitlement** (`pass-recovered-signal-s1`).

Progress is **fed by the XP the player already earns** (runs, quest claims,
streak) — no new grind loop. Rewards are **cosmetics + lore fragments only**:
zero combat, score, unlock-threshold, or bot-plan deltas. This is the
"lore, not power" pass described in `docs/idea_backlog.md:192` — *"needs only a
season window + `tierFromXP()` + the first entitlement field. Zero
balance/ladder impact."*

### Why it slots in cleanly (grounding)

Every dependency already exists and is guardrail-clean:

| Need | Existing system | File |
| --- | --- | --- |
| XP feed | `meta.xp` (monotonic; runs + quest claims) | `src/game/meta.ts` |
| Cosmetic ownership | `meta.owns(id)` → `ownsEntitlement(id, localFallback)` | `src/game/meta.ts`, `src/game/entitlements.ts` |
| Grant-not-buy precedent | Extinction capstone grants `palette-sunset` (`unlockOnly`) into `cache.cosmetics` | `src/game/meta.ts:272`, `src/game/palette.ts` |
| Entitlement gate + grant | `entitlements/{uid}.cosmeticIds`, `purchaseCosmeticEntitlement`, `COSMETIC_PRICES` | `src/game/entitlements.ts`, `functions/src/index.ts:679,741`, `functions/src/entitlementHelpers.ts` |
| UTC time-window math | `isoWeekId` / `weekKey` (FNV-1a, UTC) | `src/game/weeklyChallenge.ts:255`, `src/game/meta.ts:169` |
| UI home | Operations Board tab (rank/salvage/quests/cosmetics), badged via `meta.claimableCount()` | `src/OperationsBoard.tsx`, wired in `src/menu/MainMenu.tsx` |
| Privacy export/delete | `LOCAL_KEYS` enumeration | `src/PrivacyView.tsx:10` |

---

## 2. Data model

### 2.1 Season definition (static, code-defined)

v1 defines seasons in code (deterministic, auditable, testable, no admin
round-trip). An admin-authored `config/seasonPass` doc — mirroring the existing
`config/weeklyOverride` precedent (`src/game/weeklyChallenge.ts:174`,
`firestore.rules`) — is a **later** enhancement, explicitly out of scope for v1.

```ts
// src/game/seasonPass.ts  (NEW — client-side, cosmetic-only)
export type PassTrack = 'free' | 'premium';

export interface SeasonReward {
  track: PassTrack;
  /** Existing cosmetic-id (e.g. `palette-recovered`, `signal-skin-echo`);
   *  omit for a pure lore tier. Grants into local ownership on claim. */
  cosmeticId?: string;
  /** Display-only lore fragment id (ARCHIVE-style arc); no ownership needed. */
  loreId?: string;
  label: string;
}

export interface SeasonTier {
  tier: number;              // 1..N, ascending
  xpRequired: number;        // cumulative SEASON xp to reach this tier
  free?: SeasonReward;
  premium?: SeasonReward;
}

export interface Season {
  id: string;                // e.g. 'season-2026-recovered-signal'
  name: string;              // 'Recovered-Signal Pass'
  startsAt: string;          // ISO-8601 UTC, inclusive
  endsAt: string;            // ISO-8601 UTC, exclusive (time-box close)
  premiumEntitlementId: string; // 'pass-recovered-signal-s1'
  tiers: SeasonTier[];       // sorted by xpRequired ascending
}
```

**v1 season window (concrete):** anchor Season 1 to a fixed 6-week window,
e.g. `startsAt: '2026-07-20T00:00:00.000Z'`, `endsAt:
'2026-08-31T00:00:00.000Z'`. Exact dates are an implementation knob the
follow-up task sets; the requirement is a *fixed, code-defined* window.

`currentSeason(now)`:
- returns the season whose `[startsAt, endsAt)` contains `now`;
- if `now` precedes all seasons → returns the upcoming season in a **preview**
  (locked) state;
- if `now` is past all seasons → returns the most recent season in a **closed**
  state (owned cosmetics persist; no new claims). This is the time-box.

### 2.2 Season progress (local, per-device)

New localStorage key **`nvd-season-v1`** — cosmetic progress only:

```ts
interface SeasonProgressState {
  seasonId: string;        // which season the baseline/claims belong to
  xpBaseline: number;      // meta.xp captured when this season was entered
  claimedTiers: string[];  // claimed reward keys, `${track}:${tier}`
}
```

**Season XP** derives from the monotonic `meta.xp`, so *every* XP the player
already earns feeds the pass — no separate accrual, no double-count risk:

```
seasonXp(now) = max(0, meta.xp - state.xpBaseline)
```

**Rollover (pure, idempotent):** on read, if `state.seasonId !==
currentSeason(now).id`, reset: `xpBaseline = meta.xp`, `claimedTiers = []`,
`seasonId = current.id`, persist. A player entering a new season starts at
season-tier 0 while keeping every cosmetic already granted (ownership lives in
`meta`/entitlements, not in this key).

`tierFromXp(seasonXp, season)` → the highest tier whose `xpRequired <=
seasonXp` (0 if none). This is the `tierFromXP()` the backlog names.

### 2.3 Claiming

- `claimableTiers(now)` — tiers with `tier <= tierFromXp(...)`, not in
  `claimedTiers`, filtered by track access. Premium rewards are only claimable
  when `ownsEntitlement(season.premiumEntitlementId)` is true.
- `claimTier(track, tier, now)` — validates (reached ∧ track-access ∧
  unclaimed ∧ season not `closed`); on success:
  - **cosmetic reward** → grant into local ownership via a thin new
    `meta.grantLocalCosmetic(id)` (pushes into `cache.cosmetics`, mirroring the
    Extinction-capstone push at `meta.ts:272`). `meta.owns(id)` already ORs
    `cache.cosmetics`, so the cosmetic becomes usable immediately.
  - **lore reward** → recorded in `claimedTiers` only (display-only).
  - append `${track}:${tier}` to `claimedTiers`; persist.
  - idempotent: a second claim of the same key is a no-op.

---

## 3. Premium gate (entitlement)

The **only server surface** v1 adds is one catalog entry:

```ts
// functions/src/entitlementHelpers.ts — COSMETIC_PRICES
'pass-recovered-signal-s1': <salvageCost>,   // e.g. 1200
```

The premium track is unlocked by purchasing `pass-recovered-signal-s1` through
the **existing** `purchaseEntitlement()` → `purchaseCosmeticEntitlement`
callable → `grantSalvageEntitlement` transaction. No new callable, no rules
change, no new Firestore collection. The pass key lands in
`entitlements/{uid}.cosmeticIds`; the client reads it via
`ownsEntitlement('pass-recovered-signal-s1')`.

**Design decision — premium cosmetics are unlocked *locally* once the pass key
is owned.** Rather than a server write per claimed tier, owning the pass key
lets `claimTier` grant premium-track cosmetics into local ownership (same
`grantLocalCosmetic` path), gated behind the entitlement check. Rationale:

- The entitlement (the paywall) is server-authoritative and cross-device.
- Premium cosmetics are **display-only viewer paint** (never in sim/score/
  replay), so a local grant is guardrail-safe — the same trust model the whole
  cosmetic layer already uses.
- Keeps the server delta to a single frozen-catalog line.

**Cross-device caveat (documented, acceptable for v1):** season *progress*
(`xpBaseline`, `claimedTiers`) and `meta.xp` are already device-local across the
whole meta layer. A player who owns the pass key re-derives premium unlocks
from local play on each device. A later upgrade — server-persisted pass
progress under `entitlements/{uid}` or a `passProgress/{uid}` doc with a
`deleteMyData` phase — is noted as future work, not v1.

**Real-money later:** `grantSalvageEntitlement` already documents the webhook
seam (a payment source can grant the same entitlement id). When the
Ethan-gated Stripe MVP lands, `pass-recovered-signal-s1` is grantable via
webhook with no client change. v1 uses Salvage only.

---

## 4. Content (v1 — lore-not-power)

To ship v1 with **zero new-art dependency and zero balance risk**, rewards use:

1. **New `unlockOnly` accent palettes** (`src/game/palette.ts`) — a palette is
   just `{ id, name, color, cost: 0, unlockOnly: true }`. `unlockOnly` palettes
   are **earned-only, never in the Salvage store** (`ownsPalette` requires
   `meta.owns('palette-<id>')`), so they don't undercut priced cosmetics. A few
   free-track palettes + one or two premium-exclusive palettes.
2. **Lore fragments** — new display-only text data (the genuinely new content;
   the ARCHIVE-style arc the backlog describes). A small `SeasonLore[]` table
   (id, title, body); voiced/illustrated production via genvox/genart is a
   separate content run, not code.
3. *(optional, if desired)* one premium-exclusive signal skin
   (`src/game/cosmeticSets.ts`) — a new `COSMETIC_SETS` entry is cheap (colors
   only). Kept minimal; palettes + lore satisfy v1.

No new tower/enemy/map/score/bot code. Cosmetics render through the **existing**
viewer-side pipeline (`palette.ts`/`cosmeticSets.ts`/`mapThemes.ts`), which is
already excluded from simulation and replay.

---

## 5. UI

A **Recovered-Signal Pass panel** mounted as a section/tab in
`src/OperationsBoard.tsx` (the existing rank/salvage/quest/cosmetics home):

- season name + **time remaining** (from `endsAt`);
- season XP bar (`seasonXp` / next tier's `xpRequired`);
- the tier ladder: free row + premium row, each cell showing reward + claim
  state (locked / claimable / claimed);
- **"Unlock Premium"** CTA → `purchaseEntitlement('pass-recovered-signal-s1')`
  → `meta.recordServerEntitlement(...)` (the canonical purchase+mirror flow from
  `src/ui/SignalSkinPicker.tsx`);
- a lore reader for claimed lore fragments;
- claimable tiers feed the existing `meta.claimableCount()`-style nav badge
  (extend or add a sibling `passClaimableCount`).

Equip flows reuse `meta.equip(slot, id)` and the existing pickers.

---

## 6. Guardrail compliance (per `docs/roadmap.md` Guardrails)

- **`seasonPass.ts` is imported by NOTHING in `engine.ts` / `towers.ts` /
  `bot.ts` / the score-replay path.** Enforced by extending the
  `scripts/meta-sim.ts` structural check (which already asserts this for
  `meta.ts`) to cover `seasonPass.ts`.
- Reads `meta.xp` **only** (never writes engine/score/unlock state). Zero run
  modifiers. No change to tower/enemy stats, score math, bot plans, or unlock
  thresholds.
- Replays unaffected: pass cosmetics are viewer-side paint resolved from the
  device's own equipped slots (existing behaviour). No new public replay
  fields, no schema-v3 change, no `actionHash` impact.
- Premium is entitlement-gated; free track is fully playable. No gameplay
  advantage ever attaches to the paid tier.
- Privacy: the new `nvd-season-v1` key is added to `LOCAL_KEYS` in
  `PrivacyView.tsx` so export/delete cover it. The pass-key entitlement is
  already covered by the existing `deleteMyData` entitlements phase
  (`functions/src/index.ts:1165`).

---

## 7. Tests (specified in DISPATCH.md)

New `tests/unit/season-pass.test.ts` (`node:test` via `tsx --test`, matching
`tests/unit/weekly-challenge.test.ts`):

- `currentSeason` window selection: before / within / after (preview / active /
  closed) on fixed UTC dates.
- Rollover: `seasonId` change resets baseline & claims; `seasonXp === meta.xp -
  baseline`; never negative.
- `tierFromXp`: monotonic; boundary XP values land on the right tier.
- `claimTier`: rejects unreached; rejects premium without entitlement; grants
  free without entitlement; grants premium with entitlement; idempotent
  double-claim; grants local cosmetic ownership (`meta.owns` becomes true).
- Time-box: after `endsAt` the season is `closed` and `claimTier` is a no-op.
- Privacy parity: `nvd-season-v1` present in `PrivacyView` `LOCAL_KEYS`.
- Structural guardrail: extend `scripts/meta-sim.ts` to assert `seasonPass.ts`
  is not imported by the engine/score/bot path.

If a premium signal-skin/catalog entry is added, extend the functions catalog
test (pattern: `tests/functions/aggregate-helpers.test.ts`) to assert
`pass-recovered-signal-s1` is a known `COSMETIC_PRICES` key.

Primary verify command for the follow-up: **`npm run test:engine`** (unit),
with `npm run test:functions` if the catalog entry is added, and `npm test`
(Playwright e2e) as the full gate.

---

## 8. Scope boundary

**In v1:** season model + `tierFromXp` + season-XP-from-`meta.xp`, one premium
entitlement key, `unlockOnly` free/premium palettes + lore fragments, the
Operations Board pass panel, privacy-key parity, unit tests, guardrail check.

**Out of v1 (future work, noted):** admin-authored `config/seasonPass`;
server-persisted pass progress + `deleteMyData` phase; Stripe/real-money grant
of the pass key (Ethan-gated); genvox/genart-produced voiced/illustrated lore;
bespoke season signal skins / map themes beyond the palette + lore baseline;
multi-season rotation content.
