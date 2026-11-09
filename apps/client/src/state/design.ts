import { create } from 'zustand';
import { catalog, type MissionDesign, type OrbitId, type ValidationIssue } from '@payload/shared';
import { useProgress } from './progress';

interface DesignState extends MissionDesign {
  /** Componente que el jugador lleva en las manos (hangar 3D). */
  heldId: string | null;
  /** Bloqueos de la última revisión No-Go (se muestran al volver al hangar). */
  lastIssues: ValidationIssue[];
  /**
   * Nº de intento del escenario; la semilla de la simulación es defaultSeed + intento. Sale del contador
   * persistido de `useProgress`, así que no se repite entre partidas (ni al volver del menú).
   */
  attempt: number;
  nextAttempt: () => void;
  startScenario: (scenarioId?: string) => void;
  add: (id: string) => void;
  /** Quita una unidad del componente (la última montada). */
  removeOne: (id: string) => void;
  popLast: () => void;
  setOrbit: (o: OrbitId | null) => void;
  setLauncher: (l: string | null) => void;
  hold: (id: string | null) => void;
  setLastIssues: (v: ValidationIssue[]) => void;
  design: () => MissionDesign;
}

export const useDesign = create<DesignState>((set, get) => ({
  scenarioId: '',
  componentIds: [],
  orbitId: null,
  launcherId: null,
  heldId: null,
  lastIssues: [],
  attempt: 0,
  nextAttempt: () => set((s) => ({ attempt: useProgress.getState().claimAttempt(s.scenarioId) })),
  startScenario: (scenarioId) => {
    const id = scenarioId ?? catalog.scenarios[0]?.id ?? '';
    set({
      scenarioId: id,
      componentIds: [],
      orbitId: null,
      launcherId: null,
      heldId: null,
      lastIssues: [],
      attempt: useProgress.getState().claimAttempt(id),
    });
  },
  add: (id) => set((s) => ({ componentIds: [...s.componentIds, id] })),
  removeOne: (id) =>
    set((s) => {
      const i = s.componentIds.lastIndexOf(id);
      if (i < 0) return s;
      return { componentIds: s.componentIds.filter((_, j) => j !== i) };
    }),
  popLast: () => set((s) => ({ componentIds: s.componentIds.slice(0, -1) })),
  setOrbit: (orbitId) => set({ orbitId }),
  setLauncher: (launcherId) => set({ launcherId }),
  hold: (heldId) => set({ heldId }),
  setLastIssues: (lastIssues) => set({ lastIssues }),
  design: () => {
    const { scenarioId, componentIds, orbitId, launcherId } = get();
    return { scenarioId, componentIds: [...componentIds], orbitId, launcherId };
  },
}));
