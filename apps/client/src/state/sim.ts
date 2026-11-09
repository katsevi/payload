import { create } from 'zustand';
import {
  catalog,
  createMissionSim,
  rollPreLaunchEvents,
  type MissionDesign,
  type PreLaunchOutcome,
  type MissionResult,
  type MissionSim,
  type SimEvent,
  type SimSnapshot,
} from '@payload/shared';

/** Aceleraciones de tiempo disponibles (0 = pausa). */
export const TIME_SCALES = [0, 1, 10, 100, 1000, 10000] as const;
export type TimeScale = (typeof TIME_SCALES)[number];

export interface LoggedEvent extends SimEvent {
  id: number;
}

interface SimState {
  snapshot: SimSnapshot | null;
  events: LoggedEvent[];
  accel: TimeScale;
  launchOk: boolean | null;
  result: MissionResult | null;
  finished: boolean;
  seed: number | null;
  /** Eventos pre-lanzamiento sorteados tras el Go (retraso, recorte); null si aún no se sortearon. */
  preLaunch: PreLaunchOutcome | null;
  /** Sortea los eventos pre-lanzamiento con la semilla del intento y los guarda (no arranca la simulación). */
  rollPreLaunch: (design: MissionDesign, attempt?: number) => PreLaunchOutcome | null;
  /** Arranca la simulación; usa `preLaunch` del store (o el que se pase) para retraso y recorte. */
  start: (design: MissionDesign, attempt?: number, preLaunch?: PreLaunchOutcome | null) => void;
  tick: (dtSeconds: number) => void;
  setAccel: (a: TimeScale) => void;
  finish: () => MissionResult | null;
  clear: () => void;
}

// La simulación y el snapshot "vivo" viven fuera de React: la escena los lee cada frame sin re-renders.
let sim: MissionSim | null = null;
let live: SimSnapshot | null = null;
let lastPublish = 0;
let seed = 0;

/** Semilla por intento: defaultSeed del escenario + nº de intento (cada «Rediseñar» cambia el azar). */
export function missionSeed(scenarioId: string, attempt: number): number {
  const base = catalog.scenarios.find((s) => s.id === scenarioId)?.defaultSeed ?? 0;
  return base + attempt;
}
let eventSeq = 0;
let pending: LoggedEvent[] = [];

export const getLiveSnapshot = (): SimSnapshot | null => live;

function absorb(snap: SimSnapshot): void {
  live = snap;
  for (const e of snap.newEvents) {
    pending.push({ ...e, id: eventSeq++ });
  }
}

const LAUNCH_EVENTS = new Set(['launch-success', 'launch-failure']);

export const useSim = create<SimState>((set, get) => ({
  snapshot: null,
  events: [],
  accel: 1,
  launchOk: null,
  result: null,
  finished: false,
  seed: null,
  preLaunch: null,

  rollPreLaunch: (design, attempt = 0) => {
    let pre: PreLaunchOutcome | null = null;
    try {
      pre = rollPreLaunchEvents(design, catalog, missionSeed(design.scenarioId, attempt));
    } catch (e) {
      console.warn('[sim] rollPreLaunchEvents', e);
    }
    set({ preLaunch: pre });
    return pre;
  },

  start: (design, attempt = 0, preLaunchArg) => {
    pending = [];
    eventSeq = 0;
    seed = missionSeed(design.scenarioId, attempt);
    const preLaunch = preLaunchArg === undefined ? get().preLaunch : preLaunchArg;
    sim = createMissionSim(design, catalog, preLaunch ? { seed, preLaunch } : { seed });
    // El resultado del lanzamiento viene en los eventos del primer snapshot.
    let first = sim.snapshot();
    let hasLaunch = first.newEvents.some((e) => LAUNCH_EVENTS.has(e.type));
    absorb(first);
    if (!hasLaunch) {
      first = sim.step(0);
      hasLaunch = first.newEvents.some((e) => LAUNCH_EVENTS.has(e.type));
      absorb(first);
    }
    const all = [...pending];
    pending = [];
    const failed = all.some((e) => e.type === 'launch-failure') || first.status === 'failed';
    set({
      snapshot: first,
      events: all,
      accel: 1,
      launchOk: !failed,
      result: null,
      seed,
      preLaunch: preLaunch ?? null,
      finished: sim.isFinished(),
    });
    lastPublish = 0;
  },

  tick: (dt) => {
    if (!sim || get().accel === 0 || sim.isFinished()) return;
    absorb(sim.step(dt * get().accel));
    const now = performance.now();
    const done = sim.isFinished();
    if (done || now - lastPublish > 100) {
      lastPublish = now;
      const events = pending.length ? [...get().events, ...pending] : get().events;
      pending = [];
      set({ snapshot: live, events, finished: done, accel: done ? 0 : get().accel });
    }
  },

  setAccel: (accel) => set({ accel }),

  finish: () => {
    if (!sim) return null;
    const result = sim.finish();
    // finish() puede haber avanzado la simulación: absorber eventos finales.
    absorb(sim.snapshot());
    set({ result, snapshot: live, events: [...get().events, ...pending], finished: true, accel: 0 });
    pending = [];
    return result;
  },

  clear: () => {
    sim = null;
    live = null;
    pending = [];
    set({ snapshot: null, events: [], launchOk: null, result: null, finished: false, accel: 1, seed: null, preLaunch: null });
  },
}));
