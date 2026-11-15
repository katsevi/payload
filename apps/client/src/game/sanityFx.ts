/**
 * Fase 8 · Cordura («Ánimo» en la interfaz): lógica visual pura. El motor decide la banda y el valor;
 * aquí solo se traduce a lo que se ve (medidor, nivel de color, viñeta). Sin recalcular nada de juego.
 */
import type { CrewMember, PsychRules, RunStats, SanityBand } from '@payload/shared';
import type { Level } from '../ui/Hud';

/** El medidor se oculta mientras la banda es estable y el valor pasa de este porcentaje. */
/** Antes se ocultaba por encima del 85 %; ahora el medidor se ve siempre que la cordura esté activa. */
export const MORALE_HIDE_ABOVE_PCT = 100;

export interface MoraleView {
  pct: number;
  level: Level;
  /** Marcador de la banda crítica en la barra. */
  markerPct: number;
}

/** Qué mostrar del ánimo de un tripulante (null = cordura apagada o nada que enseñar). */
export function moraleView(m: Pick<CrewMember, 'sanityPct' | 'sanityBand'> | null | undefined, rules: PsychRules | null): MoraleView | null {
  if (!rules || !m || m.sanityPct === undefined) return null;
  const band: SanityBand = m.sanityBand ?? 'stable';
  const level: Level = band === 'critical' || band === 'breakdown' ? 'bad' : band === 'tense' ? 'warn' : 'ok';
  return { pct: m.sanityPct, level, markerPct: rules.bands.critical };
}

export interface SanityVignette {
  /** Opacidad 0-1 de la viñeta (ya escalada por la intensidad de efectos). */
  alpha: number;
  /** Quiebre: pulso lento. */
  pulse: boolean;
  /** Desaturación parcial (crítica y quiebre), 0-1. */
  desaturate: number;
}

const NONE: SanityVignette = { alpha: 0, pulse: false, desaturate: 0 };

/** Efecto por banda (§ 9.3). `reduce` (ajuste «Reducir efectos de estrés») lo apaga entero. */
export function sanityVignette(band: SanityBand | undefined, effects: number, reduce: boolean): SanityVignette {
  if (reduce || !band || band === 'stable') return NONE;
  const k = Math.max(0, Math.min(1, effects));
  switch (band) {
    case 'tense':
      return { alpha: 0.18 * k, pulse: false, desaturate: 0 };
    case 'critical':
      return { alpha: 0.3 * k, pulse: false, desaturate: 0.25 * k };
    case 'breakdown':
      return { alpha: 0.45 * k, pulse: true, desaturate: 0.4 * k };
    default:
      return NONE;
  }
}

/** Contramedidas usadas (informe final): llamadas + provisiones + 1 si hubo descanso. 0 = la fila se oculta. */
export function countermeasures(st: Pick<RunStats, 'restS' | 'callsMade' | 'provisionsUsed'>): number {
  return (st.callsMade ?? 0) + (st.provisionsUsed ?? 0) + ((st.restS ?? 0) > 0 ? 1 : 0);
}
