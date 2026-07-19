# DISPATCH — Module-stub qa-screens Firestore reads

Follow-up implementation task derived from [`DESIGN.md`](./DESIGN.md).

## Task spec

- **title:** `[refactor] Module-stub Firestore reads in the qa-screens scaffold`
- **goal:** Replace qa-screens' request-level Firestore failure mock with
  deterministic module-level read stubs, retain a zero-request network sentinel,
  and assert that screenshot runs emit no console/page errors.
- **owns:**
  - `tests/e2e/qa-module-stubs.ts` (new shared E2E helper)
  - `tests/e2e/qa-regression.spec.ts` (import the extracted helper; no behavior change)
  - `tests/e2e/qa-screens.spec.ts` (install read stubs and noise assertions)
- **test-cmd:**
  `npm run typecheck:all && node ./tests/e2e/run-playwright.mjs tests/e2e/qa-screens.spec.ts && node ./tests/e2e/run-playwright.mjs tests/e2e/qa-regression.spec.ts`
- **model tier:** smart

## Exact implementation

1. Create `tests/e2e/qa-module-stubs.ts` and move the existing
   `replacementFor()` and `fulfillPatched()` implementations out of
   `qa-regression.spec.ts`. Export both functions and preserve their current
   failure behavior. Update `qa-regression.spec.ts` to import them; do not change
   its `installQaNetwork()` fixtures, return values, or assertions.

2. In `qa-screens.spec.ts`, replace `mockRemoteDataFailures()` with
   `installQaReadStubs(page)`. Use `page.route()` plus the shared helper to patch:

   - `/src/game/balanceConfig.ts`: `loadRemoteBalance` -> `return;`
   - `/src/game/dailyChallenge.ts`: `loadRemoteDailyOverride` -> `return;`
   - `/src/game/weeklyChallenge.ts`:
     `loadRemoteWeeklyOverride` -> `return;`,
     `loadRemoteWeeklyGauntlet` -> `return null;`
   - `/src/game/replaySpotlight.ts`: `fetchReplayOfTheDay` -> `return null;`
   - `/src/game/leaderboard.ts`:
     `fetchRunReplay` -> `return null;`,
     `fetchTopResult` and `fetchGlobalTopResult` ->
     `return { rows: [], error: false };`, and
     `fetchDailyTop`, `fetchWeeklyTop`, `fetchGauntletTop` -> `return [];`
   - `/src/game/entitlements.ts`: `loadEntitlements` ->
     `return Promise.resolve(entitlementSnapshot());`

   Install these routes before every first `page.goto()`.

3. Preserve a final `**/firestore.googleapis.com/**` route as a sentinel. Push
   each matching URL into `firestoreRequests`, then abort it. Assert
   `firestoreRequests` is empty at the end of every qa-screens test. The abort is
   fallback containment, not the primary mock.

4. For every qa-screens test, attach listeners before navigation:

   ```ts
   const consoleErrors: string[] = [];
   const pageErrors: string[] = [];
   page.on('console', (msg) => {
     if (msg.type() === 'error') consoleErrors.push(msg.text());
   });
   page.on('pageerror', (error) => pageErrors.push(error.message));
   ```

   Assert both arrays are empty at test end. Prefer a small local setup helper
   returning the arrays rather than duplicating listener setup across all three
   screenshot tests.

5. Keep existing screen steps, screenshot filenames, viewports, state seeds,
   auth/callable mocks, and `PLAYWRIGHT_PREVIEW` skip unchanged. Add/retain
   assertions that make the deterministic states explicit:

   - leaderboard does not contain `uplink failed`;
   - unavailable replay still contains `REPLAY UNAVAILABLE`;
   - Operations cosmetics render from the local seed.

## Guardrails

- Do not edit anything under `src/`, `firestore.rules`, `firebase.json`, or
  production configuration.
- Do not add a production-only test hook or a Firestore SDK mock package.
- Do not remove the catch-all Firestore route or allowlist its console errors.
- Do not change qa-regression's real recorder/replay fixture semantics while
  extracting its helper.
- Do not use a live Firebase project or deploy anything.

## Definition of done

All DESIGN acceptance criteria pass. The qa-screens runner output has no
Firestore offline warnings/errors, its recorded Firestore request list is empty,
and the shared helper extraction leaves qa-regression green.
