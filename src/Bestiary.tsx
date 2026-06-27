import { ENEMY_LIST } from './game/enemies';
import { progress } from './game/storage';
import type { EnemyDef } from './game/types';

// The Combine Bestiary — a browsable codex of every hull. Undiscovered entries show a
// blacked-out silhouette; an enemy is "identified" the first time it's seen in the field
// (progress.enemiesSeen, set by the in-game NEW HOSTILE reveal).

function traits(d: EnemyDef): string[] {
  const t: string[] = [];
  if (d.boss) t.push('CAPITAL');
  if (d.armored) t.push('ARMORED');
  if (d.immuneExplosive) t.push('BLAST-IMMUNE');
  if (d.immuneCryo) t.push('CRYO-IMMUNE');
  if (d.heal) t.push('REPAIRS');
  return t;
}

export default function Bestiary({ onClose }: { onClose: () => void }) {
  const seen = new Set(progress.enemiesSeen);
  const total = ENEMY_LIST.length;
  const found = ENEMY_LIST.filter((d) => seen.has(d.id)).length;
  return (
    <div className="bestiary-overlay" onClick={onClose} data-testid="bestiary">
      <div className="bestiary" onClick={(e) => e.stopPropagation()}>
        <div className="bestiary-head">
          <span className="bestiary-title">COMBINE BESTIARY</span>
          <span className="bestiary-count">{found} / {total} IDENTIFIED</span>
          <button className="bestiary-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="bestiary-grid">
          {ENEMY_LIST.map((d) => {
            const known = seen.has(d.id);
            return (
              <div key={d.id} className={`foe-card ${known ? '' : 'foe-unknown'} ${d.boss ? 'foe-boss' : ''}`}>
                <div className="foe-portrait">
                  <img src={`/art/enemy-${d.id}.png`} alt="" draggable={false} />
                  {!known && <div className="foe-lock">?</div>}
                </div>
                <div className="foe-name" style={known ? { color: d.glow } : undefined}>{known ? d.name : 'UNIDENTIFIED'}</div>
                {known ? (
                  <>
                    <div className="foe-traits">{traits(d).map((t) => <span key={t}>{t}</span>)}</div>
                    <div className="foe-lore">{d.lore}</div>
                  </>
                ) : (
                  <div className="foe-lore dim">No field data. Engage to identify.</div>
                )}
              </div>
            );
          })}
        </div>
        <div className="bestiary-foot">The Vex Combine — a self-replicating machine collective. Destroy a hull to add it to the codex.</div>
      </div>
    </div>
  );
}
