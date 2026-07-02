# Roadmap

Current build status and near-term priorities. For the full historical 80-idea
audit backlog, see [idea_backlog.md](./idea_backlog.md).

Last updated: 2026-07-02 (portal SDK adapter, replay re-simulation audit, replay death fidelity, Daily Challenge, arsenal balance, admin balance console, in-run QoL)

## Current shipped pillars

| Pillar | Status | Source-of-truth files |
| --- | --- | --- |
| Core tower-defense loop | 8 sectors, 4 protocols, 21 towers, 6 abilities, 18 enemy archetypes, deterministic elite variants, phased Umbra boss | `engine.ts`, `maps.ts`, `towers.ts`, `enemies.ts`, `waves.ts`, `eliteAffixes.ts` |
| Battle Plan replays | Public `runs/{runId}` docs with required manifests, compact death records, public chunks, `?run=` viewer, replay-of-the-day card | `runTelemetry.ts`, `replayReconstruct.ts`, `leaderboard.ts`, `ReplayViewer.tsx`, `replaySpotlight.ts` |
| Replay-backed leaderboards | Server-only board writes, replay token verification, admin `verifyRun` re-simulation badges, canonical score values, server-time ordering | `leaderboard.ts`, `reSimulate.ts`, `functions/src/index.ts`, `firestore.rules` |
| Freeplay | Campaign continuation, contracts, relics, risk packets, rivals, checkpoint banking | `freeplay.ts`, `engine.ts`, `App.tsx` |
| Daily Challenge | UTC daily protocol with fixed modifiers, normal wave-1 start, daily leaderboard | `dailyChallenge.ts`, `engine.ts`, `MainMenu.tsx`, `functions/src/index.ts` |
| Meta loop | Warden Rank, Salvage, Operations Board, Watch Streak; cosmetic/QoL only | `meta.ts`, `OperationsBoard.tsx`, `tests/e2e/ux-ui.spec.ts` |
| In-run QoL | Engine-backed wave preview, keyboard placement/cycling, Veteran Deploy batch upgrades | `GameScreen.tsx`, `engine.ts`, `runTelemetry.ts`, `storage.ts` |
| AI rival ghosts | In-run HUD and modal comparing current run to bundled bot profiles | `BotGhostHud.tsx`, `ghostCurve.ts`, `ghostCurveData.ts` |
| Privacy and admin | Age/consent gate, private feedback receipts, admin replies, admin-only deletion tooling | `consent.ts`, `leaderboard.ts`, `functions/src/index.ts`, `PrivacyView.tsx` |
| Accessibility baseline | Reduced motion, colorblind palette, global focus-visible ring, stronger contrast tokens | `settings.ts`, `src/index.css`, `App.css` |
| Live-ops hardening | Admin-editable remote balance config, deploy preflight, CI/security/audit gates, App Check staged-rollout path | `balanceConfig.ts`, `adminBalanceConfig.ts`, `scripts/deploy-preflight.ts`, `.github/workflows/ci.yml`, `docs/runbooks/app-check-rollout.md` |
| Portal distribution | Build-time CrazyGames/Poki SDK adapter, portal CSP flavors, natural-pause ad hooks, portal submission runbook | `portal.ts`, `vite.config.ts`, `GameScreen.tsx`, `docs/runbooks/portal-submission.md` |

## Recently shipped since the prior doc audit

- Long Watch and Diplomat's Gambit were retired; the campaign now has one
  ending path through Extinction, with a one-time Sunset Signal palette and
  Salvage bonus for the capstone clear.
- Public replay manifests are now mandatory for new uploads, and score
  validation treats missing manifests as incomplete data rather than legacy
  compatibility.
- Daily Challenge now appears as a fifth deploy protocol, starts as a normal
  wave-1 run, and writes non-freeplay daily leaderboard rows ranked by wave and
  kills.
- AI-rival comparisons were deepened and the modal layout was polished.
- AI helper privacy copy now explains what the assistant sends and why.
- Deploy checks now verify Node/Java/Firebase project prerequisites before rules/deploy work.
- Leaderboard rows now use server timestamps for ordering instead of trusting client clocks.
- Battle Plan replay death fidelity now uses manifest-hashed compact death records, so killed enemies disappear at their real recorded death times while older replays keep the legacy best-effort path.
- Admin replay re-simulation now has an Operations Console path: inspect a run,
  press VERIFY, review `verified` / `divergent` / `unverifiable`, and badge
  admin board or spotlight candidate rows when stored verification data exists.
- Global focus-visible styling and design tokens improved the contrast/accessibility baseline.
- Operations palette re-equips are now silent while purchase/error feedback remains visible.
- Leaderboard rows can highlight the current browser's anonymous uid, and privacy export/delete includes replay score tokens.
- Harmonic Siphon and Vector Lure complete the 21-tower arsenal, with a
  regenerated balance baseline and an admin console for validated
  `config/balance` hot-patches.
- Build-phase wave preview, keyboard placement/cycling, and Veteran Deploy
  shipped as QoL layers over the canonical engine placement and upgrade actions.
- CrazyGames and Poki portal SDK builds now share a no-op-default adapter,
  portal-only CSP injection, lifecycle events, and natural-pause ad hooks.

- Elite variants add capped Shielded, Frenzied, Splitting, and Bulwark hulls to
  regular waves, and the Umbra now has lattice, phase-shift, and enrage phases
  with replay-visible transitions.

## Shipped 2026-07-01 (review-plan implementation pass)

- **Security tier**: Firebase Anonymous Auth required on every player write
  (uid binding in rules; rate limits keyed to verified identity); operator
  deletion corroborates ownership; Worker quota keyed by IP; TTL retention
  with real Timestamp fields; allowlist single-sourced.
- **Gameplay correctness audit fixes** (was #2): cloaked-reveal collision,
  burn attribution/stacking, same-tick terminal leaks, engine-enforced
  campaign unlocks — all fixed with regression tests.
- **Deterministic simulation**: seeded RNG recorded in replay setup, true
  fixed timestep, per-Game uids, save-file decoupling — unblocks server
  re-simulation.
- **Touch-first game surface** (was #3): short-landscape command layout,
  pause-behind-rotate-overlay, pinch-zoom allowed.
- **Guided first build** (was #4): action-gated coach (place → launch →
  upgrade) replaces the tutorial modal wall; skip/completion recorded.
- **PWA build freshness** (was #7): build-tag reload toast + 192/512
  maskable icons; production-bundle + service-worker e2e in the deploy gate.
- **Perf/cost**: Firestore SDK lazy (−55KB gzip first paint), art WebP
  (63.7MB → 3.2MB), fonts self-hosted, global-top aggregate doc (1 read vs
  ~400), 11MB internal report evicted, perf smoke is a real CI gate.
- **App Check staged-enforcement path**: deploy preflight now reports client
  token and callable enforcement expectations, the operator runbook covers
  reCAPTCHA Enterprise setup, production token probes, metrics watch, enforcement
  flip, and rollback, and a Functions drift test guards callable App Check
  options.
- **Production release hardening**: callable integration tests now run against
  Firebase emulators, manual deploy workflows fail outside `master` and record
  audit summaries, and CI dry-runs the Cloudflare Worker before merge.

## Near-term priorities

1. **Execute App Check enforcement** - use the staged rollout runbook's metrics window, then flip `ENFORCE_APP_CHECK` and Firebase console enforcement after production token flow is clean.
2. **Monetization MVP** - web checkout (cosmetics + premium unlock), server-side entitlements keyed to the authenticated uid (see business_plan.md).
3. **Replay re-simulation enforcement** - collect admin `verifyRun` samples, soft-flag divergent leaderboard rows, then flip rejection only after high-volume freeplay and balance-version false positives are understood.

## Deferred / bigger bets

- Automated score rejection from replay re-simulation once admin audit data shows the false-positive rate is acceptable.
- Severance Campaign, with fixed mission nodes and alternate objectives.
- Async duel or ghost-armada modes based on public replay data.
- Seasonal Recovered-Signal Pass and cosmetic store using Salvage/entitlements.
- More authored Hollow encounters beyond the Umbra.

## Portal launch checklist

- [x] Battle Plan read path, public replay chunks, and shareable run deep links
- [x] Meta retention loop (rank, quests, streak)
- [x] Reduced motion, colorblind palette, focus-visible, and contrast baseline
- [x] Server-validated leaderboard writes with replay-token verification
- [x] Remote balance hot-patch and admin editor
- [x] Replay-of-the-Day menu spotlight
- [x] Daily Challenge protocol
- [x] App Check staged-enforcement runbook and deploy preflight
- [x] Touch-first responsive command layout (short-landscape tier)
- [x] Replay completion manifest and chunk validation (manifests now REQUIRED)
- [x] Replay death records covered by the manifest
- [x] Gameplay correctness audit fixes
- [x] Guided onboarding funnel (action-gated coach)
- [x] Balance CI gate on PRs
- [x] Production deploy hardening checks
- [x] Build-tag reload toast (conservative shell precache retained by design)
- [x] CrazyGames/Poki SDK adapter and portal build flavors
- [ ] Portal account setup, store copy, thumbnails, screenshots, and external-request approvals

## Guardrails

- `meta.ts` must stay off the combat, score, and bot paths.
- QoL preferences may improve control flow, but must not change tower/enemy
  stats, score math, bot plans, or unlock thresholds.
- Public replay docs must remain compact and free of `undefined` values.
- Replay read paths must reject or clearly label incomplete/malformed chunks; partial data should not masquerade as a full Battle Plan.
- New public replay uploads must carry a manifest with event and death hashes; missing manifests are incomplete and cannot back accepted scores.
- Leaderboard score claims must include a matching replay token.
- `verifyRun` verdicts are admin audit data until the enforcement flip; player-facing
  views must not expose verification badges or divergence details.
- Privacy export/delete must cover every local key that can affect score retry, identity, consent, or private replies.
- Admin allowlists in `firestore.rules`, Functions helpers, and client admin code must stay synchronized.
- AI help remains optional and must keep secrets in the Worker, not in Vite-exposed variables.
