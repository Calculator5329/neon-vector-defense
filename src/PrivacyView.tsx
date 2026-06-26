import { useState } from 'react';
import { consentState, setSell, gpcActive, resetConsent } from './game/consent';
import { sfx } from './game/sound';

/** /privacy route check, mirroring the admin pathname fork. */
export function isPrivacyRoute(): boolean {
  return typeof location !== 'undefined' && location.pathname.replace(/\/+$/, '') === '/privacy';
}

const LOCAL_KEYS = [
  'nvd-progress-v1',
  'nvd-consent-v1',
  'nvd-feedback-ids-v1',
  'nvd-feedback-read-v1',
  'nvd-feedback-dismissed-v1',
];

function exportLocalData(): void {
  const dump: Record<string, unknown> = {};
  for (const k of LOCAL_KEYS) {
    try {
      const raw = localStorage.getItem(k);
      if (raw != null) dump[k] = JSON.parse(raw);
    } catch { /* skip unreadable/non-JSON keys */ }
  }
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'neon-vector-defense-my-data.json';
  a.click();
  URL.revokeObjectURL(url);
}

function clearLocalData(): void {
  for (const k of LOCAL_KEYS) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  }
}

export default function PrivacyView() {
  const [state, setState] = useState(consentState());
  const gpc = gpcActive();
  const [cleared, setCleared] = useState(false);
  const sold = state.sell === 'optout' || gpc;

  const toggleSell = () => {
    sfx.click();
    setSell(sold && !gpc ? 'ok' : 'optout');
    setState(consentState());
  };

  const doDelete = () => {
    if (!confirm('Delete all the data this game stored on this device (progress, settings, callsign, privacy choices)? This cannot be undone.')) return;
    sfx.click();
    clearLocalData();
    resetConsent();
    setCleared(true);
  };

  return (
    <div className="privacy-root">
      <div className="privacy-box">
        <button className="privacy-back" onClick={() => { location.href = '/'; }}>← BACK TO GAME</button>
        <h1 className="privacy-title">PRIVACY POLICY</h1>
        <p className="privacy-meta">Neon Vector Defense · last updated 2026 · US players</p>

        <section>
          <h2>The short version</h2>
          <p>Neon Vector Defense is a browser game. You don't make an account and we don't ask for
            your name, email, or any contact info. We keep your progress on your own device and send
            a small amount of <b>anonymous</b> gameplay data to improve the game's balance.</p>
        </section>

        <section>
          <h2>What's stored on your device</h2>
          <p>In your browser's local storage: your progress and service record, saved layouts,
            audio settings, your leaderboard callsign (if you set one), a random per-device id
            (e.g. <code>w_ab12cd34</code>), and your privacy choices. None of this leaves your device
            except as described below. Clearing your browser data, or the button below, removes it.</p>
        </section>

        <section>
          <h2>What we collect (anonymous)</h2>
          <p>Tied only to that random per-device id — never to your identity:</p>
          <ul>
            <li><b>Leaderboard scores</b> you choose to submit (callsign, cash, kills, wave).</li>
            <li><b>Anonymous gameplay telemetry</b> (map, difficulty, wave reached, outcome) so we
              can tune balance.</li>
            <li>For a small <b>sample of runs</b>, more detailed analytics + a replay, kept
              temporarily and auto-deleted after about 30 days.</li>
            <li>Any <b>feedback</b> you send us, with that random id so we can reply.</li>
          </ul>
          <p>We use Google Firebase (Firestore) to store this. There are no third-party advertising
            cookies and no cross-site tracking.</p>
        </section>

        <section>
          <h2>Children</h2>
          <p>If you tell us you're under 13, the game switches to a safe mode: no public leaderboard
            callsign and no usage data collection at all.</p>
        </section>

        <section>
          <h2>Your choices (California / CCPA and everyone)</h2>
          <div className="privacy-controls">
            <div className="privacy-control">
              <div>
                <div className="privacy-control-name">Do Not Sell or Share My Info</div>
                <div className="privacy-control-sub">
                  {gpc
                    ? 'Your browser is sending a Global Privacy Control signal — already honored, analytics are off.'
                    : 'Turns off all analytics/telemetry collection. (We never actually sell data; this is the CCPA opt-out.)'}
                </div>
              </div>
              <button className={`privacy-toggle ${sold ? 'on' : ''}`} disabled={gpc} onClick={toggleSell}>
                {sold ? 'OPTED OUT' : 'OPT OUT'}
              </button>
            </div>

            <div className="privacy-control">
              <div>
                <div className="privacy-control-name">Download my data</div>
                <div className="privacy-control-sub">Export everything stored on this device as JSON.</div>
              </div>
              <button className="privacy-toggle" onClick={() => { sfx.click(); exportLocalData(); }}>DOWNLOAD</button>
            </div>

            <div className="privacy-control">
              <div>
                <div className="privacy-control-name">Delete my data</div>
                <div className="privacy-control-sub">
                  {cleared
                    ? 'Done — all local data for this device has been erased.'
                    : 'Erase all local game data. Anonymous server records carry no identity and auto-expire; to request server-side deletion too, message us via feedback.'}
                </div>
              </div>
              <button className="privacy-toggle danger" disabled={cleared} onClick={doDelete}>
                {cleared ? 'DELETED' : 'DELETE'}
              </button>
            </div>
          </div>
        </section>

        <section>
          <h2>Contact</h2>
          <p>Use the in-game feedback button (✉) to reach the developer about anything, including a
            data request.</p>
        </section>
      </div>
    </div>
  );
}
