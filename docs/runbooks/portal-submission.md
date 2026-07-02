# Portal Submission Runbook

This runbook covers portal-specific builds for CrazyGames and Poki. The default
Firebase Hosting build remains `npm run build` with `VITE_PORTAL` unset.

## Build Artifacts

- CrazyGames: `npm run build:crazygames`
- Poki: `npm run build:poki`
- Upload artifact: the generated `dist/` directory, preserving `index.html`,
  `assets/`, `audio/`, `art/`, `fonts/`, `manifest.webmanifest`, service worker
  files, and `build-tag.json`.

## SDK Integration Covered

- CrazyGames SDK v3 runtime script is loaded from
  `https://sdk.crazygames.com/crazygames-sdk-v3.js`.
- Poki SDK runtime script is loaded from
  `https://game-cdn.poki.com/scripts/v2/poki-sdk.js`.
- Lifecycle events are wired through `src/game/portal.ts`: loading,
  gameplay start/stop, midgame ad breaks, and CrazyGames happytime moments.
- Ad breaks are requested only at natural pauses: game-over and return-to-menu.
  Rewarded ads are stubbed behind a disabled flag until economy design is ready.
- Under-13 players skip ad breaks locally before any SDK ad request is made.

## Policy Constraints

- Portal builds hide the privacy-policy menu link and omit replay-link sharing
  from dossier cards.
- Default Firebase Hosting CSP does not include portal origins.
- Portal builds inject a CSP meta tag with only the active portal SDK origins
  added to the app's existing runtime dependencies.
- Poki may require approval for external network calls used by Firebase
  leaderboards, anonymous auth, feedback, and AI-help worker calls.

## QA Steps

- CrazyGames: run `npm run build:crazygames`, upload `dist/` to the CrazyGames
  local/QA tool, and verify SDK initialization, loading stop, gameplay start/stop,
  happytime, and midgame ad callbacks.
- Poki: run `npm run build:poki`, inspect with the Poki SDK tooling/Inspector,
  and verify `gameLoadingFinished`, `gameplayStart`, `gameplayStop`, and
  `commercialBreak`.
- Local mock SDK checks:
  - `VITE_PORTAL=crazygames node ./tests/e2e/run-playwright.mjs --preview tests/e2e/portal-sdk.spec.ts`
  - `VITE_PORTAL=poki node ./tests/e2e/run-playwright.mjs --preview tests/e2e/portal-sdk.spec.ts`

## Remaining Before Submission

- Create/verify portal publisher accounts and game records.
- Prepare store copy, thumbnails, capsule art, screenshots, and age ratings.
- Confirm each portal's CSP/network approval expectations for Firebase,
  Cloud Functions, and the AI-help worker.
- Decide whether portal builds should disable public leaderboards, feedback, or
  AI help if a portal rejects those outbound requests.
