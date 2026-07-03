# Deploy runbook

## Current deploy path (working)

Production deploys run from an operator machine with the Firebase CLI logged in:

```
npm run build
npx firebase deploy --only hosting,firestore:rules,functions --project neon-vector-defense-7
```

**The build step is NOT optional.** Hosting uploads `dist/` as-is — there is no
hosting predeploy hook (only functions has one). Deploying without a fresh
build ships a stale client against new rules/functions; with a schema-coupled
change that breaks score submission until hosting is redeployed. Confirm the
served `/build-tag.json` CHANGED after every deploy.

Always ship hosting + rules + functions together — the replay schema couples
them (rules validate shapes the client writes and functions verify). Post-deploy
smoke: fetch `/build-tag.json` for the new tag, probe a callable (an
unauthenticated `verifyRun` call must return `PERMISSION_DENIED: admin-only`).

## GitHub Actions deploy workflows (present but NOT wired)

`firebase-deploy.yml` (hosting + rules + indexes) and
`firebase-functions-deploy.yml` (functions) are manual `workflow_dispatch`
workflows gated to `refs/heads/master`. They run the full validation gate
before deploying. **They have never succeeded** because the repository has no
deploy credentials configured; every attempt fails at "Prepare Firebase
Credentials" with empty env values.

To make them functional (owner actions):

1. Google Cloud console → IAM → Service Accounts (project
   `neon-vector-defense-7`): create `github-deployer` with roles
   **Firebase Hosting Admin**, **Cloud Functions Developer**,
   **Firebase Rules Admin**, **Cloud Datastore Index Admin**, and
   **Service Account User** on the App Engine default service account
   (functions deploy impersonates it). Create a JSON key.
2. GitHub repo → Settings → Secrets and variables → Actions:
   - Secret `FIREBASE_SERVICE_ACCOUNT_JSON` = the JSON key contents.
   - Variable `FIREBASE_PROJECT_ID` = `neon-vector-defense-7`.
3. (Recommended) Settings → Environments → `production`: add a required
   reviewer so a dispatch needs an explicit approval click.
4. Test with the hosting workflow first (safer to re-run), then functions.

Until then, treat red runs of these two workflows as "credentials missing",
not "deployment broken". The old `deploy.yml` workflow was deleted on
2026-06-27; its failed runs in the Actions tab are orphaned history.

## History of failed runs (2026-06 → 2026-07-02)

- `deploy.yml` push-triggered failures (2026-06-27): superseded workflow,
  deleted the same day. Ignore.
- `Firebase Hosting and Rules Deploy` / `Firebase Functions Deploy`
  workflow_dispatch failures (2026-06-28): missing secret/variable, see above.
- CI failure at `36e947c` (2026-07-02): fb-toggle hover scale flaked a
  ui-stability rect capture; fixed in `e6a905b` (pointer parked before
  captures). Not deploy-related.
