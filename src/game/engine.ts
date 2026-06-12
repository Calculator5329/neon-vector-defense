import type {
  AbilityId, AbilityState, Beam, DifficultyDef, Enemy, EnemyDef, GameMap,
  Particle, Pickup, PickupKind, Projectile, TargetMode, Tower, TowerDef, Vec, WaveGroup,
} from './types';
import { ENEMIES, rbe } from './enemies';
import { ABILITIES } from './abilities';
import { ARCHIVE } from './lore';
import { progress } from './storage';
import { computeStats, sellValue, TOWER_MAP } from './towers';
import { getWave, waveBonus, waveHpMult } from './waves';
import { sfx, vox, playStinger } from './sound';
import { TOWERS } from './towers';

export const W = 1280;
export const H = 720;
const TOWER_R = 16;

let uidCounter = 1;

interface SpawnEntry {
  group: WaveGroup;
  spawned: number;
  timer: number;
  started: boolean;
}

export type Phase = 'build' | 'wave' | 'gameover' | 'victory' | 'armistice';

export const RECEIVER_COST = 4000;
/** index of the Archive fragment that reveals the LEVIATHAN's cargo */
export const RECEIVER_FRAGMENT = ARCHIVE.findIndex((f) => f.wave === 50);

export class Game {
  map: GameMap;
  diff: DifficultyDef;
  credits: number;
  lives: number;
  wave = 0; // last completed/current wave number
  phase: Phase = 'build';
  speed = 1;
  paused = false;
  autoNext = false;

  enemies: Enemy[] = [];
  towers: Tower[] = [];
  projectiles: Projectile[] = [];
  particles: Particle[] = [];
  beams: Beam[] = [];
  pickups: Pickup[] = [];
  novas: { pos: Vec; r: number; maxR: number; damage: number; slowPower: number; slowDuration: number; color: string; hit: Set<number>; src: Tower }[] = [];
  abilities: AbilityState[] = ABILITIES.map((def) => ({ def, cd: 0 }));
  /** Mirror Protocol: while >0, leaked hulls are thrown back to the entrance */
  mirrorTimer = 0;
  /** Long Watch: friendly Combine escorts patrolling the lane in reverse */
  allies: { dist: number; pos: Vec; heading: number; cd: number }[] = [];
  private allyTimer = 12;

  /** global effect timers */
  chronoTimer = 0;
  overdriveTimer = 0;
  frenzyTimer = 0;
  /** camera shake intensity 0..1, decays */
  shake = 0;
  /** red vignette flash on core loss, decays */
  hurtFlash = 0;
  /** transient HUD announcement */
  notice = '';
  noticeTimer = 0;
  /** indices into ARCHIVE recovered so far (seeded from persistent progress) */
  archive: number[] = [...progress.archive];
  /** set when a new fragment unlocks, cleared by the UI */
  newArchive = false;
  /** the Diplomat's Gambit: antique receiver built this run */
  receiver = false;
  private courierActive = false;
  private lowCoreWarned = false;

  /** per-run telemetry for the after-action report */
  runStats = {
    dmg: {} as Record<string, number>,
    kills: {} as Record<string, number>,
    leaks: 0,
    abilitiesCast: 0,
  };

  /** Apex only: the Combine studies your fire and armors against your favorite damage type */
  adaptation: { type: import('./types').DamageType | null; resist: number } = { type: null, resist: 0 };
  private dmgWindow: Record<string, number> = {};

  private queue: SpawnEntry[] = [];
  private segLengths: number[] = [];
  totalKills = 0;
  time = 0;
  /** set when player chooses to continue past victory */
  freeplay = false;

  constructor(map: GameMap, diff: DifficultyDef) {
    this.map = map;
    this.diff = diff;
    this.credits = diff.cash;
    this.lives = diff.lives;
    for (let i = 1; i < map.path.length; i++) {
      const a = map.path[i - 1], b = map.path[i];
      this.segLengths.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
  }

  cost(def: TowerDef): number {
    return Math.round((def.cost * this.diff.costMult) / 5) * 5;
  }

  /** Blackout Reach: towers outside every beacon zone lose 35% range */
  rangeFactor(pos: Vec): number {
    if (!this.map.zones) return 1;
    return this.map.zones.some((z) => Math.hypot(pos.x - z.x, pos.y - z.y) <= z.r) ? 1 : 0.65;
  }

  tierOf(t: Tower, track: 0 | 1): number {
    return track === 0 ? t.tierA : t.tierB;
  }

  /** null = maxed; otherwise why-locked reason or 'ok' */
  upgradeState(t: Tower, track: 0 | 1): 'ok' | 'maxed' | 'locked' {
    const tier = this.tierOf(t, track);
    if (tier >= 6) return 'maxed';
    if (tier >= 4 && t.committed !== null && t.committed !== track) return 'locked';
    return 'ok';
  }

  upgradeCost(t: Tower, track: 0 | 1): number {
    const tier = this.tierOf(t, track);
    if (tier >= 6) return 0;
    return Math.round((t.def.tracks[track].upgrades[tier].cost * this.diff.costMult) / 5) * 5;
  }

  // ---------- placement ----------

  canPlace(pos: Vec): boolean {
    if (pos.x < TOWER_R || pos.y < TOWER_R || pos.x > W - TOWER_R || pos.y > H - TOWER_R) return false;
    const clearance = this.map.pathWidth / 2 + TOWER_R - 4;
    for (let i = 1; i < this.map.path.length; i++) {
      if (distToSeg(pos, this.map.path[i - 1], this.map.path[i]) < clearance) return false;
    }
    for (const b of this.map.blockers) {
      if (b.r > 0 && Math.hypot(pos.x - b.x, pos.y - b.y) < b.r + TOWER_R - 4) return false;
    }
    for (const t of this.towers) {
      if (Math.hypot(pos.x - t.pos.x, pos.y - t.pos.y) < TOWER_R * 2 - 2) return false;
    }
    return true;
  }

  placeTower(def: TowerDef, pos: Vec): Tower | null {
    const cost = this.cost(def);
    if (this.credits < cost || !this.canPlace(pos)) {
      sfx.error();
      return null;
    }
    this.credits -= cost;
    const t: Tower = {
      uid: uidCounter++,
      def,
      pos: { ...pos },
      stats: computeStats(def, 0, 0),
      tierA: 0,
      tierB: 0,
      committed: null,
      cooldown: 0,
      angle: -Math.PI / 2,
      target: 'first',
      invested: cost,
      kills: 0,
      rateBuff: 1,
      rangeBuff: 1,
      flash: 0,
      recoil: 0,
    };
    this.towers.push(t);
    sfx.build();
    this.ring(pos, def.glow, 30);
    return t;
  }

  upgradeTower(t: Tower, track: 0 | 1): boolean {
    const cost = this.upgradeCost(t, track);
    if (cost === 0 || this.credits < cost || this.upgradeState(t, track) !== 'ok') {
      sfx.error();
      return false;
    }
    this.credits -= cost;
    t.invested += cost;
    if (track === 0) t.tierA++; else t.tierB++;
    // buying a bonus tier (5+) commits the tower to that track
    if (this.tierOf(t, track) >= 5) t.committed = track;
    t.stats = computeStats(t.def, t.tierA, t.tierB);
    sfx.upgrade();
    this.ring(t.pos, '#ffffff', 26);
    return true;
  }

  /** Save the current defense layout (positions + tiers) as this map's blueprint. */
  saveBlueprint(): number {
    const bp = this.towers.map((t) => ({
      id: t.def.id,
      x: Math.round(t.pos.x),
      y: Math.round(t.pos.y),
      a: t.tierA,
      b: t.tierB,
    }));
    progress.saveBlueprint(this.map.id, bp);
    this.announce(`⬇ Defense layout saved — ${bp.length} instruments`);
    sfx.archive();
    return bp.length;
  }

  /** Rebuild the saved blueprint, placing and upgrading as far as credits allow. */
  applyBlueprint(): number {
    const bp = progress.blueprint(this.map.id);
    let placed = 0;
    for (const e of bp) {
      const def = TOWER_MAP[e.id];
      if (!def || def.unlockAt > progress.totalWaves) continue;
      const pos = { x: e.x, y: e.y };
      if (this.credits < this.cost(def) || !this.canPlace(pos)) continue;
      const t = this.placeTower(def, pos);
      if (!t) continue;
      placed++;
      // re-buy upgrades in saved order: track A first, then B (commit rules apply naturally)
      while (t.tierA < e.a && this.upgradeState(t, 0) === 'ok' && this.credits >= this.upgradeCost(t, 0)) {
        if (!this.upgradeTower(t, 0)) break;
      }
      while (t.tierB < e.b && this.upgradeState(t, 1) === 'ok' && this.credits >= this.upgradeCost(t, 1)) {
        if (!this.upgradeTower(t, 1)) break;
      }
    }
    this.announce(placed > 0
      ? `⬆ Blueprint deployed — ${placed} of ${bp.length} instruments rebuilt`
      : '⬆ Blueprint deployment failed — no credits, space, or unlocks');
    return placed;
  }

  sellTower(t: Tower) {
    this.credits += sellValue(t.invested);
    this.towers = this.towers.filter((x) => x !== t);
    sfx.sell();
    this.ring(t.pos, '#ffd32a', 24);
  }

  // ---------- waves ----------

  startWave() {
    if (this.phase !== 'build') return;
    this.wave++;
    this.phase = 'wave';
    const def = getWave(this.wave);
    // Recruit protocol: the Combine never deploys phase-cloaks against a green Warden
    const allowCloak = this.diff.id !== 'easy';
    this.queue = def.map((group) => ({
      group: allowCloak ? group : { ...group, cloaked: false },
      spawned: 0,
      timer: group.delay ?? 0,
      started: false,
    }));
    sfx.waveStart();
    // threat advisories
    if (def.some((g) => g.type === 'leviathan')) { this.announce('⚠ LEVIATHAN-CLASS SIGNATURE DETECTED'); vox('wave-leviathan'); }
    else if (def.some((g) => g.type === 'titan')) { this.announce('⚠ TITAN-class carrier inbound'); vox('wave-boss'); }
    else if (allowCloak && def.some((g) => g.cloaked)) { this.announce('⚠ Phase-cloaked signatures — sensor coverage advised'); vox('wave-cloaked'); }
    for (const a of this.abilities) {
      if (a.def.unlockWave === this.wave) this.announce(`✦ Commander ability online: ${a.def.name}`);
    }
  }

  announce(text: string) {
    this.notice = text;
    this.noticeTimer = 4;
  }

  private makeEnemy(typeId: string, cloaked: boolean): Enemy {
    const def = ENEMIES[typeId];
    // difficulty hp scaling ramps in over the first 25 waves so the early game
    // stays fair while the late game bites
    const ramp = Math.min(1, this.wave / 25);
    const diffMult = 1 + (this.diff.hpMult - 1) * ramp;
    const hp = Math.ceil(def.hp * waveHpMult(this.wave) * diffMult);
    return {
      uid: uidCounter++,
      def,
      hp,
      maxHp: hp,
      pos: { ...this.map.path[0] },
      wp: 1,
      dist: 0,
      slow: 1,
      slowTimer: 0,
      burnDps: 0,
      burnTimer: 0,
      resonance: 0,
      resonanceTimer: 0,
      cloaked,
      phase: Math.random() * Math.PI * 2,
      dead: false,
      finished: false,
    };
  }

  private spawnEnemy(typeId: string, cloaked: boolean) {
    const e = this.makeEnemy(typeId, cloaked);
    // the Diplomat's Gambit: with the receiver listening, the next LEVIATHAN hails instead of fighting
    if (this.receiver && typeId === 'leviathan' && !this.courierActive) {
      e.courier = true;
      e.cloaked = false;
      this.courierActive = true;
      this.announce('✉ The LEVIATHAN is hailing on the antique frequency. HOLD FIRE.');
      vox('courier');
    }
    this.enemies.push(e);
  }

  /** Available once the wave-50 manifest is recovered. */
  canBuildReceiver(): boolean {
    return !this.receiver && this.archive.includes(RECEIVER_FRAGMENT) &&
      this.phase !== 'gameover' && this.phase !== 'armistice';
  }

  buildReceiver(): boolean {
    if (!this.canBuildReceiver() || this.credits < RECEIVER_COST) {
      sfx.error();
      return false;
    }
    this.credits -= RECEIVER_COST;
    this.receiver = true;
    this.announce('📡 Antique receiver assembled — beacon fuel diverted, towers −25% rate');
    sfx.archive();
    return true;
  }

  private spawnChildren(parent: Enemy) {
    for (let i = 0; i < parent.def.children.length; i++) {
      const e = this.makeEnemy(parent.def.children[i], parent.cloaked);
      e.pos = { x: parent.pos.x + (Math.random() - 0.5) * 14, y: parent.pos.y + (Math.random() - 0.5) * 14 };
      e.wp = parent.wp;
      e.dist = Math.max(0, parent.dist - i * 12);
      this.enemies.push(e);
    }
  }

  /** position and waypoint index for a given distance along the path */
  private posAtDist(dist: number): { pos: Vec; wp: number } {
    const path = this.map.path;
    let remaining = Math.max(0, dist);
    for (let i = 0; i < this.segLengths.length; i++) {
      if (remaining <= this.segLengths[i]) {
        const a = path[i], b = path[i + 1];
        const t = this.segLengths[i] === 0 ? 0 : remaining / this.segLengths[i];
        return { pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, wp: i + 1 };
      }
      remaining -= this.segLengths[i];
    }
    return { pos: { ...path[path.length - 1] }, wp: path.length };
  }

  // ---------- damage ----------

  /** Veterancy: towers earn ranks from kills; each rank adds 6% damage. */
  static rankOf(t: Tower): number {
    return t.kills >= 150 ? 3 : t.kills >= 60 ? 2 : t.kills >= 20 ? 1 : 0;
  }

  /** Returns actual damage dealt (0 if immune). */
  damageEnemy(e: Enemy, dmg: number, type: Projectile['damageType'], shred: boolean, src?: Tower): number {
    if (e.dead || e.finished || e.courier) return 0;
    if (e.def.armored && type === 'kinetic' && !shred) return 0;
    if (e.def.immuneExplosive && type === 'explosive') return 0;
    if (dmg <= 0) return 0;
    if (src) dmg *= 1 + 0.06 * Game.rankOf(src);
    if (e.resonance > 0) dmg *= 1 + 0.10 * e.resonance;
    if (this.adaptation.type === type) dmg *= 1 - this.adaptation.resist;
    this.dmgWindow[type] = (this.dmgWindow[type] ?? 0) + dmg;
    if (src) this.runStats.dmg[src.def.id] = (this.runStats.dmg[src.def.id] ?? 0) + dmg;
    e.hp -= dmg;
    if (e.hp <= 0) {
      this.killEnemy(e);
      if (src) src.kills++;
    }
    return dmg;
  }

  /** Ability damage — bypasses all immunities (but never harms the Courier). */
  trueDamage(e: Enemy, dmg: number) {
    if (e.dead || e.finished || e.courier) return;
    e.hp -= dmg;
    if (e.hp <= 0) this.killEnemy(e);
  }

  applySlow(e: Enemy, power: number, duration: number) {
    if (e.def.immuneCryo || e.def.boss || e.courier) return;
    const slow = 1 - power;
    if (slow < e.slow || e.slowTimer <= 0) {
      e.slow = Math.min(e.slow, slow);
      e.slowTimer = Math.max(e.slowTimer, duration);
    }
  }

  private killEnemy(e: Enemy) {
    if (e.dead) return;
    e.dead = true;
    this.credits += e.def.reward;
    this.totalKills++;
    this.runStats.kills[e.def.id] = (this.runStats.kills[e.def.id] ?? 0) + 1;
    this.spawnChildren(e);
    if (e.def.boss) {
      sfx.bossDown();
      vox(e.def.id === 'leviathan' ? 'leviathan-down' : 'titan-down');
      this.explosionFx(e.pos, e.def.glow, e.def.radius * 2.2);
      this.shake = Math.min(1, this.shake + 0.7);
      this.dropPickup(e.pos, true);
    } else {
      if (e.def.hp >= 3 || e.def.armored) {
        sfx.crunch(); // heavy hulls die like machines, not balloons
        this.explosionFx(e.pos, e.def.glow, e.def.radius * 1.6);
      } else {
        sfx.pop();
        this.burstFx(e.pos, e.def.glow, 7);
        this.ring(e.pos, e.def.glow, e.def.radius + 6);
      }
      // credit popup
      this.particles.push({
        pos: { x: e.pos.x, y: e.pos.y - e.def.radius - 4 },
        vel: { x: 0, y: -26 },
        life: 0.7, maxLife: 0.7, size: 10, color: '#ffd32a', kind: 'text', text: `+${e.def.reward}`,
      });
      // drop chance shrinks as kill volume grows in later waves
      if (Math.random() < 0.022 / (1 + this.wave * 0.04)) this.dropPickup(e.pos, false);
    }
  }

  private dropPickup(pos: Vec, boss: boolean) {
    if (this.pickups.length >= 3) return; // no carpet of beacons in dense waves
    const roll = Math.random();
    const kind: PickupKind = boss
      ? (roll < 0.5 ? 'credits' : roll < 0.8 ? 'core' : 'frenzy')
      : (roll < 0.55 ? 'credits' : roll < 0.75 ? 'frenzy' : roll < 0.92 ? 'cryoburst' : 'core');
    this.pickups.push({
      uid: uidCounter++,
      kind,
      pos: { x: Math.max(20, Math.min(W - 20, pos.x)), y: Math.max(20, Math.min(H - 20, pos.y)) },
      life: 7,
      maxLife: 7,
    });
  }

  /** Try to collect a pickup near a click. Returns true if one was collected. */
  collectPickup(pos: Vec): boolean {
    const p = this.pickups.find((pk) => Math.hypot(pk.pos.x - pos.x, pk.pos.y - pos.y) <= 20);
    if (!p) return false;
    this.pickups = this.pickups.filter((x) => x !== p);
    switch (p.kind) {
      case 'credits': {
        const amount = 40 + this.wave * 4;
        this.credits += amount;
        this.announce(`⌬ Salvage cache recovered: +${amount}`);
        break;
      }
      case 'frenzy':
        this.frenzyTimer = 5;
        this.announce('⚡ Combat stims: towers +50% fire rate');
        break;
      case 'cryoburst':
        for (const e of this.enemies) {
          if (!e.def.boss) { e.slow = 0.15; e.slowTimer = Math.max(e.slowTimer, 2.5); }
        }
        this.ring(p.pos, '#7efff5', 200);
        this.announce('❄ Cryo burst: hostiles flash-frozen');
        break;
      case 'core':
        this.lives += 1;
        this.announce('⬢ Reactor core recovered: +1 core');
        break;
    }
    sfx.pickup();
    this.ring(p.pos, '#ffd32a', 26);
    return true;
  }

  // ---------- commander abilities ----------

  abilityReady(id: AbilityId): boolean {
    const a = this.abilities.find((x) => x.def.id === id)!;
    return a.cd <= 0 && this.wave >= a.def.unlockWave;
  }

  castAbility(id: AbilityId, pos?: Vec): boolean {
    const a = this.abilities.find((x) => x.def.id === id)!;
    if (!this.abilityReady(id)) { sfx.error(); return false; }
    switch (id) {
      case 'strike': {
        if (!pos) return false;
        const radius = 95;
        for (const e of [...this.enemies]) {
          if (Math.hypot(e.pos.x - pos.x, e.pos.y - pos.y) <= radius + e.def.radius) {
            this.trueDamage(e, 500);
          }
        }
        // visual: vertical lance + double shockwave
        this.beams.push({ from: { x: pos.x, y: -20 }, to: { ...pos }, color: '#ffffff', width: 9, life: 0.35, maxLife: 0.35 });
        this.beams.push({ from: { x: pos.x, y: -20 }, to: { ...pos }, color: '#ffd32a', width: 18, life: 0.25, maxLife: 0.25 });
        this.explosionFx(pos, '#ffd32a', radius);
        this.explosionFx(pos, '#ffffff', radius * 0.6);
        this.shake = 1;
        sfx.strike();
        this.announce('☄ Orbital lance discharged');
        break;
      }
      case 'chrono':
        this.chronoTimer = 6;
        this.announce('⌛ Chrono field active — a million minds lean on the clock');
        sfx.chrono();
        break;
      case 'overdrive':
        this.overdriveTimer = 8;
        this.announce('⚡ OVERDRIVE — burning beacon fuel in the gun reactors');
        sfx.overdrive();
        break;
      case 'salvage': {
        const amount = 150 + this.wave * 12;
        this.credits += amount;
        this.announce(`⌬ Salvage Protocol: +${amount} credits`);
        sfx.upgrade();
        break;
      }
      case 'cascade': {
        // detonate every resonance mark on the field
        let popped = 0;
        for (const e of [...this.enemies]) {
          if (e.resonance > 0 && !e.courier) {
            this.explosionFx(e.pos, '#fff8c4', 30 + e.resonance * 8);
            this.trueDamage(e, e.resonance * 15);
            e.resonance = 0;
            e.resonanceTimer = 0;
            popped++;
          }
        }
        this.shake = Math.min(1, 0.3 + popped * 0.05);
        this.announce(popped > 0 ? `♫ Null Cascade — ${popped} marks detonated` : '♫ Null Cascade — no marks to detonate');
        sfx.bossDown();
        break;
      }
      case 'mirror':
        this.mirrorTimer = 10;
        this.announce('◇ Mirror Protocol — the exit is a door that opens backward');
        sfx.chrono();
        break;
    }
    a.cd = a.def.cooldown;
    this.runStats.abilitiesCast++;
    return true;
  }

  // ---------- main update ----------

  update(rawDt: number) {
    if (this.paused || this.phase === 'gameover' || this.phase === 'armistice') return;
    this.noticeTimer = Math.max(0, this.noticeTimer - rawDt); // real-time, not game speed
    // pickups expire in real time too — clicking them is a human reflex, and the
    // window shouldn't shrink at 2x/4x game speed
    for (const p of this.pickups) p.life -= Math.min(rawDt, 0.05);
    this.pickups = this.pickups.filter((p) => p.life > 0);
    // fixed substeps: at 4x speed a frame can cover 0.2s of game time — stepped
    // whole, projectiles tunnel through hulls. Cap each physics step at 1/30s.
    let total = Math.min(rawDt, 0.05) * this.speed;
    while (total > 1e-6 && (this.phase as Phase) !== 'gameover' && (this.phase as Phase) !== 'armistice') {
      const step = Math.min(total, 1 / 30);
      total -= step;
      this.tick(step);
    }
  }

  private tick(dt: number) {
    this.time += dt;

    // global timers
    this.chronoTimer = Math.max(0, this.chronoTimer - dt);
    this.mirrorTimer = Math.max(0, this.mirrorTimer - dt);
    this.overdriveTimer = Math.max(0, this.overdriveTimer - dt);
    this.frenzyTimer = Math.max(0, this.frenzyTimer - dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);
    for (const a of this.abilities) a.cd = Math.max(0, a.cd - dt);

    this.updateSpawns(dt);
    this.updateEnemies(dt);
    this.updateAllies(dt);
    this.updateAuras();
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    this.updateNovas(dt);
    this.updateFx(dt);

    // wave completion
    if (this.phase === 'wave' && this.queue.length === 0 && this.enemies.length === 0) {
      this.credits += waveBonus(this.wave);
      // archive fragments unlock by wave
      ARCHIVE.forEach((f, i) => {
        if (f.wave <= this.wave && !this.archive.includes(i)) {
          this.archive.push(i);
          progress.addArchive(i);
          this.newArchive = true;
          this.announce(i === RECEIVER_FRAGMENT
            ? '✦ Manifest decoded. There may be another way to end this — open the ARCHIVE'
            : '✦ Archive fragment recovered — open the ARCHIVE');
          sfx.archive();
          vox('archive');
        }
      });
      if (this.wave >= this.diff.waves && !this.freeplay) {
        this.phase = 'victory';
        progress.recordWave(this.map.id, this.diff.id, this.wave);
        progress.endRun(this.totalKills, true);
        sfx.victory();
        playStinger('victory');
        vox('victory');
      } else {
        progress.recordWave(this.map.id, this.diff.id, this.wave);
        const before = progress.totalWaves;
        progress.addWaves(1);
        if (TOWERS.some((t) => t.unlockAt > before && t.unlockAt <= progress.totalWaves)) {
          this.announce('✦ New instrument pattern decrypted — check the Arsenal');
          vox('unlock');
        } else if (this.wave % 5 === 0) {
          vox('wave-clear');
        }
        // Veteran+: every 10 waves the armada field-patches armor against your top damage type
        if (this.diff.id !== 'easy' && this.wave % 10 === 0 && this.wave >= 10) {
          const entries = Object.entries(this.dmgWindow).sort((a, b) => b[1] - a[1]);
          if (entries.length > 0 && entries[0][1] > 0) {
            const resist = this.diff.id === 'hard' ? 0.35 : 0.25;
            this.adaptation = { type: entries[0][0] as import('./types').DamageType, resist };
            this.announce(`⛨ The Combine has adapted: ${entries[0][0]} damage −${Math.round(resist * 100)}% for the next 10 waves`);
          }
          this.dmgWindow = {};
        }
        this.phase = 'build';
        sfx.waveClear();
        if (this.autoNext) this.startWave();
      }
    }
  }

  private updateSpawns(dt: number) {
    let blocked = false; // groups run sequentially: a group's delay starts when prior groups finish
    for (const entry of this.queue) {
      if (blocked) break;
      entry.timer -= dt;
      while (entry.timer <= 0 && entry.spawned < entry.group.count) {
        this.spawnEnemy(entry.group.type, !!entry.group.cloaked);
        entry.spawned++;
        entry.timer += entry.group.gap;
      }
      if (entry.spawned < entry.group.count) blocked = true;
    }
    this.queue = this.queue.filter((e) => e.spawned < e.group.count);
  }

  private updateEnemies(dt: number) {
    const path = this.map.path;
    for (const e of this.enemies) {
      if (e.dead || e.finished) continue;
      // burn
      if (e.burnTimer > 0) {
        e.burnTimer -= dt;
        this.damageEnemy(e, e.burnDps * dt, 'energy', false);
        if (e.dead) continue;
      }
      // slow decay
      if (e.slowTimer > 0) {
        e.slowTimer -= dt;
        if (e.slowTimer <= 0) e.slow = 1;
      }
      // resonance decay
      if (e.resonanceTimer > 0) {
        e.resonanceTimer -= dt;
        if (e.resonanceTimer <= 0) e.resonance = 0;
      }
      // boss disruption pulse: stuns towers near the hull — don't stack your whole
      // defense on the one chokepoint a carrier will walk through
      if (e.def.boss && !e.courier) {
        e.pulseCd = (e.pulseCd ?? 2.5) - dt;
        if (e.pulseCd <= 0) {
          e.pulseCd = e.def.id === 'leviathan' ? 4 : 5.5;
          const radius = e.def.id === 'leviathan' ? 160 : 120;
          let hit = 0;
          for (const t of this.towers) {
            if (t.def.style === 'support') continue;
            if (Math.hypot(t.pos.x - e.pos.x, t.pos.y - e.pos.y) <= radius) {
              t.cooldown = Math.max(t.cooldown, 1.6);
              hit++;
            }
          }
          if (hit > 0) {
            this.ring(e.pos, '#ff7f50', radius);
            this.burstFx(e.pos, '#ff7f50', 8);
            sfx.zap();
          }
        }
      }
      // seraph repair aura
      if (e.def.heal) {
        for (const o of this.enemies) {
          if (o === e || o.dead || o.finished || o.hp >= o.maxHp) continue;
          if (Math.hypot(o.pos.x - e.pos.x, o.pos.y - e.pos.y) <= e.def.heal.radius) {
            o.hp = Math.min(o.maxHp, o.hp + e.def.heal.hps * dt);
          }
        }
      }
      const globalSlow = this.chronoTimer > 0 ? 0.35 : 1;
      let move = e.def.speed * e.slow * globalSlow * dt;
      while (move > 0 && e.wp < path.length) {
        const target = path[e.wp];
        const dx = target.x - e.pos.x, dy = target.y - e.pos.y;
        const d = Math.hypot(dx, dy);
        if (d <= move) {
          e.pos = { ...target };
          e.dist += d;
          move -= d;
          e.wp++;
        } else {
          e.pos.x += (dx / d) * move;
          e.pos.y += (dy / d) * move;
          e.dist += move;
          move = 0;
        }
      }
      if (e.wp >= path.length) {
        e.finished = true;
        if (!e.courier && this.mirrorTimer > 0) {
          // Mirror Protocol: thrown back to the entrance instead of breaching
          e.finished = false;
          e.dist = 0;
          e.wp = 1;
          e.pos = { ...path[0] };
          this.ring(e.pos, '#54a0ff', 30);
          continue;
        }
        if (e.courier) {
          // the Courier docks. The receipt is signed. The war is over.
          this.phase = 'armistice';
          progress.markArmistice();
          progress.recordWave(this.map.id, this.diff.id, this.wave);
          progress.endRun(this.totalKills, true);
          this.enemies = [];
          this.queue = [];
          sfx.victory();
          playStinger('victory');
          vox('armistice');
          return;
        }
        this.lives -= rbe(e.def.id);
        this.runStats.leaks += rbe(e.def.id);
        this.hurtFlash = Math.min(1, this.hurtFlash + 0.55);
        this.shake = Math.min(1, this.shake + (e.def.boss ? 0.8 : 0.25));
        sfx.leak();
        if (this.lives <= 0) {
          this.lives = 0;
          this.phase = 'gameover';
          progress.recordWave(this.map.id, this.diff.id, this.wave);
          progress.endRun(this.totalKills, false);
          sfx.gameOver();
          playStinger('defeat');
          vox('gameover');
        } else if (this.lives <= this.diff.lives * 0.25 && !this.lowCoreWarned) {
          this.lowCoreWarned = true;
          vox('low-cores');
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead && !e.finished);
  }

  private updateAuras() {
    for (const t of this.towers) {
      t.rateBuff = 1;
      t.rangeBuff = 1;
    }
    for (const s of this.towers) {
      if (s.def.style !== 'support') continue;
      const st = s.stats;
      for (const t of this.towers) {
        if (t === s || t.def.style === 'support') continue;
        if (Math.hypot(t.pos.x - s.pos.x, t.pos.y - s.pos.y) <= st.range) {
          t.rateBuff = Math.max(t.rateBuff, 1 + st.buffRate);
          t.rangeBuff = Math.max(t.rangeBuff, 1 + st.buffRange);
        }
      }
      // aura effects on enemies: slow (Ion Storm) and sear (Razor Static)
      if (st.slowPower > 0 || st.burnDps > 0) {
        for (const e of this.enemies) {
          if (e.courier) continue;
          if (Math.hypot(e.pos.x - s.pos.x, e.pos.y - s.pos.y) <= st.range) {
            if (st.slowPower > 0) this.applySlow(e, st.slowPower, st.slowDuration);
            if (st.burnDps > 0) {
              e.burnDps = Math.max(e.burnDps, st.burnDps);
              e.burnTimer = Math.max(e.burnTimer, 0.5);
            }
          }
        }
      }
    }
  }

  /** Does any tower or support give detection coverage at this enemy's position? */
  private visibleTo(t: Tower, e: Enemy): boolean {
    if (!e.cloaked) return true;
    if (t.stats.detection) return true;
    // EMP spires reveal cloaked enemies inside their aura for everyone
    for (const s of this.towers) {
      if (s.def.style === 'support' && s.stats.detection) {
        if (Math.hypot(e.pos.x - s.pos.x, e.pos.y - s.pos.y) <= s.stats.range) return true;
      }
    }
    return false;
  }

  private pickTarget(t: Tower, range: number): Enemy | null {
    let best: Enemy | null = null;
    let bestVal = -Infinity;
    for (const e of this.enemies) {
      if (e.dead || e.finished || e.courier) continue;
      const d = Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y);
      if (d > range + e.def.radius) continue;
      if (!this.visibleTo(t, e)) continue;
      let val: number;
      switch (t.target) {
        case 'first': val = e.dist; break;
        case 'last': val = -e.dist; break;
        case 'strong': val = e.hp * 1000 + e.dist; break;
        case 'close': val = -d; break;
      }
      if (val > bestVal) { bestVal = val; best = e; }
    }
    return best;
  }

  private updateTowers(dt: number) {
    const globalRate = (this.overdriveTimer > 0 ? 2 : 1) * (this.frenzyTimer > 0 ? 1.5 : 1)
      * (this.receiver ? 0.75 : 1); // beacon fuel diverted to the antique receiver
    for (const t of this.towers) {
      t.flash = Math.max(0, t.flash - dt);
      t.recoil = Math.max(0, t.recoil - dt * 5);
      if (t.def.style === 'support') continue;
      t.cooldown -= dt * t.rateBuff * globalRate;
      if (t.cooldown > 0) continue;
      const st = t.stats;
      const range = st.range * t.rangeBuff * this.rangeFactor(t.pos);

      if (t.def.style === 'pulse') {
        // cryo / locust cloud: hit everything in range
        let any = false;
        for (const e of this.enemies) {
          if (e.dead || e.finished || e.courier) continue;
          if (Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y) > range + e.def.radius) continue;
          if (!this.visibleTo(t, e)) continue;
          any = true;
          if (st.slowPower > 0) this.applySlow(e, st.slowPower, st.slowDuration);
          if (st.burnDps > 0) {
            e.burnDps = Math.max(e.burnDps, st.burnDps);
            e.burnTimer = Math.max(e.burnTimer, st.burnDuration);
          }
          if (st.damage > 0) this.damageEnemy(e, st.damage, st.damageType, false, t);
        }
        if (any) {
          t.cooldown = 1 / st.fireRate;
          t.flash = 0.2;
          sfx.cryo();
          this.ring(t.pos, t.def.glow, range);
        }
        continue;
      }

      if (t.def.style === 'nova') {
        // drowned star: exhale an expanding requiem wave
        if (this.enemies.some((e) => !e.dead && !e.finished && !e.courier &&
          Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y) <= range + 40)) {
          this.novas.push({
            pos: { ...t.pos }, r: 12, maxR: range, damage: st.damage,
            slowPower: st.slowPower, slowDuration: st.slowDuration,
            color: t.def.glow, hit: new Set(), src: t,
          });
          t.cooldown = 1 / st.fireRate;
          t.flash = 0.4;
          sfx.gravity();
        }
        continue;
      }

      if (t.def.style === 'gravity') {
        // drag every hostile in range backward along the path, crush hulls
        let any = false;
        for (const e of this.enemies) {
          if (e.dead || e.finished || e.courier) continue;
          if (Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y) > range + e.def.radius) continue;
          if (!this.visibleTo(t, e)) continue;
          any = true;
          const drag = st.drag * (e.def.boss ? 0.22 : 1);
          e.dist = Math.max(0, e.dist - drag);
          const at = this.posAtDist(e.dist);
          e.pos = at.pos;
          e.wp = at.wp;
          if (st.slowPower > 0) this.applySlow(e, st.slowPower, st.slowDuration);
          this.damageEnemy(e, st.damage, 'energy', true, t);
        }
        if (any) {
          t.cooldown = 1 / st.fireRate;
          t.flash = 0.25;
          sfx.gravity();
          this.ring(t.pos, t.def.glow, range);
          this.burstFx(t.pos, t.def.glow, 5);
        }
        continue;
      }

      if (t.def.style === 'resonance') {
        // mark up to `count` hulls with resonance stacks
        const marked: Enemy[] = [];
        let target = this.pickTarget(t, range);
        while (target && marked.length < st.count) {
          marked.push(target);
          const dur = st.burnDuration > 0 ? 9999 : 4;
          target.resonance = Math.min(5, target.resonance + 1);
          target.resonanceTimer = Math.max(target.resonanceTimer, dur);
          this.damageEnemy(target, st.damage, st.damageType, false, t);
          this.addBeam(t.pos, target.pos, t.def.glow, 2.5, 0.22);
          const exclude = marked;
          target = this.enemies.find((e) =>
            !e.dead && !e.finished && !exclude.includes(e) && this.visibleTo(t, e) &&
            Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y) <= range + e.def.radius) ?? null;
        }
        if (marked.length > 0) {
          t.angle = Math.atan2(marked[0].pos.y - t.pos.y, marked[0].pos.x - t.pos.x);
          t.cooldown = 1 / st.fireRate;
          t.flash = 0.2;
          sfx.resonance();
        }
        continue;
      }

      if (t.def.style === 'arc') {
        // tesla: zap up to `count` enemies in range, chain jumps extra
        const targets: Enemy[] = [];
        for (const e of this.enemies) {
          if (e.dead || e.finished) continue;
          if (Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y) > range + e.def.radius) continue;
          if (!this.visibleTo(t, e)) continue;
          targets.push(e);
          if (targets.length >= st.count) break;
        }
        if (targets.length === 0) continue;
        for (const e of targets) {
          this.addBeam(t.pos, e.pos, t.def.glow, 2, 0.12);
          if (st.drag > 0 && !e.def.boss) { // Magnetar Cage
            e.dist = Math.max(0, e.dist - st.drag);
            const at = this.posAtDist(e.dist);
            e.pos = at.pos; e.wp = at.wp;
          }
          if (st.slowPower > 0) this.applySlow(e, st.slowPower, st.slowDuration);
          this.damageEnemy(e, st.damage, st.damageType, st.shred, t);
          let from = e;
          for (let j = 0; j < st.chain; j++) {
            const next = this.nearestEnemy(from.pos, 90, targets.concat([from]));
            if (!next) break;
            this.addBeam(from.pos, next.pos, t.def.glow, 1.5, 0.1);
            this.damageEnemy(next, st.damage, st.damageType, st.shred, t);
            from = next;
          }
        }
        const first = targets[0];
        t.angle = Math.atan2(first.pos.y - t.pos.y, first.pos.x - t.pos.x);
        t.cooldown = 1 / st.fireRate;
        t.flash = 0.15;
        sfx.zap();
        continue;
      }

      const target = this.pickTarget(t, range);
      if (!target) continue;
      t.angle = Math.atan2(target.pos.y - t.pos.y, target.pos.x - t.pos.x);
      t.cooldown = 1 / st.fireRate;
      t.flash = 0.12;
      t.recoil = 1;

      if (t.def.style === 'rail') {
        // hitscan along the line through the target; oracle variants also execute
        const shots: Enemy[] = [target];
        for (let i = 1; i < st.count; i++) {
          const next = this.enemies.find((e) => !e.dead && !e.finished && !e.courier && !shots.includes(e) &&
            this.visibleTo(t, e) && Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y) <= range + e.def.radius);
          if (next) shots.push(next);
        }
        for (const tgt of shots) {
          const dir = norm({ x: tgt.pos.x - t.pos.x, y: tgt.pos.y - t.pos.y });
          const end = { x: t.pos.x + dir.x * 1600, y: t.pos.y + dir.y * 1600 };
          this.addBeam(t.pos, end, t.def.glow, 3, 0.15);
          let hits = 0;
          // collect only enemies near the firing line, then sort that short list
          const onLine = this.enemies.filter((e) =>
            !e.dead && !e.finished && !e.courier && this.visibleTo(t, e) &&
            distToSeg(e.pos, t.pos, end) <= e.def.radius + 4);
          onLine.sort((a, b) =>
            Math.hypot(a.pos.x - t.pos.x, a.pos.y - t.pos.y) - Math.hypot(b.pos.x - t.pos.x, b.pos.y - t.pos.y));
          for (const e of onLine) {
            {
              if (st.execute > 0 && !e.def.boss && e.hp / e.maxHp <= st.execute) {
                this.burstFx(e.pos, '#ffffff', 10);
                this.trueDamage(e, e.hp);
                t.kills++;
              } else {
                this.damageEnemy(e, st.damage, st.damageType, st.shred, t);
              }
              this.burstFx(e.pos, t.def.glow, 3);
              if (++hits >= st.pierce) break;
            }
          }
        }
        sfx.rail();
        continue;
      }

      if (t.def.style === 'beam') {
        const dir = norm({ x: target.pos.x - t.pos.x, y: target.pos.y - t.pos.y });
        const end = { x: t.pos.x + dir.x * range, y: t.pos.y + dir.y * range };
        this.addBeam(t.pos, end, t.def.glow, 4, 0.1);
        let hits = 0;
        for (const e of this.enemies) {
          if (e.dead || e.finished || !this.visibleTo(t, e)) continue;
          if (distToSeg(e.pos, t.pos, end) <= e.def.radius + 6) {
            this.damageEnemy(e, st.damage, st.damageType, st.shred, t);
            if (++hits >= st.pierce) break;
          }
        }
        sfx.laser();
        continue;
      }

      // bolt & missile: spawn projectiles
      for (let i = 0; i < st.count; i++) {
        const spread = st.count > 1 ? (i - (st.count - 1) / 2) * 0.12 : 0;
        const lead = t.def.style === 'missile' ? target.pos : predict(target, this.map.path, t.pos, st.projectileSpeed);
        const ang = Math.atan2(lead.y - t.pos.y, lead.x - t.pos.x) + spread;
        this.projectiles.push({
          uid: uidCounter++,
          src: t,
          kind: t.def.style === 'missile' ? 'missile' : 'bolt',
          pos: { x: t.pos.x + Math.cos(ang) * 14, y: t.pos.y + Math.sin(ang) * 14 },
          vel: { x: Math.cos(ang) * st.projectileSpeed, y: Math.sin(ang) * st.projectileSpeed },
          damage: st.damage,
          damageType: st.damageType,
          pierce: st.pierce,
          splash: st.splash,
          speed: st.projectileSpeed,
          targetUid: target.uid,
          life: 2.2,
          color: t.def.glow,
          hit: new Set(),
          burnDps: st.burnDps,
          burnDuration: st.burnDuration,
          shred: st.shred,
          detection: st.detection || !target.cloaked ? true : false,
        });
      }
      if (t.def.style === 'missile') sfx.missile();
      else if (st.damageType === 'energy') sfx.laser();
      else sfx.shoot();
    }
  }

  private nearestEnemy(pos: Vec, maxDist: number, exclude: Enemy[]): Enemy | null {
    let best: Enemy | null = null;
    let bd = maxDist;
    for (const e of this.enemies) {
      if (e.dead || e.finished || exclude.includes(e)) continue;
      const d = Math.hypot(e.pos.x - pos.x, e.pos.y - pos.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      p.life -= dt;
      if (p.life <= 0) continue;

      if (p.kind === 'missile') {
        const target = this.enemies.find((e) => e.uid === p.targetUid && !e.dead && !e.finished);
        if (target) {
          const dir = norm({ x: target.pos.x - p.pos.x, y: target.pos.y - p.pos.y });
          // steer toward target
          p.vel.x += dir.x * p.speed * 5 * dt;
          p.vel.y += dir.y * p.speed * 5 * dt;
          const v = norm(p.vel);
          p.vel = { x: v.x * p.speed, y: v.y * p.speed };
        } else if (this.enemies.length > 0) {
          const next = this.nearestEnemy(p.pos, 9999, []);
          if (next) p.targetUid = next.uid;
        }
        // exhaust trail
        if (Math.random() < 0.5) {
          this.particles.push({
            pos: { ...p.pos }, vel: { x: -p.vel.x * 0.1, y: -p.vel.y * 0.1 },
            life: 0.35, maxLife: 0.35, size: 3, color: '#ffb86c', kind: 'smoke',
          });
        }
      }

      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      if (p.pos.x < -30 || p.pos.x > W + 30 || p.pos.y < -30 || p.pos.y > H + 30) {
        p.life = 0;
        continue;
      }

      for (const e of this.enemies) {
        if (e.dead || e.finished || p.hit.has(e.uid)) continue;
        if (e.cloaked && !p.detection) continue;
        const hitR = e.def.radius + (p.kind === 'missile' ? 6 : 4);
        if (Math.hypot(e.pos.x - p.pos.x, e.pos.y - p.pos.y) <= hitR) {
          if (p.kind === 'missile') {
            this.explode(p);
            p.life = 0;
            break;
          }
          p.hit.add(e.uid);
          const dealt = this.damageEnemy(e, p.damage, p.damageType, p.shred, p.src);
          if (dealt > 0 && p.burnDps > 0) {
            e.burnDps = Math.max(e.burnDps, p.burnDps);
            e.burnTimer = Math.max(e.burnTimer, p.burnDuration);
          }
          this.burstFx(p.pos, p.color, 2);
          if (p.hit.size >= p.pierce) {
            p.life = 0;
            break;
          }
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);
  }

  /** Long Watch only: Combine patrol frames sweep the lane backward, zapping the Hollow */
  private updateAllies(dt: number) {
    if (this.diff.id !== 'ngplus') return;
    if (this.phase === 'wave') {
      this.allyTimer -= dt;
      if (this.allyTimer <= 0 && this.allies.length < 2) {
        this.allyTimer = 30;
        const total = this.segLengths.reduce((a, b) => a + b, 0);
        const at = this.posAtDist(total);
        this.allies.push({ dist: total, pos: at.pos, heading: Math.PI, cd: 0 });
        this.announce('✦ Combine escort entering the corridor');
      }
    }
    for (const a of this.allies) {
      const prev = a.pos;
      a.dist -= 55 * dt;
      const at = this.posAtDist(Math.max(0, a.dist));
      a.pos = at.pos;
      if (Math.hypot(a.pos.x - prev.x, a.pos.y - prev.y) > 0.5) {
        a.heading = Math.atan2(a.pos.y - prev.y, a.pos.x - prev.x);
      }
      a.cd -= dt;
      if (a.cd <= 0) {
        const target = this.nearestEnemy(a.pos, 120, []);
        if (target && !target.courier) {
          a.cd = 0.45;
          this.addBeam(a.pos, target.pos, '#b388ff', 2.5, 0.12);
          this.trueDamage(target, 5);
          this.burstFx(target.pos, '#b388ff', 2);
        }
      }
    }
    this.allies = this.allies.filter((a) => a.dist > 0);
  }

  private updateNovas(dt: number) {
    for (const n of this.novas) {
      n.r += 230 * dt;
      for (const e of this.enemies) {
        if (e.dead || e.finished || e.courier || n.hit.has(e.uid)) continue;
        if (Math.abs(Math.hypot(e.pos.x - n.pos.x, e.pos.y - n.pos.y) - n.r) <= e.def.radius + 10) {
          n.hit.add(e.uid);
          if (n.slowPower > 0) this.applySlow(e, n.slowPower, n.slowDuration);
          this.damageEnemy(e, n.damage, 'energy', true, n.src);
        }
      }
    }
    this.novas = this.novas.filter((n) => n.r < n.maxR);
  }

  private explode(p: Projectile) {
    this.explosionFx(p.pos, '#ff9f43', p.splash);
    sfx.explosion();
    for (const e of this.enemies) {
      if (e.dead || e.finished) continue;
      if (Math.hypot(e.pos.x - p.pos.x, e.pos.y - p.pos.y) <= p.splash + e.def.radius) {
        const dealt = this.damageEnemy(e, p.damage, p.damageType, p.shred, p.src);
        if (dealt > 0 && p.burnDps > 0) {
          e.burnDps = Math.max(e.burnDps, p.burnDps);
          e.burnTimer = Math.max(e.burnTimer, p.burnDuration);
        }
      }
    }
  }

  // ---------- fx ----------

  private updateFx(dt: number) {
    if (this.particles.length > 280) this.particles.splice(0, this.particles.length - 280);
    for (const pt of this.particles) {
      pt.life -= dt;
      pt.pos.x += pt.vel.x * dt;
      pt.pos.y += pt.vel.y * dt;
      pt.vel.x *= 0.94;
      pt.vel.y *= 0.94;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);
  }

  private addBeam(from: Vec, to: Vec, color: string, width: number, life: number) {
    if (this.beams.length >= 70) this.beams.shift(); // pool cap: late waves stay smooth
    this.beams.push({ from: { ...from }, to: { ...to }, color, width, life, maxLife: life });
  }

  burstFx(pos: Vec, color: string, n: number) {
    if (this.particles.length > 240) return; // pool cap
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 120;
      this.particles.push({
        pos: { ...pos }, vel: { x: Math.cos(a) * sp, y: Math.sin(a) * sp },
        life: 0.3 + Math.random() * 0.25, maxLife: 0.5, size: 1.5 + Math.random() * 2, color, kind: 'spark',
      });
    }
  }

  explosionFx(pos: Vec, color: string, radius: number) {
    this.particles.push({
      pos: { ...pos }, vel: { x: 0, y: 0 }, life: 0.35, maxLife: 0.35,
      size: radius, color, kind: 'ring',
    });
    this.burstFx(pos, color, 14);
  }

  ring(pos: Vec, color: string, size: number) {
    this.particles.push({
      pos: { ...pos }, vel: { x: 0, y: 0 }, life: 0.4, maxLife: 0.4, size, color, kind: 'ring',
    });
  }

  setTargetMode(t: Tower, mode: TargetMode) {
    t.target = mode;
  }
}

// ---------- geometry helpers ----------

function norm(v: Vec): Vec {
  const d = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / d, y: v.y / d };
}

export function distToSeg(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Rough intercept prediction: where will the enemy be when the bolt arrives? */
function predict(e: Enemy, path: Vec[], from: Vec, projSpeed: number): Vec {
  const eta = Math.hypot(e.pos.x - from.x, e.pos.y - from.y) / projSpeed;
  let move = e.def.speed * e.slow * eta;
  let pos = { ...e.pos };
  let wp = e.wp;
  while (move > 0 && wp < path.length) {
    const target = path[wp];
    const dx = target.x - pos.x, dy = target.y - pos.y;
    const d = Math.hypot(dx, dy);
    if (d <= move) {
      pos = { ...target };
      move -= d;
      wp++;
    } else {
      pos = { x: pos.x + (dx / d) * move, y: pos.y + (dy / d) * move };
      move = 0;
    }
  }
  return pos;
}

export interface EnemyDefLookup {
  [id: string]: EnemyDef;
}
