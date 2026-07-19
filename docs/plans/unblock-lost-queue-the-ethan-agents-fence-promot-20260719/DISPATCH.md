# Follow-up task specification

## title

Promote Neon Vector Defense agents fence to full

## goal

Record Ethan's already-authoritative **UNBLOCKED** decision at the workspace
fence: in the unique `workspace.json` entry for `games/neon-vector-defense`,
change `agents` from `docs-only` to `full` and make no other content change.
The durable owner-answer evidence is
`planning/handoffs/HANDOFF-2026-07-17-fable-alt-account.md:177-182`.

The two P0 replay bugs that originally motivated the promotion are already
fixed on current NVD `master` (`ed1d0ab`, merged through `eee0ab3`, with both
roadmap boxes checked). Do not reopen, reimplement, or redispatch them. This
task only repairs the stale manifest authorization so future NVD code work can
enter the normal autonomous queue.

## repo

`/home/ethan/projects`

## owns

`workspace.json`

## implementation

1. Read the workspace-root `WORKSPACE.md` and `CLAUDE.md` before editing.
2. Claim an orchestrator lease for `workspace.json` and stop on any conflict.
3. Confirm `workspace.json` is clean relative to the lane base and contains
   exactly one `.repos[]` object with
   `path == "games/neon-vector-defense"`.
4. If that object's `agents` is already `full`, finish as
   `succeeded_no_changes` after running the test command below.
5. Otherwise require its current values to be `status: active` and
   `agents: docs-only`, then use a minimal patch to change only
   `"agents": "docs-only"` to `"agents": "full"` in that object.
6. Preserve every other field and entry. Do not edit `MASTER_TODO.md`,
   `planning/ETHAN-QUEUE.md`, Neon Vector Defense files, orchestrator state, or
   any other path. Do not run registry sync or dispatch replay work.
7. Inspect `git diff -- workspace.json`; it must be a single value replacement.

## test-cmd

```sh
python3 -m json.tool workspace.json >/dev/null && jq -e '([.repos[] | select(.path == "games/neon-vector-defense")] | length) == 1 and ([.repos[] | select(.path == "games/neon-vector-defense")][0].status == "active") and ([.repos[] | select(.path == "games/neon-vector-defense")][0].agents == "full")' workspace.json >/dev/null && git diff --check -- workspace.json
```

## acceptance

- The test command exits zero.
- `git diff --name-only` for this lane contains only `workspace.json`.
- `git diff -- workspace.json` shows only NVD's `agents` value changing from
  `docs-only` to `full` (or no diff because the exact promotion already
  landed).
- No NVD replay-fix task is created; current shipped replay work remains the
  source of truth.
- The run evidence cites this plan as the authorization record. Do not ask
  Ethan to repeat the decision.
