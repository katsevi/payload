import { describe, expect, it } from 'vitest';
import { catalog, ecoFuelCost, generateSector, getNode, getShip, isSectorSolvable, nodeDistanceLy, parseCatalog } from '../index';

const ship = getShip(undefined);

describe('catálogo', () => {
  it('el catálogo de serie es válido y tiene todos los tipos de destino', () => {
    expect(catalog.ships.length).toBeGreaterThan(0);
    expect(catalog.nodeKinds.map((k) => k.id).sort()).toEqual(['asteroid', 'derelict', 'gate', 'moon', 'nebula', 'planet', 'station']);
    expect(ship.throttles.map((t) => t.id)).toEqual(['eco', 'cruise', 'burn']);
  });

  it('parseCatalog rechaza contenido incoherente con un mensaje legible', () => {
    const raw = JSON.parse(JSON.stringify(catalog));
    raw.ships[0].startFuel = 999;
    raw.nodeKinds = raw.nodeKinds.filter((k: { id: string }) => k.id !== 'gate');
    raw.hazards.impact.hullDamageMin = 50;
    expect(() => parseCatalog(raw)).toThrow(/startFuel[\s\S]*gate/);
    expect(() => parseCatalog({ ...catalog, extra: 1 })).toThrow(/Catálogo inválido/);
  });

  it('con todo encendido a crucero el reactor aguanta, y a máxima no (compromiso de energía)', () => {
    const base = ship.systemDrawKw.lifeSupport + ship.systemDrawKw.shields + ship.systemDrawKw.nav;
    const draw = (id: 'eco' | 'cruise' | 'burn') => base + ship.systemDrawKw.engines * ship.throttles.find((t) => t.id === id)!.engineDrawMult;
    expect(draw('cruise')).toBeLessThanOrEqual(ship.reactorOutputKw);
    expect(draw('burn')).toBeGreaterThan(ship.reactorOutputKw);
    expect(draw('burn') - ship.systemDrawKw.shields).toBeLessThanOrEqual(ship.reactorOutputKw);
  });
});

describe('generateSector', () => {
  it('es determinista: misma semilla e índice, mismo mapa', () => {
    expect(generateSector(42, 1)).toEqual(generateSector(42, 1));
    expect(generateSector(42, 2)).toEqual(generateSector(42, 2));
    expect(generateSector(42, 1)).not.toEqual(generateSector(43, 1));
    expect(generateSector(42, 1)).not.toEqual(generateSector(42, 2));
  });

  it('200 semillas × 5 sectores: estación de salida, portal, enlaces coherentes y ruta completable', () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (let index = 1; index <= 5; index++) {
        const sector = generateSector(seed, index);
        const label = `semilla ${seed}, sector ${index}`;
        const start = getNode(sector, sector.startId)!;
        const goal = getNode(sector, sector.goalId)!;
        expect(start.kind, label).toBe('station');
        expect(goal.kind, label).toBe('gate');
        expect(sector.nodes.filter((n) => n.kind === 'gate'), label).toHaveLength(1);
        expect(new Set(sector.nodes.map((n) => n.id)).size, label).toBe(sector.nodes.length);
        expect(new Set(sector.nodes.map((n) => n.name)).size, label).toBe(sector.nodes.length);
        for (const node of sector.nodes) {
          expect(node.links.length, `${label}: ${node.id} aislado`).toBeGreaterThan(0);
          for (const other of node.links) {
            const o = getNode(sector, other)!;
            expect(o.links, `${label}: enlace no bidireccional`).toContain(node.id);
            expect(Math.abs(o.column - node.column), label).toBe(1);
          }
          if (node.kind === 'station' || node.kind === 'gate') expect(node.cache, label).toBeNull();
        }
        // Hay al menos una estación intermedia para repostar.
        expect(sector.nodes.filter((n) => n.kind === 'station').length, label).toBeGreaterThanOrEqual(2);
        expect(isSectorSolvable(sector, ship), label).toBe(true);
      }
    }
  });

  it('los sectores posteriores son más peligrosos y más largos', () => {
    const a = generateSector(7, 1);
    const b = generateSector(7, 5);
    expect(b.hazardMult).toBeGreaterThan(a.hazardMult);
    expect(Math.max(...b.nodes.map((n) => n.column))).toBeGreaterThan(Math.max(...a.nodes.map((n) => n.column)));
  });

  it('no todos los saltos se pueden permitir a régimen máximo: el combustible obliga a elegir', () => {
    let total = 0;
    let sectors = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const sector = generateSector(seed, 1);
      // Camino voraz por el vecino más cercano hacia delante.
      let node = getNode(sector, sector.startId)!;
      let ly = 0;
      while (node.id !== sector.goalId) {
        const next = node.links.map((id) => getNode(sector, id)!).filter((n) => n.column > node.column).sort((x, y) => nodeDistanceLy(node, x) - nodeDistanceLy(node, y))[0]!;
        ly += nodeDistanceLy(node, next);
        node = next;
      }
      total += ly;
      sectors++;
    }
    const meanLy = total / sectors;
    const burn = ship.throttles.find((t) => t.id === 'burn')!;
    expect(meanLy * ship.fuelPerLy * burn.fuelMult).toBeGreaterThan(ship.fuelCapacity);
    expect(ecoFuelCost(meanLy, ship)).toBeLessThan(ship.fuelCapacity);
  });
});
