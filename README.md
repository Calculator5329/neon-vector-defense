# Neon Vector Defense

[![Live game](https://img.shields.io/badge/live-Neon%20Vector%20Defense-22c55e?style=flat-square)](https://neon-vector-defense-7.web.app)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-20232a?style=flat-square&logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)

Neon Vector Defense is a sci-fi tower defense game built with React,
TypeScript, and Canvas. It plays like a fast arcade defense game, but the
interesting engineering is under the surface: procedural canvas rendering,
headless balance simulations, bot playtests, local progression, generated art,
procedural audio, and Firebase-backed leaderboards.

**Live game:** [neon-vector-defense-7.web.app](https://neon-vector-defense-7.web.app)  
**Recruiter demo:** [neon-vector-defense-7.web.app/?demo=1](https://neon-vector-defense-7.web.app/?demo=1)

## Gameplay

- **8 sectors** — Orbital Relay, Twin Reactor, Hyperlane Junction, Mobius
  Drift, Blackout Reach, The Throat, Umbral Reach, and Cinder Causeway, each
  with a custom lane shape, no-build zones, and visual theme.
- **5 protocols** — Recruit, Veteran, Apex, Extinction, and Long Watch, with
  different cash, hull, wave, cloak, and scaling rules.
- **19 towers with 2 upgrade tracks** — including support, crowd-control,
  anti-cloak, burst, drone, missile, gravity, resonance, and late-game towers.
- **6 commander abilities** — Q/W/E/R/T/Y abilities for orbital strikes, slow
  fields, overdrive, emergency salvage, and late-run control tools.
- **Enemy variants** — armored, blast-proof, cryo-proof, phase-cloaked, repair,
  boss, and nested-hull units.
- **Progression** — service records, tower unlocks, freeplay, recovered signal
  fragments, and alternate ending progression persist locally.
- **Meta loop** — Warden Rank, Salvage wallet, daily/weekly Operations Board
  quests, and Watch Streak (cosmetic/QoL only — never affects run balance).
- **Battle Plan replays** — watch any run via `/?run=<runId>`; leaderboard rows
  link to reconstructions built from uploaded wave snapshots and public replay
  event chunks.
- **Bot-rival ghosts** — in-run pacing curve compares your cores/cash to the
  bundled rookie/standard/expert bot profiles for the same sector.
- **Leaderboards and feedback** — server-validated Firestore scoreboards and
  anonymous feedback submission. Scores require a matching public replay and are
  ordered by server time.
- **AI field assistant** — an optional helper backed by the included
  Cloudflare Worker proxy, OpenRouter, and server-side usage limits.

## The Game World

Humanity strung lighthouse relays, called Lanterns, across deep space. They
carry the Continuity: backed-up minds of every colonist who ever crossed. The
Vex Combine armada besieging them is not truly invading; it is a
self-replicating logistics fleet still executing a siege order from a war that
ended 284 years ago. You are the Warden of Lantern Seven. Hold the lane and
follow the recovered signal fragments.

## Technical Highlights

- **Canvas renderer** - vector-style enemy and tower art drawn to supersampled
  offscreen canvases, then animated with recoil, glow, shake, trails, vignettes,
  and damage effects.
- **Headless game engine** - the same game model powers live play, bot
  playtests, balance simulations, performance harnesses, and admin analytics.
- **Remote balance config** - optional Firestore `config/balance` doc hot-patches
  tower/enemy/difficulty multipliers without a redeploy.
- **Balance harness** - `npm run balance` simulates map/protocol/bot matrices,
  tower efficiency, strategy viability, solo-tower runs, and writes an in-app
  `balance-report.json`.
- **Bot simulation** - `npm run sim` runs rookie, standard, and expert bot
  tiers through the public game API to keep difficulty targets honest.
- **Procedural audio** - layered synth effects and generated ambient scoring
  with no runtime audio asset dependency for core effects.
- **Generated art pipeline** - optional scripts generate menu, sector,
  briefing, victory, defeat, and archive images through OpenRouter image
  models.
- **Firebase integration** - the Firebase SDK handles anonymous player auth,
  public leaderboard reads, validated score/feedback/telemetry writes, and
  admin-only feedback and telemetry reads.

## Recruiter Demo

Append `?demo=1` to the live URL to launch a no-persistence demo session:

```txt
https://neon-vector-defense-7.web.app/?demo=1
```

Watch a Battle Plan replay:

```txt
https://neon-vector-defense-7.web.app/?run=r_<runId>
```

Demo mode unlocks all sectors, protocols, and towers for that browser session.
It skips telemetry and disables score submission so recruiter exploration does
not pollute production data.

## Local Development

```bash
npm install
npm run dev
```

Useful scripts:

```bash
npm run build      # typecheck and production build
npm run preview    # preview the built app
npm run sim        # full headless bot simulation
npm run sim -- quick
npm run balance    # write public/balance-report.json for the admin dashboard
npm run balance -- quick
npm run perf       # headless engine stress timing
npm run perf:browser  # live FPS sampling via /?perf= route
npm run meta:sim   # guard that meta.ts stays off the score/engine path
npm run test:engine # engine/unit correctness tests
npm run test:security # rules, worker, and Functions security suite
npm run ci         # local approximation of the GitHub Actions gate
npm run check:deploy-env  # verify Node, Java, and Firebase project before emulator/deploy work
```

`public/balance-report.json` is intentionally committed as demo/admin dashboard
data generated from the balance harness, not as production telemetry.

## Generated Art

Generated art lives in `public/art/`; generated audio lives in `public/audio/`.
Regeneration is optional and requires an OpenRouter key. Keep keys in
`.env.local`, which is gitignored.

```powershell
$env:OPENROUTER_API_KEY="sk-or-..."
node scripts/genart.mjs
```

Some one-off generation scripts also read `.env.local` directly. Do not commit
local key files. Source code and docs are MIT licensed; generated art/audio are
reserved project assets. See [docs/asset_provenance.md](docs/asset_provenance.md).

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Module map, layer model, runtime flow |
| [docs/business_plan.md](docs/business_plan.md) | Strategy, execution order, KPIs, launch gate |
| [docs/tech_spec.md](docs/tech_spec.md) | Firestore schema, Cloud Functions, env vars |
| [docs/decision_log.md](docs/decision_log.md) | Current source-of-truth design decisions |
| [docs/roadmap.md](docs/roadmap.md) | Shipped features and next priorities |
| [docs/idea_backlog.md](docs/idea_backlog.md) | Full 80-idea audit backlog |
| [docs/changelog.md](docs/changelog.md) | Session-by-session change log |
| [docs/performance_audit.md](docs/performance_audit.md) | Engine perf baselines (2026-06-17) |
| [docs/asset_provenance.md](docs/asset_provenance.md) | Media licensing vs MIT source |

## Controls

| Input | Action |
| --- | --- |
| `1`-`9`, `0` | Select a tower to build |
| Click map | Place tower or collect power-ups |
| Shift-click map | Keep placing the selected tower |
| Click tower | Open upgrade, targeting, stats, lore, and sell panel |
| `Q` `W` `E` `R` `T` `Y` | Commander abilities |
| Right-click / `Esc` | Cancel placement, aiming, or selection |
| `Space` | Launch the next wave or pause mid-wave |

## Firebase Notes

The app uses a Firebase web API key in client source. Firebase web keys are
public identifiers, not server secrets, so the protection layer is
`firestore.rules`.

The intended rules model is:

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
enforcement in the Firebase console.

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
