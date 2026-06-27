// Headless sanity + safety checks for the meta layer (run: npx tsx scripts/meta-sim.ts).
// Verifies determinism, curve monotonicity, reward bounds, streak logic, AND — critically —
// that meta.ts is NOT imported by the engine/towers/bot/score path (the bot-tuned ladder
// must stay isolated from cosmetic progression).

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  operationsBoard, rankFromXp, xpForRank, deriveRunReward, computeStreak, dailyQuests, weeklyQuests,
  type RunRewardInput,
} from '../src/game/meta';

const __dirname = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) failed++; };

// 1. determinism — same date → identical board; next date → different
const d1 = new Date('2026-06-26T12:00:00Z');
const d2 = new Date('2026-06-27T12:00:00Z');
const a = JSON.stringify(operationsBoard(d1));
const b = JSON.stringify(operationsBoard(d1));
const c = JSON.stringify(operationsBoard(d2));
ok(a === b, 'operationsBoard is deterministic for a fixed date');
ok(a !== c, 'operationsBoard changes across days');
ok(dailyQuests(d1).length === 3 && weeklyQuests(d1).length === 2, 'board has 3 daily + 2 weekly quests');
ok(new Set(operationsBoard(d1).map((q) => q.id)).size === 5, 'all quest ids are unique');

// 2. rank curve — monotonic, pct in [0,1)
let mono = true; let prev = -1;
for (let n = 1; n <= 30; n++) { const t = xpForRank(n); if (t < prev) mono = false; prev = t; }
ok(mono, 'xpForRank thresholds are monotonically increasing (ranks 1..30)');
let pctOk = true;
for (const xp of [0, 50, 500, 5000, 50000, 500000]) { const r = rankFromXp(xp); if (r.pct < 0 || r.pct >= 1 || r.rank < 1) pctOk = false; }
ok(pctOk, 'rankFromXp pct ∈ [0,1) and rank ≥ 1 across the XP range');
ok(rankFromXp(0).rank === 1 && rankFromXp(1_000_000).rank > rankFromXp(1000).rank, 'rank grows with XP');

// 3. reward bounds — non-negative, abandoned = 0, win > loss at same wave
const base: RunRewardInput = { wave: 30, kills: 2000, cashEarned: 8000, won: false, freeplay: false, diffId: 'normal', isDailyFreeplay: false, outcome: 'gameover' };
const win = deriveRunReward({ ...base, won: true, outcome: 'victory' });
const loss = deriveRunReward(base);
const abandoned = deriveRunReward({ ...base, outcome: 'abandoned' });
ok(win.xp >= 0 && win.salvage >= 0 && loss.xp >= 0, 'rewards are non-negative');
ok(abandoned.xp === 0 && abandoned.salvage === 0, 'abandoned runs grant nothing (anti-farm)');
ok(win.xp > loss.xp, 'a win out-rewards a loss at the same wave');
const apex = deriveRunReward({ ...base, won: true, outcome: 'victory', diffId: 'extinction' });
ok(apex.xp > win.xp, 'higher difficulty multiplies XP');

// 4. streak from synthetic sessionDays
const key = (delta: number) => { const d = new Date(Date.UTC(2026, 5, 26 + delta)); return d.toISOString().slice(0, 10); };
const now = new Date('2026-06-26T12:00:00Z');
ok(computeStreak({ [key(0)]: 1 }, now).current === 1, 'today-only → streak 1');
ok(computeStreak({ [key(0)]: 1, [key(-1)]: 1, [key(-2)]: 1 }, now).current === 3, '3-in-a-row → streak 3');
const broken = computeStreak({ [key(-1)]: 1, [key(-2)]: 1 }, now);
ok(broken.current === 2 && broken.brokenYesterday && !broken.activeToday, 'gap-today → brokenYesterday, comeback eligible');
ok(computeStreak({}, now).current === 0, 'no sessions → streak 0');

// 5. CRITICAL: ladder isolation — meta must not be imported by the engine/score path
const ISOLATED = ['engine.ts', 'towers.ts', 'bot.ts'];
for (const f of ISOLATED) {
  const src = readFileSync(resolve(__dirname, '../src/game', f), 'utf8');
  ok(!/from ['"]\.\/meta['"]/.test(src), `${f} does NOT import ./meta (ladder isolation)`);
}

console.log(failed === 0 ? '\nALL META CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
