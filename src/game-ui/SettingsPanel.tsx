import { useState } from 'react';
import { sfx, setMuted, isMuted, setMusic, isMusicOn, MUSIC_PACKS, getMusicPack, setMusicPack } from '../game/sound';
import { applyAccessibility } from '../game/settings';
import { progress } from '../game/storage';
import Modal from '../Modal';

function SettingsRow({ name, sub, on, onToggle }: { name: string; sub: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="privacy-control">
      <div>
        <div className="privacy-control-name">{name}</div>
        <div className="privacy-control-sub">{sub}</div>
      </div>
      <button className={`privacy-toggle ${on ? 'on' : ''}`} aria-label={`${name}: ${on ? 'on' : 'off'}`} aria-pressed={on} onClick={onToggle}>{on ? 'ON' : 'OFF'}</button>
    </div>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const sfxOn = !isMuted();
  const musicOn = isMusicOn();
  return (
    <Modal onClose={onClose} boxClass="overlay-box settings-box" labelledBy="settings-title" style={{ borderColor: 'var(--accent)' }}>
      <h2 id="settings-title" style={{ color: 'var(--accent)' }}>SETTINGS</h2>
      <div className="privacy-controls">
        <SettingsRow name="Sound effects" sub="Procedural combat audio." on={sfxOn}
          onToggle={() => { setMuted(sfxOn); rerender(); if (!sfxOn) sfx.click(); }} />
        <SettingsRow name="Music" sub="Generative score." on={musicOn}
          onToggle={() => { setMusic(!musicOn); rerender(); }} />
        <div className="privacy-control">
          <div>
            <div className="privacy-control-name" id="settings-music-pack-label">Music pack</div>
            <div className="privacy-control-sub">Choose the soundtrack.</div>
          </div>
          <select className="age-gate-select settings-select" aria-labelledby="settings-music-pack-label" value={getMusicPack()}
            onChange={(e) => { setMusicPack(e.target.value); rerender(); sfx.click(); }}>
            {MUSIC_PACKS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <SettingsRow name="Reduced motion" sub="Turns off screen shake and the red damage flash." on={progress.reducedMotion}
          onToggle={() => { progress.reducedMotion = !progress.reducedMotion; applyAccessibility(); rerender(); sfx.click(); }} />
        <SettingsRow name="Colorblind palette" sub="Colorblind-safe damage-type colors (kinetic/energy/cryo/blast)." on={progress.colorblind}
          onToggle={() => { progress.colorblind = !progress.colorblind; applyAccessibility(); rerender(); sfx.click(); }} />
      </div>
      <div className="overlay-btns"><button className="start-btn small" onClick={onClose}>DONE ▸</button></div>
    </Modal>
  );
}
