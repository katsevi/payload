import { describe, expect, it } from 'vitest';
import { catalog, computeOrbitParams, createMissionSim, createRng, getOrbit, reviewGoNoGo, runMission } from '../index';
import type { MissionDesign, SimEvent, SimSnapshot } from '../types';
import { allDesignNames, emptyDesign, loadDesign, SCENARIO_ID } from './fixtures';

const DAY = 86400;
const strip = ({ newEvents: _e, ...rest }: SimSnapshot) => rest;

describe('simulación: determinismo', () => {
  const design = loadDesign('ok-microsat-leo-thermal');

  it('misma semilla = mismo resultado', () => {
    for (const seed of [1, 42, 20260101]) {
      expect(runMission(design, catalog, { seed })).toEqual(runMission(design, catalog, { seed }));
    }
  });

  it('semillas distintas pueden dar resultados distintos', () => {
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const r = runMission(design, catalog, { seed });
      outcomes.add(`${r.launchSuccess}|${r.events.filter((e) => !/^(eclipse|contact)/.test(e.type)).map((e) => e.type).join(',')}`);
    }
    expect(outcomes.size).toBeGreaterThan(3);
  });

  it('trocear step() no cambia nada: step(1)×N = step(N)', () => {
    const a = createMissionSim(design, catalog, { seed: 5 });
    const b = createMissionSim(design, catalog, { seed: 5 });
    const evA: SimEvent[] = [];
    let snapA!: SimSnapshot;
    for (let i = 0; i < 4 * 3600; i++) {
      snapA = a.step(1);
      evA.push(...snapA.newEvents);
    }
    const snapB = b.step(4 * 3600);
    expect(strip(snapA)).toEqual(strip(snapB));
    expect(evA).toEqual(snapB.newEvents);
  });

  it('trocear con tamaños irregulares (0.1 s, aleatorios) da la misma misión completa', () => {
    const sim = createMissionSim(design, catalog, { seed: 9 });
    for (let i = 0; i < 3000; i++) sim.step(0.1);
    const rng = createRng(1234);
    const all: SimEvent[] = [];
    let guard = 0;
    while (!sim.isFinished() && guard++ < 100000) all.push(...sim.step(rng.next() * 5000).newEvents);
    const chunked = sim.finish();
    const whole = runMission(design, catalog, { seed: 9 });
    expect(chunked).toEqual(whole);
  });

  it('newEvents concatenados = eventos del resultado', () => {
    const sim = createMissionSim(design, catalog, { seed: 3 });
    const seen: SimEvent[] = [];
    while (!sim.isFinished()) seen.push(...sim.step(DAY / 3).newEvents);
    seen.push(...sim.snapshot().newEvents);
    expect(seen).toEqual(sim.finish().events);
    expect(sim.snapshot().newEvents).toEqual([]);
  });

  it('runMission = createMissionSim + finish', () => {
    expect(createMissionSim(design, catalog, { seed: 77 }).finish()).toEqual(runMission(design, catalog, { seed: 77 }));
  });

  it('usa la semilla por defecto del escenario', () => {
    const r = runMission(design);
    expect(r.seed).toBe(catalog.scenarios[0]!.defaultSeed);
  });

  it('30 días se simulan rápido (objetivo < 200 ms; guarda 10×; medida fina con `pnpm bench`)', () => {
    const heavy = loadDesign('ok-microsat-sso-hires');
    runMission(heavy); // calentamiento
    // Mejor de 3 para filtrar picos de carga de la máquina.
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      runMission(heavy, catalog, { seed: 2 + i });
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(2000);
  });
});

describe('simulación: modelo', () => {
  const design = loadDesign('ok-cubesat-leo');
  const leo = computeOrbitParams(getOrbit('LEO'));

  it('fases orbitales: eclipse con la duración de la órbita y contactos repartidos', () => {
    const sim = createMissionSim(design, catalog, { seed: 1 });
    const snap = sim.step(DAY);
    const enters = snap.newEvents.filter((e) => e.type === 'eclipse-enter');
    const exits = snap.newEvents.filter((e) => e.type === 'eclipse-exit');
    expect(enters.length).toBeGreaterThanOrEqual(Math.floor(leo.orbitsPerDay));
    const first = exits[0]!.tSeconds - enters[0]!.tSeconds;
    expect(Math.abs(first - leo.eclipseMin * 60)).toBeLessThanOrEqual(30);
    const contacts = snap.newEvents.filter((e) => e.type === 'contact-start');
    expect(contacts.length).toBeGreaterThanOrEqual(8);
    expect(snap.orbitPhase).toBeGreaterThanOrEqual(0);
    expect(snap.orbitPhase).toBeLessThan(1);
    expect(snap.day).toBe(2);
  });

  it('la batería se descarga en la sombra y se recarga al sol', () => {
    const sim = createMissionSim(design, catalog, { seed: 1 });
    let min = 100;
    let sawEclipse = false;
    for (let t = 0; t < 2 * leo.periodMin * 60; t += 30) {
      const s = sim.step(30);
      if (s.inEclipse) sawEclipse = true;
      min = Math.min(min, s.batteryPct);
    }
    expect(sawEclipse).toBe(true);
    expect(min).toBeLessThan(100);
    expect(min).toBeGreaterThan(60);
  });

  it('battery-low avisa al cruzar el suelo de la DoD y bajar de él desgasta la batería', () => {
    // Batería pequeña (DoD 40 % → suelo 60 %) con cámara térmica: cruza el suelo en cada eclipse.
    const r = runMission(loadDesign('fail-battery-eclipse'));
    const low = r.events.find((e) => e.type === 'battery-low')!;
    expect(low.message.params?.floorPct).toBe(60);
    expect(Number(low.message.params?.pct)).toBeLessThan(60);
    expect(r.finalBatteryCapacityPct!).toBeLessThan(100);
    // Un diseño sano nunca baja de la DoD ni pierde capacidad sin tormentas.
    const cat = { ...catalog, scenarios: catalog.scenarios.map((s) => ({ ...s, eventsEnabled: false })) };
    const ok = runMission(design, cat);
    expect(ok.events.some((e) => e.type === 'battery-low')).toBe(false);
    expect(ok.finalBatteryCapacityPct).toBe(100);
    expect(ok.minBatteryPct).toBeGreaterThan(60); // suelo DoD de la batería mediana
  });

  it('los datos bajados no superan la capacidad de bajada', () => {
    const r = runMission(design, catalog, { seed: 1 });
    const cap = r.budgets.totals.downlinkCapacityMbitPerDay * 30;
    expect(r.dataDownlinkedMbit).toBeLessThanOrEqual(cap * 1.001);
    expect(r.dataDownlinkedMbit).toBeGreaterThan(0.9 * 6000 * 30);
  });

  it('si el almacenamiento se llena, los datos se pierden', () => {
    const r = runMission(loadDesign('fail-data-uhf'));
    expect(r.events.some((e) => e.type === 'storage-full')).toBe(true);
    expect(r.dataLostMbit).toBeGreaterThan(0);
  });

  it('sin eventsEnabled no hay eventos aleatorios', () => {
    const cat = { ...catalog, scenarios: catalog.scenarios.map((s) => ({ ...s, eventsEnabled: false })) };
    for (let seed = 1; seed <= 20; seed++) {
      const r = runMission(design, cat, { seed });
      expect(r.events.some((e) => ['solar-storm', 'reaction-wheel-failure', 'debris-avoidance'].includes(e.type))).toBe(false);
    }
  });

  it('con eventos activos aparecen los tres tipos según la semilla', () => {
    const types = new Set<string>();
    for (let seed = 1; seed <= 80; seed++) {
      for (const e of runMission(loadDesign('ok-microsat-leo-thermal'), catalog, { seed }).events) types.add(e.type);
    }
    expect(types).toContain('solar-storm');
    expect(types).toContain('reaction-wheel-failure');
    expect(types).toContain('debris-avoidance');
  });

  it('mission-complete al cumplir operationDays', () => {
    const r = runMission(design);
    expect(r.status).toBe('complete');
    expect(r.daysOperated).toBe(30);
    expect(r.events.at(-1)!.type).toBe('mission-complete');
    expect(r.events.at(-1)!.tSeconds).toBe(30 * DAY);
  });

  it('el lanzamiento se tira con la fiabilidad del lanzador', () => {
    let failures = 0;
    const n = 400;
    for (let seed = 0; seed < n; seed++) {
      const sim = createMissionSim(design, catalog, { seed });
      const first = sim.snapshot().newEvents[0]!;
      if (first.type === 'launch-failure') failures++;
    }
    // Albatros: fiabilidad 0.98 → ~8 fallos de 400
    expect(failures).toBeGreaterThan(0);
    expect(failures).toBeLessThan(25);
    const failed = Array.from({ length: n }, (_, seed) => runMission(design, catalog, { seed })).find((r) => !r.launchSuccess)!;
    expect(failed.status).toBe('failed');
    expect(failed.daysOperated).toBe(0);
    expect(failed.report[0]!.message.key).toBe('report.launch.failure');
  });

  it('tolera diseños parciales sin lanzar errores', () => {
    const partials: MissionDesign[] = [
      emptyDesign(),
      { ...emptyDesign(), orbitId: 'LEO', launcherId: 'launcher-colibri' },
      { ...emptyDesign(), componentIds: ['structure-microsat', 'payload-thermal-camera'], orbitId: 'LEO', launcherId: 'launcher-colibri' },
      { scenarioId: SCENARIO_ID, componentIds: ['nope'], orbitId: 'GEO', launcherId: 'launcher-albatros' },
    ];
    for (const d of partials) {
      const r = runMission(d);
      expect(['failed', 'complete', 'degraded', 'nominal']).toContain(r.status);
    }
    // Sin paneles ni batería la nave se pierde.
    expect(runMission(partials[2]!).status).toBe('failed');
  });

  it('propiedad: un diseño Go sin aviso de tormenta no falla en operación (solo puede fallar el lanzamiento)', () => {
    const rng = createRng(2024);
    const pick = <T,>(xs: T[]) => xs[rng.int(0, xs.length - 1)]!;
    const by = (s: string) => catalog.components.filter((c) => c.subsystem === s).map((c) => c.id);
    let goCount = 0;
    for (let i = 0; i < 3000 && goCount < 40; i++) {
      const ids = [
        pick(by('structure')), pick(by('power')), pick(by('power')), pick(by('battery')), pick(by('comms')),
        pick(by('obc')), pick(by('adcs')), pick(by('thermal')), pick(by('payload')),
      ];
      if (rng.chance(0.5)) ids.push(pick(by('power')));
      if (rng.chance(0.4)) ids.push(pick(by('battery')));
      const d: MissionDesign = { scenarioId: SCENARIO_ID, componentIds: ids, orbitId: pick(['LEO', 'SSO'] as const), launcherId: pick(['launcher-albatros', 'launcher-colibri']) };
      const review = reviewGoNoGo(d);
      if (!review.go || review.issues.some((x) => x.code === 'power-storm')) continue;
      goCount++;
      for (const seed of [1, 2, 3]) {
        const r = runMission(d, catalog, { seed });
        if (r.launchSuccess) expect(r.status, JSON.stringify(d)).toBe('complete');
      }
    }
    expect(goCount).toBeGreaterThan(10);
  });

  it('todos los diseños de ejemplo se simulan', () => {
    for (const n of allDesignNames()) expect(() => runMission(loadDesign(n))).not.toThrow();
  });
});
