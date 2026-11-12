/**
 * Distribución del interior de la nave (lógica pura, sin Three.js): dónde está cada puesto y qué
 * muros hay. La proa mira a −Z. Tres zonas separadas por mamparos con una puerta central:
 *
 *   PUENTE (z −13…−5)        timón · mapa estelar · navegación (sensores)
 *   CUBIERTA MEDIA (−5…4)    soporte vital · escudos · esclusa · bodega
 *   SALA DE MÁQUINAS (4…13)  panel de energía · reactor · motores
 *
 * Las distancias son parte del diseño: ir del timón al reactor cuesta ~4 s corriendo, así que una
 * sola persona no puede esquivar un impacto y apagar un fuego a la vez (ver docs/GDD.md).
 */
import { SYSTEM_IDS, type SystemId } from '@payload/shared';

export type StationId = SystemId | 'helm' | 'map' | 'power' | 'airlock';
export const STATION_IDS: readonly StationId[] = ['helm', 'map', 'power', 'airlock', ...SYSTEM_IDS];

export interface Station {
  id: StationId;
  /** Posición del objeto (x, z). */
  x: number;
  z: number;
  /** Punto desde el que se usa (delante del objeto). */
  useX: number;
  useZ: number;
  /** Giro del objeto (rad, eje Y) para que su frente (+Z local) mire al punto de uso. */
  yaw: number;
}

export const HULL = { halfWidth: 5, minZ: -13, maxZ: 13, height: 3.6 } as const;
/** Mamparos (posición z) y media anchura de la puerta central. */
export const BULKHEADS_Z = [-5, 4] as const;
export const DOOR_HALF_WIDTH = 1.6;
export const BULKHEAD_THICKNESS = 0.3;
/** Radio (en planta) dentro del cual se puede usar un puesto. */
export const USE_RADIUS = 2.3;
export const PLAYER_START: readonly [number, number, number] = [0, 0, 1.5];
export const RUN_SPEED_MPS = 5.5;

const station = (id: StationId, x: number, z: number, useX: number, useZ: number, yaw: number): Station => ({ id, x, z, useX, useZ, yaw });

export const STATIONS: Record<StationId, Station> = {
  helm: station('helm', 0, -11.3, 0, -10.1, 0),
  map: station('map', -3.9, -8, -2.9, -8, Math.PI / 2),
  nav: station('nav', 4.1, -8, 3.1, -8, -Math.PI / 2),
  lifeSupport: station('lifeSupport', -4.1, -0.5, -3, -0.5, Math.PI / 2),
  shields: station('shields', 4.1, -0.5, 3, -0.5, -Math.PI / 2),
  power: station('power', -4.7, 6.2, -3.7, 6.2, Math.PI / 2),
  reactor: station('reactor', 0, 8, 0, 8, 0),
  engines: station('engines', 0, 12.3, 0, 11.2, Math.PI),
  // Esclusa en el costado de babor de la cubierta media (fase 2: salir a la superficie).
  airlock: station('airlock', -4.6, 2.4, -3.5, 2.4, Math.PI / 2),
};

/** Bodega: cajas junto al costado de estribor de la cubierta media (crecen con `ship.cargo`). */
export const CARGO_BAY = { x: 3.9, z: 2.4, halfX: 0.75, halfZ: 1.3 } as const;

/** Zona de la nave a la que pertenece un punto (para las luces de alarma). */
export type Zone = 'bridge' | 'mid' | 'engine';
export function zoneAt(z: number): Zone {
  return z < BULKHEADS_Z[0] ? 'bridge' : z < BULKHEADS_Z[1] ? 'mid' : 'engine';
}

export function distanceToStation(id: StationId, x: number, z: number): number {
  const s = STATIONS[id];
  return Math.hypot(s.useX - x, s.useZ - z);
}

/** Puesto más cercano dentro del radio de uso (null = ninguno). */
export function nearestStation(x: number, z: number, radius = USE_RADIUS): StationId | null {
  let best: StationId | null = null;
  let bestD = radius;
  for (const id of STATION_IDS) {
    const d = distanceToStation(id, x, z);
    if (d <= bestD) {
      best = id;
      bestD = d;
    }
  }
  return best;
}

/** Segundos corriendo entre dos puestos pasando por las puertas (cota inferior: tramos rectos). */
export function runSecondsBetween(a: StationId, b: StationId): number {
  const A = STATIONS[a];
  const B = STATIONS[b];
  let x = A.useX;
  let z = A.useZ;
  let dist = 0;
  const doors = [...BULKHEADS_Z].filter((bz) => (bz - A.useZ) * (bz - B.useZ) < 0).sort((p, q) => (A.useZ < B.useZ ? p - q : q - p));
  for (const bz of doors) {
    const doorX = Math.max(-DOOR_HALF_WIDTH + 0.4, Math.min(DOOR_HALF_WIDTH - 0.4, x));
    dist += Math.hypot(doorX - x, bz - z);
    x = doorX;
    z = bz;
  }
  dist += Math.hypot(B.useX - x, B.useZ - z);
  return dist / RUN_SPEED_MPS;
}
