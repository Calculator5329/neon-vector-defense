import { useEffect, useState } from 'react';
import { COSMETIC_SETS, ownsCosmeticSet, type CosmeticSet } from '../game/cosmeticSets';
import { loadEntitlements, purchaseEntitlement, subscribeEntitlements } from '../game/entitlements';
import { meta } from '../game/meta';

export interface SignalSkinPickerProps { onChange?: (skin: CosmeticSet) => void }

/** Salvage shop/equip control for viewer-local tower and projectile paint. */
export function SignalSkinPicker({ onChange }: SignalSkinPickerProps) {
  const [equipped, setEquipped] = useState(meta.equippedSignalSkin);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [, rerender] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribeEntitlements(() => rerender((value) => value + 1));
    void loadEntitlements();
    return unsubscribe;
  }, []);
  const choose = async (skin: CosmeticSet) => {
    const cosmeticId = `signal-skin-${skin.id}`;
    const owned = ownsCosmeticSet(skin);
    if (!owned) {
      setPurchasing(skin.id);
      try {
        const granted = await purchaseEntitlement(cosmeticId);
        meta.recordServerEntitlement(cosmeticId, granted.salvageBalance);
      } catch (error) {
        console.warn('Signal skin purchase failed', error);
        return;
      } finally {
        setPurchasing(null);
      }
    }
    meta.equip('signal-skin', skin.id);
    setEquipped(skin.id);
    onChange?.(skin);
  };

  return (
    <div aria-label="Signal skin" role="group" data-testid="signal-skin-picker" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {COSMETIC_SETS.map((skin) => {
        const owned = ownsCosmeticSet(skin);
        const afford = meta.salvage >= skin.cost;
        const active = equipped === skin.id;
        const label = owned ? `Equip ${skin.name} signal skin` : afford ? `Buy ${skin.name} signal skin for ${skin.cost} Salvage` : `${skin.name} needs ${skin.cost - meta.salvage} more Salvage`;
        return (
          <button key={skin.id} type="button" aria-label={label} aria-pressed={active} disabled={purchasing !== null || (!owned && !afford)}
            onClick={() => void choose(skin)} data-testid={`signal-skin-${skin.id}`}
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
