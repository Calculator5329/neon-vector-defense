# Architecture Handoff — Lantern 7 (neon-vector-defense)

> Audience: a future AI assistant and Ethan, starting without today's context.
> Written 2026-07-05 from a read-only survey of the repo (clean working tree,
> branch `master`, HEAD `9911cca`). This file is intentionally untracked; the
> canonical in-repo docs are `docs/architecture.md`, `docs/tech_spec.md`, and
> `docs/runbooks/`. If this file disagrees with those, trust those.

## What this is

**Lantern 7** (repo/Firebase name: `neon-vector-defense`) is a polished sci-fi
tower-defense game and one of Ethan's two flagship portfolio projects. It plays
as a fast arcade defense game — 12 sectors on an interactive starmap, 4
protocols (Recruit → Extinction), 21 towers with dual upgrade tracks, 6
commander abilities, ~19 enemy archetypes with elite variants, plus weekly
modes (Weekly Mutation, Champion's Gauntlet, the three-leg Gauntlet Protocol
roguelite), a UTC Daily Challenge, freeplay continuation, and a cosmetic-only
meta loop (Warden Rank / Salvage / Operations Board).

The engineering headline is a **deterministic headless engine**: seeded RNG and
a fixed timestep make every run bit-reproducible. The *same* engine powers live
play, the replay viewer, headless balance simulations, bot playtests, perf
harnesses, and server-side anti-cheat. Runs are recorded as compact (~5KB)
packed action streams ("r3" format, replay engine now at v6); leaderboard
submissions are **re-simulated inside Cloud Functions** from that action stream
and verified against canonical balance/challenge snapshots before a score is
trusted. Replays are publicly watchable at `/?run=<runId>`.

It is **live in production**: https://neon-vector-defense-7.web.app
(recruiter demo: `/?demo=1` — unlocks everything, no persistence, no telemetry).
239+ commits, CI + CodeQL on GitHub, e2e Playwright suites, security test
suites for Firestore rules / Functions / the Worker.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript 6, Vite 8, Canvas 2D (1280x720 logical, supersampled offscreen sprites) |
| Backend | Firebase: Hosting, Firestore, anonymous Auth, Cloud Functions (Node 22) |
| AI helper proxy | Cloudflare Worker (`worker/openrouter-proxy.js`) -> OpenRouter, rate-limited, key never in browser |
| Tooling | tsx, node:test, Jest, Playwright, firebase-tools, GitHub Actions (ci.yml, codeql.yml, deep-checks.yml, 2 manual deploy workflows) |
| Node | >= 20 root tooling, >= 22 for Functions |

Firebase project id: `neon-vector-defense-7`. Remote:
`https://github.com/Calculator5329/neon-vector-defense.git` (default branch
`master`, **not** `main`).

## Directory map

```
src/                 React UI (App.tsx, AdminDashboard, ReplayViewer, menu/, game-ui/, widgets/)
src/game/            The whole game domain — headless, UI-free TypeScript
  engine.ts          Core fixed-timestep simulation (movement, combat, abilities, freeplay)
  towers.ts / enemies.ts / waves.ts / eliteAffixes.ts   Content + stat math
  maps.ts            12 sectors (MAPS + MAPS2 + MAPS3 -> ALL_MAPS), DIFFICULTIES (4 protocols)
  bot.ts             Headless bot AI: rookie / standard / expert
  runTelemetry.ts / replayCodec.ts   Run recording, r3 packed action streams
  reSimulate.ts      Deterministic replay re-simulation (shared client/server concept)
  leaderboard.ts / firebaseClient.ts / balanceConfig.ts   Service facades
  meta.ts            Cosmetic/QoL meta ONLY — must never touch combat/score (guarded by npm run meta:sim)
  gauntletProtocol.ts / weeklyChallenge.ts / dailyChallenge.ts / freeplay.ts   Modes
functions/           Cloud Functions (TS -> lib/): score validation callables, replay
                     re-simulation/verification (replayIntegrity.ts), rate limits,
                     feedback, admin-only deletion. Entry: functions/src/index.ts
worker/              Cloudflare Worker AI-helper proxy (wrangler.toml)
scripts/             Headless harnesses + generation pipelines (see commands below)
tests/               unit/ (engine correctness), e2e/ (Playwright), security/ (Firestore
                     rules), functions/, callables/ (emulator-backed), worker/, jest/
docs/                architecture.md, tech_spec.md, decision_log.md, roadmap.md,
                     idea_backlog.md (80-idea audit), changelog.md, runbooks/ (deploy,
                     firebase-operations, app-check-rollout, portal-submission, data-reset)
public/              Generated art/audio, balance-report.json (committed on purpose as
                     demo/admin-dashboard data), sw.js
firestore.rules / firestore.indexes.json / firebase.json   Firebase config
.codex/              Prior agent prompt/handoff archive — useful history, don't edit
```

## Client / Functions / Worker split

- **Client** does everything gameplay; Firebase web keys in client source are
  public identifiers by design — the protection layer is `firestore.rules` +
  Functions. Leaderboards are public-read, **write-locked**: scores enter only
  through validating callables.
- **Cloud Functions** re-simulate the submitted r3 action stream, verify replay
  token + manifest chunk counts + action hash, check the replay summary against
  the claimed board, canonicalize scores, and write board rows with server
  timestamps. Admin console (`/admin`, Google sign-in + email allowlist in
  `functions/src/adminEmails.ts`) handles balance hot-patches
  (`config/balance` Firestore doc — no redeploy needed), champion crowning,
  telemetry/feedback triage, privacy deletions, and on-demand `verifyRun`
  re-simulation badges.
- **Worker** is only the AI field assistant proxy (OpenRouter key server-side,
  usage limits). Optional — the widget hides if `VITE_AI_HELP_URL` is unset.

## Replay-verification design (the anti-cheat spine)

1. `RunRecorder` captures deterministic player actions during play (placements,
   upgrades, ability casts, target filters, wave starts).
2. `makePublicRun()` writes `runs/{runId}` with setup snapshot, summary, first
   action window, and a **required completion manifest**; overflow actions go to
   `runs/{runId}/chunks/cN`. A browser-local replay token's hash binds ownership
   (`replayOwners/{uid}/runs/{runId}`).
3. Score callables re-simulate from setup+actions and reject divergence.
   Balance changes are versioned (`mapVersions.ts`, replay engine v3..v6) so old
   replays survive map re-tunes (see commit `852d4fa`).
4. `ReplayViewer` re-runs the real engine for frame-accurate playback with
   budgeted seeks; legacy/partial records fall back to cosmetic reconstruction.
   **v2 replays are unwatchable** since the v3 cutover — by design.

Anything that changes combat math, wave composition, map geometry, or the
action codec is a **replay-schema-coupled change**: it must bump versions and
ship hosting + rules + functions together, or live scores break.

## Exact commands (verified against package.json, 2026-07-05)

```bash
npm install                # root; functions/ and worker/ have their own package.json
npm run dev                # Vite dev server
npm run build              # tsc + vite build -> dist/
npm run preview            # serve the built app

# Headless bot playtests (public game API; keeps difficulty targets honest)
npm run sim                # full matrix — NOTE: currently 3 skills x 3 maps x 3 difficulties
npm run sim -- quick       # fewer seeds

# Balance harness (tower efficiency, solo viability, strategy matrix)
npm run balance            # full: uses ALL_MAPS (12 sectors), writes public/balance-report.json
npm run balance -- quick   # smaller matrix
npm run balance:gate       # quick + --gate --out test-results/balance-gate-report.json,
                           # then balance-check.ts diffs vs the committed baseline
npm run tower:deep-dive    # regenerates docs/tower-balance-deep-dive.md

# Perf
npm run perf               # headless engine stress timing (perf:quick for CI-size)
npm run perf:browser       # live FPS sampling via /?perf= route

# Tests
npm run test:engine        # tsx --test tests/unit/*.test.ts (fast, no emulator)
npm run test:e2e           # Playwright (tests/e2e/run-playwright.mjs; :headed, :prod variants)
npm run test:jest          # jest --runInBand
npm run meta:sim           # guard: meta.ts stays off the engine/score import path
npm run test:security      # rules + worker + functions + callables (needs Firebase
                           # emulators + Java; run npm run check:deploy-env first)
npm run ci                 # full local approximation of the GitHub Actions gate (slow)
```

Gotchas: `npm run sim` iterates `MAPS` (the original 3 sectors), while
`balance.ts` iterates `ALL_MAPS` (all 12) — bot-playtest coverage of sectors
4-12 is a known gap. `test:security` needs the Firebase emulator suite and a
JDK; `check:deploy-env` verifies prerequisites.

## Deployment story

- **Working path (manual, operator machine with Firebase CLI logged in):**
  ```bash
  npm run build
  npx firebase deploy --only hosting,firestore:rules,functions --project neon-vector-defense-7
  ```
  The build step is NOT optional — hosting uploads `dist/` as-is (no hosting
  predeploy hook). Always ship hosting + rules + functions **together** (replay
  schema couples them). Post-deploy smoke: `/build-tag.json` must show the new
  tag; unauthenticated `verifyRun` must return `PERMISSION_DENIED: admin-only`.
  Full detail: `docs/runbooks/deploy.md`.
- **GitHub Actions deploy workflows exist but are NOT wired** — no
  `FIREBASE_SERVICE_ACCOUNT_JSON` secret; every dispatch fails at credential
  prep. Red runs of those two workflows mean "credentials missing", not
  "deploy broken". Wiring steps are in the runbook (owner action).
- Portal builds: `npm run build:crazygames` / `npm run build:poki`
  (`scripts/build-portal.mjs`, `docs/runbooks/portal-submission.md`).

## Known limitations / open owner items (as of 2026-07-05)

- App Check: client + functions support staged rollout, but console
  registration + `ENFORCE_APP_CHECK=true` are pending (runbook exists).
- Stripe MVP, CrazyGames/Poki accounts + store art: owner-side launch-gate
  items, not started in code beyond portal SDK adapters.
- GH Actions deploys unwired (above); deploys are manual.
- Bot sim matrix covers only the first 3 sectors (above).
- v2 replay links dead post-v3; pinned spotlight runs needed refresh.
- README name mismatch: game is "Lantern 7", repo/URL/project stay
  `neon-vector-defense` — intentional (brand rename, commit `5a565d0`).
- No CLAUDE.md exists at repo root (see docs/CLAUDE-SUGGESTIONS-HANDOFF.md).
- Secrets live in `.env.local` (gitignored) and Worker secrets — never commit;
  `.gitleaks.toml` is configured.

## Concurrent-work warning

This repo is actively worked by Ethan **and multiple agents** (see `.codex/`
prompt archive and remote branch `claude/replay-accuracy-towers-em7o0k`).
Before ANY change: run `git status` and `git log --oneline -5`, and stop if the
tree is dirty or HEAD moved unexpectedly mid-session.
