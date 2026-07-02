# Tower Balance Deep Dive

Generated: 2026-07-02T02:25:53.515Z

Preset: broad
Maps: orbital, reactor, blackout, cinder
Difficulties: normal, hard
Stages: base, a2, b2, a4, b4, split44, a6, b6, a6b4, a4b6
Simulation rows: 1680
Median static AoE per credit: 0.009467

## Headline

No tower crossed the OP threshold in this preset.
Strong/watchlist: Cinder Mortar, Flak Battery, Drone Carrier, Sunspear Battery, Ember Lattice, Tesla Coil, Pulse Turret, Railgun Post, Locust Shrine, Prism Array, Gauss Bastion, Missile Battery.
Weak or support-dependent: Cryo Emitter, EMP Spire, Abyss Gate, Drowned Star Reliquary, Phase Anchor, Vector Lure.

## 2026-07-02 Encounter Tuning Note

Elite variants begin at wave 12 and are capped at one to three authored wave spawns. They deliberately skip bosses, spawned children, and healer hulls, so Shielded and Bulwark cannot stack with Seraph/Lampblack repair auras. Shielded adds a flat shield based on the non-daily scaled HP baseline, Frenzied trades speed for a bounty, Splitting adds two small non-elite children, and Bulwark grants nearby non-boss hulls a single non-stacking damage reduction aura.

The Umbra now has three phases instead of acting as a stat wall. The lattice phase caps per-tick damage and periodically summons bounded Wisp adds; the phase-shift threshold cloaks and repositions the boss while preserving the existing detector/reveal counterplay; the enrage threshold removes cloak and shortens disruption-pulse cadence. Tuning intent is to pressure burst-only and stacked-chokepoint boards without invalidating detector coverage, support placement, or sustained single-target damage.

## Tower Rankings

| Rank | Tower | Verdict | OP score | All win rate | Veteran win rate | Apex win rate | Avg progress | Win cores | Best sim | Best static build | Static AoE/credit | Strengths | Weaknesses |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | --- | --- |
| 1 | Cinder Mortar | strong | 5.145 | 30% | 60% | 0% | 45% | 58% | B4 on Twin Reactor/Veteran | 1/0 | 0.075361 | crowd/AoE scaling; cloak detection option; damage over time | blast-resistant hulls blunt direct hits |
| 2 | Flak Battery | strong | 4.412 | 18% | 35% | 0% | 45% | 67% | Split 4/4 on Twin Reactor/Veteran | 4/4 | 0.037744 | crowd/AoE scaling; cloak detection option | blast-resistant hulls blunt direct hits |
| 3 | Drone Carrier | strong | 4.109 | 8% | 15% | 0% | 42% | 93% | A6+B4 on Twin Reactor/Veteran | 4/4 | 0.061158 | crowd/AoE scaling; cloak detection option | kinetic armor weakness without shred |
| 4 | Sunspear Battery | strong | 2.784 | 1% | 3% | 0% | 17% | 62% | Base on Orbital Relay/Veteran | 4/3 | 0.025081 | crowd/AoE scaling; cloak detection option; armor counterplay; finisher pressure; global range | none obvious |
| 5 | Ember Lattice | strong | 2.234 | 0% | 0% | 0% | 62% | 0% | A6+B4 on Orbital Relay/Veteran | 1/0 | 0.129032 | crowd/AoE scaling; cloak detection option; lane control | none obvious |
| 6 | Tesla Coil | strong | 2.091 | 0% | 0% | 0% | 42% | 0% | Base on Orbital Relay/Veteran | 4/4 | 0.053252 | crowd/AoE scaling; lane control | needs external detection for cloaks |
| 7 | Pulse Turret | strong | 2.071 | 0% | 0% | 0% | 39% | 0% | Base on Orbital Relay/Veteran | 6/4 | 9.013404 | crowd/AoE scaling | needs external detection for cloaks |
| 8 | Railgun Post | strong | 2.068 | 0% | 0% | 0% | 38% | 0% | B2 on Orbital Relay/Veteran | 6/3 | 2.12538 | crowd/AoE scaling; cloak detection option; armor counterplay; finisher pressure; global range | none obvious |
| 9 | Locust Shrine | strong | 1.903 | 0% | 0% | 0% | 15% | 0% | Base on Orbital Relay/Veteran | 1/0 | 0.042373 | crowd/AoE scaling; lane control | needs external detection for cloaks |
| 10 | Prism Array | strong | 1.86 | 0% | 0% | 0% | 9% | 0% | Base on Orbital Relay/Veteran | 4/5 | 0.066163 | crowd/AoE scaling; cloak detection option | late or expensive opening |
| 11 | Gauss Bastion | strong | 1.86 | 0% | 0% | 0% | 9% | 0% | Base on Orbital Relay/Veteran | 6/3 | 1.984455 | crowd/AoE scaling; cloak detection option; armor counterplay; finisher pressure; global range | late or expensive opening |
| 12 | Missile Battery | strong | 1.699 | 0% | 0% | 0% | 33% | 0% | A6+B4 on Cinder Causeway/Veteran | 0/3 | 0.023183 | crowd/AoE scaling; armor counterplay | needs external detection for cloaks; blast-resistant hulls blunt direct hits |
| 13 | Watchfire Beacon | fair | 1.011 | 0% | 0% | 0% | 9% | 0% | Base on Orbital Relay/Veteran | 0/2 | 0.015 | crowd/AoE scaling; cloak detection option; lane control; continuous no-cooldown damage | late or expensive opening |
| 14 | Starlight Cantor | fair | 1.007 | 0% | 0% | 0% | 12% | 0% | A4 on Cinder Causeway/Veteran | 6/4 | 0.014534 | crowd/AoE scaling | needs external detection for cloaks |
| 15 | Harmonic Siphon | fair | 0.726 | 0% | 0% | 0% | 16% | 0% | Base on Twin Reactor/Veteran | 0/0 | 0.00971 | crowd/AoE scaling; cloak detection option; resonance consume combo | needs resonance source for full value |
| 16 | Cryo Emitter | weak | 0.617 | 0% | 0% | 0% | 13% | 0% | B2 on Orbital Relay/Veteran | 0/4 | 0.008282 | crowd/AoE scaling; lane control | needs external detection for cloaks; cryo-immune hulls ignore damage/slow value |
| 17 | EMP Spire | weak | 0.59 | 0% | 0% | 0% | 9% | 0% | Base on Orbital Relay/Veteran | 0/4 | 0.008368 | crowd/AoE scaling; cloak detection option; lane control; buff/support aura | needs external detection for cloaks; kinetic armor weakness without shred; cannot solo without damage dealers |
| 18 | Abyss Gate | weak | 0.568 | 0% | 0% | 0% | 9% | 0% | Base on Orbital Relay/Veteran | 0/4 | 0.008018 | crowd/AoE scaling; cloak detection option; lane control; armor counterplay | late or expensive opening |
| 19 | Drowned Star Reliquary | weak | 0.496 | 0% | 0% | 0% | 9% | 0% | Base on Orbital Relay/Veteran | 4/1 | 0.006873 | crowd/AoE scaling; lane control | needs external detection for cloaks |
| 20 | Phase Anchor | utility/needs-support | 0.06 | 0% | 0% | 0% | 9% | 0% | Base on Orbital Relay/Veteran | 0/0 | 0 | crowd/AoE scaling; cloak detection option; lane control | needs external detection for cloaks; low/no direct damage |
| 21 | Vector Lure | utility/needs-support | 0.06 | 0% | 0% | 0% | 9% | 0% | Base on Orbital Relay/Veteran | 0/0 | 0 | crowd/AoE scaling; lane control; focus-fire target control | needs external detection for cloaks; low/no direct damage; support-dependent damage |

## Best Performing Tower/Stage Sims

| Tower | Stage | Map | Difficulty | Result | Cores | Wave | Leaks | First leak | Worst wave |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| Flak Battery | Split 4/4 | Twin Reactor | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | A6+B4 | Twin Reactor | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | A4+B6 | Twin Reactor | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | Split 4/4 | Cinder Causeway | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | A6+B4 | Cinder Causeway | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | A4+B6 | Cinder Causeway | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Drone Carrier | A6+B4 | Twin Reactor | Veteran | WIN | 95% | 60/60 | 6 | 11 | w11 (5%) |
| Drone Carrier | A4+B6 | Cinder Causeway | Veteran | WIN | 94% | 60/60 | 7 | 11 | w11 (6%) |
| Flak Battery | B6 | Twin Reactor | Veteran | WIN | 93% | 60/60 | 8 | 5 | w5 (7%) |
| Drone Carrier | Split 4/4 | Cinder Causeway | Veteran | WIN | 93% | 60/60 | 8 | 11 | w11 (7%) |
| Drone Carrier | A6+B4 | Cinder Causeway | Veteran | WIN | 93% | 60/60 | 8 | 11 | w11 (7%) |
| Drone Carrier | Split 4/4 | Twin Reactor | Veteran | WIN | 93% | 60/60 | 9 | 11 | w11 (8%) |
| Flak Battery | B4 | Twin Reactor | Veteran | WIN | 92% | 60/60 | 10 | 5 | w5 (8%) |
| Drone Carrier | A4+B6 | Twin Reactor | Veteran | WIN | 90% | 60/60 | 12 | 7 | w11 (8%) |
| Sunspear Battery | Base | Orbital Relay | Veteran | WIN | 62% | 60/60 | 46 | 1 | w2 (16%) |
| Cinder Mortar | B4 | Twin Reactor | Veteran | WIN | 60% | 60/60 | 48 | 1 | w3 (22%) |
| Cinder Mortar | B6 | Twin Reactor | Veteran | WIN | 60% | 60/60 | 48 | 1 | w3 (22%) |
| Cinder Mortar | B2 | Blackout Reach | Veteran | WIN | 60% | 60/60 | 48 | 1 | w3 (22%) |
| Cinder Mortar | B4 | Blackout Reach | Veteran | WIN | 60% | 60/60 | 48 | 1 | w3 (22%) |
| Cinder Mortar | B6 | Blackout Reach | Veteran | WIN | 60% | 60/60 | 48 | 1 | w3 (22%) |
| Cinder Mortar | A6+B4 | Blackout Reach | Veteran | WIN | 60% | 60/60 | 48 | 1 | w3 (22%) |
| Cinder Mortar | B2 | Cinder Causeway | Veteran | WIN | 60% | 60/60 | 48 | 1 | w3 (22%) |
| Cinder Mortar | B4 | Cinder Causeway | Veteran | WIN | 60% | 60/60 | 48 | 1 | w3 (22%) |
| Cinder Mortar | Split 4/4 | Cinder Causeway | Veteran | WIN | 60% | 60/60 | 48 | 1 | w3 (22%) |
| Cinder Mortar | B6 | Cinder Causeway | Veteran | WIN | 60% | 60/60 | 48 | 1 | w3 (22%) |
| Cinder Mortar | A6+B4 | Cinder Causeway | Veteran | WIN | 60% | 60/60 | 48 | 1 | w3 (22%) |
| Cinder Mortar | A4+B6 | Cinder Causeway | Veteran | WIN | 60% | 60/60 | 48 | 1 | w3 (22%) |
| Cinder Mortar | B4 | Orbital Relay | Veteran | WIN | 59% | 60/60 | 49 | 1 | w3 (22%) |
| Cinder Mortar | B6 | Orbital Relay | Veteran | WIN | 59% | 60/60 | 49 | 1 | w3 (22%) |
| Cinder Mortar | Split 4/4 | Blackout Reach | Veteran | WIN | 59% | 60/60 | 49 | 1 | w3 (22%) |

## Per-Tower Notes

### Cinder Mortar

Verdict: strong. OP score 5.145. Best static build 1/0; best sim B4 on Twin Reactor/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, damage over time.

Weaknesses: blast-resistant hulls blunt direct hits.

Notable stages: b2: 50% wins, 54% avg progress, 58% win cores | b4: 50% wins, 54% avg progress, 60% win cores | split44: 50% wins, 54% avg progress, 56% win cores | b6: 50% wins, 54% avg progress, 60% win cores.

### Flak Battery

Verdict: strong. OP score 4.412. Best static build 4/4; best sim Split 4/4 on Twin Reactor/Veteran.

Strengths: crowd/AoE scaling, cloak detection option.

Weaknesses: blast-resistant hulls blunt direct hits.

Notable stages: a4b6: 50% wins, 68% avg progress, 64% win cores | split44: 50% wins, 66% avg progress, 58% win cores | a6b4: 50% wins, 64% avg progress, 68% win cores | b6: 13% wins, 39% avg progress, 93% win cores.

### Drone Carrier

Verdict: strong. OP score 4.109. Best static build 4/4; best sim A6+B4 on Twin Reactor/Veteran.

Strengths: crowd/AoE scaling, cloak detection option.

Weaknesses: kinetic armor weakness without shred.

Notable stages: a4b6: 25% wins, 51% avg progress, 92% win cores | split44: 25% wins, 51% avg progress, 93% win cores | a6b4: 25% wins, 49% avg progress, 94% win cores | a6: 0% wins, 60% avg progress.

### Sunspear Battery

Verdict: strong. OP score 2.784. Best static build 4/3; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, armor counterplay, finisher pressure, global range.

Weaknesses: none obvious.

Notable stages: base: 13% wins, 32% avg progress, 62% win cores | a2: 0% wins, 17% avg progress | a4: 0% wins, 17% avg progress | a6: 0% wins, 16% avg progress.

### Ember Lattice

Verdict: strong. OP score 2.234. Best static build 1/0; best sim A6+B4 on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, lane control.

Weaknesses: none obvious.

Notable stages: a6b4: 0% wins, 78% avg progress | split44: 0% wins, 77% avg progress | a4b6: 0% wins, 76% avg progress | b2: 0% wins, 74% avg progress.

### Tesla Coil

Verdict: strong. OP score 2.091. Best static build 4/4; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, lane control.

Weaknesses: needs external detection for cloaks.

Notable stages: base: 0% wins, 42% avg progress | a2: 0% wins, 42% avg progress | a4: 0% wins, 42% avg progress | split44: 0% wins, 42% avg progress.

### Pulse Turret

Verdict: strong. OP score 2.071. Best static build 6/4; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling.

Weaknesses: needs external detection for cloaks.

Notable stages: base: 0% wins, 42% avg progress | b2: 0% wins, 41% avg progress | b6: 0% wins, 41% avg progress | b4: 0% wins, 40% avg progress.

### Railgun Post

Verdict: strong. OP score 2.068. Best static build 6/3; best sim B2 on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, armor counterplay, finisher pressure, global range.

Weaknesses: none obvious.

Notable stages: b6: 0% wins, 46% avg progress | b4: 0% wins, 45% avg progress | b2: 0% wins, 44% avg progress | base: 0% wins, 41% avg progress.

### Locust Shrine

Verdict: strong. OP score 1.903. Best static build 1/0; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, lane control.

Weaknesses: needs external detection for cloaks.

Notable stages: a2: 0% wins, 15% avg progress | split44: 0% wins, 15% avg progress | a6b4: 0% wins, 15% avg progress | a4b6: 0% wins, 15% avg progress.

### Prism Array

Verdict: strong. OP score 1.86. Best static build 4/5; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option.

Weaknesses: late or expensive opening.

Notable stages: base: 0% wins, 9% avg progress | a2: 0% wins, 9% avg progress | b2: 0% wins, 9% avg progress | a4: 0% wins, 9% avg progress.

### Gauss Bastion

Verdict: strong. OP score 1.86. Best static build 6/3; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, armor counterplay, finisher pressure, global range.

Weaknesses: late or expensive opening.

Notable stages: base: 0% wins, 9% avg progress | a2: 0% wins, 9% avg progress | b2: 0% wins, 9% avg progress | a4: 0% wins, 9% avg progress.

### Missile Battery

Verdict: strong. OP score 1.699. Best static build 0/3; best sim A6+B4 on Cinder Causeway/Veteran.

Strengths: crowd/AoE scaling, armor counterplay.

Weaknesses: needs external detection for cloaks, blast-resistant hulls blunt direct hits.

Notable stages: a4: 0% wins, 40% avg progress | a6b4: 0% wins, 38% avg progress | a2: 0% wins, 38% avg progress | a6: 0% wins, 37% avg progress.

### Watchfire Beacon

Verdict: fair. OP score 1.011. Best static build 0/2; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, lane control, continuous no-cooldown damage.

Weaknesses: late or expensive opening.

Notable stages: base: 0% wins, 9% avg progress | a2: 0% wins, 9% avg progress | b2: 0% wins, 9% avg progress | a4: 0% wins, 9% avg progress.

### Starlight Cantor

Verdict: fair. OP score 1.007. Best static build 6/4; best sim A4 on Cinder Causeway/Veteran.

Strengths: crowd/AoE scaling.

Weaknesses: needs external detection for cloaks.

Notable stages: a4: 0% wins, 13% avg progress | a6: 0% wins, 13% avg progress | a2: 0% wins, 12% avg progress | b2: 0% wins, 12% avg progress.

### Harmonic Siphon

Verdict: fair. OP score 0.726. Best static build 0/0; best sim Base on Twin Reactor/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, resonance consume combo.

Weaknesses: needs resonance source for full value.

Notable stages: base: 0% wins, 23% avg progress | a2: 0% wins, 16% avg progress | a6: 0% wins, 16% avg progress | a4: 0% wins, 16% avg progress.

### Cryo Emitter

Verdict: weak. OP score 0.617. Best static build 0/4; best sim B2 on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, lane control.

Weaknesses: needs external detection for cloaks, cryo-immune hulls ignore damage/slow value.

Notable stages: b4: 0% wins, 24% avg progress | b6: 0% wins, 24% avg progress | b2: 0% wins, 23% avg progress | base: 0% wins, 9% avg progress.

### EMP Spire

Verdict: weak. OP score 0.59. Best static build 0/4; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, lane control, buff/support aura.

Weaknesses: needs external detection for cloaks, kinetic armor weakness without shred, cannot solo without damage dealers.

Notable stages: base: 0% wins, 9% avg progress | a2: 0% wins, 9% avg progress | b2: 0% wins, 9% avg progress | a4: 0% wins, 9% avg progress.

### Abyss Gate

Verdict: weak. OP score 0.568. Best static build 0/4; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, lane control, armor counterplay.

Weaknesses: late or expensive opening.

Notable stages: base: 0% wins, 9% avg progress | a2: 0% wins, 9% avg progress | b2: 0% wins, 9% avg progress | a4: 0% wins, 9% avg progress.

### Drowned Star Reliquary

Verdict: weak. OP score 0.496. Best static build 4/1; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, lane control.

Weaknesses: needs external detection for cloaks.

Notable stages: base: 0% wins, 9% avg progress | a2: 0% wins, 9% avg progress | b2: 0% wins, 9% avg progress | a4: 0% wins, 9% avg progress.

### Phase Anchor

Verdict: utility/needs-support. OP score 0.06. Best static build 0/0; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, lane control.

Weaknesses: needs external detection for cloaks, low/no direct damage.

Notable stages: base: 0% wins, 9% avg progress | a2: 0% wins, 9% avg progress | b2: 0% wins, 9% avg progress | a4: 0% wins, 9% avg progress.

### Vector Lure

Verdict: utility/needs-support. OP score 0.06. Best static build 0/0; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, lane control, focus-fire target control.

Weaknesses: needs external detection for cloaks, low/no direct damage, support-dependent damage.

Notable stages: base: 0% wins, 9% avg progress | a2: 0% wins, 9% avg progress | b2: 0% wins, 9% avg progress | a4: 0% wins, 9% avg progress.

