/**
 * Pose del astronauta articulado (fase 5, ADR 0018 § 9). PURO: ángulos de las articulaciones a partir de cómo se mueve
 * (velocidad, suelo, jetpack, velocidad vertical) y de una fase de zancada que avanza con la velocidad. Sin `three`.
 *
 * Convención: cada ángulo es la rotación en X (rad) de su articulación; el modelo mira a +Z. Positivo lleva el extremo
 * HACIA ATRÁS (−Z): la cadera adelanta la pierna con valores negativos, la rodilla solo se dobla hacia atrás (≥ 0) y
 * el codo solo hacia delante (≤ 0).
 */

export interface AstronautPose {
  hipL: number;
  hipR: number;
  kneeL: number;
  kneeR: number;
  shoulderL: number;
  shoulderR: number;
  elbowL: number;
  elbowR: number;
  /** Inclinación del tronco (adelante = negativo) y de la cabeza. */
  spine: number;
  head: number;
  /** Separación lateral de los brazos (rad, en Z; hacia fuera = positivo). */
  armSpread: number;
  /** Subida del cuerpo por la zancada (m). */
  bobM: number;
}

export interface PoseInput {
  /** Fase de la zancada (rad), de `advanceGait`. */
  gait: number;
  /** Velocidad horizontal (m/s). */
  speedMps: number;
  grounded: boolean;
  thrusting: boolean;
  /** Velocidad vertical (m/s, + hacia arriba). */
  verticalMps: number;
  /** Tiempo (s) para la respiración en reposo. */
  timeS: number;
}

/** Velocidad a la que la zancada llega a su amplitud máxima (correr). */
export const RUN_SPEED_MPS = 5;
/** Por debajo de esto se considera quieto. */
const IDLE_SPEED_MPS = 0.15;
const MAX_HIP = 0.6;
const MAX_KNEE = 1.1;
const MAX_SHOULDER = 0.55;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Pasos por segundo según la velocidad (andar ~1,6 Hz, correr ~2,6 Hz); quieto, la fase no avanza. */
export function cadenceHz(speedMps: number): number {
  if (speedMps < IDLE_SPEED_MPS) return 0;
  return 1.3 + 0.26 * clamp(speedMps, 0, RUN_SPEED_MPS * 1.2);
}

/** Avanza la fase de la zancada `dtS` segundos (se mantiene en [0, 2π)). */
export function advanceGait(gait: number, speedMps: number, dtS: number): number {
  const next = gait + 2 * Math.PI * cadenceHz(speedMps) * Math.max(0, dtS);
  return next % (2 * Math.PI);
}

/** Ángulos de la pose para este instante. Siempre finitos y acotados. */
export function astronautPose(input: PoseInput): AstronautPose {
  const speed = Number.isFinite(input.speedMps) ? Math.max(0, input.speedMps) : 0;
  const vy = Number.isFinite(input.verticalMps) ? input.verticalMps : 0;
  const breath = Math.sin((Number.isFinite(input.timeS) ? input.timeS : 0) * 1.6) * 0.03;

  if (!input.grounded) {
    // En el aire: con el jetpack, piernas juntas algo dobladas y brazos abiertos para equilibrarse; cayendo, se encoge.
    const falling = clamp(-vy / 6, 0, 1);
    const knee = input.thrusting ? 0.25 : 0.2 + 0.5 * falling;
    const shoulder = input.thrusting ? -0.15 : -0.35 - 0.4 * falling;
    return {
      hipL: -knee * 0.6, hipR: -knee * 0.5, kneeL: knee, kneeR: knee * 0.9,
      shoulderL: shoulder, shoulderR: shoulder, elbowL: -0.4, elbowR: -0.4,
      spine: input.thrusting ? -0.08 : -0.15 * falling, head: 0.05, armSpread: input.thrusting ? 0.35 : 0.5, bobM: 0,
    };
  }

  const amp = clamp(speed / RUN_SPEED_MPS, 0, 1);
  if (amp <= IDLE_SPEED_MPS / RUN_SPEED_MPS) {
    // Quieto: respira (tronco y brazos apenas se mueven).
    return {
      hipL: 0, hipR: 0, kneeL: 0.04, kneeR: 0.04, shoulderL: breath, shoulderR: breath, elbowL: -0.15, elbowR: -0.15,
      spine: breath * 0.5, head: -breath * 0.5, armSpread: 0.12, bobM: 0,
    };
  }

  // Andar/correr: piernas opuestas, brazos al revés que las piernas; la rodilla se dobla al pasar la pierna por detrás.
  const s = Math.sin(input.gait);
  const hip = MAX_HIP * amp;
  const kneeOf = (phase: number): number => MAX_KNEE * amp * Math.max(0, Math.sin(phase - 0.6)) + 0.08;
  return {
    hipL: -hip * s,
    hipR: hip * s,
    kneeL: clamp(kneeOf(input.gait + Math.PI), 0, MAX_KNEE),
    kneeR: clamp(kneeOf(input.gait), 0, MAX_KNEE),
    shoulderL: MAX_SHOULDER * amp * s,
    shoulderR: -MAX_SHOULDER * amp * s,
    elbowL: -0.25 - 0.45 * amp,
    elbowR: -0.25 - 0.45 * amp,
    spine: -0.12 * amp,
    head: 0.06 * amp,
    armSpread: 0.12,
    bobM: 0.045 * amp * Math.abs(Math.cos(input.gait)),
  };
}
