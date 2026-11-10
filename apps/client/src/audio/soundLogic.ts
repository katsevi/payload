/**
 * Catálogo puro de efectos: qué sonidos existen, por qué bus pasan y cuál es su equivalente visual
 * (flash de color y subtítulo de sonido). Los textos viven en `ui` (`sound.<id>`), con los corchetes
 * incluidos, p. ej. "[alarma]".
 */
import type { RunEvent } from '@payload/shared';

export type SfxId = 'click' | 'fixed' | 'toggle' | 'alarm' | 'ok' | 'sparks' | 'warnTick' | 'jump' | 'clunk' | 'impact' | 'success' | 'complete' | 'blip';

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
};

export const SFX_IDS = Object.keys(SFX_META) as SfxId[];

/** Sonido que acompaña a cada evento del motor (null = silencio). */
export function sfxForRunEvent(event: Pick<RunEvent, 'type' | 'incidentKind'>): SfxId | null {
  switch (event.type) {
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
    case 'lost':
      return 'impact';
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
