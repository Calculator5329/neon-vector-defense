// AI Warden bot — plays via the public Game API at three skill tiers.
import { Game, W, H } from './engine';
import { TOWER_MAP } from './towers';
import type { Tower, Vec } from './types';

export type BotSkill = 'rookie' | 'standard' | 'expert';

interface PlanStep { tower: string; a: number; b: number }
interface Profile {
  actInterval: number;
  plan: PlanStep[];
  filler: PlanStep;
  upgradeDiligence: number;
  abilityChance: number;
  reserve: number;
}

const PROFILES: Record<BotSkill, Profile> = {
  rookie: {
    actInterval: 2.5,
    plan: [
      { tower: 'pulse', a: 0, b: 0 }, { tower: 'pulse', a: 1, b: 0 }, { tower: 'tesla', a: 0, b: 0 },
      { tower: 'pulse', a: 0, b: 0 }, { tower: 'missile', a: 1, b: 0 }, { tower: 'tesla', a: 1, b: 0 },
      { tower: 'pulse', a: 2, b: 0 }, { tower: 'missile', a: 0, b: 0 }, { tower: 'pulse', a: 1, b: 0 },
      { tower: 'tesla', a: 2, b: 0 }, { tower: 'rail', a: 1, b: 0 },
    ],
    filler: { tower: 'pulse', a: 2, b: 0 },
    upgradeDiligence: 0.4,
    abilityChance: 0,
    reserve: 1.0,
  },
  standard: {
    actInterval: 1.2,
    plan: [
      { tower: 'pulse', a: 1, b: 1 }, { tower: 'pulse', a: 2, b: 0 }, { tower: 'tesla', a: 2, b: 0 },
      { tower: 'cryo', a: 1, b: 0 }, { tower: 'rail', a: 2, b: 0 },
      { tower: 'missile', a: 2, b: 0 }, { tower: 'emp', a: 1, b: 0 },
      { tower: 'tesla', a: 4, b: 0 }, { tower: 'drone', a: 2, b: 0 }, { tower: 'rail', a: 3, b: 0 },
      { tower: 'cryo', a: 3, b: 0 }, { tower: 'missile', a: 3, b: 1 },
    ],
    filler: { tower: 'drone', a: 2, b: 0 },
    upgradeDiligence: 0.6,
    abilityChance: 0.3,
    reserve: 1.15,
  },
  expert: {
    actInterval: 0.5,
    plan: [
      { tower: 'pulse', a: 2, b: 2 }, { tower: 'tesla', a: 2, b: 0 }, { tower: 'pulse', a: 2, b: 2 },
      { tower: 'tesla', a: 3, b: 0 },
      { tower: 'cryo', a: 2, b: 0 }, { tower: 'rail', a: 2, b: 0 },
      { tower: 'tesla', a: 4, b: 2 },
      { tower: 'emp', a: 2, b: 0 },
      { tower: 'cantor', a: 2, b: 0 },
      { tower: 'missile', a: 3, b: 0 }, { tower: 'rail', a: 4, b: 2 },
      { tower: 'anchor', a: 2, b: 0 }, { tower: 'prismarr', a: 4, b: 2 },
      { tower: 'cryo', a: 4, b: 0 }, { tower: 'cantor', a: 4, b: 4 },
      { tower: 'prismarr', a: 6, b: 4 }, { tower: 'anchor', a: 6, b: 2 }, { tower: 'emp', a: 6, b: 0 },
    ],
    filler: { tower: 'prismarr', a: 6, b: 4 },
    upgradeDiligence: 1.0,
    abilityChance: 1.0,
    reserve: 1.0,
  },
};

export class Bot {
  private game: Game;
  private profile: Profile;
  private spots: Vec[] = [];
  private nextAct = 0;
  private planIdx = 0;
  private placed: { tower: Tower; a: number; b: number }[] = [];

  constructor(game: Game, skill: BotSkill) {
    this.game = game;
    this.profile = PROFILES[skill];
    this.computeSpots();
  }

  private computeSpots() {
    const g = this.game;
    const samples: Vec[] = [];
    const path = g.map.path;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.floor(len / 14));
      for (let k = 0; k <= n; k++) {
        samples.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
      }
    }
    const scored: { p: Vec; score: number }[] = [];
    for (let x = 40; x < W - 40; x += 28) {
      for (let y = 40; y < H - 40; y += 28) {
        const p = { x, y };
        if (!g.canPlace(p)) continue;
        let score = 0;
        for (const s of samples) if (Math.hypot(s.x - p.x, s.y - p.y) < 115) score++;
        score *= g.rangeFactor(p) === 1 ? 1 : 0.35; // Blackout Reach: build in the light
        if (score > 0) scored.push({ p, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    this.spots = scored.map((s) => s.p);
  }

  private step(): PlanStep {
    return this.planIdx < this.profile.plan.length ? this.profile.plan[this.planIdx] : this.profile.filler;
  }

  act(now: number) {
    if (now < this.nextAct) return;
    this.nextAct = now + this.profile.actInterval;
    const g = this.game;

    // 1. build toward the plan
    const step = this.step();
    const def = TOWER_MAP[step.tower];
    if (def && g.credits >= g.cost(def) * this.profile.reserve) {
      const spot = this.spots.find((p) => g.canPlace(p));
      if (spot) {
        const t = g.placeTower(def, spot);
        if (t) {
          this.placed.push({ tower: t, a: step.a, b: step.b });
          this.planIdx++;
        }
      }
    }

    // 2. upgrades toward each tower's track targets
    if (Math.random() < this.profile.upgradeDiligence) {
      for (const rec of this.placed) {
        const t = rec.tower;
        if (!g.towers.includes(t)) continue;
        if (t.tierA < rec.a && g.upgradeState(t, 0) === 'ok' && g.credits >= g.upgradeCost(t, 0)) {
          g.upgradeTower(t, 0);
          break;
        }
        if (t.tierB < rec.b && g.upgradeState(t, 1) === 'ok' && g.credits >= g.upgradeCost(t, 1)) {
          g.upgradeTower(t, 1);
          break;
        }
      }
    }

    // 3. abilities
    if (Math.random() < this.profile.abilityChance) {
      const count = g.enemies.length;
      const boss = g.enemies.find((e) => e.def.boss && !e.courier);
      if (g.abilityReady('salvage')) g.castAbility('salvage');
      if (boss && g.abilityReady('strike')) g.castAbility('strike', { ...boss.pos });
      else if (count >= 26 && g.abilityReady('strike')) {
        const lead = g.enemies.reduce((a, b) => (a.dist > b.dist ? a : b));
        g.castAbility('strike', { ...lead.pos });
      }
      if (count >= 20 && g.abilityReady('chrono')) g.castAbility('chrono');
      if ((boss || count >= 24) && g.abilityReady('overdrive')) g.castAbility('overdrive');
      if (g.enemies.filter((e) => e.resonance > 0).length >= 8 && g.abilityReady('cascade')) g.castAbility('cascade');
      if (g.lives < 30 && g.abilityReady('mirror')) g.castAbility('mirror');
    }

    // 4. late-game money sink: once the plan is built out, dump surplus into Grid Overcharge
    if (this.planIdx >= this.profile.plan.length && g.credits > g.overchargeCost() * 1.5) {
      g.buyOvercharge();
    }
  }
}
