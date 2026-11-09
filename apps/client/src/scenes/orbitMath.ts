import { EARTH_RADIUS_KM } from '@payload/shared';

export const EARTH_R = 5;

/** Escala visual: altitud (km) → radio de la escena. No es a escala real (GEO quedaría fuera de cuadro). */
export function visualRadius(altKm: number): number {
  return Math.min(EARTH_R + 26, EARTH_R + 0.9 + (altKm / EARTH_RADIUS_KM) * EARTH_R * 0.55);
}

export interface OrbitShape {
  a: number;
  e: number;
  incRad: number;
  /** Posición (en el plano orbital, foco en la Tierra) para un ángulo θ; perigeo en θ = 0. */
  at: (theta: number) => [number, number, number];
  /** Igual que `at`, escribiendo en `out` (sin asignar memoria; para usar cada frame). */
  atTo: (theta: number, out: { set: (x: number, y: number, z: number) => unknown }) => void;
  apogeeR: number;
  /** Coordenada X del centro de la elipse (perigeo en +X ⇒ centro en −a·e). */
  centerX: number;
}

export function orbitShape(perigeeKm: number, apogeeKm: number, inclinationDeg: number): OrbitShape {
  const rp = visualRadius(perigeeKm);
  const ra = visualRadius(Math.max(apogeeKm, perigeeKm));
  const a = (rp + ra) / 2;
  const e = (ra - rp) / (ra + rp);
  const incRad = (inclinationDeg * Math.PI) / 180;
  const at = (theta: number): [number, number, number] => {
    const r = (a * (1 - e * e)) / (1 + e * Math.cos(theta));
    const x = r * Math.cos(theta);
    const z = r * Math.sin(theta);
    // Inclinación: giro alrededor del eje X (que apunta al Sol).
    return [x, -z * Math.sin(incRad), z * Math.cos(incRad)];
  };
  const atTo: OrbitShape['atTo'] = (theta, out) => {
    const r = (a * (1 - e * e)) / (1 + e * Math.cos(theta));
    const z = r * Math.sin(theta);
    out.set(r * Math.cos(theta), -z * Math.sin(incRad), z * Math.cos(incRad));
  };
  return { a, e, incRad, at, atTo, apogeeR: ra, centerX: -a * e };
}

/**
 * Arco de eclipse en anomalía verdadera [desde, hasta] (rad). El motor centra el eclipse en la fase media
 * 0.5 con ancho `eclipseFraction` (en tiempo); se convierte con la ecuación de Kepler del motor
 * (`trueAnomalyFromMeanAnomaly`, se inyecta para no duplicar la fórmula). En circulares: π ± π·f.
 */
export function eclipseArc(
  eclipseFraction: number,
  eccentricity: number,
  trueAnomalyFromMean: (meanAnomalyRad: number, e: number) => number,
): [number, number] {
  if (!(eclipseFraction > 0)) return [Math.PI, Math.PI];
  const half = Math.PI * Math.min(1, eclipseFraction);
  const e = Math.max(0, Math.min(0.99, eccentricity));
  const from = trueAnomalyFromMean(Math.PI - half, e);
  let to = trueAnomalyFromMean(Math.PI + half, e);
  if (to < from) to += Math.PI * 2;
  return [from, to];
}
