/**
 * Esquiva de asteroides en el timón (lógica PURA, sin Three.js ni React). Cuando hay un aviso de impacto,
 * quien está al timón pilota la nave unos segundos entre rocas que llegan de frente; el holograma del
 * timón lo pinta (`scenes/ShipMinigames.tsx`).
 *
 * Plano de pilotaje: x ∈ [−1, 1], y ∈ [−ARENA_HALF_Y, ARENA_HALF_Y]. Cada roca nace al fondo
 * (profundidad 1) y llega a la nave (profundidad 0) en `travelS`; al llegar se mide la distancia a la
 * nave: choque de lleno, roce o limpio. Todo sale de la semilla (mismas rocas para la misma semilla) y la
 * simulación avanza en pasos fijos, así que el resultado no depende de los FPS.
 */
import type { RunAction } from '@payload/shared';
import { rng } from './noise';

export const ARENA_HALF_Y = 0.6;
export const SHIP_RADIUS = 0.09;
/** Velocidad máxima de la nave en el plano (unidades/s) y lo rápido que responde. */
export const SHIP_SPEED = 1.7;
export const SHIP_RESPONSE = 12;
/** Por debajo de esta fracción de la distancia de contacto, choque de lleno; hasta el contacto, roce. */
export const FULL_HIT_FRAC = 0.6;
const STEP_S = 1 / 120;
/** Radio del hueco de una «pared» de rocas. */
export const WALL_GAP_R = 0.42;

export interface DodgeDifficulty {
  /** Rocas por segundo. */
  rocksPerS: number;
  /** Segundos desde que una roca aparece al fondo hasta que llega a la nave. */
  travelS: number;
  rMin: number;
  rMax: number;
  /** Cada cuánto llega una «pared» de rocas con un hueco (s; 0 = nunca). */
  wallEveryS: number;
}

// Compactada para 3 s: mismas decisiones que la versión de 4 s (más rocas por segundo, llegada algo más corta).
const EASY: DodgeDifficulty = { rocksPerS: 3.3, travelS: 1.15, rMin: 0.1, rMax: 0.2, wallEveryS: 0 };
const HARD: DodgeDifficulty = { rocksPerS: 9, travelS: 0.72, rMin: 0.14, rMax: 0.3, wallEveryS: 1.2 };

/** Dificultad 0 (fácil) … 1 (difícil), interpolada. */
export function dodgeDifficulty(level: number): DodgeDifficulty {
  const k = Math.min(1, Math.max(0, level));
  const mix = (a: number, b: number) => a + (b - a) * k;
  return {
    rocksPerS: mix(EASY.rocksPerS, HARD.rocksPerS),
    travelS: mix(EASY.travelS, HARD.travelS),
    rMin: mix(EASY.rMin, HARD.rMin),
    rMax: mix(EASY.rMax, HARD.rMax),
    wallEveryS: k < 0.25 ? 0 : mix(2.2, HARD.wallEveryS),
  };
}

/** Dificultad según el sector (hasta que el motor exponga la suya): sube un cuarto por sector. */
export function dodgeLevelForSector(sectorIndex: number): number {
  return Math.min(1, Math.max(0, (sectorIndex - 1) * 0.25 + 0.2));
}

/**
 * Duración FIJA del minijuego: las rocas dependen solo de la dificultad, nunca del tiempo que falte. Así
 * llegar pronto al timón no es más difícil que llegar tarde.
 */
export const DODGE_DURATION_S = 3;
/** Margen (s) con el que la esquiva termina antes del impacto, para que `evade` llegue a tiempo. */
export const DODGE_LEAD_S = 0.4;
/** Si el impacto está a menos de esto, la esquiva se da por terminada y se envía ya lo que haya. */
export const DODGE_CUTOFF_S = 0.35;

/** ¿Da tiempo a jugar la esquiva entera? (ETA < 0 = la nave está parada: hay tiempo.) */
export function canPlayDodge(etaS: number): boolean {
  return etaS < 0 || etaS >= DODGE_DURATION_S + DODGE_LEAD_S;
}

/**
 * Tomar los mandos sin tiempo para jugar: la maniobra sale a medias, nunca limpia, y peor cuanto más tarde
 * y más difícil. Calibrado para que no sea mejor que jugarla (ni siquiera para un piloto medio; ver test).
 */
export function lateDodgeResult(etaS: number, level: number, maxGrazes: number): DodgeResult {
  const lateness = etaS < 0 ? 0 : Math.max(0, Math.min(1, 1 - etaS / (DODGE_DURATION_S + DODGE_LEAD_S)));
  // Suave al principio: un instante tarde ≈ jugarla regular (1 roce; 2 en lo más difícil), luego empeora.
  const grazes = 1 + Math.floor(level * 1.2 + lateness * 2.5);
  return { grazes: Math.min(maxGrazes, Math.max(1, grazes)), fullHit: false };
}

/** Máximo de roces que cuenta el motor (`hazards.impact.evade.maxGrazes`; sin esquiva por habilidad, 4). */
export function maxGrazesOf(evade: { maxGrazes: number } | undefined): number {
  return evade?.maxGrazes ?? 4;
}

/**
 * Lo que se envía al motor: `evade {grazes}`. Un choque de lleno cuenta como esquiva fallida
 * (`maxGrazes`); si no, los roces, recortados al máximo.
 */
export function evadeAction(r: DodgeResult, maxGrazes: number): RunAction {
  return { type: 'evade', grazes: r.fullHit ? maxGrazes : Math.min(maxGrazes, Math.max(0, Math.round(r.grazes))) };
}

export interface DodgeRock {
  spawnS: number;
  x: number;
  y: number;
  r: number;
  /** Giro visual (rad/s), solo aspecto. */
  spin: number;
}

/** 0 = aún no ha llegado, 1 = limpio, 2 = roce, 3 = choque de lleno. */
export type RockOutcome = 0 | 1 | 2 | 3;

export interface DodgeState {
  seed: number;
  durationS: number;
  travelS: number;
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rocks: DodgeRock[];
  outcome: Uint8Array;
  grazes: number;
  hits: number;
  /** Roces y choques del último `stepDodge` (para sonido y sacudida). */
  stepGrazes: number;
  stepHits: number;
  done: boolean;
  /** Tiempo pendiente de simular (pasos fijos). */
  acc: number;
}

/** Lo que el minijuego entrega al motor: número de roces y si hubo choque de lleno. */
export interface DodgeResult {
  grazes: number;
  fullHit: boolean;
}

/** Resultado «medio» de quien elige las interacciones simples (mantener E): un roce, sin choque. */
export const SIMPLE_DODGE_RESULT: DodgeResult = { grazes: 1, fullHit: false };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Rocas de la partida a partir de la semilla (deterministas). */
export function generateRocks(seed: number, durationS: number, d: DodgeDifficulty): DodgeRock[] {
  const r = rng(seed);
  const rocks: DodgeRock[] = [];
  const first = 0.25;
  const last = durationS - d.travelS - 0.05;
  if (last <= first) return rocks;
  // Paredes: una lluvia de rocas que tapa casi todo el plano salvo un hueco (obliga a moverse; el hueco
  // queda cerca del centro para que siempre se llegue a tiempo desde cualquier esquina).
  const gaps: { s: number; x: number; y: number }[] = [];
  if (d.wallEveryS > 0) {
    const rad = d.rMin;
    for (let w = first + d.wallEveryS * 0.6; w <= last; w += d.wallEveryS) {
      const gx = (r() - 0.5) * 0.9;
      const gy = (r() - 0.5) * 0.5;
      gaps.push({ s: w, x: gx, y: gy });
      for (let x = -0.9; x <= 0.91; x += 0.45) {
        for (let y = -0.45; y <= 0.46; y += 0.45) {
          if (Math.hypot(x - gx, y - gy) < WALL_GAP_R + rad) continue;
          rocks.push({ spawnS: w, x, y, r: rad, spin: r() < 0.5 ? 1 : -1 });
        }
      }
    }
  }
  // Rocas sueltas; ninguna tapa el hueco de una pared cerca de su llegada (siempre hay salida).
  const count = Math.max(1, Math.round(d.rocksPerS * (last - first)));
  for (let i = 0; i < count; i++) {
    const spawnS = first + ((i + r()) / count) * (last - first);
    const rad = d.rMin + r() * (d.rMax - d.rMin);
    const x = -1 + r() * 2;
    const y = -ARENA_HALF_Y + r() * 2 * ARENA_HALF_Y;
    const spin = (r() - 0.5) * 4;
    if (gaps.some((g) => Math.abs(g.s - spawnS) < 0.25 && Math.hypot(g.x - x, g.y - y) < WALL_GAP_R + rad + SHIP_RADIUS)) continue;
    rocks.push({ spawnS, x, y, r: rad, spin });
  }
  rocks.sort((a, b) => a.spawnS - b.spawnS);
  return rocks;
}

export function createDodge(seed: number, durationS: number, d: DodgeDifficulty): DodgeState {
  const rocks = generateRocks(seed, durationS, d);
  return {
    seed,
    durationS,
    travelS: d.travelS,
    t: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rocks,
    outcome: new Uint8Array(rocks.length),
    grazes: 0,
    hits: 0,
    stepGrazes: 0,
    stepHits: 0,
    done: false,
    acc: 0,
  };
}

/** Profundidad de una roca en el instante `t` (1 = fondo, 0 = llega a la nave; fuera de [0, 1], no se ve). */
export function rockDepth(s: DodgeState, rock: DodgeRock, t = s.t): number {
  return 1 - (t - rock.spawnS) / s.travelS;
}

/** Clasifica la llegada de una roca según la distancia a la nave. */
export function classifyArrival(dist: number, rockR: number): RockOutcome {
  const contact = rockR + SHIP_RADIUS;
  if (dist < contact * FULL_HIT_FRAC) return 3;
  if (dist < contact) return 2;
  return 1;
}

/**
 * Avanza `dt` segundos con la dirección pedida (`ix`, `iy` en [−1, 1]; +y = arriba). Muta `s`.
 * `stepGrazes`/`stepHits` cuentan lo ocurrido en esta llamada.
 */
export function stepDodge(s: DodgeState, ix: number, iy: number, dt: number): void {
  s.stepGrazes = 0;
  s.stepHits = 0;
  if (s.done) return;
  s.acc += Math.max(0, dt);
  const len = Math.hypot(ix, iy);
  const nx = len > 1 ? ix / len : ix;
  const ny = len > 1 ? iy / len : iy;
  while (s.acc >= STEP_S && !s.done) {
    s.acc -= STEP_S;
    const k = 1 - Math.exp(-SHIP_RESPONSE * STEP_S);
    s.vx += (nx * SHIP_SPEED - s.vx) * k;
    s.vy += (ny * SHIP_SPEED - s.vy) * k;
    s.x = clamp(s.x + s.vx * STEP_S, -1 + SHIP_RADIUS, 1 - SHIP_RADIUS);
    s.y = clamp(s.y + s.vy * STEP_S, -ARENA_HALF_Y + SHIP_RADIUS, ARENA_HALF_Y - SHIP_RADIUS);
    s.t += STEP_S;
    for (let i = 0; i < s.rocks.length; i++) {
      if (s.outcome[i] !== 0) continue;
      const rock = s.rocks[i]!;
      if (rock.spawnS + s.travelS > s.t) break; // ordenadas por aparición: las siguientes llegan después
      const o = classifyArrival(Math.hypot(rock.x - s.x, rock.y - s.y), rock.r);
      s.outcome[i] = o;
      if (o === 2) {
        s.grazes++;
        s.stepGrazes++;
      } else if (o === 3) {
        s.hits++;
        s.stepHits++;
      }
    }
    if (s.t >= s.durationS) s.done = true;
  }
}

export function dodgeResult(s: DodgeState): DodgeResult {
  return { grazes: s.grazes, fullHit: s.hits > 0 };
}
