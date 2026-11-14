/**
 * Partida en curso. El motor (`@payload/shared`) manda: aquí solo se crea la `Run`, se avanza con
 * el tiempo real, se le pasan las acciones del jugador y se reparten sus eventos (avisos y sonido).
 *
 * - `getRun()` da el estado VIVO para leerlo por frame sin re-render (escena 3D).
 * - `useGame().hud` es una copia que React recibe a ~10 Hz o cuando hay eventos.
 * - En cooperativo (fase 6) la `Run` local es un ESPEJO de la del servidor: no avanza sola; se hidrata con
 *   cada estado recibido (`remoteState`) y las acciones se validan aquí y se envían (`enterRemote`).
 */
import { create } from 'zustand';
import { createRun, type ActionResult, type EventTone, type MessageRef, type MissionDesign, type Run, type RunAction, type RunEvent, type RunState } from '@payload/shared';
import { getLocalCrewId, setLocalCrewId } from './me';
import { audio } from '../audio/audioEngine';
import { cue } from '../audio/cues';
import { sfxForRunEvent } from '../audio/soundLogic';
import { useUi } from '../state/ui';
import { loadDesign, saveDesign } from './missionDesign';

export interface Toast {
  id: number;
  tone: EventTone;
  message: MessageRef;
  atMs: number;
}

export interface BestRun {
  sectors: number;
  score: number;
}

export const TOAST_MS = 4500;
const MAX_TOASTS = 4;
const HUD_INTERVAL_S = 0.1;
const BEST_KEY = 'payload.best';
/** Eventos que ya tienen su propio indicador en el HUD y no necesitan aviso de texto. */
const SILENT_TOASTS: ReadonlySet<RunEvent['type']> = new Set(['impact-warning', 'jump', 'new-sector', 'lost', 'sector-cleared']);

/** Efectos visuales puntuales que lee la escena por frame (sin pasar por React). */
export const fx = { shake: 0 };

/**
 * Dónde reaparece el jugador al volver a montar el interior de la nave (tras el descenso o la EVA).
 * null = el punto de partida de siempre. Lo guarda la escena de la nave al desmontarse.
 */
export const shipSpawn: { at: { x: number; z: number; yaw: number } | null } = { at: null };

/** Bucles de sonido de la superficie (se paran al cambiar de fase o de partida). */
const SURFACE_LOOPS = ['thruster', 'jetpack', 'storm', 'wind'] as const;
export function stopSurfaceLoops(fadeS = 0.4): void {
  for (const l of SURFACE_LOOPS) audio.stopLoop(l, fadeS);
}

/** Sacudida de cámara para los eventos de superficie (0 = ninguna). */
export function shakeForEvent(e: Pick<RunEvent, 'type' | 'subtype' | 'message'>): number {
  switch (e.type) {
    case 'impact-hit':
      // Esquiva con roces: sacudida menor; fallida o sin esquivar, el golpe entero.
      return e.subtype === 'graze' ? 0.45 : 1;
    case 'landing': {
      const speed = Number(e.message.params?.speed ?? 0);
      return e.subtype === 'hard' ? Math.min(1.8, 0.6 + speed * 0.08) : 0.25;
    }
    case 'terrain-warning':
      return 0.35;
    case 'terrain-collapsed':
      return 1.1;
    case 'suit-damaged':
      return 0.7;
    case 'take-off':
      return 0.6;
    default:
      return 0;
  }
}

let run: Run | null = null;
let hudClockS = 0;

/** Enlace con la sala en cooperativo (null = solitario). Lo pone la sesión de red (`net/coopSession`). */
export interface RemoteLink {
  /** Mi tripulante en la partida de la sala. */
  crewId: number;
  /** Envía una acción ya validada aquí contra el último estado del servidor. */
  send: (action: RunAction) => void;
  /** Abandona la sala (al volver al menú). */
  leave: () => void;
}
let remote: (RemoteLink & { last: RunState }) | null = null;

export const isRemote = (): boolean => remote !== null;

/** Eventos de OTRO tripulante que son solo suyos (su traje, su esclusa, su mochila): ni suenan ni avisan aquí. */
const PERSONAL_EVENTS: ReadonlySet<RunEvent['type']> = new Set(['suit-o2', 'suit-damaged', 'airlock', 'material-collected', 'tool-placed']);
const isOthersPersonal = (e: RunEvent): boolean => {
  const mine = getLocalCrewId();
  return mine !== null && e.crewId !== undefined && e.crewId !== mine && PERSONAL_EVENTS.has(e.type);
};
let toastSeq = 0;

export const getRun = (): Run | null => run;
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

function loadBest(): BestRun {
  try {
    const raw = JSON.parse(localStorage.getItem(BEST_KEY) ?? 'null') as Partial<BestRun> | null;
    if (raw && typeof raw.sectors === 'number' && typeof raw.score === 'number') return { sectors: raw.sectors, score: raw.score };
  } catch {
    /* sin almacenamiento */
  }
  return { sectors: 0, score: 0 };
}

function saveBest(best: BestRun): void {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    /* ignorar */
  }
}

export function randomSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}

/**
 * Pantalla: menú → elegir misión (`missions`) → diseño (`design`) → partida (`game`). La partida libre (sin diseño)
 * va directa del menú a la partida.
 */
export type Screen = 'menu' | 'missions' | 'design' | 'game';

const copyDesign = (d: MissionDesign): MissionDesign => ({ ...d, moduleIds: [...d.moduleIds], instrumentIds: [...d.instrumentIds] });

interface GameState {
  screen: Screen;
  /** Cambia en cada partida nueva (la escena se vuelve a montar y el jugador reaparece). */
  runId: number;
  /** Copia del estado para la interfaz (null fuera de la partida). */
  hud: RunState | null;
  toasts: Toast[];
  best: BestRun;
  /** La partida actual ha batido la mejor marca. */
  newBest: boolean;
  /** Diseño en la pantalla de diseño (fase 4). */
  draft: MissionDesign | null;
  /** Diseño con el que se juega la partida actual (null = partida libre). */
  runDesign: MissionDesign | null;
  /** Sin `design`, partida libre (clásica, fases 1-3). */
  startRun: (seed?: number, design?: MissionDesign | null) => void;
  toMenu: () => void;
  /** Menú → tarjetas de misión. */
  openMissions: () => void;
  /** Abre el diseño de una misión: el que se pase o el último guardado de esa misión. */
  openDesign: (missionId: string, design?: MissionDesign) => void;
  /** Cambia el diseño en curso (y lo guarda como el último de su misión). */
  updateDraft: (design: MissionDesign) => void;
  /** Zarpa con el diseño en curso. */
  launch: (seed?: number) => void;
  /** Fin de partida → vuelve al diseño con el mismo diseño cargado. */
  redesign: () => void;
  /** Cooperativo: empieza a reflejar la partida de la sala con su primer estado. */
  enterRemote: (state: RunState, link: RemoteLink) => void;
  /** Cooperativo: estado nuevo del servidor. */
  remoteState: (state: RunState) => void;
  /** Cooperativo: eventos del motor del servidor (sonidos, avisos, sacudidas). */
  remoteEvents: (events: RunEvent[]) => void;
  /** Cooperativo: el servidor rechazó una acción que aquí parecía válida. */
  remoteReject: (reason: MessageRef) => void;
  /** Cooperativo: deja de reflejar (la sala volvió al lobby o se perdió la conexión). */
  exitRemote: () => void;
  /** Avanza la partida `dt` segundos reales (lo llama la escena cada frame). */
  tick: (dt: number) => void;
  /** Acción del jugador. Con `quiet`, un rechazo no genera aviso (acciones mantenidas por frame). */
  act: (action: RunAction, quiet?: boolean) => ActionResult;
}

export const useGame = create<GameState>((set, get) => {
  const pushToast = (tone: EventTone, message: MessageRef): Toast[] => {
    const toast: Toast = { id: ++toastSeq, tone, message, atMs: nowMs() };
    // Un aviso repetido sustituye al anterior en lugar de apilarse.
    return [...get().toasts.filter((t) => t.message.key !== message.key || JSON.stringify(t.message.params) !== JSON.stringify(message.params)), toast].slice(-MAX_TOASTS);
  };

  /** Reparte los eventos pendientes del motor y refresca la copia de la interfaz. */
  const flush = (force: boolean): void => {
    if (!run) return;
    dispatch(run.takeEvents(), force);
  };

  /** Reparte eventos del motor (locales o del servidor) y, si hay algo nuevo, refresca la copia de la interfaz. */
  const dispatch = (events: RunEvent[], force: boolean): void => {
    if (!run) return;
    let toasts = get().toasts;
    for (const e of events) {
      if (isOthersPersonal(e)) continue;
      const sfx = sfxForRunEvent(e);
      if (sfx) cue(sfx);
      if (e.type === 'arrived' || e.type === 'lost') audio.stopLoop('roar', 1.2);
      fx.shake = Math.max(fx.shake, shakeForEvent(e));
      if (e.type === 'descent') useUi.getState().setDescentView(true);
      if (e.type === 'landing') audio.stopLoop('thruster', 0.3);
      if (e.type === 'storm-end') audio.stopLoop('storm', 2.5);
      if (e.type === 'take-off' || e.type === 'lost') {
        stopSurfaceLoops(e.type === 'lost' ? 1.2 : 0.4);
        // Perder la nave en el descenso (o despegar) apaga la vista exterior: el final se pinta sobre el puente.
        useUi.getState().setDescentView(false);
      }
      if (!SILENT_TOASTS.has(e.type)) {
        set({ toasts });
        toasts = pushToast(e.tone, e.message);
      }
    }
    if (!force && events.length === 0) return;
    // En sala, el último estado del servidor ya es una copia propia: no hace falta clonarlo otra vez.
    const state = remote ? remote.last : run.snapshot();
    const patch: Partial<GameState> = { hud: state, toasts };
    const ended = events.some((e) => e.type === 'lost' || e.type === 'sector-cleared');
    if (ended) {
      const best = get().best;
      if (state.stats.sectorsCleared > best.sectors || (state.stats.sectorsCleared === best.sectors && state.score > best.score)) {
        patch.best = { sectors: state.stats.sectorsCleared, score: state.score };
        patch.newBest = true;
        saveBest(patch.best);
      }
    }
    set(patch);
  };

  return {
    screen: 'menu',
    runId: 0,
    hud: null,
    toasts: [],
    best: loadBest(),
    newBest: false,
    draft: null,
    runDesign: null,
    startRun: (seed = randomSeed(), design = null) => {
      if (remote) return; // en sala, la partida la empieza el servidor
      audio.stopLoop('roar', 0.2);
      stopSurfaceLoops(0.2);
      shipSpawn.at = null;
      useUi.getState().setDescentView(false);
      useUi.getState().setPrompt(null);
      run = design ? createRun({ seed, design: copyDesign(design) }) : createRun({ seed });
      hudClockS = 0;
      fx.shake = 0;
      useUi.getState().setOverlay(null);
      set({ screen: 'game', runId: get().runId + 1, hud: run.snapshot(), toasts: [], newBest: false, runDesign: design ? copyDesign(design) : null });
    },
    openMissions: () => {
      get().toMenu();
      set({ screen: 'missions' });
    },
    openDesign: (missionId, design) => {
      if (run) get().toMenu();
      const draft = design ? copyDesign(design) : loadDesign(missionId);
      useUi.getState().setOverlay(null);
      set({ screen: 'design', draft });
    },
    updateDraft: (design) => {
      saveDesign(design);
      set({ draft: design });
    },
    launch: (seed) => {
      const draft = get().draft;
      if (!draft) return;
      saveDesign(draft);
      get().startRun(seed, draft);
    },
    redesign: () => {
      const d = get().runDesign ?? get().draft;
      if (!d) return get().toMenu();
      get().openDesign(d.missionId, d);
    },
    toMenu: () => {
      const link = remote;
      remote = null;
      setLocalCrewId(null);
      link?.leave();
      audio.stopLoop('roar', 0.4);
      stopSurfaceLoops(0.4);
      fx.shake = 0;
      useUi.getState().setDescentView(false);
      run = null;
      useUi.getState().setOverlay(null);
      useUi.getState().setPrompt(null);
      set({ screen: 'menu', hud: null, toasts: [] });
    },
    enterRemote: (state, link) => {
      audio.stopLoop('roar', 0.2);
      stopSurfaceLoops(0.2);
      shipSpawn.at = null;
      useUi.getState().setDescentView(state.phase === 'landing');
      useUi.getState().setPrompt(null);
      useUi.getState().setOverlay(null);
      // Misma semilla, tripulación y roles que el servidor: las consultas (rutas, precios, oferta) dan lo mismo.
      // Con diseño (fase 4), el espejo se crea con el mismo diseño: la nave base y el mapa del sistema solar
      // salen de él, y sin eso `hydrate` recalcularía la nave efectiva sobre la nave clásica.
      const design = state.missionDesign ?? null;
      run = createRun({ seed: state.seed, crewSize: state.crew.length, roles: state.crew.map((c) => c.role ?? null), ...(design ? { design } : {}) });
      run.hydrate(state);
      remote = { ...link, last: state };
      setLocalCrewId(link.crewId);
      hudClockS = 0;
      fx.shake = 0;
      set({ screen: 'game', runId: get().runId + 1, hud: state, toasts: [], newBest: false, runDesign: design ? copyDesign(design) : null });
    },
    remoteState: (state) => {
      if (!run || !remote) return;
      remote.last = state;
      run.hydrate(state);
      set({ hud: state });
    },
    remoteEvents: (events) => {
      if (!run || !remote) return;
      dispatch(events, false);
    },
    remoteReject: (reason) => {
      if (!remote) return;
      set({ toasts: pushToast('warn', reason) });
      if (reason.key === 'reject.noCredits') cue('noCredits');
    },
    exitRemote: () => {
      if (!remote) return;
      remote = null;
      setLocalCrewId(null);
      audio.stopLoop('roar', 0.4);
      stopSurfaceLoops(0.4);
      fx.shake = 0;
      run = null;
      useUi.getState().setDescentView(false);
      useUi.getState().setOverlay(null);
      useUi.getState().setPrompt(null);
      set({ screen: 'menu', hud: null, toasts: [] });
    },
    tick: (dt) => {
      if (!run) return;
      // En sala el tiempo lo lleva el servidor (y no hay pausa): aquí no se avanza nada.
      if (remote) return;
      const overlay = useUi.getState().overlay;
      if (overlay === 'pause' || overlay === 'settings' || overlay === 'credits') return;
      run.step(Math.min(dt, 0.25));
      hudClockS += dt;
      const due = hudClockS >= HUD_INTERVAL_S;
      if (due) hudClockS = 0;
      flush(due);
    },
    act: (action, quiet = false) => {
      if (!run) return { ok: false, reason: { key: 'reject.runOver' } };
      if (remote) {
        // Se valida en el espejo con mi tripulante (como hará el servidor) y se deshace: el estado solo cambia
        // cuando lo dice el servidor. Así la respuesta es inmediata y nada parpadea.
        const result = run.apply({ ...action, crewId: remote.crewId } as RunAction);
        run.takeEvents();
        run.hydrate(remote.last);
        if (result.ok) remote.send(action);
        else if (!quiet) {
          set({ toasts: pushToast('warn', result.reason) });
          if (result.reason.key === 'reject.noCredits') cue('noCredits');
        }
        return result;
      }
      const result = run.apply(action);
      if (!result.ok && !quiet) {
        set({ toasts: pushToast('warn', result.reason) });
        // Sin créditos en la terminal: suena y se ve (destello + subtítulo), no solo el aviso de texto.
        if (result.reason.key === 'reject.noCredits') cue('noCredits');
      }
      flush(!quiet);
      return result;
    },
  };
});
