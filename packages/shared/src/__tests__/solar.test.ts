/**
 * Fase 4 (ADR 0016): el sistema solar como mapa. Datos de los cuerpos, potencia solar frente a distancia,
 * generación determinista y completable de los tramos, mundos de superficie y posiciones para dibujar.
 */
import { describe, expect, it } from 'vitest';
import {
  bodyPositionAu, bodySunDistanceAu, catalog, generateSector, generateSolarSector, parseCatalog, getBody, getNode, getNodeWorld, getSolarSystem, isSectorSolvable, legUnits,
  nodeDistanceLy, routeZones, sectorZones, shipFromDesign, shipPowerKw, solarKw, solarNodePositionsAu, solarPowerFactor, zoneBodies,
  type SectorMap,
} from '../index';
import { referenceDesign } from './missionFixtures';
import { getMissions } from '../design';

const sys = getSolarSystem();

describe('cuerpos del sistema solar (datos públicos de NASA)', () => {
  it('distancias al Sol reales y las lunas heredan la de su planeta', () => {
    expect(bodySunDistanceAu(getBody('earth'))).toBe(1);
    expect(bodySunDistanceAu(getBody('mars'))).toBeCloseTo(1.524, 3);
    expect(bodySunDistanceAu(getBody('jupiter'))).toBeCloseTo(5.203, 3);
    expect(bodySunDistanceAu(getBody('saturn'))).toBeCloseTo(9.537, 3);
    expect(bodySunDistanceAu(getBody('europa'))).toBe(bodySunDistanceAu(getBody('jupiter')));
    expect(bodySunDistanceAu(getBody('luna'))).toBe(1);
    expect(getBody('luna').gravityMps2).toBeCloseTo(1.62, 2);
    expect(getBody('mars').gravityMps2).toBeCloseTo(3.71, 2);
    expect(getBody('titan').atmosphere).toBe(true);
  });

  it('hay al menos Luna, Marte, Fobos, Ceres, un asteroide, una luna de Júpiter, Titán y Encélado; cada aterrizable con su mundo', () => {
    for (const id of ['luna', 'mars', 'phobos', 'ceres', 'vesta', 'europa', 'ganymede', 'callisto', 'titan', 'enceladus']) expect(getBody(id).landable, id).toBe(true);
    for (const b of sys.bodies.filter((x) => x.landable)) {
      const world = catalog.surface!.worlds.find((w) => w.id === b.worldId);
      expect(world?.kind, b.id).toBe(b.nodeKind);
    }
    expect(getBody('jupiter').landable).toBe(false);
  });

  it('cada zona tiene su estación y van de dentro a fuera', () => {
    for (const [i, z] of sys.zones.entries()) {
      expect(getBody(z.hubId).nodeKind).toBe('station');
      if (i > 0) expect(z.sunDistanceAu).toBeGreaterThan(sys.zones[i - 1]!.sunDistanceAu);
    }
  });
});

describe('potencia solar frente a distancia', () => {
  it('los paneles dan 1/d² y lo nuclear no cambia', () => {
    expect(solarPowerFactor(1)).toBe(1);
    expect(solarPowerFactor(2)).toBeCloseTo(0.25, 9);
    expect(solarPowerFactor(5.203)).toBeCloseTo(1 / 27.07, 3);
    const ship = shipFromDesign(referenceDesign('mission-mars-habitability'));
    expect(solarKw(ship, 1)).toBe(ship.solarKwAt1Au);
    expect(solarKw(ship, 1.524)).toBeCloseTo(ship.solarKwAt1Au! / 1.524 ** 2, 6);
    const nuclear = shipFromDesign(referenceDesign('mission-titan-chemistry'));
    expect(shipPowerKw(nuclear, 1)).toBe(shipPowerKw(nuclear, 9.537));
    expect(shipPowerKw(nuclear, 1)).toBe(nuclear.reactorOutputKw);
  });
});

describe('ruta y tramos', () => {
  it('la ruta va de la Tierra a la zona del destino y vuelve', () => {
    expect(routeZones('luna').map((z) => z.id)).toEqual(['zone-earth']);
    expect(routeZones('europa').map((z) => z.id)).toEqual(['zone-earth', 'zone-mars', 'zone-belt', 'zone-jupiter']);
    const legs = [1, 2, 3, 4, 5, 6].map((i) => sectorZones(i, catalog, 'europa')).map((s) => `${s.from.id}>${s.to.id}`);
    expect(legs).toEqual([
      'zone-earth>zone-mars', 'zone-mars>zone-belt', 'zone-belt>zone-jupiter', 'zone-jupiter>zone-belt', 'zone-belt>zone-mars', 'zone-mars>zone-earth',
    ]);
    expect(sectorZones(3, catalog, 'luna').from.id).toBe('zone-earth');
    expect(sectorZones(3, catalog, 'luna').to.id).toBe('zone-earth');
  });

  it('la longitud del tramo crece con la diferencia de distancias al Sol (acotada)', () => {
    const r = sys.route;
    expect(legUnits(1, 1, r)).toBe(r.legMinUnits);
    expect(legUnits(1, 1.524, r)).toBeLessThan(legUnits(2.767, 5.203, r));
    expect(legUnits(1, 40, r)).toBe(r.legMaxUnits);
  });
});

function checkSector(sector: SectorMap, destinationId: string | null): void {
  const start = getNode(sector, sector.startId)!;
  const goal = getNode(sector, sector.goalId)!;
  const { from, to } = sectorZones(sector.index, catalog, destinationId);
  expect(sector.zoneFromId).toBe(from.id);
  expect(sector.zoneToId).toBe(to.id);
  expect(start.kind).toBe('station');
  expect(start.bodyId).toBe(from.hubId);
  expect(start.sunDistanceAu).toBeCloseTo(from.sunDistanceAu, 2);
  expect(goal.kind).toBe('gate');
  expect(goal.bodyId).toBe(to.hubId);
  expect(goal.sunDistanceAu).toBeCloseTo(to.sunDistanceAu, 3);
  // Todos los cuerpos de la zona de salida están en el tramo, una vez.
  const bodies = sector.nodes.filter((n) => n.bodyId && n !== start && n !== goal).map((n) => n.bodyId).sort();
  expect(bodies).toEqual(zoneBodies(from).map((b) => b.id).sort());
  // Una estación a mitad de tramo; enlaces coherentes y bidireccionales; distancias al Sol dentro del tramo.
  const columns = Math.max(...sector.nodes.map((n) => n.column)) - 1;
  expect(sector.nodes.some((n) => n.kind === 'station' && n.column === Math.ceil(columns / 2))).toBe(true);
  const lo = Math.min(from.sunDistanceAu, to.sunDistanceAu);
  const hi = Math.max(from.sunDistanceAu, to.sunDistanceAu);
  for (const n of sector.nodes) {
    expect(n.links.length, n.id).toBeGreaterThan(0);
    for (const l of n.links) expect(getNode(sector, l)!.links).toContain(n.id);
    if (!n.bodyId) expect(n.sunDistanceAu!).toBeGreaterThanOrEqual(lo - 1e-9);
    if (!n.bodyId) expect(n.sunDistanceAu!).toBeLessThanOrEqual(hi + 1e-9);
    if (n.bodyId === destinationId) expect(n.missionTarget).toBe(true);
    else expect(n.missionTarget).toBeUndefined();
  }
}

describe('generateSolarSector', () => {
  it('es determinista y cambia con la semilla y el sector', () => {
    const ship = shipFromDesign(referenceDesign('mission-europa-ocean'));
    expect(generateSolarSector(42, 1, ship, catalog, 'europa')).toEqual(generateSolarSector(42, 1, ship, catalog, 'europa'));
    expect(generateSolarSector(42, 1, ship, catalog, 'europa')).not.toEqual(generateSolarSector(43, 1, ship, catalog, 'europa'));
    expect(generateSolarSector(42, 2, ship, catalog, 'europa')).not.toEqual(generateSolarSector(42, 1, ship, catalog, 'europa'));
  });

  it.each(getMissions().map((m) => m.id))('%s: 40 semillas × 6 tramos bien formados y completables con su nave de referencia', (missionId) => {
    const design = referenceDesign(missionId);
    const ship = shipFromDesign(design);
    let solvable = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (let index = 1; index <= 6; index++) {
        const sector = generateSolarSector(seed, index, ship, catalog, design.destinationId);
        checkSector(sector, design.destinationId);
        if (isSectorSolvable(sector, ship)) solvable++;
      }
    }
    expect(solvable).toBe(240);
  });

  it('el destino aparece en el primer tramo que sale de su zona', () => {
    const design = referenceDesign('mission-mars-habitability');
    const ship = shipFromDesign(design);
    expect(generateSolarSector(7, 1, ship, catalog, 'mars').nodes.some((n) => n.missionTarget)).toBe(false);
    expect(generateSolarSector(7, 2, ship, catalog, 'mars').nodes.filter((n) => n.missionTarget).map((n) => n.bodyId)).toEqual(['mars']);
  });

  it('las distancias del mapa salen de las UA: los tramos largos son más largos', () => {
    const ship = shipFromDesign(referenceDesign('mission-europa-ocean'));
    const span = (s: SectorMap) => nodeDistanceLy(getNode(s, s.startId)!, getNode(s, s.goalId)!);
    expect(span(generateSolarSector(5, 3, ship, catalog, 'europa'))).toBeGreaterThan(span(generateSolarSector(5, 1, ship, catalog, 'europa')));
  });
});

describe('mundos y posiciones', () => {
  it('cada cuerpo aterrizable usa su mundo; los no aterrizables, ninguno; los puntos de paso, uno de su tipo', () => {
    const design = referenceDesign('mission-europa-ocean');
    const ship = shipFromDesign(design);
    for (let seed = 1; seed <= 5; seed++) {
      for (let index = 1; index <= 5; index++) {
        const sector = generateSolarSector(seed, index, ship, catalog, design.destinationId);
        for (const n of sector.nodes) {
          const world = getNodeWorld(seed, sector, n.id, catalog);
          if (n.bodyId) expect(world?.id ?? null, n.bodyId).toBe(getBody(n.bodyId).landable ? getBody(n.bodyId).worldId : null);
          else if (n.kind === 'asteroid') expect(world?.kind).toBe('asteroid');
          else expect(world).toBeNull();
        }
      }
    }
  });

  it('posiciones para dibujar: órbitas en UA, lunas junto a su planeta y un punto por nodo', () => {
    const earth = bodyPositionAu(getBody('earth'));
    expect(Math.hypot(earth.x, earth.y)).toBeCloseTo(1, 9);
    const mars = bodyPositionAu(getBody('mars'), catalog, 100);
    expect(Math.hypot(mars.x, mars.y)).toBeCloseTo(1.524, 6);
    const moon = bodyPositionAu(getBody('luna'));
    expect(Math.hypot(moon.x - earth.x, moon.y - earth.y)).toBeLessThan(0.2);
    expect(bodyPositionAu(getBody('earth'), catalog, 365.256 / 2)).not.toEqual(earth);
    const design = referenceDesign('mission-belt-ice');
    const sector = generateSolarSector(3, 2, shipFromDesign(design), catalog, design.destinationId);
    const pos = solarNodePositionsAu(sector);
    expect(Object.keys(pos).sort()).toEqual(sector.nodes.map((n) => n.id).sort());
    for (const p of Object.values(pos)) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});

describe('mundos con peso 0 (solo del sistema solar)', () => {
  const zeroIds = catalog.surface!.worlds.filter((w) => w.weight === 0).map((w) => w.id);

  it('el esquema admite peso 0 pero no negativo, y cada tipo aterrizable conserva algún mundo sorteable', () => {
    expect(zeroIds.length).toBeGreaterThan(0);
    const neg = JSON.parse(JSON.stringify(catalog)) as typeof catalog;
    neg.surface!.worlds[0]!.weight = -1;
    expect(() => parseCatalog(neg)).toThrow(/weight/);
    const onlyZero = JSON.parse(JSON.stringify(catalog)) as typeof catalog;
    for (const w of onlyZero.surface!.worlds) if (w.kind === 'planet') w.weight = 0;
    expect(() => parseCatalog(onlyZero)).toThrow(/planet[\s\S]*peso > 0/);
  });

  it('nunca salen en los sectores clásicos y sí se usan por el worldId de su cuerpo', () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (let index = 1; index <= 4; index++) {
        const sector = generateSector(seed, index);
        for (const n of sector.nodes) {
          const world = getNodeWorld(seed, sector, n.id, catalog);
          if (world) expect(zeroIds, `${seed}/${index}/${n.id}`).not.toContain(world.id);
        }
      }
    }
    const used = new Set<string>();
    for (const missionId of ['mission-mars-habitability', 'mission-europa-ocean', 'mission-titan-chemistry']) {
      const design = referenceDesign(missionId);
      const ship = shipFromDesign(design);
      for (let index = 1; index <= 8; index++) {
        const sector = generateSolarSector(1, index, ship, catalog, design.destinationId);
        for (const n of sector.nodes) {
          const world = getNodeWorld(1, sector, n.id, catalog);
          if (n.bodyId && world) expect(world.id).toBe(getBody(n.bodyId).worldId);
          if (world && zeroIds.includes(world.id)) used.add(world.id);
        }
      }
    }
    for (const id of zeroIds.filter((w) => catalog.solarSystem!.bodies.some((b) => b.worldId === w))) expect(used, id).toContain(id);
  });
});
