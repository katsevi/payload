import { describe, expect, it } from 'vitest';
import {
  catalog, computeBudgets, createMissionSim, createRng, deriveSeed, EVENT_TABLES, resolveEventTable, rollPreLaunchEvents, runMission,
} from '../index';
import { getResource } from '../budgets';
import { dailyComponentFailureChance, effectiveReliability, overheatingFactor } from '../events';
import type { Catalog, DifficultyLevel, MissionDesign, MissionResult, ScenarioDef, SimEvent } from '../types';
import { loadDesign, SCENARIO_ID } from './fixtures';

const RANDOM_TYPES = new Set(['solar-storm', 'debris-avoidance', 'reaction-wheel-failure', 'overheating']);
const isPartFailure = (e: SimEvent) => e.type === 'component-failure' && e.message.key.startsWith('event.componentFailure.');
const randomEvents = (r: MissionResult) => r.events.filter((e) => RANDOM_TYPES.has(e.type) || isPartFailure(e));

/** Catálogo con el escenario de la fase 1 modificado. */
function withScenario(patch: Partial<ScenarioDef>, base: Catalog = catalog): Catalog {
  return { ...base, scenarios: base.scenarios.map((s) => (s.id === SCENARIO_ID ? { ...s, ...patch } : s)) };
}

describe('tabla de eventos por dificultad', () => {
  it('la dificultad aumenta todas las probabilidades y rangos', () => {
    const order: DifficultyLevel[] = ['basic', 'intermediate', 'advanced'];
    for (let i = 1; i < order.length; i++) {
      const lo = EVENT_TABLES[order[i - 1]!];
      const hi = EVENT_TABLES[order[i]!];
      expect(hi.environmentChancePerDay).toBeGreaterThan(lo.environmentChancePerDay);
      expect(hi.overheatingChancePerDay).toBeGreaterThan(lo.overheatingChancePerDay);
      expect(hi.componentFailureAcceleration).toBeGreaterThan(lo.componentFailureAcceleration);
      expect(hi.launchDelayChance).toBeGreaterThan(lo.launchDelayChance);
      expect(hi.budgetCutChance).toBeGreaterThan(lo.budgetCutChance);
      expect(hi.launchDelayMonths.max).toBeGreaterThanOrEqual(lo.launchDelayMonths.max);
      expect(hi.budgetCutPct.max).toBeGreaterThanOrEqual(lo.budgetCutPct.max);
    }
  });

  it('el entorno conserva los valores de la fase 1 (las semillas documentadas no cambian)', () => {
    expect(EVENT_TABLES.basic.environmentChancePerDay).toBe(0.06);
    expect(EVENT_TABLES.basic.environmentWeights).toEqual({ 'solar-storm': 3, 'debris-avoidance': 4, 'reaction-wheel-failure': 2 });
  });

  it('eventTuning del escenario sustituye solo lo que define', () => {
    const s = catalog.scenarios[0]!;
    expect(resolveEventTable(s)).toEqual(EVENT_TABLES[s.difficulty]);
    const t = resolveEventTable({ ...s, eventTuning: { launchDelayChance: 0.9, environmentWeights: { 'solar-storm': 10 } } });
    expect(t.launchDelayChance).toBe(0.9);
    expect(t.environmentWeights).toEqual({ 'solar-storm': 10, 'debris-avoidance': 4, 'reaction-wheel-failure': 2 });
    expect(t.budgetCutChance).toBe(EVENT_TABLES.basic.budgetCutChance);
  });

  it('eventTuning se valida con zod al cargar el catálogo', async () => {
    const { parseCatalog } = await import('../index');
    const raw = structuredClone({ ...catalog, scenarios: [{ ...catalog.scenarios[0]!, eventTuning: { launchDelayChance: 2 } }] });
    delete (raw as Partial<Catalog>).academy;
    expect(() => parseCatalog(raw)).toThrow(/launchDelayChance/);
    const bad = structuredClone({ ...raw, scenarios: [{ ...catalog.scenarios[0]!, eventTuning: { budgetCutPct: { min: 9, max: 3 } } }] });
    expect(() => parseCatalog(bad)).toThrow(/min debe ser <= max/);
  });
});

describe('fórmulas de los eventos de salud', () => {
  it('factor térmico: 0 con margen sano, lineal por debajo del 15 %, tope 2', () => {
    expect(overheatingFactor(null)).toBe(0);
    expect(overheatingFactor(0.3)).toBe(0);
    expect(overheatingFactor(0.15)).toBe(0);
    expect(overheatingFactor(0.075)).toBeCloseTo(0.5, 10);
    expect(overheatingFactor(0)).toBeCloseTo(1, 10);
    expect(overheatingFactor(-0.15)).toBeCloseTo(2, 10);
    expect(overheatingFactor(-1)).toBe(2);
    expect(overheatingFactor(-Infinity)).toBe(2);
  });

  it('fiabilidad efectiva R^(1 + 2·radiación) y prob. diaria 1 − R_eff^(A / 1825)', () => {
    expect(effectiveReliability({ reliability: 0.9 } as never, 0.5)).toBeCloseTo(0.81, 10);
    expect(effectiveReliability({ reliability: 0.9 } as never, 0)).toBeCloseTo(0.9, 10);
    expect(dailyComponentFailureChance([0.9], 5 * 365)).toBeCloseTo(0.1, 10);
    expect(dailyComponentFailureChance([0.9, 0.9], 5 * 365)).toBeCloseTo(1 - 0.81, 10);
    expect(dailyComponentFailureChance([0.9], 0)).toBe(0);
    expect(dailyComponentFailureChance([], 30)).toBe(0);
    // Más aceleración → más probabilidad.
    expect(dailyComponentFailureChance([0.9], 50)).toBeGreaterThan(dailyComponentFailureChance([0.9], 15));
  });

  it('deriveSeed es determinista y separa flujos', () => {
    expect(deriveSeed(42, 7)).toBe(deriveSeed(42, 7));
    expect(deriveSeed(42, 7)).not.toBe(deriveSeed(42, 8));
    expect(deriveSeed(42, 7)).not.toBe(deriveSeed(43, 7));
    expect(createRng(deriveSeed(1, 2)).next()).toBe(createRng(deriveSeed(1, 2)).next());
  });
});

describe('eventos de operación', () => {
  const thermalTight = loadDesign('ok-microsat-leo-thermal'); // 93 W de 100 W disipables (7 %)
  const thermalOk = loadDesign('ok-cubesat-leo'); // 26,5 W de 40 W (34 %)
  // Escenario corto con fallos muy frecuentes para probar efectos sin simular meses.
  const stress = withScenario({ operationDays: 6, eventTuning: { componentFailureAcceleration: 1e6, overheatingChancePerDay: 1 } });

  it('misma semilla ⇒ mismos eventos (incluidos los de salud) sin importar el troceo de step()', () => {
    for (const seed of [3, 11]) {
      const whole = runMission(thermalTight, stress, { seed });
      expect(whole.events.some(isPartFailure)).toBe(true);
      expect(whole.events.some((e) => e.type === 'overheating')).toBe(true);
      const sim = createMissionSim(thermalTight, stress, { seed });
      const rng = createRng(seed);
      const seen: SimEvent[] = [];
      while (!sim.isFinished()) seen.push(...sim.step(rng.next() * 7000 + 0.5).newEvents);
      seen.push(...sim.snapshot().newEvents);
      expect(sim.finish()).toEqual(whole);
      expect(seen).toEqual(whole.events);
      expect(runMission(thermalTight, stress, { seed })).toEqual(whole);
    }
  });

  it('sobrecalentamiento solo con margen térmico justo', () => {
    const cat = withScenario({ operationDays: 10, eventTuning: { overheatingChancePerDay: 0.5 } });
    let tight = 0;
    let ok = 0;
    for (let seed = 1; seed <= 15; seed++) {
      tight += runMission(thermalTight, cat, { seed }).events.filter((e) => e.type === 'overheating').length;
      ok += runMission(thermalOk, cat, { seed }).events.filter((e) => e.type === 'overheating').length;
    }
    expect(tight).toBeGreaterThan(0);
    expect(ok).toBe(0);
  });

  it('el sobrecalentamiento apaga los instrumentos (menos datos) y sale en el informe', () => {
    const cat = withScenario({ operationDays: 6, eventTuning: { overheatingChancePerDay: 1, componentFailureAcceleration: 0 } });
    const noHeat = withScenario({ operationDays: 6, eventTuning: { overheatingChancePerDay: 0, componentFailureAcceleration: 0 } });
    const hot = runMission(thermalTight, cat, { seed: 5 });
    const cool = runMission(thermalTight, noHeat, { seed: 5 });
    const ev = hot.events.find((e) => e.type === 'overheating')!;
    expect(ev.message).toEqual({ key: 'event.overheating', params: { hours: 3, powerW: 93, dissipationW: 100 } });
    expect(hot.dataDownlinkedMbit + hot.dataLostMbit).toBeLessThan(cool.dataDownlinkedMbit + cool.dataLostMbit);
    const entry = hot.report.find((e) => e.message.key === 'report.event.overheating')!;
    expect(entry.causes[0]!.key).toBe('cause.thermalMargin');
    expect(entry.suggestion?.key).toBe('suggest.betterThermal');
  });

  it('falla de componente: degrada pero no destruye la nave (cada pieza falla como mucho una vez)', () => {
    // Como mucho una falla por día: 10 días bastan para las 8 piezas no estructurales.
    const r = runMission(thermalOk, withScenario({ operationDays: 10, eventTuning: { componentFailureAcceleration: 1e6 } }), { seed: 2 });
    expect(r.launchSuccess).toBe(true);
    const fails = r.events.filter(isPartFailure);
    const nonStructure = thermalOk.componentIds.filter((c) => !c.startsWith('structure')).length;
    expect(fails.length).toBe(nonStructure);
    expect(new Set(fails.map((e) => e.message.params?.component)).size).toBe(new Set(thermalOk.componentIds.filter((c) => !c.startsWith('structure'))).size);
    expect(r.status).toBe('complete');
    const keys = new Set(fails.map((e) => e.message.key));
    expect(keys).toEqual(new Set([
      'event.componentFailure.payload', 'event.componentFailure.comms', 'event.componentFailure.obc',
      'event.componentFailure.adcs', 'event.componentFailure.isolated',
    ]));
    const comms = fails.find((e) => e.message.key === 'event.componentFailure.comms')!;
    expect(comms.message.params?.downlinkMbps).toBe(0.5); // 2 Mbit/s × 25 % (antena de baja ganancia)
    const entry = r.report.find((e) => e.message.key === 'report.event.componentFailure')!;
    expect(entry.message.params?.count).toBe(fails.length);
    expect(entry.causes.at(-1)!.key).toBe('cause.reliabilityRadiation');
    expect(entry.suggestion?.key).toBe('suggest.redundancy');
    // Sin la cámara la misión no baja datos: los objetivos caen.
    expect(r.score.objectives).toBeLessThan(runMission(thermalOk, withScenario({ operationDays: 10, eventsEnabled: false }), { seed: 2 }).score.objectives);
  });

  it('con otra radio, la de respaldo toma el relevo', () => {
    const d: MissionDesign = { ...thermalOk, componentIds: [...thermalOk.componentIds, 'comms-uhf'] };
    // Falle primero la que falle, aún queda otra radio sana: la primera falla de radio usa el relevo.
    const r = runMission(d, stress, { seed: 4 });
    const first = r.events.filter((e) => isPartFailure(e) && String(e.message.key).startsWith('event.componentFailure.comms'))[0]!;
    expect(first.message.key).toBe('event.componentFailure.commsBackup');
  });

  it('más radiación ⇒ más fallas de componente en promedio', () => {
    const tuning = { operationDays: 5, eventTuning: { componentFailureAcceleration: 400, overheatingChancePerDay: 0 } };
    const lowRad = withScenario(tuning);
    const highRad = { ...lowRad, orbits: lowRad.orbits.map((o) => (o.id === 'LEO' ? { ...o, radiationFactor: 0.9 } : o)) };
    let low = 0;
    let high = 0;
    for (let seed = 1; seed <= 30; seed++) {
      low += runMission(thermalOk, lowRad, { seed }).events.filter(isPartFailure).length;
      high += runMission(thermalOk, highRad, { seed }).events.filter(isPartFailure).length;
    }
    expect(high).toBeGreaterThan(low);
  });

  it('dificultad avanzada ⇒ más eventos aleatorios en promedio (N semillas)', () => {
    const counts: Record<DifficultyLevel, number> = { basic: 0, intermediate: 0, advanced: 0 };
    for (const difficulty of ['basic', 'intermediate', 'advanced'] as const) {
      const cat = withScenario({ difficulty, operationDays: 15 });
      for (let seed = 100; seed < 130; seed++) counts[difficulty] += randomEvents(runMission(thermalTight, cat, { seed })).length;
    }
    expect(counts.intermediate).toBeGreaterThan(counts.basic);
    expect(counts.advanced).toBeGreaterThan(counts.intermediate);
  });

  it('sin eventsEnabled no hay eventos de salud', () => {
    const cat = withScenario({ eventsEnabled: false, eventTuning: { componentFailureAcceleration: 1e6, overheatingChancePerDay: 1 }, operationDays: 3 });
    for (let seed = 1; seed <= 5; seed++) expect(randomEvents(runMission(thermalTight, cat, { seed }))).toEqual([]);
  });
});

describe('eventos pre-operación (rollPreLaunchEvents)', () => {
  const cubesat = loadDesign('ok-cubesat-leo'); // calendario 18,25 de 24 meses
  const hires = loadDesign('ok-microsat-sso-hires'); // presupuesto justo
  const forced = (patch: ScenarioDef['eventTuning']) => withScenario({ eventTuning: patch });

  it('es determinista: misma semilla ⇒ mismo resultado', () => {
    for (let seed = 0; seed < 50; seed++) expect(rollPreLaunchEvents(cubesat, catalog, seed)).toEqual(rollPreLaunchEvents(cubesat, catalog, seed));
    expect(rollPreLaunchEvents(cubesat).seed).toBe(catalog.scenarios[0]!.defaultSeed);
  });

  it('sin eventsEnabled no hay retrasos ni recortes', () => {
    const cat = withScenario({ eventsEnabled: false, eventTuning: { launchDelayChance: 1, budgetCutChance: 1 } });
    for (let seed = 0; seed < 20; seed++) {
      const r = rollPreLaunchEvents(cubesat, cat, seed);
      expect(r).toMatchObject({ delayMonths: 0, budgetCutPct: 0, budgetCutMUSD: 0, events: [], overruns: [] });
    }
  });

  it('frecuencia ≈ probabilidad de la tabla y más frecuentes en dificultad avanzada', () => {
    const rate = (difficulty: DifficultyLevel, field: 'delayMonths' | 'budgetCutPct') => {
      const cat = withScenario({ difficulty });
      let n = 0;
      for (let seed = 0; seed < 2000; seed++) if (rollPreLaunchEvents(cubesat, cat, seed)[field] > 0) n++;
      return n / 2000;
    };
    expect(rate('basic', 'delayMonths')).toBeCloseTo(EVENT_TABLES.basic.launchDelayChance, 1);
    expect(rate('basic', 'budgetCutPct')).toBeCloseTo(EVENT_TABLES.basic.budgetCutChance, 1);
    expect(rate('advanced', 'delayMonths')).toBeGreaterThan(rate('basic', 'delayMonths'));
    expect(rate('advanced', 'budgetCutPct')).toBeGreaterThan(rate('basic', 'budgetCutPct'));
  });

  it('los meses y el porcentaje caen dentro de los rangos de la tabla', () => {
    const cat = forced({ launchDelayChance: 1, budgetCutChance: 1 });
    const t = EVENT_TABLES.basic;
    const seen = new Set<number>();
    for (let seed = 0; seed < 200; seed++) {
      const r = rollPreLaunchEvents(cubesat, cat, seed);
      expect(r.delayMonths).toBeGreaterThanOrEqual(t.launchDelayMonths.min);
      expect(r.delayMonths).toBeLessThanOrEqual(t.launchDelayMonths.max);
      expect(r.budgetCutPct).toBeGreaterThanOrEqual(t.budgetCutPct.min);
      expect(r.budgetCutPct).toBeLessThanOrEqual(t.budgetCutPct.max);
      expect(r.budgetCutMUSD).toBeCloseTo((30 * r.budgetCutPct) / 100, 2);
      expect(r.events.map((e) => e.type)).toEqual(['launch-delay', 'budget-cut']);
      seen.add(r.delayMonths);
    }
    expect(seen.size).toBe(t.launchDelayMonths.max - t.launchDelayMonths.min + 1);
  });

  it('computeBudgets con el resultado: el retraso suma meses y el recorte quita presupuesto', () => {
    const cat = forced({ launchDelayChance: 1, launchDelayMonths: { min: 3, max: 3 }, budgetCutChance: 1, budgetCutPct: { min: 10, max: 10 } });
    const pre = rollPreLaunchEvents(cubesat, cat, 1);
    const nominal = computeBudgets(cubesat, cat);
    const adjusted = computeBudgets(cubesat, cat, pre);
    expect(getResource(adjusted, 'time').used).toBeCloseTo(getResource(nominal, 'time').used + 3, 10);
    expect(getResource(adjusted, 'time').why.key).toBe('budget.time.delayed');
    expect(getResource(adjusted, 'budget').available).toBeCloseTo(27, 10);
    expect(getResource(adjusted, 'budget').why).toMatchObject({ key: 'budget.budget.cut', params: { cutMUSD: 3, originalMUSD: 30, budgetMUSD: 27 } });
    expect(pre.overruns).toEqual([]); // 21,25 de 24 meses y 7,2 de 27 M: sigue cabiendo
  });

  it('un retraso que excede maxDevMonths cuenta como sobrecoste: penaliza sin anular la viabilidad', () => {
    const cat = forced({ launchDelayChance: 1, launchDelayMonths: { min: 8, max: 8 }, budgetCutChance: 0 });
    const pre = rollPreLaunchEvents(cubesat, cat, 1);
    expect(pre.delayMonths).toBe(8);
    expect(pre.overruns).toEqual(['time']);
    expect(pre.events[0]!.message).toMatchObject({ key: 'event.launchDelay', params: { months: 8, maxMonths: 24 } });
    const seed = catalog.scenarios[0]!.defaultSeed;
    const base = runMission(cubesat, cat, { seed });
    const late = runMission(cubesat, cat, { seed, preLaunch: pre });
    expect(late.preLaunch).toEqual(pre);
    expect(late.events[0]!.type).toBe('launch-delay');
    // La operación no cambia: mismos eventos después de los pre-operación.
    expect(late.events.slice(pre.events.length)).toEqual(base.events);
    expect(getResource(late.budgets, 'time').status).toBe('over');
    expect(late.score.objectives).toBeGreaterThan(50); // no es "inviable"
    expect(late.score.objectives).toBeLessThan(base.score.objectives);
    expect(late.score.total).toBeLessThan(base.score.total);
    const entry = late.report[0]!;
    expect(entry.message.key).toBe('report.prelaunch.delay');
    expect(entry.severity).toBe('warning');
    expect(entry.causes[0]!.key).toBe('cause.noScheduleMargin');
    expect(entry.suggestion?.key).toBe('suggest.scheduleMargin');
    expect(late.report.some((e) => e.message.key === 'report.margin.over.time')).toBe(true);
  });

  it('un recorte puede convertir un presupuesto justo en excedido', () => {
    const cat = forced({ launchDelayChance: 0, budgetCutChance: 1, budgetCutPct: { min: 20, max: 20 } });
    expect(getResource(computeBudgets(hires, cat), 'budget').status).not.toBe('over');
    const pre = rollPreLaunchEvents(hires, cat, 9);
    expect(pre.overruns).toEqual(['budget']);
    const r = runMission(hires, cat, { seed: 20260101, preLaunch: pre });
    expect(r.events[0]!.type).toBe('budget-cut');
    const entry = r.report.find((e) => e.message.key === 'report.prelaunch.budgetCut')!;
    expect(entry.severity).toBe('warning');
    expect(entry.suggestion?.key).toBe('suggest.budgetMargin');
    if (r.launchSuccess) expect(r.score.objectives).toBeGreaterThan(0);
  });

  it('un presupuesto ya excedido por el diseño sigue siendo inviable (no es culpa del recorte)', () => {
    const gold = loadDesign('fail-budget-gold-plated');
    const cat = forced({ launchDelayChance: 0, budgetCutChance: 1 });
    const pre = rollPreLaunchEvents(gold, cat, 1);
    expect(pre.overruns).toEqual([]);
    expect(runMission(gold, cat, { preLaunch: pre }).score.objectives).toBe(0);
  });

  it('sin preLaunch, runMission no cambia (compatibilidad)', () => {
    const r = runMission(cubesat, catalog, { seed: 7 });
    expect(r.preLaunch).toBeUndefined();
    expect(r.events[0]!.type).toMatch(/^launch-/);
  });
});
