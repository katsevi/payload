/**
 * Mecánica orbital simplificada (Kepler, Tierra esférica, sin perturbaciones).
 *
 *  - Semieje mayor:  a = R⊕ + (hp + ha) / 2
 *  - Periodo:        T = 2π √(a³ / μ)            (μ = 398 600 km³/s², R⊕ = 6371 km)
 *  - Eclipse (peor caso, ángulo beta = 0, órbita circular de altitud h):
 *                    f = asin(R⊕ / (R⊕ + h)) / π
 *    Para órbitas elípticas se usa la altitud "circular equivalente" h = a − R⊕. Es una
 *    aproximación: el eclipse real depende de dónde caiga el perigeo respecto al Sol, pero
 *    con h = a − R⊕ la fracción media es razonable para el juego (HEO ≈ 8 %, TLI ≈ 1 %).
 *  - Contacto con UNA estación terrestre (elevación mínima ε = 10°):
 *      ángulo central de visibilidad  λ = acos(R⊕·cos ε / (R⊕ + h)) − ε
 *      fracción de tiempo visible     p = (1 − cos λ) / 2     (área del casquete / esfera)
 *      minutos/día                    = 1440 · p · K,  K = 2
 *    K = 2 representa que las estaciones se ubican en latitudes favorables (cerca de la
 *    inclinación de la órbita), donde pasan muchas más trazas que en promedio. Con esto un
 *    satélite a 450 km ve ~37 min/día por estación (6 pasadas de ~6-7 min), y a 700 km ~66 min.
 *    Una órbita geoestacionaria (circular, T ≈ día sidéreo) tiene contacto continuo: 1440 min.
 */
import type { OrbitDef, OrbitParams } from './types';

export const MU_EARTH_KM3_S2 = 398600;
export const EARTH_RADIUS_KM = 6371;
/** Elevación mínima sobre el horizonte para que una estación pueda comunicarse. */
export const MIN_ELEVATION_DEG = 10;
/** Factor de latitud favorable de las estaciones (ver comentario del módulo). */
export const STATION_LATITUDE_FACTOR = 2;
export const MINUTES_PER_DAY = 1440;
/** Día sidéreo (min): periodo de una órbita geosíncrona. */
export const SIDEREAL_DAY_MIN = 1436.07;

const DEG = Math.PI / 180;

/** Periodo orbital (min) a partir del semieje mayor (km). */
export function periodMinFromSemiMajorAxis(aKm: number): number {
  return (2 * Math.PI * Math.sqrt(aKm ** 3 / MU_EARTH_KM3_S2)) / 60;
}

/** Fracción del periodo en sombra para una altitud circular (peor caso beta = 0). */
export function eclipseFractionAtAltitude(altitudeKm: number): number {
  const r = EARTH_RADIUS_KM + Math.max(0, altitudeKm);
  return Math.asin(EARTH_RADIUS_KM / r) / Math.PI;
}

/** Ángulo central de visibilidad (rad) de una estación con elevación mínima ε. */
export function visibilityHalfAngleRad(altitudeKm: number, minElevationDeg = MIN_ELEVATION_DEG): number {
  const r = EARTH_RADIUS_KM + Math.max(0, altitudeKm);
  const eps = minElevationDeg * DEG;
  const lambda = Math.acos((EARTH_RADIUS_KM * Math.cos(eps)) / r) - eps;
  return Math.max(0, lambda);
}

/** ¿Es geoestacionaria? (circular y con periodo ≈ día sidéreo). */
export function isGeostationary(orbit: OrbitDef): boolean {
  const a = EARTH_RADIUS_KM + (orbit.perigeeKm + orbit.apogeeKm) / 2;
  const circular = Math.abs(orbit.apogeeKm - orbit.perigeeKm) < 100;
  return circular && Math.abs(periodMinFromSemiMajorAxis(a) - SIDEREAL_DAY_MIN) < 10;
}

/** Kepler simplificado: T = 2π√(a³/μ); eclipse peor caso (β=0); contacto por estación. */
export function computeOrbitParams(orbit: OrbitDef): OrbitParams {
  const semiMajorAxisKm = EARTH_RADIUS_KM + (orbit.perigeeKm + orbit.apogeeKm) / 2;
  const periodMin = periodMinFromSemiMajorAxis(semiMajorAxisKm);
  const equivalentAltitudeKm = semiMajorAxisKm - EARTH_RADIUS_KM;
  const eclipseFraction = eclipseFractionAtAltitude(equivalentAltitudeKm);

  let contactMinPerDayPerStation: number;
  if (isGeostationary(orbit)) {
    contactMinPerDayPerStation = MINUTES_PER_DAY;
  } else {
    const lambda = visibilityHalfAngleRad(equivalentAltitudeKm);
    const visibleFraction = (1 - Math.cos(lambda)) / 2;
    contactMinPerDayPerStation = Math.min(
      MINUTES_PER_DAY,
      MINUTES_PER_DAY * visibleFraction * STATION_LATITUDE_FACTOR,
    );
  }

  return {
    semiMajorAxisKm,
    periodMin,
    eclipseFraction,
    eclipseMin: eclipseFraction * periodMin,
    orbitsPerDay: MINUTES_PER_DAY / periodMin,
    contactMinPerDayPerStation,
  };
}

/**
 * Duración típica de una pasada sobre una estación (min): tiempo en recorrer el diámetro
 * del casquete de visibilidad, T · 2λ / 2π. Se usa para repartir el contacto diario en
 * pasadas en la simulación.
 */
export function passDurationMin(orbit: OrbitDef): number {
  const p = computeOrbitParams(orbit);
  if (isGeostationary(orbit)) return MINUTES_PER_DAY;
  const lambda = visibilityHalfAngleRad(p.semiMajorAxisKm - EARTH_RADIUS_KM);
  return Math.max(1, (p.periodMin * 2 * lambda) / (2 * Math.PI));
}

// ─── Posición a lo largo de la órbita (2.ª ley de Kepler) ───────────────────
//
//  Excentricidad:       e = (r_a − r_p) / (r_a + r_p),  r = R⊕ + altitud
//  Anomalía media:      M = 2π · t / T                    (uniforme en el tiempo)
//  Ecuación de Kepler:  M = E − e·sin E                   (se resuelve E por Newton-Raphson)
//  Anomalía verdadera:  ν = 2·atan2(√(1+e)·sin(E/2), √(1−e)·cos(E/2))
//  Radio:               r = a·(1 − e·cos E)
// La nave barre áreas iguales en tiempos iguales: va rápida en el perigeo y lenta en el apogeo.

const TWO_PI = 2 * Math.PI;

/** Excentricidad de la órbita (0 = circular). */
export function orbitEccentricity(orbit: Pick<OrbitDef, 'perigeeKm' | 'apogeeKm'>): number {
  const rp = EARTH_RADIUS_KM + orbit.perigeeKm;
  const ra = EARTH_RADIUS_KM + orbit.apogeeKm;
  return (ra - rp) / (ra + rp);
}

/** Resuelve la ecuación de Kepler M = E − e·sin E (rad). Converge para 0 ≤ e < 1. */
export function solveKeplerEquation(meanAnomalyRad: number, e: number): number {
  const M = ((meanAnomalyRad % TWO_PI) + TWO_PI) % TWO_PI;
  if (e <= 0) return M;
  // Semilla robusta para e alta: E0 = π (Danby usa M + 0.85·e·sign(sin M)).
  let E = e > 0.8 ? Math.PI : M;
  for (let i = 0; i < 50; i++) {
    const f = E - e * Math.sin(E) - M;
    const step = f / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return E;
}

/** Anomalía verdadera (rad, 0-2π) a partir de la media. */
export function trueAnomalyFromMeanAnomaly(meanAnomalyRad: number, e: number): number {
  const E = solveKeplerEquation(meanAnomalyRad, e);
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  return ((nu % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * Fase angular 0-1 (ν / 2π, desde el perigeo) tras `tSeconds` en una órbita de periodo `periodS`
 * y excentricidad `e`. Para e = 0 coincide con la fase uniforme t/T.
 */
export function orbitPhaseAt(tSeconds: number, periodS: number, e: number): number {
  if (periodS <= 0) return 0;
  const meanPhase = (((tSeconds % periodS) + periodS) % periodS) / periodS;
  if (e <= 0) return meanPhase;
  return trueAnomalyFromMeanAnomaly(meanPhase * TWO_PI, e) / TWO_PI;
}

/** Altitud (km) en la anomalía verdadera ν: r = a(1 − e²) / (1 + e·cos ν) − R⊕. */
export function altitudeAtTrueAnomaly(orbit: Pick<OrbitDef, 'perigeeKm' | 'apogeeKm'>, trueAnomalyRad: number): number {
  const e = orbitEccentricity(orbit);
  const a = EARTH_RADIUS_KM + (orbit.perigeeKm + orbit.apogeeKm) / 2;
  return (a * (1 - e * e)) / (1 + e * Math.cos(trueAnomalyRad)) - EARTH_RADIUS_KM;
}
