# Roadmap

Current build status and near-term priorities. For the full historical 80-idea
audit backlog, see [idea_backlog.md](./idea_backlog.md).

Last updated: 2026-07-02 (release hardening pass)

## Current shipped pillars

| Pillar | Status | Source-of-truth files |
| --- | --- | --- |
| Core tower-defense loop | 8 sectors, 5 protocols, 19 towers, 6 abilities, 18 enemy archetypes | `engine.ts`, `maps.ts`, `towers.ts`, `enemies.ts`, `waves.ts` |
| Battle Plan replays | Public `runs/{runId}` docs, public chunks, `?run=` viewer, replay-of-the-day card | `runTelemetry.ts`, `leaderboard.ts`, `ReplayViewer.tsx`, `replaySpotlight.ts` |
| Replay-backed leaderboards | Server-only board writes, replay token verification, canonical score values, server-time ordering | `leaderboard.ts`, `functions/src/index.ts`, `firestore.rules` |
| Freeplay | Campaign continuation, deterministic Daily Freeplay, contracts, relics, risk packets, rivals, checkpoint banking | `freeplay.ts`, `engine.ts`, `App.tsx` |
| Meta loop | Warden Rank, Salvage, Operations Board, Watch Streak; cosmetic/QoL only | `meta.ts`, `OperationsBoard.tsx`, `tests/e2e/ux-ui.spec.ts` |
| AI rival ghosts | In-run HUD and modal comparing current run to bundled bot profiles | `BotGhostHud.tsx`, `ghostCurve.ts`, `ghostCurveData.ts` |
| Privacy and admin | Age/consent gate, private feedback receipts, admin replies, admin-only deletion tooling | `consent.ts`, `leaderboard.ts`, `functions/src/index.ts`, `PrivacyView.tsx` |
| Accessibility baseline | Reduced motion, colorblind palette, global focus-visible ring, stronger contrast tokens | `settings.ts`, `src/index.css`, `App.css` |
| Live-ops hardening | Remote balance config, deploy preflight, CI/security/audit gates, App Check staged-rollout path | `balanceConfig.ts`, `scripts/deploy-preflight.ts`, `.github/workflows/ci.yml`, `docs/runbooks/app-check-rollout.md` |

## Recently shipped since the prior doc audit

- AI-rival comparisons were deepened and the modal layout was polished.
- AI helper privacy copy now explains what the assistant sends and why.
- Deploy checks now verify Node/Java/Firebase project prerequisites before rules/deploy work.
- Leaderboard rows now use server timestamps for ordering instead of trusting client clocks.
- Battle Plan replay fidelity improved with richer public events, enemy/tower re-enactment, safer public chunks, and stricter replay schema tests.
- Global focus-visible styling and design tokens improved the contrast/accessibility baseline.
- Operations palette re-equips are now silent while purchase/error feedback remains visible.
- Leaderboard rows can highlight the current browser's anonymous uid, and privacy export/delete includes replay score tokens.

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
3. **In flight (Codex missions)**: Long Watch + Diplomat's Gambit removal; Daily Challenge rework + menu redesign; two new towers + balance pass + admin balance console.

## Deferred / bigger bets

- Server-side replay re-simulation for stronger anti-cheat.
- Severance Campaign, with fixed mission nodes and alternate objectives.
- Async duel or ghost-armada modes based on public replay data.
- Seasonal Recovered-Signal Pass and cosmetic store using Salvage/entitlements.
- Multi-phase Umbra boss and more authored Hollow encounters.

## Portal launch checklist

- [x] Battle Plan read path, public replay chunks, and shareable run deep links
- [x] Meta retention loop (rank, quests, streak)
- [x] Reduced motion, colorblind palette, focus-visible, and contrast baseline
- [x] Server-validated leaderboard writes with replay-token verification
- [x] Remote balance hot-patch
- [x] Replay-of-the-Day menu spotlight
- [x] Daily Freeplay seed
- [x] App Check staged-enforcement runbook and deploy preflight
- [x] Touch-first responsive command layout (short-landscape tier)
- [x] Replay completion manifest and chunk validation
- [x] Gameplay correctness audit fixes
- [x] Guided onboarding funnel (action-gated coach)
- [x] Balance CI gate on PRs
- [x] Production deploy hardening checks
- [x] Build-tag reload toast (conservative shell precache retained by design)

## Guardrails

- `meta.ts` must stay off the combat, score, and bot paths.
- Public replay docs must remain compact and free of `undefined` values.
- Replay read paths must reject or clearly label incomplete/malformed chunks; partial data should not masquerade as a full Battle Plan.
- Leaderboard score claims must include a matching replay token.
- Privacy export/delete must cover every local key that can affect score retry, identity, consent, or private replies.
- Admin allowlists in `firestore.rules`, Functions helpers, and client admin code must stay synchronized.
- AI help remains optional and must keep secrets in the Worker, not in Vite-exposed variables.
