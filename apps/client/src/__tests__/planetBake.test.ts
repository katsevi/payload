/**
 * Horneado de los planetas del mapa solar (`gfx/planetBake.ts`): determinista, normales válidas y canales con el
 * significado que espera `mapPlanetMaterial`.
 */
import { describe, expect, it } from 'vitest';
import { catalog, getSolarSystem } from '@payload/shared';
import { bakePlanet, bakeSize, BAKE_TYPES, snoise, type BakeLook, type BakeType } from '../gfx/planetBake';
import { PLANET_TYPES } from '../gfx/spaceShaders';
import { bodyLook } from '../gfx/bodyLook';
import { bodyDisplayRadius } from '../game/solarScale';

const look = (type: BakeType): BakeLook => ({ type, seed: 12.3, a: [0.2, 0.3, 0.5], b: [0.6, 0.5, 0.3], c: [0.9, 0.6, 0.1] });
const W = 64;
const H = 32;

describe('horneado de planetas del mapa solar', () => {
  it('los tipos coinciden con los del shader procedural', () => {
    expect([...BAKE_TYPES]).toEqual([...PLANET_TYPES]);
  });

  it('el ruido simplex queda acotado y no es constante', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const v = snoise(i * 0.37, i * 0.11 - 3, Math.sin(i) * 5);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThan(-1.05);
    expect(max).toBeLessThan(1.05);
    expect(max - min).toBeGreaterThan(1);
  });

  it.each(BAKE_TYPES)('%s: determinista, del tamaño pedido y con normales unitarias hacia fuera', (type) => {
    const a = bakePlanet(look(type), W, H);
    const b = bakePlanet(look(type), W, H);
    expect(a.albedo.length).toBe(W * H * 4);
    expect(a.normal.length).toBe(W * H * 4);
    expect(a.albedo).toEqual(b.albedo);
    expect(a.normal).toEqual(b.normal);
    for (let row = 0; row < H; row++)
      for (let col = 0; col < W; col++) {
        const o = (row * W + col) * 4;
        const n = [0, 1, 2].map((k) => a.normal[o + k]! / 255 * 2 - 1);
        expect(Math.hypot(n[0]!, n[1]!, n[2]!)).toBeCloseTo(1, 1);
        // La normal no se aleja de la dirección radial (mismo reparto de UV que `SphereGeometry`).
        const theta = (1 - (row + 0.5) / H) * Math.PI;
        const phi = ((col + 0.5) / W) * Math.PI * 2;
        const p = [-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)];
        expect(n[0]! * p[0]! + n[1]! * p[1]! + n[2]! * p[2]!).toBeGreaterThan(0.5);
      }
  });

  it('otra semilla da otro planeta', () => {
    const a = bakePlanet(look('moon'), W, H);
    const b = bakePlanet({ ...look('moon'), seed: 40.1 }, W, H);
    expect(a.albedo).not.toEqual(b.albedo);
  });

  it('canal extra: nubes solo en el terrestre y grietas solo en la lava', () => {
    const extraOf = (type: BakeType) => {
      const { normal } = bakePlanet(look(type), W, H);
      let s = 0;
      for (let i = 3; i < normal.length; i += 4) s += normal[i]!;
      return s;
    };
    expect(extraOf('terran')).toBeGreaterThan(0);
    expect(extraOf('lava')).toBeGreaterThan(0);
    for (const t of ['desert', 'gas', 'ice', 'moon'] as const) expect(extraOf(t)).toBe(0);
  });

  it('los cuerpos grandes del mapa se hornean con más resolución', () => {
    const sizes = getSolarSystem(catalog).bodies.flatMap((b) => (bodyLook(b).kind === 'globe' ? [bakeSize(bodyDisplayRadius(b)).width] : []));
    expect(sizes.length).toBeGreaterThan(0);
    const jupiter = getSolarSystem(catalog).bodies.find((b) => b.id === 'jupiter');
    if (jupiter) expect(bakeSize(bodyDisplayRadius(jupiter)).width).toBe(512);
    expect(bakeSize(0.12).width).toBe(256);
  });
});
