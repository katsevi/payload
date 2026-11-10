import { useEffect, useState, type ReactNode } from 'react';
import { currentLocale } from '../i18n';

export const fmt = (n: number, digits = 1): string =>
  Number.isFinite(n) ? n.toLocaleString(currentLocale(), { maximumFractionDigits: digits }) : '—';

export function Panel({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`console-panel p-4 ${className}`}>
      {title && <h2 className="num mb-3 border-b border-line pb-2 text-sm uppercase tracking-widest text-accent">{title}</h2>}
      {children}
    </section>
  );
}

/** true mientras el ratón está capturado (pointer lock) por el canvas. */
export function usePointerLocked(): boolean {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const f = () => setLocked(!!document.pointerLockElement);
    document.addEventListener('pointerlockchange', f);
    return () => document.removeEventListener('pointerlockchange', f);
  }, []);
  return locked;
}

export function Modal({ children, onClose, wide = false }: { children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.code === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className={`max-h-full w-full overflow-auto ${wide ? "max-w-5xl" : "max-w-2xl"}`}>{children}</div>
    </div>
  );
}
