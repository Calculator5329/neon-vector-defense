import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const monthRef = useRef<HTMLSelectElement>(null);
  const enterRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    window.setTimeout(() => {
      if (kid) enterRef.current?.focus();
      else monthRef.current?.focus();
    }, 0);
  }, [kid]);

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), select:not(:disabled), textarea:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? [])].filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const confirm = () => {
    if (year === '' || month === '') return;
    sfx.click();
    const band = setAgeFromBirthDate(year, month);
    if (band === 'under13') setKid(true); // brief notice, then continue restricted
    else onDone();
  };

  return (
    <div className="overlay age-gate">
      <div
        className="overlay-box age-gate-box"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={kid ? 'age-gate-safe-title' : 'age-gate-title'}
        aria-describedby={kid ? 'age-gate-safe-copy' : 'age-gate-copy'}
        onKeyDown={trapFocus}
      >
        <div className="age-gate-eyebrow">LANTERN SEVEN · ACCESS</div>
        {kid ? (
          <>
            <h2 id="age-gate-safe-title">WELCOME, RECRUIT</h2>
            <p className="age-gate-copy" id="age-gate-safe-copy">
              You're in <b>safe mode</b>: the game plays exactly the same, but we don't keep a
              public callsign for you or collect usage data. Have fun out there.
            </p>
            <button ref={enterRef} className="start-btn" onClick={() => { sfx.click(); onDone(); }}>ENTER THE GRID ▸</button>
          </>
        ) : (
          <>
            <h2 id="age-gate-title">BEFORE YOU DEPLOY</h2>
            <p className="age-gate-copy" id="age-gate-copy">What month and year were you born? This sets your privacy options — we never share it.</p>
            <div className="age-gate-row">
              <select
                ref={monthRef}
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
