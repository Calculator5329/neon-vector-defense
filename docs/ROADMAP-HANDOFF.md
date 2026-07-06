# Roadmap Handoff — Lantern 7 (neon-vector-defense)

> Phased task list for a future assistant session + Ethan. Written 2026-07-05.
> Each task is sized to complete in ONE session and has acceptance criteria.
> The in-repo `docs/roadmap.md` is the owner-triaged source of truth for
> product direction; this file sequences *assistant-executable* work.

## MANDATORY PRE-FLIGHT (every session, before any code change)

- [ ] `git status` — if the working tree is dirty or there are unexpected
      staged files, STOP and ask Ethan. This repo is actively developed by
      Ethan and other agents, possibly concurrently.
- [ ] `git log --oneline -5` — confirm HEAD matches what you expect; re-check
      before committing if the session runs long.
- [ ] `git fetch && git status` — confirm you are not behind `origin/master`.
- [ ] Never commit unless Ethan asked; never edit `public/balance-report.json`
      by hand (it is generated); never touch `.env.local`.

---

## NOW (highest value, lowest risk)

### N1. Balance-report cycle (analysis only — no code changes)
The repeatable loop that keeps the ladder honest after the content waves
(Exposed debuff, Mirror Hull, Gauntlet Protocol, 4 new sectors) shipped.

- [ ] Run `npm run balance` (full, not quick) — writes `public/balance-report.json`
      across ALL 12 sectors x 4 protocols. Note: full run is slow; budget for it.
- [ ] Run `npm run sim` and `npm run tower:deep-dive` for the bot-tier and
      per-tower views (deep-dive regenerates `docs/tower-balance-deep-dive.md`,
      a TRACKED file — if you must not touch tracked files this session, pass
      output elsewhere or skip and read the committed version).
- [ ] Write findings to a NEW `docs/balance-report-YYYY-MM-DD-HANDOFF.md`:
      outlier towers (efficiency > ~1.5x or < ~0.6x median), sectors where
      expert bots fail Recruit or breeze Extinction, dead strategies.
- [ ] Propose concrete tuning deltas (stat, current value, proposed value,
      expected effect) **for Ethan's approval — do not apply them**.
- **Accept when:** report file exists, every claim cites a number from the
  harness output, proposals are reversible one-liners in `towers.ts`/`enemies.ts`
  or `config/balance` hot-patch candidates.
- **Caution:** applied tuning is a replay-schema-coupled change
  ([balance-intended] commit tag convention; see mapVersions/replay engine
  versioning) — application is its own session with Ethan's sign-off.

### N2. Extend bot playtests to all 12 sectors (fixes a real coverage gap)
`scripts/sim.ts` iterates `MAPS` (first 3 sectors) while `balance.ts` uses
`ALL_MAPS`. The 9 newer sectors — including the high-variance ones (Splice
Junction's braided choke, Foundry Floor's blockers, Mirror Array) — have no
bot-playtest coverage.

- [ ] Pre-flight checklist above; confirm with Ethan before editing tracked
      `scripts/sim.ts`.
- [ ] Switch sim.ts to `ALL_MAPS` (or add a `--maps all|core|<name>` arg with
      the current 3 as default so `npm run ci` timing is unchanged).
- [ ] Update the header comment ("3 maps" is stale either way).
- [ ] Run `npm run sim -- quick` on the expanded set; flag any sector where a
      skill tier soft-locks or the run never terminates (fog/no-support guard
      regressions — see commit `ae9f0d2`).
- **Accept when:** all 12 sectors simulate to completion at all 3 bot tiers,
  `npm run ci` still passes locally, findings summarized for Ethan.

### N3. README as store page
README is already strong (badges, live link at line 3 and 14). Polish it into
a store page: hero screenshot/GIF near the top, "Play now" call-to-action
above the fold, 30-second feature pitch before the engineering section.

- [ ] Pre-flight; README.md is TRACKED — get Ethan's go-ahead, draft first in
      `docs/readme-draft-HANDOFF.md` if unsure.
- [ ] Capture 1-2 gameplay screenshots (dev server + Playwright or manual) into
      `docs/media/` or `public/`; verify no PII/admin UI in shot.
- [ ] Restructure top: title -> play link + demo link as buttons/bold -> hero
      image -> 3-bullet hook -> then existing Gameplay/Technical sections.
- **Accept when:** a recruiter reaching the GitHub repo can click into the live
  game within one screen height, and `npm run build` still passes.

---

## NEXT

### X1. Wire GitHub Actions deploys (owner + assistant pair task)
- [ ] Ethan creates the `github-deployer` service account + repo secret/variable
      per `docs/runbooks/deploy.md` (assistant cannot do console steps).
- [ ] Assistant dry-runs the hosting workflow via `workflow_dispatch`, then
      functions; verify `/build-tag.json` changes.
- **Accept when:** one green run of each deploy workflow; runbook updated to
  remove the "never succeeded" caveat (tracked file — with approval).

### X2. Balance-tuning application session (follow-up to N1)
- [ ] Take Ethan-approved deltas from the N1 report only.
- [ ] Apply, bump replay/map versions if required, regenerate
      `public/balance-report.json` + ghost curves, run `npm run balance:gate`,
      `npm run test:engine`, replay-fidelity tests.
- **Accept when:** `npm run ci` green; commit tagged `[balance-intended]`;
  old-replay playback verified on at least one pre-change `?run=` link.

### X3. Bot playtests on high-variance sectors, deeper pass
- [ ] Using N2's expanded sim, run non-quick seeds on the 3-4 sectors with the
      widest win-rate spread; compare against ghost curves
      (`genGhostCurves.mjs` pipeline) and check curves exist for new sectors.
- **Accept when:** per-sector difficulty note added to the balance handoff
  report; ghost-curve gaps listed.

### X4. App Check enforcement rollout
- [ ] Follow `docs/runbooks/app-check-rollout.md`; Ethan does console
      registration; staged: log-only -> `ENFORCE_APP_CHECK=true`.
- **Accept when:** production callables reject tokenless requests and real
  clients still submit scores (verify on live board).

---

## LATER

### L1. Content expansion: sectors 13+ / new region
- Follow the pattern of commit `e2baca8` (four authored sectors): lane shape in
  `maps.ts`, atlas node, unlock chain (mind `dba8660` grandfathering), ghost
  curves, sim/balance coverage, `mapVersions.ts` entry.
- **Accept when:** new sector plays end-to-end, replays verify, atlas navigable,
  balance gate green.

### L2. Daily/weekly challenge deepening
- More mutation modifiers for Weekly Mutation; daily archive board. See
  `docs/IDEAS-HANDOFF.md` #2/#6 for design directions.

### L3. Portal launch (CrazyGames/Poki)
- Owner accounts + art are the blockers; code path (`build:crazygames`,
  `build:poki`, portal e2e spec) already exists. Runbook:
  `docs/runbooks/portal-submission.md`.

### L4. Spectator/replay-sharing growth loop
- OG unfurl cards for `?run=` links (Top Bet 2 plan already written in
  `docs/idea_backlog.md`, Appendix A), replay-of-the-day surfacing, share CTA
  on the debrief panel.

---

## Standing rules for every task above

1. Pre-flight `git status` check first — always.
2. Prefer `-- quick` harness variants while iterating; full runs for reports.
3. Any engine/content/codec change: ask "does this bump the replay version?"
   before writing code. If yes, it ships hosting+rules+functions together.
4. `meta.ts` must never enter the engine/score path (`npm run meta:sim` guards).
5. New docs go in `docs/` with `-HANDOFF` suffix unless Ethan approves editing
   tracked docs.
