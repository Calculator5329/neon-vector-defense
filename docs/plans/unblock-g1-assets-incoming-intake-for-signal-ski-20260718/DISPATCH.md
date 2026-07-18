# DISPATCH — `assets/incoming/` Signal Skin concept intake (implementation)

Follow-up task spec for the design in [`DESIGN.md`](./DESIGN.md). This item
requires source changes; the design lane's lease covered docs only, so the
implementation is dispatched separately here.

> **Fence note:** the manifest fences this repo `agents: docs-only`
> (`docs/roadmap.md:20`, `roadmap.md:24`). This implementation task needs an
> Ethan fence promotion (or an explicitly approved code lane) before dispatch.
> The design and this spec are complete and unblocked regardless.

---

## title

`feat(intake): assets/incoming/ Signal Skin concept intake — manifest-validated, review-gated`

## goal

Implement the inbound concept-batch pipeline exactly as specified in
`docs/plans/unblock-g1-assets-incoming-intake-for-signal-ski-20260718/DESIGN.md`:
a repo-root `assets/incoming/` **quarantine** where the local-ai-lab drops
Signal Skin *concept* batches, each described by a schema-validated
`manifest.json`, gated by a **fail-closed** `npm run intake:validate` check and a
**human review gate** — with **no automated path from a concept to a build**
(nothing auto-ships). v1 stops at "reviewed and stageable"; the promote step and
any `cosmeticSets.ts`/`palette.ts` registration are out of scope.

Deliver:

1. **`assets/incoming/README.md`** (new) — guardrail banner (quarantine: never
   served, never imported, nothing auto-ships), the drop convention
   (`assets/incoming/<batchId>/` + `manifest.json` + concept files), and the
   review workflow (validate → human edits `review.status` → later promote).
2. **`assets/incoming/.gitkeep`** (new) — keep the empty quarantine dir tracked.
3. **`assets/incoming/manifest.schema.json`** (new) — JSON Schema draft-07 for
   the batch manifest as specified in `DESIGN.md §2`: `schema` (const
   `"nvd-skin-intake-v1"`), `batchId`, `source`, `generatedAt`, `generator`,
   batch-level `review` (`status` enum `pending|approved|rejected`, `reviewer`,
   `reviewedAt`, `notes`), and `assets[]` (each: `file`, `sha256`, `bytes`,
   `width`, `height`, `format`, `targetSkinId`, `role`, `palette[]`, per-asset
   `review`, `license`, `provenance`). Every field required; optionals are
   nullable, never absent; `additionalProperties: false`.
4. **`scripts/intake-validate.mjs`** (new) — the fail-closed validator
   (`DESIGN.md §3`), matching the `scripts/gen*.mjs` idiom (ESM, `node:fs`/
   `node:path`/`node:crypto`, `process.cwd()`-relative). Read-only; writes
   nothing into `assets/`, `public/`, or `src/`. Walk
   `assets/incoming/*/manifest.json`; for each run checks 1–6 from `DESIGN.md §3`
   (schema shape incl. exact `schema` string; file presence + no path traversal;
   sha256 + bytes integrity; dimension/format/palette constraint compliance;
   review-gate integrity incl. no anonymous approval; no-ship invariant — grep
   that nothing under `assets/incoming/` is referenced from `src/` or `public/`).
   **Exit 0** iff every batch valid (empty `assets/incoming/` = valid); **exit 1**
   with a per-batch/per-asset stderr report otherwise. **Never mutates
   `review.status`.** Factor the pure check logic into exported functions so the
   unit test imports them directly.
5. **`src/game/skinConceptConstraints.ts`** (new, tiny, data-only) — the
   dimension/format/neon-palette rule set the validator checks against
   (`DESIGN.md §5`). Import the companion item's constraints file if it exists
   (`unblock-g1-publish-skin-concept-constraints-dime-20260718` deliverable);
   otherwise ship the placeholder constants from `DESIGN.md §5` (allowed dims
   512²/1024²; formats `png`/`webp`; neon gamut referenced from
   `scripts/genart.mjs:24` `STYLE` + the `cosmeticSets.ts` accent hexes) with a
   header comment saying it is superseded by the companion output. Data-only —
   importable by the validator without pulling in engine code.
6. **`.gitignore`** — add the quarantine block from `DESIGN.md §4` (ignore
   `assets/incoming/**` concept binaries by extension; keep `manifest.json`
   tracked).
7. **`docs/asset_provenance.md`** — add an `assets/incoming/` section: reserved,
   unreviewed, **non-shipping** quarantine; manifests tracked, binaries not;
   promotion into `public/art/` is a separate reviewed step.
8. **`package.json`** — add `"intake:validate": "node scripts/intake-validate.mjs"`.
9. **`tests/fixtures/intake/`** (new) — small fixtures backing the tests: a
   valid `approved` batch (tiny real PNG so sha256/bytes/dims are real), plus
   malformed variants (bad schema string, hash mismatch, missing file, path
   traversal, out-of-spec dims, off-palette, anonymous approval, `pending`).
10. **`tests/unit/intake-manifest.test.ts`** (new, `node:test` via `tsx --test`,
    modeled on `tests/unit/weekly-challenge.test.ts` + the path-guard style of
    `tests/unit/audio-assets.test.ts`) — cases 1–10 from `DESIGN.md §8`,
    importing the validator's pure functions and running against the fixtures,
    plus the assertion that `assets/incoming/` is not importable from `src/`.

Optional (note in PR, do not block on it):

- Wire `npm run intake:validate` into `.github/workflows/ci.yml` as a cheap gate
  (passes trivially with no batches).

### Hard constraints (verification-failing if violated)

- **Nothing auto-ships.** No automated edge from `assets/incoming/` to `public/`
  or a build. No `intake:promote` in v1. Approval is only a human editing a
  manifest — the validator must never write `review.status`.
- **Quarantine is inert to the bundler.** `assets/incoming/` lives at repo root,
  NOT under `public/` or `src/`; nothing in `src/` imports from it (enforced by
  the unit test's no-ship check).
- **No combat/score/bot/replay/threshold change.** Touches no engine, tower,
  enemy, score, unlock, or replay code; no new public replay fields; no
  schema-v3/`actionHash` change. `skinConceptConstraints.ts` is data-only and
  imported by nothing on the sim/score path.
- **Fail-closed.** Validator exits non-zero on any violation; no
  partial-as-valid; no `undefined` permitted by the schema.
- **No `cosmeticSets.ts` / `palette.ts` / `COSMETIC_PRICES` edits** — registering
  a concept as a real skin is the deferred promote step, out of v1 scope.
- **Deploys / `firebase` / `npm publish` remain Ethan-only** — do not run them.

## owns

```
assets/incoming/README.md               # new — guardrail banner + workflow
assets/incoming/.gitkeep                 # new
assets/incoming/manifest.schema.json     # new — batch manifest JSON Schema
scripts/intake-validate.mjs              # new — fail-closed validator
src/game/skinConceptConstraints.ts       # new — data-only constraint set
.gitignore                               # add quarantine block
docs/asset_provenance.md                 # add assets/incoming/ section
package.json                             # add intake:validate script
tests/fixtures/intake/**                 # new — valid + malformed fixtures
tests/unit/intake-manifest.test.ts       # new
.github/workflows/ci.yml                 # optional — wire intake:validate gate
```

## test-cmd

```sh
npm run test:engine
```

Also run before hand-off:
- `npm run intake:validate` — must exit 0 on the committed fixtures / empty tree.
- `npm test` — the Playwright e2e gate (full verify).

## acceptance

- `npm run test:engine` passes, including the new `intake-manifest` suite (all
  cases 1–10 from `DESIGN.md §8`).
- `npm run intake:validate` exits 0 on a clean tree and on the valid fixture,
  and exits 1 with a clear report on each malformed fixture.
- Manually: dropping a well-formed `pending` batch validates clean but is
  reported as **not promotable**; flipping `review.status` to `approved` with a
  `reviewer` set makes it promotable; a hash/dimension/palette violation fails
  the validate gate.
- No diff to engine/score/replay/bot files and no `cosmeticSets.ts`/`palette.ts`
  change; grep confirms nothing in `src/` imports `assets/incoming/`.
- `docs/roadmap.md:264` item ticked by the harvesting session from this
  deliverable.
