import { useEffect, useRef, type ReactNode, type KeyboardEvent } from 'react';

// Shared dialog primitive: focus trap + autofocus + Esc-to-close + focus restore +
// role/aria-modal, with optional backdrop-click close. Extracted from AgeGate so every
// overlay gets consistent, accessible dialog behavior. Supports both visual families
// (.overlay/.overlay-box default, or pass cutscene classes) without changing their styles.

const FOCUSABLE = 'a[href], button:not(:disabled), select:not(:disabled), textarea:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

export default function Modal({
  onClose,
  children,
  labelledBy,
  describedBy,
  overlayClass = 'overlay',
  boxClass = 'overlay-box',
  closeOnBackdrop = true,
  closeOnEsc = true,
  style,
  testId,
}: {
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
  describedBy?: string;
  overlayClass?: string;
  boxClass?: string;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  style?: React.CSSProperties;
  testId?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    const box = boxRef.current;
    const first = box?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box)?.focus();
    return () => { restoreRef.current?.focus?.(); };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (closeOnEsc && e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const box = boxRef.current;
    if (!box) return;
    const focusable = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className={overlayClass} data-testid={testId} onClick={closeOnBackdrop ? onClose : undefined}>
      <div
        ref={boxRef}
        className={boxClass}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
