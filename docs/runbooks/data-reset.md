# Production data reset runbook

Use this only when the owner has confirmed that production Firestore player data can be wiped. It deletes leaderboards, public/private replay data, analytics, telemetry, feedback, rate-limit counters, global aggregates, and the replay spotlight pin. It intentionally keeps `config/balance`.

## Count first

```powershell
node scripts/admin/wipe-server-data.mjs
```

The script asserts that `firebase use` is `neon-vector-defense-7`, then prints live counts. In count mode it does not delete anything.

## Execute after explicit confirmation

Before running execute mode, print the destructive plan to the operator and get an explicit in-session `yes`.

```powershell
node scripts/admin/wipe-server-data.mjs --execute
```

Execute mode recursively deletes:

`boards`, `dailyBoards`, `runs`, `replayOwners`, `runAnalytics`, `runCheckpoints`, `telemetry`, `feedback`, `rateLimits`, `aggregates`, and `config/spotlight`.

It also performs a post-delete cleanup of known child collection documents that
may exist under missing parent docs: `boards/*/scores`, `dailyBoards/*/scores`,
`runs/*/chunks`, `replayOwners/*/runs`, and `runCheckpoints/*/chunks`.

Never recursive-delete `config`; `config/balance` is the admin-authored tuning document and must survive.

## After the wipe

Verify the live game:

- Leaderboards show empty states, not errors.
- Replay of the Day quietly disappears when `config/spotlight` is absent.
- One manual scored run can submit, repopulate `boards`, and create `aggregates/globalTop`.

Local browser progress, replay retry tokens, and feedback receipts are per-player and are not server data. The client prunes replay tokens and feedback receipts older than 60 days on boot.

Optional owner-only console cleanup: old anonymous users can be bulk-deleted in Firebase Console -> Authentication -> Users. This is harmless either way.
