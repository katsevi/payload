/** Fase orbital no uniforme (2.ª ley de Kepler) para órbitas elípticas: M → E → ν. */
import { describe, expect, it } from 'vitest';
import {
  altitudeAtTrueAnomaly, catalog, computeOrbitParams, createMissionSim, getOrbit, orbitEccentricity, orbitPhaseAt,
  solveKeplerEquation, trueAnomalyFromMeanAnomaly,
} from '../index';
import type { Catalog, MissionDesign } from '../types';
import { loadDesign } from './fixtures';

const heo = getOrbit('HEO'); // 600 × 39 750 km
const TWO_PI = 2 * Math.PI;

describe('mecánica de Kepler', () => {
  it('excentricidad: 0 en circulares, ≈ 0,737 en la HEO tipo Molniya', () => {
    expect(orbitEccentricity(getOrbit('LEO'))).toBe(0);
    expect(orbitEccentricity(getOrbit('GEO'))).toBe(0);
    // e = (ra − rp)/(ra + rp) = (46 121 − 6 971)/(46 121 + 6 971)
    expect(orbitEccentricity(heo)).toBeCloseTo(39150 / 53092, 6);
  });

  it('solveKeplerEquation cumple M = E − e·sin E en toda la órbita (incluida e alta)', () => {
    for (const e of [0, 0.1, 0.5, 0.737, 0.9, 0.97]) {
      for (let k = 0; k <= 64; k++) {
        const M = (k / 64) * TWO_PI;
        const E = solveKeplerEquation(M, e);
        const residual = E - e * Math.sin(E) - (M % TWO_PI);
        expect(Math.abs(residual), `e=${e} M=${M}`).toBeLessThan(1e-9);
      }
    }
  });

  it('ν coincide con M en circular y en perigeo/apogeo; va por delante de M en la mitad de ida', () => {
    for (let k = 0; k < 10; k++) expect(trueAnomalyFromMeanAnomaly(k * 0.6, 0)).toBeCloseTo(k * 0.6 % TWO_PI, 12);
    const e = orbitEccentricity(heo);
    expect(trueAnomalyFromMeanAnomaly(0, e)).toBeCloseTo(0, 12);
    expect(trueAnomalyFromMeanAnomaly(Math.PI, e)).toBeCloseTo(Math.PI, 9);
    expect(trueAnomalyFromMeanAnomaly(Math.PI / 2, e)).toBeGreaterThan(Math.PI / 2);
  });

  it('2.ª ley: la HEO pasa poco tiempo en la mitad del perigeo (valor analítico)', () => {
    const e = orbitEccentricity(heo);
    // ν = ±90°: cos E = e → M = E − e·sin E; fracción del periodo con |ν| < 90° = 2M/2π.
    const E = Math.acos(e);
    const expected = (2 * (E - e * Math.sin(E))) / TWO_PI;
    const T = computeOrbitParams(heo).periodMin * 60;
    const N = 20000;
    let near = 0;
    for (let i = 0; i < N; i++) {
      const nu = orbitPhaseAt((i / N) * T, T, e) * TWO_PI;
      if (Math.cos(nu) > 0) near++;
    }
    expect(near / N).toBeCloseTo(expected, 3);
    expect(expected).toBeLessThan(0.15); // ~11 % del tiempo en la mitad cercana
  });

  it('2.ª ley: barre áreas iguales en tiempos iguales (r²·dν/dt constante)', () => {
    const e = orbitEccentricity(heo);
    const T = computeOrbitParams(heo).periodMin * 60;
    const dt = 1;
    const rates: number[] = [];
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * T;
      const nu1 = orbitPhaseAt(t, T, e) * TWO_PI;
      let nu2 = orbitPhaseAt(t + dt, T, e) * TWO_PI;
      if (nu2 < nu1) nu2 += TWO_PI;
      const r = altitudeAtTrueAnomaly(heo, (nu1 + nu2) / 2) + 6371;
      rates.push((r * r * (nu2 - nu1)) / dt);
    }
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    for (const x of rates) expect(Math.abs(x - mean) / mean).toBeLessThan(1e-3);
  });

  it('altitud: perigeo en ν = 0 y apogeo en ν = π', () => {
    expect(altitudeAtTrueAnomaly(heo, 0)).toBeCloseTo(600, 6);
    expect(altitudeAtTrueAnomaly(heo, Math.PI)).toBeCloseTo(39750, 6);
  });
});

describe('snapshot de la simulación', () => {
  it('órbita circular: orbitPhase = meanPhase (como en la fase 1)', () => {
    const sim = createMissionSim(loadDesign('ok-cubesat-leo'), catalog, { seed: 1 });
    for (let i = 0; i < 20; i++) {
      const s = sim.step(611);
      if (s.status === 'failed') break;
      expect(s.orbitPhase).toBeCloseTo(s.meanPhase!, 12);
      expect(s.altitudeKm).toBeCloseTo(450, 6);
    }
  });

  it('HEO: la fase angular avanza rápido en el perigeo y lento en el apogeo', () => {
    // El escenario de la fase 1 no permite HEO, pero la simulación lo admite (Go/No-Go aparte).
    const cat: Catalog = { ...catalog, scenarios: catalog.scenarios.map((s) => ({ ...s, eventsEnabled: false })) };
    const d: MissionDesign = { ...loadDesign('ok-microsat-leo-thermal'), orbitId: 'HEO', launcherId: 'launcher-condor' };
    let launched = null;
    for (let seed = 1; seed < 50 && !launched; seed++) {
      const sim = createMissionSim(d, cat, { seed });
      if (sim.snapshot().status !== 'failed') launched = sim;
    }
    expect(launched).not.toBeNull();
    const T = computeOrbitParams(heo).periodMin * 60;
    const samples: { mean: number; phase: number; alt: number }[] = [];
    const sim = launched!;
    for (let i = 0; i < 48; i++) {
      const s = sim.step(T / 48);
      samples.push({ mean: s.meanPhase!, phase: s.orbitPhase, alt: s.altitudeKm! });
    }
    // Cerca del perigeo (meanPhase pequeña) la fase angular va muy por delante de la media.
    const early = samples.find((x) => x.mean > 0.02 && x.mean < 0.05)!;
    expect(early.phase).toBeGreaterThan(early.mean * 3);
    for (const x of samples) {
      expect(x.phase).toBeGreaterThanOrEqual(0);
      expect(x.phase).toBeLessThan(1);
      expect(x.alt).toBeGreaterThanOrEqual(599);
      expect(x.alt).toBeLessThanOrEqual(39751);
    }
    expect(Math.max(...samples.map((x) => x.alt))).toBeGreaterThan(39000);
  });
});
