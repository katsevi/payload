/**
 * Reparaciones de averías como micro-interacciones (lógica PURA). Cada una se traduce en segundos de
 * trabajo para `work-incident {seconds}`: hacerlo bien entrega más trabajo por segundo, hacerlo mal menos,
 * y nunca bloquea (fallar también avanza un poco). El motor no cambia: solo recibe segundos.
 *
 *   fuego          apuntar el extintor (centro de la vista) a la llama, que se mueve, manteniendo el clic
 *   cortocircuito  una marca recorre la barra: clic cuando pasa por la zona marcada (cada acierto, un tramo)
 *   fuga           mantener el clic para subir la presión del sellador y soltar dentro de la zona
 *
 * Con «interacciones simples» (ajuste) se mantiene R y el trabajo va a ritmo normal (`SIMPLE_RATE`).
 */
import type { IncidentKind } from '@payload/shared';
import { mixSeed, rng } from './noise';

/** Ritmo de trabajo (segundos de reparación por segundo real) con interacciones simples: medio. */
export const SIMPLE_RATE = 1;

// ─── Fuego ───────────────────────────────────────────────────────────────────────────────────────

export const FIRE_RATE_ON = 1.6;
export const FIRE_RATE_OFF = 0.3;
/** Radio (m) de la llama a la que se apunta. */
export const FLAME_RADIUS_M = 0.3;
/** Con el ajuste «puntería amplia», el área de acierto del extintor se multiplica por esto. */
export const WIDE_AIM_MULT = 2;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Desplazamiento de la llama respecto a su base (m, en el plano del puesto: `x` lateral, `y` altura). Se
 * mueve de forma suave y determinista con la semilla de la avería.
 */
export function flameOffset(seed: number, t: number, out: { x: number; y: number }): { x: number; y: number } {
  const r = rng(seed);
  const f1 = 0.55 + r() * 0.35;
  const f2 = 1.1 + r() * 0.5;
  const p1 = r() * 6.283;
  const p2 = r() * 6.283;
  out.x = Math.sin(t * f1 + p1) * 0.32 + Math.sin(t * f2 * 1.3 + p2) * 0.12;
  out.y = Math.sin(t * f2 + p2) * 0.18 + Math.cos(t * f1 * 0.7 + p1) * 0.08;
  return out;
}

/** ¿La línea de mira (`eye` + `dir` unitario) pasa a menos de `radiusM` del objetivo, por delante? */
export function aimOnTarget(eye: Vec3, dir: Vec3, target: Vec3, radiusM: number): boolean {
  const vx = target.x - eye.x;
  const vy = target.y - eye.y;
  const vz = target.z - eye.z;
  const along = vx * dir.x + vy * dir.y + vz * dir.z;
  if (along <= 0) return false;
  const px = vx - dir.x * along;
  const py = vy - dir.y * along;
  const pz = vz - dir.z * along;
  return px * px + py * py + pz * pz <= radiusM * radiusM;
}

/** Trabajo del extintor en `dt`: solo mientras se rocía; mucho más si se acierta en la llama. */
export function fireWorkS(dt: number, spraying: boolean, onTarget: boolean): number {
  return spraying ? dt * (onTarget ? FIRE_RATE_ON : FIRE_RATE_OFF) : 0;
}

// ─── Cortocircuito: pulsos de sincronía ──────────────────────────────────────────────────────────

/** Ida y vuelta de la marca (s). */
export const PULSE_PERIOD_S = 1.25;
export const PULSE_ZONE_W = 0.2;
/** Tras un clic la marca no acepta otro durante un momento; tras un fallo, más (machacar el botón no sirve). */
export const PULSE_COOLDOWN_S = 0.2;
export const PULSE_MISS_COOLDOWN_S = 0.8;
/** Trabajo por acierto y por fallo (fracción del `repairS` de la avería). Tres aciertos la arreglan. */
export const PULSE_HIT_FRAC = 0.5;
export const PULSE_MISS_FRAC = 0.06;

export type Feedback = 0 | 1 | 2; // 0 nada · 1 acierto · 2 fallo

export interface PulseState {
  seed: number;
  t: number;
  presses: number;
  hits: number;
  zoneA: number;
  cooldown: number;
  feedback: Feedback;
  feedbackT: number;
}

function zoneFor(seed: number, n: number, width: number): number {
  return 0.08 + rng(mixSeed(seed, n))() * (0.84 - width);
}

export function createPulse(seed: number): PulseState {
  return { seed, t: 0, presses: 0, hits: 0, zoneA: zoneFor(seed, 0, PULSE_ZONE_W), cooldown: 0, feedback: 0, feedbackT: 0 };
}

/** Posición de la marca (0-1), en ida y vuelta. */
export function pulseCursor(s: PulseState): number {
  const ph = (s.t / PULSE_PERIOD_S) % 2;
  return ph <= 1 ? ph : 2 - ph;
}

export function stepPulse(s: PulseState, dt: number): void {
  s.t += dt;
  s.cooldown = Math.max(0, s.cooldown - dt);
  s.feedbackT = Math.max(0, s.feedbackT - dt);
  if (s.feedbackT === 0) s.feedback = 0;
}

/** Clic: devuelve los segundos de trabajo que entrega (0 si aún está en espera). */
export function pressPulse(s: PulseState, repairS: number): number {
  if (s.cooldown > 0) return 0;
  const c = pulseCursor(s);
  const hit = c >= s.zoneA && c <= s.zoneA + PULSE_ZONE_W;
  s.presses++;
  if (hit) s.hits++;
  s.cooldown = hit ? PULSE_COOLDOWN_S : PULSE_MISS_COOLDOWN_S;
  s.feedback = hit ? 1 : 2;
  s.feedbackT = 0.45;
  s.zoneA = zoneFor(s.seed, s.presses, PULSE_ZONE_W);
  return repairS * (hit ? PULSE_HIT_FRAC : PULSE_MISS_FRAC);
}

// ─── Fuga: sellar a la presión justa ─────────────────────────────────────────────────────────────

/** Segundos manteniendo para llenar la presión de 0 a 1. */
export const SEAL_FILL_S = 1.1;
export const SEAL_ZONE_W = 0.18;
export const SEAL_HIT_FRAC = 0.55;
export const SEAL_MISS_FRAC = 0.1;

export interface SealState {
  seed: number;
  pressure: number;
  holding: boolean;
  tries: number;
  seals: number;
  zoneA: number;
  feedback: Feedback;
  feedbackT: number;
}

export function createSeal(seed: number): SealState {
  return { seed, pressure: 0, holding: false, tries: 0, seals: 0, zoneA: 0.45 + rng(mixSeed(seed, 0))() * (0.5 - SEAL_ZONE_W), feedback: 0, feedbackT: 0 };
}

/**
 * Avanza `dt` con el botón `holding`. Al soltar (o al pasarse de presión) entrega trabajo: mucho si la
 * presión estaba en la zona, poco si no. Devuelve los segundos de trabajo de este paso.
 */
export function stepSeal(s: SealState, holding: boolean, dt: number, repairS: number): number {
  s.feedbackT = Math.max(0, s.feedbackT - dt);
  if (s.feedbackT === 0) s.feedback = 0;
  let work = 0;
  const settle = (hit: boolean) => {
    s.tries++;
    if (hit) s.seals++;
    s.feedback = hit ? 1 : 2;
    s.feedbackT = 0.45;
    work = repairS * (hit ? SEAL_HIT_FRAC : SEAL_MISS_FRAC);
    s.pressure = 0;
    s.zoneA = 0.45 + rng(mixSeed(s.seed, s.tries))() * (0.5 - SEAL_ZONE_W);
  };
  if (holding) {
    s.pressure += dt / SEAL_FILL_S;
    if (s.pressure > 1) {
      settle(false); // se pasó: el sellador revienta y hay que empezar de nuevo
      s.holding = true;
      return work;
    }
  } else if (s.holding && s.pressure > 0.04) {
    settle(s.pressure >= s.zoneA && s.pressure <= s.zoneA + SEAL_ZONE_W);
  } else if (!holding) s.pressure = 0;
  s.holding = holding;
  return work;
}

// ─── Todas ───────────────────────────────────────────────────────────────────────────────────────

/** Semilla de la micro-interacción de una avería (misma avería, misma llama y mismas zonas). */
export function repairSeed(runSeed: number, incidentId: number): number {
  return mixSeed(runSeed, incidentId, 0x7e9a);
}

/** Qué control usa cada avería: el clic se mantiene (fuego, fuga) o se pulsa (cortocircuito). */
export function repairHold(kind: IncidentKind): boolean {
  return kind !== 'short';
}
