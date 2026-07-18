# DESIGN — Victory/Defeat Flourishes (Run-End Flourish v1)

**Roadmap item:** *Victory/defeat flourishes. Purchasable end-of-run effects
(particle bursts, banner styles) — pure UI layer.* (`docs/roadmap.md:209`)
**Decision:** APPROVED (Ethan). **Layer:** cosmetic / paid-features backlog.

---

## Verb served

*"When my run ends, make the win feel earned and the loss feel cinematic —
with an effect I chose and paid for."* A **Run-End Flourish** is a purchasable
cosmetic that decorates the victory/defeat result overlay with a particle burst
and a banner-entrance style. Pure viewer-side paint: it changes **nothing** the
simulation, score, bot, or replay can observe.

## Consumes (read-only)

- `game.phase` — `'victory' | 'gameover'` (the terminal outcome). Already the
  gate for the result `Overlay` in `src/game-ui/GameScreen.tsx:1459,1507`.
- The overlay accent `color` already passed to `Overlay` (`#2ed573` victory /
  `#ff4757` defeat, `GameScreen.tsx:1460,1508`) — reused as the flourish tint so
  one flourish reads celebratory on a win and somber on a loss.
- `meta.equippedFlourish` — the equipped flourish id (viewer-local, from
  `nvd-meta-v2` `cosmeticEquipped['flourish']`).
- `ownsEntitlement('flourish-<id>')` / `meta.salvage` — ownership + affordability
  for the picker (same path as Signal Skins).
- `window.matchMedia('(prefers-reduced-motion: reduce)')` — accessibility gate.

## Emits (writes)

- **Purely presentational DOM/canvas** inside the result overlay. No engine
  state, no run/replay fields, no score inputs.
- On purchase: a Salvage entitlement `flourish-<id>` via the **existing**
  `purchaseEntitlement()` → `meta.recordServerEntitlement()` flow (no new
  callable, collection, or rule).
- On equip: `meta.equip('flourish', id)` → `cosmeticEquipped['flourish']` in the
  already-persisted `nvd-meta-v2` blob (no new localStorage key).

## Design

### Where it renders

The result screen is the `Overlay` component (`GameScreen.tsx:1994`). It already
receives `title`, `color`, `art`, and a `report`. Add **one** optional child —
a self-contained `<RunEndFlourish outcome color />` mounted inside
`.result-hero` (behind the title/art, above the backdrop). It:

1. reads `meta.equippedFlourish` → `flourishById(id)` (defaults to `standard`);
2. draws a **particle burst** on a `<canvas>` sized to the hero box via a single
   `requestAnimationFrame` loop that runs ~1.2 s then stops and self-clears;
3. applies a **banner-entrance CSS class** to the title (`flourish-banner-<style>`)
   for the animated reveal;
4. tints every particle/keyframe from the passed `color` (outcome-aware);
5. under `prefers-reduced-motion: reduce`, renders **one static frame** (a
   still burst) and the plain title — no animation loop, no motion. Same visual
   identity, zero vestibular risk.

The effect fires once per overlay mount (keyed on `game.runId`), never loops, and
tears down its RAF + canvas on unmount. It is strictly additive: with the
`standard` (free) flourish and/or reduced-motion, the screen looks essentially as
it does today.

### The cosmetic registry — `src/game/flourishes.ts` (new)

Mirror `src/game/cosmeticSets.ts` exactly, including its guardrail header banner
("viewer-side paint only; never read by simulation, replay, score, or towers").

```ts
export type BurstStyle  = 'spark' | 'confetti' | 'shard' | 'nova';
export type BannerStyle = 'fade'  | 'cascade'  | 'glitch' | 'nova';

export interface Flourish {
  id: string;
  name: string;
  cost: number;          // Salvage; 0 = free default
  burst: BurstStyle;     // particle-burst renderer selector
  banner: BannerStyle;   // title-entrance CSS class selector
  accent?: string;       // optional extra spark color, blended with outcome tint
}

export const FLOURISHES: Flourish[] = [
  { id: 'standard', name: 'Standard Signal', cost: 0,   burst: 'spark',    banner: 'fade'    },
  { id: 'cascade',  name: 'Victory Cascade', cost: 400, burst: 'confetti', banner: 'cascade', accent: '#ffd166' },
  { id: 'glitch',   name: 'Glitch Shatter',  cost: 550, burst: 'shard',    banner: 'glitch',  accent: '#58f5d2' },
  { id: 'nova',     name: 'Ion Nova',        cost: 800, burst: 'nova',     banner: 'nova',    accent: '#ad8cff' },
];

export function flourishById(id: string): Flourish { /* find ?? FLOURISHES[0] */ }
export function ownsFlourish(f: Flourish): boolean  { /* cost===0 || meta.owns(`flourish-${f.id}`) */ }
export function displayedFlourish(id = meta.equippedFlourish): Flourish { /* flourishById(id) */ }
```

Four tiers reuse the Signal-Skins price ladder shape (0 / 400 / 550 / 800) so the
store reads consistently. Each `burst` maps to a small pure particle-emitter
function (spawn N particles with seeded-by-index velocities — **no** `Math.random`
in a way that matters; a fixed pseudo-spread keyed on particle index keeps it
deterministic-looking and lint-clean). Each `banner` maps to a CSS keyframe class
added to `App.css`.

### Ownership, purchase, equip — reuse the shipped path

Identical to `src/ui/SignalSkinPicker.tsx`:

- entitlement id: `flourish-<id>`;
- buy: `purchaseEntitlement('flourish-<id>')` → `meta.recordServerEntitlement(id, balance)`;
- equip: `meta.equip('flourish', id)`;
- server price: add `flourish-<id>` keys to `functions/src/entitlementHelpers.ts`
  `COSMETIC_PRICES`.

A new `src/ui/FlourishPicker.tsx` clones `SignalSkinPicker` (subscribe to
entitlements, buy-if-unowned-then-equip, affordability + `aria-label` states,
`data-testid="flourish-<id>"`). It is slotted into the cosmetics area of
`src/OperationsBoard.tsx` next to the Signal Skin picker. A **live preview**
button in the picker mounts `<RunEndFlourish>` in a small stage so buyers see the
effect before/after purchase.

### Meta touch (minimal)

Add one getter to `src/game/meta.ts`, mirroring `equippedSignalSkin`
(`meta.ts:344`):

```ts
get equippedFlourish(): string { return cache.cosmeticEquipped['flourish'] ?? 'standard'; },
```

No other meta change. `equip()` and `recordServerEntitlement()` already exist and
generalize over slot/id.

## Guardrails honored (roadmap "Guardrails" + repo isolation invariant)

- **Cosmetic / QoL only** — no tower/enemy stats, score math, bot plans, or
  unlock thresholds touched.
- **Off the engine/score/bot path** — `flourishes.ts` is imported only by UI
  (`FlourishPicker`, the overlay `RunEndFlourish`). The `meta-sim.ts` isolation
  check is extended to assert `engine.ts`/`towers.ts`/`bot.ts` never import
  `./flourishes`.
- **Replay-identical** — nothing enters the run/replay action stream, the
  manifest, `actionHash`, or schema. Replay playback shows the **viewer's** own
  equipped flourish (same rule as Signal Skins), never the runner's, so
  verification is byte-identical.
- **No new persistence surface** — equip lives in the already-exported
  `nvd-meta-v2` blob, so **no** `PrivacyView` `LOCAL_KEYS` change is needed
  (unlike the season pass). Entitlements persist server-side as today.
- **Accessibility** — `prefers-reduced-motion` fully honored; overlay remains a
  keyboard-navigable decision screen (flourish canvas is `aria-hidden`, no focus
  trap, no dismissal behavior change).
- **Deploys / `firebase` / `npm publish` stay Ethan-only.**

## v1 shipped (acceptance surface)

- Four flourishes (1 free + 3 Salvage-priced) selectable in the Operations Board;
  buying charges Salvage through the existing entitlement callable and equips.
- Winning a run plays the equipped burst + banner in green; losing plays the same
  flourish in red — both once, ≤1.5 s, self-tearing-down.
- Reduced-motion users get a static, non-animated variant.
- `npm run meta:sim` proves `flourishes.ts` is off the engine/score/bot path;
  engine/score/replay/bot diffs are empty; `npm test` (e2e gate) green.

## Out of scope (LATER)

- Separate victory-vs-defeat flourish slots (v1 uses one outcome-tinted set).
- Sound-design flourishes / audio stingers.
- Real-money (Stripe) entitlement — funnels through the same
  `entitlements/{uid}` model when the Monetization MVP lands; no design change
  needed here.

---

Implementation is specified in [`DISPATCH.md`](./DISPATCH.md).
