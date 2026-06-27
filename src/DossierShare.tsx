import { useEffect, useState } from 'react';
import { renderDossierCanvas, dossierBlob, dossierShareUrl, type DossierInput } from './game/dossier';
import { sfx } from './game/sound';

// Share row for a Mission Dossier. The PNG is the real shareable artifact (works with no
// server); the ?run= link is offered only when the run was actually uploaded (runId present).
// Every action is feature-detected and try/caught — it must never throw inside an overlay.
export default function DossierShare({ input, runId, compact }: { input: DossierInput; runId?: string; compact?: boolean }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [toast, setToast] = useState('');

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
      } catch (e) { console.warn('dossier render failed', e); }
    })();
    return () => { live = false; };
  }, [input, compact]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 1800); };
  const fileName = `nvd-dossier-${input.mapId}-w${input.wave}.png`;
  const url = runId ? dossierShareUrl(runId) : null;
  const getBlob = async () => blob ?? (await dossierBlob(input));
  const hasShare = typeof navigator !== 'undefined' && 'share' in navigator;

  const onShare = async () => {
    sfx.click();
    try {
      const b = await getBlob(); if (!b) return flash('Render failed');
      const file = new File([b], fileName, { type: 'image/png' });
      const text = `Wave ${input.wave} · ${input.kills.toLocaleString()} hulls on ${input.mapName}`;
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      const canFiles = typeof nav.canShare === 'function' && nav.canShare({ files: [file] });
      if (canFiles) {
        await navigator.share({ title: 'Neon Vector Defense', text, files: [file], ...(url ? { url } : {}) });
      } else if (typeof nav.share === 'function') {
        await navigator.share({ title: 'Neon Vector Defense', text, ...(url ? { url } : {}) });
      } else { await onCopyCard(); }
    } catch { /* user cancelled or unsupported — no-op */ }
  };
  const onCopyCard = async () => {
    sfx.click();
    try {
      const b = await getBlob(); if (!b) return flash('Render failed');
      const Item = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (!Item || !navigator.clipboard?.write) return onDownload();
      await navigator.clipboard.write([new Item({ 'image/png': b })]);
      flash('Card copied');
    } catch { onDownload(); }
  };
  const onCopyLink = async () => {
    sfx.click();
    if (!url) return;
    try { await navigator.clipboard.writeText(url); flash('Link copied'); }
    catch { flash('Copy failed'); }
  };
  const onDownload = async () => {
    sfx.click();
    try {
      const b = await getBlob(); if (!b) return flash('Render failed');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      flash('Saved');
    } catch { flash('Save failed'); }
  };

  return (
    <div className={`dossier-share ${compact ? 'compact' : ''}`}>
      {!compact && (preview
        ? <img className="dossier-preview" src={preview} alt="Mission dossier card" />
        : <div className="dossier-preview placeholder">Rendering dossier…</div>)}
      <div className="dossier-actions">
        {hasShare && <button className="start-btn small" onClick={onShare}>⤴ SHARE</button>}
        <button className="start-btn small ghost" onClick={onCopyCard}>⧉ COPY CARD</button>
        {url && <button className="start-btn small ghost" onClick={onCopyLink}>🔗 COPY LINK</button>}
        <button className="start-btn small ghost" onClick={onDownload}>⭳ SAVE</button>
        {toast && <span className="dossier-toast">{toast}</span>}
      </div>
    </div>
  );
}
