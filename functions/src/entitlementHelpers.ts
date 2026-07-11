/** Server-owned cosmetic catalog and pure entitlement transaction rules. */

export const COSMETIC_PRICES = Object.freeze({
  'palette-ember': 300,
  'palette-frost': 350,
  'palette-void': 400,
  'palette-toxin': 450,
  'palette-auric': 600,
  'palette-magma': 750,
  'palette-tidal': 850,
  'palette-spectral': 1000,
  'palette-prestige': 1500,
  'map-theme-ember': 350,
  'map-theme-glacier': 400,
  'map-theme-void': 500,
  'signal-skin-chrome': 450,
  'signal-skin-inferno': 700,
  'signal-skin-spectral': 1000,
} as const);

export type PurchasableCosmeticId = keyof typeof COSMETIC_PRICES;

export interface EntitlementState {
  cosmeticIds: string[];
  salvageBalance: number;
  salvageSpent: number;
}

export type SalvagePurchaseResult =
  | { ok: true; alreadyOwned: boolean; cost: number; state: EntitlementState }
  | { ok: false; reason: 'unknown-cosmetic' | 'insufficient-salvage'; cost?: number };

function safeNonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function readEntitlementState(raw: unknown): EntitlementState {
  const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const ids = Array.isArray(data.cosmeticIds) ? data.cosmeticIds : [];
  return {
    cosmeticIds: [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length <= 80))].slice(0, 200),
    salvageBalance: safeNonNegativeInt(data.salvageBalance),
    salvageSpent: safeNonNegativeInt(data.salvageSpent),
  };
}

/** Apply a catalog-priced spend. No client price or balance participates. */
export function applySalvagePurchase(raw: unknown, cosmeticId: string): SalvagePurchaseResult {
  if (!(cosmeticId in COSMETIC_PRICES)) return { ok: false, reason: 'unknown-cosmetic' };
  const id = cosmeticId as PurchasableCosmeticId;
  const cost = COSMETIC_PRICES[id];
  const state = readEntitlementState(raw);
  if (state.cosmeticIds.includes(id)) return { ok: true, alreadyOwned: true, cost, state };
  if (state.salvageBalance < cost) return { ok: false, reason: 'insufficient-salvage', cost };
  return {
    ok: true,
    alreadyOwned: false,
    cost,
    state: {
      cosmeticIds: [...state.cosmeticIds, id],
      salvageBalance: state.salvageBalance - cost,
      salvageSpent: state.salvageSpent + cost,
    },
  };
}
