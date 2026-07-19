# Neon Vector Defense agents-fence promotion

## Decision and outcome

The authoritative Ethan decision supplied with this item is **UNBLOCKED**.
The previously requested promotion is therefore approved: change the workspace
manifest entry for `games/neon-vector-defense` from `agents: docs-only` to
`agents: full`.

This docs-only lane cannot edit the workspace-root manifest. It queues the exact
one-file follow-up in [`DISPATCH.md`](./DISPATCH.md). No further Ethan decision
is needed, and the implementation lane must not ask again.

## Why the lost item still has residual work

The generated Visions item was accurate when filed, but its stated dependency
has partially overtaken it:

- At commits `82b574e` and `00d4c8f`, cosmetic design lanes landed while the
  2026-07-16 replay bugs remained open and the roadmap recorded the
  `agents: docs-only` blocker.
- Ethan then approved the NVD promotion in the 2026-07-17 fable-alt handoff:
  “Q3: NVD fence promotion approved — record the fence change and fix the replay
  bugs” (`planning/handoffs/HANDOFF-2026-07-17-fable-alt-account.md:177-182`).
  The task packet independently carries the authoritative decision
  `UNBLOCKED`; this plan does not infer approval from workflow state.
- The replay fixes subsequently landed in `ed1d0ab` and were merged through
  `eee0ab3`. The current `docs/roadmap.md` marks both owner bugs done on
  2026-07-18 and records their regression coverage.
- A 2026-07-19 read-only preflight of the live
  `/home/ethan/projects/workspace.json` found exactly one NVD entry, still at
  `status: active`, `agents: docs-only`. The decision was executed for the code
  bugs via an approved lane, but not recorded at the actual manifest boundary.

The correct execution is therefore to repair the manifest drift. Do **not**
reopen or redispatch the already-completed replay fixes. Promoting the fence
still matters because autonomous loops read `workspace.json` and only consider
repositories whose `agents` value is `full`; leaving the stale value would
continue to contradict Ethan's durable authorization and strand future NVD code
work.

## Execution plan

1. Run the follow-up in the workspace-root git repository
   (`/home/ethan/projects`) with an ownership lease for `workspace.json` only.
2. Preflight the manifest. Require exactly one repo row whose `path` is
   `games/neon-vector-defense`. It must remain `status: active`. If its fence is
   already `full`, report a verified no-change result; do not rewrite the file.
3. If it is still `docs-only`, change only that row's `agents` field to `full`.
   Preserve formatting, ordering, paths, status, remote metadata, and every
   other repository entry.
4. Validate JSON syntax, uniqueness of the NVD row, the active/full values, and
   whitespace. Inspect the diff to prove it is the expected one-line value
   replacement.
5. Let the orchestrator's normal integration/commit flow record the manifest
   change. No registry sync, MASTER_TODO regeneration, NVD source edit, deploy,
   or replay-task dispatch is part of this item.

## Evidence used

- `docs/roadmap.md` at `1454f66` records the original docs-only fence at lines
  20–21 while both owner replay bugs were open.
- `00d4c8f` and `82b574e` add docs-only cosmetic design/dispatch packages; they
  do not fix either replay bug.
- The owner-answer handoff cited above explicitly approves the repository fence
  promotion.
- `ed1d0ab` contains the replay sweep, and the current roadmap marks both bugs
  done with their regression coverage.
- `WORKSPACE.md` defines `workspace.json` as the manifest source of truth and
  says autonomous loops may touch only repositories with `agents: full`.

## Acceptance criteria

- `workspace.json` parses as JSON.
- Exactly one `.repos[]` row has `path == "games/neon-vector-defense"`.
- That row has `status == "active"` and `agents == "full"`.
- The implementation diff changes no tracked path except `workspace.json` and,
  within that file, changes only NVD's `agents` value from `docs-only` to
  `full`.
- The completed replay bugs remain closed; no duplicate implementation task is
  queued.

## Planning-graph handling

This item requires no Vision/Story/Item hierarchy mutation. The task packet
provides no graph ID or revision, so none is invented. The harvesting session
may mark the existing item complete from this deliverable and the follow-up run
evidence; proposed/accepted state is not inferred from workflow state.

## Rollback

If Ethan later explicitly revokes full autonomous access, a separately
authorized workspace-manifest change can restore this one field to
`docs-only`. Do not revert the promotion merely because the original replay
bugs are already fixed: the approval was for the repository fence itself.
