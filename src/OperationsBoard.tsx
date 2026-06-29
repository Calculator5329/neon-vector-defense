import { useState } from 'react';
import { meta, rankBandKey, type QuestWithProgress, type RunMetaReward } from './game/meta';
import { PALETTES, applyAccent } from './game/palette';
import { sfx } from './game/sound';

// Third menu tab: Warden Rank + Salvage wallet + Watch Streak + the daily/weekly
// Operations Board. All reads come from the `meta` singleton (localStorage); claiming a
// completed quest grants XP/salvage. Cosmetic/QoL only — never touches run balance.
export default function OperationsBoard({ onClaimed }: { onClaimed?: () => void } = {}) {
  const [, force] = useState(0);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [flash, setFlash] = useState<{ xp: number; salvage: number; n: number } | null>(null);
  const rerender = () => force((n) => n + 1);
  const showReward = (xp: number, salvage: number) => setFlash((f) => ({ xp, salvage, n: (f?.n ?? 0) + 1 }));
  // shared success epilogue for claim() and claimAll()
  const grant = (r: RunMetaReward, text: string) => {
    setStatus({ kind: 'ok', text });
    showReward(r.xp, r.salvage);
    sfx.upgrade();
    rerender();
    onClaimed?.();
  };

  const rank = meta.rank;
  const streak = meta.streak;
  const board = meta.board();
  const daily = board.filter((q) => q.period === 'daily');
  const weekly = board.filter((q) => q.period === 'weekly');
  const claimable = board.filter((q) => q.complete && !q.claimed).length;

  const claim = (id: string) => {
    const r = meta.claimQuest(id);
    if (r) {
      grant(r, `Claimed ${r.breakdown[0]?.label ?? 'operation'}: +${r.xp} XP and +${r.salvage} salvage.`);
    } else {
      setStatus({ kind: 'err', text: 'That operation is not ready to claim yet.' });
      sfx.error();
    }
  };

  const claimAll = () => {
    const r = meta.claimAll();
    if (r.xp > 0 || r.salvage > 0) {
      grant(r, `Claimed ${r.breakdown.length} operations: +${r.xp} XP and +${r.salvage} salvage.`);
    }
  };

  return (
    <div className="ops-tab" data-testid="ops-tab">
      <div className="ops-head">
        <div className="ops-rank" data-testid="rank-bar">
          <img className="ops-rank-crest" src={`/art/rank-${rankBandKey(rank.rank)}.png`} alt="" draggable={false} />
          <div className="ops-rank-body">
            <div className="ops-rank-top">
              <span className="ops-rank-title">{rank.title}</span>
              <span className="ops-rank-xp">{rank.xpIntoRank.toLocaleString()} / {rank.xpForRank.toLocaleString()} XP</span>
            </div>
            <div className="ops-rank-bar"><div className="ops-rank-fill" style={{ width: `${rank.pct * 100}%` }} /></div>
            <div className="ops-rank-sub">WARDEN RANK {rank.rank} · {rank.totalXp.toLocaleString()} lifetime XP</div>
          </div>
          {flash && (
            <div key={flash.n} className="xp-float" onAnimationEnd={() => setFlash(null)} aria-hidden="true">
              +{flash.xp.toLocaleString()} XP{flash.salvage > 0 ? <> · <i className="ico-diamond" />{flash.salvage}</> : ''}
            </div>
          )}
        </div>
        <div className="ops-chips">
          <div className="ops-chip salvage" title="Salvage — earned per run, spent on Signal Palettes below">
            <span className="ops-chip-val"><i className="ico-diamond" aria-hidden="true" /> {meta.salvage.toLocaleString()}</span>
            <span className="ops-chip-label">SALVAGE</span>
          </div>
          <div className={`ops-chip streak ${streak.activeToday ? 'active' : streak.current > 0 ? 'warn' : ''}`}
            title={streak.current > 0 && !streak.activeToday ? `Play today to keep your ${streak.current}-day watch alive (best: ${streak.best})` : `Best streak: ${streak.best} days`}>
            <span className="ops-chip-val">🔥 {streak.current}</span>
            <span className="ops-chip-label">{streak.activeToday ? 'DAY STREAK' : streak.current > 0 ? 'PLAY TODAY!' : 'NO STREAK'}</span>
          </div>
        </div>
      </div>

      <div className="ops-shop">
        <div className="menu-section-label">SIGNAL PALETTES</div>
        <div className="palette-row">
          {PALETTES.map((p) => {
            const owned = p.cost === 0 || meta.owns(`palette-${p.id}`);
            const equipped = meta.equippedPalette === p.id;
            const afford = meta.salvage >= p.cost;
            const short = Math.max(0, p.cost - meta.salvage);
            const paletteLabel = owned
              ? (equipped ? `${p.name} palette equipped` : `Equip ${p.name} palette`)
              : afford
                ? `Buy ${p.name} palette for ${p.cost} salvage`
                : `${p.name} palette needs ${short} more salvage`;
            return (
              <button key={p.id} className={`palette-chip ${equipped ? 'equipped' : ''}`} disabled={!owned && !afford}
                title={paletteLabel}
                aria-label={paletteLabel}
                onClick={() => {
                  if (owned) {
                    meta.equip('accent', p.id);
                    applyAccent();
                    sfx.click();
                    rerender();
                  }
                  else if (meta.buyCosmetic(`palette-${p.id}`, p.cost)) {
                    meta.equip('accent', p.id);
                    applyAccent();
                    setStatus({ kind: 'ok', text: `${p.name} palette purchased and equipped.` });
                    sfx.upgrade();
                    rerender();
                  }
                  else {
                    setStatus({ kind: 'err', text: `${p.name} needs ${short} more salvage.` });
                    sfx.error();
                  }
                }}>
                <span className="palette-swatch" style={{ background: p.color }} />
                <span className="palette-name">{p.name}</span>
                <span className="palette-tag">
                  {equipped ? '✓ EQUIPPED' : owned ? 'EQUIP' : afford ? <><i className="ico-diamond" aria-hidden="true" /> {p.cost}</> : <><i className="ico-diamond" aria-hidden="true" /> need {short}</>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {status && (
        <div className={`ops-status ${status.kind}`} role="status" aria-live="polite" aria-atomic="true">
          {status.text}
        </div>
      )}

      <div className="ops-board-head">
        <div className="menu-section-label">OPERATIONS BOARD</div>
        {claimable >= 2 && (
          <button className="quest-claim claim-all" onClick={claimAll}>CLAIM ALL ({claimable})</button>
        )}
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
              <span className="quest-title">
                {q.title}
                {q.scope?.freeplay === true && <span className="quest-scope" title="Only progresses during Freeplay runs">FREEPLAY</span>}
              </span>
              <span className="quest-reward">+{q.rewardXp} XP · <i className="ico-diamond" aria-hidden="true" />{q.rewardSalvage}</span>
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
