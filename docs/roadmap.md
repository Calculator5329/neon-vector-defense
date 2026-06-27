# Roadmap

Current build status and near-term priorities. For the full 80-idea audit backlog, see [idea_backlog.md](./idea_backlog.md).

Last updated: 2026-06-27 (documentation audit)

## Shipped — Top bets (1–6)

| # | Feature | Status | Key files |
| ---: | --- | --- | --- |
| 1 | **Battle Plan replays** — snapshot flipbook viewer, `?run=` deep links | ✅ Shipped | `ReplayViewer.tsx`, `leaderboard.fetchRunReplay` |
| 2 | **Mission Dossier share cards** — canvas result cards + share row | ✅ Shipped | `DossierShare.tsx`, `dossier.ts` |
| 3 | **Meta loop** — Warden Rank, Salvage, Operations Board, Watch Streak | ✅ Shipped | `meta.ts`, `OperationsBoard.tsx` |
| 4 | **Remote balance config** — Firestore hot-patch without redeploy | ✅ Shipped | `balanceConfig.ts`, `config/balance` |
| 5 | **Bot-rival ghosts** — live pacing curve HUD + out-warded badge | ✅ Shipped | `BotGhostHud.tsx`, `ghostCurve.ts` |
| 6 | **Phase Anchor tower** — gravity hold/repel positional control | ✅ Shipped | `towers.ts` (`anchor`), `engine.ts` gravity branch |

## Shipped — Quick wins

- Settings hub: reduced motion, colorblind palette (`settings.ts`, `App.css`)
- Smart fast-forward: persisted speed, capital-hull auto-ease to 1×
- Music packs selector (Concord Signal / Deep Drift)
- Next-unlock progress bar (in-game + menu)
- Live balance canary in admin TELEMETRY tab
- Server-side score gate (`submitScore` Cloud Function)
- Replay enemy re-enactment, tower fire FX, wave callouts in Battle Plan
- Procedural upgrade icons (`UpgradeIcon.tsx`)
- 2-column end screen, bot-rival modal

## In progress / polish

- Bundle size: admin, AI, replay surfaces are code-split; main chunk still > 500 kB
- PWA: conservative service worker; no chunk precache yet
- Cosmetics shop for Salvage (wallet exists; spend path not built)

## Next priorities (recommended sequencing)

1. **Replay-of-the-Day menu spotlight** — `fetchGlobalTop` rows already carry `runId`; needs a selection heuristic
2. **Damage-type resistance matrix** — soften binary immunity so energy-stacking isn't dominant
3. **Interactive guided first build** — replace static How-to-Play with action-gated coach
4. **Responsive touch layout** — bottom-dock arsenal, thumb targets (portal mobile push)
5. **Balance regression CI gate** — `npm run balance` on PR, diff against committed baseline
6. **Cloud save on anonymous uid** — opt-in `saves/{uid}` mirror of progress blob

## Deferred (big swings)

- Server-side replay re-simulation (Cloud Function port of deterministic engine)
- Severance Campaign (12-mission star map)
- Ghost armada async PvP (`?armada=runId`)
- Multi-phase Umbra boss fight
- Recovered-Signal Pass (seasonal cosmetic track)
- Monetization SKUs (premium unlock, tower skins) — after meta loop + a11y baseline

## Portal launch checklist

- [x] Battle Plan read path + share cards
- [x] Meta retention loop (rank, quests, streak)
- [x] Reduced motion + colorblind palette
- [x] Server-validated leaderboard writes
- [x] Remote balance hot-patch
- [ ] Touch-first responsive layout
- [ ] Guided onboarding funnel
- [ ] Balance CI gate on PRs
- [ ] Full PWA precache + build-tag reload toast
