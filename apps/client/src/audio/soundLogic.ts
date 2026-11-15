/**
 * Catálogo puro de efectos: qué sonidos existen, por qué bus pasan y cuál es su equivalente visual
 * (flash de color y subtítulo de sonido). Los textos viven en `ui` (`sound.<id>`), con los corchetes
 * incluidos, p. ej. "[alarma]".
 */
import type { EventTone, RunEvent } from '@payload/shared';

export type SfxId =
  | 'click' | 'fixed' | 'toggle' | 'alarm' | 'ok' | 'sparks' | 'warnTick' | 'jump' | 'clunk' | 'impact' | 'success' | 'complete' | 'blip'
  // Superficie (fase 2)
  | 'descent' | 'thruster' | 'landSoft' | 'landHard' | 'airlock' | 'jetpack' | 'collect' | 'store' | 'stormWarn' | 'storm'
  | 'crack' | 'collapse' | 'o2Low' | 'o2Critical' | 'breath' | 'breathFast' | 'suitHit' | 'crewDead' | 'takeOff' | 'jettison' | 'wind' | 'fallWarn'
  | 'dodgeGraze' | 'dodgeHit' | 'skillHit' | 'skillMiss' | 'extinguisher'
  | 'toolPlace' | 'toolReady' | 'toolDone' | 'toolStop' | 'toolResume' | 'toolLost'
  // Terminal de estación (fase 3)
  | 'sale' | 'purchase' | 'upgrade' | 'noCredits'
  // Interfaz: foco, selección, paneles, mapa, energía, hangar, Go/No-Go, lanzamiento
  | 'hover' | 'select' | 'panelOpen' | 'panelClose' | 'mapOpen' | 'mapClose' | 'terminalOpen' | 'powerOn' | 'powerOff'
  | 'partAdd' | 'partRemove' | 'go' | 'noGo' | 'launch'
  // Tripulante: pasos según el suelo, toque de suelo tras el jetpack
  | 'stepShip' | 'stepDust' | 'stepRock' | 'stepIce' | 'footLand'
  // Cooperativo y peligros ambientales
  | 'ping' | 'crewJoin' | 'crewLeave' | 'creak' | 'hail'
  // Ciencia y estado de la nave
  | 'contact' | 'observation' | 'earthCall' | 'overheat' | 'powerDown' | 'storageFull';

/** Efectos en bucle: `cue(id)` los arranca y `audio.stopLoop(id)` los para. */
export const LOOP_SFX: readonly SfxId[] = ['jump', 'thruster', 'jetpack', 'storm', 'takeOff', 'wind', 'extinguisher'];

export type SoundBus = 'sfx' | 'alerts' | 'voice';
export type FlashTone = 'ok' | 'warn' | 'bad' | 'info';

export interface SfxMeta {
  /** `sfx` = efectos; `alerts` = avisos importantes. */
  bus: SoundBus;
  /** Clave ui del subtítulo de sonido (null = sin subtítulo, p. ej. los clics). */
  captionKey: string | null;
  /** Color del flash visual (null = sin flash). */
  flash: FlashTone | null;
  /** Separación mínima entre dos reproducciones (ms). */
  minGapMs: number;
}

export const SFX_META: Record<SfxId, SfxMeta> = {
  click: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 30 },
  fixed: { bus: 'sfx', captionKey: 'sound.fixed', flash: 'ok', minGapMs: 120 },
  toggle: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 80 },
  alarm: { bus: 'alerts', captionKey: 'sound.alarm', flash: 'bad', minGapMs: 2500 },
  ok: { bus: 'alerts', captionKey: 'sound.ok', flash: 'ok', minGapMs: 800 },
  sparks: { bus: 'sfx', captionKey: 'sound.sparks', flash: 'warn', minGapMs: 1500 },
  warnTick: { bus: 'alerts', captionKey: 'sound.warnTick', flash: 'warn', minGapMs: 900 },
  jump: { bus: 'sfx', captionKey: 'sound.jump', flash: 'info', minGapMs: 2000 },
  clunk: { bus: 'sfx', captionKey: 'sound.clunk', flash: 'info', minGapMs: 1000 },
  impact: { bus: 'alerts', captionKey: 'sound.impact', flash: 'bad', minGapMs: 600 },
  success: { bus: 'alerts', captionKey: 'sound.success', flash: 'ok', minGapMs: 2000 },
  complete: { bus: 'alerts', captionKey: 'sound.success', flash: 'ok', minGapMs: 2000 },
  blip: { bus: 'voice', captionKey: null, flash: null, minGapMs: 400 },
  descent: { bus: 'sfx', captionKey: 'sound.descent', flash: 'info', minGapMs: 2000 },
  thruster: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 0 },
  landSoft: { bus: 'sfx', captionKey: 'sound.landSoft', flash: 'ok', minGapMs: 1500 },
  landHard: { bus: 'alerts', captionKey: 'sound.landHard', flash: 'bad', minGapMs: 1500 },
  airlock: { bus: 'sfx', captionKey: 'sound.airlock', flash: 'info', minGapMs: 800 },
  jetpack: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 0 },
  collect: { bus: 'sfx', captionKey: 'sound.collect', flash: 'ok', minGapMs: 300 },
  store: { bus: 'sfx', captionKey: 'sound.store', flash: 'ok', minGapMs: 1000 },
  stormWarn: { bus: 'alerts', captionKey: 'sound.stormWarn', flash: 'warn', minGapMs: 3000 },
  storm: { bus: 'sfx', captionKey: 'sound.storm', flash: 'bad', minGapMs: 3000 },
  crack: { bus: 'alerts', captionKey: 'sound.crack', flash: 'warn', minGapMs: 700 },
  collapse: { bus: 'alerts', captionKey: 'sound.collapse', flash: 'bad', minGapMs: 1500 },
  o2Low: { bus: 'alerts', captionKey: 'sound.o2Low', flash: 'warn', minGapMs: 2000 },
  o2Critical: { bus: 'alerts', captionKey: 'sound.o2Critical', flash: 'bad', minGapMs: 300 },
  breath: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 500 },
  breathFast: { bus: 'sfx', captionKey: 'sound.breathFast', flash: null, minGapMs: 400 },
  suitHit: { bus: 'alerts', captionKey: 'sound.suitHit', flash: 'bad', minGapMs: 600 },
  crewDead: { bus: 'alerts', captionKey: 'sound.crewDead', flash: 'bad', minGapMs: 2000 },
  takeOff: { bus: 'sfx', captionKey: 'sound.takeOff', flash: 'info', minGapMs: 2000 },
  jettison: { bus: 'sfx', captionKey: 'sound.jettison', flash: 'warn', minGapMs: 1000 },
  wind: { bus: 'sfx', captionKey: 'sound.wind', flash: null, minGapMs: 3000 },
  fallWarn: { bus: 'alerts', captionKey: 'sound.fallWarn', flash: 'warn', minGapMs: 1500 },
  dodgeGraze: { bus: 'sfx', captionKey: 'sound.dodgeGraze', flash: 'warn', minGapMs: 150 },
  dodgeHit: { bus: 'alerts', captionKey: 'sound.dodgeHit', flash: 'bad', minGapMs: 250 },
  skillHit: { bus: 'sfx', captionKey: 'sound.skillHit', flash: 'ok', minGapMs: 100 },
  skillMiss: { bus: 'sfx', captionKey: 'sound.skillMiss', flash: null, minGapMs: 100 },
  extinguisher: { bus: 'sfx', captionKey: 'sound.extinguisher', flash: null, minGapMs: 0 },
  toolPlace: { bus: 'sfx', captionKey: 'sound.toolPlace', flash: 'info', minGapMs: 300 },
  toolReady: { bus: 'alerts', captionKey: 'sound.toolReady', flash: 'ok', minGapMs: 800 },
  toolDone: { bus: 'alerts', captionKey: 'sound.toolDone', flash: 'ok', minGapMs: 800 },
  toolStop: { bus: 'alerts', captionKey: 'sound.toolStop', flash: 'warn', minGapMs: 800 },
  toolResume: { bus: 'sfx', captionKey: 'sound.toolResume', flash: 'info', minGapMs: 800 },
  toolLost: { bus: 'alerts', captionKey: 'sound.toolLost', flash: 'bad', minGapMs: 1500 },
  sale: { bus: 'sfx', captionKey: 'sound.sale', flash: 'ok', minGapMs: 120 },
  purchase: { bus: 'sfx', captionKey: 'sound.purchase', flash: 'info', minGapMs: 120 },
  upgrade: { bus: 'alerts', captionKey: 'sound.upgrade', flash: 'ok', minGapMs: 400 },
  noCredits: { bus: 'alerts', captionKey: 'sound.noCredits', flash: 'warn', minGapMs: 300 },
  // Interfaz: sin subtítulo salvo Go/No-Go y lanzamiento (informan de un resultado).
  hover: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 150 },
  select: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 80 },
  panelOpen: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 120 },
  panelClose: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 120 },
  mapOpen: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 200 },
  mapClose: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 200 },
  terminalOpen: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 200 },
  powerOn: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 100 },
  powerOff: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 100 },
  partAdd: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 100 },
  partRemove: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 100 },
  go: { bus: 'sfx', captionKey: 'sound.go', flash: 'ok', minGapMs: 600 },
  noGo: { bus: 'sfx', captionKey: 'sound.noGo', flash: 'warn', minGapMs: 600 },
  launch: { bus: 'sfx', captionKey: 'sound.launch', flash: 'info', minGapMs: 3000 },
  // Pasos: sin subtítulo ni flash; el controlador los espacia por distancia recorrida.
  stepShip: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 170 },
  stepDust: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 170 },
  stepRock: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 170 },
  stepIce: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 170 },
  footLand: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 250 },
  ping: { bus: 'voice', captionKey: 'sound.ping', flash: 'info', minGapMs: 300 },
  crewJoin: { bus: 'voice', captionKey: 'sound.crewJoin', flash: null, minGapMs: 800 },
  crewLeave: { bus: 'voice', captionKey: 'sound.crewLeave', flash: null, minGapMs: 800 },
  creak: { bus: 'sfx', captionKey: 'sound.creak', flash: null, minGapMs: 4000 },
  hail: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 250 },
  contact: { bus: 'voice', captionKey: 'sound.contact', flash: 'info', minGapMs: 1500 },
  observation: { bus: 'sfx', captionKey: 'sound.observation', flash: 'ok', minGapMs: 800 },
  earthCall: { bus: 'voice', captionKey: 'sound.earthCall', flash: 'info', minGapMs: 1500 },
  overheat: { bus: 'alerts', captionKey: 'sound.overheat', flash: 'warn', minGapMs: 2500 },
  powerDown: { bus: 'alerts', captionKey: 'sound.powerDown', flash: 'bad', minGapMs: 2500 },
  storageFull: { bus: 'alerts', captionKey: 'sound.storageFull', flash: 'warn', minGapMs: 2500 },
};

/**
 * Ganancia por sonido sobre los volúmenes escritos en `sfxSynth.ts` (afinada con el laboratorio de audio,
 * `pnpm --filter @payload/client audio:report`, para que la jerarquía sea avisos > efectos > interfaz > música).
 * Sin entrada = 1. `jump` no se toca.
 */
export const SFX_GAIN: Partial<Record<SfxId, number>> = {
  airlock: 4.55,
  alarm: 1.55,
  blip: 2.48,
  breath: 2.45,
  breathFast: 5.38,
  click: 1.51,
  clunk: 0.88,
  collapse: 1.06,
  collect: 1.25,
  complete: 1.91,
  contact: 2.23,
  crack: 1.31,
  creak: 2.01,
  crewDead: 2.47,
  crewJoin: 1.19,
  crewLeave: 1.2,
  descent: 1.66,
  dodgeGraze: 6.03,
  dodgeHit: 1.86,
  earthCall: 1.56,
  extinguisher: 2.0,
  fallWarn: 1.08,
  fixed: 1.35,
  footLand: 0.7,
  go: 1.08,
  hail: 3.5,
  hover: 2.65,
  impact: 1.03,
  jetpack: 2.7,
  jettison: 2.27,
  landHard: 0.79,
  landSoft: 0.88,
  launch: 1.58,
  mapClose: 1.26,
  mapOpen: 1.25,
  noCredits: 2.1,
  noGo: 1.28,
  o2Critical: 1.38,
  o2Low: 1.36,
  observation: 1.9,
  ok: 1.17,
  overheat: 1.97,
  panelClose: 1.32,
  panelOpen: 1.2,
  partAdd: 1.04,
  partRemove: 2.03,
  ping: 1.62,
  powerDown: 1.69,
  powerOff: 0.87,
  powerOn: 0.85,
  purchase: 1.89,
  sale: 1.5,
  select: 1.2,
  skillHit: 1.72,
  skillMiss: 2.18,
  sparks: 6.51,
  stepDust: 1.95,
  stepIce: 1.76,
  stepRock: 1.04,
  stepShip: 0.7,
  storageFull: 3.13,
  store: 1.25,
  storm: 3.31,
  stormWarn: 4.45,
  success: 1.91,
  suitHit: 3.38,
  takeOff: 1.55,
  terminalOpen: 1.09,
  thruster: 1.6,
  toggle: 2.01,
  toolDone: 1.71,
  toolLost: 1.03,
  toolPlace: 1.46,
  toolReady: 1.77,
  toolResume: 2.88,
  toolStop: 1.94,
  upgrade: 1.88,
  warnTick: 1.59,
  wind: 5.76,
};

export type GroundKind = 'dust' | 'rock' | 'ice';

/** Suelo de cada mundo (para el timbre de los pasos). Lo no listado es roca. */
const ICE_WORLDS = new Set(['ice-core', 'ice-moon', 'enceladus-surface']);
const DUST_WORLDS = new Set(['dust-moon', 'mars-surface', 'titan-surface', 'storm-world']);

export function groundKindFor(worldId: string | undefined): GroundKind {
  if (worldId && ICE_WORLDS.has(worldId)) return 'ice';
  if (worldId && DUST_WORLDS.has(worldId)) return 'dust';
  return 'rock';
}

/** Sonido del paso: metal en la nave; en la superficie, según el mundo (más apagado: va con traje). */
export function stepSfxFor(onSurface: boolean, worldId?: string): SfxId {
  if (!onSurface) return 'stepShip';
  const g = groundKindFor(worldId);
  return g === 'ice' ? 'stepIce' : g === 'dust' ? 'stepDust' : 'stepRock';
}

/** Metros que se recorren entre dos pasos (andando / corriendo). */
export const STRIDE_WALK_M = 1.55;
export const STRIDE_RUN_M = 2.1;

/** Impactos contra el suelo por debajo de este umbral (m/s) suenan como un toque suave de los pies. */
export const FOOT_LAND_MIN_MPS = 1.2;


export const SFX_IDS = Object.keys(SFX_META) as SfxId[];

/** Sonido que acompaña a cada evento del motor (null = silencio). */
export function sfxForRunEvent(event: Pick<RunEvent, 'type' | 'incidentKind' | 'subtype'> & { tone?: EventTone }): SfxId | null {
  switch (event.type) {
    case 'descent':
      return 'descent';
    case 'landing':
      return event.subtype === 'hard' ? 'landHard' : 'landSoft';
    case 'airlock':
      return 'airlock';
    case 'material-collected':
      return 'collect';
    case 'cargo-stored':
      // Guardar y procesar llegan juntos: suena una vez.
      return event.subtype === 'processed' ? null : 'store';
    case 'storm-warning':
      return 'stormWarn';
    case 'storm-start':
      return 'storm';
    case 'storm-end':
      return 'ok';
    case 'terrain-warning':
      return 'crack';
    case 'terrain-collapsed':
      return 'collapse';
    case 'suit-o2':
      return event.subtype === 'critical' ? 'o2Critical' : 'o2Low';
    case 'suit-damaged':
      return 'suitHit';
    case 'crew-dead':
      return 'crewDead';
    case 'take-off':
      return 'takeOff';
    case 'jettison':
      return 'jettison';
    case 'jump':
      return 'jump';
    case 'arrived':
      return 'clunk';
    case 'incident':
    case 'incident-escalated':
    case 'fire-spread':
      return event.incidentKind === 'short' ? 'sparks' : 'alarm';
    case 'incident-fixed':
    case 'system-repaired':
      return 'fixed';
    case 'impact-warning':
      return 'warnTick';
    case 'impact-hit':
      // Esquiva con roces: un roce, no el golpe entero.
      return event.subtype === 'graze' ? 'dodgeGraze' : 'impact';
    case 'lost':
      return 'impact';
    case 'tool-placed':
      return 'toolPlace';
    case 'tool-done':
      return 'toolDone';
    case 'tool-stopped':
      return 'toolStop';
    case 'tool-resumed':
      return 'toolResume';
    case 'tool-lost':
      return 'toolLost';
    case 'sale':
    case 'reward':
      return 'sale';
    case 'purchase':
      return 'purchase';
    case 'upgrade':
      return 'upgrade';
    // Fase 8 · cordura: solo sonidos que ya existen.
    case 'crew-sanity':
      return event.subtype === 'recovered' ? 'ok' : event.subtype === 'tense' ? 'warnTick' : 'o2Low';
    case 'crew-lapse':
    case 'cohesion':
      return event.subtype === 'recovered' ? 'ok' : 'warnTick';
    case 'crew-rest':
      return event.subtype === 'done' ? 'ok' : null;
    case 'earth-call':
      return 'earthCall';
    case 'impact-evaded':
    case 'service':
    case 'cache':
      return 'ok';
    case 'blackout':
      return 'powerDown';
    case 'overload':
    case 'system-down':
    case 'low-oxygen':
    case 'low-fuel':
    case 'low-hull':
      return 'alarm';
    case 'sector-cleared':
    case 'objective-met':
    case 'mission-complete':
      return 'success';
    // Fase 5: ciencia y datos.
    case 'observation-done':
      return 'observation';
    case 'contact-start':
      return 'contact';
    case 'storage-full':
      return 'storageFull';
    case 'overheat':
      return 'overheat';
    case 'battery-empty':
      return 'powerDown';
    default:
      return null;
  }
}
