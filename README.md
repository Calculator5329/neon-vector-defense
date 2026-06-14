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

## Gameplay

- **3 sectors** - Orbital Relay, Twin Reactor, and Hyperlane Junction, each
  with a custom lane shape, no-build zones, and visual theme.
- **3 protocols** - Recruit, Veteran, and Apex, with different cash, hull,
  wave, cloak, and scaling rules.
- **10 towers with 2 upgrade tracks** - including support, crowd-control,
  anti-cloak, burst, drone, missile, gravity, and resonance towers.
- **Commander abilities** - Q/W/E/R abilities for orbital strikes, slow fields,
  overdrive, and emergency salvage.
- **Enemy variants** - armored, blast-proof, cryo-proof, phase-cloaked, repair,
  boss, and nested-hull units.
- **Progression** - service records, tower unlocks, freeplay, archive
  fragments, and alternate ending progression persist locally.
- **Leaderboards and feedback** - public Firestore-backed scoreboards and
  anonymous feedback submission.
- **AI field assistant** - a menu helper backed by a Google Cloud Function,
  OpenRouter, and server-side usage limits.

## The Game World

Humanity strung lighthouse relays, called Lanterns, across deep space. They
carry the Continuity: backed-up minds of every colonist who ever crossed. The
Vex Combine armada besieging them is not truly invading; it is a
self-replicating logistics fleet still executing a siege order from a war that
ended 284 years ago. You are the Warden of Lantern Seven. Hold the lane and
read the Archive.

## Technical Highlights

- **Canvas renderer** - vector-style enemy and tower art drawn to supersampled
  offscreen canvases, then animated with recoil, glow, shake, trails, vignettes,
  and damage effects.
- **Headless game engine** - the same game model powers live play, bot
  playtests, balance simulations, performance harnesses, and admin analytics.
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
- **Firebase integration** - Firestore REST calls keep the bundle light while
  security rules validate append-only leaderboard, feedback, and telemetry
  writes.

## Local Development

```bash
npm install
npm run dev
```

Useful scripts:

```bash
npm run build      # typecheck and production build
npm run preview    # preview the built app
npm run sim        # full headless balance simulation
npm run sim -- quick
npm run balance    # write public/balance-report.json for the admin dashboard
npm run balance -- quick
```

## Generated Art

Generated art lives in `public/art/`. Regeneration is optional and requires an
OpenRouter key. Keep keys in `.env.local`, which is gitignored by `*.local`.

```powershell
$env:OPENROUTER_API_KEY="sk-or-..."
node scripts/genart.mjs
```

Some one-off generation scripts also read `.env.local` directly. Do not commit
local key files.

## Controls

| Input | Action |
| --- | --- |
| `1`-`9`, `0` | Select a tower to build |
| Click map | Place tower or collect power-ups |
| Shift-click map | Keep placing the selected tower |
| Click tower | Open upgrade, targeting, stats, lore, and sell panel |
| `Q` `W` `E` `R` | Commander abilities |
| Right-click / `Esc` | Cancel placement, aiming, or selection |
| `Space` | Launch the next wave or pause mid-wave |

## Firebase Notes

The app uses a Firebase web API key in client source. Firebase web keys are
public identifiers, not server secrets, so the protection layer is
`firestore.rules`.

The intended rules model is:

- Leaderboards are public read and append-only.
- Feedback and telemetry are append-only with validation.
- Updates/deletes are denied.
- Admin dashboards are read-only and should only expose aggregate/non-sensitive
  gameplay data.
- AI help usage data is written only by the Cloud Function through Admin SDK;
  normal Firestore rules keep those collections closed to clients.

Before making a new public release, deploy the matching rules:

```bash
firebase deploy --only firestore:rules
```

## AI Help Setup

The menu AI widget calls `/api/ai/help`, which Firebase Hosting rewrites to the
`aiHelp` Cloud Function. The frontend never sees the OpenRouter key.

Install the function dependencies once:

```bash
cd functions
npm install
```

Set runtime environment variables for the function:

```bash
firebase functions:secrets:set OPENROUTER_API_KEY
firebase functions:secrets:set AI_COOKIE_SECRET
```

Also set non-secret params or environment values for:

```bash
OPENROUTER_MODEL=google/gemini-3-flash-preview
APP_URL=https://neon-vector-defense-7.web.app
```

The deployed function enforces:

- 5 turns per conversation
- 5 conversations per signed visitor cookie
- 20 new conversations per IP per hour
- 100 turns per IP per day

The signed `HttpOnly` cookie survives localStorage clears, while the IP buckets
catch casual cookie/cache resets. Anonymous limits are not identity proof; use
login, App Check, or CAPTCHA if stronger abuse control is needed.

## Deployment

```bash
npm run build
firebase deploy --only functions:aiHelp,hosting
```

Configured Firebase project: `neon-vector-defense-7`
