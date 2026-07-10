// Signal Skins are viewer-side paint only. They must never be read by simulation,
// replay serialization, score calculation, or tower definitions.
import { meta } from './meta';

export type ProjectileTrailStyle = 'standard' | 'flare' | 'ribbon' | 'echo';

export interface CosmeticSet {
  id: string;
  name: string;
  cost: number;
  towerBody?: string;
  towerGlow?: string;
  projectileTrail: ProjectileTrailStyle;
  projectileColor?: string;
  impactParticle?: string;
}

export const COSMETIC_SETS: CosmeticSet[] = [
  { id: 'standard', name: 'Standard Issue', cost: 0, projectileTrail: 'standard' },
  { id: 'chrome', name: 'Chrome', cost: 450, towerBody: '#b9c7d9', towerGlow: '#e8f4ff', projectileTrail: 'ribbon', projectileColor: '#d8edff', impactParticle: '#eef8ff' },
  { id: 'inferno', name: 'Inferno', cost: 700, towerBody: '#ff633f', towerGlow: '#ffb02e', projectileTrail: 'flare', projectileColor: '#ff7a32', impactParticle: '#ffd166' },
  { id: 'spectral', name: 'Spectral', cost: 1000, towerBody: '#8b70ff', towerGlow: '#58f5d2', projectileTrail: 'echo', projectileColor: '#ad8cff', impactParticle: '#65ffd8' },
];

export function cosmeticSetById(id: string): CosmeticSet {
  return COSMETIC_SETS.find((set) => set.id === id) ?? COSMETIC_SETS[0];
}

/** Resolve exclusively from this device's state, including during replay playback. */
export function displayedCosmeticSet(id = meta.equippedSignalSkin): CosmeticSet {
  return cosmeticSetById(id);
}
