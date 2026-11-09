/** Observaciones de balance del content-designer (fase 2): respaldo con star tracker y vida útil más dura. */
import { describe, expect, it } from 'vitest';
import { catalog, computeBudgets, getScenario, lifetimeCriterion, runMission, scoreMission, wheelBackupPointingDeg } from '../index';
import { objectiveCriteria } from '../scoring';
import type { Catalog, MissionDesign } from '../types';
import { loadDesign, SCENARIO_ID } from './fixtures';

describe('falla de rueda de reacción: apuntado de respaldo según los sensores', () => {
  it('star tracker + magnetopares → 1°, star tracker solo → 2°, sin star tracker → 5°', () => {
    expect(wheelBackupPointingDeg([{ pointingAccuracyDeg: 0.05 }, { pointingAccuracyDeg: 5 }])).toBe(1);
    expect(wheelBackupPointingDeg([{ pointingAccuracyDeg: 0.05 }])).toBe(2);
    expect(wheelBackupPointingDeg([{ pointingAccuracyDeg: 0.5 }])).toBe(5);
    expect(wheelBackupPointingDeg([{ pointingAccuracyDeg: 0.5 }, { pointingAccuracyDeg: 5 }])).toBe(5);
    expect(wheelBackupPointingDeg([])).toBe(5);
  });

  // Solo eventos de rueda, uno casi seguro el primer día, sin eventos de salud.
  const wheelOnly: Catalog = {
    ...catalog,
    scenarios: catalog.scenarios.map((s) => (s.id !== SCENARIO_ID ? s : {
      ...s, operationDays: 3,
      eventTuning: {
        environmentChancePerDay: 1, environmentWeights: { 'solar-storm': 0, 'debris-avoidance': 0, 'reaction-wheel-failure': 1 },
        overheatingChancePerDay: 0, componentFailureAcceleration: 0,
      },
    })),
  };
  const backupOf = (d: MissionDesign) => {
    for (let seed = 1; seed < 40; seed++) {
      const ev = runMission(d, wheelOnly, { seed }).events.find((e) => e.type === 'reaction-wheel-failure');
      if (ev) return ev.message.params?.backupDeg;
    }
    throw new Error('sin falla de rueda');
  };

  it('en la simulación el evento usa el respaldo de los ADCS montados', () => {
    const hires = loadDesign('ok-microsat-sso-hires'); // star tracker
    expect(backupOf(hires)).toBe(2);
    expect(backupOf({ ...hires, componentIds: [...hires.componentIds, 'adcs-magnetorquers'] })).toBe(1);
    expect(backupOf(loadDesign('ok-microsat-leo-thermal'))).toBe(5); // ruedas sin star tracker
  });

  it('con star tracker + magnetopares, la cámara térmica (2°) sigue dando todos sus datos tras la falla', () => {
    const d: MissionDesign = {
      ...loadDesign('ok-microsat-leo-thermal'),
      componentIds: loadDesign('ok-microsat-leo-thermal').componentIds.map((c) => (c === 'adcs-reaction-wheels' ? 'adcs-star-tracker' : c)).concat('adcs-magnetorquers'),
    };
    const plain = loadDesign('ok-microsat-leo-thermal');
    const withTracker = runMission(d, wheelOnly, { seed: 1 });
    const withWheels = runMission(plain, wheelOnly, { seed: 1 });
    expect(withTracker.events.some((e) => e.type === 'reaction-wheel-failure')).toBe(true);
    expect(withWheels.events.some((e) => e.type === 'reaction-wheel-failure')).toBe(true);
    expect(withTracker.dataDownlinkedMbit + withTracker.dataLostMbit).toBeGreaterThan(withWheels.dataDownlinkedMbit + withWheels.dataLostMbit);
  });
});

describe('criterio de vida útil más duro', () => {
  it('lineal desde 0 al 75 % de la vida exigida', () => {
    expect(lifetimeCriterion(4, 4)).toBe(1);
    expect(lifetimeCriterion(6, 4)).toBe(1);
    expect(lifetimeCriterion(3.6, 4)).toBeCloseTo(0.6, 10);
    expect(lifetimeCriterion(3.5, 4)).toBeCloseTo(0.5, 10);
    expect(lifetimeCriterion(3, 4)).toBe(0);
    expect(lifetimeCriterion(1, 4)).toBe(0);
    expect(lifetimeCriterion(1, 0)).toBe(1);
  });

  it('3,6 de 4 años ya no da ~93 de objetivos', () => {
    const scenario = { ...getScenario('leo-earth-observation'), requirements: { ...getScenario('leo-earth-observation').requirements, minLifetimeYears: 4 } };
    const b = computeBudgets(loadDesign('ok-cubesat-leo'));
    const budgets = { ...b, totals: { ...b.totals, lifetimeYears: 3.6 } };
    const input = { scenario, budgets, launchSuccess: true, daysOperated: 30, dataDownlinkedMbit: 6000 * 30, revisitDays: 4 };
    expect(objectiveCriteria(input).lifetime).toBeCloseTo(0.6, 10);
    const s = scoreMission(input);
    expect(s.objectives).toBeLessThan(80);
    expect(s.objectives).toBeGreaterThan(50); // penaliza, pero no es inviable
  });
});

describe('falla de componente en ADCS: coherente con la falla de ruedas', () => {
  /** Catálogo donde solo `fragile` puede fallar (las demás piezas con fiabilidad 1), casi seguro el día 1. */
  const onlyFails = (fragile: string, envWheel = false): Catalog => ({
    ...catalog,
    components: catalog.components.map((c) => (c.id === fragile ? { ...c, reliability: 0.5 } : { ...c, reliability: 1 })),
    scenarios: catalog.scenarios.map((s) => (s.id !== SCENARIO_ID ? s : {
      ...s, operationDays: 4,
      eventTuning: {
        componentFailureAcceleration: 1e6, overheatingChancePerDay: 0,
        environmentChancePerDay: envWheel ? 1 : 0,
        environmentWeights: { 'solar-storm': 0, 'debris-avoidance': 0, 'reaction-wheel-failure': 1 },
      },
    })),
  });
  const hires = loadDesign('ok-microsat-sso-hires'); // star tracker, sin magnetopares
  const withAdcs = (d: MissionDesign, ...extra: string[]): MissionDesign => ({ ...d, componentIds: [...d.componentIds, ...extra] });
  const adcsFailure = (d: MissionDesign, cat: Catalog) => {
    for (let seed = 1; seed < 40; seed++) {
      const r = runMission(d, cat, { seed });
      const ev = r.events.find((e) => e.message.key === 'event.componentFailure.adcs');
      if (ev) return { r, ev };
    }
    throw new Error('sin falla de ADCS');
  };

  it('perder la unidad de ruedas con star tracker presente aplica el respaldo (2°), no 0,05°', () => {
    const { ev } = adcsFailure(withAdcs(hires, 'adcs-reaction-wheels'), onlyFails('adcs-reaction-wheels'));
    expect(ev.message.params).toMatchObject({ component: 'adcs-reaction-wheels', accuracyDeg: 2 });
  });

  it('con star tracker + magnetopares, perder las ruedas deja 1°', () => {
    const { ev } = adcsFailure(withAdcs(hires, 'adcs-reaction-wheels', 'adcs-magnetorquers'), onlyFails('adcs-reaction-wheels'));
    expect(ev.message.params?.accuracyDeg).toBe(1);
  });

  it('perder solo el star tracker con ruedas sanas: se apunta con las ruedas (0,5°)', () => {
    const { ev } = adcsFailure(withAdcs(hires, 'adcs-reaction-wheels'), onlyFails('adcs-star-tracker'));
    expect(ev.message.params).toMatchObject({ component: 'adcs-star-tracker', accuracyDeg: 0.5 });
  });

  it('perder el único ADCS con ruedas: respaldo de 5°', () => {
    const { ev } = adcsFailure(hires, onlyFails('adcs-star-tracker'));
    expect(ev.message.params?.accuracyDeg).toBe(5);
  });

  it('el apuntado nunca mejora al fallar una pieza', () => {
    const cubesat = loadDesign('ok-cubesat-leo'); // solo magnetopares (5°)
    expect(adcsFailure(cubesat, onlyFails('adcs-magnetorquers')).ev.message.params?.accuracyDeg).toBe(5);
    for (const [d, id] of [
      [withAdcs(hires, 'adcs-reaction-wheels'), 'adcs-reaction-wheels'],
      [withAdcs(hires, 'adcs-reaction-wheels'), 'adcs-star-tracker'],
      [loadDesign('ok-microsat-leo-thermal'), 'adcs-reaction-wheels'],
    ] as const) {
      const { ev } = adcsFailure(d, onlyFails(id));
      expect(Number(ev.message.params?.accuracyDeg)).toBeGreaterThanOrEqual(0.05);
    }
  });

  it('una rueda ya perdida por falla de componente no vuelve a fallar como evento del entorno', () => {
    const d = loadDesign('ok-microsat-leo-thermal'); // ruedas, sin star tracker
    const cat = onlyFails('adcs-reaction-wheels', true);
    for (let seed = 1; seed <= 15; seed++) {
      const r = runMission(d, cat, { seed });
      const part = r.events.find((e) => e.message.key === 'event.componentFailure.adcs');
      const wheel = r.events.filter((e) => e.type === 'reaction-wheel-failure');
      expect(wheel.length).toBeLessThanOrEqual(1);
      if (part) {
        expect(part.message.params?.accuracyDeg).toBe(5);
        expect(wheel.every((e) => e.tSeconds < part.tSeconds)).toBe(true);
      }
    }
  });
});
