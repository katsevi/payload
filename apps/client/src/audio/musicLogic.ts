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
}

export const SILENT_MIX: MusicMix = { pad: 0, pulse: 0, tension: 0, drive: 0, resolve: 0 };
const mix = (p: Partial<MusicMix>): MusicMix => ({ ...SILENT_MIX, ...p });
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Peligro 0-1 a partir del estado visible de la nave. */
export function dangerLevel(s: { incidents: number; warnings: number; overloaded: boolean; hullPct: number; oxygenPct: number }): number {
  const low = (v: number, from: number) => clamp01((from - v) / from);
  return clamp01(s.incidents * 0.3 + s.warnings * 0.35 + (s.overloaded ? 0.25 : 0) + low(s.hullPct, 40) * 0.6 + low(s.oxygenPct, 45) * 0.8);
}

/** Mezcla objetivo para un contexto. Todas las ganancias están en [0, 1]. */
export function musicMixFor(ctx: MusicContext): MusicMix {
  if (ctx.screen === 'menu') return mix({ pad: 0.85 });
  const d = clamp01(ctx.danger ?? 0);
  switch (ctx.phase) {
    case 'transit':
      return mix({ pad: 0.6 - d * 0.3, pulse: 0.45, drive: 0.35 + d * 0.45, tension: d });
    case 'won':
      return mix({ pad: 0.6, resolve: 1 });
    case 'lost':
      return mix({ pad: 0.25, tension: 0.7 });
    default:
      return mix({ pad: 0.75 - d * 0.3, pulse: 0.15 + d * 0.2, tension: d * 0.9 });
  }
}

export const sameMix = (a: MusicMix, b: MusicMix): boolean => MUSIC_LAYERS.every((l) => Math.abs(a[l] - b[l]) < 0.005);
