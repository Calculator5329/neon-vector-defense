import { useState } from 'react';
import { ADULT_MIN_AGE, setAgeFromBirthDate } from './game/consent';
import { sfx } from './game/sound';

// Neutral entry age gate (a birth-year selection, NOT "are you 18?"). Required for
// US COPPA: under-13 takes a restricted, no-PII / no-behavioral-data path. Blocks
// first paint until answered. perf/demo bypass this (see App()).
const NOW_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 100 }, (_, i) => NOW_YEAR - i);
const MONTHS = [
  ['1', 'January'], ['2', 'February'], ['3', 'March'], ['4', 'April'],
  ['5', 'May'], ['6', 'June'], ['7', 'July'], ['8', 'August'],
  ['9', 'September'], ['10', 'October'], ['11', 'November'], ['12', 'December'],
];

export default function AgeGate({ onDone }: { onDone: () => void }) {
  const [year, setYear] = useState<number | ''>('');
  const [month, setMonth] = useState<number | ''>('');
  const [kid, setKid] = useState(false);

  const confirm = () => {
    if (year === '' || month === '') return;
    sfx.click();
    const band = setAgeFromBirthDate(year, month);
    if (band === 'under13') setKid(true); // brief notice, then continue restricted
    else onDone();
  };

  return (
    <div className="overlay age-gate">
      <div className="overlay-box age-gate-box">
        <div className="age-gate-eyebrow">LANTERN SEVEN · ACCESS</div>
        {kid ? (
          <>
            <h2>WELCOME, RECRUIT</h2>
            <p className="age-gate-copy">
              You're in <b>safe mode</b>: the game plays exactly the same, but we don't keep a
              public callsign for you or collect usage data. Have fun out there.
            </p>
            <button className="start-btn" onClick={() => { sfx.click(); onDone(); }}>ENTER THE GRID ▸</button>
          </>
        ) : (
          <>
            <h2>BEFORE YOU DEPLOY</h2>
            <p className="age-gate-copy">What month and year were you born? This sets your privacy options — we never share it.</p>
            <div className="age-gate-row">
              <select
                className="age-gate-select"
                value={month}
                onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : '')}
                aria-label="Birth month"
              >
                <option value="">Month</option>
                {MONTHS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select
                className="age-gate-select"
                value={year}
                onChange={(e) => setYear(e.target.value ? Number(e.target.value) : '')}
                aria-label="Birth year"
              >
                <option value="">Select year…</option>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button className="start-btn" disabled={year === '' || month === ''} onClick={confirm}>CONFIRM ▸</button>
            </div>
            <p className="age-gate-fine">
              Players under {ADULT_MIN_AGE} get a safe mode with no data collection and no public
              leaderboard. See our <a href="/privacy">Privacy Policy</a>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
