# Recovered-Signal Pass v1 — plan folder

Deliverable for roadmap item **"Seasonal cosmetic track (\"Recovered-Signal
Pass\" v1). Time-boxed"** (`docs/roadmap.md`, Monetization scaffolding).
Ethan decision: **APPROVED**.

- [`DESIGN.md`](./DESIGN.md) — the design & execution plan (data model, premium
  entitlement gate, content, UI, guardrail compliance, test plan, scope
  boundary), grounded in the existing meta/entitlement/cosmetic/time-boxing
  systems.
- [`DISPATCH.md`](./DISPATCH.md) — the exact follow-up implementation task spec
  (title / goal / owns / test-cmd / acceptance). This item requires source
  changes; the design lane's lease was docs-only, so implementation is a
  separate dispatch.

## For the harvesting session

The design is complete and the implementation is fully specified. Suggested
roadmap update: mark the item's design done and reference this folder; the
`- [ ]` box flips to `[x]` only when the DISPATCH.md task ships and its tests
(`npm run test:engine`) pass.

**Watch:** the repo may be manifest-fenced `agents: docs-only` (`roadmap.md:20`).
If so, the DISPATCH.md code task needs an Ethan fence promotion (or an approved
code lane) before it can run.
