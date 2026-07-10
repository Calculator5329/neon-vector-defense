import { useState } from 'react';
import { COSMETIC_SETS, type CosmeticSet } from '../game/cosmeticSets';
import { meta } from '../game/meta';

export interface SignalSkinPickerProps { onChange?: (skin: CosmeticSet) => void }

/** Salvage shop/equip control for viewer-local tower and projectile paint. */
export function SignalSkinPicker({ onChange }: SignalSkinPickerProps) {
  const [equipped, setEquipped] = useState(meta.equippedSignalSkin);
  const choose = (skin: CosmeticSet) => {
    const owned = skin.cost === 0 || meta.owns(`signal-skin-${skin.id}`);
    if (!owned && !meta.buyCosmetic(`signal-skin-${skin.id}`, skin.cost)) return;
    meta.equip('signal-skin', skin.id);
    setEquipped(skin.id);
    onChange?.(skin);
  };

  return (
    <div aria-label="Signal skin" role="group" data-testid="signal-skin-picker" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {COSMETIC_SETS.map((skin) => {
        const owned = skin.cost === 0 || meta.owns(`signal-skin-${skin.id}`);
        const afford = meta.salvage >= skin.cost;
        const active = equipped === skin.id;
        const label = owned ? `Equip ${skin.name} signal skin` : afford ? `Buy ${skin.name} signal skin for ${skin.cost} Salvage` : `${skin.name} needs ${skin.cost - meta.salvage} more Salvage`;
        return (
          <button key={skin.id} type="button" aria-label={label} aria-pressed={active} disabled={!owned && !afford}
            onClick={() => choose(skin)} data-testid={`signal-skin-${skin.id}`}
            style={{ borderColor: active ? 'var(--accent)' : skin.towerGlow, opacity: !owned && !afford ? 0.45 : 1 }}>
            <span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 12, marginRight: 6, borderRadius: '50%', background: skin.towerGlow ?? 'var(--accent)' }} />
            {skin.name}{!owned && ` · ${skin.cost}`}
          </button>
        );
      })}
    </div>
  );
}

export default SignalSkinPicker;
