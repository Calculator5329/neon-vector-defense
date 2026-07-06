# Ideas Handoff — Lantern 7 expansion ideas, ranked

> Written 2026-07-05. Complements (does not replace) the owner-triaged
> `docs/idea_backlog.md` (80-idea audit with full implementation plans in its
> appendices — read that first for anything marked "plan exists"). Ranked by
> impact-vs-effort for a solo dev + AI assistant. Effort: S < 1 session,
> M = 1-3 sessions, L = multi-week. No monetization ideas — growth only.

| # | Idea | Impact | Effort | Why |
|---|------|--------|--------|-----|
| 1 | Replay share cards with OG unfurl | High | M | Every shared `?run=` link becomes an ad; plan already written (idea_backlog Top Bet 2) |
| 2 | Daily Challenge streak + archive board | High | M | Daily protocol + replay-verified boards already exist; retention is the missing loop |
| 3 | Bot playtest coverage for all 12 sectors | High | S | Real QA gap (sim.ts covers 3 maps); feeds every balance decision |
| 4 | Difficulty analytics dashboard panel | High | M | Admin console + runAnalytics already collect the data; visualize sector/protocol win-rate vs bot expectation |
| 5 | Replay-of-the-week spotlight rotation | Med-High | S | replaySpotlight.ts exists; automate candidate surfacing from verified runs |
| 6 | New enemy archetype: Warden-hunter (targets towers) | High | M-L | 19 archetypes but none threaten placements; changes spatial decisions; replay v7 bump |
| 7 | New tower archetype: economy/risk tower | Med-High | M | 21 towers, none trade income vs defense; interacts with freeplay contracts; balance-gate heavy |
| 8 | Ghost-race a friend's replay | High | L | Ghost HUD (bot curves) + replay streams both exist — race any runId's curve instead of a bot |
| 9 | Sector mastery challenges (3 stars -> named constraints) | Med | M | Mastery stars exist; add authored constraints ("no gravity towers") per sector for replayability |
| 10 | Weekly Mutation modifier pool expansion | Med | S-M | Weekly infra shipped; each new modifier is a small pure-function + copy + test |
| 11 | Public player-facing stats page (/stats) | Med | M | Aggregate anonymized board/telemetry into a transparency page; portfolio-visible data eng |
| 12 | Speedrun board (verified time-to-clear) | Med | S-M | Replays already carry timing; a new board dimension on existing rails |
| 13 | Meta-progression: cosmetic tower skins via Salvage | Med | M | Salvage wallet exists with few sinks; STRICTLY cosmetic (meta.ts boundary) |
| 14 | Endless leaderboard season resets with hall-of-fame | Med | M | Freeplay banking exists; seasonal archiving gives recurring "fresh ladder" moments |
| 15 | In-game "how it works" anti-cheat explainer | Med | S | Recruiters + players see the flagship engineering; one modal + docs link |
| 16 | Accessibility pass v2 (screen-reader menu audit, remappable keys) | Med | M | Baseline exists; keyboard placement already proves the input layer can support it |
| 17 | New region (sectors 13-16, "Beacon Graveyard") | Med | L | Content pattern proven by commit e2baca8; only after balance debt from the last 4 is paid |
| 18 | Community balance vote (admin-published A/B via config/balance) | Low-Med | M | Remote balance hot-patch exists; canary infra (adminCanary.ts) suggests groundwork |
| 19 | itch.io mirror build | Low-Med | S | Portal build pipeline exists; one more distribution surface, zero backend risk |
| 20 | Devlog series generated from docs/changelog.md | Low | S | Marketing for the portfolio itself; zero code risk |

## First steps for the top 5

1. **Replay share cards (#1)** — read `docs/idea_backlog.md` Appendix "Top Bet 2"
   (routing + OG constraints already solved on paper); first session: implement
   the dossier-image endpoint decision (static pre-render vs function) and a
   failing e2e test for link unfurl metadata.
2. **Daily streak + archive (#2)** — first session: design doc only — streak
   rules (UTC, grace day?), where it lives (meta.ts, cosmetic-only), archive
   board schema under `boards/daily-YYYYMMDD`; confirm firestore.rules impact.
3. **Sim coverage (#3)** — do ROADMAP-HANDOFF task N2 verbatim.
4. **Difficulty analytics (#4)** — first session: inventory what
   `runAnalytics/{runId}` + `adminAnalytics.ts` already aggregate; add one new
   panel (sector x protocol win-rate heatmap vs bot-expected) to AdminDashboard.
5. **Spotlight rotation (#5)** — first session: read `replaySpotlight.ts` and
   the admin verify path; add "suggest candidates" (top verified runs this week)
   to the admin console, keep crowning manual.

## Explicitly rejected directions

- Anything monetization-gated (Stripe MVP is owner-scoped, launch-gate item).
- Real-time multiplayer — breaks the deterministic single-stream replay model.
- Meta bonuses that touch run balance — violates the meta.ts boundary that the
  whole anti-cheat/ladder design depends on (`npm run meta:sim` will fail).
- User-generated maps — replay verification requires canonical map hashes;
  UGC would need a whole trust tier (revisit only with a "casual, no
  leaderboard" fence).
