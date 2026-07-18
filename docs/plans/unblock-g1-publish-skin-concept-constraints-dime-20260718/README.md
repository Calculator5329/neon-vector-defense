# (G1) Publish skin-concept constraints — plan folder

Deliverable for roadmap item **"(G1) Publish skin-concept constraints
(dimensions, format, neon palette rules) for the lab's NVD prompt matrices"**
(`docs/roadmap.md`, *Cross-project: AI asset intake (G1)*).
Ethan decision: **APPROVED**.

## What this item is

It is a **publication** task, not a code task: the local-ai-lab needs a canonical
contract that tells its NVD prompt matrices what a Signal-Skin concept must look
like (dimensions, file format, neon palette rules) so generated batches are
*accepted-for-review* by the sibling `assets/incoming/` intake gate.

Because NVD renders towers/projectiles as **code-drawn vectors** (not sprites),
the real payload of a concept is a small set of **hex colors + a trail-style
enum**, not a shippable image. The constraints are written around that fact.

## Contents

- [`CONSTRAINTS.md`](./CONSTRAINTS.md) — **the published constraints** (human
  form). Purpose/scope, concept kinds, dimensions & framing, file format, the
  neon palette rules, the batch manifest schema, review gate + guardrails, and a
  prompt-author checklist. Grounded with citations into `render.ts`,
  `cosmeticSets.ts`, `palette.ts`, `mapThemes.ts`, `engine.ts`.
- [`constraints.json`](./constraints.json) — **the same rules, machine-readable**
  (validated JSON). One source of truth for both the lab's prompt matrices and
  the `assets/incoming/` intake validator. Includes a `manifestSchema` batches
  must satisfy.
- [`DISPATCH.md`](./DISPATCH.md) — exact follow-up **code** task spec to promote
  these two files to stable, lab-consumable repo paths and wire the intake
  validator to `constraints.json`. That touches paths outside this docs lease, so
  it is dispatched separately.

## For the harvesting session

The constraints are **published and complete as-is** — the lab can point its
prompt matrices at this folder's `CONSTRAINTS.md` / `constraints.json` today. The
item's intent (publish dimensions + format + neon palette rules) is satisfied by
these two files.

Suggested roadmap update: tick **"(G1) Publish skin-concept constraints …"** and
reference this folder. The `DISPATCH.md` follow-up (stable paths + validator
wiring) is an enhancement that also advances the *sibling* G1 item
("`assets/incoming/` intake …"); it is optional for closing *this* box.

**Watch:** if the repo is manifest-fenced `agents: docs-only`, the `DISPATCH.md`
code task needs an Ethan fence promotion (or an approved code lane) before it can
run. This docs deliverable is unblocked regardless.
