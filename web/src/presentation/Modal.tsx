import {useEffect, useRef, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';

export function Modal({title, children, onClose, wide = false}: {title: string; children: ReactNode; onClose: () => void; wide?: boolean}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fallback = useRef<HTMLDivElement>(null), close = useRef(onClose); close.current = onClose;
  const native = typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal === 'function';
  useEffect(() => {
    if (native) { const el = dialog.current!; el.showModal(); return () => el.close(); }
    const el = fallback.current!, previous = document.activeElement;
    const focusable = () => [...el.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')].filter(node => node.getClientRects().length);
    (focusable()[0] ?? el).focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close.current(); }
      if (e.key === 'Tab') {
        const items = focusable(), index = items.indexOf(document.activeElement as HTMLElement);
        if (index === -1 || (!e.shiftKey && index === items.length - 1) || (e.shiftKey && index === 0)) {
          e.preventDefault(); (e.shiftKey ? items[items.length - 1] ?? el : items[0] ?? el).focus();
        }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      if (previous instanceof HTMLElement && previous.isConnected) {
        const target = previous.getClientRects().length ? previous : previous.closest('.header-actions')?.querySelector<HTMLElement>('.actions-trigger');
        target?.focus();
      }
    };
  }, [native]);
  const contents = <><header className="modal-heading"><h2>{title}</h2><button className="icon-button" title="关闭" aria-label="关闭" onClick={onClose}><X size={20}/></button></header>{children}</>;
  if (!native) return createPortal(<div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={fallback} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`modal fallback-modal ${wide ? 'wide' : ''}`}>{contents}</div>
  </div>, document.body);
  return <dialog ref={dialog} className={`modal ${wide ? 'wide' : ''}`} aria-label={title} onCancel={e => { if (e.target === e.currentTarget) { e.preventDefault(); onClose(); } }}
    onClick={e => { if (e.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    {contents}
  </dialog>;
}
