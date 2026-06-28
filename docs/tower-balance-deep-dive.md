# Tower Balance Deep Dive

Generated: 2026-06-27T20:45:08.837Z

Preset: broad
Maps: orbital, reactor, blackout, cinder
Difficulties: normal, hard
Stages: base, a2, b2, a4, b4, split44, a6, b6, a6b4, a4b6
Simulation rows: 1520
Median static AoE per credit: 0.011617

## Headline

Likely OP: Cinder Mortar (OP, score 6.449), Flak Battery (OP, score 5.907).
Strong/watchlist: Drone Carrier, Ember Lattice, Tesla Coil, Pulse Turret, Railgun Post, Locust Shrine, Prism Array, Gauss Bastion.
Weak or support-dependent: Cryo Emitter, EMP Spire, Abyss Gate, Drowned Star Reliquary, Phase Anchor.

## Tower Rankings

| Rank | Tower | Verdict | OP score | All win rate | Veteran win rate | Apex win rate | Avg progress | Win cores | Best sim | Best static build | Static AoE/credit | Strengths | Weaknesses |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | --- | --- |
| 1 | Cinder Mortar | OP | 6.449 | 39% | 60% | 18% | 80% | 91% | B2 on Orbital Relay/Veteran | 1/0 | 0.107043 | crowd/AoE scaling; cloak detection option; damage over time | blast-resistant hulls blunt direct hits |
| 2 | Flak Battery | OP | 5.907 | 29% | 57% | 0% | 71% | 100% | B2 on Orbital Relay/Veteran | 4/4 | 0.100986 | crowd/AoE scaling; cloak detection option | blast-resistant hulls blunt direct hits |
| 3 | Drone Carrier | strong | 4.095 | 8% | 15% | 0% | 41% | 93% | Split 4/4 on Twin Reactor/Veteran | 4/4 | 0.061158 | crowd/AoE scaling; cloak detection option | kinetic armor weakness without shred |
| 4 | Ember Lattice | strong | 3.92 | 1% | 3% | 0% | 62% | 100% | A6+B4 on Orbital Relay/Veteran | 1/0 | 0.129032 | crowd/AoE scaling; cloak detection option; lane control | none obvious |
| 5 | Sunspear Battery | fair | 2.345 | 3% | 5% | 0% | 17% | 47% | Base on Orbital Relay/Veteran | 4/3 | 0.025081 | crowd/AoE scaling; cloak detection option; armor counterplay; finisher pressure; global range | none obvious |
| 6 | Tesla Coil | strong | 2.09 | 0% | 0% | 0% | 41% | 0% | Base on Orbital Relay/Veteran | 4/4 | 0.053252 | crowd/AoE scaling; lane control | needs external detection for cloaks |
| 7 | Pulse Turret | strong | 2.071 | 0% | 0% | 0% | 39% | 0% | Base on Orbital Relay/Veteran | 6/4 | 9.013404 | crowd/AoE scaling | needs external detection for cloaks |
| 8 | Railgun Post | strong | 2.069 | 0% | 0% | 0% | 38% | 0% | B6 on Orbital Relay/Veteran | 6/3 | 2.12538 | crowd/AoE scaling; cloak detection option; armor counterplay; finisher pressure; global range | none obvious |
| 9 | Locust Shrine | strong | 1.903 | 0% | 0% | 0% | 15% | 0% | Base on Orbital Relay/Veteran | 1/0 | 0.042373 | crowd/AoE scaling; lane control | needs external detection for cloaks |
| 10 | Prism Array | strong | 1.86 | 0% | 0% | 0% | 9% | 0% | Base on Orbital Relay/Veteran | 4/5 | 0.066163 | crowd/AoE scaling; cloak detection option | late or expensive opening |
| 11 | Gauss Bastion | strong | 1.86 | 0% | 0% | 0% | 9% | 0% | Base on Orbital Relay/Veteran | 6/3 | 1.984455 | crowd/AoE scaling; cloak detection option; armor counterplay; finisher pressure; global range | late or expensive opening |
| 12 | Missile Battery | fair | 1.424 | 0% | 0% | 0% | 32% | 0% | A4+B6 on Twin Reactor/Veteran | 0/3 | 0.023183 | crowd/AoE scaling; armor counterplay | needs external detection for cloaks; blast-resistant hulls blunt direct hits |
| 13 | Watchfire Beacon | fair | 0.835 | 0% | 0% | 0% | 9% | 0% | Base on Orbital Relay/Veteran | 0/2 | 0.015 | crowd/AoE scaling; cloak detection option; lane control; continuous no-cooldown damage | late or expensive opening |
| 14 | Starlight Cantor | fair | 0.834 | 0% | 0% | 0% | 12% | 0% | A4 on Twin Reactor/Veteran | 6/4 | 0.014534 | crowd/AoE scaling | needs external detection for cloaks |
| 15 | Cryo Emitter | weak | 0.519 | 0% | 0% | 0% | 13% | 0% | B6 on Cinder Causeway/Veteran | 0/4 | 0.008282 | crowd/AoE scaling; lane control | needs external detection for cloaks; cryo-immune hulls ignore damage/slow value |
| 16 | EMP Spire | weak | 0.492 | 0% | 0% | 0% | 9% | 0% | Base on Orbital Relay/Veteran | 0/4 | 0.008368 | crowd/AoE scaling; cloak detection option; lane control; buff/support aura | needs external detection for cloaks; kinetic armor weakness without shred; cannot solo without damage dealers |
| 17 | Abyss Gate | weak | 0.359 | 0% | 0% | 0% | 9% | 0% | Base on Orbital Relay/Veteran | 0/4 | 0.005789 | crowd/AoE scaling; cloak detection option; lane control; armor counterplay | late or expensive opening |
| 18 | Drowned Star Reliquary | weak | 0.196 | 0% | 0% | 0% | 9% | 0% | Base on Orbital Relay/Veteran | 1/1 | 0.00264 | crowd/AoE scaling; lane control | needs external detection for cloaks; late or expensive opening |
| 19 | Phase Anchor | utility/needs-support | 0.06 | 0% | 0% | 0% | 9% | 0% | Base on Orbital Relay/Veteran | 0/0 | 0 | crowd/AoE scaling; cloak detection option; lane control | needs external detection for cloaks; low/no direct damage |

## Best Performing Tower/Stage Sims

| Tower | Stage | Map | Difficulty | Result | Cores | Wave | Leaks | First leak | Worst wave |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| Ember Lattice | A6+B4 | Orbital Relay | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | B2 | Orbital Relay | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | B4 | Orbital Relay | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | Split 4/4 | Orbital Relay | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | B6 | Orbital Relay | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | A6+B4 | Orbital Relay | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | A4+B6 | Orbital Relay | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Cinder Mortar | B2 | Orbital Relay | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Cinder Mortar | B4 | Orbital Relay | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Cinder Mortar | Split 4/4 | Orbital Relay | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Cinder Mortar | B6 | Orbital Relay | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Cinder Mortar | A6+B4 | Orbital Relay | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Cinder Mortar | A4+B6 | Orbital Relay | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | B2 | Twin Reactor | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | B4 | Twin Reactor | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | Split 4/4 | Twin Reactor | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | B6 | Twin Reactor | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | A6+B4 | Twin Reactor | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | A4+B6 | Twin Reactor | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Cinder Mortar | B2 | Twin Reactor | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Cinder Mortar | B4 | Twin Reactor | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Cinder Mortar | Split 4/4 | Twin Reactor | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Cinder Mortar | B6 | Twin Reactor | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Cinder Mortar | A6+B4 | Twin Reactor | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Cinder Mortar | A4+B6 | Twin Reactor | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | B4 | Blackout Reach | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | Split 4/4 | Blackout Reach | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | B6 | Blackout Reach | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | A6+B4 | Blackout Reach | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |
| Flak Battery | A4+B6 | Blackout Reach | Veteran | WIN | 100% | 60/60 | 0 |  | w1 (0%) |

## Per-Tower Notes

### Cinder Mortar

Verdict: OP. OP score 6.449. Best static build 1/0; best sim B2 on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, damage over time.

Weaknesses: blast-resistant hulls blunt direct hits.

Notable stages: a4b6: 88% wins, 100% avg progress, 83% win cores | split44: 75% wins, 100% avg progress, 88% win cores | a6b4: 75% wins, 100% avg progress, 88% win cores | b6: 50% wins, 100% avg progress, 100% win cores.

### Flak Battery

Verdict: OP. OP score 5.907. Best static build 4/4; best sim B2 on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option.

Weaknesses: blast-resistant hulls blunt direct hits.

Notable stages: a6b4: 50% wins, 97% avg progress, 100% win cores | a4b6: 50% wins, 97% avg progress, 100% win cores | split44: 50% wins, 96% avg progress, 100% win cores | b4: 50% wins, 89% avg progress, 100% win cores.

### Drone Carrier

Verdict: strong. OP score 4.095. Best static build 4/4; best sim Split 4/4 on Twin Reactor/Veteran.

Strengths: crowd/AoE scaling, cloak detection option.

Weaknesses: kinetic armor weakness without shred.

Notable stages: split44: 25% wins, 51% avg progress, 94% win cores | a4b6: 25% wins, 50% avg progress, 91% win cores | a6b4: 25% wins, 45% avg progress, 93% win cores | a4: 0% wins, 59% avg progress.

### Ember Lattice

Verdict: strong. OP score 3.92. Best static build 1/0; best sim A6+B4 on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, lane control.

Weaknesses: none obvious.

Notable stages: a6b4: 13% wins, 79% avg progress, 100% win cores | split44: 0% wins, 77% avg progress | a4b6: 0% wins, 75% avg progress | b6: 0% wins, 74% avg progress.

### Sunspear Battery

Verdict: fair. OP score 2.345. Best static build 4/3; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, armor counterplay, finisher pressure, global range.

Weaknesses: none obvious.

Notable stages: base: 25% wins, 34% avg progress, 47% win cores | a6: 0% wins, 16% avg progress | a2: 0% wins, 16% avg progress | a4: 0% wins, 16% avg progress.

### Tesla Coil

Verdict: strong. OP score 2.09. Best static build 4/4; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, lane control.

Weaknesses: needs external detection for cloaks.

Notable stages: base: 0% wins, 42% avg progress | a2: 0% wins, 42% avg progress | a4: 0% wins, 42% avg progress | split44: 0% wins, 42% avg progress.

### Pulse Turret

Verdict: strong. OP score 2.071. Best static build 6/4; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling.

Weaknesses: needs external detection for cloaks.

Notable stages: base: 0% wins, 42% avg progress | b4: 0% wins, 41% avg progress | b6: 0% wins, 40% avg progress | b2: 0% wins, 40% avg progress.

### Railgun Post

Verdict: strong. OP score 2.069. Best static build 6/3; best sim B6 on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, armor counterplay, finisher pressure, global range.

Weaknesses: none obvious.

Notable stages: b2: 0% wins, 45% avg progress | b4: 0% wins, 45% avg progress | b6: 0% wins, 45% avg progress | base: 0% wins, 41% avg progress.

### Locust Shrine

Verdict: strong. OP score 1.903. Best static build 1/0; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, lane control.

Weaknesses: needs external detection for cloaks.

Notable stages: split44: 0% wins, 15% avg progress | a4b6: 0% wins, 15% avg progress | a6b4: 0% wins, 15% avg progress | a4: 0% wins, 15% avg progress.

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

Verdict: fair. OP score 1.424. Best static build 0/3; best sim A4+B6 on Twin Reactor/Veteran.

Strengths: crowd/AoE scaling, armor counterplay.

Weaknesses: needs external detection for cloaks, blast-resistant hulls blunt direct hits.

Notable stages: a2: 0% wins, 40% avg progress | a6: 0% wins, 39% avg progress | a4b6: 0% wins, 37% avg progress | a4: 0% wins, 37% avg progress.

### Watchfire Beacon

Verdict: fair. OP score 0.835. Best static build 0/2; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, lane control, continuous no-cooldown damage.

Weaknesses: late or expensive opening.

Notable stages: base: 0% wins, 9% avg progress | a2: 0% wins, 9% avg progress | b2: 0% wins, 9% avg progress | a4: 0% wins, 9% avg progress.

### Starlight Cantor

Verdict: fair. OP score 0.834. Best static build 6/4; best sim A4 on Twin Reactor/Veteran.

Strengths: crowd/AoE scaling.

Weaknesses: needs external detection for cloaks.

Notable stages: a4: 0% wins, 13% avg progress | a6: 0% wins, 13% avg progress | a2: 0% wins, 12% avg progress | b2: 0% wins, 12% avg progress.

### Cryo Emitter

Verdict: weak. OP score 0.519. Best static build 0/4; best sim B6 on Cinder Causeway/Veteran.

Strengths: crowd/AoE scaling, lane control.

Weaknesses: needs external detection for cloaks, cryo-immune hulls ignore damage/slow value.

Notable stages: b4: 0% wins, 24% avg progress | b2: 0% wins, 23% avg progress | b6: 0% wins, 23% avg progress | base: 0% wins, 9% avg progress.

### EMP Spire

Verdict: weak. OP score 0.492. Best static build 0/4; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, lane control, buff/support aura.

Weaknesses: needs external detection for cloaks, kinetic armor weakness without shred, cannot solo without damage dealers.

Notable stages: base: 0% wins, 9% avg progress | a2: 0% wins, 9% avg progress | b2: 0% wins, 9% avg progress | a4: 0% wins, 9% avg progress.

### Abyss Gate

Verdict: weak. OP score 0.359. Best static build 0/4; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, lane control, armor counterplay.

Weaknesses: late or expensive opening.

Notable stages: base: 0% wins, 9% avg progress | a2: 0% wins, 9% avg progress | b2: 0% wins, 9% avg progress | a4: 0% wins, 9% avg progress.

### Drowned Star Reliquary

Verdict: weak. OP score 0.196. Best static build 1/1; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, lane control.

Weaknesses: needs external detection for cloaks, late or expensive opening.

Notable stages: base: 0% wins, 9% avg progress | a2: 0% wins, 9% avg progress | b2: 0% wins, 9% avg progress | a4: 0% wins, 9% avg progress.

### Phase Anchor

Verdict: utility/needs-support. OP score 0.06. Best static build 0/0; best sim Base on Orbital Relay/Veteran.

Strengths: crowd/AoE scaling, cloak detection option, lane control.

Weaknesses: needs external detection for cloaks, low/no direct damage.

Notable stages: base: 0% wins, 9% avg progress | a2: 0% wins, 9% avg progress | b2: 0% wins, 9% avg progress | a4: 0% wins, 9% avg progress.

