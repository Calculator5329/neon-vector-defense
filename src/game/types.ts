// Core shared types for Neon Vector Defense

export interface Vec {
  x: number;
  y: number;
}

export type DamageType = 'kinetic' | 'energy' | 'explosive' | 'cryo';

export interface EnemyDef {
  id: string;
  name: string;
  /** codex flavor text */
  lore: string;
  hp: number;
  speed: number; // px per second at 1x
  radius: number;
  reward: number; // credits on destroy
  color: string;
  glow: string;
  /** enemy ids spawned at death position */
  children: string[];
  immuneExplosive?: boolean;
  immuneCryo?: boolean;
  /** armored: immune to kinetic damage */
  armored?: boolean;
  boss?: boolean;
  /** repairs nearby hulls: radius and hp per second */
  heal?: { radius: number; hps: number };
  /** visual shape variant */
  shape: 'tri' | 'diamond' | 'hex' | 'pent' | 'ship' | 'capital';
}

export interface Enemy {
  uid: number;
  def: EnemyDef;
  hp: number;
  maxHp: number;
  pos: Vec;
  /** index of next waypoint */
  wp: number;
  /** total distance travelled along path (for targeting) */
  dist: number;
  /** slow multiplier 0..1 applied to speed (1 = no slow) */
  slow: number;
  slowTimer: number;
  burnDps: number;
  burnTimer: number;
  cloaked: boolean;
  /** resonance stacks (Cantor debuff): +10% damage taken per stack */
  resonance: number;
  resonanceTimer: number;
  /** wobble phase for rendering */
  phase: number;
  dead: boolean;
  finished: boolean;
  /** the Courier: carries the armistice, cannot be harmed or targeted */
  courier?: boolean;
  /** bosses: seconds until the next disruption pulse */
  pulseCd?: number;
  /** transient per-tick: cloaked hull is inside a detector aura (precomputed) */
  revealed?: boolean;
}

export interface TowerStats {
  range: number;
  /** shots per second */
  fireRate: number;
  damage: number;
  damageType: DamageType;
  /** enemies a single projectile can hit */
  pierce: number;
  projectileSpeed: number;
  /** splash radius, 0 = none */
  splash: number;
  /** number of projectiles per volley (tesla arcs, twin emitters) */
  count: number;
  /** can target cloaked enemies */
  detection: boolean;
  /** slow strength 0..1 (cryo) — speed multiplied by (1 - slowPower) */
  slowPower: number;
  slowDuration: number;
  /** burn damage per second applied on hit */
  burnDps: number;
  burnDuration: number;
  /** chain lightning jumps */
  chain: number;
  /** aura buffs for support towers */
  buffRate: number; // fire rate multiplier given to towers in range
  buffRange: number; // range multiplier given to towers in range
  /** strips armor/immunities on hit */
  shred: boolean;
  /** gravity towers: px each target is dragged back along the path per pulse */
  drag: number;
  /** hitscan executes non-boss hulls below this hp fraction */
  execute: number;
}

export interface UpgradeDef {
  name: string;
  desc: string;
  cost: number;
  apply: (s: TowerStats) => void;
}

export type FireStyle = 'bolt' | 'missile' | 'arc' | 'beam' | 'pulse' | 'rail' | 'support' | 'gravity' | 'resonance' | 'nova';

export interface UpgradeTrack {
  name: string;
  /** 6 upgrades: tiers 1-4 always buyable, tiers 5-6 require committing to this track */
  upgrades: UpgradeDef[];
}

export interface TowerDef {
  id: string;
  name: string;
  short: string;
  desc: string;
  /** flavor line shown in the upgrade panel */
  lore: string;
  cost: number;
  /** cumulative waves cleared (all-time) required to unlock in the shop */
  unlockAt: number;
  color: string;
  glow: string;
  style: FireStyle;
  base: TowerStats;
  tracks: [UpgradeTrack, UpgradeTrack];
}

export type TargetMode = 'first' | 'last' | 'strong' | 'close';

export interface Tower {
  uid: number;
  def: TowerDef;
  pos: Vec;
  stats: TowerStats;
  /** upgrades purchased per track, 0..6 */
  tierA: number;
  tierB: number;
  /** track index committed to for bonus tiers (5-6); null until chosen */
  committed: 0 | 1 | null;
  cooldown: number;
  angle: number;
  target: TargetMode;
  invested: number;
  kills: number;
  /** computed each frame from support auras */
  rateBuff: number;
  rangeBuff: number;
  /** recent fire flash timer for rendering */
  flash: number;
  /** barrel recoil 0..1, decays after firing */
  recoil: number;
}

export type AbilityId = 'strike' | 'chrono' | 'overdrive' | 'salvage' | 'cascade' | 'mirror';

export interface AbilityDef {
  id: AbilityId;
  name: string;
  icon: string;
  desc: string;
  cooldown: number;
  /** requires a target click on the map */
  targeted: boolean;
  /** unlocked from this wave onward */
  unlockWave: number;
}

export interface AbilityState {
  def: AbilityDef;
  /** seconds remaining */
  cd: number;
}

export type PickupKind = 'credits' | 'frenzy' | 'cryoburst' | 'core';

export interface Pickup {
  uid: number;
  kind: PickupKind;
  pos: Vec;
  life: number;
  maxLife: number;
}

export interface Projectile {
  uid: number;
  /** firing tower, for kill attribution */
  src?: Tower;
  kind: 'bolt' | 'missile';
  pos: Vec;
  vel: Vec;
  damage: number;
  damageType: DamageType;
  pierce: number;
  splash: number;
  speed: number;
  targetUid: number | null;
  life: number;
  color: string;
  hit: Set<number>;
  burnDps: number;
  burnDuration: number;
  shred: boolean;
  detection: boolean;
}

export interface Particle {
  pos: Vec;
  vel: Vec;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: 'spark' | 'ring' | 'smoke' | 'text';
  text?: string;
}

export interface Beam {
  from: Vec;
  to: Vec;
  color: string;
  width: number;
  life: number;
  maxLife: number;
}

export interface WaveGroup {
  type: string;
  count: number;
  /** seconds between spawns */
  gap: number;
  cloaked?: boolean;
  /** seconds to wait after previous group finished */
  delay?: number;
}

export type Wave = WaveGroup[];

export interface GameMap {
  id: string;
  name: string;
  desc: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  /** path waypoints in 1280x720 space */
  path: Vec[];
  pathWidth: number;
  /** circular no-build zones besides the path */
  blockers: { x: number; y: number; r: number }[];
  /** powered beacon zones: towers OUTSIDE all zones lose 35% range (Blackout Reach) */
  zones?: { x: number; y: number; r: number }[];
  /** ambience track id override (defaults to map id) */
  music?: string;
  theme: { bg1: string; bg2: string; path: string; pathEdge: string };
}

export interface DifficultyDef {
  id: string;
  name: string;
  lives: number;
  cash: number;
  costMult: number;
  /** enemy hp multiplier */
  hpMult: number;
  waves: number;
  desc: string;
}
