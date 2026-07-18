# Replay pipeline E2E verification — design + execution plan

**Roadmap item:** "Replay pipeline E2E verification (Ethan directive 2026-07-11)."
(`docs/roadmap.md`, Portal launch checklist.)
**Ethan decision (verbatim):** APPROVED.
**Task:** `unblock-replay-pipeline-e2e-verification-ethan-d-20260718`
**Author:** claude lane, 2026-07-18. **Repo fence:** `agents: docs-only` — this
lane is docs/plan only; all source work is specified in [`DISPATCH.md`](./DISPATCH.md).

---

## Verb served / consumes / emits (Layer-4)

- **Verb served:** *Prove* — give the owner a single, on-demand, machine-checked
  proof that a recorded run round-trips through the full replay pipeline to a
  `verified` verdict, and that a tampered replay yields `divergent`.
- **Consumes:** a scripted/seeded `Game` run → `buildRunUploadBundle`
  (`src/game/runTelemetry.ts`) → manifest + `actionHash` → an upload surface
  (mock store *or* the real Firestore `runs/{runId}` + chunk collection) →
  `verifyRun` callable / `reSimulate`.
- **Emits:** a `ReSimVerdict` (`verified` | `divergent` | `unverifiable`) plus a
  divergence descriptor, reproduced identically on demand.
- **v1 already shipped (see Evidence):** the verify/re-sim engine, its verdict
  logic, the termination guard, and broad test coverage all exist and pass.
- **v1 gaps this item closes:** the *named repeatable script* is hollow and
  uncovered; the owner-observed viewer bugs are diagnosable but unsurfaced;
  no variable-frame-pacing determinism lock. See **Gaps** and `DISPATCH.md`.

---

## Directive vs. reality — the honest status

The 2026-07-16 owner note (`docs/roadmap.md` lines 15–21) says this item is
"NOT proven" and supersedes the 2026-07-11 directive. That is **accurate only in
four narrow senses (A–D below)**. The core claim the directive asks for — *both
verdicts reproduce on demand on the real pipeline* — is in fact **already
satisfied by existing, passing tests**. The confusion is that the artifact the
directive names (a repeatable E2E *script*) is not the thing actually doing the
proving, and the owner-observed failures live in the **replay viewer**, not in
the verify/re-sim pipeline.

### Evidence the pipeline works (verified by direct source + test reading)

| Layer | File | What it proves | Runs in |
| --- | --- | --- | --- |
| Engine determinism | `src/game/engine.ts:1662-1681` | **True fixed-timestep accumulator** — `accumulator += min(rawDt,0.05)*speed`, then steps exact `SIM_STEP` ticks. Tick *sequence* is frame-pacing-independent → live and re-sim produce identical ticks. | — |
| Re-sim verdict logic | `src/game/reSimulate.ts:146-253` | Manifest/`actionHash` re-check, action replay, `compareSummary` over kills/score/etc. → `verified`/`divergent`/`unverifiable`. | — |
| Termination guard | `src/game/reSimulate.ts:275-285` | `advanceToTick` bounds the sim at `guard < 1_200_000` ticks and `phase!=='gameover'`, returning `unverifiable: 're-simulation step limit exceeded'` — **cannot hang.** | — |
| Viewer SIMULATING-loop fix | `src/game/reSimulate.ts:639-645` | The owner-reported "SIMULATING forever" was viewer rewind-thrash; fixed with a 1-tick rewind grace. Test: `reSimulate.test.ts:439` "sub-tick backward jitter never rebuilds from the seed". | `test:engine` |
| Combat re-sim, verified | `tests/unit/reSimulate.test.ts:245-296` | `verified` on **real combat** campaigns (seeds 123/223/987/654/77/404/321…), incl. daily, weekly, freeplay relic/risk, elite waves + Umbra boss, mid-run tower unlock, recalibrate. | `test:engine` |
| Divergent + unverifiable | `tests/unit/reSimulate.test.ts:298-381` | tampered summary → `divergent` (field `kills`); tampered action → `divergent`; stale manifest / engine / balance → `unverifiable`. | `test:engine` |
| Playback kill parity | `tests/unit/replay-fidelity.test.ts:65-102` | Client `createReplayPlayback` driver reproduces **exact** `kills`/`leaks`/`wave` and deterministic budgeted seeks. | `test:engine` |
| Server upload path | `tests/callables/callables-emulator.test.ts:728-753` | Real Firestore upload → `verifyRun` callable → `verified` stored on the row; `unverifiable` cases. Server uses the **same** `reSimulate` code, bundled by `scripts/bundle-resim.mjs` (`functions/package.json` prebuild). | `test:callables` |

**Conclusion:** the replay verify/re-sim pipeline is *working and tested* end to
end, including the exact `verified`/`divergent` reproduction the directive asks
for and the two owner-reported failure classes' root causes. The item is not a
bug hunt; it is a **packaging + surfacing + regression-lock** job.

---

## Gaps (the real, closeable work) — "breakages found"

**A. The named repeatable script is combat-free AND never executed.**
`scripts/replay-e2e.ts` does record→manifest→mock-upload→`verifyRun`→`verified`
plus tamper→`divergent`, but it *deliberately avoids combat* (lines 64-67: "advance
a couple of deterministic sim-seconds without starting combat"), so it never
exercises enemy deaths — the exact thing the owner doubts. Worse, its only "test"
is `tests/jest/replay-e2e.test.cjs`, which **reads the file as text and greps for
string literals** (e.g. `expect(source).toContain("console.log('replay-e2e: PASS')")`)
— it never runs the script. The script is also absent from every `package.json`
script (`ci`, `test`, `test:engine`). So the directive's own named deliverable
proves nothing on demand.

**B. Owner bug #1 ("enemies don't die accurately in replay") is a viewer
fallback, not a determinism defect.** `src/ReplayViewer.tsx:581-582` builds the
frame-accurate driver **only when `run.integrity === 'complete'` and
`createReplayPlayback(run)` returns non-null**. Otherwise it silently falls back
to `reconstructAt` — a *cosmetic reconstruction* where "enemies stream down the
path off scrub time" (`ReplayViewer.tsx:126`), which is not a sim and will show
inaccurate deaths. `createReplayPlayback` returns `null` on schema/engine/balance
drift, marathon caps (`PLAYBACK_MAX_DURATION_S=3600`, `PLAYBACK_KILL_CAP=250000`),
or missing tick timing (`reSimulate.ts:546-590`). None of these are surfaced to
the viewer — the owner sees a fake battle with no indication why.

**C. The server verify path has a *tick-count* guard but no *wall-clock*
timeout — the true root cause of owner bug #2.** `advanceToTick`
(`reSimulate.ts:275-285`) caps at `guard < 1_200_000` ticks (~5.5h of sim per
advance call) but has **no `performance.now()` deadline**. `verifyRunCore`
(`functions/src/index.ts:606-625`) calls `reSimulate` synchronously, so a dense
marathon run (thousands of live enemies/tick) can burn minutes of real CPU
*under* the tick cap and hit the Cloud Function timeout — which presents exactly
as "verification stuck in simulating loops." Note the asymmetry: the **playback**
stepper (`reSimulate.ts:618-632`) already carries a `budget.deadline` wall-clock
check; the **server verify** path does not. Additionally, no E2E asserts the
divergent path or the anti-hang bound on the *server* callable — the callable
emulator test covers `verified` + `unverifiable` only; tamper→`divergent` is
proven solely at the unit/mock layer.

> **Aggregate-vs-frame nuance:** `compareSummary` (`reSimulate.ts:391-418`)
> compares 20 *aggregate* summary fields (`kills`, `credits`, `cashEarned`,
> `leaks`, `coresLeft`, `scoreMultiplierEnd`, …), **not** per-enemy kill frames.
> Frame-level kill parity is proven only by the *playback driver* fidelity test
> (`replay-fidelity.test.ts:65-102`, exact `kills`/`leaks`/`wave`). The owner's
> acceptance clause ("identical kill frames/score", roadmap line 14) is therefore
> met at the aggregate + playback-driver level; the E2E in step 1 should assert
> **both** `reSimulate` summary parity *and* driver frame parity so the two are
> never separately regressed.

**D. No variable-frame-pacing determinism lock.** Every test steps uniform
`game.update(0.05)`. The owner's suspected drift is specifically about *real
browser frame jitter* vs. re-sim's uniform cadence. The accumulator design
(Gap-table row 1) makes this safe, but nothing *regression-locks* it: a future
edit to the accumulator/clamp could reintroduce drift undetected.

---

## Execution plan (implemented by `DISPATCH.md`)

1. **Turn `scripts/replay-e2e.ts` into a real, combat-driven, multi-seed E2E**
   that actually runs. Record seeded runs *through waves with enemy deaths*
   under **jittered variable frame pacing** across **≥3 seeds**; assert
   `verified` with exact kill/score parity on each; assert tamper→`divergent`;
   assert a pathological/oversized bundle returns a bounded verdict under a
   wall-clock timeout (never hangs). Cover **both** `reSimulate` (server path)
   and the client `createReplayPlayback` driver reproducing identical kill
   frames.
2. **Actually execute it in CI.** Add `test:replay-e2e` (`tsx scripts/replay-e2e.ts`)
   to `package.json`, add it to the `ci` script, and **replace** the grep-only
   `tests/jest/replay-e2e.test.cjs` with either a real subprocess run or removal
   in favor of the tsx execution. The build must fail if either verdict regresses.
3. **Surface the viewer fallback (fixes owner bug #1's user-facing symptom).**
   When `createReplayPlayback` returns `null` or `integrity !== 'complete'`,
   record *which* guard tripped and show a visible "cosmetic preview — not
   frame-accurate" label instead of a silent fake battle. Add a diagnostic
   reason string on the null return path in `reSimulate.ts` for logging.
4. **Add a determinism-under-variable-pacing regression test** (`test:engine`):
   record the same input stream twice — once uniform `update(0.05)`, once with
   jittered dt — and assert byte-identical kill frames / summary, locking the
   accumulator invariant.
5. **Add a server-side tamper→`divergent` + anti-hang case** to the callable
   emulator test (or an equivalent bundle-level test) so all three verdicts are
   proven on the real server code.

## Acceptance (matches the roadmap "Accept" clause)

- `npm run test:replay-e2e` executes end-to-end and prints **both** verdicts
  (`verified` and `divergent`) plus an `unverifiable`/bounded case, on **≥3
  seeds with real combat**, and is part of `npm run ci`.
- Re-running is idempotent: verdicts reproduce on demand; the run exits non-zero
  if any verdict regresses or the re-sim exceeds its wall-clock budget.
- The viewer no longer silently shows a cosmetic reconstruction as if it were
  the real battle; the fallback reason is logged and labeled.
- All "breakages" (Gaps A–D) are closed by the above and recorded in
  `docs/changelog.md` by the implementing lane.

## Constraints / guardrails honored

- Public replay docs stay compact schema-v3, manifest-required, no `undefined`
  (`roadmap.md` Guardrails). The E2E only *reads* the upload bundle shape.
- `verifyRun` verdicts remain admin/audit data pre-enforcement; the viewer label
  in step 3 is a *fidelity* notice ("cosmetic preview"), **not** a verification
  badge or divergence detail — it must not expose `verified`/`divergent` to
  players (`roadmap.md` Guardrails: "player-facing views must not expose
  verification badges or divergence details").
- No combat/score/bot/unlock math changes — this is verification + viewer-label
  + test scaffolding only.

## Blocker for the follow-up lane ([ETHAN])

The repo manifest fences this repo `agents: docs-only`. The steps above touch
`scripts/`, `package.json`, `tests/`, and `src/ReplayViewer.tsx` (+ a diagnostic
string in `src/game/reSimulate.ts`). The implementing lane therefore needs an
**Ethan fence promotion to `agents: full`** (or an explicitly approved code
lane) before it can run. `DISPATCH.md` carries the exact spec; it is
ready-to-run the moment the fence is promoted.
