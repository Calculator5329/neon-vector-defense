import { useEffect, useState } from 'react';
import { ENEMY_LIST } from './game/enemies';
import { ELITE_AFFIX_META, ELITE_VARIANT_DEF } from './game/eliteAffixes';
import { progress } from './game/storage';
import { sfx } from './game/sound';
import EnemyPortrait from './EnemyPortrait';
import Modal from './Modal';
import type { EnemyDef } from './game/types';

// The Combine Bestiary — a browsable codex of every hull. Undiscovered entries show a
// blacked-out silhouette plus a redacted teaser (trait count / capital-class) to create
// collection tension; an enemy is "identified" the first time it's seen in the field
// (progress.enemiesSeen, set by the in-game NEW HOSTILE reveal).

function traits(d: EnemyDef): string[] {
  const t: string[] = [];
  if (d.boss) t.push('CAPITAL');
  if (d.armored) t.push('KINETIC-RESIST');
  if (d.immuneExplosive) t.push('BLAST-RESIST');
  if (d.immuneCryo) t.push('CRYO-RESIST');
  if (d.resist?.energy) t.push('ENERGY-RESIST');
  if (d.heal) t.push('REPAIRS');
  return t;
}

function tacticalNote(d: EnemyDef): string | null {
  const notes: string[] = [];
  if (d.armored) notes.push('kinetic rounds bite only after AP systems build Exposed');
  if (d.immuneExplosive) notes.push('blast plating blunts explosives until Exposed cracks it');
  if (d.immuneCryo) notes.push('cryo wash is resisted; Exposed gives it purchase');
  if (d.resist?.energy) notes.push('energy facets bleed power, but Exposed strips the angle');
  return notes.length ? notes.join('; ') + '.' : null;
}

type Filter = 'all' | 'found' | 'locked' | 'boss';
const FILTERS: [Filter, string][] = [['all', 'ALL'], ['found', 'DISCOVERED'], ['locked', 'UNIDENTIFIED'], ['boss', 'CAPITAL']];

export default function Bestiary({ onClose }: { onClose: () => void }) {
  const seen = new Set(progress.enemiesSeen);
  const total = ENEMY_LIST.length;
  const found = ENEMY_LIST.filter((d) => seen.has(d.id)).length;
  const eliteSeen = seen.has(ELITE_VARIANT_DEF.id);
  const [filter, setFilter] = useState<Filter>('all');

  // opening the codex acknowledges every identified hull so the NEW badge clears
  useEffect(() => { progress.bestiaryAck = found; }, [found]);

  const list = ENEMY_LIST.filter((d) => {
    if (filter === 'found') return seen.has(d.id);
    if (filter === 'locked') return !seen.has(d.id);
    if (filter === 'boss') return d.boss;
    return true;
  });

  return (
    <Modal onClose={onClose} overlayClass="bestiary-overlay" boxClass="bestiary" labelledBy="bestiary-title" testId="bestiary">
      <div className="bestiary-head">
        <span className="bestiary-title" id="bestiary-title">COMBINE BESTIARY</span>
        <span className="bestiary-count" aria-live="polite">{found} / {total} IDENTIFIED</span>
        <button className="bestiary-close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {/* a plain toggle-button group, not an ARIA tablist (no tabpanel/roving-tabindex model) */}
      <div className="bestiary-filters" role="group" aria-label="Filter hulls">
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" aria-pressed={filter === f}
            className={`bestiary-filter ${filter === f ? 'on' : ''}`}
            onClick={() => { setFilter(f); sfx.click(); }}>{label}</button>
        ))}
      </div>
      {eliteSeen && (
        <div className="bestiary-elite-note">
          <div className="foe-name" style={{ color: ELITE_VARIANT_DEF.glow }}>{ELITE_VARIANT_DEF.name}</div>
          <div className="foe-traits">
            {Object.values(ELITE_AFFIX_META).map((affix) => <span key={affix.name}>{affix.name.toUpperCase()}</span>)}
          </div>
          <div className="foe-lore">{ELITE_VARIANT_DEF.lore}</div>
        </div>
      )}
      <div className="bestiary-grid">
        {list.map((d) => {
          const known = seen.has(d.id);
          const tlist = traits(d);
          const note = tacticalNote(d);
          return (
            <div key={d.id} className={`foe-card ${known ? '' : 'foe-unknown'} ${d.boss ? 'foe-boss' : ''}`}>
              <div className="foe-portrait">
                <EnemyPortrait def={d} unknown={!known} />
                {!known && <div className="foe-lock">?</div>}
              </div>
              <div className="foe-name" style={known ? { color: d.glow } : undefined}>
                {known ? d.name : d.boss ? 'CAPITAL-CLASS' : 'UNIDENTIFIED'}
              </div>
              {known ? (
                <>
                  <div className="foe-traits">{tlist.map((t) => <span key={t}>{t}</span>)}</div>
                  <div className="foe-lore">{d.lore}</div>
                  {note && <div className="foe-lore dim">{note}</div>}
                </>
              ) : (
                <>
                  <div className="foe-traits redacted">
                    <span>{tlist.length > 0 ? `${tlist.length} TRAIT${tlist.length > 1 ? 'S' : ''} CLASSIFIED` : 'NO INTEL'}</span>
                  </div>
                  <div className="foe-lore dim">{d.boss ? 'Capital-class threat — classified. Engage to declassify.' : 'No field data. Engage to identify.'}</div>
                </>
              )}
            </div>
          );
        })}
        {list.length === 0 && <div className="bestiary-empty">No hulls match this filter yet — engage the Combine to fill the codex.</div>}
      </div>
      <div className="bestiary-foot">The Vex Combine — a self-replicating machine collective. Encounter a hull to add it to the codex.</div>
    </Modal>
  );
}
