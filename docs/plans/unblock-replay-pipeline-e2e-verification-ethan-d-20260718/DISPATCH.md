# DISPATCH — Replay pipeline E2E: real script + viewer surfacing + determinism lock

Ready-to-run follow-up task spec for the source work designed in
[`design.md`](./design.md). This lane is **docs/plan only** (repo fence
`agents: docs-only`, per `docs/roadmap.md` lines 20–21); the spec below cannot be
executed until the blocker clears.

## [ETHAN] BLOCKER — fence promotion required

The repo manifest fences `neon-vector-defense` `agents: docs-only`. Every change
below touches source (`scripts/`, `package.json`, `tests/`, `src/ReplayViewer.tsx`,
`src/game/reSimulate.ts`). Dispatch is blocked until Ethan **promotes the fence to
`agents: full`** (or explicitly approves this one code lane). Nothing else is
undecided — the decision on the item itself is already `APPROVED`.

---

## Task spec (paste into agent-orchestrator)

- **title:** `Replay pipeline E2E: real combat-driven script + viewer fidelity label + determinism lock`
- **goal:** Close Gaps A–D from the design doc in this folder. Make the replay pipeline's `verified`/`divergent` proof reproduce on demand from a real, combat-driven, CI-wired E2E across >=3 seeds under jittered frame pacing; surface the viewer's silent cosmetic fallback; give the server verify path a wall-clock timeout; and regression-lock accumulator determinism under variable dt. No combat/score/bot/unlock math changes — verification, viewer-label, and test scaffolding only.
- **owns:**
  - `scripts/replay-e2e.ts`
  - `package.json` (scripts block only: add `test:replay-e2e`, wire into `ci`)
  - `tests/jest/replay-e2e.test.cjs` (replace grep-only test)
  - `tests/unit/replay-determinism.test.ts` (new)
  - `tests/callables/callables-emulator.test.ts` (add tamper->divergent + anti-hang case)
  - `src/ReplayViewer.tsx` (fidelity label only)
  - `src/game/reSimulate.ts` (diagnostic null-reason string + wall-clock deadline on the server verify path)
  - `docs/changelog.md` (record shipped work)
- **test-cmd:** `npm run test:replay-e2e && npm run test:engine && npm run test:jest`
  (full gate before merge: `npm run ci`; callable coverage: `npm run test:callables`)

---

## Work items (each closes a numbered Gap from `design.md`)

### 1. Gap A — make `scripts/replay-e2e.ts` a real, combat-driven, multi-seed E2E

`scripts/replay-e2e.ts` today records a combat-free run (lines 64–67: "advance a
couple of deterministic sim-seconds without starting combat") and is never
executed by any test. Rewrite it to:

- Record seeded runs **through waves with real enemy deaths** on **>=3 seeds**
  (reuse the combat seeds already proven in `tests/unit/reSimulate.test.ts:245-296`,
  e.g. 123 / 223 / 987, so the fixture is known-verifiable).
- Drive each run under **jittered variable frame pacing** — feed `game.update(dt)`
  with a deterministic non-uniform `dt` stream (seeded from the run seed, no
  `Math.random()`), not the uniform `Game.SIM_STEP / speed` the current script and
  every existing test use. This exercises the accumulator invariant the owner doubts.
- For each seed assert: `reSimulate(...)` -> `verified` **and** exact summary parity
  (`kills`/`credits`/`cashEarned`/`leaks`/`coresLeft`, per `compareSummary`,
  `reSimulate.ts:391-418`).
- For each seed also drive the **client `createReplayPlayback` driver**
  (`reSimulate.ts:632-648`) to end-of-run and assert it reproduces **identical
  kill frames** (`kills`/`leaks`/`wave`), mirroring `replay-fidelity.test.ts:65-102`.
  This binds the aggregate re-sim and the frame-accurate driver together so they
  can never be separately regressed (design "Aggregate-vs-frame nuance").
- Keep the existing tamper->`divergent` path (`tamperPlayerAction`) and assert
  `divergent` on the **combat** bundle.
- Add a **pathological/oversized** bundle case that asserts the server verify path
  returns a bounded verdict (`unverifiable` step-limit or the new wall-clock
  timeout from item 4) **without hanging** — see item 4 for the guard.
- Exit non-zero on any verdict/parity regression; keep the `replay-e2e: PASS`
  final line. Keep it CI-affordable (cap waves per seed so the whole script stays
  well under a minute).

### 2. Gap A (cont.) — actually execute it in CI

- Add to `package.json` scripts: `"test:replay-e2e": "tsx scripts/replay-e2e.ts"`.
- Insert `npm run test:replay-e2e` into the `ci` chain (before `test:security`).
- **Replace** `tests/jest/replay-e2e.test.cjs` — today it `readFileSync`s the
  script and greps for string literals (`expect(source).toContain(...)`), proving
  nothing. Either (a) spawn the script as a subprocess and assert exit 0 + `PASS`
  in stdout, or (b) delete it and rely on the `test:replay-e2e` gate. Prefer (a)
  so `test:jest` still fails loudly if the script breaks.

### 3. Gap B — surface the viewer's silent cosmetic fallback (owner bug #1 symptom)

`src/ReplayViewer.tsx:582` builds the frame-accurate driver only when
`run.integrity === 'complete'` **and** `createReplayPlayback(run)` returns
non-null; otherwise it silently falls back to `reconstructAt` (a cosmetic
reconstruction, `ReplayViewer.tsx:126`, used at lines 799/818) that shows
inaccurate deaths with no indication why.

- In `reSimulate.ts`, add a **diagnostic reason** on each `createReplayPlayback`
  null-return path (schema/engine/balance drift, `PLAYBACK_MAX_DURATION_S`,
  `PLAYBACK_KILL_CAP`, missing tick timing — around `reSimulate.ts:546-590`).
  Return it via a side channel or a small `{ playback, reason }` result so the
  viewer can log it. Do **not** change the null semantics existing callers depend on.
- In `ReplayViewer.tsx`, when `driver` is null / integrity incomplete, render a
  visible **"cosmetic preview — not frame-accurate"** label and `console.warn` the
  reason.
- **Guardrail:** this is a *fidelity* notice, NOT a verification badge. It must
  never expose `verified`/`divergent`/divergence details to players
  (`roadmap.md` Guardrails). Do not surface `verifyRun` verdicts here.

### 4. Gap C — wall-clock timeout on the server verify path (owner bug #2 root cause)

`advanceToTick` (`reSimulate.ts:275-285`) caps at `guard < 1_200_000` ticks but has
**no `performance.now()` deadline** — a dense marathon can burn minutes of CPU
under the tick cap and hit the Cloud Function timeout, presenting as "stuck
simulating." The **playback** stepper already has this guard
(`reSimulate.ts:628`, `performance.now() > budget.deadline`); the **server verify**
path does not.

- Add a wall-clock deadline to the re-sim verify loop (mirror the playback
  stepper's every-64-ticks `performance.now()` check). On deadline, return
  `{ verdict: 'unverifiable', reason: 're-simulation wall-clock budget exceeded' }`
  — never `divergent` (a slow run is not a dishonest run).
- Thread a configurable budget (default generous, overridable by the callable) so
  `verifyRunCore` (`functions/src/index.ts:606-625`) stays under the Function
  timeout. Keep the existing tick-count guard as the belt-and-suspenders bound.
- Assert the bound in the item-1 pathological case.

### 5. Gap C (cont.) — server-side tamper->`divergent` + anti-hang coverage

`tests/callables/callables-emulator.test.ts:728-753` covers `verified` +
`unverifiable` on the real Firestore->`verifyRun` path but **not** tamper->`divergent`.
Add a case that uploads a tampered combat replay through the emulator and asserts
the stored row verdict is `divergent`, plus a case asserting the wall-clock/tick
bound returns `unverifiable` rather than hanging. This proves all three verdicts on
the real server code (the server bundles the same `reSimulate` via
`scripts/bundle-resim.mjs`).

### 6. Gap D — determinism-under-variable-pacing regression lock

New `tests/unit/replay-determinism.test.ts` (runs under `test:engine`): record the
**same input stream twice** — once with uniform `update(Game.SIM_STEP)`, once with a
seeded jittered dt stream — and assert **byte-identical** kill frames + summary.
This locks the accumulator invariant (`engine.ts:1662-1681`) so a future
accumulator/clamp edit that reintroduces frame-pacing drift fails the build.

---

## Acceptance (matches `docs/roadmap.md` line 186 "Accept" clause)

- `npm run test:replay-e2e` runs end-to-end and prints **both** verdicts
  (`verified` and `divergent`) plus a bounded `unverifiable` case, on **>=3 seeds
  with real combat under jittered pacing**, and is wired into `npm run ci`.
- Re-running is idempotent: verdicts reproduce on demand; exits non-zero on any
  verdict/parity regression or if re-sim exceeds its wall-clock budget.
- The viewer no longer presents a cosmetic reconstruction as the real battle: the
  fallback reason is logged and a "cosmetic preview" label shows — with no
  verification badge leaked to players.
- Server verify path has a wall-clock timeout and cannot hang; all three verdicts
  proven on the real callable.
- All Gaps A–D closed; shipped work recorded in `docs/changelog.md`.

## Guardrails (must hold — from `docs/roadmap.md` Guardrails)

- No changes to combat/enemy/tower stats, score math, bot plans, or unlock
  thresholds. This is verification + viewer-label + test scaffolding only.
- Public replay docs stay compact schema-v3, manifest-required, no `undefined`.
  The E2E only *reads* the upload bundle shape.
- `verifyRun` verdicts stay admin/audit data pre-enforcement; the viewer label is a
  fidelity notice, not a verification/divergence surface.

## Evidence the underlying pipeline already works (so this is packaging, not a bug hunt)

See the design doc's "Evidence the pipeline works" table. Verified against source
in this lane: fixed-timestep accumulator (`engine.ts:1662-1681`); verdict logic
(`reSimulate.ts:146-253`); tick guard (`reSimulate.ts:275-285`); combat `verified`
across many seeds (`reSimulate.test.ts:245-296`); tamper->`divergent` /
`unverifiable` (`reSimulate.test.ts:298-381`); playback kill parity
(`replay-fidelity.test.ts:65-102`); server upload->verify
(`callables-emulator.test.ts:728-753`). The gaps this dispatch closes are the
*named script being hollow/unrun*, the *viewer's silent fallback*, the *missing
server wall-clock guard*, and the *absent variable-pacing lock* — not a broken
verify engine.
