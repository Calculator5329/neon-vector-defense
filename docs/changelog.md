# Changelog

Running log of notable changes. Most recent first.

## 2026-06-27 — Documentation audit

- Added `docs/architecture.md`, `docs/tech_spec.md`, `docs/roadmap.md`, `docs/changelog.md`
- Renamed `docs/ROADMAP.md` → `docs/idea_backlog.md` (full 80-idea audit; status header updated)
- Consolidated root docs into `docs/`: `performance_audit.md`, `asset_provenance.md` (removed root copies)
- Updated `README.md`: 8 sectors, 19 towers, shipped features (Battle Plan, meta, ghosts, remote balance), docs index

## 2026-06 (recent feature commits)

- **2faf856** — 2-col end screen, bot-rival modal, procedural upgrade icons
- **8d17a2c** — Freeplay panel dismiss, equal upgrade boxes, replay events + daily skip
- **c4662eb** — Replay doc size fix (stay under Firestore 1 MB limit)
- **41abb25** — Replay re-enactment: enemies, tower fire, wave callouts; dossier rebalance
- **2e80e4c** — Menu landing redesign, rank-seed bug fix, ops legibility
- **1481475** — Meta loop: Warden Rank, Salvage, Operations Board, Watch Streak
- **9512422** — Live balance canary in admin TELEMETRY
- **626b866** — Bot-rival ghost HUD + out-warded-the-AI badge
- **4ea7b2b** — Mission Dossier share cards
- **af83ba4** — Battle Plan replay viewer (`?run=` deep links)
- **f0792c8** — Remote balance config (Firestore hot-patch)
- **ae42f5e** — Phase Anchor gravity control tower
- **ddfc732** — Quick wins: a11y settings, smart FF, music packs, progress bar

## 2026-06-17 — Performance audit

See [performance_audit.md](./performance_audit.md). Engine stress passes under 8 ms budget on all 8 maps; main bundle size remains a deferred risk.
