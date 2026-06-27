import { useState } from 'react';
import { meta, type QuestWithProgress } from './game/meta';
import { sfx } from './game/sound';

// Third menu tab: Warden Rank + Salvage wallet + Watch Streak + the daily/weekly
// Operations Board. All reads come from the `meta` singleton (localStorage); claiming a
// completed quest grants XP/salvage. Cosmetic/QoL only — never touches run balance.
export default function OperationsBoard() {
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const rank = meta.rank;
  const streak = meta.streak;
  const board = meta.board();
  const daily = board.filter((q) => q.period === 'daily');
  const weekly = board.filter((q) => q.period === 'weekly');

  const claim = (id: string) => {
    const r = meta.claimQuest(id);
    if (r) { sfx.upgrade(); rerender(); } else sfx.error();
  };

  return (
    <div className="ops-tab" data-testid="ops-tab">
      <div className="ops-head">
        <div className="ops-rank" data-testid="rank-bar">
          <div className="ops-rank-top">
            <span className="ops-rank-title">{rank.title}</span>
            <span className="ops-rank-xp">{rank.xpIntoRank.toLocaleString()} / {rank.xpForRank.toLocaleString()} XP</span>
          </div>
          <div className="ops-rank-bar"><div className="ops-rank-fill" style={{ width: `${rank.pct * 100}%` }} /></div>
          <div className="ops-rank-sub">WARDEN RANK {rank.rank} · {rank.totalXp.toLocaleString()} lifetime XP</div>
        </div>
        <div className="ops-chips">
          <div className="ops-chip salvage" title="Salvage — earned per run (cosmetics coming soon)">
            <span className="ops-chip-val">◆ {meta.salvage.toLocaleString()}</span>
            <span className="ops-chip-label">SALVAGE</span>
          </div>
          <div className={`ops-chip streak ${streak.activeToday ? 'active' : ''}`} title={`Best streak: ${streak.best} days`}>
            <span className="ops-chip-val">🔥 {streak.current}</span>
            <span className="ops-chip-label">{streak.activeToday ? 'DAY STREAK' : streak.current > 0 ? 'STREAK (PLAY TODAY)' : 'NO STREAK'}</span>
          </div>
        </div>
      </div>

      <div className="ops-board" data-testid="ops-board">
        <QuestColumn label="DAILY OPERATIONS" quests={daily} onClaim={claim} />
        <QuestColumn label="WEEKLY OPERATIONS" quests={weekly} onClaim={claim} />
      </div>
      <div className="ops-foot">Operations refresh daily / weekly · rewards are cosmetic &amp; progression only — they never change run difficulty.</div>
    </div>
  );
}

function QuestColumn({ label, quests, onClaim }: { label: string; quests: QuestWithProgress[]; onClaim: (id: string) => void }) {
  return (
    <div className="ops-col">
      <div className="menu-section-label">{label}</div>
      {quests.map((q) => {
        const pct = Math.min(100, (q.progress / q.target) * 100);
        return (
          <div key={q.id} className={`quest-card ${q.claimed ? 'claimed' : q.complete ? 'complete' : ''}`} data-testid={`quest-card-${q.id}`}>
            <div className="quest-top">
              <span className="quest-title">{q.title}</span>
              <span className="quest-reward">+{q.rewardXp} XP · ◆{q.rewardSalvage}</span>
            </div>
            <div className="quest-bar"><div className="quest-fill" style={{ width: `${pct}%` }} /></div>
            <div className="quest-bot">
              <span className="quest-prog">{Math.min(q.progress, q.target).toLocaleString()} / {q.target.toLocaleString()}</span>
              {q.claimed
                ? <span className="quest-done">✓ CLAIMED</span>
                : q.complete
                  ? <button className="quest-claim" onClick={() => onClaim(q.id)}>CLAIM</button>
                  : <span className="quest-prog dim">in progress</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
