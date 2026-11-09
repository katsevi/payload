import { create } from 'zustand';
import type { AcademyStep } from '@payload/shared';

/** Progreso de la Academia en curso (no persistente; "completada" vive en `useProgress`). */
interface AcademyState {
  active: boolean;
  /** Índice del paso actual en `catalog.academy.steps` (== steps.length: terminada). */
  index: number;
  /** Ids de los pasos cumplidos de verdad (no los saltados porque su fase ya pasó). */
  completed: ReadonlySet<string>;
  /** Aviso puntual (clave ui), p. ej. revisión bloqueada; se borra al cambiar de paso. */
  notice: string | null;
  start: () => void;
  exit: () => void;
  /** Marca el paso actual como cumplido y avanza. */
  complete: (step: AcademyStep) => void;
  /** Mueve el índice sin marcar nada como cumplido (saltos por fase pasada, «Rediseñar»). */
  setIndex: (i: number) => void;
}

export const useAcademy = create<AcademyState>((set) => ({
  active: false,
  index: 0,
  completed: new Set(),
  notice: null,
  start: () => set({ active: true, index: 0, completed: new Set(), notice: null }),
  exit: () => set({ active: false, index: 0, completed: new Set(), notice: null }),
  complete: (step) =>
    set((s) => {
      const completed = new Set(s.completed);
      completed.add(step.id);
      return { completed, index: s.index + 1, notice: null };
    }),
  setIndex: (index) => set((s) => (s.index === index ? s : { index, notice: null })),
}));
