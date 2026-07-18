# DISPATCH — publish constraints to stable paths + wire intake validator

Follow-up task spec for the constraints published in
[`CONSTRAINTS.md`](./CONSTRAINTS.md) / [`constraints.json`](./constraints.json).

This item's core intent (publish the constraints) is **already satisfied** by
this docs folder. This dispatch is the **enhancement** that (a) gives the lab a
*stable* repo path to point its prompt matrices at instead of a task-id folder,
and (b) makes the constraints *executable* by the `assets/incoming/` intake gate
(the sibling G1 roadmap item). It touches paths outside the design lane's
docs-only lease, so it is dispatched separately.

> **Fence note:** if `docs/roadmap.md` / the manifest fences this repo
> `agents: docs-only`, this code task needs an Ethan fence promotion (or an
> explicitly approved code lane) before dispatch. The published constraints are
> complete and usable regardless.

---

## title

`feat(assets): publish canonical Signal-Skin concept constraints + intake validation`

## goal

Promote the NVD Signal-Skin concept constraints to stable, lab-consumable repo
paths, and enforce them at the `assets/incoming/` intake boundary, exactly as
specified in
`docs/plans/unblock-g1-publish-skin-concept-constraints-dime-20260718/CONSTRAINTS.md`
and `.../constraints.json`. **No live-game surface changes; no runtime asset is
shipped; nothing auto-promotes into `src/` or `public/`.**

Deliver:

1. **`docs/skin-concept-constraints.md`** (new, stable canonical path) — the
   human constraints. Copy `CONSTRAINTS.md` verbatim, adjusting only the
   relative link to `constraints.json` to its new home. This is the URL the lab
   documents in its prompt-matrix config.

2. **`assets/skin-concept-constraints.json`** (new, stable canonical path) — copy
   `constraints.json` verbatim. Single machine-readable source of truth for
   both the lab and the validator.

3. **`assets/incoming/README.md`** (new) — one paragraph: what a concept batch
   is, that it is review-gated and never auto-ships, and a pointer to
   `docs/skin-concept-constraints.md`. (Coordinate with the sibling G1
   "`assets/incoming/` intake" task if it lands first — extend, don't clobber.)

4. **`scripts/validate-skin-batch.mjs`** (new, Node, zero runtime deps) — a
   validator that, given a batch folder path, loads `manifest.json` and checks it
   against `assets/skin-concept-constraints.json`:
   - manifest matches `manifestSchema` (kinds, `hueFamily`, `projectileTrail`
     enum, `constraintsVersion === "1"`, `maxConceptsPerBatch`);
   - every `files[].path` exists, is `png`/`webp`, within `maxFileBytes`, and its
     declared `w`/`h` match the `dimensions` for that `role`;
   - each concept carries a `proposed*` block whose hex values pass the
     `paletteRules` checks it can enforce statically: hex format, dominant
     `hslSaturationMin`, dominant `luminanceRange`, `contrastVsBackdropMin` vs
     `judgeBackdrop`, map-theme `bgLuminanceMax`, and the `reservedColors` /
     prohibited-dominant rules (with the `chrome-metallic` exception);
   - exits non-zero with a readable per-concept report on any violation.
   Pure functions for HSL/luminance/contrast so they are unit-testable.

5. **`tests/unit/skin-batch-validator.test.ts`** (new) — cover: a good batch
   passes; each failure mode rejects (bad `projectileTrail`, wrong dims for role,
   `#ff4757` dominant, `#4bcffa` dominant paid skin, saturation below floor,
   stale `constraintsVersion`, oversize file, map-theme bg too bright); the
   `chrome-metallic` metallic exception passes. Include tiny fixture batches
   under `tests/fixtures/skin-batches/`.

6. **`docs/changelog.md`** — one dated line (newest on top).

## owns

- `docs/skin-concept-constraints.md`
- `assets/skin-concept-constraints.json`
- `assets/incoming/README.md`
- `scripts/validate-skin-batch.mjs`
- `tests/unit/skin-batch-validator.test.ts`
- `tests/fixtures/skin-batches/**`
- `docs/changelog.md` (append one line only)

## test-cmd

```sh
npm test
```

(Validator unit test must be picked up by the repo's Vitest config; if a
narrower engine suite is preferred, `npm run test:engine` must also stay green.)

## acceptance

- `docs/skin-concept-constraints.md` + `assets/skin-concept-constraints.json`
  are byte-faithful copies of this folder's sources (only the intra-doc link
  path differs); `assets/skin-concept-constraints.json` parses.
- `node scripts/validate-skin-batch.mjs tests/fixtures/skin-batches/good` exits 0;
  each bad fixture exits non-zero with a specific reason.
- `npm test` passes; no change under `src/`, `public/`, `functions/`, or any
  gameplay/score/replay path (guardrail: cosmetic-intake tooling only).
- Nothing auto-promotes a concept into the game; `assets/incoming/` remains a
  review-gated holding area.
