/**
 * Lógica pura de la música adaptativa (sin React ni Web Audio): qué capas suenan y con qué fuerza
 * según el momento de la partida. El motor de audio solo aplica estos valores con fundidos.
 */
import type { RunPhase } from '@payload/shared';

export const MUSIC_LAYERS = ['pad', 'pulse', 'tension', 'drive', 'resolve'] as const;
export type MusicLayer = (typeof MUSIC_LAYERS)[number];
/** Ganancia objetivo (0-1) de cada capa. */
export type MusicMix = Record<MusicLayer, number>;

export interface MusicContext {
  screen: 'menu' | 'game';
  phase?: RunPhase;
  /** Peligro 0-1: averías activas, avisos de impacto y recursos bajos. */
  danger?: number;
  /** El tripulante está fuera de la nave (EVA). */
  outside?: boolean;
}

export const SILENT_MIX: MusicMix = { pad: 0, pulse: 0, tension: 0, drive: 0, resolve: 0 };
const mix = (p: Partial<MusicMix>): MusicMix => ({ ...SILENT_MIX, ...p });
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Peligro 0-1 a partir del estado visible de la nave. */
export function dangerLevel(s: {
  incidents: number;
  warnings: number;
  overloaded: boolean;
  hullPct: number;
  oxygenPct: number;
  /** O₂ del traje (solo en EVA). */
  suitO2Pct?: number;
  /** Tormenta: 0 nada, 0,4 avisada, 1 encima. */
  storm?: number;
}): number {
  const low = (v: number, from: number) => clamp01((from - v) / from);
  const suit = s.suitO2Pct === undefined ? 0 : low(s.suitO2Pct, 40) * 0.9;
  return clamp01(s.incidents * 0.3 + s.warnings * 0.35 + (s.overloaded ? 0.25 : 0) + low(s.hullPct, 40) * 0.6 + low(s.oxygenPct, 45) * 0.8 + suit + (s.storm ?? 0) * 0.35);
}

/** Mezcla objetivo para un contexto. Todas las ganancias están en [0, 1]. */
export function musicMixFor(ctx: MusicContext): MusicMix {
  if (ctx.screen === 'menu') return mix({ pad: 0.85 });
  const d = clamp01(ctx.danger ?? 0);
  switch (ctx.phase) {
    case 'transit':
      return mix({ pad: 0.6 - d * 0.3, pulse: 0.45, drive: 0.35 + d * 0.45, tension: d });
    case 'landing':
      // Descenso: bajo rítmico y tensión que sube con el riesgo.
      return mix({ pad: 0.3, pulse: 0.35, drive: 0.55, tension: 0.25 + d * 0.6 });
    case 'surface':
      // Fuera: casi solo el pulso (el silencio del traje); dentro, la calma de la nave.
      return ctx.outside ? mix({ pad: 0.35 - d * 0.2, pulse: 0.3 + d * 0.3, tension: d * 0.95 }) : mix({ pad: 0.7 - d * 0.3, pulse: 0.1 + d * 0.2, tension: d * 0.85 });
    case 'won':
      return mix({ pad: 0.6, resolve: 1 });
    case 'lost':
      return mix({ pad: 0.25, tension: 0.7 });
    default:
      return mix({ pad: 0.75 - d * 0.3, pulse: 0.15 + d * 0.2, tension: d * 0.9 });
  }
}

export const sameMix = (a: MusicMix, b: MusicMix): boolean => MUSIC_LAYERS.every((l) => Math.abs(a[l] - b[l]) < 0.005);
