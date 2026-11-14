/**
 * Fase 5 (ADR 0018 § 9): pose del astronauta articulado (lógica pura, sin `three`).
 */
import { describe, expect, it } from 'vitest';
import { advanceGait, astronautPose, cadenceHz, RUN_SPEED_MPS, type AstronautPose, type PoseInput } from '../game/astronautPose';

const base: PoseInput = { gait: 0, speedMps: 0, grounded: true, thrusting: false, verticalMps: 0, timeS: 0 };
const values = (p: AstronautPose) => Object.values(p);

describe('zancada', () => {
  it('quieto no avanza; más rápido, más pasos por segundo', () => {
    expect(cadenceHz(0)).toBe(0);
    expect(advanceGait(1, 0, 1)).toBe(1);
    expect(cadenceHz(RUN_SPEED_MPS)).toBeGreaterThan(cadenceHz(1.5));
    const g = advanceGait(6, 3, 10);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThan(2 * Math.PI);
  });
});

describe('pose', () => {
  it('siempre finita y dentro de límites razonables, también con entradas raras', () => {
    const inputs: PoseInput[] = [];
    for (const speed of [0, 0.5, 2, 5, 9, Number.NaN, -3]) {
      for (const grounded of [true, false]) {
        for (const thrusting of [true, false]) {
          for (let k = 0; k < 8; k++) inputs.push({ ...base, gait: (k / 8) * 2 * Math.PI, speedMps: speed, grounded, thrusting, verticalMps: k - 4, timeS: k });
        }
      }
    }
    for (const i of inputs) {
      const p = astronautPose(i);
      for (const v of values(p)) {
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v)).toBeLessThanOrEqual(1.2);
      }
      expect(p.kneeL).toBeGreaterThanOrEqual(0);
      expect(p.kneeR).toBeGreaterThanOrEqual(0);
      expect(p.elbowL).toBeLessThanOrEqual(0);
      expect(p.elbowR).toBeLessThanOrEqual(0);
    }
  });

  it('al andar las piernas van opuestas y cada brazo al revés que su pierna; corriendo, más amplitud', () => {
    const walk = astronautPose({ ...base, gait: Math.PI / 2, speedMps: 2 });
    expect(walk.hipL).toBeCloseTo(-walk.hipR, 9);
    expect(Math.sign(walk.shoulderL)).toBe(-Math.sign(walk.hipL));
    const run = astronautPose({ ...base, gait: Math.PI / 2, speedMps: RUN_SPEED_MPS });
    expect(Math.abs(run.hipL)).toBeGreaterThan(Math.abs(walk.hipL));
    expect(run.bobM).toBeGreaterThanOrEqual(0);
  });

  it('quieto apenas se mueve (respira); en el aire se encoge al caer y abre los brazos con el jetpack', () => {
    const idle = astronautPose({ ...base, timeS: 3 });
    expect(Math.abs(idle.hipL) + Math.abs(idle.hipR)).toBe(0);
    expect(Math.abs(idle.spine)).toBeLessThan(0.05);
    const falling = astronautPose({ ...base, grounded: false, verticalMps: -8 });
    const jet = astronautPose({ ...base, grounded: false, thrusting: true, verticalMps: 2 });
    expect(falling.kneeL).toBeGreaterThan(jet.kneeL);
    expect(jet.armSpread).toBeGreaterThan(idle.armSpread);
  });

  it('es determinista', () => {
    const i = { ...base, gait: 1.234, speedMps: 3.3, timeS: 7 };
    expect(astronautPose(i)).toEqual(astronautPose(i));
  });
});
