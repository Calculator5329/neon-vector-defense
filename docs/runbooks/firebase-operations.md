# Firebase Operations Runbook

Operator reference for the Firebase security model, admin console, AI-help
proxy, App Check rollout, and deployment. Moved out of the README (2026-07-05);
see also [deploy.md](deploy.md) and [app-check-rollout.md](app-check-rollout.md).

## Security model (Firebase notes)

The app uses a Firebase web API key in client source. Firebase web keys are
public identifiers, not server secrets, so the protection layer is
`firestore.rules`.

The intended rules model is:

- Every player write requires Firebase **Anonymous Auth** — enable the Anonymous
  sign-in provider (Authentication -> Sign-in method -> Anonymous) before
  deploying, or all score/replay/telemetry writes will fail. Sign-in happens
  lazily right before the first server write; `firebase/auth` stays out of the
  first-paint bundle.
- Leaderboards are public read; writes go through the `submitScore` and
  `submitDailyScore` Cloud Functions (direct client writes are blocked). The
  functions require a matching public replay token, canonicalize values from the
  replay summary, and stamp accepted entries with server time.
- Feedback is append-only for anonymously authenticated visitors, and
  readable/repliable only by allowlisted Google admin accounts.
- Telemetry is append-only for anonymously authenticated visitors with
  admin-only reads.
- Updates/deletes are denied for normal clients.
- Privacy deletion of server records is operator-run through an admin-only
  callable, because anonymous uid values appear in public leaderboard rows.
- The unlinked owner console uses Firebase Auth with Google sign-in plus the
  same admin email allowlist in `firestore.rules` and
  `src/game/firebaseClient.ts`. Keep both allowlists synchronized.
- AI help uses the Cloudflare Worker proxy in `worker/` so Firebase can remain
  on Spark.

Before making a new public release, deploy the matching rules:

```bash
firebase deploy --only firestore:rules
```

## Admin Console

The owner console is an unlinked route:

```txt
/admin
```

It uses Firebase Auth with Google sign-in and the Firestore admin allowlist.
Players do not need visible accounts; leaderboard, feedback, and telemetry
writes use anonymous Firebase Auth behind the scenes. Admin replies are saved
onto feedback records for triage and can be shown only to the browser that
submitted the original feedback.

Before using it in production:

- Enable **Authentication -> Sign-in method -> Google** in the Firebase console.
- Confirm the deployed domain is authorized for Firebase Auth.
- Confirm the admin email allowlist in `firestore.rules` and
  `src/game/firebaseClient.ts`.
- Deploy updated rules:

```bash
firebase deploy --only firestore:rules
```

## AI Help Setup

Firebase Spark cannot run server code, so it cannot safely store the OpenRouter
key by itself. Keep Firebase on Spark for Hosting/Auth/Firestore, and run the AI
proxy somewhere that supports secrets. A Cloudflare Worker template is included
in `worker/`.

The frontend reads the AI endpoint from:

```bash
VITE_AI_HELP_URL=https://your-worker-name.your-subdomain.workers.dev
```

Do not put the OpenRouter key in `VITE_*` variables; Vite exposes those to the
browser.

Cloudflare Worker setup:

```bash
cd worker
copy wrangler.toml.example wrangler.toml
npm install
npm run secret:key
npm run secret:cookie
npm run deploy
```

If you prefer not to install dependencies in `worker/`, you can also run the
same commands with `npx wrangler@latest ...`.

Then build the game with the Worker URL:

```bash
$env:VITE_AI_HELP_URL="https://your-worker-name.your-subdomain.workers.dev"
npm run build
firebase deploy --only hosting,firestore:rules,functions
```

The Worker template enforces:

- 5 turns per conversation
- 5 conversations per signed visitor cookie

The AI widget is hidden when `VITE_AI_HELP_URL` is missing. No request is sent
until the player submits a question, and the client sends a compact gameplay
context rather than raw local history.

Because this Spark-friendly path does not use a persistent server database,
anonymous limits can still be reset by deleting cookies. Add Worker KV/D1,
Turnstile, or another persistent edge store later if stronger abuse control is
needed.

## App Check Setup

The browser initializes Firebase App Check only when this build-time value is
present:

```bash
VITE_FIREBASE_APPCHECK_SITE_KEY=your-recaptcha-enterprise-site-key
```

For local Vite dev only, you may also set:

```bash
VITE_FIREBASE_APPCHECK_DEBUG_TOKEN=your-debug-token
```

Rollout is staged: first deploy the client token plumbing, confirm score,
replay, feedback, telemetry, and admin flows, then set the Functions runtime
environment variable `ENFORCE_APP_CHECK=true` and enable Firestore App Check
enforcement in the Firebase console. Full checklist:
[app-check-rollout.md](app-check-rollout.md).

## Deployment

Local Firestore rules tests and Firebase deploy work require:

- Node.js 20+
- Java 21+ on `PATH` for the Firebase emulator
- Firebase project set to `neon-vector-defense-7`

Run the preflight before a release or rules-test session:

```bash
npm run check:deploy-env
```

```bash
npm run build
firebase deploy --only hosting,firestore:rules,functions
```

Configured Firebase project: `neon-vector-defense-7`

GitHub Actions also includes manual production deploy workflows for
`hosting-rules` and `functions`. Configure a protected `production` environment
and a `FIREBASE_SERVICE_ACCOUNT` secret containing the service account JSON
before using them.
