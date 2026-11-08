import { create } from 'zustand';
import { catalog, type MissionDesign, type OrbitId, type ValidationIssue } from '@payload/shared';

interface DesignState extends MissionDesign {
  /** Componente que el jugador lleva en las manos (hangar 3D). */
  heldId: string | null;
  /** Bloqueos de la última revisión No-Go (se muestran al volver al hangar). */
  lastIssues: ValidationIssue[];
  /** Nº de intento (0 = primero); la semilla de la simulación es defaultSeed + intento. */
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
  nextAttempt: () => set((s) => ({ attempt: s.attempt + 1 })),
  startScenario: (scenarioId) =>
    set({
      scenarioId: scenarioId ?? catalog.scenarios[0]?.id ?? '',
      componentIds: [],
      orbitId: null,
      launcherId: null,
      heldId: null,
      lastIssues: [],
      attempt: 0,
    }),
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
