# Changelog

Running log of notable changes. Most recent first.

## 2026-07-11 - Mount the Signal Skin and Map Theme pickers

- Wired `SignalSkinPicker` and `MapThemePicker` (built 2026-07-10 but never
  mounted) into the Operations Board as SIGNAL SKINS and MAP THEMES shop
  sections alongside the existing Signal Palettes, so players can now buy and
  equip them with Salvage in-game. Viewer-side only; no sim/score/replay
  paths touched.

## 2026-06-28 - Audit backlog implementation pass

- Removed the visible owned-palette equip status while preserving purchase and
  insufficient-salvage feedback.
- Added Operations Board palette regression tests.
- Wired current-player leaderboard row highlighting and included replay score
  tokens in `/privacy` local export/delete.
- Added the active multi-agent audit backlog to `roadmap.md`, `idea_backlog.md`,
  and `decision_log.md`.

## 2026-06-28 - Source-of-truth documentation audit

- Added `docs/decision_log.md` for replay, score, freeplay, privacy, AI, meta,
  and accessibility decisions.
- Updated `README.md`, `architecture.md`, `tech_spec.md`, and `roadmap.md` to
  match current source behavior.
- Reconciled the current branch timeline from recent commits after the prior
  documentation audit.

## 2026-06-28 - Recent branch timeline

| Commit | Theme | Documentation impact |
| --- | --- | --- |
| `8a2a214` | Design tokens, AA contrast, global focus-visible ring | Accessibility baseline is now a shipped platform feature, not only a roadmap item. |
| `932fdfe` | Replay fidelity | Public Battle Plan replays include richer event data/chunks; replay docs must stay compact and Firestore-safe. |
| `8290fbb` | AI-rival modal layout | Bot-rival ghosts are polished user-facing telemetry, including modal comparison views. |
| `4a04390` | Server time for score ordering | Leaderboards order by server-written timestamps; client time is retained only as metadata. |
| `d46caa7` | Deploy verification gates | Release docs should mention Node/Java/Firebase preflight and CI guardrails. |
| `dd890bb` | AI helper privacy flow | AI help docs must describe compact gameplay context, optional Worker endpoint, and privacy posture. |
| `52da266` | Deeper AI-rival comparisons | Rival docs should reference bundled profiles rather than one expert-only curve. |

## 2026-06-27 - Documentation audit

- Added `docs/architecture.md`, `docs/tech_spec.md`, `docs/roadmap.md`, `docs/changelog.md`.
- Renamed `docs/ROADMAP.md` to `docs/idea_backlog.md` (full 80-idea audit; status header updated).
- Consolidated root docs into `docs/`: `performance_audit.md`, `asset_provenance.md`.
- Updated `README.md`: 8 sectors, 19 towers, shipped features (Battle Plan, meta, ghosts, remote balance), docs index.

## 2026-06 - Feature buildout before the audit

- Battle Plan replay viewer and `?run=` deep links.
- Mission Dossier share cards.
- Warden Rank, Salvage, Operations Board, and Watch Streak.
- Remote balance config via Firestore `config/balance`.
- Bot-rival ghost HUD and "out-warded the AI" result badge.
- Phase Anchor tower and broader tower roster additions.
- Server-side score gate through Cloud Functions.
- Admin telemetry/balance views and live balance canary.
- Accessibility settings, smart fast-forward, music packs, and unlock progress surfaces.

## 2026-06-17 - Performance audit

See [performance_audit.md](./performance_audit.md). Engine stress passed under
the update budget on all eight maps; the main bundle remained the primary
deferred performance risk.
