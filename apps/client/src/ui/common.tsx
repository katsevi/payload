import { useEffect, useState, type ReactNode } from 'react';
import { currentLocale } from '../i18n';

export const fmt = (n: number, digits = 1): string =>
  Number.isFinite(n) ? n.toLocaleString(currentLocale(), { maximumFractionDigits: digits }) : '—';

/**
 * Panel del sistema visual: superficie con chaflán, cabecera con código decorativo (`code`, p. ej. «CFG-02»),
 * título y, a la derecha, `aside` (créditos, estado…). Sin título no hay cabecera.
 */
export function Panel({ title, code, aside, children, className = '' }: { title?: string; code?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`console-panel p-4 ${className}`}>
      {title && (
        <header className="panel-head">
          <span className="panel-code" aria-hidden="true">{code ?? '//'}</span>
          <h2 className="min-w-0">{title}</h2>
          <span className="ticks hidden flex-1 sm:block" aria-hidden="true" />
          {aside}
        </header>
      )}
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
    <div className="modal-backdrop absolute inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className={`ui-enter max-h-full w-full overflow-auto ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}>{children}</div>
    </div>
  );
}
