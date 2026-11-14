/**
 * Fase 4 (ADR 0016): la partida con una misión diseñada. Sin diseño todo sigue igual; con él, la nave sale del
 * diseño, el mapa es el sistema solar, la potencia de los paneles depende de la posición y las mejoras se
 * aplican encima. Determinista se trocee como se trocee el tiempo.
 */
import { describe, expect, it } from 'vitest';
import {
  catalog, createRun, effectiveShip, FIXED_STEP_S, generateSolarSector, getNode, shipFromDesign, solarKw,
  type MissionDesign, type Run, type RunState,
} from '../index';
import { playRun } from './bot';
import { referenceDesign } from './missionFixtures';

const mars = referenceDesign('mission-mars-habitability');
const titan = referenceDesign('mission-titan-chemistry');

/** Guion fijo: salta al primer enlace de cada nodo; acciones en instantes fijos. */
function scripted(design: MissionDesign | undefined, chunkS: number, totalS = 240): RunState {
  const run = createRun(design ? { seed: 11, design } : { seed: 11 });
  let t = 0;
  let nextAction = 0;
  while (t < totalS - 1e-9) {
    if (t >= nextAction - 1e-9) {
      nextAction += 5;
      if (run.state.phase === 'docked') {
        const here = getNode(run.state.sector, run.state.locationId)!;
        const to = here.links.map((id) => getNode(run.state.sector, id)!).find((n) => n.column > here.column);
        if (to) run.apply({ type: 'jump', toId: to.id });
      }
      if (run.state.phase === 'won') run.apply({ type: 'next-sector' });
      for (const inc of run.state.incidents) run.apply({ type: 'work-incident', incidentId: inc.id, seconds: 0.5 });
    }
    // Avanza hasta la próxima acción en trozos de `chunkS` (el último, recortado).
    const until = Math.min(nextAction, totalS);
    while (t < until - 1e-9) {
      const dt = Math.min(chunkS, until - t);
      run.step(dt);
      t += dt;
    }
  }
  return run.snapshot();
}

describe('partida sin diseño: igual que en las fases 1-3', () => {
  it('no añade campos de la fase 4 al estado ni a los nodos', () => {
    const run = createRun({ seed: 3 });
    expect(run.state.missionDesign).toBeUndefined();
    expect(run.state.sunDistanceAu).toBeUndefined();
    expect(run.state.ship.solarSupplyKw).toBeUndefined();
    expect(run.state.sector.zoneFromId).toBeUndefined();
    expect(run.state.sector.nodes.every((n) => n.bodyId === undefined && n.sunDistanceAu === undefined)).toBe(true);
    expect(run.state.ship.powerSupplyKw).toBe(catalog.ships[0]!.reactorOutputKw);
  });
});

describe('partida con diseño', () => {
  it('usa la nave diseñada y el mapa del sistema solar', () => {
    const run = createRun({ seed: 5, design: mars });
    const ship = shipFromDesign(mars);
    expect(run.effectiveShip()).toEqual(ship);
    expect(run.state.missionDesign).toEqual(mars);
    expect(run.state.ship.fuel).toBe(ship.fuelCapacity);
    expect(run.state.ship.hull).toBe(ship.hullMax);
    expect(run.state.sector).toEqual(generateSolarSector(5, 1, ship, catalog, mars.destinationId));
    expect(run.state.sector.zoneFromId).toBe('zone-earth');
    expect(run.state.sunDistanceAu).toBe(1);
    // El diseño se copia: tocar el original no cambia la partida.
    const copy: MissionDesign = JSON.parse(JSON.stringify(mars));
    const other = createRun({ seed: 5, design: copy });
    copy.moduleIds.push('fission-reactor');
    expect(other.state.missionDesign).toEqual(mars);
  });

  it('es determinista se trocee como se trocee el tiempo', () => {
    const a = scripted(mars, FIXED_STEP_S);
    const b = scripted(mars, 0.37);
    const c = scripted(mars, 1.3);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(a.stats.jumps).toBeGreaterThan(0);
    expect(playRun(9, { skill: 'crew', sectors: 2, design: titan }).state).toEqual(playRun(9, { skill: 'crew', sectors: 2, design: titan }).state);
  });

  it('la potencia de los paneles depende de la distancia al Sol del nodo (1/d²); la nuclear no', () => {
    for (const design of [mars, titan]) {
      const run = createRun({ seed: 2, design });
      const ship = run.effectiveShip();
      // Recorre los nodos de varios tramos: en cada uno, potencia = (nuclear + paneles/d²) con el reactor sano.
      for (const index of [1, 2, 3]) {
        const sector = generateSolarSector(2, index, shipFromDesign(design), catalog, design.destinationId);
        run.state.sector = sector;
        for (const n of sector.nodes) {
          run.state.locationId = n.id;
          expect(run.apply({ type: 'set-throttle', throttle: 'cruise' }).ok).toBe(true);
          const d = n.sunDistanceAu!;
          expect(run.state.sunDistanceAu).toBeCloseTo(d, 3);
          expect(run.state.ship.solarSupplyKw).toBeCloseTo(solarKw(ship, d), 6);
          expect(run.state.ship.powerSupplyKw).toBeCloseTo(ship.reactorOutputKw + solarKw(ship, d), 6);
        }
      }
    }
    // Solo paneles: en Marte da menos que en la Tierra; solo nuclear: lo mismo.
    const atAu = (design: MissionDesign, au: number) => shipFromDesign(design).reactorOutputKw + solarKw(shipFromDesign(design), au);
    expect(atAu(mars, 1.524)).toBeLessThan(atAu(mars, 1));
    expect(atAu(titan, 9.537)).toBe(atAu(titan, 1));
  });

  it('en tránsito la distancia al Sol se interpola entre salida y llegada', () => {
    const run = createRun({ seed: 4, design: mars });
    const s = run.state;
    for (let guard = 0; guard < 40 && s.stats.sectorsCleared === 0 && s.phase !== 'lost'; guard++) {
      if (s.phase === 'docked') {
        const here = getNode(s.sector, s.locationId)!;
        const to = here.links.map((id) => getNode(s.sector, id)!).sort((a, b) => b.column - a.column)[0]!;
        run.apply({ type: 'jump', toId: to.id });
      }
      const transit = s.transit;
      if (transit) {
        const a = getNode(s.sector, transit.fromId)!.sunDistanceAu!;
        const b = getNode(s.sector, transit.toId)!.sunDistanceAu!;
        run.step(1);
        if (s.transit) {
          const f = s.transit.traveledLy / s.transit.distanceLy;
          expect(s.sunDistanceAu!).toBeCloseTo(a + (b - a) * f, 2);
        }
      }
      for (let i = 0; i < 400 && s.phase === 'transit'; i++) run.step(FIXED_STEP_S);
      for (const inc of [...s.incidents]) run.apply({ type: 'work-incident', incidentId: inc.id, seconds: 0.5 });
    }
    expect(s.stats.jumps).toBeGreaterThan(0);
  });

  it('las mejoras de la estación se aplican encima de la nave diseñada', () => {
    const run = createRun({ seed: 6, design: mars });
    run.state.credits = 10_000;
    const quote = run.stationQuote()!;
    expect(quote).not.toBeNull();
    const offered = quote.upgrades[0]!.upgradeId;
    expect(run.apply({ type: 'buy-upgrade', upgradeId: offered }).ok).toBe(true);
    expect(run.effectiveShip()).toEqual(effectiveShip(shipFromDesign(mars), { [offered]: 1 }, catalog));
  });

  it('los cuerpos reales salen en los mensajes por id (nombre localizado) y el destino se marca', () => {
    const r = playRun(3, { skill: 'crew', sectors: 2, design: mars });
    const keys = new Set(r.events.map((e) => e.message.key));
    expect(keys.has('event.arrivedBody')).toBe(true);
    expect(keys.has('event.jumpBody')).toBe(true);
    for (const e of r.events.filter((x) => x.message.key === 'event.arrivedBody')) expect(catalog.solarSystem!.bodies.some((b) => b.id === e.message.params?.body)).toBe(true);
    const run: Run = createRun({ seed: 3, design: mars });
    run.apply({ type: 'next-sector' }); // rechazada: no está en el portal
    expect(run.state.sector.index).toBe(1);
  });
});
