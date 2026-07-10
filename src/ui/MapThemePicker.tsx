import { useState } from 'react';
import { MAP_THEME_PACKS, type MapThemePack } from '../game/mapThemes';
import { meta } from '../game/meta';

export interface MapThemePickerProps { onChange?: (theme: MapThemePack) => void }

/** Cosmetic picker intended for the sector/map selection surface. */
export function MapThemePicker({ onChange }: MapThemePickerProps) {
  const [equipped, setEquipped] = useState(meta.equippedMapTheme);
  const choose = (pack: MapThemePack) => {
    const owned = pack.cost === 0 || meta.owns(`map-theme-${pack.id}`);
    if (!owned && !meta.buyCosmetic(`map-theme-${pack.id}`, pack.cost)) return;
    meta.equip('map-theme', pack.id);
    setEquipped(pack.id);
    onChange?.(pack);
  };

  return (
    <div aria-label="Map theme" role="group" data-testid="map-theme-picker" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {MAP_THEME_PACKS.map((pack) => {
        const owned = pack.cost === 0 || meta.owns(`map-theme-${pack.id}`);
        const afford = meta.salvage >= pack.cost;
        const active = equipped === pack.id;
        const label = owned ? `Equip ${pack.name} map theme` : afford ? `Buy ${pack.name} map theme for ${pack.cost} Salvage` : `${pack.name} needs ${pack.cost - meta.salvage} more Salvage`;
        return (
          <button key={pack.id} type="button" aria-label={label} aria-pressed={active} disabled={!owned && !afford}
            onClick={() => choose(pack)} data-testid={`map-theme-${pack.id}`}
            style={{ borderColor: active ? 'var(--accent)' : pack.palette?.pathEdge, opacity: !owned && !afford ? 0.45 : 1 }}>
            <span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 12, marginRight: 6, borderRadius: 2, background: pack.palette?.pathEdge ?? 'var(--accent)' }} />
            {pack.name}{!owned && ` · ${pack.cost}`}
          </button>
        );
      })}
    </div>
  );
}

export default MapThemePicker;
