import { create } from 'zustand';

export type LaunchPhase = 'countdown' | 'ascent' | 'separation' | 'failure' | 'success';

/** Progreso de la secuencia de lanzamiento (lo escribe la escena, lo lee el HUD). */
interface LaunchProgress {
  phase: LaunchPhase;
  count: number;
  skip: boolean;
  set: (p: Partial<Pick<LaunchProgress, 'phase' | 'count' | 'skip'>>) => void;
  reset: () => void;
}

export const useLaunch = create<LaunchProgress>((set) => ({
  phase: 'countdown',
  count: 8,
  skip: false,
  set: (p) => set(p),
  reset: () => set({ phase: 'countdown', count: 8, skip: false }),
}));

/** La mascota hace de indicador de gravedad cero: flota desde la separación de etapas (ya en órbita). */
export const isMicrogravity = (phase: LaunchPhase): boolean => phase === 'separation' || phase === 'success';
