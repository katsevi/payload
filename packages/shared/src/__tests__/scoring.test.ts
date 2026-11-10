import { describe, expect, it } from 'vitest';
import { buildReport, computeBudgets, energyCriterion, getScenario, reviewGoNoGo, runMission, scoreMission, scoreWeightSum, withCollaboration } from '../index';
import { marginEfficiency, objectiveCriteria } from '../scoring';
import { allDesignNames, loadDesign } from './fixtures';

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

describe('fase 2: agotamientos de batería y sobrecostes por eventos (ADR 0008)', () => {
  const scenario = getScenario('leo-earth-observation');
  const budgets = computeBudgets(loadDesign('ok-cubesat-leo'));
  const base = { scenario, budgets, launchSuccess: true, daysOperated: 30, dataDownlinkedMbit: 6000 * 30 };

  it('energyCriterion = clamp(1 − 0,15·agotamientos) · clamp((cap − 60) / 40)', () => {
    expect(energyCriterion(0, 100)).toBeNull();
    expect(energyCriterion(undefined, undefined)).toBeNull();
    expect(energyCriterion(0, 90)).toBeCloseTo(0.75, 10);
    expect(energyCriterion(1, 100)).toBeCloseTo(0.85, 10);
    expect(energyCriterion(1, 65)).toBeCloseTo(0.85 * 0.125, 10);
    expect(energyCriterion(2, 60)).toBe(0);
    expect(energyCriterion(10, 100)).toBe(0);
  });

  it('una batería que acaba casi inservible rebaja los objetivos', () => {
    const clean = scoreMission(base);
    const worn = scoreMission({ ...base, batteryDepletions: 1, finalBatteryCapacityPct: 65 });
    expect(worn.objectives).toBeLessThan(clean.objectives - 50);
    // Desgaste leve: penaliza poco.
    const mild = scoreMission({ ...base, finalBatteryCapacityPct: 97 });
    expect(mild.objectives).toBeGreaterThan(80);
    expect(mild.objectives).toBeLessThan(clean.objectives);
  });

  it('si la misión no se completó, el criterio de energía no se aplica (ya lo mide completion)', () => {
    const partial = { ...base, daysOperated: 15, dataDownlinkedMbit: 6000 * 15 };
    expect(scoreMission({ ...partial, batteryDepletions: 3, finalBatteryCapacityPct: 55 })).toEqual(scoreMission(partial));
    expect(scoreMission(partial).objectives).toBeGreaterThan(0);
  });

  it('warn-power-storm ya no puntúa ~91 terminando con la batería al 0 %: queda por debajo de las soluciones válidas', () => {
    const r = runMission(loadDesign('warn-power-storm'));
    expect(r.status).toBe('complete');
    expect(r.batteryDepletions).toBeGreaterThan(0);
    expect(r.minBatteryPct).toBeLessThan(1);
    expect(r.score.total).toBeLessThan(75);
    for (const n of ['ok-cubesat-leo', 'ok-microsat-sso-hires', 'ok-microsat-leo-thermal']) {
      expect(r.score.total, n).toBeLessThan(runMission(loadDesign(n)).score.total);
    }
    // Y sigue siendo Go con aviso (no un blocker).
    const review = reviewGoNoGo(loadDesign('warn-power-storm'));
    expect(review.go).toBe(true);
    expect(review.issues.find((i) => i.code === 'power-storm')?.severity).toBe('warning');
  });

  it('una misión sin agotamientos no cambia su puntuación respecto a la fase 1', () => {
    const r = runMission(loadDesign('ok-cubesat-leo'));
    expect(r.batteryDepletions).toBe(0);
    expect(r.finalBatteryCapacityPct).toBe(100);
    expect(r.score).toEqual(scoreMission({ ...base, budgets: r.budgets, dataDownlinkedMbit: r.dataDownlinkedMbit, revisitDays: 4 }));
  });

  it('sobrecoste por evento pre-operación: criterio overrun-<recurso> = disponible/usado en vez de viabilidad 0', () => {
    const over = { ...budgets, resources: budgets.resources.map((r) => (r.id === 'time' ? { ...r, used: 30, available: 24, margin: -0.25, status: 'over' as const } : r)) };
    const byDesign = scoreMission({ ...base, budgets: over });
    const byEvent = scoreMission({ ...base, budgets: over, eventOverruns: ['time'] });
    expect(byDesign.objectives).toBe(0);
    expect(byEvent.objectives).toBeGreaterThan(70);
    expect(byEvent.objectives).toBeLessThan(scoreMission(base).objectives);
    expect(objectiveCriteria({ ...base, budgets: over, eventOverruns: ['time'] })['overrun-time']).toBeCloseTo(0.8, 10);
  });
});

describe('withCollaboration (fase 3: puntuación de equipo aparte de MissionResult)', () => {
  const results = allDesignNames().flatMap((name) => [1, 2, 3].map((seed) => runMission(loadDesign(name), undefined, { seed })));

  it('con colaboración 100 (la del solitario) devuelve exactamente la misma puntuación', () => {
    for (const r of results) {
      expect(r.score.collaboration).toBe(100);
      expect(withCollaboration(r.score, 100)).toEqual(r.score);
    }
  });

  it('el total baja w_colab / Σw por cada punto de colaboración (mismos pesos normalizados que scoreMission)', () => {
    for (const r of results) {
      const w = r.score.weights;
      const team = withCollaboration(r.score, 40);
      expect(team.collaboration).toBe(40);
      expect(team.total).toBeCloseTo(r.score.total - (w.collaboration * 60) / scoreWeightSum(w), 0);
      expect(Math.abs(team.total - (r.score.total - (w.collaboration * 60) / scoreWeightSum(w)))).toBeLessThanOrEqual(0.051);
      expect({ ...team, collaboration: 100, total: r.score.total }).toEqual(r.score);
    }
  });

  it('coincide con scoreMission recalculado con esa colaboración (± redondeo de 0,1)', () => {
    const scenario = getScenario('leo-earth-observation');
    const budgets = computeBudgets(loadDesign('ok-cubesat-leo'));
    const input = { scenario, budgets, launchSuccess: true, daysOperated: 30, dataDownlinkedMbit: 6000 * 30 };
    for (const c of [0, 25, 54.2, 80, 100]) {
      const direct = scoreMission({ ...input, collaboration: c });
      const viaTeam = withCollaboration(scoreMission(input), c);
      expect(Math.abs(viaTeam.total - direct.total)).toBeLessThanOrEqual(0.1 + 1e-9);
      expect(viaTeam.collaboration).toBe(direct.collaboration);
    }
  });

  it('acota la colaboración a 0-100 y no altera el resultado original', () => {
    const s = results[0]!.score;
    const copy = structuredClone(s);
    expect(withCollaboration(s, 150).collaboration).toBe(100);
    expect(withCollaboration(s, -5).collaboration).toBe(0);
    expect(withCollaboration(s, Number.NaN).collaboration).toBe(0);
    expect(s).toEqual(copy);
  });
});
