import { describe, expect, it } from 'vitest';
import { buildReport, computeBudgets, getScenario, runMission, scoreMission } from '../index';
import { marginEfficiency } from '../scoring';
import { loadDesign } from './fixtures';

describe('scoreMission', () => {
  const scenario = getScenario('leo-earth-observation');
  const budgets = computeBudgets(loadDesign('ok-cubesat-leo'));
  const base = { scenario, budgets, launchSuccess: true, daysOperated: 30, dataDownlinkedMbit: 6000 * 30 };

  it('la eficiencia premia márgenes sanos: ni al límite ni sobrado', () => {
    expect(marginEfficiency(-0.1)).toBe(0);
    expect(marginEfficiency(0)).toBe(40);
    expect(marginEfficiency(0.3)).toBe(100);
    expect(marginEfficiency(0.05)).toBeLessThan(marginEfficiency(0.2));
    expect(marginEfficiency(0.95)).toBeLessThan(marginEfficiency(0.4));
  });

  it('total = suma ponderada normalizada de los cuatro términos', () => {
    const s = scoreMission(base);
    const w = scenario.weights;
    const sum = w.objectives + w.science + w.efficiency + w.collaboration;
    const expected = (w.objectives * s.objectives + w.science * s.science + w.efficiency * s.efficiency + w.collaboration * s.collaboration) / sum;
    expect(s.total).toBeCloseTo(expected, 0);
    expect(s.weights).toEqual(w);
    for (const v of [s.objectives, s.science, s.efficiency, s.collaboration, s.total]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('colaboración: 100 en solitario por defecto, o la indicada', () => {
    expect(scoreMission(base).collaboration).toBe(100);
    expect(scoreMission({ ...base, collaboration: 40 }).collaboration).toBe(40);
    expect(scoreMission({ ...base, collaboration: 40 }).total).toBeLessThan(scoreMission(base).total);
  });

  it('un recurso excedido penaliza fuerte: objetivos a 0 (no viable) y eficiencia rebajada', () => {
    const over = computeBudgets(loadDesign('fail-budget-gold-plated'));
    const s = scoreMission({ ...base, budgets: over });
    expect(s.objectives).toBe(0);
    const unpenalized = over.resources.reduce((a, r) => a + marginEfficiency(r.margin), 0) / over.resources.length;
    expect(s.efficiency).toBeCloseTo(unpenalized * 0.75, 0);
    expect(s.total).toBeLessThan(scoreMission(base).total - 30);
  });

  it('sin lanzamiento no hay objetivos ni ciencia', () => {
    const s = scoreMission({ ...base, launchSuccess: false, daysOperated: 0, dataDownlinkedMbit: 0 });
    expect(s.objectives).toBe(0);
    expect(s.science).toBe(0);
  });

  it('quedarse sin datos hunde los objetivos', () => {
    expect(scoreMission({ ...base, dataDownlinkedMbit: 100 }).objectives).toBeLessThan(20);
    expect(scoreMission({ ...base, daysOperated: 15, dataDownlinkedMbit: 6000 * 15 }).objectives).toBeLessThan(scoreMission(base).objectives);
  });
});

describe('buildReport', () => {
  it('cadena de causas con MessageRef y puntuación al final', () => {
    const r = runMission(loadDesign('ok-cubesat-leo'));
    expect(r.report[0]!.message.key).toBe('report.launch.success');
    expect(r.report.at(-1)!.message.key).toBe('report.score');
    expect(r.report.some((e) => e.message.key === 'report.mission.complete')).toBe(true);
    const { report: _r, ...rest } = r;
    expect(buildReport(rest)).toEqual(r.report);
  });

  it('las entradas de fallo traen causas o sugerencia', () => {
    for (const n of ['fail-battery-eclipse', 'fail-data-uhf', 'fail-mass-rideshare', 'warn-sso-low-resolution']) {
      for (const e of runMission(loadDesign(n)).report.filter((x) => x.severity === 'failure')) {
        expect(e.causes.length > 0 || e.suggestion !== undefined, `${n}: ${e.message.key}`).toBe(true);
      }
    }
  });
});
