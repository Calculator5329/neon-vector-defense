import { useEffect, useState } from 'react';
import { boardId, fetchTopResult, fetchGlobalTopResult, fetchDailyTop, fetchWeeklyTop, fetchGauntletTop, type ScoreEntry, type RankedScoreEntry } from '../game/leaderboard';
import { dailyChallenge, type DailyChallenge } from '../game/dailyChallenge';
import { weeklyChallenge, type WeeklyChallenge, type WeeklyGauntletDoc } from '../game/weeklyChallenge';
import { cachedServerUid } from '../game/anonAuth';
import { progress } from '../game/storage';
import { appMetrics } from '../game/metrics';
import { sfx } from '../game/sound';
import type { GameMap, DifficultyDef } from '../game/types';
import { isRunId } from '../appShared';

// Shared leaderboard cells — the callsign (name + YOU + freeplay meta tags) and the WATCH
// deep-link render identically in the global and local boards.
function BoardName({ r, mine, fp }: { r: ScoreEntry; mine: boolean; fp: boolean }) {
  return (
    <span className="board-name">
      <span>{r.name}</span>
      {mine && <em className="board-you">YOU</em>}
      {fp && (r.meta || r.daily || r.checkpoint) && (
        <span className="board-meta-tags">
          {r.checkpoint && <b>CHECKPOINT</b>}
          {r.daily && <b>DAILY</b>}
          {r.meta && <em>{r.meta}</em>}
        </span>
      )}
    </span>
  );
}
function WatchCell({ runId }: { runId?: string }) {
  return (
    <span className="board-watch">
      {isRunId(runId) ? <a className="watch-btn" href={`/?run=${runId}`} title="Watch this battle plan">▶ WATCH</a> : null}
    </span>
  );
}

type LeaderboardMode = 'campaign' | 'freeplay' | 'daily' | 'weekly' | 'gauntlet';

export function LeaderboardTab({
  map,
  diff,
  daily = dailyChallenge(),
  weekly = weeklyChallenge(),
  gauntlet = null,
  initialMode = 'campaign',
}: {
  map: GameMap;
  diff: DifficultyDef;
  daily?: DailyChallenge;
  weekly?: WeeklyChallenge;
  gauntlet?: WeeklyGauntletDoc | null;
  initialMode?: LeaderboardMode;
}) {
  const [mode, setMode] = useState<LeaderboardMode>(initialMode);
  const [globalRows, setGlobalRows] = useState<RankedScoreEntry[] | null>(null);
  const [localRows, setLocalRows] = useState<ScoreEntry[] | null>(null);
  const [ritualRows, setRitualRows] = useState<ScoreEntry[] | null>(null);
  const [globalError, setGlobalError] = useState(false);
  const [localError, setLocalError] = useState(false);
  const fp = mode === 'freeplay';
  const board = boardId(map.id, diff.id, fp);
  // Server rows carry the authenticated anonymous uid; the local uid fallback
  // only covers browsers that read boards before anonymous sign-in has warmed.
  const myUid = cachedServerUid() ?? progress.uid;
  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);
  useEffect(() => {
    let live = true;
    setGlobalRows(null);
    setLocalRows(null);
    setRitualRows(null);
    setGlobalError(false);
    setLocalError(false);
    if (mode === 'daily' || mode === 'weekly' || mode === 'gauntlet') {
      const load = mode === 'daily'
        ? fetchDailyTop(daily.id, 20)
        : mode === 'weekly'
          ? fetchWeeklyTop(weekly.id, 20)
          : gauntlet ? fetchGauntletTop(gauntlet.week, 20) : Promise.resolve([]);
      load.then((rows) => { if (live) setRitualRows(rows); }).catch(() => {
        if (live) { setRitualRows([]); setGlobalError(true); }
      });
      return () => { live = false; };
    }
    Promise.all([fetchGlobalTopResult(fp, 20), fetchTopResult(board, 5)]).then(([global, local]) => {
      if (!live) return;
      setGlobalRows(global.rows);
      setLocalRows(local.rows);
      setGlobalError(global.error);
      setLocalError(local.error);
    });
    return () => { live = false; };
  }, [board, daily.id, fp, gauntlet, mode, weekly.id]);
  const ritualTitle = mode === 'daily' ? 'DAILY' : mode === 'weekly' ? 'WEEKLY' : mode === 'gauntlet' ? 'GAUNTLET' : '';
  const ritualEmpty = mode === 'daily'
    ? 'No daily records yet - deploy the challenge and set the pace.'
    : mode === 'weekly'
      ? 'No weekly mutation records yet - deploy and set the pace.'
      : gauntlet
        ? 'No gauntlet attempts yet - take the first shot.'
        : 'Weekly Champion Gauntlet has not been crowned yet.';
  return (
    <div className="board-tab">
      <div className="board-head">
        <div className="board-title">GLOBAL LEADERBOARD <span>{ritualTitle || (fp ? 'FREEPLAY' : 'CAMPAIGN')}</span></div>
        <div className="board-modes">
          <button className={mode === 'campaign' ? 'on' : ''} onClick={() => { appMetrics.recordLeaderboardMode(false); setMode('campaign'); sfx.click(); }}>CAMPAIGN</button>
          <button className={mode === 'freeplay' ? 'on' : ''} onClick={() => { appMetrics.recordLeaderboardMode(true); setMode('freeplay'); sfx.click(); }}>FREEPLAY</button>
          <button className={mode === 'daily' ? 'on' : ''} onClick={() => { setMode('daily'); sfx.click(); }}>DAILY</button>
          <button className={mode === 'weekly' ? 'on' : ''} onClick={() => { setMode('weekly'); sfx.click(); }}>WEEKLY</button>
          <button className={mode === 'gauntlet' ? 'on' : ''} onClick={() => { setMode('gauntlet'); sfx.click(); }}>GAUNTLET</button>
        </div>
      </div>
      {(mode === 'daily' || mode === 'weekly' || mode === 'gauntlet') ? (
        <div className="board-list board-global fp daily-board-mode" data-testid="daily-leaderboard-mode">
          <div className="board-row board-row-head">
            <span className="board-rank">#</span>
            <span className="board-name">CALLSIGN</span>
            <span className="board-wave">WAVE</span>
            <span className="board-kills">HULLS</span>
            <span className="board-cash">CREDITS</span>
            <span className="board-watch">REPLAY</span>
          </div>
          {ritualRows === null ? (
            <div className="board-empty">Checking {ritualTitle.toLowerCase()} board...</div>
          ) : globalError ? (
            <div className="board-empty">{ritualTitle} leaderboard uplink failed - try again in a moment.</div>
          ) : ritualRows.length === 0 ? (
            <div className="board-empty">{ritualEmpty}</div>
          ) : ritualRows.map((r, i) => (
            <div key={`${r.runId || r.name}-${i}`} className={`board-row ${r.uid === myUid ? 'me' : ''}`}>
              <span className="board-rank">{i + 1}</span>
              <BoardName r={r} mine={r.uid === myUid} fp />
              <span className="board-wave">{r.wave}</span>
              <span className="board-kills">{r.kills.toLocaleString()}</span>
              <span className="board-cash">{`\u232c${r.cash.toLocaleString()}`}</span>
              <WatchCell runId={r.runId} />
            </div>
          ))}
        </div>
      ) : (
        <>
      <div className={`board-list board-global ${fp ? 'fp' : ''}`}>
        <div className="board-row board-row-head">
          <span className="board-rank">#</span>
          <span className="board-name">CALLSIGN</span>
          <span className="board-context">SECTOR</span>
          <span className="board-context">PROTOCOL</span>
          {fp && <span className="board-wave">WAVE</span>}
          <span className="board-kills">HULLS</span>
          <span className="board-cash">CREDITS</span>
          <span className="board-watch">REPLAY</span>
        </div>
        {globalRows === null ? (
          <div className="board-empty">Establishing uplink...</div>
        ) : globalError ? (
          <div className="board-empty">Leaderboard uplink failed - check your connection and try again.</div>
        ) : globalRows.length === 0 ? (
          <div className="board-empty">No global records yet - deploy and claim the top spot.</div>
        ) : (
          globalRows.map((r, i) => (
            <div key={`${r.board}-${i}`} className={`board-row ${r.uid === myUid ? 'me' : ''}`}>
              <span className="board-rank">{i + 1}</span>
              <BoardName r={r} mine={r.uid === myUid} fp={fp} />
              <span className="board-context">{r.mapName}</span>
              <span className="board-context">{r.diffName}</span>
              {fp && <span className="board-wave">{r.wave}</span>}
              <span className="board-kills">{r.kills.toLocaleString()}</span>
              <span className="board-cash">{`\u232c${r.cash.toLocaleString()}`}</span>
              <WatchCell runId={r.runId} />
            </div>
          ))
        )}
      </div>
      <div className="board-local-head">
        <span>{map.name}</span>
        <b>{diff.name}</b>
      </div>
      <div className={`board-list board-local ${fp ? 'fp' : ''}`}>
        <div className="board-row board-row-head">
          <span className="board-rank">#</span>
          <span className="board-name">CALLSIGN</span>
          {fp && <span className="board-wave">WAVE</span>}
          <span className="board-cash">CREDITS</span>
          <span className="board-watch">REPLAY</span>
        </div>
        {localRows === null ? (
          <div className="board-empty compact">Checking local board...</div>
        ) : localError ? (
          <div className="board-empty compact">Could not load this sector board. Try again in a moment.</div>
        ) : localRows.length === 0 ? (
          <div className="board-empty compact">No records for this sector/protocol yet.</div>
        ) : (
          localRows.map((r, i) => (
            <div key={i} className={`board-row ${r.uid === myUid ? 'me' : ''}`}>
              <span className="board-rank">{i + 1}</span>
              <BoardName r={r} mine={r.uid === myUid} fp={fp} />
              {fp && <span className="board-wave">{r.wave}</span>}
              <span className="board-cash">{`\u232c${r.cash.toLocaleString()}`}</span>
              <WatchCell runId={r.runId} />
            </div>
          ))
        )}
      </div>
      <div className="board-foot">{fp ? 'Global freeplay ranks by wave reached' : 'Global campaign ranks by credits earned'} - local board follows your deploy selection</div>
        </>
      )}
    </div>
  );
}
