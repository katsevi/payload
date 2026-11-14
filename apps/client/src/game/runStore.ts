/**
 * Partida en curso. El motor (`@payload/shared`) manda: aquí solo se crea la `Run`, se avanza con
 * el tiempo real, se le pasan las acciones del jugador y se reparten sus eventos (avisos y sonido).
 *
 * - `getRun()` da el estado VIVO para leerlo por frame sin re-render (escena 3D).
 * - `useGame().hud` es una copia que React recibe a ~10 Hz o cuando hay eventos.
 */
import { create } from 'zustand';
import { createRun, type ActionResult, type EventTone, type MessageRef, type MissionDesign, type Run, type RunAction, type RunEvent, type RunState } from '@payload/shared';
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
    const events = run.takeEvents();
    let toasts = get().toasts;
    for (const e of events) {
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
    const state = run.snapshot();
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
      audio.stopLoop('roar', 0.4);
      stopSurfaceLoops(0.4);
      fx.shake = 0;
      useUi.getState().setDescentView(false);
      run = null;
      useUi.getState().setOverlay(null);
      useUi.getState().setPrompt(null);
      set({ screen: 'menu', hud: null, toasts: [] });
    },
    tick: (dt) => {
      if (!run) return;
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
