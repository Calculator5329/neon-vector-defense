# App Check staged rollout runbook

Purpose: turn on Firebase App Check without breaking legitimate production
players. Do this in one operator sitting for setup and deploy, then wait through
the observation window before enforcement.

Project: `neon-vector-defense-7`
Production site: `https://neon-vector-defense-7.web.app`

Reference docs:

- Firebase web reCAPTCHA Enterprise setup: https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
- App Check request metrics: https://firebase.google.com/docs/app-check/monitor-metrics
- Standard service enforcement: https://firebase.google.com/docs/app-check/enable-enforcement
- Callable Functions enforcement: https://firebase.google.com/docs/app-check/cloud-functions
- App Check REST token exchange: https://firebase.google.com/docs/reference/appcheck/rest/v1/projects.apps/exchangeRecaptchaEnterpriseToken

## Preconditions

- Firebase console access for project `neon-vector-defense-7`.
- Google Cloud console access for the same project.
- Firebase CLI authenticated locally.
- Anonymous Auth and Google admin auth are already working in production.
- The functions source still sets `enforceAppCheck: APP_CHECK_ENFORCED` for every
  callable.
- Do not run `scripts/admin/wipe-server-data.mjs`.

## Stage 1: Create and register the web key

1. Open Google Cloud Console -> Security -> reCAPTCHA Enterprise for
   `neon-vector-defense-7`.
2. Enable the reCAPTCHA Enterprise API if prompted.
3. Create a Website key.
4. Add production domains:
   - `neon-vector-defense-7.web.app`
   - `neon-vector-defense-7.firebaseapp.com`
   - any custom production domain in use
5. Leave the checkbox challenge disabled. App Check uses score-based
   reCAPTCHA Enterprise keys.
6. Copy the site key.
7. Open Firebase Console -> Security -> App Check -> Apps.
8. Register the web app with provider `reCAPTCHA Enterprise` and paste the site
   key.
9. Leave the token TTL at the default for the first rollout unless there is a
   specific reason to change it.

## Stage 2: Build and deploy token issuance only

Keep enforcement off for this deployment.

```powershell
$env:VITE_FIREBASE_APPCHECK_SITE_KEY="<recaptcha-enterprise-site-key>"
$env:ENFORCE_APP_CHECK="false"
$env:NODE_ENV="production"
npm run check:deploy-env
npm run build
firebase deploy --only hosting
```

Expected preflight: `OK App Check: client token key configured; Functions
enforcement expected OFF until rollout flip; ...`.

## Stage 3: Verify tokens in production

Browser check:

1. Open `https://neon-vector-defense-7.web.app` in a normal browser profile.
2. Open DevTools -> Network.
3. Trigger one Firebase read or write path: open leaderboards, submit feedback,
   or submit a small score run.
4. Select a request to `firestore.googleapis.com` or a callable request.
5. Confirm the request headers include `X-Firebase-AppCheck`.
6. In Firebase Console -> Security -> App Check -> Apps, confirm the web app shows
   recent token activity.

REST probe:

1. In Firebase Console -> Project settings -> General -> Your apps -> Web app,
   copy the Web App ID. In the same screen, confirm the Web API key.
2. In a production page DevTools console, mint a reCAPTCHA Enterprise token:

```javascript
if (!globalThis.grecaptcha?.enterprise) {
  const script = document.createElement('script');
  script.src = 'https://www.google.com/recaptcha/enterprise.js?render=<recaptcha-enterprise-site-key>';
  document.head.append(script);
  await new Promise((resolve) => { script.onload = resolve; });
}
await new Promise((resolve) => grecaptcha.enterprise.ready(resolve));
copy(await grecaptcha.enterprise.execute('<recaptcha-enterprise-site-key>', {
  action: 'nvd_rollout_probe',
}));
```

3. Exchange it for an App Check token from PowerShell:

```powershell
$env:FIREBASE_PROJECT_ID="neon-vector-defense-7"
$env:FIREBASE_WEB_APP_ID="<web-app-id>"
$env:FIREBASE_WEB_API_KEY="<web-api-key>"
$env:RECAPTCHA_ENTERPRISE_TOKEN="<token-copied-from-browser>"
$body = @{
  recaptchaEnterpriseToken = $env:RECAPTCHA_ENTERPRISE_TOKEN
  limitedUse = $false
} | ConvertTo-Json
Invoke-RestMethod `
  -Method Post `
  -Uri "https://firebaseappcheck.googleapis.com/v1/projects/$env:FIREBASE_PROJECT_ID/apps/$($env:FIREBASE_WEB_APP_ID):exchangeRecaptchaEnterpriseToken?key=$env:FIREBASE_WEB_API_KEY" `
  -ContentType "application/json" `
  -Body $body
```

Expected result: JSON with `token` and `ttl`. A `403` or invalid-token response
means the key, app registration, domain allowlist, or project identifiers are
wrong.

## Stage 4: Observe before enforcement

Watch for at least 3 full days after the Hosting deploy, longer if traffic is
thin.

Console screens:

- Firebase Console -> Security -> App Check -> APIs tab -> Cloud Firestore
- Firebase Console -> Security -> App Check -> APIs tab -> Cloud Functions
- Google Cloud Console -> Security -> reCAPTCHA Enterprise -> the production
  site key

Proceed only when recent Firestore and Functions traffic is overwhelmingly
verified, with no meaningful invalid or unknown-origin spike tied to legitimate
user actions. Also smoke-test these production paths before the flip:

- Leaderboard read
- Replay upload and score submit
- Daily score submit if the daily board is active
- Feedback submit and admin reply fetch
- Admin console sign-in and reads

## Stage 5: Enforce

Enable callable enforcement:

```powershell
$env:VITE_FIREBASE_APPCHECK_SITE_KEY="<recaptcha-enterprise-site-key>"
$env:ENFORCE_APP_CHECK="true"
$env:NODE_ENV="production"
npm run check:deploy-env
npm --prefix functions run build
firebase deploy --only functions
```

Enable Firestore enforcement:

1. Open Firebase Console -> Security -> App Check -> APIs tab.
2. Expand Cloud Firestore.
3. Click Enforce and confirm.
4. Wait up to 15 minutes for enforcement to take effect.
5. Repeat the smoke tests from Stage 4.

## Rollback

If legitimate production traffic breaks:

1. Open Firebase Console -> Security -> App Check -> APIs tab -> Cloud Firestore.
2. Expand Cloud Firestore and turn enforcement back to Unenforced.
3. Redeploy functions with callable enforcement off:

```powershell
$env:VITE_FIREBASE_APPCHECK_SITE_KEY="<recaptcha-enterprise-site-key>"
$env:ENFORCE_APP_CHECK="false"
$env:NODE_ENV="production"
npm run check:deploy-env
npm --prefix functions run build
firebase deploy --only functions
```

4. Keep the site key in Hosting builds. Token issuance should continue while
   enforcement is rolled back.
5. Re-check Firebase Console -> Security -> App Check -> APIs tab metrics and
   Google Cloud Console -> Security -> reCAPTCHA Enterprise key metrics before
   retrying enforcement.
