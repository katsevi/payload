import { useEffect, useState, type ReactNode } from 'react';
import { catalog, computeBudgets, getScenario, type BudgetReport, type MissionDesign, type ScenarioDef } from '@payload/shared';
import { currentLocale } from '../i18n';
import { useDesign } from '../state/design';

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

export function useScenario(): ScenarioDef | undefined {
  const id = useDesign((s) => s.scenarioId);
  try {
    return getScenario(id, catalog);
  } catch {
    return catalog.scenarios.find((s) => s.id === id) ?? catalog.scenarios[0];
  }
}

/** Presupuestos del diseño actual (se recalcula en cada cambio del hangar). */
export function useBudgets(): BudgetReport | null {
  const scenarioId = useDesign((s) => s.scenarioId);
  const componentIds = useDesign((s) => s.componentIds);
  const orbitId = useDesign((s) => s.orbitId);
  const launcherId = useDesign((s) => s.launcherId);
  try {
    const d: MissionDesign = { scenarioId, componentIds, orbitId, launcherId };
    return scenarioId ? computeBudgets(d, catalog) : null;
  } catch {
    return null;
  }
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

export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.code === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="max-h-full w-full max-w-2xl overflow-auto">{children}</div>
    </div>
  );
}
