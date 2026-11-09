/**
 * Catálogo puro de efectos: qué sonidos existen, por qué bus pasan y cuál es su equivalente visual
 * (flash de color y subtítulo de sonido). Los textos viven en `ui` (`sound.<id>`), con los corchetes
 * incluidos, p. ej. "[alarma de batería]".
 */
import type { SimEventType } from '@payload/shared';

export type SfxId =
  | 'click' | 'mount' | 'unmount' | 'batteryAlarm' | 'contact' | 'radioStatic' | 'countdownTick'
  | 'liftoff' | 'separation' | 'explosion' | 'success' | 'complete' | 'mascotBlip';

export type SoundBus = 'sfx' | 'alerts' | 'voice';
export type FlashTone = 'ok' | 'warn' | 'bad' | 'info';

export interface SfxMeta {
  /** `sfx` = efectos; `alerts` = avisos importantes; `voice` = voz de la mascota (los dos últimos usan el control de avisos). */
  bus: SoundBus;
  /** Clave ui del subtítulo de sonido (null = sin subtítulo, p. ej. los clics). */
  captionKey: string | null;
  /** Color del flash visual (null = sin flash: ya hay otro indicador, p. ej. el número de la cuenta atrás). */
  flash: FlashTone | null;
  /** Separación mínima entre dos reproducciones (ms), contra el spam a 10 000x. */
  minGapMs: number;
}

export const SFX_META: Record<SfxId, SfxMeta> = {
  click: { bus: 'sfx', captionKey: null, flash: null, minGapMs: 30 },
  mount: { bus: 'sfx', captionKey: 'sound.mount', flash: null, minGapMs: 120 },
  unmount: { bus: 'sfx', captionKey: 'sound.unmount', flash: null, minGapMs: 120 },
  batteryAlarm: { bus: 'alerts', captionKey: 'sound.batteryAlarm', flash: 'bad', minGapMs: 8000 },
  contact: { bus: 'alerts', captionKey: 'sound.contact', flash: 'ok', minGapMs: 6000 },
  radioStatic: { bus: 'sfx', captionKey: 'sound.radioStatic', flash: 'warn', minGapMs: 4000 },
  countdownTick: { bus: 'alerts', captionKey: 'sound.countdownTick', flash: null, minGapMs: 300 },
  liftoff: { bus: 'sfx', captionKey: 'sound.liftoff', flash: 'info', minGapMs: 2000 },
  separation: { bus: 'sfx', captionKey: 'sound.separation', flash: 'info', minGapMs: 2000 },
  explosion: { bus: 'alerts', captionKey: 'sound.explosion', flash: 'bad', minGapMs: 2000 },
  success: { bus: 'alerts', captionKey: 'sound.success', flash: 'ok', minGapMs: 2000 },
  complete: { bus: 'alerts', captionKey: 'sound.complete', flash: 'ok', minGapMs: 2000 },
  mascotBlip: { bus: 'voice', captionKey: null, flash: null, minGapMs: 400 },
};

export const SFX_IDS = Object.keys(SFX_META) as SfxId[];

/** Sonido que acompaña a cada evento del motor (null = silencio: eclipses y cambios menores). */
export function sfxForSimEvent(type: SimEventType | string): SfxId | null {
  switch (type) {
    case 'battery-low':
    case 'battery-depleted':
      return 'batteryAlarm';
    case 'contact-start':
      return 'contact';
    case 'component-failure':
    case 'solar-storm':
    case 'reaction-wheel-failure':
    case 'debris-avoidance':
    case 'overheating':
    case 'storage-full':
      return 'radioStatic';
    case 'mission-complete':
      return 'complete';
    default:
      return null;
  }
}

/** Efecto del lanzamiento al cambiar de fase de la secuencia (la cuenta atrás va aparte). */
export function sfxForLaunchPhase(phase: string): SfxId | null {
  switch (phase) {
    case 'ascent': return 'liftoff';
    case 'separation': return 'separation';
    case 'failure': return 'explosion';
    case 'success': return 'success';
    default: return null;
  }
}

/** La cuenta atrás suena los últimos 5 segundos. */
export const countdownTickAt = (count: number): boolean => count >= 1 && count <= 5;
