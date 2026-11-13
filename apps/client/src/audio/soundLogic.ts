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
  | 'sale' | 'purchase' | 'upgrade' | 'noCredits';

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
};

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
    case 'impact-evaded':
    case 'service':
    case 'cache':
      return 'ok';
    case 'overload':
    case 'blackout':
    case 'system-down':
    case 'low-oxygen':
    case 'low-fuel':
    case 'low-hull':
      return 'alarm';
    case 'sector-cleared':
      return 'success';
    default:
      return null;
  }
}
