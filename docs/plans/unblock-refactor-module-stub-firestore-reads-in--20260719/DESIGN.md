# DESIGN — Quiet, deterministic Firestore reads in QA screenshots

**Item:** `[refactor] Module-stub Firestore reads in the qa-screens scaffold`  
**Decision:** APPROVED (Ethan)  
**Source finding:** `docs/qa_audit.md:32` (P2 harness polish; not a product bug)

## Outcome

`tests/e2e/qa-screens.spec.ts` must render the same offline/synthetic QA surfaces
without starting the Firestore SDK or emitting the SDK's expected offline errors.
The screenshot suite remains a dev-server-only harness and uses the module-source
replacement pattern already proven in `qa-regression.spec.ts`.

This is a test-harness refactor only. Production modules, Firestore rules,
Firebase configuration, and player behavior do not change.

## Current cause

`mockRemoteDataFailures()` aborts every request to
`firestore.googleapis.com`. That prevents live data from affecting screenshots,
but it does so after player modules have imported Firestore and attempted reads.
The Firebase SDK reports those aborted connections as offline console noise.

The screenshot flow can reach Firestore through several independent seams:

| Screen path | Read seam to replace | Deterministic result |
| --- | --- | --- |
| App boot / periodic refresh | `loadRemoteBalance`, `loadRemoteDailyOverride`, `loadRemoteWeeklyOverride` | resolve without an override |
| Weekly card state | `loadRemoteWeeklyGauntlet` | `null` |
| Deploy menu | `fetchReplayOfTheDay` | `null` |
| Leaderboard tab | `fetchTopResult`, `fetchGlobalTopResult` | `{ rows: [], error: false }` |
| Ritual leaderboard modes | `fetchDailyTop`, `fetchWeeklyTop`, `fetchGauntletTop` | `[]` |
| `?run=` unavailable shell | `fetchRunReplay` | `null` |
| Operations cosmetics | `loadEntitlements` | the current local `entitlementSnapshot()` wrapped in a resolved promise |

Stubbing only `firestoreLazy.firestore()` is intentionally rejected: callers
would still enter error paths, screenshots would show uplink failures instead of
stable empty states, and the harness would no longer describe each synthetic
read result explicitly.

## Harness structure

Extract the small source-replacement primitives currently local to
`qa-regression.spec.ts` into one E2E-only helper module:

- locate a named function declaration and replace only its body;
- fetch the Vite-served module response, apply a patch, and fulfill the route;
- fail loudly with an HTTP 500 and useful error when an export cannot be found.

Both QA specs import these primitives. `qa-regression.spec.ts` keeps its current
fixtures and write-path behavior; this extraction must be behavior-neutral for
its full real-flow suite.

Add `installQaReadStubs(page)` in `qa-screens.spec.ts`. It installs routes for
the modules above before the first navigation in every screenshot test. Keep a
catch-all Firestore route after the module routes as a sentinel: record the URL
and abort it. A passing run must record no Firestore request at all.

## Assertions and evidence

Each screenshot test records:

- `console` messages of type `error`;
- uncaught `pageerror` messages;
- requests matching `firestore.googleapis.com`.

At the end of the test, assert all three arrays are empty. These assertions turn
the audit's documented runner noise into a durable regression boundary instead
of relying on a human to inspect terminal output. Existing screenshot names,
viewports, local-state fixtures, callable mocks, and visual assertions remain
unchanged.

The unavailable-replay capture must still show `REPLAY UNAVAILABLE`; the
leaderboard capture must show a successful empty-board shell, not an uplink
failure. The Operations capture must retain the locally seeded cosmetics.

## Scope and guardrails

- E2E harness files only; no source module, Firebase rule, or production test
  hook is edited.
- No emulator, live Firebase project, credentials, or external network is used.
- Keep `qa-screens.spec.ts` skipped under `PLAYWRIGHT_PREVIEW=1`, because Vite
  source-module interception is unavailable in the production bundle.
- Keep the catch-all Firestore abort route as a safety net, even though the
  expected request count is zero.
- Do not weaken console assertions with an allowlist for Firestore noise.

## Acceptance criteria

- [ ] The screenshot inventory completes for desktop, mobile, and the existing
  short-landscape/menu-polish variants.
- [ ] No request reaches `firestore.googleapis.com` during any qa-screens test.
- [ ] No console error or uncaught page error occurs during qa-screens.
- [ ] Leaderboard, Operations, and unavailable-replay screenshots still render
  their intended stable states.
- [ ] `qa-regression.spec.ts` remains green after extracting the shared module
  patch primitives.
- [ ] TypeScript validation remains green.

Implementation is specified in [`DISPATCH.md`](./DISPATCH.md).
