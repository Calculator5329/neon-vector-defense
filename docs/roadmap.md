# Roadmap

Current build status and near-term priorities. For the full historical 80-idea
audit backlog, see [idea_backlog.md](./idea_backlog.md).

Last updated: 2026-06-28 (audit backlog implementation pass)

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
| Live-ops hardening | Remote balance config, deploy preflight, CI/security/audit gates, App Check rollout hooks | `balanceConfig.ts`, `scripts/deploy-preflight.ts`, `.github/workflows/ci.yml` |

## Recently shipped since the prior doc audit

- AI-rival comparisons were deepened and the modal layout was polished.
- AI helper privacy copy now explains what the assistant sends and why.
- Deploy checks now verify Node/Java/Firebase project prerequisites before rules/deploy work.
- Leaderboard rows now use server timestamps for ordering instead of trusting client clocks.
- Battle Plan replay fidelity improved with richer public events, enemy/tower re-enactment, safer public chunks, and stricter replay schema tests.
- Global focus-visible styling and design tokens improved the contrast/accessibility baseline.
- Operations palette re-equips are now silent while purchase/error feedback remains visible.
- Leaderboard rows can highlight the current browser's anonymous uid, and privacy export/delete includes replay score tokens.

## Near-term priorities

1. **Replay and score integrity** - add replay completion manifests, chunk hashes/count validation, malformed replay hardening, and server-side freeplay/mode validation before leaderboard incentives grow.
2. **Gameplay correctness audit fixes** - close cloaked-reveal projectile collision, burn attribution/stacking, same-tick terminal leaks, campaign unlock enforcement, and immutable checkpoint replay links.
3. **Touch-first game surface** - finish the mobile landscape command layout: bottom-dock arsenal, upgrade sheet, safe-area controls, and coarse-pointer hit targets.
4. **Guided first build** - replace the static tutorial with an action-gated first run that teaches placement, wave launch, upgrades, and cloak detection.
5. **Balance CI gate** - wire a semantic `public/balance-report.json` diff into CI so unintentional dead/op tower swings fail before release.
6. **Production release hardening** - deploy preflights for production Vite flags, App Check enforcement, branch/tag guards, Worker dry-runs, callable integration tests, and production-bundle smoke checks.
7. **PWA build freshness** - add conservative chunk precache plus a build-tag reload toast so installed users do not linger on stale bundles.

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
- [ ] Touch-first responsive command layout
- [ ] Replay completion manifest and chunk validation
- [ ] Gameplay correctness audit fixes
- [ ] Guided onboarding funnel
- [ ] Balance CI gate on PRs
- [ ] Production deploy hardening checks
- [ ] Full PWA precache + build-tag reload toast

## Guardrails

- `meta.ts` must stay off the combat, score, and bot paths.
- Public replay docs must remain compact and free of `undefined` values.
- Replay read paths must reject or clearly label incomplete/malformed chunks; partial data should not masquerade as a full Battle Plan.
- Leaderboard score claims must include a matching replay token.
- Privacy export/delete must cover every local key that can affect score retry, identity, consent, or private replies.
- Admin allowlists in `firestore.rules`, Functions helpers, and client admin code must stay synchronized.
- AI help remains optional and must keep secrets in the Worker, not in Vite-exposed variables.
