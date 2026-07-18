# DESIGN — `assets/incoming/` intake for Signal Skin concept batches (G1)

Roadmap item: `docs/roadmap.md:264`. Ethan decision: **APPROVED**.

## Verb served

> *Give the local-ai-lab a fail-closed way to hand Signal Skin **concept**
> batches to this repo — manifest-described, machine-validated, and held behind
> a human review gate — such that no unreviewed concept can ever reach the
> shipped game.*

**Consumes:** batches produced by `local-ai-lab` NVD prompt matrices (concept
PNGs + a `manifest.json`), plus the constraint spec from the companion item
(`roadmap.md:265`).
**Emits:** a validated, review-annotated staging area (`assets/incoming/`), a
fail-closed `npm run intake:validate` gate, and a documented (but not-yet-built)
promotion path into the live cosmetic registry.
**v1 shipped:** quarantine dir + manifest schema + validator + review-gate
semantics + tests + provenance/CI wiring. **Not v1:** the promote step, any
`cosmeticSets.ts`/`palette.ts` registration, any auto-ship.

---

## 1. Problem & guardrails

The lab can generate Signal Skin concept art faster than a human can review it.
We need an inbound lane that is **safe by construction**: the failure mode to
design out is "an AI-generated concept silently ends up in a build." The roadmap
is explicit — *"concepts only, nothing auto-ships to the live game."*

The relevant repo Guardrails (`roadmap.md:247`) that bind this design:

- **Cosmetics are viewer-side paint only** — `cosmeticSets.ts:1` states Signal
  Skins "must never be read by simulation, replay serialization, score
  calculation, or tower definitions." Intake must not create any new coupling
  between skin *concepts* and the sim/score/bot/replay paths.
- **Manifests are the trust boundary** — the repo already treats a manifest with
  hashes as the thing that makes data trustworthy (replay uploads carry a
  manifest with chunk counts + `actionHash`; "missing manifests are incomplete
  and cannot back accepted scores," `roadmap.md:254`). We reuse that instinct: a
  batch with no valid manifest is inert.
- **Fail-closed / no partial-as-full** — read paths must "reject or clearly
  label incomplete/malformed chunks; partial data should not masquerade as a
  full [artifact]" (`roadmap.md:253`). The validator exits non-zero on any
  violation and never silently downgrades.
- **Reserved media stay reserved** — `docs/asset_provenance.md` already carves
  AI-generated media out of the MIT code license. Concept batches are *more*
  restricted (unreviewed), and must be documented as such.

### Why a root-level `assets/incoming/`, not `public/` or `src/assets/`

Vite serves `public/` verbatim into the build and bundles anything imported from
`src/`. A concept dropped in either location is one careless import (or a static
copy) away from shipping. A **repo-root `assets/` directory is served by
nothing and imported by nothing** — it is inert to the bundler by default. That
inertness *is* the primary guardrail; everything else is defense in depth.

```
assets/
  incoming/                 # quarantine — never served, never imported
    README.md               # guardrail banner + drop instructions
    <batchId>/
      manifest.json         # the batch contract (tracked in git)
      concept-*.png         # raw concept art (git-ignored by default)
    ...
```

---

## 2. The batch manifest contract

One `manifest.json` per batch directory. Small, human-auditable, tracked in git
(so review decisions are diffable and reproducible); it is the single source of
truth about a batch. Validated against `assets/incoming/manifest.schema.json`
(JSON Schema draft-07, checked in).

```jsonc
{
  "schema": "nvd-skin-intake-v1",     // exact string; version gate
  "batchId": "2026-07-18-inferno-variants",
  "source": "local-ai-lab",
  "generatedAt": "2026-07-18T00:00:00Z",  // UTC ISO-8601
  "generator": {
    "tool": "local-ai-lab",
    "model": "google/gemini-2.5-flash-image",
    "promptMatrix": "nvd-signal-skins-v1"   // ref into the companion constraints
  },
  "review": {                          // the review gate lives here
    "status": "pending",              // pending | approved | rejected  (batch-level)
    "reviewer": null,                 // set by the human reviewer
    "reviewedAt": null,
    "notes": ""
  },
  "assets": [
    {
      "file": "concept-inferno-a.png",
      "sha256": "…64 hex…",           // content hash — tamper/mismatch check
      "bytes": 184213,
      "width": 512,
      "height": 512,
      "format": "png",
      "targetSkinId": "inferno",      // which CosmeticSet family this concepts for
      "role": "towerBody",            // towerBody | towerGlow | projectileTrail | impactParticle | keyart
      "palette": ["#ff633f", "#ffb02e", "#0b1020"],  // sampled dominant colors
      "review": { "status": "pending", "notes": "" },  // per-asset gate
      "license": "reserved",          // matches asset_provenance model
      "provenance": "local-ai-lab / OpenRouter image workflow"
    }
  ]
}
```

**Design choices & rationale**

- **`schema` is an exact-match version string.** Same pattern as replay
  `schema-v3` (`roadmap.md:252`). Unknown/missing schema → reject; future format
  changes bump the string and the validator gains a branch, never silently
  accepting old-shape data.
- **`sha256` per asset** is the tamper boundary. The validator recomputes it
  from disk; a mismatch (or a declared file that is absent) fails the batch. This
  makes the manifest — which *is* tracked in git — a faithful, diffable record
  even when the binaries are not committed (see §4).
- **Two-level review status** (batch + per-asset). A reviewer can approve a batch
  while rejecting one weak concept; promotion (later) reads the *per-asset*
  status, gated under the batch status. Default everywhere is `pending`. There is
  no way to author "approved" except a human editing the manifest.
- **No `undefined`, everything required.** Mirrors "free of `undefined` values"
  (`roadmap.md:252`). Optional-by-nature fields (`reviewer`, `reviewedAt`) are
  `null`, never absent. The schema marks them required-with-null.
- **`palette[]` + `width/height/format`** are what the validator checks against
  the companion constraints spec — the machine half of "does this concept obey
  the neon palette / dimension / format rules."

---

## 3. The validator — `npm run intake:validate` (fail-closed)

A standalone Node script (`scripts/intake-validate.mjs`, matching the existing
`scripts/gen*.mjs` idiom) that walks `assets/incoming/*/manifest.json` and
**exits non-zero on the first hard violation**. It reads only; it writes nothing
into `assets/`, `public/`, or `src/`.

Checks, in order (each a hard fail unless noted):

1. **Schema shape** — validate `manifest.json` against
   `manifest.schema.json`. Missing/extra/wrong-typed fields fail. `schema`
   string must equal `nvd-skin-intake-v1`.
2. **File presence** — every `assets[].file` exists on disk within the batch
   dir; no path traversal (`file` must be a bare filename, no `/` or `..`).
3. **Integrity** — recomputed `sha256` and `bytes` match the manifest.
4. **Constraint compliance** — `width`/`height`/`format` are within the
   allowed set from the companion constraints spec; `palette[]` entries pass the
   neon-palette rule check (see §5). Out-of-spec → fail (this is the "is it a
   valid concept at all" gate).
5. **Review-gate integrity** — `review.status` ∈ {`pending`,`approved`,`rejected`};
   if `approved`/`rejected`, `reviewer` and `reviewedAt` must be non-null (you
   cannot approve anonymously). No enum value outside the three.
6. **No-ship invariant (defense in depth)** — assert that nothing under
   `assets/incoming/` is referenced from `public/` or `src/` (grep-style scan);
   assert the batch dir is not under `public/`. A concept that has leaked toward
   a shipping path fails CI loudly.

**Exit contract:** `0` = every batch valid (an empty `assets/incoming/` is
valid — no batches is not an error). `1` = at least one violation, with a
per-batch, per-asset report to stderr. This makes it a drop-in CI gate.

Crucially, **the validator never changes `review.status`.** It reports and gates;
approval is a human editing the manifest. There is no "auto-approve" code path to
audit, because it does not exist.

---

## 4. Git tracking policy

- **Tracked:** every `manifest.json`, `assets/incoming/README.md`,
  `manifest.schema.json`, and the schema/doc scaffolding. These are small,
  auditable, and make review decisions diffable and reviewable in PRs.
- **Git-ignored by default:** the raw concept binaries
  (`assets/incoming/**/*.png` etc.). Rationale: they are (a) unreviewed reserved
  media that must not accidentally ship or be redistributed, (b) potentially
  large and numerous (a "batch"), and (c) not needed by any build. The
  `sha256`-bearing manifest is the durable, tracked record; the binaries move
  between machines out-of-band (they originate on the local-ai-lab box, review
  is local). Cross-machine coordination stays on the manifest, matching the
  global rule that cross-machine state goes through git branches/PRs, not shared
  binaries.
- An explicit **allow-list override** is documented for the rare case where a
  finalized, *approved* concept should be tracked pending promotion — but the
  default is quarantine-and-ignore. (Promotion proper copies into `public/art/`
  and is a separate later step; see §6.)

`.gitignore` gains:

```gitignore
# AI concept-art intake — quarantine. Manifests are tracked; raw concept
# binaries are not (unreviewed reserved media, never shipped). See
# assets/incoming/README.md and docs/asset_provenance.md.
assets/incoming/**/*.png
assets/incoming/**/*.jpg
assets/incoming/**/*.jpeg
assets/incoming/**/*.webp
!assets/incoming/**/manifest.json
```

---

## 5. Coupling to the constraints spec

The companion item (`roadmap.md:265`) publishes the authoritative *dimensions,
format, and neon palette rules*. This design **consumes** them; it does not
redefine them. Concretely, the validator's §3 step 4 reads its rule set from a
single checked-in constants module so the two items share one source of truth:

- If the companion ships a machine-readable constraints file (preferred — e.g.
  `src/game/skinConceptConstraints.ts` or `assets/incoming/constraints.json`),
  the validator imports it.
- If the companion ships prose only, `DISPATCH.md` includes a minimal
  `intakeConstraints` constant (allowed dimensions e.g. 512×512 / 1024×1024,
  formats `png`/`webp`, and the neon-palette rule: dominant colors must sit in
  the project's cyan/violet-on-near-black family — the `STYLE` string in
  `scripts/genart.mjs:24` and the accent hex values in `cosmeticSets.ts` are the
  reference gamut) as a placeholder to be replaced by the companion's output.

The neon-palette check is intentionally a **soft gamut test with a hard floor**:
reject only clearly off-palette batches (e.g. a fully desaturated or
warm-only-when-not-an-`inferno`-role concept), so it filters junk without
second-guessing the art director. Borderline cases pass the machine gate and are
caught by the human review gate — which is the point of having both.

---

## 6. Review → promotion path (v1 stops before promotion)

```
lab generates ─▶ drop batch in assets/incoming/<id>/ ─▶ npm run intake:validate
   (pending)                                              (machine gate; fail-closed)
        │                                                        │ pass
        ▼                                                        ▼
   human review ──edit manifest──▶ status: approved / rejected  (the review gate)
        │ approved
        ▼
   [LATER, out of v1 scope] npm run intake:promote  ──▶ public/art/skins/<id>/
        │                    (human-run, copies ONLY approved assets)
        ▼
   register in cosmeticSets.ts / palette.ts  ──▶ ships as a purchasable skin
```

**v1 delivers everything above the dashed promote line.** The promote step and
registry wiring are deliberately deferred: they are where a concept actually
becomes shippable, so they deserve their own reviewed change (and, per the
guardrails, touch `cosmeticSets.ts`/`palette.ts` which are viewer-side-only and
salvage-priced). v1's job is to make the inbound lane exist and be safe;
`DISPATCH.md` notes the promote step as a follow-on and sketches its contract so
the seam is clean, but does not build it. This is what "nothing auto-ships"
means in code: **there is no automated edge from `assets/incoming/` to a build.**

---

## 7. Guardrail-compliance checklist

- ✅ **Viewer-side-only / off the sim path** — nothing in `src/` imports from
  `assets/incoming/`; a structural test asserts it (mirrors the `meta.ts`
  "off the combat/score/bot path" discipline and the audio-asset path guard in
  `tests/unit/audio-assets.test.ts`).
- ✅ **Nothing auto-ships** — quarantine dir is unserved + unbundled; no
  automated promotion; approval requires a human manifest edit.
- ✅ **Manifest is the trust boundary** — no manifest / bad schema / hash
  mismatch ⇒ inert & CI-failing, reusing the replay-manifest instinct.
- ✅ **Fail-closed, no partial-as-full** — validator exits non-zero and reports;
  never downgrades a malformed batch to "ok."
- ✅ **No `undefined`** — schema requires every field; optionals are `null`.
- ✅ **Reserved media documented** — `asset_provenance.md` gains an
  `assets/incoming/` section marking it reserved + non-shipping.
- ✅ **No combat/score/bot/replay/threshold change** — pipeline is pure
  content-ops; touches no engine, tower, enemy, score, or unlock code.
- ✅ **Deploys stay Ethan-only** — nothing here deploys; validator is local/CI.

---

## 8. Test plan

`tests/unit/intake-manifest.test.ts` (`node:test` via `tsx --test`, the
convention in `tests/unit/weekly-challenge.test.ts`), driving the validator's
pure functions against fixtures under `tests/fixtures/intake/`:

1. A well-formed `approved` batch validates clean (exit-equivalent `ok`).
2. Empty `assets/incoming/` (no batches) is valid — not an error.
3. Missing/misspelled required field ⇒ fail; error names the field.
4. Wrong `schema` string ⇒ fail.
5. `sha256` mismatch ⇒ fail; declared-but-absent file ⇒ fail.
6. `file` containing `/` or `..` (path traversal) ⇒ fail.
7. Out-of-spec `width/height/format` ⇒ fail; off-palette `palette[]` ⇒ fail;
   borderline palette ⇒ pass (soft gamut).
8. `review.status: approved` with `reviewer: null` ⇒ fail (no anonymous
   approval); invalid status enum ⇒ fail; `pending` ⇒ valid but reported as
   not-yet-promotable.
9. **Review-gate invariant:** a `pending`/`rejected` asset is never reported as
   promotable; only `approved`-under-`approved` is.
10. **No-ship invariant:** the structural check flags any `src/` import of, or
    `public/` copy under, `assets/incoming/`.

Plus a one-line assertion added to the existing structural guard (or a small new
one) that `assets/incoming/` is not importable from `src/`.

**Run:** `npm run test:engine` (fast unit gate). `npm run intake:validate`
doubles as an executable acceptance check on the fixtures / any real batch.
Optionally wire `intake:validate` into `.github/workflows/ci.yml` as a cheap
gate (it passes trivially when no batches exist).

---

## 9. Scope boundary

**In v1:** `assets/incoming/` scaffold + README guardrail banner; JSON-schema
manifest contract; fail-closed `intake-validate` script + `intake:validate` npm
script; `.gitignore` + `asset_provenance.md` updates; unit tests + fixtures;
optional CI wiring.

**Explicitly out of v1:** the `intake:promote` step; any `cosmeticSets.ts` /
`palette.ts` / `COSMETIC_PRICES` registration; any entitlement/pricing for
concept-derived skins; the constraints spec itself (companion item); UI to
browse concepts; multi-machine binary sync tooling. Each is a clean follow-on
once the safe inbound lane exists.
