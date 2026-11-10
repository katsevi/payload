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

/** Aceleraciones de tiempo disponibles (0 = pausa). Las mismas que `TEAM_TIME_SCALES` de la sala. */
export const TIME_SCALES = [0, 1, 10, 100, 1000, 10000] as const;
export type TimeScale = (typeof TIME_SCALES)[number];

export const isTimeScale = (a: number): a is TimeScale => (TIME_SCALES as readonly number[]).includes(a);

export interface LoggedEvent extends SimEvent {
  id: number;
}

/** Objetivo que marca la sala en cada estado recibido (ver `mirrorFollow`). */
export interface MirrorTarget {
  /** Segundos de misión del servidor: la simulación local nunca pasa de aquí. */
  simT: number;
  /** Aceleración elegida en la sala (se conserva durante una pausa por alerta). */
  accel: number;
  /** Snapshot del servidor en `simT` (para detectar desincronizaciones); null si aún no hay. */
  snapshot: SimSnapshot | null;
  /** Resultado del lanzamiento según el servidor (null = aún no se sabe). */
  launchOk: boolean | null;
  finished: boolean;
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

  // ─── Sala (fase 3): simulación reflejada ─────────────────────────────────
  /**
   * Crea la simulación local con la semilla, el diseño y el `preLaunch` de la SALA (no con
   * `missionSeed`). Desde aquí `tick` avanza hacia el `simT` del servidor sin pasarlo nunca.
   * Devuelve false si el motor no pudo crearla: entonces se usan los snapshots del servidor tal cual.
   */
  mirrorStart: (opts: { design: MissionDesign; seed: number; preLaunch: PreLaunchOutcome | null }) => boolean;
  /** Nuevo objetivo de la sala (cada estado recibido): `simT`, aceleración, snapshot de control… */
  mirrorFollow: (target: MirrorTarget) => void;
  /** Solo si no hay simulación local (modo «servidor»): eventos de la vista de la sala. */
  mirrorEvents: (events: readonly SimEvent[]) => void;
  /** Resultado del informe que manda la sala (fuente de verdad). */
  setResult: (result: MissionResult | null) => void;
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
const PUBLISH_MS = 100;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : 0);

// ─── Reflejo de la sala ─────────────────────────────────────────────────────

/**
 * Si la simulación local va por detrás más de este tiempo REAL a la aceleración actual (p. ej. al entrar
 * a media operación o tras una pausa del navegador), salta de golpe hasta el `simT` del servidor.
 */
export const MIRROR_MAX_LAG_S = 0.5;
/** Resincronizaciones permitidas antes de renunciar a la simulación local y usar los snapshots del servidor. */
export const MIRROR_MAX_RESYNCS = 3;
const TIME_EPS = 1e-6;

interface MirrorState {
  design: MissionDesign;
  seed: number;
  preLaunch: PreLaunchOutcome | null;
  /** `simT` del servidor: tope de la simulación local. */
  capS: number;
  /** Tiempo pedido a la simulación local (suma de los `step`). */
  t: number;
  /** Último snapshot del servidor y si ya se comparó con el local. */
  serverSnap: SimSnapshot | null;
  checked: boolean;
  resyncs: number;
  /** Sin simulación local: el snapshot vivo es el del servidor. */
  driven: boolean;
}
let mirror: MirrorState | null = null;

/** ¿La simulación sigue a una sala (en vez de avanzar libre en solitario)? */
export const isMirroring = (): boolean => mirror !== null;
/** Solo diagnóstico/tests: estado del reflejo. */
export const mirrorInfo = (): { capS: number; t: number; resyncs: number; driven: boolean } | null =>
  mirror ? { capS: mirror.capS, t: mirror.t, resyncs: mirror.resyncs, driven: mirror.driven } : null;

const SNAPSHOT_NUMBERS = ['tSeconds', 'day', 'orbitPhase', 'batteryWh', 'batteryPct', 'dataStoredMbit', 'dataDownlinkedMbit', 'dataLostMbit'] as const;
const SNAPSHOT_FLAGS = ['inEclipse', 'inContact', 'status'] as const;
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Campos en los que difieren dos snapshots del mismo instante (vacío = coinciden). Ignora `newEvents`
 * (depende de cuándo se leyó) y tolera el redondeo de sumar el tiempo en trozos distintos.
 */
export function snapshotDiff(a: SimSnapshot, b: SimSnapshot): string[] {
  const out: string[] = [];
  for (const k of SNAPSHOT_NUMBERS) if (!close(a[k], b[k])) out.push(k);
  for (const k of SNAPSHOT_FLAGS) if (a[k] !== b[k]) out.push(k);
  return out;
}

export const useSim = create<SimState>((set, get) => {
  /** Crea la simulación y absorbe el primer snapshot (con el resultado del lanzamiento). */
  const begin = (design: MissionDesign, simSeed: number, preLaunch: PreLaunchOutcome | null) => {
    pending = [];
    eventSeq = 0;
    seed = simSeed;
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
  };

  /** Publica en React lo acumulado (como mucho ~10 Hz, o al terminar). */
  const publish = (force: boolean) => {
    const now = nowMs();
    const done = sim ? sim.isFinished() : get().finished;
    if (!force && !done && now - lastPublish <= PUBLISH_MS) return;
    lastPublish = now;
    const events = pending.length ? [...get().events, ...pending] : get().events;
    pending = [];
    set({ snapshot: live, events, finished: done });
  };

  /** Recrea la simulación local en el instante del servidor (añade solo los eventos que faltaban en el registro). */
  const resync = (m: MirrorState, target: SimSnapshot) => {
    m.resyncs += 1;
    if (m.resyncs > MIRROR_MAX_RESYNCS) {
      console.warn('[sim] la simulación local no coincide con la sala: se usan los snapshots del servidor');
      sim = null;
      m.driven = true;
      live = target;
      pending = [];
      set({ snapshot: target });
      return;
    }
    const logged = get().events;
    const lastT = logged.length ? logged[logged.length - 1]!.tSeconds : -1;
    sim = createMissionSim(m.design, catalog, m.preLaunch ? { seed: m.seed, preLaunch: m.preLaunch } : { seed: m.seed });
    const snap = sim.step(target.tSeconds);
    m.t = target.tSeconds;
    live = snap;
    pending = pending.filter((e) => e.tSeconds > lastT);
    for (const e of snap.newEvents) if (e.tSeconds > lastT) pending.push({ ...e, id: eventSeq++ });
    publish(true);
  };

  /** Compara el snapshot local con el del servidor cuando ambos están en el mismo instante. */
  const checkDesync = (m: MirrorState) => {
    const srv = m.serverSnap;
    if (!srv || m.checked || !live || Math.abs(live.tSeconds - srv.tSeconds) > TIME_EPS) return;
    m.checked = true;
    const diff = snapshotDiff(live, srv);
    if (diff.length === 0) return;
    console.warn(`[sim] desincronización con la sala en t=${srv.tSeconds} s (${diff.join(', ')}): se resincroniza`);
    resync(m, srv);
  };

  /** `tick` en sala: avanza hacia el `simT` del servidor, nunca más allá (si la sala está en pausa, se queda quieta). */
  const mirrorTick = (m: MirrorState, dt: number) => {
    if (m.driven || !sim) return;
    let advanced = false;
    const gap = m.capS - m.t;
    if (gap > TIME_EPS && !sim.isFinished()) {
      const accel = get().accel;
      const want = dt * accel;
      const jump = accel <= 0 || gap > accel * MIRROR_MAX_LAG_S || want >= gap;
      const step = jump ? gap : want;
      m.t = jump ? m.capS : m.t + step;
      absorb(sim.step(step));
      advanced = true;
    }
    checkDesync(m);
    // Al quedarse quieta en el tope (pausa o alerta) también se publica lo que faltaba (con el mismo límite de ~10 Hz).
    if (advanced || pending.length > 0 || get().snapshot !== live) publish(false);
  };

  return {
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
      mirror = null;
      const preLaunch = preLaunchArg === undefined ? get().preLaunch : preLaunchArg;
      begin(design, missionSeed(design.scenarioId, attempt), preLaunch ?? null);
    },

    tick: (dt) => {
      if (mirror) {
        mirrorTick(mirror, dt);
        return;
      }
      if (!sim || get().accel === 0 || sim.isFinished()) return;
      absorb(sim.step(dt * get().accel));
      const now = nowMs();
      const done = sim.isFinished();
      if (done || now - lastPublish > PUBLISH_MS) {
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
      mirror = null;
      set({ snapshot: null, events: [], launchOk: null, result: null, finished: false, accel: 1, seed: null, preLaunch: null });
    },

    mirrorStart: ({ design, seed: simSeed, preLaunch }) => {
      mirror = { design, seed: simSeed, preLaunch, capS: 0, t: 0, serverSnap: null, checked: true, resyncs: 0, driven: false };
      try {
        begin(design, simSeed, preLaunch);
        return true;
      } catch (e) {
        console.warn('[sim] no se pudo reflejar la simulación de la sala; se usan sus snapshots', e);
        sim = null;
        live = null;
        mirror.driven = true;
        set({ snapshot: null, events: [], launchOk: null, result: null, finished: false, seed: simSeed, preLaunch });
        return false;
      }
    },

    mirrorFollow: (target) => {
      const m = mirror;
      if (!m) return;
      const accel: TimeScale = isTimeScale(target.accel) ? target.accel : get().accel;
      if (target.snapshot !== m.serverSnap) {
        m.serverSnap = target.snapshot;
        m.checked = false;
      }
      // Nunca hacia atrás: el tope solo sube (un estado viejo no deshace lo ya simulado).
      m.capS = Math.max(m.capS, Number.isFinite(target.simT) ? target.simT : m.capS);
      const patch: Partial<SimState> = {};
      if (accel !== get().accel) patch.accel = accel;
      if (target.launchOk !== null && target.launchOk !== get().launchOk) {
        if (get().launchOk !== null && !m.driven) console.warn('[sim] el resultado del lanzamiento local no coincide con el de la sala');
        patch.launchOk = target.launchOk;
      }
      if (m.driven) {
        if (target.snapshot && target.snapshot !== live) {
          live = target.snapshot;
          patch.snapshot = live;
        }
        if (target.finished !== get().finished) patch.finished = target.finished;
      }
      if (Object.keys(patch).length > 0) set(patch);
      if (!m.driven) checkDesync(m);
    },

    mirrorEvents: (events) => {
      if (!mirror?.driven || events.length === 0) return;
      const logged = get().events;
      const lastT = logged.length ? logged[logged.length - 1]!.tSeconds : -1;
      const fresh = events.filter((e) => e.tSeconds > lastT).map((e) => ({ ...e, id: eventSeq++ }));
      if (fresh.length > 0) set({ events: [...logged, ...fresh] });
    },

    setResult: (result) => {
      if (result === get().result) return;
      set(result ? { result, finished: true, accel: 0 } : { result: null });
    },
  };
});
