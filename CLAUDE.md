# CLAUDE.md — Lantern 7 (`neon-vector-defense`)

Workspace conventions apply (`~/projects/CLAUDE.md`, `~/projects/WORKSPACE.md`).

## Mission

Lantern 7 is a deterministic sci-fi tower-defense game and portfolio piece.
The same engine powers live play, bot simulations, balance checks, replays,
and server-side score verification. Preserve that shared model: a feature is
not complete if it makes the visible game disagree with a replay or verifier.

The product name is **Lantern 7**. The repository, Firebase project, and public
URL intentionally retain the `neon-vector-defense` name.

## Verify before committing

```sh
npm test
```

Also run the checks that cover the changed surface:

- `npm run build` for application or documentation changes that affect
  documented commands, paths, or imports.
- `npm run test:engine` for `src/game/` changes.
- `npm run test:replay-e2e` for replay, engine, map, or balance changes.
- `npm run meta:sim` for `meta.ts` or imports near the meta boundary.
- `npm run balance:gate` for tower, enemy, wave, map, difficulty, or elite
  balance changes.
- `npm run test:security` for Firestore rules, Functions, Worker, or write-path
  changes. This requires the Firebase emulators and Java; run
  `npm run check:deploy-env` first.
- `npm run ci` before release-ready work.

## Replay and trust boundaries

- Combat math, wave composition, map geometry, tower/enemy stats, and the
  action codec are replay-schema coupled. Before changing one, determine
  whether the replay or map version must change.
- Hosting, Firestore rules, and Functions must ship together for a
  schema-coupled release. Hosting deploys the existing `dist/`; it does not
  build automatically.
- `meta.ts` is cosmetic and quality-of-life state only. It must never affect
  combat math, unlocks, bot plans, or score.
- Never hand-edit generated outputs such as `public/balance-report.json`,
  `src/game/ghostCurveData.ts`, `docs/tower-balance-deep-dive.md`,
  `functions/lib/`, or `dist/`; use their owning scripts.
- Firestore rules and server-side replay verification are security
  boundaries. Do not weaken them to accommodate client behavior or a failing
  test.

## Operating rules

- This repo's agents fence in `workspace.json` is `docs-only` (re-checked 2026-08-12). Agents may edit prose under `docs/` and the root markdown files; agents may not edit `src/`, `functions/`, `worker/`, `scripts/`, or `firestore.rules`. Ask Ethan to promote the fence to `full` before dispatching code work; the open request is docs/roadmap.md line 350. The repository has been public since 2026-07-27, so no personal or financial data goes into a commit.
- Before editing, inspect `git status`, the recent log, active orchestrator
  sessions, and leases. Stop on unexpected tracked changes or a lease
  conflict; never modify `.orc/` state by hand.
- Never commit secrets. Local keys belong in `.env.local`; Worker secrets
  belong in Wrangler-managed secret storage. `VITE_*` values are public.
- Production deploys, Firebase/Google Cloud console changes, App Check
  enforcement, weekly champion crowning, data wipes, Stripe actions, and
  package publication are Ethan-only.
- Pushes are authorized (Ethan, 2026-07-11). Never force-push or rewrite
  published history.
- `docs/roadmap.md` is the sole work queue; record shipped work in
  `docs/changelog.md`. `docs/decision_log.md` is the source of truth for
  product decisions, and `docs/runbooks/` owns operational procedures.
