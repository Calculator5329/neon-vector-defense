# Design brief — Gauntlet Protocol (roguelite runs)

Status: DRAFT for owner sign-off (2026-07-05). Waves 1–2 of the content plan are
merged; this is the last wave-2 item and it needs design decisions before a
Codex mission is cut. Each decision below has a recommendation — approve, amend,
or strike, and the mission prompt writes itself.

## One-line pitch

Three sectors back-to-back with one shared bank of cores and credits and a relic
draft between sectors — the mode that makes NVD a roguelite instead of a TD with
a roguelite garnish.

## Decisions needing owner sign-off

1. **Run structure** — RECOMMEND: 3 sectors, escalating protocol per leg
   (leg 1 Recruit-tuned wave count ~20, leg 2 Veteran ~25, leg 3 Apex ~30;
   custom shortened wave tables, not full 50–80 wave campaigns — a full gauntlet
   should be a 25–40 minute session). Alternative: fixed protocol chosen at
   start.
2. **Sector selection** — RECOMMEND: deterministic weekly-seeded route
   (3 sectors drawn from the pool with the ISO-week seed, same route for
   everyone that week → one shared `gauntletProtocolBoards/{weekly}` ladder,
   reusing week-key + board plumbing that just shipped). Alternative:
   player-picked route, personal-best board only.
3. **The bank** — RECOMMEND: cores carry fully between legs (start 150,
   never refill — survival IS the score pressure); credits carry at 60%
   (prevents leg-1 hoarding, keeps early spending honest). Towers do NOT carry
   (fresh board per sector); veterancy resets per leg.
4. **The draft** — RECOMMEND: between legs, draft 1 of 3 relics from the
   existing freeplay relic pool (they already stack multiplicatively and are
   recorded/verified). Leg 3 draft offers the spicier half of the pool.
5. **Abilities** — carry cooldowns across the leg boundary or reset?
   RECOMMEND: reset at each leg start (cleaner mental model, less snowball).
6. **Scoring** — RECOMMEND: total waves cleared across legs, then kills;
   a run ends at first grid-overrun (no leg retries). Board shows route icons +
   how far each warden got.
7. **Entry gating** — RECOMMEND: unlocked after any campaign victory
   (same gate as Veteran Deploy — the audience that wants this has it
   immediately; new players aren't confused by a fifth+ deploy surface).

## Technical shape (informational, no sign-off needed)

- A gauntlet run is 3 sequential `Game` instances. Each leg records/streams its
  own v3 replay (they're per-Game by design); a shared `gauntletRunId` +
  `leg` field links them, and the board row references all three runIds so the
  viewer can chain-play legs. Bank/draft state passes between legs in setup
  (recorded, so re-simulation and `verifyRun` work per leg; the server verifies
  each leg and checks the bank arithmetic between legs at submit).
- Weekly-seeded route derives from the same ISO-week util as the arena; the
  relic drafts must be seeded from the run seed (deterministic 3-choice offers)
  so replays are self-contained.
- New surfaces: a gauntlet card in Weekly Ops, a between-legs draft screen
  (reuses the freeplay relic modal), a 3-leg progress strip in-run.
- Sim-affecting only via the shortened wave tables (REPLAY_ENGINE_VERSION bump
  + baseline addition for the gauntlet tables — the harness gains a gauntlet
  profile so the mode is balance-gated like everything else).

## Effort

L. One Codex mission once decisions 1–7 are signed; the risky parts (multi-leg
replay linkage, bank verification) are specified above rather than left to
interpretation.
