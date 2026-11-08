import { describe, expect, it } from 'vitest';
import { computeOrbitParams, EARTH_RADIUS_KM, getOrbit, MU_EARTH_KM3_S2 } from '../index';
import { eclipseFractionAtAltitude, isGeostationary, passDurationMin, periodMinFromSemiMajorAxis } from '../orbital';
import type { OrbitDef } from '../types';

const circular = (h: number, extra: Partial<OrbitDef> = {}): OrbitDef => ({
  id: 'LEO',
  name: { es: 'x', en: 'x' },
  description: { es: 'x', en: 'x' },
  why: { es: 'x', en: 'x' },
  perigeeKm: h,
  apogeeKm: h,
  inclinationDeg: 51.6,
  radiationFactor: 0.1,
  dragLifetimeYears: 5,
  revisitDays: 3,
  ...extra,
});

describe('mecánica orbital', () => {
  it('usa las constantes del plan', () => {
    expect(MU_EARTH_KM3_S2).toBe(398600);
    expect(EARTH_RADIUS_KM).toBe(6371);
  });

  it('LEO a 400 km tarda ≈ 92.6 min por vuelta', () => {
    const p = computeOrbitParams(circular(400));
    expect(p.semiMajorAxisKm).toBe(6771);
    expect(p.periodMin).toBeGreaterThan(92.1);
    expect(p.periodMin).toBeLessThan(93.1);
    expect(p.orbitsPerDay).toBeCloseTo(1440 / p.periodMin, 10);
  });

  it('GEO tarda ≈ 1436 min (±1) y tiene contacto continuo', () => {
    const p = computeOrbitParams(circular(35786, { id: 'GEO', inclinationDeg: 0 }));
    expect(Math.abs(p.periodMin - 1436)).toBeLessThanOrEqual(1);
    expect(p.contactMinPerDayPerStation).toBe(1440);
    expect(isGeostationary(getOrbit('GEO'))).toBe(true);
    expect(isGeostationary(getOrbit('LEO'))).toBe(false);
  });

  it('eclipse peor caso β=0: f = asin(R/(R+h))/π', () => {
    const p = computeOrbitParams(circular(400));
    expect(p.eclipseFraction).toBeCloseTo(Math.asin(6371 / 6771) / Math.PI, 12);
    // ≈ 35.7 min de sombra a 400 km (valor de referencia tipo estación espacial)
    expect(p.eclipseMin).toBeGreaterThan(35);
    expect(p.eclipseMin).toBeLessThan(37);
    expect(eclipseFractionAtAltitude(35786)).toBeLessThan(0.06);
  });

  it('la sombra se acorta en fracción al subir de altitud', () => {
    const fr = [300, 500, 800, 1200].map((h) => computeOrbitParams(circular(h)).eclipseFraction);
    for (let i = 1; i < fr.length; i++) expect(fr[i]!).toBeLessThan(fr[i - 1]!);
  });

  it('el contacto por estación crece con la altitud y nunca pasa de 1440 min/día', () => {
    const c = [400, 600, 800, 2000, 20200].map((h) => computeOrbitParams(circular(h)).contactMinPerDayPerStation);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThan(c[i - 1]!);
    for (const x of c) expect(x).toBeLessThanOrEqual(1440);
    // LEO bajo: decenas de minutos al día por estación
    expect(c[0]!).toBeGreaterThan(20);
    expect(c[0]!).toBeLessThan(60);
  });

  it('las órbitas elípticas usan a = R + (hp+ha)/2', () => {
    const heo = getOrbit('HEO');
    const p = computeOrbitParams(heo);
    expect(p.semiMajorAxisKm).toBe(6371 + (heo.perigeeKm + heo.apogeeKm) / 2);
    expect(p.periodMin).toBeCloseTo(periodMinFromSemiMajorAxis(p.semiMajorAxisKm), 10);
    // Molniya: ~12 h
    expect(p.periodMin).toBeGreaterThan(700);
    expect(p.periodMin).toBeLessThan(740);
    expect(p.eclipseFraction).toBeGreaterThan(0);
    expect(p.eclipseFraction).toBeLessThan(0.15);
  });

  it('todas las órbitas del catálogo dan parámetros finitos y coherentes', () => {
    for (const id of ['LEO', 'SSO', 'MEO', 'GEO', 'HEO', 'TLI'] as const) {
      const p = computeOrbitParams(getOrbit(id));
      for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true);
      expect(p.eclipseMin).toBeCloseTo(p.eclipseFraction * p.periodMin, 10);
      expect(passDurationMin(getOrbit(id))).toBeGreaterThan(0);
    }
  });
});
