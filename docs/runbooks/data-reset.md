# Production data reset runbook

Use this only when the owner has confirmed that production Firestore player data can be wiped. Scope (re-cut 2026-07-05): it deletes leaderboards (all five board collections), public/private replay data (runs, replayOwners, replayStreams, runCheckpoints), global aggregates, the replay spotlight pin, and the crowned weekly champion doc. It intentionally KEEPS `config/balance`, daily/weekly override docs, telemetry, feedback, rateLimits, and runAnalytics.

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

`boards`, `dailyBoards`, `weeklyBoards`, `gauntletBoards`, `gauntletProtocolBoards`,
`runs`, `replayOwners`, `replayStreams`, `runCheckpoints`, `aggregates`,
`config/spotlight`, and `config/weeklyGauntlet`.

It also performs a post-delete cleanup of known child collection documents that
may exist under missing parent docs: `*/scores` under all five board collections,
`runs/*/chunks`, `runCheckpoints/*/chunks`, `replayOwners/*/runs`, and
`replayStreams/*/runs`.

Never recursive-delete `config`; `config/balance` is the admin-authored tuning document and must survive.

## After the wipe

Verify the live game:

- Leaderboards show empty states, not errors.
- Replay of the Day quietly disappears when `config/spotlight` is absent.
- One manual scored run can submit, repopulate `boards`, and create `aggregates/globalTop`.

Local browser progress, replay retry tokens, and feedback receipts are per-player and are not server data. The client prunes replay tokens and feedback receipts older than 60 days on boot.

Optional owner-only console cleanup: old anonymous users can be bulk-deleted in Firebase Console -> Authentication -> Users. This is harmless either way.
