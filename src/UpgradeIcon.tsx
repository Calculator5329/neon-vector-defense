import type { ReactNode } from 'react';

// Procedural SVG upgrade icons. AI image-gen is unavailable (the OpenRouter key is dead),
// so each upgrade is classified by keyword into an archetype and drawn as a crisp inline
// SVG that inherits the track's color via currentColor. Deterministic + tiny + themeable.

export type UpgradeIconKey =
  | 'damage' | 'rate' | 'range' | 'pierce' | 'splash' | 'slow' | 'sensor' | 'economy' | 'support' | 'ultimate';

/** Classify an upgrade from its name + description. Bonus (tier 5-6) → the "ultimate" star. */
export function upgradeIconKey(name: string, desc: string, bonus: boolean): UpgradeIconKey {
  if (bonus) return 'ultimate';
  const s = `${name} ${desc}`.toLowerCase();
  if (/(slow|cryo|freez|chill|stasis|drag|gravit|repuls|anchor)/.test(s)) return 'slow';
  if (/(sensor|detect|cloak|reveal|sight|scan|spotter|oracle)/.test(s)) return 'sensor';
  if (/(pierce|penetrat|through|impale|lance|rail|execut|armor)/.test(s)) return 'pierce';
  if (/(splash|blast|explos|aoe|area|cluster|burst|saturat|barrage|nova|shockwave)/.test(s)) return 'splash';
  if (/(rate|reload|faster|rapid|cadence|spin|loader|cooldown|twin|auto)/.test(s)) return 'rate';
  if (/(range|reach|extend|antenna|relay|coverage)/.test(s)) return 'range';
  if (/(cash|credit|income|bounty|salvage|econom|profit|tithe)/.test(s)) return 'economy';
  if (/(aura|buff|ally|boost|support|link|beacon|overclock|amplif)/.test(s)) return 'support';
  return 'damage';
}

const PATHS: Record<UpgradeIconKey, ReactNode> = {
  damage: <path d="M5 19 L19 5 M13 5 H19 V11" />,
  rate: <path d="M13 2 L4 13 H11 L10 22 L20 10 H12 Z" fill="currentColor" stroke="none" />,
  range: <><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="10" opacity="0.45" /></>,
  pierce: <path d="M2 12 H20 M14 6 L20 12 L14 18" />,
  splash: <><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /><path d="M12 2 V5 M12 19 V22 M2 12 H5 M19 12 H22 M5 5 L7 7 M17 17 L19 19 M19 5 L17 7 M7 17 L5 19" /></>,
  slow: <path d="M12 2 V22 M3 7 L21 17 M21 7 L3 17 M12 2 L9 5 M12 2 L15 5 M12 22 L9 19 M12 22 L15 19" />,
  sensor: <><path d="M2 12 S6 5 12 5 S22 12 22 12 S18 19 12 19 S2 12 2 12 Z" /><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" /></>,
  economy: <><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12 H15.5 M12 7.5 V16.5" /></>,
  support: <path d="M12 2 L21 7 V17 L12 22 L3 17 V7 Z" />,
  ultimate: <path d="M12 1.5 L14.4 9 L22 12 L14.4 15 L12 22.5 L9.6 15 L2 12 L9.6 9 Z" fill="currentColor" stroke="none" />,
};

export function UpgradeIcon({ k, size = 16 }: { k: UpgradeIconKey; size?: number }) {
  return (
    <svg className="upg-ico" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[k]}
    </svg>
  );
}
