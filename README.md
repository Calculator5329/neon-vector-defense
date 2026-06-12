# Neon Vector Defense

A sci-fi tower defense game in the spirit of Bloons TD 4, built with React + TypeScript + Canvas.

**The world:** Humanity strung lighthouse-relays — Lanterns — across the dark between systems. They carry the Continuity: the backed-up minds of every colonist who ever crossed. The Vex Combine armada besieging them is not an invader. It is a self-replicating logistics fleet still executing a siege order from a war that ended 284 years ago, because the ceasefire signal was carried by the first relay it destroyed. You are the Warden of Lantern Seven. Hold the lane — and read the Archive.

## Run it

```bash
npm install
npm run dev     # play
npm run sim     # headless AI balance simulation (append "quick" for a fast pass)
```

## The game

- **3 sectors** — Orbital Relay, Twin Reactor, Hyperlane Junction — each with its own path, no-build zones, and theme.
- **3 protocols** — Recruit (forgiving: cheap towers, soft hulls, no phase-cloaks, 50 waves), Veteran (60 waves), Apex (80 cores, hulls ramp to 2.2× HP, 70 waves). Victory unlocks endless freeplay.
- **14 hostile classes** — BTD-style nested hulls from Scout Drones to the LEVIATHAN Dreadnought, with armored / blast-proof / cryo-proof / phase-cloaked variants and the **Seraph Tender**, a repair ship that mends the convoy mid-flight.
- **10 towers × 4 upgrades** — Pulse Turret, Tesla Coil, Cryo Emitter, Railgun Post, Missile Battery, Drone Carrier, Prism Array, EMP Spire, plus two exotics:
  - **Singularity Anchor** — drags every hostile in range *backward along the path* and crushes hulls.
  - **Starlight Cantor** — marks hulls with resonance stacks; each stack makes them take +10% damage from *all* sources.
- **Veterancy** — towers earn ranks from kills (★ at 20/60/150), +6% damage per rank.
- **4 commander abilities** (Q/W/E/R) with cooldowns and wave unlocks: Orbital Strike, Chrono Field, Overdrive, Salvage Protocol.
- **Power-up drops** — salvage caches, combat stims, cryo bursts, reactor cores; click to collect, bosses always drop.
- **The Archive** — 10 story fragments recovered as you survive, telling the truth about the Severance War and what the LEVIATHAN is actually carrying. Fragments persist across runs.
- **The Diplomat's Gambit** — a secret second ending. Recover the wave-50 manifest, then spend ⌬4000 on the antique Compact-era receiver. While it listens your towers fire 25% slower, and the next LEVIATHAN becomes the Courier: untargetable, unharmable, hailing on a dead frequency. If you hold your nerve and let it dock, you get THE LONG SIGNAL — the war ends not with a kill screen but with a signature.
- **Service records** — best wave per sector and protocol is saved locally and shown on the sector cards.
- **Procedural audio** — layered synth SFX through a compressor + space-delay bus, and a generative ambient score (chord pads, bass drone, music-box arpeggios). No audio assets; toggle music with ♪.
- **Vector-art renderer** — 3× supersampled sprite canvases, nebula backgrounds, engine flames, recoil, camera shake, damage vignettes, screen tints.

## Balance & the AI Wardens

`npm run sim` plays the full matrix headlessly with three bot skill tiers through the same public API a human uses:

| Bot | Plays like | Tuned outcome |
| --- | --- | --- |
| `rookie` | cheap spam, few upgrades, no counters/abilities | **beats Recruit** with lives to spare; dies ~wave 30 on Veteran |
| `standard` | sensible mix, moderate upgrades, occasional abilities | **beats Veteran**; collapses on Apex's flagship map |
| `expert` | counter-picks immunities, exotics, abilities on cooldown | **clears Apex** on Twin Reactor & Hyperlane |

Apex + Orbital Relay is the one combo beyond even the expert bot — the game's ultimate challenge. Use the sim after any tuning change to keep the tiers honest.

## Generated art

`public/art/` holds AI-generated hero art (menu background, briefing portrait, victory/defeat screens, the LEVIATHAN archive illustration), produced via OpenRouter image models. To regenerate (or add assets — edit the prompt list first):

```powershell
$env:OPENROUTER_API_KEY="sk-or-..."   # also read from .env.local (gitignored)
node scripts/genart.mjs               # all assets, or: node scripts/genart.mjs menu-bg
```

## Controls

| Input | Action |
| --- | --- |
| `1`–`9`, `0` | Select a tower to build |
| Click map | Place tower (Shift-click to keep placing) · collect power-ups |
| Click a tower | Upgrade panel (stats, lore, veterancy, targeting, sell) |
| `Q` `W` `E` `R` | Commander abilities |
| Right-click / `Esc` | Cancel placement / aiming / deselect |
| `Space` | Launch next wave (or pause mid-wave) |
