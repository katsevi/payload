/**
 * Lógica pura de la música adaptativa (sin React ni Web Audio): qué escena musical suena, con qué
 * capas y en qué escalón de peligro. El generador (`musicSynth.ts`) toca la partitura de la escena y
 * aplica las ganancias con fundidos; el motor (`audioEngine.ts`) solo compara mezclas con `sameMix`.
 */
import type { RunPhase } from '@payload/shared';

/**
 * Escenas musicales (cada una con su modo, tempo y progresión en `musicSynth.ts`):
 * `none` silencio · `menu` tema principal · `hangar` diseño/misiones · `calm` a bordo ·
 * `transit` salto · `landing` descenso · `eva` superficie fuera de la nave · `won` · `lost`.
 */
export const MUSIC_SCENES = ['none', 'menu', 'hangar', 'calm', 'transit', 'landing', 'eva', 'won', 'lost'] as const;
export type MusicScene = (typeof MUSIC_SCENES)[number];

/**
 * Capas (voces) de la partitura. Tres familias tímbricas: pad (`pad`, `tension`),
 * campana FM (`arp`, `bell`) y bajo (`bass`, `drive`, `pulse`).
 */
export const MUSIC_LAYERS = ['pad', 'bass', 'arp', 'bell', 'drive', 'pulse', 'tension'] as const;
export type MusicLayer = (typeof MUSIC_LAYERS)[number];

/** Escalón de peligro: 0 nada · 1 latido · 2 + tritono · 3 latido al doble. Una variable por escalón. */
export type DangerTier = 0 | 1 | 2 | 3;

/** Mezcla objetivo: escena, escalón de peligro y ganancia (0-1) de cada capa. */
export type MusicMix = Record<MusicLayer, number> & { scene: MusicScene; tier: DangerTier };

export type MusicScreen = 'menu' | 'missions' | 'design' | 'game';

export interface MusicContext {
  screen: MusicScreen;
  phase?: RunPhase;
  /** Peligro 0-1: averías activas, avisos de impacto y recursos bajos. */
  danger?: number;
  /** El tripulante está fuera de la nave (EVA). */
  outside?: boolean;
}

const ZERO: Record<MusicLayer, number> = { pad: 0, bass: 0, arp: 0, bell: 0, drive: 0, pulse: 0, tension: 0 };
export const SILENT_MIX: MusicMix = { ...ZERO, scene: 'none', tier: 0 };
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

/** Umbrales de peligro de cada escalón (1, 2 y 3). */
export const DANGER_TIERS = [0.2, 0.5, 0.8] as const;

export function dangerTier(danger: number): DangerTier {
  const d = clamp01(danger);
  return d >= DANGER_TIERS[2] ? 3 : d >= DANGER_TIERS[1] ? 2 : d >= DANGER_TIERS[0] ? 1 : 0;
}

/** Escena musical de un contexto. */
export function musicSceneFor(ctx: MusicContext): MusicScene {
  if (ctx.screen === 'menu') return 'menu';
  if (ctx.screen === 'design' || ctx.screen === 'missions') return 'hangar';
  switch (ctx.phase) {
    case 'transit':
      return 'transit';
    case 'landing':
      return 'landing';
    case 'surface':
      return ctx.outside ? 'eva' : 'calm';
    case 'won':
      return 'won';
    case 'lost':
      return 'lost';
    default:
      return 'calm';
  }
}

/** Capas base de cada escena (sin peligro). Pocas a la vez: el lecho deja sitio a efectos y alarmas. */
const BASE: Record<MusicScene, Partial<Record<MusicLayer, number>>> = {
  none: {},
  menu: { pad: 0.9, bass: 0.6, bell: 0.8, arp: 0.35 },
  hangar: { pad: 0.6, bass: 0.5, arp: 0.7 },
  calm: { pad: 0.8, bass: 0.55, arp: 0.45, bell: 0.5 },
  transit: { pad: 0.6, drive: 0.75, arp: 0.5 },
  landing: { pad: 0.55, drive: 0.65, arp: 0.3 },
  eva: { pad: 0.5, bell: 0.45 },
  won: { pad: 0.85, bass: 0.6, bell: 0.85 },
  lost: { pad: 0.7, bell: 0.6 },
};

/** Escenas donde el peligro de la partida se oye. */
const DANGER_SCENES: ReadonlySet<MusicScene> = new Set(['calm', 'transit', 'landing', 'eva']);

/**
 * Mezcla objetivo para un contexto. Todas las ganancias están en [0, 1].
 * Tensión escalonada (una variable por escalón): 1 entra el latido, 2 entra el tritono, 3 el latido
 * dobla su ritmo (el generador lee `tier`). Nada más cambia: la escalada se lee clara.
 */
export function musicMixFor(ctx: MusicContext): MusicMix {
  const scene = musicSceneFor(ctx);
  const tier = DANGER_SCENES.has(scene) ? dangerTier(ctx.danger ?? 0) : 0;
  const m: MusicMix = { ...ZERO, ...BASE[scene], scene, tier };
  if (tier >= 1) m.pulse = 0.8;
  if (tier >= 2) m.tension = 0.7;
  // Escalón 3: solo cambia el ritmo del latido (lo lee el generador con `tier`).
  return m;
}

export const sameMix = (a: MusicMix, b: MusicMix): boolean =>
  a.scene === b.scene && a.tier === b.tier && MUSIC_LAYERS.every((l) => Math.abs(a[l] - b[l]) < 0.005);
