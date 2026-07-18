# NVD Signal-Skin Concept Constraints (v1)

**Status:** PUBLISHED (canonical). Ethan decision: **APPROVED**.
**Audience:** the local-ai-lab prompt matrices that generate Signal-Skin
concept batches for Neon Vector Defense (NVD).
**Companion file:** [`constraints.json`](./constraints.json) — the same rules in
machine-readable form; the lab's prompt matrices and the `assets/incoming/`
intake validator should both read the JSON so there is one source of truth.

This document is the contract a concept batch must satisfy to be *accepted for
review*. It does not — and cannot — auto-ship anything to the live game.

---

## 0. What a "Signal Skin" actually is in NVD (read this first)

NVD is a **code-drawn vector game**. Towers, projectiles, and impacts are
rendered every frame as parametric vector shapes on an offscreen canvas
(`src/game/render.ts`, `SS = 3` supersample), *not* from bitmap sprites. Enemy
hulls are likewise canvas-drawn, not committed as art (`docs/asset_provenance.md`).

Therefore a lab-generated image **never becomes a runtime asset**. A concept is
**reference/inspiration** whose real payload is a small set of **hex colors and
a named trail style** that an engineer drops into the existing cosmetic
registries:

- **Signal Skin** → one `CosmeticSet` row in `src/game/cosmeticSets.ts`
  (`towerBody`, `towerGlow`, `projectileTrail`, `projectileColor`,
  `impactParticle`).
- **Accent Palette** → one `AccentPalette` row in `src/game/palette.ts`
  (a single `color`, applied as the `--accent` CSS var).
- **Map Theme** → one `MapThemePack.palette` in `src/game/mapThemes.ts`
  (`bg1`, `bg2`, `path`, `pathEdge`).

**Implication for the lab:** the picture is the mood board; the *deliverable that
matters* is the `proposedCosmeticSet` (or `proposedPalette`) block of hex values
in the manifest. A gorgeous render with no clean, on-palette hex mapping is a
**reject**. Optimize prompts for *legible two-tone silhouettes with an obvious
base color + a brighter glow tint*, not for photographic detail.

---

## 1. Kinds of concept a batch may contain

| `kind`         | Maps to                        | Required color outputs                                            |
|----------------|--------------------------------|------------------------------------------------------------------|
| `signal-skin`  | `CosmeticSet` (cosmeticSets.ts)| `towerBody`, `towerGlow`, `projectileColor`, `impactParticle`, `projectileTrail` (enum) |
| `accent`       | `AccentPalette` (palette.ts)   | `color`                                                          |
| `map-theme`    | `MapThemePack.palette`         | `bg1`, `bg2`, `path`, `pathEdge`                                  |
| `hq-core`      | (roadmap: HQ/base customization)| `towerBody`, `towerGlow` (+ optional idle/death effect note)      |
| `flourish`     | (roadmap: victory/defeat FX)   | 1–3 particle/banner hex values                                   |

A single batch may mix kinds. Every concept declares exactly one `kind`.

---

## 2. Dimensions & framing

All in-game geometry lives in a **1280×720 logical board** (`src/game/engine.ts`
`W=1280 H=720`; `src/game/maps.ts`). Concepts are reference art, so they are
authored larger and downsampled by eye — but they must **frame the subject the
way the engine draws it** so the color mapping is faithful.

### 2.1 Signal-skin / HQ-core concepts (a single hull)
- **Canvas:** `1024×1024` PNG, **square**, **transparent background** (alpha).
- **Subject:** one **top-down** hull, **centered**, occupying **~60–75%** of the
  canvas with clear margin (the engine blits a tight sprite of size
  `radius*4 + 24`; leave breathing room so the glow isn't clipped).
- **Orientation:** nose/forward axis points **right (+x / east)** — this is the
  engine's 0-radian facing (`drawTowerBody` prows are built along `+x`, e.g. the
  `ship`/`capital` hulls). Concepts drawn facing up/left force the reviewer to
  mentally rotate and misread the silhouette.
- **One subject per file.** No grids, no turnaround sheets, no text labels, no
  UI chrome, no drop-shadow baked onto a solid background.
- **Silhouette must survive at ~90 px.** In play a tower is a small on-board
  mark; if the design is unreadable when scaled to a ~90 px circle it will not
  translate. Prefer bold primary forms over fine filigree.

### 2.2 Projectile / trail / impact studies (optional, recommended)
- **Canvas:** `1024×512` PNG (landscape), transparent background.
- Show the projectile **traveling +x** with its trail behind it, plus a small
  impact burst. This is what feeds `projectileTrail` (shape) + `projectileColor`
  + `impactParticle` (colors). Purely to justify the hex/enum choices.

### 2.3 Map-theme concepts (a whole board)
- **Canvas:** `1280×720` PNG, **16:9**, matching the board. Opaque.
- Must read as a **dark playfield** (see §3.4): a near-black `bg1`→`bg2` field,
  a slightly lighter `path` band, and a single neon `pathEdge` accent.

### 2.4 Format rules (all kinds)
- **Master format:** **PNG**, 8-bit/channel, **sRGB**, lossless.
- Alpha required for hull/projectile kinds; opaque allowed for map themes.
- No EXIF/GPS or personal metadata (guardrail: no personal data in assets).
- Optional `webp` companion permitted (runtime art ships as `.webp`), but the
  **PNG is the source of record**; the manifest lists the PNG.
- **Max 12 concepts per batch, max 6 MB per file** — keeps a batch reviewable in
  one sitting and cheap to store under review.

---

## 3. Neon palette rules (the heart of the constraint)

NVD's look is **saturated neon on near-black**. Every color choice is judged
against that. The rules below are derived directly from the shipped palettes
(`palette.ts`, `cosmeticSets.ts`, `mapThemes.ts`, `render.ts`).

### 3.1 Backgrounds you are painting *against*
In-game hulls are viewed over map backgrounds in the `#06xxxx–#0dxxxx`
luminance range (`mapThemes.ts` `bg1` values: `#070b1a`, `#0c071a`, `#160707`,
…). **Assume a `~#0a0f1e` backdrop when judging contrast**, regardless of the
concept's own background.

### 3.2 The two-tone rule (base + glow) — mandatory for hulls
Every shipped skin is a **base color plus a brighter, same-family glow tint**.
Examples from `cosmeticSets.ts` / `towers.ts`:

| base (`towerBody`/`color`) | glow (`towerGlow`/`glow`) |
|----------------------------|---------------------------|
| `#feca57` (amber)          | `#fff3a0` (pale amber)    |
| `#7efff5` (cyan)           | `#c7fffb` (pale cyan)     |
| `#ff633f` (ember)          | `#ffb02e` (gold)          |
| `#8b70ff` (violet)         | `#58f5d2` (mint accent)   |

Rule: **`towerGlow` is a higher-luminance member of the same (or a deliberately
complementary) hue family as `towerBody`.** A concept must make this base/glow
relationship obvious. Flat single-color hulls read as unfinished.

### 3.3 Saturation, luminance, contrast (hulls, accents, projectiles)
For the **dominant** color of any hull/accent/projectile concept:
- **Saturation ≥ 0.60** (HSL) — the neon floor. *Exception:* an intentionally
  **metallic** skin (cf. `chrome`: body `#b9c7d9`, glow `#e8f4ff`) may drop
  saturation but must compensate with a **very bright, cool glow** (L ≥ 0.90).
- **Dominant-color luminance L in ~0.45–0.80** — bright enough to pop on
  near-black, not so blown-out it's indistinguishable from the glow.
- **Contrast vs `#0a0f1e` ≥ 4.5:1** (WCAG-style ratio) for the silhouette edge or
  glow, so the hull is legible on a packed dark board.
- **Pure white (`#ffffff`) only as small core/energy points**, never as a large
  fill. The engine already uses a white→glow radial for hot cores
  (`render.ts` `hex`/`pent` cores); a white-dominant concept fights that.

### 3.4 Map-theme luminance cap
For `kind: "map-theme"`:
- `bg1` and `bg2` luminance **L ≤ 0.12** (stay near-black; the shipped values sit
  ~0.03–0.09). `bg2` slightly lighter than `bg1` for a vertical gradient.
- `path` a muted mid-dark (`L ≈ 0.10–0.20`), **desaturated**.
- `pathEdge` is the **one neon accent** — saturated, `L ≈ 0.55–0.80`, high
  contrast against `path` and `bg`.
- The whole theme is a **single-hue mood** (Ember/Glacier/Void pattern); do not
  ship a rainbow board.

### 3.5 Hue families — pick ONE dominant family per concept
Concepts should commit to one dominant hue family and name it in `hueFamily`.
Recognized families (aligned to existing ids so the catalog stays coherent):

`lantern-cyan` · `ember-orange` · `frost` · `void-violet` · `toxin-green` ·
`auric-gold` · `magma-pink` · `tidal-teal` · `spectral-magenta` ·
`prestige-gold` · `chrome-metallic`

Muddy multi-hue blends (e.g. brown, olive, beige mixes) are rejects — they don't
read as neon and collide with nothing in the catalog.

### 3.6 Reserved & prohibited colors (hard constraints)
These carry **gameplay/UI meaning**; a cosmetic must never adopt them as a
*dominant* color or it will misread as a game signal:
- **`#ff4757`** — invalid-placement / danger red (`render.ts:562`, `:655`;
  `dossier.ts` "GRID OFFLINE"). Do not use as a hull's dominant body/glow.
  (A saturated *magenta*-red like the shipped `magma` `#ff4d6d` is fine — it is
  visibly distinct from the danger red.)
- **`#4bcffa`** — the **default free** Lantern-Cyan accent and the base energy
  color (`palette.ts`, `render.ts:58`). A *paid* skin must not just restate the
  default; differentiate the hue or push saturation/luminance.
- **Range/aura ring reds and the reduced-quality gray states** — don't build a
  skin whose dominant reads as "disabled/dead" desaturated gray.
- No real-world logos, brand marks, or recognizable IP.

---

## 4. Manifest: what the batch must carry

Every batch is a folder with a top-level **`manifest.json`** validated by the
`assets/incoming/` intake gate (sibling roadmap item G1). Schema
(also encoded in [`constraints.json`](./constraints.json) → `manifestSchema`):

```json
{
  "batchId": "nvd-skins-2026-07-18-a",
  "source": "local-ai-lab",
  "generator": "<prompt-matrix id / model>",
  "createdUtc": "2026-07-18",
  "constraintsVersion": "1",
  "concepts": [
    {
      "conceptId": "ion-storm-01",
      "kind": "signal-skin",
      "name": "Ion Storm",
      "hueFamily": "tidal-teal",
      "files": [
        { "path": "ion-storm-01/tower.png", "role": "tower-body", "w": 1024, "h": 1024, "format": "png" },
        { "path": "ion-storm-01/projectile.png", "role": "projectile-study", "w": 1024, "h": 512, "format": "png" }
      ],
      "proposedCosmeticSet": {
        "towerBody": "#36d1dc",
        "towerGlow": "#c7fffb",
        "projectileTrail": "ribbon",
        "projectileColor": "#5be7f0",
        "impactParticle": "#d8fbff"
      },
      "notes": "Storm-harvester motif; two-tone teal, ribbon trail."
    }
  ]
}
```

Field rules:
- `kind` ∈ `{signal-skin, accent, map-theme, hq-core, flourish}` (§1).
- `hueFamily` ∈ the §3.5 list.
- `projectileTrail` ∈ **`{standard, flare, ribbon, echo}`** — these are the only
  styles the renderer knows (`render.ts` `projectileTrailPath`); anything else is
  a reject.
- The `proposed*` block must be present and its hex values must satisfy §3.
- `constraintsVersion` must match this document's version (`1`) so a stale
  prompt matrix is caught at the gate.
- All `files[].path` are **relative to the batch folder** and must exist.

---

## 5. Review gate & guardrails (non-negotiable)

A concept that satisfies §1–§4 is **accepted for review only**. Promotion into a
`CosmeticSet`/`AccentPalette`/`MapTheme` row is a **separate, human, code-lane
step**. This preserves every roadmap Guardrail:

- **Cosmetic / content / QoL only.** A skin can never touch tower/enemy stats,
  score math, bot plans, or unlock thresholds (`cosmeticSets.ts` header;
  roadmap Guardrails). Colors and a trail-enum are the entire surface area.
- **Verification-identical replays.** Skins are viewer-side paint; replay
  playback renders the *viewer's* equipped skin, never the runner's
  (`displayedCosmeticSet`, `displayedMapTheme`). Nothing here enters `actionHash`
  or the replay manifest.
- **Nothing auto-ships.** The intake is manifest-validated and review-gated;
  concepts land in `assets/incoming/`, never in `src/` or `public/`, without a
  human merge.
- **Licensing.** Accepted media is Reserved (not MIT), per
  `docs/asset_provenance.md`; the lab must not feed in third-party/IP material.

---

## 6. Quick checklist for a prompt-matrix author

- [ ] One `kind` per concept; `hueFamily` from the §3.5 list.
- [ ] Hull concepts: `1024×1024` PNG, transparent, top-down, nose **east (+x)**,
      subject ~60–75%, readable at ~90 px.
- [ ] Clear **base + brighter same-family glow** (two-tone).
- [ ] Dominant color: saturation ≥ 0.60, L ≈ 0.45–0.80, ≥ 4.5:1 on `#0a0f1e`
      (metallic exception per §3.3).
- [ ] White only as small cores; no danger-red `#ff4757` or default `#4bcffa`
      as dominant.
- [ ] `manifest.json` with a valid `proposed*` hex block and
      `projectileTrail ∈ {standard,flare,ribbon,echo}`.
- [ ] `constraintsVersion: "1"`; ≤ 12 concepts, ≤ 6 MB/file; no personal data/IP.
