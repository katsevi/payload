/**
 * Fase 5 (ADR 0018 § 6): fiabilidad, calor y batería de la nave diseñada en vuelo. Sin diseño no cambia nada.
 */
import { describe, expect, it } from 'vitest';
import { catalog, createRun, designOperations, FIXED_STEP_S, getNode, parseCatalog, type Catalog } from '../index';
import { referenceDesign } from './missionFixtures';
import { advance, calmScienceCatalog, hotCatalog, lunar, overloadedRun } from './scienceHelpers';

const mars = referenceDesign('mission-mars-habitability');

describe('sin diseño', () => {
  it('no hay batería ni calor en el estado', () => {
    const s = createRun({ seed: 3 }).state.ship;
    expect(s.batteryKwh).toBeUndefined();
    expect(s.heatRejectKw).toBeUndefined();
    expect(s.overheated).toBeUndefined();
  });
});

describe('batería', () => {
  it('empieza llena con la capacidad de sus módulos', () => {
    const run = createRun({ seed: 3, design: lunar });
    const ops = designOperations(lunar);
    expect(ops.batteryKwh).toBeGreaterThan(0);
    expect(run.state.ship.batteryKwh).toBe(ops.batteryKwh);
    expect(run.state.ship.batteryMaxKwh).toBe(ops.batteryKwh);
  });

  it('cubre la sobrecarga sin dañar el reactor y, agotada, el reactor empieza a sufrir', () => {
    const run = overloadedRun();
    run.step(FIXED_STEP_S);
    expect(run.state.ship.overloaded).toBe(true);
    const before = run.state.ship.batteryKwh!;
    advance(run, 5);
    expect(run.state.ship.systems.reactor.healthPct).toBe(15);
    expect(run.state.ship.batteryKwh!).toBeLessThan(before);
    const events = advance(run, 600);
    expect(events.some((e) => e.type === 'battery-empty')).toBe(true);
    expect(run.state.ship.batteryKwh).toBe(0);
    expect(run.state.ship.systems.reactor.healthPct).toBeLessThan(15);
  });

  it('se recarga con el excedente, sin pasar de su capacidad', () => {
    const run = createRun({ seed: 3, design: lunar, catalog: calmScienceCatalog() });
    run.state.ship.batteryKwh = 1;
    advance(run, 30);
    expect(run.state.ship.batteryKwh!).toBeGreaterThan(1);
    advance(run, 3000);
    expect(run.state.ship.batteryKwh).toBeCloseTo(run.state.ship.batteryMaxKwh!, 6);
  });
});

describe('calor', () => {
  it('con los radiadores de serie el diseño de referencia no se sobrecalienta atracado', () => {
    const run = createRun({ seed: 3, design: mars, catalog: calmScienceCatalog() });
    advance(run, 20);
    expect(run.state.ship.overheated).toBe(false);
    expect(run.state.ship.systems.reactor.healthPct).toBe(100);
  });

  it('si la demanda pasa de lo que disipan, avisa una vez y el reactor se desgasta; apagando sistemas para', () => {
    const run = createRun({ seed: 3, design: lunar, catalog: hotCatalog() });
    // El aviso puede salir ya al crear la partida (la nave atracada ya pide más de lo que disipa).
    const events = [...run.takeEvents(), ...advance(run, 20)];
    expect(run.state.ship.overheated).toBe(true);
    expect(events.filter((e) => e.type === 'overheat')).toHaveLength(1);
    const hurt = run.state.ship.systems.reactor.healthPct;
    expect(hurt).toBeLessThan(100);
    for (const id of ['nav', 'shields', 'lifeSupport'] as const) run.apply({ type: 'toggle-system', systemId: id, enabled: false });
    advance(run, 10);
    expect(run.state.ship.overheated).toBe(false);
    expect(run.state.ship.systems.reactor.healthPct).toBe(hurt);
  });
});

describe('fiabilidad', () => {
  /** Averías por desgaste en el primer salto de varias semillas (sin peligros), con un k de fiabilidad dado. */
  const wearIncidents = (k: number): number => {
    const raw = JSON.parse(JSON.stringify(catalog)) as Catalog;
    for (const n of raw.nodeKinds) n.hazardPerLy = { impact: 0, short: 0, fire: 0, leak: 0 };
    raw.design!.operations!.reliabilityWearK = k;
    raw.design!.operations!.heatDamagePctPerSPerKw = 0;
    const cat = parseCatalog(raw);
    let n = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const run = createRun({ seed, design: mars, catalog: cat });
      const here = getNode(run.state.sector, run.state.locationId)!;
      run.apply({ type: 'jump', toId: here.links[0]! });
      for (let t = 0; t < 400 && run.state.phase === 'transit'; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
      n += run.takeEvents().filter((e) => e.type === 'incident').length;
    }
    return n;
  };

  it('una nave menos fiable (k mayor) tiene más averías por desgaste', () => {
    expect(wearIncidents(40)).toBeGreaterThan(wearIncidents(0) * 1.5);
  });

  it('el multiplicador sale de la fiabilidad del diseño (módulos, instrumentos y lanzador)', () => {
    const ops = designOperations(mars);
    expect(ops.reliability).toBeGreaterThan(0.5);
    expect(ops.reliability).toBeLessThan(1);
  });
});
