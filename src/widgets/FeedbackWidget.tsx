import { useCallback, useEffect, useState } from 'react';
import {
  submitFeedback,
  fetchFeedbackReplies,
  type FeedbackReply,
  type FeedbackReceipt,
} from '../game/leaderboard';
import { canSubmitScore } from '../game/consent';
import { appMetrics } from '../game/metrics';
import { sfx } from '../game/sound';
import { PERF_MAP, WIDGET_OPEN_EVENT } from '../appShared';

// ---------------- Feedback (always available, anonymous) ----------------

const FEEDBACK_RECEIPTS_KEY = 'nvd-feedback-receipts-v2';
const FEEDBACK_READ_KEY = 'nvd-feedback-read-v1';
const FEEDBACK_DISMISSED_KEY = 'nvd-feedback-dismissed-v1';

function loadFeedbackReceipts(): FeedbackReceipt[] {
  try {
    const raw = localStorage.getItem(FEEDBACK_RECEIPTS_KEY);
    if (!raw) return [];
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row): row is FeedbackReceipt => !!row
        && typeof row === 'object'
        && typeof row.id === 'string'
        && typeof row.token === 'string')
      .slice(-20);
  } catch {
    return [];
  }
}

function saveFeedbackReceipt(receipt: FeedbackReceipt) {
  const receipts = [...loadFeedbackReceipts().filter((x) => x.id !== receipt.id), receipt].slice(-20);
  try { localStorage.setItem(FEEDBACK_RECEIPTS_KEY, JSON.stringify(receipts)); } catch { /* non-fatal */ }
}

function feedbackReadAt(): number {
  try { return Number(localStorage.getItem(FEEDBACK_READ_KEY) ?? 0); } catch { return 0; }
}

function markFeedbackRead(ts: number) {
  try { localStorage.setItem(FEEDBACK_READ_KEY, String(ts)); } catch { /* non-fatal */ }
}

function loadDismissedReplyIds(): string[] {
  try {
    const raw = localStorage.getItem(FEEDBACK_DISMISSED_KEY);
    return raw ? JSON.parse(raw).filter((id: unknown) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveDismissedReplyIds(ids: string[]) {
  try { localStorage.setItem(FEEDBACK_DISMISSED_KEY, JSON.stringify([...new Set(ids)].slice(-50))); } catch { /* non-fatal */ }
}

export function FeedbackWidget({ ctx, blocked = false, sideOpen = false }: { ctx: string; blocked?: boolean; sideOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'inbox' | 'send'>('send');
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  const [replies, setReplies] = useState<FeedbackReply[]>([]);
  const [readAt, setReadAt] = useState(() => feedbackReadAt());
  const [dismissedReplies, setDismissedReplies] = useState<string[]>(() => loadDismissedReplyIds());
  const [checkingReplies, setCheckingReplies] = useState(false);
  const MAX = 1000;
  const refreshReplies = useCallback(async () => {
    setCheckingReplies(true);
    const rows = await fetchFeedbackReplies(loadFeedbackReceipts());
    rows.sort((a, b) => b.replyTs - a.replyTs);
    setReplies(rows);
    setCheckingReplies(false);
  }, []);
  useEffect(() => {
    if (PERF_MAP !== null) return;
    const intervalMs = open ? 15000 : 60000;
    if (open || !document.body.classList.contains('game-active')) void refreshReplies();
    const id = window.setInterval(() => {
      if (document.hidden) return;
      if (!open && document.body.classList.contains('game-active')) return;
      void refreshReplies();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [open, refreshReplies]);
  useEffect(() => {
    if (!open || replies.length === 0) return;
    const newest = Math.max(...replies.map((r) => r.replyTs));
    if (newest > readAt) {
      appMetrics.recordFeedbackReplyViewed(replies.filter((r) => r.replyTs > readAt).length);
      markFeedbackRead(newest);
      setReadAt(newest);
    }
  }, [open, readAt, replies]);
  useEffect(() => {
    if (blocked && open) setOpen(false);
  }, [blocked, open]);
  useEffect(() => {
    document.body.classList.toggle('fb-open', open);
    appMetrics.recordFeedbackWidget(open, ctx);
    window.dispatchEvent(new CustomEvent(WIDGET_OPEN_EVENT, { detail: { kind: 'feedback', open } }));
    return () => {
      document.body.classList.remove('fb-open');
      window.dispatchEvent(new CustomEvent(WIDGET_OPEN_EVENT, { detail: { kind: 'feedback', open: false } }));
    };
  }, [ctx, open]);
  if (PERF_MAP !== null) return null; // not during perf runs
  const canSendFeedback = canSubmitScore();
  const send = async () => {
    const t = text.trim();
    if (!t || !canSendFeedback) return;
    setState('busy');
    const receipt = await submitFeedback(t, ctx);
    if (!receipt) {
      appMetrics.recordFeedbackSubmit(false);
      setState('err');
      sfx.error();
      return;
    }
    appMetrics.recordFeedbackSubmit(true);
    saveFeedbackReceipt({ ...receipt, text: t, ctx, ts: Date.now() });
    setState('done');
    setText('');
    void refreshReplies();
    setTab('inbox');
    setTimeout(() => setState('idle'), 2200);
  };
  const visibleReplies = replies.filter((r) => !dismissedReplies.includes(r.id));
  const unread = visibleReplies.filter((r) => r.replyTs > readAt).length;
  const dismissedCount = replies.length - visibleReplies.length;
  const sentCount = loadFeedbackReceipts().length;
  const dismissReply = (id: string) => {
    const next = [...dismissedReplies, id];
    setDismissedReplies(next);
    saveDismissedReplyIds(next);
    sfx.click();
  };
  const restoreReplies = () => {
    setDismissedReplies([]);
    saveDismissedReplyIds([]);
    sfx.click();
  };
  return (
    <div
      className={`fb-root ${ctx === 'menu' ? 'on-menu' : 'on-game'} ${ctx === 'game' ? (sideOpen ? 'sidebar-open' : 'sidebar-collapsed') : ''} ${blocked ? 'widget-blocked' : ''}`}
      data-testid="message-widget"
    >
      {open && (
        <div className="fb-panel">
          <div className="fb-head">
            <span>MESSAGES</span>
            <button className="fb-x" aria-label="Close messages" onClick={() => { setOpen(false); sfx.click(); }}>✕</button>
          </div>
          <div className="fb-tabs">
            <button className={tab === 'inbox' ? 'on' : ''} onClick={() => { setTab('inbox'); sfx.click(); }}>
              INBOX{unread > 0 ? ` ${unread}` : ''}
            </button>
            <button className={tab === 'send' ? 'on' : ''} onClick={() => { setTab('send'); sfx.click(); }}>SEND</button>
          </div>
          {tab === 'inbox' && <div className="fb-replies">
            <div className="fb-section-row">
              <div className="fb-section-title">ADMIN REPLIES</div>
              <button className="fb-check" aria-label="Check for admin replies" disabled={checkingReplies} onClick={() => { void refreshReplies(); sfx.click(); }}>
                {checkingReplies ? 'CHECKING' : 'CHECK'}
              </button>
            </div>
            {visibleReplies.length > 0 ? (
              visibleReplies.slice(0, 4).map((r) => (
                <div key={r.id} className="fb-reply">
                  <div className="fb-reply-meta">
                    <span>{new Date(r.replyTs).toLocaleString()} / {r.ctx}</span>
                    <button className="fb-dismiss" title="Dismiss reply" aria-label="Dismiss admin reply" onClick={() => dismissReply(r.id)}>DISMISS</button>
                  </div>
                  <div className="fb-reply-body">{r.reply}</div>
                  {r.text && <div className="fb-reply-quote">You: {r.text}</div>}
                </div>
              ))
            ) : (
              <div className="fb-no-replies">
                {dismissedCount > 0
                  ? 'All admin replies are dismissed on this browser.'
                  : sentCount === 0
                    ? 'No messages sent from this browser yet.'
                    : 'No admin replies yet. Replies will appear here and the message icon will light up.'}
              </div>
            )}
            {dismissedCount > 0 && (
              <button className="fb-restore" onClick={restoreReplies}>RESTORE DISMISSED ({dismissedCount})</button>
            )}
          </div>}
          {tab === 'send' && !canSendFeedback ? (
            <div className="fb-no-replies">
              Safe mode is on, so free-text messages are disabled and nothing is sent off this device.
            </div>
          ) : tab === 'send' && (state === 'done' ? (
            <div className="fb-thanks">Transmission received. Admin replies will appear in Inbox.</div>
          ) : (
            <div className="fb-compose">
              <textarea className="fb-text" maxLength={MAX} value={text} autoFocus
                aria-label="Message to the developer"
                placeholder="Bug, idea, or anything at all — it goes straight to the developer."
                onChange={(e) => { setText(e.target.value); if (state === 'err') setState('idle'); }} />
              {state === 'err' && <div className="fb-error">Transmission failed. Your draft is still here; try again.</div>}
              <div className="fb-foot">
                <span className="fb-count">{text.length}/{MAX}</span>
                <button className="fb-send" aria-label="Send message to developer" disabled={!text.trim() || state === 'busy'} onClick={send}>
                  {state === 'busy' ? '…' : state === 'err' ? 'RETRY' : 'SEND ▸'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <button className={`fb-toggle ${unread ? 'has-reply' : ''}`} title={unread ? `${unread} admin reply` : 'Messages'} aria-label={unread ? `${unread} admin reply` : 'Messages'} aria-expanded={open} onClick={() => { setOpen((o) => { const next = !o; if (next && unread > 0) setTab('inbox'); return next; }); sfx.click(); }}>
        {open ? '✕' : '✉'}
      </button>
    </div>
  );
}
