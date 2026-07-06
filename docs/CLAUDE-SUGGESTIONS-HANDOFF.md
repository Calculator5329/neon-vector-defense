# CLAUDE.md Suggestions — Lantern 7 (neon-vector-defense)

> Written 2026-07-05. As of this survey there is **no CLAUDE.md at the repo
> root** (agent context lives informally in `.codex/shared-context.md` and the
> prompt archive). Below is suggested content for Ethan to review and adopt —
> this file itself makes NO changes to tracked files. If a CLAUDE.md has since
> been created, treat these as candidate additions, not replacements.

---

## Suggested CLAUDE.md content

```markdown
# Lantern 7 (neon-vector-defense) — agent guardrails

## Concurrent-work protocol (do this FIRST, every session)
- Run `git status` before reading further. If the tree is dirty with changes
  you did not make, STOP and ask the owner — another agent or the owner may be
  working right now.
- Run `git log --oneline -5` at session start AND again immediately before any
  commit. If HEAD moved since you started, re-read the new commits before
  proceeding.
- `git fetch` before starting multi-file work; do not work behind origin/master.
- Default branch is `master` (not main). Feature branches: `claude/<topic>`.
- Never force-push, never rebase published history, never amend commits you
  did not just create.

## Verify before commit (minimum gate)
- `npm run build` must pass (tsc + vite).
- `npm run test:engine` for any change under src/game/.
- `npm run meta:sim` if you touched meta.ts or any import near it.
- `npm run balance:gate` if you touched towers/enemies/waves/maps/difficulty/
  eliteAffixes — and tag intentional balance shifts `[balance-intended]` in the
  commit subject (existing repo convention).
- `npm run test:security` if you touched firestore.rules, functions/, worker/,
  or any write path (needs Firebase emulators + Java; run
  `npm run check:deploy-env` first).
- Full `npm run ci` before anything that will be deployed.

## Replay-schema coupling (the #1 way to break production)
- Combat math, wave composition, map geometry, tower/enemy stats, and the
  action codec are all covered by server-side replay re-simulation. Changing
  them without bumping the replay/map version (see src/game/mapVersions.ts and
  the replay engine version history v3..v6) silently invalidates live
  leaderboard submissions.
- Rules, functions, and hosting ship TOGETHER for any schema-coupled change.
  There is no hosting predeploy hook: `npm run build` manually before
  `npx firebase deploy --only hosting,firestore:rules,functions --project
  neon-vector-defense-7`. See docs/runbooks/deploy.md.

## Hard boundaries
- meta.ts is cosmetic/QoL only — it must NEVER feed combat math, unlocks, or
  score. `npm run meta:sim` enforces this; do not weaken that guard.
- Never commit secrets. `.env.local` is gitignored and holds OPENROUTER_API_KEY;
  VITE_* vars are public by definition — no secrets there. Worker keys live in
  Wrangler secrets only.
- Do not hand-edit generated artifacts: public/balance-report.json,
  src/game/ghostCurveData.ts, docs/tower-balance-deep-dive.md, functions/lib/,
  dist/ — regenerate via their scripts instead.
- Do not edit .codex/ (historical agent prompt archive) or .firebase/.
- firestore.rules changes require the rules test suite green and owner review —
  they are the security boundary; client-side Firebase keys are public by design.
- The GitHub Actions deploy workflows are intentionally unwired (no
  credentials). Do not "fix" their red runs by weakening the gate.

## Owner-only actions (never do these autonomously)
- `firebase deploy` to production; publishing `config/balance` hot-patches;
  crowning weekly champions; data wipes (docs/runbooks/data-reset.md); anything
  in the Firebase/Google Cloud consoles; App Check enforcement flips; Stripe.

## Conventions
- Conventional-commit style subjects (feat/fix/docs/chore/perf/test), scope in
  parens, `!` for replay-engine bumps, `[balance-intended]` suffix for
  deliberate balance shifts.
- The game brand is "Lantern 7"; repo, URLs, and Firebase project remain
  neon-vector-defense(-7). Do not rename either direction.
- Docs are load-bearing: decision_log.md is source-of-truth for design intent;
  update changelog.md with sessions that ship.
```

---

## Rationale notes (not for CLAUDE.md)

- The concurrent-work section leads because multiple agents demonstrably work
  this repo (`.codex/` archive, remote branch `claude/replay-accuracy-towers-em7o0k`).
- The replay-coupling section exists because history shows real incidents:
  `446149f` (real submits rejected — mapHash encoding vs rules regex),
  `15ba38e` (v3 replays end-window bug), `852d4fa` (replays vs map re-tunes).
  A less-capable assistant will not infer this coupling from file layout.
- The "owner-only" list mirrors the launch-gate items in docs/roadmap.md and
  the runbooks' operator framing.
```
