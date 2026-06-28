// Signal Palettes — a cosmetic recolor of the game's neon accent, bought with Salvage.
// Cosmetic/QoL only (overrides the --accent CSS var); never touches gameplay or balance.
import { meta } from './meta';

export interface AccentPalette { id: string; name: string; color: string; cost: number; }
export const PALETTES: AccentPalette[] = [
  { id: 'standard', name: 'Lantern Cyan', color: '#4bcffa', cost: 0 },
  { id: 'ember', name: 'Ember', color: '#ff7a3a', cost: 300 },
  { id: 'frost', name: 'Frostlight', color: '#9ffff5', cost: 350 },
  { id: 'void', name: 'Void Violet', color: '#b388ff', cost: 400 },
  { id: 'toxin', name: 'Toxin', color: '#7bed9f', cost: 450 },
  { id: 'auric', name: 'Auric', color: '#ffcf4b', cost: 600 },
  // higher tiers so Salvage keeps a purpose past the first week
  { id: 'magma', name: 'Magma', color: '#ff4d6d', cost: 750 },
  { id: 'tidal', name: 'Tidal', color: '#36d1dc', cost: 850 },
  { id: 'spectral', name: 'Spectral', color: '#ff6ec7', cost: 1000 },
  { id: 'prestige', name: 'Ascendant Gold', color: '#ffe27a', cost: 1500 },
];

export function paletteById(id: string): AccentPalette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

/** Apply the equipped palette to the live document (call on boot + after equip). */
export function applyAccent(): void {
  if (typeof document === 'undefined') return;
  const p = paletteById(meta.equippedPalette);
  if (p.id === 'standard') document.documentElement.style.removeProperty('--accent');
  else document.documentElement.style.setProperty('--accent', p.color);
}
