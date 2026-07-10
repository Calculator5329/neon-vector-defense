// Viewer-side map cosmetics: never simulation, scoring, or replay inputs.
import { meta } from './meta';
import type { GameMap, MapTheme } from './types';

export interface MapThemePack { id: string; name: string; cost: number; palette?: MapTheme }

export const MAP_THEME_PACKS: MapThemePack[] = [
  { id: 'standard', name: 'Standard', cost: 0 },
  { id: 'ember', name: 'Ember', cost: 350, palette: { bg1: '#170704', bg2: '#321008', path: '#42170d', pathEdge: '#ff6b35' } },
  { id: 'glacier', name: 'Glacier', cost: 400, palette: { bg1: '#03121a', bg2: '#082b3b', path: '#0d3547', pathEdge: '#72e6ff' } },
  { id: 'void', name: 'Void', cost: 500, palette: { bg1: '#08040f', bg2: '#170929', path: '#21103a', pathEdge: '#a66cff' } },
];

const STANDARD_MAP_THEMES: Record<string, MapTheme> = {
  orbital: { bg1: '#070b1a', bg2: '#0d1330', path: '#141d3d', pathEdge: '#2e4a8f' },
  reactor: { bg1: '#0c071a', bg2: '#1a0d30', path: '#241440', pathEdge: '#6b2e8f' },
  hyperlane: { bg1: '#160707', bg2: '#2b0d14', path: '#3a1420', pathEdge: '#8f2e44' },
  carousel: { bg1: '#061218', bg2: '#0a2430', path: '#103040', pathEdge: '#35a7d8' },
  mobius: { bg1: '#06140f', bg2: '#0b2b1f', path: '#103428', pathEdge: '#2e8f6e' },
  blackout: { bg1: '#0d0a04', bg2: '#1d1408', path: '#251a0c', pathEdge: '#8f6c2e' },
  splice: { bg1: '#100817', bg2: '#22102d', path: '#29163a', pathEdge: '#b14fd7' },
  mirror: { bg1: '#071018', bg2: '#10202b', path: '#142a36', pathEdge: '#69d3ff' },
  throat: { bg1: '#140707', bg2: '#260c0c', path: '#331111', pathEdge: '#8f2e2e' },
  foundry: { bg1: '#150905', bg2: '#2c1308', path: '#3a1a0c', pathEdge: '#f07a2f' },
  umbral: { bg1: '#0a0614', bg2: '#190b28', path: '#22103a', pathEdge: '#8a5cff' },
  cinder: { bg1: '#140a04', bg2: '#281408', path: '#34190a', pathEdge: '#d06a2a' },
};

const FALLBACK: MapTheme = { bg1: '#070b1a', bg2: '#0d1330', path: '#141d3d', pathEdge: '#2e4a8f' };
export const standardMapTheme = (mapId: string): MapTheme => STANDARD_MAP_THEMES[mapId] ?? FALLBACK;
export const mapThemePackById = (id: string): MapThemePack => MAP_THEME_PACKS.find((pack) => pack.id === id) ?? MAP_THEME_PACKS[0];

/** Resolve from local viewer state; this value is deliberately never serialized into a run. */
export function displayedMapTheme(map: Pick<GameMap, 'id' | 'theme'>, packId = meta.equippedMapTheme): MapTheme {
  return mapThemePackById(packId).palette ?? map.theme;
}
