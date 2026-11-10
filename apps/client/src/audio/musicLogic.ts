/**
 * Lógica pura de la música adaptativa (sin React ni Web Audio): qué capas suenan y con qué fuerza
 * según la fase del juego y el estado de la misión. El motor de audio solo aplica estos valores
 * (con fundidos); aquí no hay nada que dependa del navegador, así que se prueba en Vitest.
 */
import type { SimStatus } from '@payload/shared';
import type { PhaseName } from '../app/missionMachine';
import type { LaunchPhase } from '../state/launch';

export const MUSIC_LAYERS = ['pad', 'pulse', 'tension', 'drive', 'resolve'] as const;
export type MusicLayer = (typeof MUSIC_LAYERS)[number];
/** Ganancia objetivo (0-1) de cada capa. */
export type MusicMix = Record<MusicLayer, number>;

/** Por debajo de este % de batería entra la capa de tensión. */
export const LOW_BATTERY_PCT = 25;

export interface MusicContext {
  phase: PhaseName;
  /** Solo en la fase `launch`. */
  launchPhase?: LaunchPhase;
  /** Solo en la fase `operation`. */
  status?: SimStatus;
  batteryPct?: number;
  inEclipse?: boolean;
  /** Solo en la fase `report`: desenlace de la misión. */
  success?: boolean;
}

export const SILENT_MIX: MusicMix = { pad: 0, pulse: 0, tension: 0, drive: 0, resolve: 0 };
const mix = (p: Partial<MusicMix>): MusicMix => ({ ...SILENT_MIX, ...p });
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Capas de la fase `launch` según el momento de la secuencia. */
function launchMix(lp: LaunchPhase | undefined): MusicMix {
  switch (lp) {
    case 'ascent': return mix({ pad: 0.3, tension: 0.4, drive: 1 });
    case 'separation': return mix({ pad: 0.5, tension: 0.2, drive: 0.8, resolve: 0.15 });
    case 'failure': return mix({ pad: 0.1, tension: 1 });
    case 'success': return mix({ pad: 0.7, drive: 0.15, resolve: 0.6 });
    default: return mix({ pad: 0.4, tension: 0.55, drive: 0.25 }); // cuenta atrás
  }
}

/** Mezcla objetivo para un contexto. Todas las ganancias están en [0, 1]. */
export function musicMixFor(ctx: MusicContext): MusicMix {
  let m: MusicMix;
  switch (ctx.phase) {
    case 'menu':
    case 'lobby':
    case 'briefing':
      m = mix({ pad: 0.85 });
      break;
    case 'design':
      m = mix({ pad: 0.75, pulse: 0.12 });
      break;
    case 'review':
      m = mix({ pad: 0.55, tension: 0.5, pulse: 0.2 });
      break;
    case 'prelaunch':
      m = mix({ pad: 0.5, tension: 0.4, pulse: 0.3 });
      break;
    case 'launch':
      m = launchMix(ctx.launchPhase);
      break;
    case 'operation': {
      m = mix({ pad: 0.8, pulse: 0.5 });
      const low = ctx.batteryPct !== undefined && ctx.batteryPct < LOW_BATTERY_PCT;
      if (ctx.status === 'failed') m = mix({ pad: 0.25, tension: 1 });
      else if (ctx.status === 'degraded' || low) m = mix({ pad: 0.65, pulse: 0.55, tension: low && ctx.status === 'degraded' ? 0.9 : 0.65 });
      else if (ctx.status === 'complete') m = mix({ pad: 0.8, resolve: 0.5 });
      // En eclipse el pulso de telemetría se atenúa: la nave vive de la batería.
      if (ctx.inEclipse && ctx.status !== 'failed') m = { ...m, pulse: m.pulse * 0.6, pad: m.pad * 0.85 };
      break;
    }
    case 'report':
      m = ctx.success === false ? mix({ pad: 0.6, tension: 0.3 }) : mix({ pad: 0.6, resolve: 1 });
      break;
    default:
      m = mix({ pad: 0.5 });
  }
  const out = { ...m };
  for (const l of MUSIC_LAYERS) out[l] = clamp01(out[l]);
  return out;
}

export const sameMix = (a: MusicMix, b: MusicMix): boolean => MUSIC_LAYERS.every((l) => Math.abs(a[l] - b[l]) < 0.005);
