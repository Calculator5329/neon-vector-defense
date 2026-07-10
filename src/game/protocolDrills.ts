import { dailyChallengeForDate, type DailyChallenge } from './dailyChallenge';

export type ProtocolDrillType = 'slows-only' | 'no-abilities' | 'fixed-loadout';

export interface ProtocolDrill extends DailyChallenge {
  drillType: ProtocolDrillType;
  maxWaves: number;
  noAbilities: boolean;
}

export const PROTOCOL_DRILL_TYPES: ProtocolDrillType[] = ['slows-only', 'no-abilities', 'fixed-loadout'];
const DRILL_RE = /^drill-(\d{4}-\d{2}-\d{2})-(slows-only|no-abilities|fixed-loadout)$/;

/** Date and drill type are the complete canonical input. No client rule payload is trusted. */
export function protocolDrillForDate(dateKey: string, drillType: ProtocolDrillType): ProtocolDrill {
  const daily = dailyChallengeForDate(dateKey);
  const definitions = {
    'slows-only': {
      title: 'Cryostasis Drill',
      towerIds: ['cryo', 'tesla', 'emp'],
      description: 'Only towers whose loadout applies a slow are authorized.',
      noAbilities: false,
    },
    'no-abilities': {
      title: 'Silent Command Drill',
      towerIds: ['pulse', 'cryo', 'rail', 'emp'],
      description: 'Commander abilities are disabled in the simulation.',
      noAbilities: true,
    },
    'fixed-loadout': {
      title: 'Standard Issue Drill',
      towerIds: ['pulse', 'missile', 'emp'],
      description: 'Deploy with the fixed Pulse / Missile / EMP loadout.',
      noAbilities: false,
    },
  } as const;
  const def = definitions[drillType];
  const maxWaves = 10;
  return {
    ...daily,
    id: `drill-${daily.dateKey}-${drillType}`,
    title: `${def.title} ${daily.dateKey.slice(5)}: ${daily.title.split(': ').slice(1).join(': ')}`,
    drillType,
    maxWaves,
    noAbilities: def.noAbilities,
    arsenal: {
      id: 'fixedPool',
      name: def.title,
      short: 'DRILL',
      desc: def.description,
      towerIds: [...def.towerIds],
    },
    rules: [def.description, `Clear ${maxWaves} waves. Ranked by wave, then hulls destroyed.`],
  };
}

export function protocolDrills(now = new Date()): ProtocolDrill[] {
  const dateKey = now.toISOString().slice(0, 10);
  return PROTOCOL_DRILL_TYPES.map((type) => protocolDrillForDate(dateKey, type));
}

export function protocolDrillForId(id: string): ProtocolDrill | null {
  const match = DRILL_RE.exec(id);
  return match ? protocolDrillForDate(match[1], match[2] as ProtocolDrillType) : null;
}

export function isProtocolDrillId(id: string): boolean {
  return DRILL_RE.test(id);
}
