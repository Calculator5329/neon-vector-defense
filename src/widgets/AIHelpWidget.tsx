import { useEffect, useState } from 'react';
import { askAIHelp } from '../game/aiHelp';
import type { AIHelpContext } from '../game/aiContext';
import { appMetrics } from '../game/metrics';
import { sfx } from '../game/sound';
import { WIDGET_OPEN_EVENT } from '../appShared';

// ---------------- AI help (menu-only, rate-limited server side) ----------------

type AIChatMessage = { role: 'assistant' | 'user'; content: string };

export function AIHelpWidget({
  getContext,
  placement = 'menu',
  blocked = false,
  sideOpen = false,
}: {
  getContext: () => AIHelpContext;
  placement?: 'menu' | 'game';
  blocked?: boolean;
  sideOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'busy'>('idle');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [turnsRemaining, setTurnsRemaining] = useState<number | null>(null);
  const [conversationsRemaining, setConversationsRemaining] = useState<number | null>(null);
  const [messages, setMessages] = useState<AIChatMessage[]>([
    { role: 'assistant', content: 'Ask me about towers, waves, hidden hulls, unlocks, controls, or your last run.' },
  ]);

  const send = async () => {
    const q = text.trim();
    if (!q || state === 'busy') return;
    setText('');
    setState('busy');
    setMessages((m) => [...m, { role: 'user', content: q }]);
    appMetrics.recordAIQuestion('submit');
    try {
      const res = await askAIHelp(q, conversationId, getContext(), messages);
      setConversationId(res.conversationId);
      setTurnsRemaining(res.turnsRemaining);
      setConversationsRemaining(res.conversationsRemaining);
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }]);
      appMetrics.recordAIQuestion('success');
      sfx.click();
    } catch (error) {
      appMetrics.recordAIQuestion(error instanceof Error && /quota|limit|turns|chats/i.test(error.message) ? 'quota' : 'error');
      setMessages((m) => [...m, {
        role: 'assistant',
        content: error instanceof Error ? error.message : 'AI uplink is unavailable.',
      }]);
    } finally {
      setState('idle');
    }
  };

  const startNew = () => {
    setConversationId(undefined);
    setTurnsRemaining(null);
    setMessages([{ role: 'assistant', content: 'New uplink ready. What do you want to know about this run?' }]);
    sfx.click();
  };
  useEffect(() => {
    if (blocked && open) setOpen(false);
  }, [blocked, open]);
  useEffect(() => {
    document.body.classList.toggle('ai-open', open);
    appMetrics.recordAIWidget(open, placement);
    window.dispatchEvent(new CustomEvent(WIDGET_OPEN_EVENT, { detail: { kind: 'ai', open } }));
    return () => {
      document.body.classList.remove('ai-open');
      window.dispatchEvent(new CustomEvent(WIDGET_OPEN_EVENT, { detail: { kind: 'ai', open: false } }));
    };
  }, [open, placement]);

  return (
    <div
      className={`ai-root ${placement === 'game' ? 'in-game' : 'on-menu'} ${placement === 'game' ? (sideOpen ? 'sidebar-open' : 'sidebar-collapsed') : ''} ${blocked ? 'widget-blocked' : ''}`}
      data-testid="ai-widget"
    >
      {open && (
        <div className="ai-panel">
          <div className="ai-head">
            <span>WARDEN AI</span>
            <div className="ai-head-actions">
              <button className="ai-new" aria-label="Start new Warden AI chat" onClick={startNew}>NEW</button>
              <button className="ai-x" aria-label="Close Warden AI" onClick={() => { setOpen(false); sfx.click(); }}>✕</button>
            </div>
          </div>
          <div className="ai-log">
            {messages.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role}`}>{m.content}</div>
            ))}
            {state === 'busy' && <div className="ai-msg assistant">Thinking...</div>}
          </div>
          <form className="ai-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input
              className="ai-input"
              maxLength={900}
              aria-label="Ask Warden AI about the game"
              placeholder="Ask about the game..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="ai-send" aria-label="Send question to Warden AI" disabled={!text.trim() || state === 'busy'}>SEND</button>
          </form>
          {(turnsRemaining !== null || conversationsRemaining !== null) && (
            <div className="ai-quota">
              {turnsRemaining !== null && <span>{turnsRemaining} turns left</span>}
              {conversationsRemaining !== null && <span>{conversationsRemaining} chats left</span>}
            </div>
          )}
        </div>
      )}
      <button className="ai-toggle" title="Ask Warden AI" aria-label="Ask Warden AI" aria-expanded={open} onClick={() => { setOpen((o) => !o); sfx.click(); }}>
        AI
      </button>
    </div>
  );
}
