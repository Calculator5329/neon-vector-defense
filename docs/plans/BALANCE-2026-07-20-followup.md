# Balance follow-up — 2026-07-20

> **UPDATE (2026-07-20, post-review + implementation).** Two of the four
> recommendations below were **corrected by data** once verified against the
> engine and the game's own difficulty model:
>
> - **(1) "Recruit→Veteran HP cliff" was overstated.** The engine already ramps
>   difficulty HP in over the first 25 waves (`engine.ts`: `ramp = min(1, wave/25)`),
>   so early Veteran ≈ early Recruit in the per-wave difficulty model (Δ 1–3 on a
>   0–100 scale through wave 20). The "+56%" figure was the wave-25+ **asymptote**
>   misapplied to wave 1. The *genuine* Veteran step-change is informational:
>   phase-cloaks from ~wave 14 + a leaner economy (detection is cheap and already
>   unlocked by the time anyone reaches Veteran). **Resolution: no HP nerf** (it
>   would also cut the "not too easy" goal Ethan set). Instead shipped a one-time
>   **Veteran intro** on first Veteran deploy + kept the existing cloak-toast.
> - **(4) The "wave 13–16 wall" is a sim-bot artifact, not a real spike.** The
>   difficulty model shows no wave-over-wave jump ≥4 anywhere in waves 2–20; the
>   bot dying at ~wave 16 on cloak-free Recruit is bot weakness. **Closed.**
> - **(3) Mastery routing** shipped: a "you've outgrown Recruit → Veteran" nudge on
>   a dominant Recruit clear (kept ≥70% cores, no Veteran progress yet).
> - **(2) Validate late-game scaling** — still open. The sim bot is too weak to
>   validate the "2-tower minimal clear" exploit; needs fresh real-player runs or a
>   hand-authored 2-tower scenario test. **Ethan constraint recorded: Apex and
>   Extinction must not get any easier** — all shipped changes are Veteran-only /
>   informational and touch no enemy HP.
>
> Original analysis preserved below for the record.

---


Context: NVD feedback pass. Reconciles the in-repo simulation data, the
2026-07-18 real-player run analysis, and the balance changes that landed on
master since, into concrete "more fun, not too easy" recommendations.

**Status:** analysis + recommendations only. Numeric balance changes are a
directional call → queued for Ethan, not applied here. An active balance round
(`BALANCE-2026-07-18.md`) already landed 3 changes that are **not yet validated
against fresh runs**.

## Data sources and how much to trust each

| Source | Date | Trust | What it says |
| --- | --- | --- | --- |
| Real-player `runAnalytics` (Firestore, 11 docs) | 07-18 | **High** (but small n) | Late-game too easy for skilled minimal play; early Extinction economy fair; phantom cloak leaks under-countered. Drove the 07-18 changes. |
| `public/balance-report.json` | 07-05 | **Stale** | Predates every 07-18 change. Do not cite as current. |
| Fresh `npm run sim -- quick` | 07-20 | **Low for absolute difficulty** | Bot dies wave ~13–16 on *every* difficulty incl. cloak-free Recruit, 0 wins. See below. |

### The sim bot is not a difficulty oracle
Fresh quick-sim (2 seeds/cell, current master): rookie/standard/**expert** bots
all die around wave 13–16 on Recruit — the *easiest* setting, no cloaks — winning
0/2 everywhere. Meanwhile the 07-18 real-player data shows humans clearing Recruit
with **2 towers and 54k credits unspent**. The bot is dramatically weaker than a
real player, so its absolute win-rates measure bot competence, not human
difficulty. **Do not tune the game to make the bot win.** Two things the sim is
still good for: (1) regression/relative signal, (2) surfacing the wave-13–16 wall.

## What already landed on master (07-18, unvalidated)
- Late-game pressure scaled up (targets the "2-tower clears are free" exploit).
- Extinction early bounty +10–15% on waves 1–15 only.
- Phantom cloak-tagging + counterplay + "cloaked wave incoming" preview warning.

## The structural problem: the Recruit→Veteran cliff
Difficulty knobs (`src/game/maps.ts` `DIFFICULTIES`):

| Protocol | lives | cash | costMult | hpMult | lateScale | waves | cloaks |
| --- | --: | --: | --: | --: | --: | --: | --- |
| Recruit (easy) | 200 | 900 | 0.85 | **0.9** | 0.28 | 50 | no |
| Veteran (normal) | 120 | 700 | 1.0 | **1.4** | 0.33 | 60 | yes |
| Apex (hard) | 80 | 700 | 1.2 | 1.8 | 0.38 | 70 | yes |
| Extinction | 70 | 950 | 1.2 | 1.95 | 0.43 | 80 | yes |

Stepping Recruit → Veteran hits a new player with **all at once**: enemy HP
+56% (0.9→1.4), lives −40%, starting cash −22%, phase-cloaks introduced, and
+10 waves. That is the "punishing to learn, then trivial to master" shape — the
classic un-fun curve. Recruit is a cakewalk; the very next rung is a wall.

## Recommendations (ranked by fun-per-risk)

1. **Smooth the Recruit→Veteran opening (highest leverage).** Ramp Veteran's
   early difficulty instead of front-loading it: hold enemy HP near ~1.25× for
   waves 1–15, ramp to the full 1.4× by ~wave 20. Tunable live via
   `balanceConfig.ts` `earlyWave*` knobs — no redeploy, reversible, no-op when
   empty. Keeps the mid/late Veteran curve intact.
2. **Validate the landed late-game scaling before touching it again.** The
   "2-tower clear" fix is unproven. Collect a fresh batch of trustworthy runs
   (the replay pipeline was only just fixed) and confirm a minimal-tower Throat
   Recruit now fails by the 40s, *without* making early Recruit un-fun. Don't
   stack more blind HP inflation.
3. **Reward mastery by routing, not by nerfing.** The "too easy for skilled
   players" fun-killer is best solved by pulling good players upward, not by
   inflating HP (which punishes newcomers). Add an adaptive nudge: after a clear
   with large unspent credits / low tower count, surface "Try Veteran →". Lean on
   the existing daily/weekly/gauntlet score chase for the ceiling.
4. **Investigate the wave 13–16 wall.** Even the cloak-free Recruit bot dies
   there. Check what waves 13–16 introduce (first elite/mini-boss?) and whether
   it's an intentional teaching beat or an unfair spike a fraction of new players
   also hit. Cross-check against real-run leak/first-death histograms.
5. **Data hygiene gate.** Re-collect a validated run batch (real players + sim)
   post replay-fix before any further numeric change. `npm run balance` refreshes
   `public/balance-report.json`; the 07-05 baseline is stale.

## Open decision for Ethan
Which of (1)/(3) to pursue, and the exact Veteran early-ramp target, are
directional. Recommend: do (1) via `balanceConfig` behind a fresh-data check (5),
keep (2) as the validation gate, ship (3) as a pure UX nudge (low risk).
