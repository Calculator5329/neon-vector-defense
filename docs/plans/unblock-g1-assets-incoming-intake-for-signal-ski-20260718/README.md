# (G1) `assets/incoming/` intake for Signal Skin concept batches — plan folder

Deliverable for roadmap item **"(G1) `assets/incoming/` intake for Signal Skin
concept batches from local-ai-lab — manifest-validated and review-gated;
concepts only, nothing auto-ships to the live game (guardrails above apply)"**
(`docs/roadmap.md:264`, *Cross-project: AI asset intake (G1)*).
Ethan decision: **APPROVED**.

- [`DESIGN.md`](./DESIGN.md) — the design & execution plan: the quarantine
  directory model, the batch manifest contract, the fail-closed validator, the
  human review gate, the (later) promotion path, guardrail compliance, and the
  test plan. Grounded in the existing `public/art/` provenance model, the
  viewer-side-only `cosmeticSets.ts` skin system, and the repo's
  manifest/`actionHash` fail-closed conventions.
- [`DISPATCH.md`](./DISPATCH.md) — the exact follow-up implementation task spec
  (title / goal / owns / test-cmd / acceptance). This item requires source
  changes (a new `assets/incoming/` tree, a validator script, `.gitignore` +
  provenance updates, tests); the design lane's lease was docs-only, so
  implementation is a separate dispatch.

## Scope in one line

Build a **quarantine + manifest + validator + review-gate** pipeline so the
local-ai-lab can drop Signal Skin *concept* batches into the repo for review
without any path by which an unreviewed concept reaches the shipped game.
**v1 stops at "reviewed and stageable"; promotion into the live cosmetic
registry is a separate, later, human-run step and is explicitly out of scope.**

## Companion item

This is one half of the G1 AI-asset-intake pair on the roadmap:

- **This item** (`roadmap.md:264`) — the *intake pipeline* (inbound side): where
  batches land, how they are validated, how they are reviewed.
- **Companion** (`roadmap.md:265`, leased separately as
  `unblock-g1-publish-skin-concept-constraints-dime-20260718`) — *publishes the
  constraints* (dimensions, format, neon palette rules) the lab generates
  against. This design consumes those constraints as the validator's rule set;
  see [DESIGN.md § Coupling to the constraints spec](./DESIGN.md#coupling-to-the-constraints-spec).

## For the harvesting session

The design is complete and the implementation is fully specified in
`DISPATCH.md`. Suggested roadmap update: mark this item's **design done** and
reference this folder; the `- [ ]` box flips to `[x]` only when the `DISPATCH.md`
task ships and its tests (`npm run test:engine`) pass.

**Watch:** the repo is manifest-fenced `agents: docs-only` (`roadmap.md:20`,
`roadmap.md:24`). The `DISPATCH.md` code task therefore needs an Ethan fence
promotion (or an explicitly approved code lane) before it can run. The design
and spec are complete and unblocked regardless.
