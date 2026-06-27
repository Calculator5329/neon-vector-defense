# Neon Vector Defense — Product Roadmap & Idea Backlog

> Generated from a whole-game audit (80 ideas, 8 dimensions) + a code-grounded planning pass. Status as of this commit.

## Build status

- **Top bets (1-6):** planned in detail below — NOT yet built (awaiting go-ahead per feature).
- **Quick wins:** SHIPPED this pass → next-unlock progress bar (in-game label + menu bar), Settings hub with **reduced-motion** + **colorblind palette**, **smart fast-forward** (persisted speed + capital-hull auto-ease to 1x), **music packs** (Concord Signal / Deep Drift generative) selector. Generating *new composed* music packs needs a valid OpenRouter key in `.env.local` (the current key 401s; the live key lives in the Cloudflare AI worker).
- **Big swings & by-theme backlog:** documented below — not scheduled.

---

---

# Neon Vector Defense — Whole-Game Idea Audit & Backlog

## State of the Game

This is a genuinely deep, well-instrumented TD that has already built the *hard* infrastructure most web TDs never reach: replay-verified server leaderboards, full run REPLAYS (events + per-wave snapshots), a headless bot at three skill tiers, a balance harness emitting `public/balance-report.json`, a deterministic daily seed, an admin BALANCE/TELEMETRY dashboard, an OpenRouter art/music/voice pipeline, and a rich 14-fragment lore canon. **The systems are strong; the surfacing is weak.** Three patterns recur across all 80 ideas and define the opportunity:

1. **Dormant assets with no read path.** Replays are uploaded and used server-side only — there is no `fetchRunReplay`, the `replayOpens` counter never fires, and the 6 authored cutscene stills (`genscenes.mjs`) are never generated to disk or imported. The single highest-leverage move is *reading back* what the game already records.
2. **Mechanical depth that's one-input-deep.** Resonance has one source (Cantor) and one detonator. `gravity` FireStyle is fully implemented in `engine.ts:1489` but **no tower uses it**. Damage types are binary immunity (which is exactly why the expert bot stacks energy). Target priority is sort-only and the bot never even changes it.
3. **Zero meta/retention/monetization loop and zero accessibility.** No account level, currency, quests, or login-streak reward despite `sessionDays` already being persisted. No entitlement field, no share path, no ads. **Zero a11y CSS** (confirmed: no reduced-motion/colorblind/UI-scale anywhere) — a hard blocker for CrazyGames/Poki certification.

**Biggest opportunities, in order:** (a) turn the replay corpus into the social/virality engine; (b) ship the meta loop (rank + currency + quests + streak) that gives portal players a reason to return tomorrow; (c) close the a11y + onboarding gaps that gate portal acceptance; (d) deepen 2–3 mechanical axes so the bot's homogeneous energy-stack stops being optimal.

---

## TOP BETS — Highest leverage, reasonable effort

1. **Battle Plan replays — give the replay corpus a read path.** [transformative / L] Every leaderboard row already carries a `runId` pointing at uploaded snapshots, but nothing ever reads them back (`fetchRunReplay` doesn't exist; `replayOpens` is dead telemetry). Build a snapshot *flipbook* viewer (fade towers in at `placedAtS`, animate `damageByTower` as heat rings, step a credits/leaks bar) — a reconstruction, not a frame-perfect sim, which sidesteps the engine's `Math.random` non-determinism. **Why now:** this single feature unlocks ~6 downstream social ideas (share cards, duels, ghost armada, champion replays, Replay-of-the-Day) and costs almost nothing in new data.

2. **Shareable neon result cards + `?run=` deep links.** [transformative / M] Generate a 1200×630 "mission dossier" canvas at run end (callsign, wave, top-3 carrying towers from `final.damageByTower`) with `navigator.share`/clipboard, plus URL routing (`App.tsx` already parses `URLSearchParams` for perf flags). **Why now:** this is *the* CrazyGames/Poki virality loop — "beat my Wave 91" with a real image and a one-click in-browser replay — and it's the payoff that makes Battle Plan worth building.

3. **The meta loop: Warden Rank + Salvage + Daily/Weekly Operations Board + Watch Streak.** [transformative / L] No meta-currency or account level exists today; progression dead-ends once the last kill-gate (150k kills) is passed. XP and Salvage derive entirely from counters already in `storage.ts`; quests generate free from the same deterministic date-hash that drives the daily seed (no backend writes to issue them); and `sessionDays`/`markSession()` are *already persisted* — a Watch Streak is the lowest-effort retention hook in the codebase. **Why now:** portal economics live or die on D1/D7 return, and this is the missing "one more run / log in tomorrow" spine. Keep it cosmetic/QoL and flag meta-modified runs off-ladder to protect the bot-tuned balance.

4. **Remote balance config — hot-patch towers without a redeploy.** [transformative / L] All balance is static TS today, so every nerf needs a full `tsc && vite build` + Firebase deploy. A sparse `config/balance` Firestore doc fetched on boot (overrides applied in `computeStats()`/`makeEnemy()`, missing doc = current values as fail-safe) lets the operator hot-fix a dominant tower during a portal traffic spike. `setup.balanceVersion` already exists to stamp which config a run used. **Why now:** the moment you get portal traffic you *will* find a dominant build (the bot already reveals energy-stacking), and a 5-minute build cycle is the wrong tool under live load.

5. **Bot-rival ghosts + live balance canary.** [high / M] The bot already produces per-wave cores/cash curves into `balance-report.json`, used only offline. Render the chosen tier's curve as a live translucent target ("Expert Warden held 48 cores at Wave 40 — you have 51") with an "Out-warded the AI" badge. **Why now:** it gives every solo portal player a built-in opponent with zero matchmaking, *and* doubles as a free live-balance canary when real player curves diverge from the bot's — pure reuse of an asset that's currently invisible to players.

6. **The `gravity` Phase Anchor tower — finish the orphaned engine path.** [high / M] `FireStyle 'gravity'` is fully handled in `engine.ts:1489` (drag/slow) but **no `TOWERS` entry uses it** — the mechanic is built and abandoned. A no-damage positional control tower (one track holds hulls in a kill-pocket, the other repels to break Seraph/Lampblack heal-clusters) is the keystone "enabler" the independent-tower meta lacks, and it's the linchpin for the adjacency, density, and exposure ideas. **Why now:** highest mechanical-depth-per-effort because the hard part already ships.

---

## QUICK WINS — High impact, low effort (S–M)

- **Watch Streak** [high/S] — consecutive-UTC-day counter over the already-persisted `sessionDays`; meter on menu + "The lantern dimmed — relight it" comeback prompt.
- **Settings hub gaps → at minimum Reduced Motion + Colorblind palette** [high/S–M] — *certification blocker.* Gate camera shake / hurt vignette / full-screen tints behind a flag; remap the four damage-type colors (currently the *only* type signal) to a safe set. Persist alongside existing audio prefs.
- **First-clear windfalls + "Next Arsenal: Tesla — 120/150 hulls" progress bar** [medium/S] — the kill-gate is silent today; `engine.ts` already detects unlocks mid-run. Pure UI over the existing kills counter.
- **Adaptive-armor counterplay ability "Recalibrate"** [medium/S] — `this.adaptation.type` already tracked; one new ability that clears the current resist on a cooldown turns silent punishment into a decision.
- **Smart fast-forward** [medium/S] — persist preferred speed across runs; hold-to-FF for touch; auto-ease to 1x when a leviathan enters (the announce already fires) so players don't lose a run at 4x.
- **Music packs** [medium/S] — `startPlaylist()` already shuffles a hardcoded MP3 array; a pack is one array reference + a few `genaudio.mjs` tracks.
- **Voice the Combine & Hollow** [medium/S] — `genvox.mjs` already takes a `voice` field and `vox()` dispatches by name; add `LINES_COMBINE`/`LINES_HOLLOW` so the Courier hail comes from the *other side*.
- **Replay-of-the-Day menu spotlight** [medium/S] — once Battle Plan exists, `fetchGlobalTop` rows already carry `runId`; a small selection heuristic (highest Apex+ wave with unusual top-damage mix) gives a fresh daily reason to open the game.

---

## BIG SWINGS — Ambitious, roadmap (L/XL)

- **The Severance Campaign** [transformative/L] — a 12-mission star-map wrapping the 14 ARCHIVE fragments in fixed map+protocol+modifier nodes with *alternate win conditions* ("let exactly one carrier dock," "assemble the receiver before wave X"). Gives new players a guided 2–3hr path the current map×difficulty grid lacks; reuses freeplay's constraint plumbing for objectives.
- **Multi-phase Umbra boss fight** [transformative/L] — bosses share one generic stun-pulse today. Promote THE UMBRA to a 3-phase set-piece (range-drain inhale → Lampblack un-heal escorts → untargetable-except-in-light), reusing `pulseCd`, `heal`, and the zone/light code. The marquee fight the late game is missing.
- **Server-side replay re-simulation** [high/XL] — `checkReplay` currently only bounds the self-reported summary ("a hand-crafted fake replay can still pass"). Port the deterministic engine into a Cloud Function to recompute scores from recorded events. The bot harness already proves headless determinism. *Essential before serious portal traffic* — but XL, so sequence after the virality loop creates a reason to cheat.
- **Recovered-Signal Pass** [transformative/L] — free+premium seasonal track paying out in *lore, not power* (new ARCHIVE-style arc, voiced via `genvox`, illustrated via `genart`). Content production becomes a prompt run; needs only a season window + `tierFromXP()` + the first entitlement field. Zero balance/ladder impact.
- **Ghost armada async PvP** [high/L] — `applyMutatorsToWave` already injects custom `WaveGroup[]`; snapshots record `leaksByEnemy`. Weaponize a completed run into an attack wave-set (`?armada=r_xxx`) the recipient defends — turning the replay corpus into a near-infinite supply of attributed, player-authored challenges.

---

## By Theme

### Gameplay depth
- **Damage-type resistance matrix** [high/M] — replace binary immunity with soft RPS (armored = 35% kinetic not 0%; per-type multipliers) to kill the bot's "energy solves everything" dominant build. ~2 lines in `damageEnemy`.
- **Beacon Grid adjacency links** [transformative/L] — pairwise fire-style synergies drawn as neon lattice lines; the O(n²) neighbor scan already runs in `updateAuras()`. The single biggest missing strategic axis (placement-as-puzzle).
- **Persistent "Exposed" debuff** [high/M] — make `shred` a stackable timed vulnerability instead of an on-hit boolean, so shredders *set up* kinetic dealers (a real combo); slots beside the resonance branch.
- **Resonance as a combo hub + a purge enemy** [high/M] — let select bonus-tier upgrades on other towers apply stacks; add a Hollow "Mnemosyne" that purges stacks in an aura, turning Cascade into a timed skill check.
- **Smart target-priority filters** [high/M] — stackable archetype filters (Bosses/Armored/Cloaked/Healers/Spawners) on top of the 4 sort modes; `recordTargetMode` already measures adoption. Bot never touches this — pure untapped depth.
- **Per-tower veterancy "doctrines"** [medium/L] — a chosen perk at rank 3, *data-driven by the replay corpus + balance harness* so the admin dashboard can flag dead doctrines.
- **Convoy economy: overkill banking + kill-zone multiplier** [medium/M] — reward concentrated firepower; gives finisher towers an economic identity and counters the freeplay `incomeMult` taper.
- **Lane-state: AoE-scales-with-density + traffic-jam stun** [medium/M] — nothing reads the clustering that drag/slow create; makes CC a burst-setup multiplier.

### Content variety
- **Tidal Dark map family** [high/M] — animate the static `zones` into an advancing wall of un-light that drains range until re-ignited; "the lighthouse forgets it was lit" as a real mechanic.
- **Salvage Convoy enemies** [high/M] — cargo hulls that *steal pickups and flee* (lose-the-loot pressure) and Foundry Barges that print swarms while alive — the inverse of the die-to-split model.
- **Apex Predator / Mirror Hull boss** [high/M] — a flagship that reads your single highest-DPS tower at spawn and goes immune to that type, making the silent adaptive system legible and dramatic.
- **Branching-lane maps with a player blast-door** [high/L] — two corridors that merge + a cooldown-gated junction; the highest-variety-per-effort *structural* upgrade over single polylines.
- **"The Queue" pacifist-puzzle protocol** [high/L] — score on *restraint*; overkill spawns Hollow wisps. Recontextualizes the whole game and is great press/portal differentiation; reuses Long Watch's friendly-Combine code.
- **Hollow Incursion named encounters** [medium/M] — authored `WaveGroup` recipes with one-line objective banners ("The Drowning," "Foundry Run," "Eclipse") spliced in like risk waves.
- **Environmental hazard layer** [medium/M] — ion-storm/gravity-well/ember-vent map features reusing existing cloak/slow/burnZone machinery; cheap per-map identity.
- **Seasonal themed events** [medium/S] — dated seed config + palette swap + scoped leaderboard ("Blossom Watch," "The Long Dark"); minimal code, strong "come back this week" hook.

### Retention / meta
- **Service Commendations medal ledger** [high/M] — Bronze/Silver/Gold over fields `storage.ts` *already* records (kills, clears, zero-leak, armistice); surfaces a concrete "next goal" three taps from a fresh win.
- **Persistent tower mastery ranks** [high/M] — carry `runStats.kills` into lifetime per-tower ranks with tiny starting perks; reuses the exact `rankOf` math that currently evaporates at game-over.
- **Map Mastery 3-star tracks** [high/M] — clear / Apex+ / twist-clear per map (twists reuse freeplay `maxTowers`/`noSell` constraints); a "14/24 stars" completion checklist.
- **The Archive → full Codex** [high/M] — Bestiary (unlock-on-first-kill) + Armory (unlock-on-first-build) + a "Concord Archive 62% recovered" meter; portraits via `genart`.
- **Ghost-of-yesterday pacing** [high/L] — overlay your previous-best wave timing + the daily leader's count for a personal-best chase (needs Battle Plan's read path first).
- **Prestige "Long Watch Tours"** [high/L] — opt-in unlock reset for permanent faction Doctrine points; an endgame ladder past the current ceiling for the most-engaged.

### Monetization (sequence *after* the meta loop + a11y; portal-ethical only)
- **One-time "Warden's Commission" premium unlock** [high/S] — ad-free + founder cosmetics + voiced-fragment deluxe codex; gates *no* gameplay. The simplest, highest-conversion SKU; needs only an entitlement flag (none exists today).
- **Neon tower palette skins** [high/M] — `render.ts` keys all visuals off `def.color`/`def.glow`; a skin is ~6 hex pairs, zero art. Cheapest visible SKU.
- **Kill-effect & projectile-trail cosmetics** [high/M] — swappable particle recipes on the highest-frequency event in a TD; pure render hooks via the existing particle system.
- **Lighthouse / base skins** [high/M] — sell the thing the game is *about* protecting; `genart` already renders the beacon spire on demand. Most emotionally resonant cosmetic.
- **Ethical rewarded ads at 3 honest moments** [high/M] — revive (campaign-only, excluded from ranked so replays stay clean), double-salvage, daily *cosmetic* reroll. Removed by the premium unlock. *No ad code exists today.*
- **Lantern Marks play-only currency** [medium/M] — earns the same cosmetics slower; keeps the game F2P-fair (Poki/CrazyGames reward generosity), real money only buys the pass/unlock.
- **Daily cosmetic try-before-you-buy capsule** [medium/S] — the deterministic daily hash also grants one rotating cosmetic free for that run; strongest conversion funnel.
- **Enemy "signature hull" skins shown in replays** [medium/L] — recoloring is proven (Hollow hue-rotate); cosmetics surface in shared replays as self-marketing social proof.

### Social / competitive (all gated on Battle Plan's read path)
- **Daily Seed duel** [high/M] — `?daily=DATE&beat=runId` boots the identical deterministic seed with the opponent's wave as a HUD target — a genuinely fair async duel.
- **Concord Squads** [high/L] — join-by-code clans (no login; reuse anonymous `uid`) summing daily waves into a weekly faction race — the strongest portal retention lever.
- **Weekly Watch tournaments** [high/M] — server-rotated weekly seed + fresh board namespace + frozen podium whose top-3 `runId`s auto-feature as Champion Replays; inherently cheat-resistant since submission already requires a matching replay.
- **Last-Stand spectate cards** [medium/S] — scrub the final 2–3 waves and name the enemy that broke you (`biggestLeakWave`/`leaksByEnemy` already recorded); a viral defeat moment.
- **Friend duel codes** [medium/M] — private 1v1 ladders over `uid` + seed + score CF + the replay viewer; all components reused.

### UX / juice / a11y
- **Damage-type glyph layer** [high/M] — bake monochrome glyphs into cached sprites/chips so type is readable at 4× on a packed board; directly supports the adaptive-armor warning that names a type but shows nothing.
- **Kill-combo / overkill juice** [high/M] — streak counter, escalating `+reward` popups, pitch-rising pops, multi-kill callouts via the existing `kind:'text'` particle + shake. Transforms the first-60-seconds feel portals judge on.
- **Interactive guided first build** [high/L] — replace the static 5-panel `HowToPlay` with an action-gated coach (pulse the recommended tower, ghost a placement halo, gate on real `PLACEMENT`/`WAVE_LAUNCH` events). Fixes the funnel's most fragile moment.
- **Responsive touch layout + haptics** [high/L] — *no responsive media queries exist*; bottom-dock arsenal, thumb-sized targets, `navigator.vibrate` on place/upgrade/leak. Needed ahead of the mobile push.
- **Full Settings hub (UI scale + high contrast)** [high/L] — the larger version of the Quick Win; root `--scale` var + contrast bump. Portal certification.
- **Range coverage heatmap** [medium/M] — hold-to-reveal all rings + shade uncovered lane segments; reuses `drawRange` + lane math.
- **Undo placement + drag-to-move (un-upgraded, build-phase)** [medium/M] — removes the misclick→sell-at-loss frustration spike for new players.
- **Cinematic wave-clear / boss-down moments** [medium/M] — slow-mo + flash + nova ring on boss death, "WAVE n CLEARED" banner; shareable screenshot beats from existing primitives.
- **Live HUD coaching ticker** [medium/M] — build-phase tips from cheap heuristics the bot already encodes ("No cloak detection — cloaked wave next"); fades out after N runs so veterans aren't nagged.

### Tech / live-ops
- **Cloud save on the anonymous uid** [high/M] — opt-in `saves/{uid}` mirror of the progress blob (last-write-wins); a "sync phrase" carries blueprints/unlocks across devices. Pure upside on infra already paid for; portal players switch browsers constantly.
- **Auto-flag dead/dominant towers from LIVE telemetry** [high/M] — extend `deriveInsights` with tower-economy verdicts (`placedByTower`, `damageByTower`, `lockedTowerClicks`, `quickSellbacks`) and reconcile against the sim's static flags to see where players and the bot disagree.
- **Live-vs-sim balance regression CI gate** [high/M] — no GitHub Actions exist; run `npm run balance` per PR, diff against committed baseline, fail on dead↔OP flips or >15% win-rate swings.
- **Bot-driven content QA gate** [high/M] — scope solo-viability/strategy-matrix/perf to *changed* content and assert pass/fail thresholds so a 19th tower or new Hollow enemy can't ship un-vetted.
- **Build tag → real A/B cohorts** [high/M] — `build` is plumbed end-to-end and sliced in the dashboard but is a manual literal; bucket by `hash(uid)` to make per-build slicing an instant A/B readout.
- **Difficulty auto-tuner** [high/L] — invert the existing `analyzeDifficulty` model + `DIFFICULTY_TARGETS` to *solve* wave params toward a curve (validated by a bot pass) and emit a remote-config override; optionally bias by live `medianLeakWave`.
- **Error + long-frame beacon** [high/M] — no `onerror` handler exists, so crashes/stalls on hostile portal browsers are invisible; a tiny consent-gated `errors` doc + a per-build/userAgent "Stability" card.
- **Finish the PWA** [medium/M] — `sw.js` + manifest exist but no chunk precache and the SW version is decoupled from `TELEMETRY_BUILD`, so installed players run zombie builds that pollute telemetry; add precache + "New build — reload" toast tied to the build tag.

### Narrative / AV
- **Wire the orphaned 6-scene cutscene engine** [high/M] — `genscenes.mjs` authors six captioned stills that are *never generated to disk or imported*; the `cutscene-box` CSS already exists. Play them at matching fragment beats with Ken-Burns + voiced read. Near-zero new art cost.
- **Reactive threat-tiered music** [high/L] — cross-fade calm/engaged/crisis stems off live hull-count/boss-present/lives-lost (a leviathan entering hard-cuts to crisis); `musicBus` + procedural-pad fallback already exist as the lowest layer.
- **Distinct Hollow visual language** [high/M] — render Hollow hulls as light-*subtractors* (`destination-out`/`darker` carving the starfield) instead of a hue-rotate; LOD-gated like existing flourishes. Makes "it eats light" literal at the renderer.
- **Branching archive fragments seeded by how you played** [high/L] — pick fragment variants from run telemetry (dominant damage type, leviathan outcome); mass-generate variants via `genfrags`. Two players' archives genuinely differ.
- **Lantern audio logo + per-faction sonic palette** [high/M] — a 3–4 note leitmotif (hinted by `PENTA[]`) in boot/waveClear/victory; Hollow gets a reverse-swell "un-sound," allies a warm violet tone so you *hear* friend vs foe.
- **Wardens' Log voiced epilogue** [medium/M] — feed the run summary to the existing `aiHelp` OpenRouter worker for an in-voice end-card, cached by coarse outcome bucket. A memorable, shareable results screen.
- **Environmental storytelling props** [medium/M] — bake per-map decorations (the deck-seven cherry tree, drifting dead hulls, the four dark lighthouses) into the already-cached `buildBackground` — zero per-frame cost, instant place-not-path identity.
- **Complete + surface per-tower/ability lore in a Codex room** [medium/S] — `ABILITY_LORE` is missing `cascade`/`mirror`; tower lore shows once then is buried. Consolidate towers + fragments + (newly wired) scenes into one archive view.
- **Unified bloom/grain post pass + color discipline** [medium/M] — one cheap full-frame bloom + grain layer and a tighter 2-accent palette per sector reserving cyan as the brand and faction colors for enemies; the difference between "a neon TD" and a recognizable portal thumbnail.

---

## Recommended Sequencing for a Web-Portal Launch

1. **Pre-launch must-haves (a11y + onboarding + feel):** Reduced-Motion + Colorblind, damage-type glyphs, interactive first build, kill-combo juice, "next unlock" progress bar, smart fast-forward. *Without a11y you may not pass certification; without juice you lose the first-60-second judgment.*
2. **Launch retention spine:** Warden Rank + Salvage + Operations Board + Watch Streak, Service Commendations, Map Mastery stars. *Gives D1/D7 return before you spend traffic.*
3. **Launch virality engine:** Battle Plan read path → result cards + `?run=` links → Daily Seed duel → Replay-of-the-Day. *Sequenced as a chain; each step reuses the last.*
4. **Live-ops safety net (in parallel with 1–3):** remote balance config, error beacon, live tower dead/dominant flags, cloud save. *So you can react to launch-day reality without a redeploy.*
5. **Post-launch depth & monetization:** gravity Phase Anchor + adjacency + resistance matrix (kill the energy-stack meta), then premium unlock + cosmetics + ethical revive, then the Recovered-Signal Pass.
6. **Hardening when traffic justifies it:** server-side replay re-sim (XL) once the virality loop creates a real incentive to forge scores.

**Key files referenced:** `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\engine.ts` (gravity branch line 1489, `damageEnemy`, `updateAuras`, `rankOf`), `towers.ts` (no gravity tower; `def.color`/`glow`), `render.ts` (particles, `buildBackground`, `corruptedSprite`), `leaderboard.ts` + `runTelemetry.ts` + `adminAnalytics.ts` (replay/snapshot infra, `balanceVersion`), `freeplay.ts` (daily seed, `applyMutatorsToWave`), `storage.ts` (`sessionDays`, anonymous uid, no entitlement field), `sound.ts` (`startPlaylist`, `musicBus`, `PENTA`), `App.css` (zero a11y queries; `cutscene-box` reused), `scripts\genscenes.mjs` (6 unwired stills), `functions/src/index.ts` (`checkReplay` summary-only).

---

# Appendix A — Detailed Implementation Plans (Top Bets)

*Each plan was produced by reading the actual code; treat as implementation-ready specs.*



## Top Bet 1 — Battle Plan Replays (read path + viewer)

---

# Implementation Plan — Battle Plan Replays (read path + flipbook viewer)

## 1. Overview

Add a **read-only replay viewer** for runs already being written by `submitRunReplay` (`runs/{runId}` + `runs/{runId}/chunks/c{n}`). The write path, telemetry shape, and Firestore rules already exist and need **no changes**. We are building:

1. **`fetchRunReplay(runId)`** in `src/game/leaderboard.ts` — reads `runs/{runId}` and (if `chunkCount > 0`) its chunk subdocs, reassembles the full event list, validates/normalizes into a typed `PublicRunDoc`.
2. **A "flipbook" reconstruction viewer** (`src/ReplayViewer.tsx`) — a canvas component that reconstructs the run from the **per-wave snapshots** (`PublicRunDoc.snapshots: RunWaveSnapshot[]`) plus the event stream. It is explicitly a **reconstruction, not a re-sim**: the engine's `update()` loop uses `Math.random()` (camera shake, spawn jitter, lane traffic) so a frame-perfect replay is impossible. We render the **board** (reusing `buildBackground(map)`), **fade towers in** at their `placedAtS`, paint **`damageByTower` as a heat ring** per tower, and **scrub a wave/credits/cores/leaks HUD bar** across snapshots.
3. **Launch points**: a `?run=<runId>` route (served by the existing `**` → `index.html` rewrite) and a **"WATCH" button on leaderboard rows that carry a `runId`** (currently `ScoreEntry.runId` is fetched but never surfaced).
4. **Wire up the dead `replayOpens` counter** — `RunRecorder.recordReplayOpen()` / `recordLeaderboardRowClick()` exist and `AdminDashboard` reads `leaderboard.replayOpens` (line 1739) but nothing increments it. Note: these recorders live on the *active game's* `RunRecorder`, which only exists during a live game; from the menu leaderboard there is no live recorder. See §7 for the resolution (a lightweight `appMetrics`/standalone counter, not the per-run recorder).

**Why this is the right shape:** the public run doc is purpose-built for this. `snapshots` carries `towers: RunTowerSnapshot[]` (with `x/y/towerId/placedAtS/soldAtS/tierA/tierB/targetMode/damage`), `damageByTower`, `cash`, `lives`, `kills`, `leaks`, `wave` at each `wave_start`/`wave_end`/terminal label. `final.damageByTower` gives the run-total heat. We do not need projectiles or enemy positions — those aren't in the doc and aren't needed for a "battle plan" overview.

---

## 2. Data model / types

All replay types already exist in `src/game/runTelemetry.ts` and are exported — **reuse them, do not redefine**:

- `PublicRunDoc` (lines 104–150): `summary`, `setup`, `events: RunEvent[]`, `snapshots: RunWaveSnapshot[]`, `final`, `chunkCount`, `eventCount`.
- `RunWaveSnapshot` (48–61): `label, t, wave, cash, lives, kills, leaks, towerCount, enemyCount, damageByTower, killsByEnemy, towers`.
- `RunTowerSnapshot` (30–46): `towerUid, towerId, name, x, y, placedAtS, soldAtS?, tierA, tierB, committed, targetMode, invested, kills, damage, upgrades[]`.
- `RunEvent` (21–28): `type, t, wave, cash, lives, …payload`.
- `RunEventChunkDoc` (152–157): `schemaVersion, runId, chunk, events`.
- `RUN_TELEMETRY_SCHEMA = 2`, `RUN_EVENT_CHUNK_SIZE = 650`.

**New types** (add to `runTelemetry.ts` next to the existing doc types so reader + viewer share them):

```ts
// A fully-reassembled, validated replay: run doc with all chunk events concatenated.
export interface LoadedRunReplay {
  run: PublicRunDoc;       // events[] = doc.events ++ all chunk.events, in order
  totalEvents: number;
}
```

**Viewer-internal type** (lives in `ReplayViewer.tsx`, not telemetry): a `ReplayFrame` describing what to draw at a scrub position `t` (derived, not stored):
```ts
interface ReconstructedTower {
  def: TowerDef; pos: Vec; tierA: number; tierB: number;
  placedAtS: number; soldAtS?: number; damage: number; name: string; targetMode: TargetMode;
}
```
Resolve `towerId → TowerDef` via `TOWER_MAP` (exported, `towers.ts:484`). Skip any unknown id defensively (forward-compat if a tower is renamed).

---

## 3. Exact files to create / edit

### A. `src/game/leaderboard.ts` — add the reader (EDIT)

Add `fetchRunReplay(runId: string): Promise<LoadedRunReplay | null>`. Mirror the existing fetch helpers' style (`withTimeout`, try/catch returning a falsy default, `isValidRunId` guard which already exists at line 86).

- Guard with `isValidRunId(runId)` → return `null` on bad id.
- `getDoc(firestoreDoc(db, 'runs', runId))` wrapped in `withTimeout`; if `!snap.exists()` → `null`.
- Cast `snap.data()` and **normalize** through a new `normalizeRunDoc(id, data)` (defensive, like `normalizeRunAnalytics` at 397 — default every field, clamp arrays, coerce numbers). This protects the viewer from partial/legacy docs.
- If `run.chunkCount > 0`: fetch chunks `c0..c{chunkCount-1}` with `Promise.all` of `getDoc(firestoreDoc(db, 'runs', runId, 'chunks', \`c${i}\`))`, each `withTimeout` + per-chunk try/catch → skip a missing chunk rather than fail the whole load. Concatenate `run.events` with each chunk's `events` (sorted by `chunk` index) to form the full ordered event list.
- Cache: add a small `Map<string,{expires,replay}>` mirroring `topCache` (TTL `LEADERBOARD_CACHE_TTL_MS`, already defined) so re-opening the same replay / React strict-mode double-mount doesn't refetch.
- Return `{ run, totalEvents }`.

Imports already present: `getDoc`, `firestoreDoc`, `collection`, `withTimeout`, `db`, `isValidRunId`, `PublicRunDoc`. Add `RunEventChunkDoc`, `LoadedRunReplay`, `RunWaveSnapshot`, `RunTowerSnapshot` to the `runTelemetry` type import.

**Note on chunk fetch cost:** `chunkCount ≤ 100` (rules cap) but real runs are tiny (events sliced to 650 in the head doc; chunks only when `eventCount > 650`). The reader should fetch chunks **lazily/optionally** — the flipbook only strictly needs `snapshots` + the head `events`; chunk events are only needed for the event-scrubbed detail (tower place/upgrade/sell timeline beyond the first 650 events). Plan: load the head doc first, render immediately from `snapshots`; fetch chunks in the background and merge. This keeps first paint fast.

### B. `src/game/render.ts` — export two existing helpers (EDIT, minimal)

The viewer needs to draw the static board. `buildBackground` (311) and the `circle`/`shade`/`withAlpha` helpers are module-private. Cheapest reuse:

- Add `export` to `buildBackground` (line 311) → `export function buildBackground(...)`. It takes only a `GameMap` and returns a cached `HTMLCanvasElement`; no `Game` needed. This is the single biggest reuse win — full themed board + path + blockers + zones for free.
- Optionally export `drawMarkers(ctx, map, time)` (772) and `drawBlockers(ctx, map, time)` (804) — but `buildBackground` may already bake blockers/markers; verify by reading 311–436 before deciding. If they're baked into the background, **skip exporting them**.
- `drawTowerBody` is **already exported** (950) and is `Game`-free: `drawTowerBody(ctx, pos, def, angle, tierA, tierB, alpha, flash, time, recoil, overdriven)`. This is exactly the primitive for fading towers in (drive `alpha`), at their committed tiers, with an idle `angle` (e.g. `-Math.PI/2` or a slow `time`-based sway).

No new rendering logic added to `render.ts` — we only widen visibility. This keeps the engine render path untouched and avoids regressions.

### C. `src/ReplayViewer.tsx` — the viewer component (CREATE)

A self-contained React component, lazy-loaded like `AdminDashboard`/`PrivacyView`. Props: `{ runId: string; onExit: () => void }`.

**Responsibilities:**
1. On mount: `fetchRunReplay(runId)` → loading / not-found / loaded states. Resolve `setup.map` → `GameMap` via `ALL_MAPS.find(m => m.id === run.setup.map)`; `setup.diff` → `DIFFICULTIES.find(...)`. If the map id is unknown (legacy/renamed), show a graceful "map unavailable" board fallback (solid bg + path from… not available — so just show the summary card; do not crash).
2. Canvas at `W×H` (1280×720, from engine), letterboxed/scaled to container with the same CSS approach `GameScreen` uses (read `GameScreen`'s canvas sizing to match).
3. **Reconstruction model:** maintain a scrub position. Two scrub modes, simplest first:
   - **Wave flipbook (primary):** index into `snapshots[]`. Each snapshot is a keyframe. Stepping = prev/next snapshot; playing = auto-advance with a dwell (e.g. 1.5s) and a short cross-fade between keyframes (interpolate `cash/lives/kills` numerically for the HUD; towers fade in when `placedAtS <= snapshot.t`).
   - **Time scrub (secondary, derived):** a continuous `t` from `0..summary.durationS`. Pick the latest snapshot with `snapshot.t <= t` as the board state; towers with `placedAtS <= t && (soldAtS == null || soldAtS > t)` are shown, fading in over ~0.4s after `placedAtS`. `damage` heat uses the active snapshot's `damageByTower` (keyed by `towerId`, mapped onto towers; if multiple towers share an id, distribute by per-tower `RunTowerSnapshot.damage`).
4. **Render each frame:**
   - `ctx.drawImage(buildBackground(map), 0, 0)`.
   - For each reconstructed tower: compute `alpha` (fade-in), call `drawTowerBody(ctx, pos, def, angle, tierA, tierB, alpha, 0, time, 0)`.
   - **Heat overlay:** for each tower, draw a radial glow ring whose intensity ∝ `tower.damage / maxDamageThisFrame` (use `globalCompositeOperation='lighter'`, `def.glow`). This animates the "who carried" causal story as you scrub — high-damage towers burn brighter. Use `final.damageByTower` for the all-time view at the end keyframe.
   - **HUD bar:** wave `N/${setup…}`/`summary.wave`, `⌬cash`, cores (lives) as pips, kills, leaks — pulled from the active snapshot. A horizontal timeline strip with snapshot ticks (labelled by `label`: `wave_start`, `wave_end`, `run_end`) is the scrubber.
   - **Outcome stamp** at the terminal keyframe: `summary.outcome` (victory/armistice/gameover/abandoned), callsign, map/diff names.
5. Controls: Play/Pause, Step ◀ ▶, speed (1×/2×/4× — reuse existing speed-button styling), a draggable timeline, Exit. Use `requestAnimationFrame` for the play loop (no engine `update()` — purely visual interpolation).
6. Telemetry: call the `replayOpens` increment on successful load (see §7).

**Reuse:** `buildBackground`, `drawTowerBody` (render.ts); `W,H` (engine.ts); `TOWER_MAP` (towers.ts); `ALL_MAPS, DIFFICULTIES` (maps.ts); `fetchRunReplay`, types (leaderboard/runTelemetry); `sfx.click` for buttons; existing CSS variables/board classes.

### D. `src/App.tsx` — routing + leaderboard "WATCH" button + cleanup (EDIT)

1. **Route** (top-level, alongside `isPrivacyRoute`):
   - Add `function runIdFromUrl(): string | null` reading `PERF_PARAMS.get('run')` (the `URLSearchParams` is already built at line 62) and validating with the same `^r_[A-Za-z0-9_-]{8,80}$` shape. A `?run=` param is preferred over a `/watch` pathname because the existing `**`→`index.html` rewrite (firebase.json:27) makes both work, but `?run=` avoids a second `pathname` fork and matches the existing `?perf`/`?demo` convention.
   - In `App()` (line 100): after the `ADMIN` and `isPrivacyRoute` checks, add `const watchId = runIdFromUrl(); if (watchId) return <Suspense fallback={null}><ReplayViewer runId={watchId} onExit={...}/></Suspense>;`. The viewer is a public, read-only surface → it should **bypass the AgeGate** (no player-attributed writes happen), so place it *before* `<Gate/>` exactly like the privacy route. (Confirm with consent rules — the viewer only *reads* public docs, writes nothing, so this is safe.)
   - `onExit`: clear the `?run` param via `history.replaceState` and re-render to the menu (or `location.assign('/')`). Simplest: `() => { location.href = '/'; }`.
   - `ReplayViewer = lazy(() => import('./ReplayViewer'))` next to the other lazies (line 53).
2. **WATCH button on leaderboard rows** (`LeaderboardTab`, 668–768): rows already have `r.runId` in scope (it's on `RankedScoreEntry`/`ScoreEntry`, fetched at leaderboard.ts:669/700 but unused). For each global/local row where `r.runId` is a valid run id, render a small "WATCH" button/link → `?run=${r.runId}` (anchor `href` so it's shareable + works with the rewrite; or onClick that calls the row-click/replay-open counter then navigates). Empty `runId` (older scores, or scores whose replay submit failed — see App.tsx:1275 `replayOk ? game.runId : undefined`) → no button.
   - This also gives `recordLeaderboardRowClick` a home, but note the menu has no live `RunRecorder` (see §7).
3. **No change** to the in-game AAR submit flow (1257–1290, 1740–1765) — it already writes the replay; we're only adding the read side.

---

## 4. Step-by-step build order

1. **Types** — add `LoadedRunReplay` to `runTelemetry.ts`. (No behavior; unblocks everything.)
2. **Reader** — implement `fetchRunReplay` + `normalizeRunDoc` + cache in `leaderboard.ts`. Unit-testable in isolation (§6).
3. **Export render helpers** — `export buildBackground` (and verify whether blockers/markers are baked; export them only if not). Confirm `drawTowerBody` signature unchanged.
4. **Viewer skeleton** — `ReplayViewer.tsx`: fetch + loading/not-found/summary card, canvas mount, draw static `buildBackground(map)` only. Get it rendering the right board for a known `runId`.
5. **Tower reconstruction** — map `snapshots[last].towers` → `ReconstructedTower[]`, draw with `drawTowerBody` at full alpha. Verify positions/tiers match the run.
6. **Scrub + flipbook** — snapshot stepping, fade-in by `placedAtS`, sold removal by `soldAtS`, HUD bar, timeline ticks, play/pause/speed.
7. **Heat overlay** — `damageByTower` → per-tower glow intensity; switch to `final.damageByTower` at the terminal keyframe; outcome stamp.
8. **Routing** — `?run=` fork in `App.tsx`, lazy import, exit handling, AgeGate bypass.
9. **Leaderboard WATCH buttons** — surface `runId` rows in `LeaderboardTab`.
10. **Telemetry wiring** — increment `replayOpens` on viewer open (§7), wire `recordLeaderboardRowClick` where a live recorder exists (in-game leaderboard/AAR), or route both through a standalone counter.
11. **Tests** — reader unit test + a Playwright smoke test that opens `?run=` against a seeded/mocked doc (§6).
12. **Polish** — empty/legacy-doc fallbacks, keyboard (←/→/space) controls, mobile letterboxing.

---

## 5. Schemas / rules / Cloud-Function changes

**None required.** `firestore.rules` already grants `allow get: if true` on `runs/{runId}` (line 47) and `runs/{runId}/chunks/{chunkId}` (line 67). `list` is admin-only, but the reader fetches **by exact id**, so it only needs `get` — fully covered. No Cloud Function touches the read path. No index needed (single-doc gets). `firebase.json` `**`→`index.html` rewrite already serves `?run=` / `/watch`.

The **only** thing to consider: the public doc the rules allow has `events.size() <= 650` and `snapshots.size() <= 120` — the reader's normalizer should clamp to these bounds defensively (the writer already slices `snapshots` to `-80` and head events to 650).

---

## 6. Testability (bot / sim / playwright)

- **Reader unit test (Playwright `test()` non-page block, the existing pattern at `ux-ui.spec.ts:301`)**: factor `normalizeRunDoc` and the chunk-concatenation logic to be pure/exported so a test can feed a synthetic `PublicRunDoc` + chunk docs and assert: events concatenated in order, missing chunk tolerated, bad `runId` → null, legacy/partial doc normalized with defaults. This matches the existing `admin analytics model` describe block which tests pure functions with fixture rows — no Firestore needed.
- **Reconstruction reducer unit test**: extract the "snapshot/time → `ReconstructedTower[]` + HUD" mapping into a pure function (e.g. `reconstructAt(run, t)`) and test it with a hand-built run: tower placed at t=10 hidden at t=5, shown at t=15; sold tower disappears after `soldAtS`; `damageByTower` maps to the right towers; outcome stamp at the terminal snapshot. Pure, fast, deterministic.
- **End-to-end seed via the sim/bot**: `scripts/sim.ts` already drives `new Game(...)` + `Bot` headlessly. Add a tiny script (or extend sim) that runs one bot game to completion and calls `game.buildRunUploadBundle('TESTBOT', 'test')` to emit a **real** `RunUploadBundle` JSON fixture to disk. Feed that fixture into the reader/reducer tests — guarantees the viewer is tested against the *actual* producer shape, not a hand-mock that can drift. (No network; just serialize the bundle.)
- **Playwright page smoke test**: with `?run=<id>`, the cleanest approach is to **stub `fetchRunReplay`** — but it's a module fn. Two options: (a) expose a `window.__REPLAY_FIXTURE__` hook the viewer checks before fetching (dev/test only), letting the test inject a bundle and assert the canvas mounts + HUD shows the right wave/outcome + WATCH navigation works; or (b) point the test at the Firestore emulator with a seeded `runs/{id}`. Option (a) matches the existing `?demo=1` test-affordance pattern (`ux-ui.spec.ts:42`) and avoids emulator setup. Assert: `getByTestId('replay-root')` visible, summary text present, play/step buttons present, exit returns to menu.
- **Determinism note for tests**: the viewer must avoid `Math.random()` in its draw loop (unlike `engine.render`'s camera shake) so screenshots are stable — drive any "motion" off the scrub `time` only. This is a design constraint to bake in from step 4.

---

## 7. The dead `replayOpens` / `recordLeaderboardRowClick` wiring (gotcha)

`RunRecorder.recordReplayOpen()` (runTelemetry.ts:858) and `recordLeaderboardRowClick()` (854) increment `this.leaderboard.replayOpens` / `.rowClicks`, surfaced into `PrivateRunAnalyticsDoc.leaderboard` and summed in `AdminDashboard` at line 1739. **Problem:** these live on a *per-run* recorder that only exists during an active `Game`. The two natural open points are:

- **In-game leaderboard / AAR** (App.tsx ~1728 already calls `game.recorder.recordLeaderboardOpen()`): here a live `game.recorder` exists → wire `recordLeaderboardRowClick()` on a row click and `recordReplayOpen()` if a "watch" is launched from the AAR board. Clean.
- **Menu leaderboard (`LeaderboardTab`) and the `?run=` deep-link**: **no live game/recorder exists.** Incrementing the per-run counter is impossible here.

**Resolution:** Don't overload the per-run recorder for menu/deep-link opens. Instead:
- Keep `recordReplayOpen`/`recordLeaderboardRowClick` for the **in-game AAR** path (where a recorder exists) so the existing analytics field gets real data.
- For **menu + deep-link** opens, add a counter to the app-level metrics (`src/game/metrics.ts` `appMetrics`, which is already snapshotted into analytics on the *next* run) — e.g. a `replayWatches` app metric — OR fire a one-shot `logTelemetry`-style event. Check `metrics.ts` for an existing menu-event channel (the `menu` snapshot already tracks `leaderboardTabOpens`) and add `replayWatch` alongside it. This keeps the dead field alive *and* captures the menu/deep-link case the per-run model can't.

Flag this explicitly to the executing engineer: **the simplest correct move is (a) wire the recorder calls only in the AAR/in-game board, and (b) add an `appMetrics` menu counter for menu+deep-link opens.** Don't try to manufacture a fake recorder in the menu.

---

## 8. Risks + mitigations

| Risk | Mitigation |
|---|---|
| **Reconstruction read as a re-sim** by users/QA → "the replay doesn't match what happened." | Label the UI clearly ("Battle Plan — reconstructed from wave snapshots"). No enemy/projectile motion is claimed. Document the non-determinism (engine `Math.random()`) in a code comment on the viewer. |
| **Legacy / partial / future-schema run docs** crash the viewer. | `normalizeRunDoc` defaults every field, clamps arrays (`events≤650`, `snapshots≤120`), tolerates missing chunks; unknown `towerId` skipped via `TOWER_MAP` lookup; unknown `map`/`diff` id → summary-only fallback, never throw. |
| **Exporting `buildBackground`/private helpers** widens the render module's surface / risks accidental reuse divergence. | Export the minimum (`buildBackground`; only `drawTowerBody` is already public). Add a one-line comment marking them "shared with ReplayViewer." No logic change → zero risk to the live render path. |
| **Chunk fetch latency / fan-out** (up to 100 gets) blocks first paint. | Render immediately from the head doc's `snapshots` + first-650 `events`; fetch chunks in the background and merge. Cache loaded replays (TTL). Most runs have `chunkCount=0`. |
| **AgeGate / consent**: exposing a public surface that bypasses the gate. | The viewer is strictly read-only of *already-public* `runs/*` docs and writes nothing player-attributed → safe to bypass the gate, same as `/privacy`. Confirm no analytics write fires on the deep-link path (route the open-counter through `appMetrics` which only persists on a *subsequent* consented run). |
| **Invalid/forged `?run=` id** → wasted fetch or error. | `isValidRunId` guard before fetch (already exists); not-found state for any id that doesn't resolve. `get`-only rules mean no listing/enumeration exposure. |
| **Canvas scaling / mobile** mismatch with `GameScreen`. | Reuse `GameScreen`'s exact canvas sizing/letterbox CSS (read it before implementing the viewer canvas). Drive all motion off scrub `time`, never `Math.random()`, for stable rendering + screenshots. |
| **Heat-map attribution ambiguity** when several towers share a `towerId`. | Use per-tower `RunTowerSnapshot.damage` (already captured per `towerUid`) for per-tower intensity; use `damageByTower`/`final.damageByTower` only for the legend/totals. |

---

## 9. Effort estimate (sub-tasks)

| # | Sub-task | Est. |
|---|---|---|
| 1 | `LoadedRunReplay` type + `fetchRunReplay` + `normalizeRunDoc` + cache (leaderboard.ts) | 0.5 day |
| 2 | Export `buildBackground` (+ verify blockers/markers baked); confirm `drawTowerBody` reuse | 0.25 day |
| 3 | `ReplayViewer.tsx` skeleton: fetch states, canvas mount, static board draw | 0.5 day |
| 4 | Tower reconstruction (snapshot → towers, fade-in/sold-out, tiers) | 0.5 day |
| 5 | Scrub + flipbook (snapshot stepping, time interpolation, play/pause/speed, timeline) | 1 day |
| 6 | Heat overlay (`damageByTower` glow) + HUD bar + outcome stamp | 0.75 day |
| 7 | Routing (`?run=` fork, lazy import, AgeGate bypass, exit) | 0.25 day |
| 8 | Leaderboard WATCH buttons (`LeaderboardTab`, surface `runId`) | 0.25 day |
| 9 | Telemetry wiring (`replayOpens`/`rowClick` in AAR + `appMetrics` menu counter) | 0.25 day |
| 10 | Tests: reader unit test, reconstruction-reducer unit test, sim-emitted fixture, Playwright `?run=` smoke | 1 day |
| 11 | Polish: legacy-doc fallback, keyboard controls, mobile letterbox, copy/labels | 0.5 day |
| | **Total** | **≈ 5.75 days** |

---

## 10. Key file references (absolute paths)

- Reader + reuse target: `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\leaderboard.ts` (`submitRunReplay` at line 345; `normalizeRunAnalytics` pattern at 397; `fetchTop` at 649; `isValidRunId` at 86; `withTimeout` at 35; `LEADERBOARD_CACHE_TTL_MS`/`topCache` at 26–27).
- Replay types: `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\runTelemetry.ts` (`PublicRunDoc` 104; `RunWaveSnapshot` 48; `RunTowerSnapshot` 30; `RunEventChunkDoc` 152; dead `recordReplayOpen` 858 / `recordLeaderboardRowClick` 854; `replayOpens` field 470).
- Render reuse: `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\render.ts` (`buildBackground` 311 — needs `export`; `drawTowerBody` 950 — already exported; `drawBlockers` 804 / `drawMarkers` 772 — verify if baked).
- Tower lookup: `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\towers.ts` (`TOWER_MAP` 484).
- Map/diff lookup + canvas size: `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\maps.ts` (`ALL_MAPS` 156, `DIFFICULTIES` 158); `engine.ts` (`W` 45, `H` 46; `Game.runId` getter 258; `buildRunUploadBundle` 291).
- Routing + leaderboard UI: `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\App.tsx` (`App()` 100; `isPrivacyRoute` 96; lazy imports 53; `PERF_PARAMS` 62; `LeaderboardTab` 668; AAR submit 1257/1740; `recordLeaderboardOpen` ~1728).
- Rules (no change, confirms read perms): `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\firestore.rules` (runs `get` 47, chunks `get` 67).
- Hosting rewrite (no change): `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\firebase.json` (`**`→`index.html` 27).
- New file to create: `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\ReplayViewer.tsx`.
- Test patterns: `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\tests\e2e\ux-ui.spec.ts` (pure-fn `test.describe` 301; page test w/ `?demo=1` 42); sim fixture source `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\scripts\sim.ts`.

**Verified non-existent (so this is net-new):** no `fetchRunReplay` anywhere; `recordReplayOpen`/`recordLeaderboardRowClick` are never called; `ScoreEntry.runId` is fetched but never surfaced in the UI; `AdminDashboard` reads `runAnalytics` (private), never the public `runs/*` replay docs.


## Top Bet 2 — Shareable Result Cards + ?run= Deep Links

# Implementation Plan — TOP BET 2: Shareable Result Cards + `?run=` Deep Links

## 1. Overview

Two coupled deliverables for Neon Vector Defense, both grounded in the existing run-end overlay and telemetry pipeline:

1. **Mission Dossier card** — at run end (`gameover` / `victory` / `armistice`, and freeplay bank), generate a 1200×630 canvas "dossier" PNG showing callsign, map/protocol, wave/outcome, top-3 carrying towers (from `runStats.dmg`), and a mini lane render. Wire up **Share** (Web Share API w/ file), **Copy to clipboard**, and **Download**.
2. **`?run=<runId>` deep links** — a route that loads a public run doc from `runs/{runId}` and renders either the full replay viewer (if **Bet 1** ships) or, as the always-available fallback, a **result view** (dossier + after-action summary + "Play this sector" CTA). Includes link-unfurl handling: because `index.html` is static and there are no HTTP Cloud Functions, per-run OG is **not** dynamically achievable without new infra — the plan ships a static fallback OG card and documents the dynamic-OG option as a stretch.

Key facts verified in code:
- Run-end overlays live in `GameScreen`'s JSX (`src/App.tsx` ~lines 1426–1488): `<Overlay … report={<><AfterAction/><SubmitScore/></>}>`.
- `game.runId` getter → `recorder.runId` (`engine.ts:258`); replay bundle via `game.buildRunUploadBundle(callsign, build)` (`engine.ts:291`).
- `game.runStats.dmg: Record<towerId, number>` (`engine.ts:866`), `runStats.kills`, `runStats.leaks`. `AfterAction` already sorts `runStats.dmg` top-5 (`App.tsx:1687`).
- `runs/{runId}` is publicly `get`-able (`firestore.rules:47`), but **no `fetchRunReplay` exists** in `leaderboard.ts` — must be added.
- `PublicRunDoc.summary` carries `callsign, map, mapName, diff, diffName, freeplay, outcome, phase, wave, kills, credits, cashEarned, leaks, coresLeft, durationS`; `final.damageByTower: Record<towerId, number>`, `final.towers: RunTowerSnapshot[]` (with `x,y,towerId,tierA,tierB,kills,damage`).
- Routing today: `App()` forks on `ADMIN` then `isPrivacyRoute()` (pathname `/privacy`), else `<Gate/>` (`App.tsx:100–103`). Query params read once into `PERF_PARAMS` (`App.tsx:62`). Hosting rewrites `**` → `/index.html` (`firebase.json:27`); SW is network-first for navigations (`sw.js:31`).
- Tower colors for the card: `TowerDef.color/glow/style` (`types.ts:120`); `drawTowerBody(ctx,pos,def,angle,tierA,tierB,…)` exported (`render.ts:950`); board is `W=1280 × H=720` (`engine.ts:45`).

---

## 2. Data model / types

No Firestore schema changes are required for the **core** feature — `runs/{runId}` already holds everything the result view needs. New TypeScript types only:

In a new `src/game/runReplay.ts` (read-side companion to `runTelemetry.ts`):
```ts
export interface RunReplayResult {
  run: PublicRunDoc;          // reuse existing type from runTelemetry.ts
  chunks: RunEventChunkDoc[]; // empty unless replay viewer (Bet 1) needs full event stream
}
```

In a new `src/game/dossier.ts`:
```ts
export interface DossierInput {
  callsign: string;
  mapId: string; mapName: string;
  diffName: string;
  freeplay: boolean;
  outcome: RunOutcome;        // reuse from runTelemetry.ts
  wave: number; kills: number; cashEarned: number; coresLeft: number; durationS: number;
  topTowers: { id: string; name: string; color: string; glow: string; damage: number; pct: number }[];
  towerPlacements?: { x: number; y: number; def: TowerDef }[]; // for mini-lane render
  runId: string;
}
export function buildDossierInputFromGame(game: Game): DossierInput;     // live run-end
export function buildDossierInputFromRun(run: PublicRunDoc): DossierInput; // ?run= view
export async function renderDossierCanvas(input: DossierInput): Promise<HTMLCanvasElement>;
export async function dossierBlob(input: DossierInput): Promise<Blob>;
```

The two `buildDossierInput*` builders converge on the same `DossierInput` so the card renders identically from a live `Game` and from a fetched `PublicRunDoc`. `topTowers` comes from `runStats.dmg` (live) or `final.damageByTower` (fetched); `name/color/glow` resolved via `TOWERS.find(t => t.id === id)`.

---

## 3. Files to create / edit

### Create

| File | Purpose / key functions |
|---|---|
| `src/game/dossier.ts` | `renderDossierCanvas`, `dossierBlob`, `buildDossierInputFromGame`, `buildDossierInputFromRun`. Pure-ish canvas module; imports `TOWERS` (`towers.ts`), `ALL_MAPS` (`maps.ts`), `drawTowerBody`/lane helpers (`render.ts`), `W,H` (`engine.ts`). |
| `src/game/runReplay.ts` | `fetchRunReplay(runId): Promise<RunReplayResult \| null>` + `fetchRunChunks`. Mirrors `leaderboard.ts` patterns: `isValidRunId`, `withTimeout`, `getDoc(doc(db,'runs',runId))`, `getDocs(collection(db,'runs',runId,'chunks'))`. (Could also live in `leaderboard.ts`; a new file keeps the read-path isolated.) |
| `src/ResultView.tsx` | The `?run=` landing component: fetches the run, renders dossier + after-action + share buttons + "PLAY THIS SECTOR" CTA. Lazy-loaded like `AdminDashboard`/`PrivacyView`. |
| `src/DossierShare.tsx` | Shared share/copy/download button row used by both the run-end overlay and `ResultView`. Encapsulates Web Share API + clipboard + download + graceful fallbacks. |
| `public/og-card.png` | Static 1200×630 fallback OG image for `?run=` links (generated via the genart pipeline; see §5). |

### Edit

| File | Change |
|---|---|
| `src/game/leaderboard.ts` | Add `fetchRunReplay` (or re-export from `runReplay.ts`). Reuse existing `isValidRunId` (`leaderboard.ts:86`) — export it so `runReplay.ts` can share it. |
| `src/App.tsx` | (a) Add a `?run=` route fork in `App()` (next to `ADMIN`/`isPrivacyRoute`). (b) Add `<DossierShare>` into the three run-end `report` fragments and the freeplay bank panel. (c) Add a tiny `getRunIdParam()` helper alongside `isPrivacyRoute()`. |
| `index.html` | Document/keep static OG; optionally point `og:image` to a stable `/og-card.png` for `/?run=…` (no per-run dynamic value possible — see §5). |
| `public/sw.js` | No change required (network-first navigation already serves `?run=` deep links correctly), but bump `CACHE_VERSION` to `nvd-shell-v2` on ship so the new app shell is fetched. |
| `firebase.json` | No rewrite change required for the SPA route (`**`→`index.html` already covers `/?run=` and `/watch`). Only changes if dynamic OG (stretch) is pursued. |
| `tests/e2e/ux-ui.spec.ts` (or new spec) | Add deep-link + share-affordance coverage (see §7). |

---

## 4. Routing design (concrete)

Use **query param** `?run=<runId>` as primary (works with the existing `**`→`index.html` rewrite and the static `PERF_PARAMS` reader). Optionally also accept pathname `/watch?run=…` for prettier links — both resolve to the same component.

In `App.tsx`, alongside `isPrivacyRoute` (line 96):
```ts
function getRunIdParam(): string | null {
  const id = PERF_PARAMS.get('run');
  return id && /^r_[A-Za-z0-9_-]{8,80}$/.test(id) ? id : null;  // mirror isValidRunId
}
```
In `App()` (lines 100–103), add the fork **before** `<Gate/>` but **after** `ADMIN` (admin owner console wins). It must be **age-gate-aware**: the result view shows only public, non-attributed run data, so it can render pre-gate like `/privacy` does — but the "PLAY THIS SECTOR" CTA must route into `<Gate/>` (which re-checks `needsAgeGate()`), not bypass it.
```ts
const RUN_ID = getRunIdParam();
export default function App() {
  if (ADMIN) return <Suspense …><AdminDashboard/></Suspense>;
  if (isPrivacyRoute()) return <Suspense …><PrivacyView/></Suspense>;
  if (RUN_ID) return <Suspense …><ResultView runId={RUN_ID} onPlay={…clear ?run + mount Gate…}/></Suspense>;
  return <Gate/>;
}
```
"PLAY THIS SECTOR" should `history.replaceState` to strip `?run=` and set state to launch that map/diff — simplest first cut: `location.href = '/'` (lands on menu with the sector preselectable via a follow-up param), keeping the router stateless. Note `PERF_PARAMS`/`RUN_ID` are module-level constants read once at load, consistent with how `PERF_MAP` works today — navigation away requires a real location change, which is acceptable and matches the existing pattern.

`ResultView` lifecycle:
1. `useState` loading; `useEffect` → `fetchRunReplay(runId)`.
2. On success: `buildDossierInputFromRun(run)` → render `<canvas>` dossier + an `<AfterAction>`-style summary built from `final.damageByTower`/`final.killsByEnemy` + `<DossierShare>` + CTA.
3. On null/timeout: friendly "this dossier has expired or never existed" + CTA to play.
4. If **Bet 1** lands, swap the static dossier for the interactive replay viewer mounted from `run.events`+`chunks`; the dossier becomes the share artifact and OG card. The component is structured so Bet 1 is an internal swap, not a routing change.

---

## 5. OG / link-unfurl handling (the hard constraint)

**Verified constraints:** `index.html` is fully static (OG tags hardcoded, lines 21–33); hosting serves it for every route via the catch-all rewrite; **there are no `onRequest` HTTP Cloud Functions** (only `onCall` callables — `functions/src/index.ts:220/232/310`). Crawlers (Slack/Discord/Twitter/Facebook) **do not execute JS**, so any React-set `<meta>` is invisible to unfurlers.

**Plan (ship now):**
- Per-run dynamic OG is **out of scope** for the core feature. The shared link unfurls with the **existing static card** (`menu-bg.png`) plus generic title/description — acceptable and honest. Generate one purpose-built **`/og-card.png`** (1200×630, "Neon Vector Defense — View this mission dossier" styling) so shared `?run=` links get a card that reads as a shareable result rather than the menu screenshot. Point `og:image`/`twitter:image` to it (or leave menu-bg; decide in review).
- The **real** shareable artifact is the **downloaded/clipboard PNG** from `DossierShare` — users paste the actual dossier image into Discord/social, which unfurls the image directly regardless of OG. This is the primary share path and needs no server.

**Stretch (document, don't build):** true per-run OG requires either (a) a Firebase Hosting **rewrite to a Cloud Function** that detects bot user-agents and returns an HTML stub with per-run `<meta>` (image pointing at a server-rendered dossier PNG), or (b) prerender/SSR. This needs a new HTTP function + a server-side canvas renderer (`@napi-rs/canvas` in `functions/`) and a `firebase.json` rewrite `{"source":"/watch","function":"runOg"}`. Note it as a Phase 2 ticket with effort, not in scope here.

---

## 6. Dossier rendering details (`dossier.ts`)

- **Canvas:** offscreen `1200×630`. Background gradient using map `theme.bg1/bg2` (`GameMap.theme`, `types.ts:276`) for on-brand color; neon frame in `#4bcffa`.
- **Header band:** outcome word (GRID OFFLINE / SECTOR SECURED / THE LONG SIGNAL) colored to match the overlay palette already in `App.tsx` (`#ff4757` / `#2ed573` / `#ffd32a`); callsign; `mapName · diffName` (+ `· FREEPLAY` / `· DAILY` when applicable).
- **Stat strip:** `WAVE n`, `☠ kills`, `⌬ cashEarned`, `⬢ coresLeft`, `⏱ durationS` — same glyphs used in the topbar (`App.tsx:1316–1332`) for visual continuity.
- **Top-3 carrying towers:** from `topTowers` (sorted `runStats.dmg`/`final.damageByTower`), each as a row with a `drawTowerBody`-rendered icon (reuse `render.ts:950`, draw at small scale onto the card), tower name in its `glow`, and a damage bar in its color — mirrors the `AfterAction` "DAMAGE BY INSTRUMENT" bars (`App.tsx:1696–1703`).
- **Mini lane render (bottom-right ~520×290):** draw the map path from `ALL_MAPS.find(m=>m.id===mapId).path` scaled from `1280×720` into the panel, plus blockers, plus tower dots at `final.towers[].x/y` colored by def. **Important:** the full `render.ts` path drawing (`drawPath`/`strokePath` at lines 284–413) depends on a live `Game` and offscreen sprite caches; for the card, write a **lightweight standalone path+towers draw** in `dossier.ts` (scale path points, `ctx.lineTo`, stroke with `theme.path`/`pathEdge`, then small filled circles for towers). Do **not** try to reuse the full scene renderer — it expects `Game`, enemies, particles, and the canvas dimensions `W×H`.
- **Output:** `canvas.toBlob('image/png')` → `Blob`; also expose `toDataURL` for the in-overlay `<img>` preview.
- **Fonts/async:** if a custom font is used, `await document.fonts.ready` before drawing; tower sprites in `render.ts` build lazily on first `drawTowerBody`, so a warm-up call may be needed.

`DossierShare` behavior (feature-detected, with fallbacks):
1. `navigator.canShare?.({ files:[file] })` → `navigator.share({ files, title, text, url })` (url = `https://…/?run=<runId>`). Mobile/portal-friendly.
2. Else `navigator.clipboard.write([new ClipboardItem({'image/png':blob})])` for **Copy card**, and `navigator.clipboard.writeText(url)` for **Copy link**.
3. Always offer **Download** (anchor `download="dossier-<map>-<wave>.png"`).
4. All wrapped in try/catch; on failure show "copied"/"saved" toasts or fall back to download. Must not throw inside the overlay.

Record interest via `game.recorder.recordCustom('dossier_share', …)` (the recorder already has a generic `recordCustom`, `runTelemetry.ts:759`) — only emits to private analytics unless added to `PUBLIC_CUSTOM_EVENTS`; keep it private to avoid touching `runs` schema/rules.

---

## 7. Build order

1. **`dossier.ts` — `renderDossierCanvas` + `buildDossierInputFromGame`.** Pure rendering; test in isolation by mounting a finished `Game` in a scratch route. No network.
2. **`DossierShare.tsx`** with the three actions + fallbacks.
3. **Wire into run-end overlays** (`App.tsx` 1427/1475/1481 `report` fragments) and freeplay bank panel (`FreeplayBuildPanel`, after `onBank`). Card builds from the live `game` — no fetch, no schema dependency. **This is shippable on its own** (Bet-1-independent, Bet-2 deep-link-independent).
4. **`fetchRunReplay`** in `runReplay.ts`/`leaderboard.ts`; unit-exercise against a real submitted run.
5. **`buildDossierInputFromRun`** (from `PublicRunDoc`).
6. **`ResultView.tsx`** + the `?run=` route fork in `App.tsx` + `getRunIdParam`. Lazy-load.
7. **OG:** add `/og-card.png`, optionally repoint meta; bump SW `CACHE_VERSION`.
8. **Tests** (§ below) + manual unfurl check in a Slack/Discord scratch channel.

Steps 1–3 deliver the visible win independently; 4–6 add the deep link; 7 polishes sharing.

---

## 8. Reuse of existing assets

- **Telemetry:** `game.runStats.dmg/kills/leaks`, `game.runId`, `game.buildRunUploadBundle`, `PublicRunDoc.summary`/`final.damageByTower`/`final.towers` — all already exist; the card and result view read them directly. No new writes; `submitRunReplay` already persists `runs/{runId}` on score submit (`App.tsx:1752`), so any submitted run already has a shareable dossier.
- **Rendering:** `drawTowerBody` (`render.ts:950`), `TowerDef.color/glow/style`, map `theme`/`path`/`blockers`, `W,H`.
- **Routing/consent:** copy the `/privacy` lazy-route + age-gate pattern (`App.tsx:96–113`); reuse `needsAgeGate`/consent so the public view stays compliant and the CTA re-enters `<Gate/>`.
- **Leaderboard plumbing:** `isValidRunId`, `withTimeout`, `db` doc helpers, `boardId` (for the CTA to preselect map/diff).
- **UI:** `AfterAction` markup/CSS classes (`.aar*`, `App.tsx:1685`) reused in `ResultView`; `Overlay` styling for the share row.
- **Static OG infra** already present in `index.html`.

---

## 9. Testability

- **Unit / sim:** `dossier.ts` builders (`buildDossierInputFromGame`, `buildDossierInputFromRun`) are pure transforms over `runStats`/`PublicRunDoc` — testable via `scripts/sim.ts` (drive a `Game` to game-over with the bot, then assert top-3 towers/outcome/wave in `DossierInput`). Round-trip test: `buildDossierInputFromGame(game)` vs `buildDossierInputFromRun(game.buildRunUploadBundle(...).run)` should match.
- **Bot:** existing `Bot` tiers (`src/game/bot.ts`) already produce realistic finished runs in sim; reuse to generate fixtures (a real `PublicRunDoc`) for `buildDossierInputFromRun` and for a Firestore-emulator `fetchRunReplay` test.
- **Playwright** (`tests/e2e/ux-ui.spec.ts`, `?demo=1` seeding pattern, lines 32–49):
  - Drive a demo run to game-over (freeplay so `gameover` is eligible) and assert the dossier `<canvas>` and the three share buttons render in the overlay.
  - Stub `navigator.share`/`navigator.clipboard` via `page.addInitScript` and assert they're invoked with a `File`/`image/png` blob and a `?run=` URL.
  - Deep-link: `page.route('**/firestore.googleapis.com/**', …)` or seed a known run, navigate to `/?run=<id>`, assert `ResultView` shows callsign/wave/top towers and the "PLAY THIS SECTOR" CTA; assert age gate is **not** required to view, but clicking CTA reaches the menu/gate.
  - Bad/expired id `/?run=bad` → graceful empty state, no crash. Covers both `chromium-desktop` and `chromium-mobile` projects (mobile validates Web Share path).
- **Manual:** post a real `?run=` link in Slack/Discord to confirm the static OG card unfurls; verify pasted PNG renders.

---

## 10. Risks + mitigations

| Risk | Mitigation |
|---|---|
| **Per-run OG impossible without server** (static `index.html`, no HTTP functions). | Ship static `/og-card.png` + rely on the **downloaded PNG** as the real share artifact. Document dynamic-OG (bot-UA Cloud Function) as Phase 2. Set expectations in review. |
| `runs/{runId}` only exists **after** the player submits a score (`submitRunReplay` on submit). Sharing before submitting → `?run=` 404s. | Run-end card shares the **PNG directly** (works pre-submit). The `?run=` link is only surfaced/copyable after a successful submit (gate the "Copy link"/share-url on `recorder` replay-submitted state). Or auto-submit replay when the player taps Share (consent permitting). |
| Replay docs may be pruned/expire → dead links. | `ResultView` handles `null` with a friendly empty state + CTA; never crashes. |
| Canvas `toBlob`/`ClipboardItem`/Web Share **not supported** in portal iframes / older browsers. | Feature-detect each; always provide Download fallback; wrap in try/catch so the overlay never breaks. Matches the defensive `withTimeout` ethos in `leaderboard.ts:31`. |
| **CSP in portal iframes** may block `navigator.share`/clipboard or canvas export (tainted canvas). | All drawing is same-origin (local sprites/art), so canvas is not tainted. Degrade to Download; log via `recordCustom`. |
| Reusing full `render.ts` scene renderer for the mini-lane pulls in `Game`/enemies/sprite-cache coupling. | Write a **standalone lightweight** path+towers draw in `dossier.ts`; only borrow `drawTowerBody` for icons. |
| Age-gate / consent: showing run data on a public route. | Run docs are already public & sanitized (callsign-capped, no PII — `runTelemetry.sanitizeCallsign`). View renders pre-gate like `/privacy`; CTA re-enters `<Gate/>`. No new data exposure. |
| SW caching stale shell hides the new route. | Bump `CACHE_VERSION` to `v2`; navigations are network-first already. |
| Module-level `RUN_ID` read once (like `PERF_MAP`) — SPA can't switch run→game without reload. | Acceptable first cut (CTA does a real navigation). Note as known limitation; a stateful router is out of scope. |
| `firestore.rules` change temptation. | **None needed** — `runs/*` already `get`-public. Avoid touching rules to keep the leaderboard-integrity lockdown intact. |

---

## 11. Effort estimate (sub-tasks)

| # | Sub-task | Est. |
|---|---|---|
| 1 | `dossier.ts`: `renderDossierCanvas` (layout, header, stat strip, top-3 towers, mini-lane), `dossierBlob`, `buildDossierInputFromGame` | **1.5–2 d** |
| 2 | `DossierShare.tsx`: Web Share + clipboard (image & link) + download + fallbacks + toasts | **0.5–1 d** |
| 3 | Wire share/card into 3 run-end overlays + freeplay bank panel (`App.tsx`) + CSS | **0.5 d** |
| 4 | `runReplay.ts` `fetchRunReplay` + export/reuse `isValidRunId` | **0.5 d** |
| 5 | `buildDossierInputFromRun` (PublicRunDoc → DossierInput parity w/ live) | **0.5 d** |
| 6 | `ResultView.tsx` + `?run=` route fork + `getRunIdParam` + CTA + empty/expired states + lazy load | **1–1.5 d** |
| 7 | OG: generate `/og-card.png`, meta wiring, SW version bump | **0.5 d** |
| 8 | Tests: sim/bot fixtures + Playwright (desktop+mobile, share stubs, deep link) | **1–1.5 d** |
| 9 | Manual unfurl QA + polish | **0.5 d** |

**Total: ~6.5–8.5 dev-days** for the full Bet-2 scope (card + deep link + sharing). Steps 1–3 (~2.5–3.5 d) are independently shippable and deliver the core "shareable result card" win without depending on Bet 1 or the deep-link work. Dynamic per-run OG (Phase 2, not included): **+2–3 d** (HTTP function + server canvas + rewrite).

**Key file paths:** `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\App.tsx` (routing fork + overlay wiring), `…\src\game\runTelemetry.ts` (reuse `PublicRunDoc`/`RunOutcome`/`final.damageByTower`), `…\src\game\leaderboard.ts` (add `fetchRunReplay`, reuse `isValidRunId`), `…\src\game\engine.ts` (`runStats`, `runId`, `buildRunUploadBundle`, `W/H`), `…\src\game\render.ts` (`drawTowerBody`), `…\src\game\types.ts` (`TowerDef.color/glow/style`, `GameMap.theme/path`), `…\firestore.rules` (no change — `runs/*` already public-get), `…\index.html` + `…\public\sw.js` + `…\firebase.json` (OG/SW; rewrite already covers SPA). New: `…\src\game\dossier.ts`, `…\src\game\runReplay.ts`, `…\src\ResultView.tsx`, `…\src\DossierShare.tsx`, `…\public\og-card.png`.


## Top Bet 3 — Meta Loop (Warden Rank + Salvage + Operations Board + Watch Streak)

# IMPLEMENTATION PLAN — TOP BET 3: META LOOP (Warden Rank · Salvage · Operations Board · Watch Streak)

## 1. Overview

A fully **client-side, deterministic, additive** meta layer:

- **Warden Rank** — a lifetime XP curve derived from existing counters (`progress.totalWaves`, `record.kills`, `record.victories`) plus per-run XP credited at run end.
- **Salvage** — a soft currency earned per run from run stats, spent later on cosmetics (out of scope to spend; we build the wallet + ledger only).
- **Operations Board** — deterministic daily + weekly quests generated from a date-hash (the exact pattern `freeplay.ts` already uses for `dailyFreeplaySeed`), with progress tracked entirely in `localStorage`, surfaced as a third menu tab.
- **Watch Streak** — a consecutive-day streak computed from the *existing* `sessionDays` map, with a comeback prompt.

**Non-negotiable constraint (the bot-tuned ladder):** XP/Salvage/quest rewards are **cosmetic + QoL only**. They must NOT feed `engine.ts` combat math, starting cash/lives, tower unlock thresholds (`def.unlockAt` vs `progress.record.kills`), or score. The meta layer reads run stats *after* `finishRun`; it never mutates the `Game`. There is no "meta-modified run" that changes balance — so the segregation requirement is satisfied by *construction* (we add no run modifiers). I still add a defensive `metaModified` flag plumbed into the run record / telemetry so that if a future cosmetic ever touches a run, sampled balance data can exclude it. This is the safest reading of the CRITICAL clause: keep it impossible by design, and ship the flag so the guarantee is auditable.

**Backend:** none. The Operations Board, rank, salvage, and streak are 100% localStorage. No `firestore.rules` change, no new Cloud Function. (The existing `submitScore`/`submitDailyScore`/replay paths are untouched.)

---

## 2. Data Model / Types

### 2.1 New module: `src/game/meta.ts`

This is the single source of truth for the meta layer, mirroring the structure of `storage.ts` (module-level cache + throw-safe `localStorage`, DEMO_MODE no-op writes) and `freeplay.ts` (pure deterministic generators using the same FNV-1a `hash` + `pickMany`).

```ts
// Persisted blob, separate key so it never collides with nvd-progress-v1 migrations.
const META_KEY = 'nvd-meta-v1';

export interface MetaState {
  xp: number;                 // lifetime XP (rank derived)
  salvage: number;            // current spendable balance
  salvageLifetime: number;    // total ever earned (for "Master Salvager"-style milestones)
  // quest progress keyed by quest id; values are raw progress counts
  questProgress: Record<string, number>;
  questClaimed: string[];     // ids already claimed (reward granted)
  // streak bookkeeping derived from sessionDays but cached for the comeback prompt
  lastStreakDay: string;      // 'YYYY-MM-DD' of last counted day
  bestStreak: number;
  comebackSeenFor: string;    // dayKey we last showed the comeback prompt (dedupe)
  // cosmetics the player owns (future spend target — wallet only for now)
  cosmetics: string[];
  cosmeticEquipped: Record<string, string>; // slot -> cosmeticId
}
```

### 2.2 Rank curve (pure)

```ts
export interface RankInfo {
  rank: number;          // 1..N
  title: string;         // e.g. "Sentinel III"
  xpIntoRank: number;
  xpForRank: number;     // span of current rank
  totalXp: number;
  pct: number;           // 0..1 progress to next
}
export function rankFromXp(xp: number): RankInfo;       // quadratic-ish curve
export function xpForRank(rank: number): number;        // cumulative threshold
```

Curve: `xpForRank(n) = round(120 * n^1.55)` cumulative (tune so an average campaign clear ≈ 1 rank early, slowing later). Titles from a fixed `RANK_TITLES` array indexed by tier band (Recruit → Sentinel → Warden → Vanguard → Architect …), reusing the game's existing lore tone.

### 2.3 Run reward derivation (pure, deterministic, no RNG)

```ts
export interface RunMetaReward {
  xp: number;
  salvage: number;
  breakdown: { label: string; xp: number; salvage: number }[];
}
export function deriveRunReward(input: RunRewardInput): RunMetaReward;

export interface RunRewardInput {
  wave: number;
  kills: number;
  cashEarned: number;
  won: boolean;
  freeplay: boolean;
  diffId: string;        // difficulty multiplier (cosmetic only)
  isDailyFreeplay: boolean;
  outcome: 'victory' | 'armistice' | 'gameover' | 'abandoned';
}
```

Formula (XP): `base = wave*10 + kills*1 + (won?250:0) + (outcome==='armistice'?400:0)`, scaled by a difficulty cosmetic multiplier (`easy 0.8 / normal 1 / hard 1.4 / extinction 1.8 / ngplus 1.6`). Salvage: `round(cashEarned/200) + wave*2 + (won?60:0)`. **Abandoned runs grant 0** (anti-farm). These read *only* from values already computed by the engine — no engine change.

### 2.4 Quest types (pure generator, date-hash)

```ts
export type QuestPeriod = 'daily' | 'weekly';
export type QuestMetric =
  | 'wavesCleared' | 'kills' | 'runsCompleted' | 'campaignWins'
  | 'freeplayWave' | 'towerKindsUsed' | 'abilitiesCast' | 'reachWave';

export interface QuestDef {
  id: string;            // `q-d-<dateKey>-<slot>` / `q-w-<weekKey>-<slot>`
  period: QuestPeriod;
  metric: QuestMetric;
  target: number;
  title: string;
  desc: string;
  rewardXp: number;
  rewardSalvage: number;
  scope?: { diffId?: string; mapId?: string; freeplay?: boolean }; // optional constraint
}

export function dailyQuests(now?: Date): QuestDef[];   // 3 quests
export function weeklyQuests(now?: Date): QuestDef[];   // 2 quests
export function operationsBoard(now?: Date): QuestDef[]; // daily ++ weekly
```

Generation reuses **exactly** the `freeplay.ts` primitives: `dateKey = now.toISOString().slice(0,10)`, `hash(dateKey)`, `pickMany(pool, seed+salt, n)`. Weekly uses an ISO-week key (`weekKey(now)` helper — Monday-anchored). Targets pulled from per-metric tables scaled by a small hash jitter so they vary day to day but are identical for all players on a given date (matches the daily-seed contract).

### 2.5 Streak (pure, reads existing `sessionDays`)

```ts
export interface StreakInfo {
  current: number;       // consecutive days incl today (if active today)
  best: number;
  activeToday: boolean;
  brokenYesterday: boolean; // had a streak, missed yesterday -> comeback eligible
  lastDay: string;
}
export function computeStreak(sessionDays: Record<string, number>, now?: Date): StreakInfo;
```

Walk back from today over `sessionDays` keys (`'YYYY-MM-DD'`, already produced by `progress.markSession()` at `storage.ts:122-132`). No new persisted streak counter is strictly required for `current` (it's derivable) — `bestStreak`/`comebackSeenFor` are cached in `MetaState` for the prompt + milestones.

### 2.6 The `meta` singleton (mirrors `progress`)

```ts
export const meta = {
  get rank(): RankInfo,
  get salvage(): number,
  get salvageLifetime(): number,
  get streak(): StreakInfo,            // pulls progress.sessionDays internally
  board(now?): QuestWithProgress[],    // operationsBoard() merged with questProgress/claimed
  /** credit a finished run; returns the reward for the run-end toast. Idempotent per runId. */
  creditRun(runId: string, input: RunRewardInput): RunMetaReward,
  /** advance quest counters from a finished run; safe to call once per run */
  advanceQuests(runId: string, input: RunRewardInput, extra: QuestRunExtras): void,
  claimQuest(id: string): RunMetaReward | null,  // grants xp+salvage if complete & unclaimed
  markComebackSeen(dayKey: string): void,
  // cosmetics wallet (future spend)
  owns(id: string): boolean,
  buyCosmetic(id: string, cost: number): boolean,
  equip(slot: string, id: string): void,
  reset(): void,
};
```

`QuestRunExtras` carries the few run facts not in `RunRewardInput` that quests need (e.g. `towerKindsUsed: string[]` from `[...new Set([...towers.map(t=>t.def.id), ...Object.keys(runStats.dmg)])]` — already computed at `engine.ts:207`, and `abilitiesCast` from `runStats.abilitiesCast`). **Idempotency** keyed on `runId`: `creditRun`/`advanceQuests` store a `creditedRuns: string[]` (capped) inside `MetaState` so a `win→freeplay→death` double `finishRun` (the exact case guarded at `engine.ts:191-209` with `finishedPersisted`) cannot double-credit.

---

## 3. Exact Files to Create or Edit

### CREATE

| File | Contents |
|---|---|
| `src/game/meta.ts` | `MetaState`, `meta` singleton, all pure generators (rank, reward, quests, streak), cosmetics wallet. Patterned on `storage.ts` (cache+save+DEMO_MODE) and `freeplay.ts` (hash/pickMany). |
| `src/OperationsBoard.tsx` | React component: the third menu tab — rank bar, salvage wallet, streak chip, daily/weekly quest cards with claim buttons. Pure presentational + `meta` reads. |
| `src/game/meta.test-notes` *(no — see testability; we add a sim script instead)* | — |
| `scripts/meta-sim.ts` | Headless determinism + curve sanity check (see §6). |

### EDIT

| File | Function(s) / anchor | Change |
|---|---|---|
| `src/game/meta.ts` | — | (new) |
| `src/App.tsx` | `MainMenu` (`502` `useState<'deploy'\|'board'>`) | Widen tab union to `'deploy' \| 'board' \| 'ops'`; add nav `<button>` "OPERATIONS" at `~522`; render `<OperationsBoard/>` in the `menu-content` fork at `~644`. Add a compact **rank + streak strip** near `hero-stats` (`535-542`). |
| `src/App.tsx` | `Main` (`116-163`) | After `useEffect(() => { progress.markSession(); }, [])` (`124`), add a sibling effect that reads `meta.streak`; if `brokenYesterday && comeback not seen today`, set state to show a one-time **ComebackPrompt** overlay (menu only). |
| `src/App.tsx` | run-end credit — **GameScreen**, the terminal block at `996-1016` (the `loggedRunRef` once-guard) | After `logTelemetry(...)`, call `meta.creditRun(game.runId, rewardInput)` and `meta.advanceQuests(...)`, capture the returned `RunMetaReward` into a ref/state for the after-action toast. This is the single, already-once-guarded place a terminal run is observed in the UI. **DEMO/PERF gated** (the block is already `PERF_MAP === null && !DEMO_MODE`). |
| `src/App.tsx` | `Overlay`/`AfterAction` render at `1426/1474/1480` | Pass the captured `RunMetaReward` into the report so the victory/armistice/gameover overlay shows "+XP / +Salvage" and any rank-up. Add a small `<MetaReward reward={...}/>` next to `<AfterAction/>`. |
| `src/App.tsx` | `OperationsBoard` import | Lazy or direct import; menu-only so direct is fine. |
| `src/game/storage.ts` | `RunRecord` (`35-47`) + `addRun` (`85-100`) | OPTIONAL: add `metaModified?: boolean` to `RunRecord` (default false) for the segregation flag. Migration-safe (optional field, spread defaults at `60/62` already tolerate it). |
| `src/game/runTelemetry.ts` | `PublicRunDoc['summary']` is rules-validated — **DO NOT** add fields there. Instead `PrivateRunAnalyticsDoc.progression` (`316-329`) | OPTIONAL: add `metaModified: boolean` to the private `progression` block (analytics only, not the public/rules-locked replay), so the balance dataset can filter. Plumb through `makePrivateAnalytics` + `normalizeRunAnalytics` defaults in `leaderboard.ts` (`558-571`). |
| `src/adminAnalytics.ts` *(if balance report consumes analytics)* | metric defs | OPTIONAL: expose `metaModified` as a filter dimension. Verify against the file before touching. |

**Note on the segregation flag:** since the meta loop adds *zero* run modifiers, `metaModified` is always `false` today. It is plumbed as a future-proof guard, explicitly defaulted, so the bot-tuned dataset stays clean if cosmetics ever gain a gameplay-adjacent toggle. If the executing engineer prefers minimal surface area, the flag rows are tagged OPTIONAL and can be deferred — the core loop works without them.

---

## 4. Step-by-Step Build Order

1. **`src/game/meta.ts` — pure core first (no UI, no storage writes yet).**
   - Port `hash`, `pickMany`, `pickOne` from `freeplay.ts` (copy, do not import privates — keep meta self-contained, matching how `freeplay.ts` keeps its own `hash`).
   - Implement `xpForRank`, `rankFromXp`, `RANK_TITLES`.
   - Implement `deriveRunReward`.
   - Implement `dailyQuests`/`weeklyQuests`/`operationsBoard` with `weekKey` helper.
   - Implement `computeStreak` over `sessionDays`.
   - These are all unit-testable headless (see §6) before any React or storage.

2. **`MetaState` + `meta` singleton + persistence.**
   - `load()/save()` copy of `storage.ts:57-72` shape (try/catch, DEMO_MODE no-op, spread-defaults migration).
   - `creditRun`/`advanceQuests` with `creditedRuns` idempotency (cap length like `history` at `storage.ts:87`).
   - `claimQuest`, cosmetics wallet methods.

3. **`scripts/meta-sim.ts`** (determinism + curve gut-check) — run it; fix curve constants.

4. **`OperationsBoard.tsx`** — rank bar, salvage, streak, quest cards w/ claim. Reuse existing class names (`menu-col`, `menu-section-label`, card styling) so it inherits theme; add a small `meta.css` or extend the existing stylesheet.

5. **Wire into `MainMenu`** — third tab + rank/streak strip in hero area.

6. **Wire run-end credit** in `GameScreen` terminal block (`App.tsx:996-1016`), capture reward, render `<MetaReward/>` in the three overlays.

7. **Quest progress from run-end** — call `meta.advanceQuests` alongside `creditRun`; verify quest cards reflect it after a run (manual + e2e in demo mode reads localStorage).

8. **Comeback prompt** in `Main` (menu-only, once/day via `comebackSeenFor`).

9. **(Optional) segregation flag** plumbing through `RunRecord` + private analytics.

10. **e2e + sim verification** (§6).

---

## 5. Schemas / Rules / Cloud-Function Changes

**None required.**

- `firestore.rules`: unchanged. The meta layer never writes to Firestore. The public replay (`runs/*`) is rules-validated with `hasOnly(...)` on an exact key set (`firestore.rules`, the `runs/{runId}` block) — so we explicitly must NOT add meta fields to `PublicRunDoc`; doing so would break replay writes. Plan keeps meta out of the public doc entirely.
- Cloud Functions (`functions/src/index.ts`): unchanged. `submitScore`/`submitDailyScore` still replay-verify the *unchanged* score values. Salvage/XP never touch score, so server validation is unaffected.
- Telemetry: the optional `metaModified` field rides only on the **private** `runAnalytics` doc (consent-gated, sampled), which is a free-form map server-side (`setDoc(..., {merge:true})` at `leaderboard.ts:365`) — no rules change.

---

## 6. How It Reuses Existing Assets

- **Date-hash determinism:** `meta.ts` reuses the exact `dailyFreeplaySeed` pattern from `freeplay.ts:155-187` (`toISOString().slice(0,10)` + FNV-1a `hash` + `pickMany`), guaranteeing all players see the same daily/weekly board with no backend — same property the daily freeplay seed already relies on.
- **Streak source:** `progress.engagement` / `cache.sessionDays` already exist and are maintained by `markSession()` (`storage.ts:122-146`). `computeStreak` consumes them read-only.
- **Run reward inputs:** every value (`game.wave`, `game.totalKills`, `runStats.cashEarned`, `runStats.abilitiesCast`, the tower-kinds set) is already computed and already read at the run-end telemetry block (`App.tsx:1000-1014` and `engine.ts:207`). No new engine accounting.
- **Persistence idiom:** `meta.ts` copies `storage.ts`'s cache+`save()`+`DEMO_MODE` guard verbatim, so demo/recruiter runs persist nothing (matching the existing "Progression … disabled" demo contract at `App.tsx:531`).
- **UI:** `OperationsBoard.tsx` slots into the existing `MainMenu` tab system (`'deploy'|'board'` → add `'ops'`) and reuses menu CSS classes. The run-end overlays (`Overlay`/`AfterAction`, `App.tsx:1685-1718`) already have a `report` slot for the `<MetaReward/>` addition.
- **Lore tone:** rank titles + quest copy reuse the established Warden/Lantern Seven/Combine vocabulary (consistent with the canon noted in memory).

---

## 7. Testability (bot / sim / playwright)

- **`scripts/meta-sim.ts`** (new; pattern from `scripts/sim.ts`):
  - **Determinism:** assert `JSON.stringify(operationsBoard(fixedDate))` is identical across calls and across two process runs for the same date; assert it *changes* for date+1.
  - **Curve sanity:** print `rankFromXp` thresholds for ranks 1..30; assert monotonic increasing, `pct ∈ [0,1)`.
  - **Reward bounds:** feed representative `RunRewardInput`s (wave 30 win, wave 80 freeplay, wave 3 loss, abandoned) and assert XP/salvage are non-negative, abandoned = 0, and ordering (win > loss at same wave).
  - **Streak:** synthetic `sessionDays` maps (today-only, 5-in-a-row, gap-yesterday) → assert `current`, `brokenYesterday`.
  - **Idempotency:** call `creditRun(runId,...)` twice → XP increments once.
  - **Ladder isolation guard:** assert no symbol from `meta.ts` is imported by `engine.ts`, `towers.ts`, `bot.ts`, or the score/replay path (a simple grep test in the sim, or a Vitest-style assertion). This *enforces* the CRITICAL constraint mechanically.
- **Existing `npm run sim`** must produce **identical** avg-wave/win numbers before vs after the change (the meta layer must not perturb the engine). Run it as a regression gate.
- **Playwright (`tests/e2e/ux-ui.spec.ts` patterns):** the harness seeds `nvd-progress-v1` via `addInitScript` (`spec:32-39`) and uses `?demo=1` + `getByTestId`. Add:
  - Seed `nvd-meta-v1` similarly; open menu; assert the OPERATIONS tab renders, rank bar + quest cards visible (add `data-testid="ops-tab"`, `data-testid="ops-board"`, `data-testid="quest-card-<id>"`, `data-testid="rank-bar"`).
  - Seed a completed-quest meta blob; click claim; assert salvage increments (read back `localStorage`).
  - Seed `sessionDays` with a yesterday-gap to assert the comeback prompt shows once.
  - **Important:** demo mode persists nothing, so claim/persist assertions must use a non-demo (gate-seeded adult) page like the existing `seedProgress` flow, not `?demo=1`.

---

## 8. Risks + Mitigations

| Risk | Mitigation |
|---|---|
| **Polluting the bot-tuned ladder** (the CRITICAL constraint) | Meta layer is read-only w.r.t. `Game`; rewards are cosmetic/QoL. Enforced by a sim-level import-isolation test (§7). `metaModified` flag plumbed for future-proofing + analytics segregation. |
| **Double-crediting on `win→freeplay→death`** (engine calls `finishRun` twice — see `engine.ts:191`) | `creditRun`/`advanceQuests` are idempotent per `runId` via `creditedRuns`. UI call site is already behind the `loggedRunRef` once-guard (`App.tsx:996-998`). |
| **Breaking the rules-locked replay** by adding fields | Plan explicitly forbids touching `PublicRunDoc`/`summary`; meta fields go only on the free-form private analytics doc. |
| **localStorage corruption / quota** | Copy `storage.ts`'s try/catch + spread-default migration; bad blob → fresh `MetaState`. Separate key `nvd-meta-v1` so it can't corrupt progress. |
| **Date/timezone drift in daily/weekly keys** | Use the same `toISOString().slice(0,10)` (UTC) as `freeplay.ts` for consistency with the existing daily seed; weekly key derived from the same UTC date to avoid a second timezone convention. |
| **Demo/recruiter runs leaking progression** | `meta.save()` is a no-op under DEMO_MODE (matches `storage.ts:68`); run-end credit site is already `!DEMO_MODE`. |
| **Quest farming via instant abandons** | Abandoned/very-short runs grant 0 XP/salvage and 0 quest progress (`deriveRunReward` + `advanceQuests` gate on `outcome !== 'abandoned'`). |
| **Sim regression (engine perturbation)** | `npm run sim` numbers must match pre-change exactly; gate the PR on it. |
| **Under-13 / restricted players** | Meta is local-only and grants no posting capability, so it's COPPA-safe with no consent dependency; cosmetics are local. No new consent gate needed. |

---

## 9. Effort Estimate (sub-tasks)

| # | Sub-task | Est. |
|---|---|---|
| 1 | `meta.ts` pure core: rank curve + titles | 0.5 d |
| 2 | `meta.ts` reward derivation + tuning | 0.5 d |
| 3 | `meta.ts` quest generators (daily+weekly, weekKey) | 1.0 d |
| 4 | `meta.ts` streak from `sessionDays` | 0.25 d |
| 5 | `MetaState` + `meta` singleton + persistence + idempotency | 0.75 d |
| 6 | `scripts/meta-sim.ts` (determinism/curve/idempotency/isolation tests) | 0.5 d |
| 7 | `OperationsBoard.tsx` (rank bar, salvage, streak, quest cards, claim) + CSS | 1.25 d |
| 8 | `MainMenu` tab + hero rank/streak strip | 0.5 d |
| 9 | Run-end credit wiring + `<MetaReward/>` in 3 overlays | 0.75 d |
| 10 | Comeback prompt (menu-only, once/day) | 0.5 d |
| 11 | (Optional) `metaModified` flag through `RunRecord` + private analytics + admin filter | 0.5 d |
| 12 | Playwright specs + `npm run sim` regression check | 0.75 d |
| | **Total** | **≈ 8.0 dev-days** (≈7.5 without the optional flag) |

---

## Key file references (absolute paths)

- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\storage.ts` — persistence idiom to copy (`load/save/DEMO_MODE` `57-72`, `markSession`/`sessionDays` `122-146`, `addRun` `85-100`, `RunRecord` `35-47`).
- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\freeplay.ts` — date-hash generator pattern to copy (`dailyFreeplaySeed` `155-187`, `hash` `317-324`, `pickMany` `306-315`).
- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\engine.ts` — run-end lifecycle (`finishRun` + double-finish guard `190-212`, `runStats` `173-180`, tower-kinds join `207`, victory/wave-end `1144-1184`). **No edits planned.**
- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\App.tsx` — `Main` session effect `124`; `MainMenu` tabs `502/520-525/644`, hero stats `535-542`; run-end terminal once-guarded block `996-1016`; overlays `1426/1474/1480`; `AfterAction`/`Overlay` `1685-1718/1810+`.
- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\runTelemetry.ts` — `PrivateRunAnalyticsDoc.progression` `316-329` (optional flag target); `PublicRunDoc` is rules-locked — do not modify.
- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\leaderboard.ts` — `normalizeRunAnalytics` defaults `558-571` (optional flag default).
- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\firestore.rules` — `runs/{runId}` `hasOnly` key lock (reason public doc must not change).
- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\scripts\sim.ts` — sim harness pattern for `scripts/meta-sim.ts`.
- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\tests\e2e\ux-ui.spec.ts` — seed/`?demo=1`/`getByTestId` pattern for new specs (`16-49`).

**Files to create:** `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\meta.ts`, `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\OperationsBoard.tsx`, `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\scripts\meta-sim.ts`.


## Top Bet 4 — Remote Balance Config (hot-patch without redeploy)

---

# TOP BET 4 — Remote Balance Config (hot-patch without redeploy)

## 1. Overview

Add a single sparse Firestore document (`config/balance`) read once on app boot. Its values pass through a clamp/validate layer into a module-level singleton (`balanceConfig`) that already-existing engine code consults at the exact points where static numbers become live numbers: tower cost, computed tower stats, enemy HP, difficulty `hpMult`/`lateScale`/`costMult`/starting cash & lives, and kill income. A **missing doc, a network failure, or any out-of-range field falls back to today's hardcoded values** — the doc only *overrides*, it never *defines*. Every override set carries a `version` string that gets stamped onto `PublicRunDoc.setup.balanceVersion` (a field that already exists but currently just mirrors `build`), so any replay/run can be traced to the config it ran under.

Design constraints honored from the real code:
- **Sim/bot harnesses call `new Game(map, diff)` synchronously with no network** (`scripts/balance/run.ts:56`, `scripts/sim.ts:29`). The override singleton must default to identity and be configurable, so headless tooling keeps working unchanged and can opt into a config via a setter.
- **`computeStats` does `{ ...def.base }` then runs upgrade closures** (`towers.ts:491-494`) and is also called from the engine on every place/upgrade (`engine.ts:538,573`). Overrides apply as a post-multiply on the finished `TowerStats`, never by re-authoring upgrade closures.
- **The Firestore client already exists** (`firebaseClient.ts` → `db`) and `leaderboard.ts` already has the `withTimeout` race + getDoc patterns to copy. No new SDK import on the player path.
- **`firestore.rules` ends in a catch-all deny** (`firestore.rules:206-208`); `config/balance` needs an explicit public-read / admin-write rule.

## 2. Data model / types

New file `src/game/balanceConfig.ts`. The wire shape is sparse — every field optional; consumers read through getters that apply defaults + clamps.

```ts
// Raw wire doc (all optional, admin-authored, untrusted)
export interface BalanceConfigDoc {
  version?: string;                 // stamped onto runs; <= 30 chars
  income?: { killMult?: number; waveBonusMult?: number };
  diffs?: Record<string, {          // keyed by DifficultyDef.id: easy|normal|hard|extinction|ngplus
    hpMult?: number; lateScale?: number; costMult?: number;
    cashMult?: number; livesMult?: number;
  }>;
  enemies?: Record<string, { hpMult?: number; rewardMult?: number }>; // keyed by EnemyDef.id
  towers?: Record<string, {         // keyed by TowerDef.id
    costMult?: number; damageMult?: number; rangeMult?: number; fireRateMult?: number;
  }>;
}

// Resolved, clamped, always-complete view the engine reads
export interface ResolvedBalance {
  version: string;                  // '' when no doc / default
  killMult: number; waveBonusMult: number;
  diff(id: string): { hpMult: number; lateScale: number; costMult: number; cashMult: number; livesMult: number };
  enemy(id: string): { hpMult: number; rewardMult: number };
  tower(id: string): { costMult: number; damageMult: number; rangeMult: number; fireRateMult: number };
}
```

**Clamp table** (all multipliers; reject NaN/Infinity, then bound):

| field | min | max | default |
|---|---|---|---|
| `killMult`, `waveBonusMult` | 0.25 | 4 | 1 |
| diff `hpMult`, `lateScale`*, `costMult`, `cashMult`, `livesMult` | 0.25 | 4 | 1 (multipliers); see note |
| enemy `hpMult`, `rewardMult` | 0.25 | 4 | 1 |
| tower `costMult` | 0.25 | 4 | 1 |
| tower `damageMult`, `rangeMult`, `fireRateMult` | 0.25 | 4 | 1 |

\* Note on `hpMult`/`lateScale`/`costMult` for diffs: these names exist in `DifficultyDef` as **absolute base values** (e.g. `normal.hpMult = 1.4`, `hard.lateScale = 0.075`). To avoid confusing "absolute vs multiplier" semantics, the config treats **all diff fields as multipliers applied on top of the static `DifficultyDef`** (e.g. `effectiveHpMult = diff.hpMult * cfg.diff(id).hpMult`). This keeps one mental model (everything is a ×) and means an empty doc is a perfect no-op. `version` is sanitized to `[A-Za-z0-9._-]{0,30}` and defaults to `''`.

Module API:
```ts
export function getBalance(): ResolvedBalance;          // sync, always returns a valid view
export function setBalanceDoc(doc: BalanceConfigDoc | null): void;  // validate+clamp+swap singleton
export function balanceVersion(): string;               // convenience for telemetry stamping
export async function loadRemoteBalance(): Promise<void>; // fetch config/balance, call setBalanceDoc; swallow errors
```

The singleton starts as the all-identity `ResolvedBalance` so anything that imports it before `loadRemoteBalance()` resolves (and all headless tooling) sees current behavior.

## 3. Exact files to create / edit

### CREATE `src/game/balanceConfig.ts`
- Holds `BalanceConfigDoc`, `ResolvedBalance`, the clamp helpers, the module-level `let current: ResolvedBalance`.
- `clampMult(n, min=0.25, max=4)`: `Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback`.
- `setBalanceDoc(doc)`: builds the resolved view with closures over validated maps; unknown diff/enemy/tower ids resolve to identity (so a stale id in the doc can't crash anything).
- `loadRemoteBalance()`: imports `db` from `./firebaseClient`, uses `getDoc(doc(db, 'config', 'balance'))` raced against a `withTimeout`-style 6s guard (copy the helper from `leaderboard.ts` or factor it out — see Risks). On success `setBalanceDoc(snap.data())`; on any throw, log-and-ignore (identity stays).
- No consent gate: this is a public, PII-free read (mirrors the `feedback`-reply read pattern in `leaderboard.ts`), and gameplay balance must load even on the restricted/COPPA tier.

### EDIT `src/game/towers.ts`
- `computeStats(def, tierA, tierB)` (line 490): after the existing loops, before `return s`, apply tower stat overrides:
  ```ts
  const o = getBalance().tower(def.id);
  s.damage *= o.damageMult; s.range *= o.rangeMult; s.fireRate *= o.fireRateMult;
  ```
  (Multipliers only on the three "knob" stats — leaving pierce/splash/slow etc. untouched keeps the override surface small and safe; cost is handled in the engine, not here.)
- Import `getBalance` from `./balanceConfig`.
- Leave `sellValue` alone (it derives from `invested`, which already reflects overridden cost).

### EDIT `src/game/engine.ts`
- **`cost(def)` (line 446):** multiply by tower cost override:
  ```ts
  return Math.round((def.cost * getBalance().tower(def.id).costMult * this.diff.costMult * getBalance().diff(this.diff.id).costMult) / 5) * 5;
  ```
- **`upgradeCost(t, track)` (line 468):** apply tower `costMult` + diff `costMult` override the same way (so upgrades scale with the same lever as base cost). Keep the existing `bonusMult`/`freeplaySink` logic.
- **Constructor (lines 237-238) + the freeplay starting-cash/lives paths (lines 321, 344-346):** route starting cash/lives through diff overrides:
  ```ts
  const db = getBalance().diff(diff.id);
  this.credits = Math.round(diff.cash * db.cashMult);
  this.lives   = Math.max(1, Math.round(diff.lives * db.livesMult));
  ```
  Apply `cashMult` inside `dailyFreeplayStartingCash` (line ~2027) too, and to `RunRecorderStart.startingCash/startingLives` so the replay records the actual values (recorder already reads `diff.cash`/`diff.lives` at line 243-244 — change those to the overridden locals).
- **`makeEnemy` (lines 712-727):** fold enemy + diff overrides into the existing HP formula:
  ```ts
  const o  = getBalance().enemy(def.id);
  const dc = getBalance().diff(this.diff.id);
  const diffMult = 1 + (this.diff.hpMult * dc.hpMult - 1) * ramp;
  const late     = 1 + Math.max(0, this.wave - 25) * this.diff.lateScale * dc.lateScale;
  // ...existing fp/mutatorHp/rivalHp...
  const hp = Math.ceil(def.hp * o.hpMult * diffMult * late * fp * mutatorHp * rivalHp);
  ```
- **`killEnemy` income (line 896):** fold kill income + per-enemy reward override:
  ```ts
  this.earn(Math.max(1, Math.round(
    e.def.reward * getBalance().enemy(e.def.id).rewardMult * getBalance().killMult *
    incomeMult(this.wave) * (this.freeplay ? freeplayIncomeMult(...) : 1))));
  ```
- **`waveBonus` consumer (line 1101):** multiply by `getBalance().waveBonusMult`.
- Import `getBalance` at top.

> Decision: apply overrides **at the read sites**, not by mutating `DifficultyDef`/`def.base` at boot. The sim harness constructs `Game` with the imported `DIFFICULTIES` objects directly; mutating them globally would be an invisible side effect and would fight the "identity default" contract. Read-site multiplication is explicit and trivially testable.

### EDIT `src/game/runTelemetry.ts`
- `makePublicRun` (line 1001): change `balanceVersion: build` → `balanceVersion: balanceVersion()`. Import `balanceVersion` from `./balanceConfig`. (Type and rules already permit `setup.balanceVersion`; it's inside the `setup is map` check, no rule change needed.) Optionally also stamp it on `PrivateRunAnalyticsDoc` (add a `balanceVersion` to the `difficulty` map, which is free-form `Record<string, number|string|null>` and already rule-validated as `is map`).

### EDIT `src/main.tsx` (boot)
- Before/at `createRoot(...).render(...)` (line 48), kick off `void loadRemoteBalance();`. Fire-and-forget: the identity default means the first frames are correct-by-fallback, and the swap is in place long before a player finishes the menu and clicks deploy. (No need to block first paint.)
- Alternatively call it in the `Main` boot `useEffect` next to `progress.markSession()` (`App.tsx:124`) — but `main.tsx` is cleaner and runs for `?perf`/`?demo` paths too. Recommend `main.tsx`.

### EDIT `firestore.rules`
Add before the catch-all (line 206), mirroring the admin-write style already in the file:
```
match /config/balance {
  allow get: if true;
  allow list: if false;
  allow write: if isAdmin()
    && request.resource.data.keys().hasOnly(['version','income','diffs','enemies','towers'])
    && (!('version' in request.resource.data) || (request.resource.data.version is string && request.resource.data.version.size() <= 30))
    && (!('income'  in request.resource.data) || request.resource.data.income  is map)
    && (!('diffs'   in request.resource.data) || request.resource.data.diffs   is map)
    && (!('enemies' in request.resource.data) || request.resource.data.enemies is map)
    && (!('towers'  in request.resource.data) || request.resource.data.towers  is map);
}
```
`isAdmin()` already exists (`firestore.rules:4-11`). Deep numeric clamping stays **client-side** (the engine clamps on read) — rules only gate who can write and the coarse shape; this matches the project's existing split (rules check shape, app sanitizes values).

## 4. Step-by-step build order

1. **Create `balanceConfig.ts`** with types, clamps, identity default, `getBalance`/`setBalanceDoc`/`balanceVersion`. No Firestore yet — pure + unit-testable. Verify identity: `getBalance().tower('pulse').damageMult === 1`.
2. **Wire read sites in `towers.ts` + `engine.ts`.** With identity default, `npm run sim` / `npm run balance` must produce byte-identical results to pre-change (this is the regression gate — see Testability).
3. **Add `loadRemoteBalance()`** (Firestore getDoc + timeout) and call it from `main.tsx`.
4. **Stamp telemetry**: `runTelemetry.ts` `balanceVersion()`.
5. **firestore.rules** `config/balance` block; `firebase deploy --only firestore:rules`.
6. **Admin edit path** (Section 6).
7. **Smoke test** end-to-end: write a doc, reload, observe changed numbers + stamped version on a submitted replay.

## 5. Schemas / rules / Cloud-Function changes

- **Firestore rules:** the one `config/balance` block above. No CF change required — config is read directly by clients (public read) and written by admin (rules-gated). The existing `submitScore`/`submitDailyScore` CFs (`functions/src/index.ts`) verify a replay but don't need the balance version to function; if you later want server-side score sanity bounds to scale with an active config, that's a **follow-up** (out of scope for this minimal bet — see Risks).
- **No new collection in `validBoard`/`leaderboard.ts`** — config is orthogonal to boards.

## 6. Admin dashboard editing (or documented manual edit)

Two options; recommend documenting manual first, building UI second.

- **Manual (ship-now):** the doc is hand-editable in the Firebase console at `config/balance`. Because the engine clamps and falls back, a malformed edit is safe. Document the schema + clamp ranges in a code comment block at the top of `balanceConfig.ts` and in the existing `AdminDashboard.tsx` BALANCE tab as read-only help text.
- **In-dashboard editor (follow-up):** `AdminDashboard.tsx` already lazy-loads `adminAuth` (the auth SDK is admin-only, off the player bundle) and reads `/balance-report.json` (line 2326). Add a small "Live Balance" panel under the BALANCE tab that:
  - `getDoc(config/balance)` to show current overrides,
  - presents number inputs per lever (reuse the report's tower/diff/enemy ids so the admin sees real names),
  - writes via `setDoc(doc(db,'config','balance'), payload, { merge:true })` — succeeds because the admin is signed in (rules `isAdmin()`).
  - Auto-bump `version` to e.g. `hollow-1-b<timestamp36>` on save so runs are traceable.
  This reuses the dashboard's existing auth + Firestore wiring; no new infra.

## 7. How it reuses existing assets

- **Firestore client:** `firebaseClient.ts` `db` — no new init, no new SDK on player path.
- **Network timeout pattern:** copy/extract `withTimeout` from `leaderboard.ts:35` (portal-iframe CSP can hang Firestore promises forever — the same reason the leaderboard wraps every call; the config fetch must too).
- **Telemetry field:** `PublicRunDoc.setup.balanceVersion` already exists (`runTelemetry.ts:138,1001`) and is already rules-valid (inside `setup is map`). Just change what it's assigned.
- **Stat plumbing:** `computeStats` is already the single chokepoint the engine calls on place/upgrade (`engine.ts:538,573`); one edit there covers all live towers including the gravity/`rift`/`sweep` styles.
- **Admin gating:** `isAdmin()` in rules + `adminAuth`/`AdminDashboard` for the UI — all present.
- **Build tag:** `TELEMETRY_BUILD` ('hollow-1') is the natural default seed for `version`.

## 8. Testability (bot / sim / playwright)

- **Identity-regression (critical):** Step 2's gate. Run `npm run sim` and `npm run balance` (`scripts/sim.ts`, `scripts/balance.ts`) before and after wiring read-sites with the default doc; win-grid + curves must be unchanged. These harnesses call `new Game(map, diff)` directly with no network (`scripts/balance/run.ts:56`), so they exercise the identity path automatically.
- **Override-effect sim:** add an optional hook so a script can inject a doc before running, e.g. call `setBalanceDoc({ enemies:{ scout:{ hpMult: 2 } } })` then `runInstrumented(...)` and assert win-rate drops / final wave shifts. This is a 5-line addition to a throwaway test script or a `--config <file>` flag on `sim.ts`. No engine change needed because `setBalanceDoc` is already the seam.
- **Unit tests for the clamp layer:** feed NaN, `Infinity`, `1e9`, negative, unknown ids; assert all resolve to a valid clamped/identity view (pure functions, no Firestore).
- **Playwright/manual:** with rules deployed, write `config/balance = { version:'test', towers:{ pulse:{ costMult: 0.5 } } }`, reload the live app, open the shop, assert the Pulse Turret price is halved and rounded to the nearest 5 (the `/5)*5` rounding in `cost()`). Then finish a run, submit, and confirm `runs/{runId}.setup.balanceVersion === 'test'`.
- **`?perf` path:** `loadRemoteBalance()` in `main.tsx` runs for the perf harness too; a quick `/?perf=throat&diff=hard` confirms no boot regression and the fetch doesn't block first frame.

## 9. Risks + mitigations

- **Async fetch vs synchronous construction.** If a player somehow deploys a run within the ~first second before the fetch resolves, they get identity (current) balance. *Mitigation:* acceptable by design — identity is always a valid balance; the version stamp records `''` (or the prior value) honestly. Fire `loadRemoteBalance()` in `main.tsx` so it starts before any menu interaction.
- **Hung Firestore promise in portal iframes.** Firestore reads don't reject on blocked network (documented at `leaderboard.ts:30-34`). *Mitigation:* reuse `withTimeout` (6s) so `loadRemoteBalance` always settles to the catch path.
- **Malicious/buggy doc bricking the game.** *Mitigation:* every field is clamped to `[0.25, 4]` and unknown ids resolve to identity; the doc can never produce a 0, negative, NaN, or absurd value, and can't reference a tower/enemy/diff that doesn't exist. Rules also restrict writes to `isAdmin()`.
- **Semantic confusion (absolute vs multiplier) for diff fields** that share names with `DifficultyDef` absolutes (`hpMult`, `lateScale`, `costMult`). *Mitigation:* config fields are **always multipliers on top of the static def** (Section 2 note); document this prominently; empty doc = exact no-op.
- **Server-side score verification drift.** The `submitScore` CF validates claims against the replay using its own bounds; a config that, say, doubles income could push legitimate scores past a server sanity cap and get rejected. *Mitigation:* out of scope for the minimal bet, but flag it — if you later push aggressive income configs, the CF's bounds may need to read the same `config/balance` (Admin SDK can `getDoc` it) or relax. Document as a known limitation.
- **Cache staleness via service worker.** `main.tsx` registers `sw.js` in PROD. The config is fetched from Firestore (not a cached static asset), so SW caching doesn't apply — no mitigation needed, but don't move the config into `/public`.
- **Two callers of `withTimeout`.** Extracting it into a tiny `src/game/netTimeout.ts` avoids duplication; low risk either way.

## 10. Effort estimate (sub-tasks)

| # | Sub-task | Est. |
|---|---|---|
| 1 | `balanceConfig.ts`: types, clamps, identity default, getters/setter (pure) | 2.0h |
| 2 | `loadRemoteBalance()` + `withTimeout` extraction + Firestore getDoc | 1.0h |
| 3 | Wire read-sites: `towers.ts` computeStats; engine `cost`/`upgradeCost`/constructor/freeplay cash & lives/`makeEnemy`/`killEnemy`/waveBonus | 2.5h |
| 4 | Telemetry stamp in `runTelemetry.ts` (+ optional analytics field) | 0.5h |
| 5 | `main.tsx` boot call | 0.25h |
| 6 | `firestore.rules` `config/balance` block + deploy | 0.5h |
| 7 | Identity-regression run of `sim`/`balance` + fix any drift | 1.0h |
| 8 | Unit tests for clamp layer + an override-effect sim hook (`--config`) | 1.5h |
| 9 | Manual end-to-end smoke (write doc, reload, verify stamp) | 0.5h |
| 10 | Admin dashboard "Live Balance" editor panel (optional follow-up) | 3.0–4.0h |

**Core (1–9): ~10h.** With the optional dashboard editor: **~13–14h.** Minimal viable (manual console edits only, skip #10): **~10h.**

---

Key file references for the implementer: `src/game/balanceConfig.ts` (new), `src/game/towers.ts:490-495`, `src/game/engine.ts:237-238, 320-348, 446-448, 468-475, 712-727, 896, 1101, ~2027`, `src/game/runTelemetry.ts:1001`, `src/main.tsx:48`, `src/game/firebaseClient.ts:15`, `src/game/leaderboard.ts:35` (withTimeout), `firestore.rules:206` (insert point), `src/AdminDashboard.tsx:2326` (Firestore/auth reuse for the optional editor). Sim grounding: `scripts/balance/run.ts:56`, `scripts/sim.ts:29`.


## Top Bet 5 — Bot-Rival Ghosts + Live Balance Canary

- **Cores = `lives`.** Different per difficulty (200/120/80/70/100). The report's curve stores `coreFraction` (fraction of starting pool) and `creditsStart` per wave, plus `pressure` and `leakPct` — but NOT an absolute "cores held" series. The HUD shows `game.lives` (absolute cores). So the ghost target must convert `coreFraction × startingLives` to compare against absolute `game.lives`.
- Report is `public/balance-report.json`, fetched at the admin path only. The player path has no access to it yet.
- `curves[]` is keyed by `{map, diff, skill}` where skill is the matched skill (`MATCH`: easy→rookie, normal/…→standard/expert). Points are sorted by wave.
- Telemetry tab loads `fetchTelemetry(2000)` (flat per-run rows: final wave/cash/leaks/coresLeft only — NOT per-wave). `fetchRunAnalytics` gives per-run combat aggregates. **There is no live per-wave cores/leak series in Firestore today** — the closest per-wave source is `runs/{runId}` `snapshots[]` (RunWaveSnapshot has `wave`, `cash`, `lives`, `leaks`) — but `runs` is admin-listable and public-get. This is the canary's data source.
- App re-renders via `setTick` every 0.12s in the rAF loop; HUD reads `game.lives/credits/wave/phase` directly.

I have everything needed to write the plan.

# Implementation Plan — Top Bet 5: Bot-Rival Ghosts + Live Balance Canary

## 1. Overview

Two features sharing one data artifact (the bot's per-wave curve from `public/balance-report.json`):

- **(a) Player-facing bot ghost.** During a campaign run, overlay the matched-difficulty bot's per-wave cores curve as a live "target" in the HUD: a small inline readout next to the cores stat ("Expert held 48 cores at W40 — you have 51") plus a thin sparkline. At run end, award an **"out-warded the AI"** badge if the player's final wave / cores beat the bot curve.
- **(b) Operator-facing balance canary.** In the admin **TELEMETRY** tab, compute the **live player median per-wave cores/leak curve** from `runs/{runId}` replay snapshots and overlay it against the bot's report curve per `{map, diff}`, flagging waves where real players diverge (over/under-perform the model) beyond a threshold.

The connective tissue is a small derived structure I'll call the **GhostCurve**: a compact, per-`{map,diff}` array of `{ wave, cores, coreFraction, leakPct }` points derived from the existing `report.curves`. The player path needs this bundled small (not the full report); admin already has the full report in memory.

Grounding facts that shape the design:
- Cores = `game.lives`. Starting cores differ by difficulty (`DIFFICULTIES[].lives`: 200/120/80/70/100). The report stores **`coreFraction`** (fraction of starting pool) per wave, not absolute cores — so the ghost must reconstruct absolute cores as `round(coreFraction × startingLives)` (`scripts/balance/run.ts` defines `coreFraction = livesEnd / startingLives`).
- `report.curves` is keyed `{map, diff, skill}` where skill is the *matched* skill via `MATCH` in `scripts/balance.ts` (easy→rookie, normal→standard, hard/extinction/ngplus→expert). The same `MATCH`/`SKILL_FOR` map already exists in both `scripts/balance.ts` and `AdminDashboard.tsx` (`SKILL_FOR`).
- Curve points are post-wave snapshots (`coreFraction` is `livesEnd`), sorted ascending by wave.
- There is **no live per-wave Firestore aggregate** today. `fetchTelemetry` rows are per-run finals only. The only per-wave live source is `runs/{runId}.snapshots[]` (`RunWaveSnapshot`: `wave`, `cash`, `lives`, `leaks`, `kills`), which is public-get and admin-list (`firestore.rules` lines 46-48). The canary will read these via a new `fetchRunSnapshots` helper (admin lists `runs`, reads snapshots inline — they're already embedded in the `PublicRunDoc`).

## 2. Data model / types

### New shared module: `src/game/ghostCurve.ts`
Pure, dependency-light (no React, no Firebase) so both the player bundle and admin can import it.

```ts
export interface GhostPoint { wave: number; cores: number; coreFraction: number; leakPct: number; }
export interface GhostCurve {
  map: string; diff: string; skill: string;
  startingLives: number; avgFinalWave: number; winRate: number;
  points: GhostPoint[];           // sorted ascending by wave
}
// minimal report shape it consumes (subset of the report Curve)
interface CurvePointLite { wave: number; coreFraction: number; leakPct: number; }
interface WaveCurveLite { map: string; diff: string; skill: string; winRate: number; avgFinalWave: number; points: CurvePointLite[]; }

export function buildGhostCurves(curves: WaveCurveLite[]): GhostCurve[]; // converts coreFraction→absolute cores using DIFFICULTIES lives
export function ghostCurveFor(curves: GhostCurve[], mapId: string, diffId: string): GhostCurve | null;
export function ghostAtWave(curve: GhostCurve, wave: number): GhostPoint | null; // exact or nearest-prior wave
export interface GhostVerdict { beatCores: boolean; beatWave: boolean; deltaCores: number; deltaWave: number; }
export function judgeRun(curve: GhostCurve, finalWave: number, coresLeft: number): GhostVerdict;
```

`buildGhostCurves` reads `DIFFICULTIES` from `./maps` to get `startingLives`, then `cores = Math.round(coreFraction * startingLives)`.

### Bundled player asset: `src/game/ghostCurveData.ts` (generated)
A pre-extracted, minified subset of the report so the player path never fetches the full ~report JSON. Generated by extending `scripts/balance.ts` (see §5). Shape:
```ts
export const GHOST_CURVES: GhostCurve[] = [ /* one per map×diff, points downsampled */ ];
export const GHOST_BUILD = 'hollow-1'; // mirrors TELEMETRY_BUILD for staleness display
```
Payload control: downsample to every ~2 waves + always keep boss waves and the final point; drop `leakPct` from the player asset (player ghost only needs cores) → keep `{wave, cores}` tuples. Target < ~6 KB raw, gzips small. (Admin's canary uses the *full* in-memory report, so it keeps `leakPct`.)

### Canary types (admin-only, add to `AdminDashboard.tsx` or a new `src/adminCanary.ts`)
```ts
interface LiveWavePoint { wave: number; coresMedian: number; coreFractionMedian: number; leakMedian: number; n: number; }
interface CanaryDivergence { wave: number; model: number; live: number; delta: number; kind: 'cores' | 'leak'; severity: 'ok'|'soft'|'hard'; }
interface CanarySeries { map: string; diff: string; startingLives: number; model: GhostPoint[]; live: LiveWavePoint[]; divergences: CanaryDivergence[]; }
```

## 3. Exact files to create / edit

### CREATE
1. **`src/game/ghostCurve.ts`** — types + `buildGhostCurves`, `ghostCurveFor`, `ghostAtWave`, `judgeRun` (pure functions above).
2. **`src/game/ghostCurveData.ts`** — generated bundled curves (committed; regenerated by balance script).
3. **`src/components/BotGhostHud.tsx`** (or inline in App.tsx near the topbar) — the live ghost readout + sparkline component. Props: `{ curve: GhostCurve | null; wave: number; cores: number; phase: string }`.
4. **`src/game/adminCanary.ts`** — `computeCanary(snapshots, ghostCurves)` builders + `fetchRunSnapshots` data loader (or put the loader in `leaderboard.ts`, see below). Pure compute split from React.

### EDIT
5. **`scripts/balance.ts`** — after writing `OUT`, also emit `src/game/ghostCurveData.ts` (extract+downsample+`writeFileSync`). Reuses existing `curves`, `MATCH`, `round`. (See §5.)
6. **`src/game/leaderboard.ts`** — add **`fetchRunSnapshots(limit)`** (admin canary data source): list `runs` (admin-only per rules), map each doc → `{ summary, snapshots }`. Reuse `withTimeout`, `getDocs`, `query`, `orderBy('endedAt','desc')`, `limitResults`. There is `NO fetchRunReplay yet` — this is the first reader of `runs`. Return only the lean fields the canary needs (`summary.map/diff/wave/outcome`, `snapshots[].{wave,lives,leaks}`), not events/chunks.
7. **`src/App.tsx`** —
   - Load ghost curves once (module-level `buildGhostCurves(GHOST_CURVES)` memo, or `useMemo` in the game component).
   - Select the active curve via `ghostCurveFor(curves, game.map.id, game.diff.id)` — gated to **campaign only** (`!game.freeplay`), since the report curves are campaign-matched.
   - Render `<BotGhostHud>` in the topbar block (after the `tb-stat wave` div, ~line 1320). It re-renders with the existing `setTick` cadence (every 0.12s), reading `game.wave`/`game.lives`.
   - In the run-end overlays (`game.phase === 'victory'|'armistice'|'gameover'`, ~lines 1426-1470 + the victory overlay), pass the verdict into `AfterAction` (or a new sibling) to show the **"OUT-WARDED THE AI"** badge.
8. **`src/App.tsx` `AfterAction`** (line 1685) — accept an optional `ghost?: GhostCurve | null` prop; compute `judgeRun(ghost, game.wave, game.lives)` and render a badge row when `beatCores || beatWave`.
9. **`src/AdminDashboard.tsx` `TelemetryTab`** (line 853) — add a **Balance Canary** card: a `map×diff` selector (reuse `ALL_MAPS`/`DIFFICULTIES`), fetch live snapshots (`fetchRunSnapshots`), build `CanarySeries` via `adminCanary.ts` reusing the in-memory `report.curves` (passed in as `report` prop already available), and render an overlay LineChart (reuse the existing inline SVG chart pattern from `LineChart`/`TimeSeries`) of model-cores vs live-median-cores, plus a divergence list. Reuse `median()` (already defined at line 750) and `SKILL_FOR` (line 742).

## 4. Step-by-step build order

1. **`ghostCurve.ts`** (pure, testable in isolation). Unit-verify `coreFraction→cores` and `judgeRun`.
2. **Extend `scripts/balance.ts`** to emit `ghostCurveData.ts`; run `npm run balance -- quick` to generate a first committed asset. Verify the file compiles and is small.
3. **`BotGhostHud.tsx`** component + wire into App topbar; gate to campaign. Visual-only, reads live `game` state.
4. **Run-end badge**: extend `AfterAction`, pass `ghost` + verdict from the three end overlays.
5. **`fetchRunSnapshots`** in `leaderboard.ts` (admin-only reader of `runs`).
6. **`adminCanary.ts`** compute (`computeCanary`) + the **Balance Canary** card in `TelemetryTab`.
7. Tests (bot/sim + playwright), see §6.
8. Regenerate the full `ghostCurveData.ts` with a non-quick `npm run balance` before shipping.

## 5. Schema / rules / Cloud-Function / build changes

- **Firestore rules: NO change needed.** `runs/{runId}` already allows `get: if true` and `list: if isAdmin()` (lines 46-48). The canary lists `runs` as admin → permitted. The player ghost reads only the bundled JS asset → no Firestore at all.
- **No Cloud Function changes.** Neither feature writes server-side; canary is read-only over existing `runs` snapshots written by `submitRunReplay`.
- **Build pipeline change (minor):** `scripts/balance.ts` gains a second `writeFileSync` target (`src/game/ghostCurveData.ts`). It already imports `ALL_MAPS`/`DIFFICULTIES` and computes `curves` with `coreFraction`; reuse them. Emit a TS file (not JSON) so it tree-shakes into the player bundle and is type-checked. The generator must:
  - For each `{map, diff}`, take the single curve (skill = `MATCH[diff.id]`).
  - Downsample points: keep wave 1, every 2nd wave, boss waves (cross-reference `getWave`/wave tags if cheap, else just stride), and the last point.
  - Convert `coreFraction → cores` at generation time OR leave `coreFraction` and convert at runtime in `buildGhostCurves` (prefer runtime conversion so the asset stays difficulty-agnostic and one source of truth for `startingLives`).
- **Staleness guard:** stamp `GHOST_BUILD` in the generated asset; if it ever drifts from `TELEMETRY_BUILD`, the HUD can show a subtle "(model: hollow-1)" caption instead of silently comparing against stale curves. Admin canary already filters telemetry by `build`; reuse that idea for the snapshot set if `endedAt` is recent.

## 6. How it reuses existing assets

- **Report curve data:** both features consume `report.curves` shape verbatim (defined identically in `scripts/balance.ts`, `AdminDashboard.tsx`, and via the lite types in `ghostCurve.ts`). No new sim or balance run logic.
- **Admin already fetches the report** (`AdminDashboard.tsx` line 2326) — the canary reuses the `report` prop already passed to `TelemetryTab` (line 853/2382), so **no second fetch** of `balance-report.json` on the admin side.
- **Charts:** the canary overlay reuses the existing inline SVG chart conventions (`LineChart` at line 105, `TimeSeries` at 787) — same `viewBox`/`adm-line`/`adm-grid`/`adm-axis` classes, so it inherits the dashboard's styling.
- **Median + skill mapping** already exist in `AdminDashboard.tsx` (`median` line 750, `SKILL_FOR` line 742) — the canary imports/reuses rather than reimplements.
- **HUD re-render:** the ghost piggybacks on the existing `setTick` 0.12s cadence (App.tsx line 1037), no new render loop.
- **Run-end overlays:** badge slots into the existing `AfterAction`/`Overlay` `report` ReactNode (lines 1427, 1685, 1810).
- **Snapshots** are already produced by `RunRecorder.makePublicRun` (`snapshots: this.snapshots.slice(-80)`, runTelemetry.ts line 1004) with `wave`/`lives`/`leaks` — the canary's live curve is a free byproduct of replays already being written by `submitRunReplay`.

## 7. Testability (bot / sim / playwright)

- **Pure-unit (fastest, highest value):**
  - `ghostCurve.test.ts`: feed a synthetic `WaveCurveLite` → assert `cores = round(coreFraction × DIFFICULTIES.lives)`, `ghostAtWave` nearest-prior behavior, `judgeRun` beat/lose boundaries (player cores == ghost cores → not "beat"; strictly greater → beat).
  - `adminCanary.test.ts`: feed synthetic snapshots (3 runs, varied per-wave `lives`) + a ghost curve → assert `coresMedian` matches `median()` and divergence severity thresholds.
- **Sim/bot integration:** add a tiny harness (or extend `scripts/balance/run.ts` consumers) that runs `runInstrumented(map, diff, MATCH[diff])` and confirms `judgeRun(ghost, finalWave, livesLeft)` yields `beat=false` for the *same* skill the curve was built from (the bot should roughly match itself — a sanity oracle that the conversion is consistent). Asserting "expert run does not wildly out/under-perform the expert curve" guards against a `coreFraction` inversion bug.
- **Generator test:** after `npm run balance -- quick`, assert `src/game/ghostCurveData.ts` parses, every `{map,diff}` is present, points are sorted ascending and downsampled (length << raw waves), and the file size is under the budget.
- **Playwright (player ghost):** start a campaign run (existing `data-testid="launch-wave"`, `data-testid="game-canvas"`), launch a few waves, assert the ghost readout text appears in the topbar and shows a "W{n}" reference. Drive to run-end (or use `?perf`/bot to fast-forward) and assert the badge node renders when cores beat the ghost. There's existing testid scaffolding to lean on.
- **Playwright (canary):** the `/admin` route is auth-gated (Firebase) — likely out of scope for CI Playwright. Instead cover the canary via the pure `adminCanary.test.ts`; optionally a component test rendering the Balance Canary card with injected props.

## 8. Risks + mitigations

| Risk | Mitigation |
|---|---|
| **`coreFraction` semantics:** it's `livesEnd/startingLives` (post-wave), so the "held N cores at W40" reads as cores *after* W40 clears, not at launch. | Label precisely ("held 48 cores after W40") and source absolute cores from `coreFraction × startingLives`. Verify against `creditsStart` (which IS at-launch) to avoid mixing at-launch vs post-wave. |
| **Skill mismatch:** report curves are bot-matched (easy→rookie etc.); a skilled human always beats the curve, making the badge trivial. | This is acknowledged in-product (admin note line 236: "Read the curves as a floor"). Frame the ghost as a *floor target* ("beat the AI's pace"), and make the badge meaningful by also requiring `beatWave` or a cores margin, not just `cores ≥ ghost`. |
| **Stale bundled asset** drifting from live balance after a patch. | `GHOST_BUILD` stamp + regenerate in the balance step; CI check that `ghostCurveData.ts` is regenerated when balance changes (optional pre-commit/CI assert that re-running balance produces no diff). |
| **Freeplay / daily / mutators** have no matching report curve (curves are campaign `{map,diff}` only). | Gate the ghost to `!game.freeplay`; `ghostCurveFor` returns null otherwise → HUD renders nothing. |
| **Canary `runs` listing cost/volume:** listing many `runs` docs (each carries events+snapshots) is heavy. | `fetchRunSnapshots` strips to `summary`+`snapshots` client-side, caps `limit` (e.g. 300), uses `withTimeout`, orders by `endedAt desc`. Snapshots are already embedded in the doc — no chunk/subcollection reads. Consider a recent-window filter (`endedAt` within 30d) to keep the median current. |
| **Low live sample size** producing noisy medians. | Carry `n` per wave point; gray out / hide divergence flags where `n < ~5`; reuse the dashboard's existing small-sample discipline (`wilsonLow` exists at line 745 for win rates — same spirit). |
| **HUD clutter / mobile width** in the topbar. | Make the ghost a compact stat + collapsible sparkline; hide the sparkline on narrow viewports (the topbar already conditionally renders stats like `PERF_MAP`/`adaptation`). |
| **Maps in report vs current maps drift** (8 maps in `maps.ts`). | `buildGhostCurves`/`ghostCurveFor` are id-keyed and null-safe; a missing curve just disables the ghost for that map. |

## 9. Effort estimate (sub-tasks)

| # | Sub-task | Est. |
|---|---|---|
| 1 | `ghostCurve.ts` pure module (types + 4 fns) | 0.5 d |
| 2 | Extend `scripts/balance.ts` to emit `ghostCurveData.ts` + first generation | 0.5 d |
| 3 | `BotGhostHud.tsx` + topbar wiring + campaign gating | 1.0 d |
| 4 | Run-end "out-warded the AI" badge in `AfterAction`/overlays | 0.5 d |
| 5 | `fetchRunSnapshots` in `leaderboard.ts` | 0.5 d |
| 6 | `adminCanary.ts` compute (`computeCanary` + divergence/severity) | 1.0 d |
| 7 | Balance Canary card in `TelemetryTab` (selector + overlay chart + divergence list) | 1.0 d |
| 8 | Unit tests (ghostCurve, canary) + sim sanity oracle | 0.75 d |
| 9 | Playwright (player ghost + badge) | 0.5 d |
| 10 | Polish: staleness caption, mobile/narrow handling, copy, final full `npm run balance` | 0.5 d |
| | **Total** | **~6.75 dev-days** |

Phasing: ship **player ghost (1-4, 9)** first as a self-contained increment (~3 days, no Firestore/admin dependency), then the **canary (5-8)** as a second increment.

---

**Key files (absolute paths):**
- Create: `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\ghostCurve.ts`, `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\ghostCurveData.ts`, `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\components\BotGhostHud.tsx`, `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\adminCanary.ts`
- Edit: `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\scripts\balance.ts`, `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\leaderboard.ts`, `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\App.tsx` (topbar ~1316-1320, AfterAction line 1685, end overlays ~1426-1470), `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\AdminDashboard.tsx` (`TelemetryTab` line 853; reuse `report` prop, `median` line 750, `SKILL_FOR` line 742)

**Load-bearing facts the implementer must not get wrong:**
- `scripts/balance/run.ts` defines `coreFraction = livesEnd / startingLives` (post-wave); convert to absolute cores via `coreFraction × DIFFICULTIES[diff].lives`. The HUD's `game.lives` is absolute cores.
- `report.curves` skill is the *matched* skill (`MATCH`/`SKILL_FOR`: easy→rookie, normal→standard, hard/extinction/ngplus→expert), one curve per `{map,diff}`.
- Live per-wave data for the canary comes only from `runs/{runId}.snapshots[]` (`RunWaveSnapshot.{wave,lives,leaks}`, runTelemetry.ts lines 48-61); `fetchTelemetry` rows are finals-only. `runs` is admin-listable (firestore.rules 46-48) — no rules change required.


## Top Bet 6 — The Gravity "Phase Anchor" Tower

---

# Implementation Plan — TOP BET 6: The Gravity "Phase Anchor" Tower

## 1. Overview

Ship a new **no-damage positional-control tower** that finishes the orphaned `style:'gravity'` engine path. It is the keystone control enabler: it manipulates where hulls *are* on the path rather than dealing damage, giving players a true crowd-control option in the mid arsenal (between Cinder Mortar at 19000 and Sunspear at 25000 kills).

- **Track A "Singularity Well" (HOLD):** strengthens backward drag + slow to pin hulls in a *kill-pocket* (a spot saturated by other towers).
- **Track B "Repulsor Field" (REPEL):** pushes hulls *forward, away from the anchor* to shatter Mender/heal-clusters and pry escorts off bosses — using **negative drag**, which requires a small, safe engine extension.

Key code reality confirmed by reading the source:
- `engine.ts` `style:'gravity'` branch (lines 1489–1513) is **live and unused by any tower** (`grep style:'gravity'` → no matches in towers.ts). It drags hulls backward (`e.dist = Math.max(0, e.dist - drag)`), repositions via `posAtDist`, applies slow, and deals `st.damage` as energy.
- `sfx.gravity()` exists (sound.ts:360).
- `render.ts` `case 'gravity'` (line 1244, "singularity anchor: caged black hole") draws from `def.color`/`def.glow` and is dispatched purely on `def.style` inside `drawTowerBody`. **No new render code needed.**
- All shop/hotkey/unlock-ladder/arsenal UI in `App.tsx` is built generically from `TOWERS_BY_UNLOCK`. The balance harness (`efficiency.ts`, `strategy.ts` solo/strategy) iterates `TOWERS`. **A new entry in `TOWERS` is auto-discovered everywhere.**

**Engine verdict:** The HOLD track works with the existing branch *as-is*. The REPEL track needs the gravity branch extended to (a) accept negative drag (push forward) and (b) **clamp forward push so a hull can never be shoved into the core** — because the leak check (`e.wp >= path.length`, line 1261) lives only in the movement block, not the gravity block. This is the one real engine change.

## 2. Data model / types

**No new types required.** `TowerStats` already carries every field this tower needs:
- `drag` (types.ts:99) — "px each target is dragged back along the path per pulse." We will allow it to be **negative** to mean forward push. Update the doc comment to say so.
- `range`, `fireRate`, `damage` (0 for this tower), `slowPower`/`slowDuration`, `pierce` (set 99 so the AoE conceptually hits all), `detection`.
- `FireStyle` already includes `'gravity'` (types.ts:112). No union edit.

`computeStats` (towers.ts:490) handles `damage:0` towers fine (Cryo/Ember/Locust already ship `damage:0`).

## 3. Exact files to create or edit

### A. `src/game/towers.ts` — add the tower (primary work; ~one object in `TOWERS`)
Insert a new `TowerDef` into the `TOWERS` array. Suggested placement: in the "kinetic / explosive / fire reinforcements" region, near the other mid-tier towers. Ordering inside the array is cosmetic only — `TOWER_MAP`, `TOWERS_BY_UNLOCK` (towers.ts:484–488) derive automatically.

Proposed definition (numbers are starting points for the balance pass, not final):

```
id: 'anchor', name: 'Phase Anchor', short: 'ANC', cost: 700, unlockAt: 22000,
desc: 'A caged singularity that never fires. It rewrites where hulls ARE — holding a column in a kill-pocket, or hurling it forward off its escorts.',
lore: '...'
color: '#8e7bef' (or distinct from Abyss '#6c5ce7'), glow: '#cdbcff', style: 'gravity',
base: base({ range: 120, fireRate: 1.0, damage: 0, damageType: 'energy', pierce: 99,
            drag: 26, slowPower: 0.25, slowDuration: 0.8, detection: false }),
```

**Track A "Singularity Well" (HOLD — backward drag, pinning):**
- t1 "Deeper Well" — +35% range. `s.range *= 1.35;`
- t2 "Mass Shadow" — stronger pull. `s.drag = 40;`
- t3 "Time Dilation" — slow 45% / longer. `s.slowPower = 0.45; s.slowDuration = 1.4;`
- t4 "Gravity Vise" — hard pull + hold. `s.drag = 70; s.slowPower = 0.55;`
- t5 BONUS "Event Well" — `s.drag = 110; s.range *= 1.2;`
- t6 BONUS "THE PIT" — `s.drag = 180; s.slowPower = 0.7; s.slowDuration = 2; s.range *= 1.2;` (hulls effectively parked in the pocket)

**Track B "Repulsor Field" (REPEL — forward push, anti-cluster):**
- t1 "Reverse Polarity" — flip to push. `s.drag = -26;`
- t2 "Phase Detector" — reveal cloaks pushed through. `s.detection = true;`
- t3 "Hard Shove" — `s.drag = -48;`
- t4 "Dispersion Field" — wider + stronger. `s.range *= 1.25; s.drag = -70;`
- t5 BONUS "Scatter Engine" — `s.drag = -110;`
- t6 BONUS "THE EXILE GATE" — `s.drag = -170; s.slowPower = 0.4; s.range *= 1.3;` (note: forward push + residual slow stalls them mid-lane in a damage zone)

Design rationale for the two committed bonus tiers (one per track, as the spec requires): T5/T6 each push `|drag|` to extreme values; `Game.bonusPower` (engine.ts:479) multiplies *damage* by 1.45/2.0 but this tower has `damage:0`, so the bonus payoff for an Anchor is *control magnitude*, not damage — which is the right knob for a control tower. **Call this out in the lore/desc so players understand the bonus isn't a damage spike.**

### B. `src/game/engine.ts` — extend the `gravity` branch for safe forward push (the one real engine change; lines 1489–1513)
Currently:
```
const drag = st.drag * (e.def.boss ? 0.22 : 1);
e.dist = Math.max(0, e.dist - drag);
const at = this.posAtDist(e.dist);
e.pos = at.pos; e.wp = at.wp;
```
This already works for positive (backward) drag. For **negative** drag (REPEL = forward), `e.dist - (negative)` increases `dist`, which `posAtDist` (engine.ts:796) clamps to the path end. **Problem:** pushing a hull to/near the path end here does NOT set `finished` (the leak check is only in the movement block at 1261), but the *next* movement tick will, so a strong forward push silently leaks hulls into the core. Mitigation: clamp forward push to a fraction of remaining path so a hull can never be pushed past a safe margin from the exit.

Concrete edit (compute `dist` with a max-clamp when drag is negative):
```
const drag = st.drag * (e.def.boss ? 0.22 : 1);   // negative = repel forward
let nd = e.dist - drag;                            // drag>0 backward, drag<0 forward
nd = Math.max(0, nd);
if (drag < 0) {
  const maxSafe = this.pathLength() - SAFE_EXIT_MARGIN; // e.g. 80px before the exit
  nd = Math.min(nd, maxSafe);
}
e.dist = nd;
const at = this.posAtDist(e.dist);
e.pos = at.pos; e.wp = at.wp;
```
- `pathLength()` already exists (engine.ts:810). Add a module const `SAFE_EXIT_MARGIN` (~80) near the other tuning consts.
- Bosses get the existing `0.22` damping (so the Exile Gate can't trivially fling a boss to the exit — note negative × 0.22 still safely reduced).
- The `damageEnemy(e, st.damage, 'energy', ...)` call stays; with `damage:0` it's a no-op (returns early at `dmg <= 0`, engine.ts:858), so the tower deals zero damage as intended.

The FX block (`sfx.gravity()`, `this.ring`, `this.burstFx`) already fires when `any` is true — no change.

### C. `src/game/bot.ts` — register in Profiles (lines 18–65)
Add the tower to bot plans so the balance harness and in-game bot exercise it:
- `standard.plan`: add e.g. `{ tower: 'anchor', a: 2, b: 0 }` (a HOLD anchor) after cryo.
- `expert.plan`: add both a HOLD and a REPEL anchor, e.g. `{ tower: 'anchor', a: 4, b: 0 }` and `{ tower: 'anchor', a: 0, b: 4 }`, near the cantor/emp control slots.
- Leave `rookie` plan untouched (its plan stops before 22000 unlock anyway; filler is `pulse`).

No structural changes to `Profile`/`PlanStep` — they're already `{tower,a,b}`.

### D. `scripts/balance/strategy.ts` — optional strategy entry (lines 45–92)
`runSoloViability` (line 139) and `analyzeEfficiency` already iterate `TOWERS`, so the Anchor appears in solo + efficiency tables automatically. Optionally add a named strategy to surface its *enabling* value (it can't solo — 0 damage):
- Add `{ name: 'anchor-control', desc: 'Phase Anchor hold-pocket + Rail/Tesla damage', profile: mixProfile(rep([{tower:'anchor',a:4,b:0},{tower:'rail',a:4,b:0},{tower:'tesla',a:4,b:0}],5), {tower:'rail',a:4,b:0}) }`.
This proves the tower's real role (force-multiplier), since solo-spam will correctly show it reaching low waves.

### E. `scripts/balance/efficiency.ts` — one accuracy tweak (line 33)
`dpsOf` utility detection only logs drag when `s.drag > 0` (line 33). For the REPEL track, `s.drag` is negative and won't be reported. Change to `if (s.drag !== 0) util.push(\`${s.drag > 0 ? 'drag' : 'push'} ${Math.abs(s.drag)}\`)` so the efficiency report doesn't mislabel the repel build as having no utility. The `'gravity'` DPS case (lines 81–84) already returns `damage*rate` (=0 here) → correctly flagged as a utility/`under-` tower; no change needed there.

### F. Lore/canon
Per memory (`neon-vector-defense.md` lore canon), write `lore` + `desc` consistent with the existing voice (Lantern/Combine/Continuity mythos). The Phase Anchor pairs naturally with Abyss Gate's "convinces the battlefield somewhere else is closer" framing — make it the *civilian/defensive* ancestor of that forbidden tech.

## 4. Step-by-step build order
1. **Engine first (safe):** extend the `gravity` branch in `engine.ts` for negative drag + `SAFE_EXIT_MARGIN` clamp. Verify with a unit-ish sim that a hull pushed by a strong negative drag never sets `finished` prematurely.
2. **Add the tower** to `TOWERS` in `towers.ts` (HOLD track first, all positive drag — exercises the *unchanged* path).
3. **Run** `npm run balance -- quick` and inspect `public/balance-report.json` + console: confirm the Anchor shows in efficiency (`util`/`under-`), solo (low waves — expected), and the new strategy reaches high waves.
4. **Add REPEL track** (negative drag tiers) + the `efficiency.ts` util-label fix.
5. **Wire bot Profiles** (standard/expert) and the optional strategy entry.
6. **Full balance pass** `npm run balance`; tune `drag`/`slowPower`/`cost`/`unlockAt` against the per-wave curves and win grid until the Anchor is "fair/util" and the anchor-control strategy is competitive but not dominant.
7. **Manual smoke** in-app: place an Anchor, watch HOLD pin a column under a Tesla, switch to a REPEL build and confirm hulls are shoved forward but never leaked at full upgrade.

## 5. Schemas / rules / Cloud-Function changes
**None.** No new persisted fields, no Firestore rules, no callable changes. Replays (`runTelemetry.ts` → `PublicRunDoc`, `damageByTower`) and `submitScore` verification are tower-agnostic and key off `def.id`; a new id flows through with zero schema work. `storage.ts` unlock tracking (`markUnlockSeen`/`unlockSeen`) is driven by `TOWERS_BY_UNLOCK` in `App.tsx` (lines 864, 1052) and needs no edit.

## 6. How it reuses existing assets
- **Engine:** the `gravity` update branch (only extended, not rewritten); `posAtDist`, `pathLength`, `applySlow`, `damageEnemy`, `ring`, `burstFx` — all reused.
- **Render:** `drawTowerBody` `case 'gravity'` (singularity anchor art) renders the tower from `def.color`/`def.glow` with no new code.
- **Sound:** `sfx.gravity()` reused as-is.
- **UI:** shop, number hotkeys (App.tsx:1185), unlock ladder/progress bar (App.tsx:1844–1894), arsenal preview tile (App.tsx:1923 `drawTowerBody`), AdminDashboard tower rows — all generic over `TOWERS_BY_UNLOCK`/`TOWER_MAP`.
- **Balance:** `analyzeEfficiency`/`runSoloViability` iterate `TOWERS` automatically.

## 7. Testability
- **Balance sim (primary):** `npm run balance [-- quick]` — efficiency table (auto), solo viability (auto, expect low — it's 0-damage), the new `anchor-control` strategy, and per-wave curves on `reactor/normal`. This is the main quantitative gate.
- **Bot:** `expert`/`standard` plans now place Anchors, so every `runInstrumented` exercises both tracks end-to-end (placement → upgrade → fire branch).
- **Engine invariant test:** a focused sim asserting that with a max REPEL Anchor, **no enemy `finished` flag flips earlier than under no Anchor on the same seed** (guards the core-leak risk). Reuse `scripts/balance/run.ts` harness.
- **Playwright/manual:** place the tower, confirm hotkey, range circle (uses `stats.range`), upgrade panel (committed tiers lock correctly via `upgradeState`, engine.ts:461), and visual drag/push behavior. Confirm the arsenal preview tile renders.

## 8. Risks + mitigations
| Risk | Mitigation |
|---|---|
| **Core leak from forward push** (leak check absent in gravity branch) | `SAFE_EXIT_MARGIN` clamp on negative drag in the engine edit; engine invariant test. |
| **0-damage tower looks "useless" / dominated** in solo + efficiency reports | Expected and correct; add `anchor-control` strategy to show its enabler value; document in `desc`. |
| **Bonus tiers (`bonusPower`) give no payoff** (damage=0) | Make T5/T6 scale control magnitude (drag/slow/range); state in lore that this tower's "ascension" is control, not DPS. |
| **REPEL trivializes content** by holding hulls in a slow+push standstill, or **HOLD** infinitely stalls a wave | Tune via balance curves; bosses keep the `0.22` drag damping; cap `slowPower`; watch win-grid for >100% inflation. |
| **Negative-drag mislabeled** in efficiency util output | `efficiency.ts` `dpsOf` drag-line fix (`!== 0`). |
| **Unlock placement** crowds an existing tower's slot | `unlockAt:22000` sits cleanly between Cinder (19000) and Sunspear (25000); adjust if the ladder feels dense. |

## 9. Effort estimate (sub-tasks)
- Engine gravity-branch extension + `SAFE_EXIT_MARGIN` const: **0.5 day** (small change, but needs the invariant test).
- `TOWERS` entry (both tracks, base, lore/desc, color/glow, unlockAt): **0.5 day**.
- `bot.ts` Profile wiring + `strategy.ts` strategy + `efficiency.ts` util-label fix: **0.25 day**.
- Balance tuning loop (run harness, read curves/grid, iterate drag/slow/cost): **1 day** (dominant cost — control towers need iteration).
- Engine invariant test + manual/Playwright smoke: **0.5 day**.

**Total ≈ 2.5–2.75 days**, of which tuning is the largest slice.

## 10. Files referenced (absolute paths)
- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\engine.ts` — gravity branch 1489–1513 (edit); `posAtDist` 796, `pathLength` 810, leak check 1261, `damageEnemy` 854, `bonusPower` 479, `upgradeState` 461.
- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\towers.ts` — add to `TOWERS` (array ends line 482); `base()` 3, `u()`/`track()` helpers, `computeStats` 490; Abyss Gate `rift` reference 327–354.
- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\types.ts` — `TowerStats.drag` 99 (doc-comment update only), `FireStyle` 112 (already has `'gravity'`).
- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\render.ts` — `gravity` case 1244, `drawTowerBody` 950 (no change, confirm reuse).
- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\sound.ts` — `sfx.gravity` 360 (no change).
- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\game\bot.ts` — `PROFILES` 18–65 (edit standard/expert).
- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\scripts\balance\strategy.ts` — `strategies()` 45 (optional add); `runSoloViability` 137 (auto).
- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\scripts\balance\efficiency.ts` — `dpsOf` drag util line 33 (fix); `gravity` DPS case 81 (no change).
- `C:\Users\et2bo\Desktop\Projects\neon-vector-defense\src\App.tsx` — shop/hotkey/ladder all generic over `TOWERS_BY_UNLOCK` (no change; confirmed 864/1052/1185/1844/1923).

**Confirmation on the engine question:** the `gravity` branch already does everything the HOLD track needs (backward drag + slow, no damage). It needs **one extension** — support negative `drag` (forward repel) with a `SAFE_EXIT_MARGIN` clamp — to enable the REPEL track without leaking hulls into the core.
