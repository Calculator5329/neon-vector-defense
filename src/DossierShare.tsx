import { useEffect, useState } from 'react';
import { renderDossierCanvas, dossierBlob, dossierShareUrl, type DossierInput } from './game/dossier';
import { sfx } from './game/sound';

// Share row for a Mission Dossier. The PNG is the real shareable artifact (works with no
// server); the ?run= link is offered only when the run was actually uploaded (runId present).
// Every action is feature-detected and try/caught — it must never throw inside an overlay.
export default function DossierShare({ input, runId, compact }: { input: DossierInput; runId?: string; compact?: boolean }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Pre-render the preview image (full mode only; compact builds on first action).
  useEffect(() => {
    if (compact) return;
    let live = true;
    (async () => {
      try {
        const cv = await renderDossierCanvas(input);
        if (!live) return;
        setPreview(cv.toDataURL('image/png'));
        cv.toBlob((b) => { if (live) setBlob(b); }, 'image/png');
      } catch (e) {
        console.warn('dossier render failed', e);
        if (live) setToast({ kind: 'err', text: 'Dossier preview unavailable.' });
      }
    })();
    return () => { live = false; };
  }, [input, compact]);

  const flash = (text: string, kind: 'ok' | 'err' | 'info' = 'ok') => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 2200);
  };
  const fileName = `nvd-dossier-${input.mapId}-w${input.wave}.png`;
  const url = runId ? dossierShareUrl(runId) : null;
  const getBlob = async () => blob ?? (await dossierBlob(input));
  const hasShare = typeof navigator !== 'undefined' && 'share' in navigator;

  const onShare = async () => {
    sfx.click();
    setBusy(true);
    try {
      const b = await getBlob(); if (!b) return flash('Render failed', 'err');
      const file = new File([b], fileName, { type: 'image/png' });
      const text = `Wave ${input.wave} · ${input.kills.toLocaleString()} hulls on ${input.mapName}`;
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      const canFiles = typeof nav.canShare === 'function' && nav.canShare({ files: [file] });
      if (canFiles) {
        await navigator.share({ title: 'Neon Vector Defense', text, files: [file], ...(url ? { url } : {}) });
      } else if (typeof nav.share === 'function') {
        await navigator.share({ title: 'Neon Vector Defense', text, ...(url ? { url } : {}) });
      } else { return await onCopyCard(); }
      flash('Share sheet opened');
    } catch { flash('Share cancelled or unavailable', 'info'); }
    finally { setBusy(false); }
  };
  const onCopyCard = async () => {
    sfx.click();
    setBusy(true);
    try {
      const b = await getBlob(); if (!b) return flash('Render failed', 'err');
      const Item = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (!Item || !navigator.clipboard?.write) {
        flash('Clipboard unavailable, saving instead', 'info');
        return onDownload();
      }
      await navigator.clipboard.write([new Item({ 'image/png': b })]);
      flash('Card copied');
    } catch {
      flash('Clipboard unavailable, saving instead', 'info');
      await onDownload();
    } finally { setBusy(false); }
  };
  const onCopyLink = async () => {
    sfx.click();
    if (!url) return flash('Replay link unavailable', 'err');
    setBusy(true);
    try { await navigator.clipboard.writeText(url); flash('Link copied'); }
    catch { flash('Copy failed', 'err'); }
    finally { setBusy(false); }
  };
  const onDownload = async () => {
    sfx.click();
    setBusy(true);
    try {
      const b = await getBlob(); if (!b) return flash('Render failed', 'err');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      flash('Saved');
    } catch { flash('Save failed', 'err'); }
    finally { setBusy(false); }
  };

  return (
    <div className={`dossier-share ${compact ? 'compact' : ''}`} aria-busy={busy}>
      {!compact && (preview
        ? <img className="dossier-preview" src={preview} alt="Mission dossier card" />
        : <div className="dossier-preview placeholder" role="status">Rendering dossier…</div>)}
      <div className="dossier-actions">
        {hasShare && <button className="start-btn small" disabled={busy} onClick={onShare} aria-label="Share dossier" title="Share dossier">⤴ SHARE</button>}
        <button className="start-btn small ghost" disabled={busy} onClick={onCopyCard} aria-label="Copy dossier card image" title="Copy card image">⧉ COPY CARD</button>
        {url && <button className="start-btn small ghost" disabled={busy} onClick={onCopyLink} aria-label="Copy replay link" title="Copy replay link">🔗 COPY LINK</button>}
        <button className="start-btn small ghost" disabled={busy} onClick={onDownload} aria-label="Save dossier PNG" title="Save PNG">⭳ SAVE</button>
        {toast && <span className={`dossier-toast ${toast.kind}`} role={toast.kind === 'err' ? 'alert' : 'status'} aria-live="polite">{toast.text}</span>}
      </div>
    </div>
  );
}
