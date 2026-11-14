/**
 * Aspecto de los cuerpos del sistema solar en el mapa 3D (fase 4). Sale de los datos del cuerpo (tipo, tamaño,
 * atmósfera y el mundo de superficie al que enlaza) y, para los cuerpos más reconocibles, de una tabla de aspecto
 * por id (como `SURFACE_LOOKS` por mundo). Un cuerpo nuevo del catálogo funciona sin tocar esto.
 */
import { Color } from 'three';
import type { SolarBodyDef } from '@payload/shared';
import { hashOf } from '../game/noise';
import type { PlanetLook, PlanetType } from './spaceShaders';

export type BodyLook =
  | { kind: 'sun' }
  | { kind: 'station' }
  | { kind: 'rock'; tone: number }
  | { kind: 'globe'; look: PlanetLook; ring: boolean };

const c = (hex: string): Color => new Color(hex);

/** Paletas por tipo de superficie (a, b, c, atmósfera). */
const PALETTES: Record<PlanetType, [string, string, string, string]> = {
  terran: ['#1f5fa8', '#3f7a3a', '#8a7a5a', '#7fb8ff'],
  desert: ['#7a3a1c', '#c46a3c', '#4a2414', '#e0a070'],
  gas: ['#b98a5a', '#e8d2b0', '#8a4a2a', '#e8c8a0'],
  ice: ['#b8c8d8', '#eef4fa', '#7a5a4a', '#cfe6ff'],
  lava: ['#2a2008', '#6a5a1a', '#ffb020', '#ffcc60'],
  moon: ['#9c9995', '#56534f', '#000000', '#000000'],
};

/** Aspecto propio de los cuerpos más reconocibles (si no está, se deduce de los datos). */
const LOOK_OVERRIDES: Record<string, { type: PlanetType; colors?: [string, string, string, string]; ring?: boolean }> = {
  earth: { type: 'terran' },
  mars: { type: 'desert' },
  jupiter: { type: 'gas' },
  saturn: { type: 'gas', colors: ['#c8a870', '#efe0bc', '#9a7a4a', '#f0deb0'], ring: true },
  io: { type: 'lava' },
  europa: { type: 'ice' },
  ganymede: { type: 'moon', colors: ['#8a8278', '#c0b8aa', '#000000', '#000000'] },
  callisto: { type: 'moon', colors: ['#5a524a', '#8a8070', '#000000', '#000000'] },
  enceladus: { type: 'ice', colors: ['#dfeaf2', '#ffffff', '#8ab0c8', '#e8f4ff'] },
  titan: { type: 'gas', colors: ['#c08a3a', '#d8a858', '#9a6a2a', '#e8b860'] },
};

/** Tipo de superficie deducido del mundo al que enlaza el cuerpo. */
const WORLD_TYPE: Record<string, PlanetType | 'rock'> = {
  'dust-moon': 'moon',
  'volcanic-moon': 'lava',
  'ice-core': 'ice',
  'storm-world': 'desert',
  'heavy-world': 'desert',
  'fractured-world': 'moon',
  'drifting-rock': 'rock',
  'mars-surface': 'desert',
  'ice-moon': 'ice',
  'titan-surface': 'gas',
  'enceladus-surface': 'ice',
};

const GAS_RADIUS_KM = 20000;
const ROCK_RADIUS_KM = 300;

export function bodyLook(body: SolarBodyDef): BodyLook {
  if (body.type === 'star') return { kind: 'sun' };
  if (body.type === 'station') return { kind: 'station' };
  const h = hashOf(body.id);
  const seed = ((h >>> 4) % 997) / 10;
  const over = LOOK_OVERRIDES[body.id];
  let type: PlanetType | 'rock';
  if (over) type = over.type;
  else if (body.radiusKm >= GAS_RADIUS_KM) type = 'gas';
  else if (body.type === 'asteroid' || body.radiusKm < ROCK_RADIUS_KM) type = 'rock';
  else if (body.worldId && WORLD_TYPE[body.worldId]) type = WORLD_TYPE[body.worldId]!;
  else if (body.type === 'planet' && body.atmosphere) type = 'terran';
  else type = 'moon';
  if (type === 'rock') return { kind: 'rock', tone: 0.55 + ((h >>> 8) % 40) / 100 };
  const [a, b, cc, atmo] = over?.colors ?? PALETTES[type];
  return { kind: 'globe', look: { type, seed, a: c(a), b: c(b), c: c(cc), atmosphere: c(atmo) }, ring: over?.ring ?? false };
}
