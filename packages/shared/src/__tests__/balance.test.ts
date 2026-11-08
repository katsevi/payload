/**
 * Balance del escenario de la fase 1 ("Ojos sobre la cosecha"): debe haber varias soluciones
 * válidas distintas y diseños que fallen por razones distintas.
 */
import { describe, expect, it } from 'vitest';
import { catalog, computeBudgets, reviewGoNoGo, runMission } from '../index';
import { getResource } from '../budgets';
import { loadDesign } from './fixtures';

const VALID = ['ok-cubesat-leo', 'ok-microsat-sso-hires', 'ok-microsat-leo-thermal'];

describe('balance del escenario leo-earth-observation', () => {
  it.each(VALID)('%s obtiene Go y completa la misión cumpliendo los objetivos', (name) => {
    const d = loadDesign(name);
    const review = reviewGoNoGo(d);
    expect(review.issues.filter((i) => i.severity === 'blocker')).toEqual([]);
    expect(review.go).toBe(true);
    const r = runMission(d);
    expect(r.launchSuccess).toBe(true);
    expect(r.status).toBe('complete');
    expect(r.dataLostMbit).toBe(0);
    expect(r.score.objectives).toBeGreaterThanOrEqual(95);
    expect(r.score.total).toBeGreaterThan(70);
  });

  it('las soluciones válidas son realmente distintas (estructura, órbita, lanzador o instrumento)', () => {
    const sig = VALID.map((n) => {
      const d = loadDesign(n);
      return `${d.orbitId}|${d.launcherId}|${d.componentIds.find((c) => c.startsWith('structure'))}|${d.componentIds.filter((c) => c.startsWith('payload')).join('+')}`;
    });
    expect(new Set(sig).size).toBe(VALID.length);
    expect(new Set(VALID.map((n) => loadDesign(n).orbitId)).size).toBe(2);
    expect(new Set(VALID.map((n) => loadDesign(n).launcherId)).size).toBe(2);
    // Ninguna domina claramente: cada una tiene un recurso limitante distinto.
    expect(new Set(VALID.map((n) => computeBudgets(loadDesign(n)).limiting)).size).toBe(VALID.length);
  });

  it('las soluciones válidas sobreviven a los eventos con cualquier semilla (si el lanzamiento sale bien)', () => {
    for (const name of VALID) {
      for (let seed = 1; seed <= 25; seed++) {
        const r = runMission(loadDesign(name), catalog, { seed });
        if (r.launchSuccess) expect(r.status, `${name} seed ${seed}`).toBe('complete');
      }
    }
  });

  it('falla por batería en el eclipse con la cámara térmica (60 W)', () => {
    const d = loadDesign('fail-battery-eclipse');
    const review = reviewGoNoGo(d);
    expect(review.go).toBe(false);
    expect(review.issues.filter((i) => i.severity === 'blocker').map((i) => i.code)).toEqual(['battery']);
    const r = runMission(d);
    expect(r.status).toBe('failed');
    expect(r.events.some((e) => e.type === 'battery-low')).toBe(true);
    // Muere por agotamientos o por desgaste bajo la DoD, según lo que llegue antes.
    const entry = r.report.find((e) => ['report.battery.depleted', 'report.battery.wornOut'].includes(e.message.key))!;
    expect(entry.severity).toBe('failure');
    expect(entry.message.params).toMatchObject({ component: 'payload-thermal-camera', powerW: 60, eclipseMin: 36 });
    expect(entry.causes.map((c) => c.key)).toEqual(expect.arrayContaining(['cause.eclipse', 'cause.consumer', 'cause.batteryUsable']));
    expect(entry.suggestion?.key).toBe('suggest.biggerBattery');
  });

  it('falla por masa contra el lanzador (lanzamiento compartido)', () => {
    const d = loadDesign('fail-mass-rideshare');
    const review = reviewGoNoGo(d);
    expect(review.go).toBe(false);
    expect(review.issues.filter((i) => i.severity === 'blocker').map((i) => i.code)).toEqual(['mass-launcher']);
    expect(getResource(computeBudgets(d), 'mass').status).toBe('over');
    const r = runMission(d);
    expect(r.launchSuccess).toBe(false);
    expect(r.report[0]!.message.key).toBe('report.launch.scrubbedMass');
  });

  it('energía justa: Go con aviso power-storm, pero falla en operación con alguna semilla de intento', () => {
    // El cliente usa una semilla por intento: defaultSeed + nº de intento.
    const d = loadDesign('warn-power-storm');
    const review = reviewGoNoGo(d);
    expect(review.go).toBe(true);
    expect(review.issues.map((i) => i.code)).toContain('power-storm');
    const base = catalog.scenarios[0]!.defaultSeed;
    const results = Array.from({ length: 10 }, (_, k) => runMission(d, catalog, { seed: base + k }));
    const opFailures = results.map((r, k) => (r.launchSuccess && r.status === 'failed' ? k : -1)).filter((k) => k >= 0);
    // Documentado en prototype/designs: falla con defaultSeed+1, +4 y +7 (tormenta → desgaste).
    expect(opFailures).toEqual([1, 4, 7]);
    for (const k of opFailures) {
      const r = results[k]!;
      expect(r.events.some((e) => e.type === 'solar-storm')).toBe(true);
      expect(r.report.some((e) => e.severity === 'failure' && e.message.key.startsWith('report.battery.'))).toBe(true);
      expect(r.report.some((e) => e.causes.some((c) => c.key === 'cause.solarStorm'))).toBe(true);
    }
    // Y otras semillas sí completan la misión: el riesgo es real, no una condena.
    expect(results.some((r) => r.status === 'complete')).toBe(true);
  });

  it('falla por datos que no se alcanzan a bajar (radio UHF)', () => {
    const d = loadDesign('fail-data-uhf');
    const review = reviewGoNoGo(d);
    expect(review.go).toBe(true); // se puede lanzar, pero la misión no cumple
    expect(review.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['req-downlink', 'comms-capacity']));
    const r = runMission(d);
    expect(r.status).toBe('complete');
    expect(r.dataLostMbit).toBeGreaterThan(0);
    expect(r.score.objectives).toBeLessThan(50);
    const entry = r.report.find((e) => e.message.key === 'report.data.below')!;
    expect(entry.severity).toBe('failure');
    expect(entry.causes.map((c) => c.key)).toEqual(expect.arrayContaining(['cause.downlinkCapacity', 'cause.storageFull']));
  });

  it('falla por presupuesto excedido (diseño "todo incluido")', () => {
    const d = loadDesign('fail-budget-gold-plated');
    const review = reviewGoNoGo(d);
    expect(review.go).toBe(false);
    expect(review.issues.filter((i) => i.severity === 'blocker').map((i) => i.code)).toEqual(['budget']);
    // Aunque "funcione" en la simulación, puntúa por debajo de todas las soluciones válidas.
    const score = runMission(d).score.total;
    for (const name of VALID) expect(score).toBeLessThan(runMission(loadDesign(name)).score.total);
  });

  it('subir a SSO con la cámara básica empeora la resolución por debajo del requisito', () => {
    const d = loadDesign('warn-sso-low-resolution');
    expect(reviewGoNoGo(d).issues.map((i) => i.code)).toContain('req-resolution');
    const r = runMission(d);
    expect(r.report.some((e) => e.message.key === 'report.resolution.below')).toBe(true);
    expect(r.score.total).toBeLessThan(runMission(loadDesign('ok-cubesat-leo')).score.total);
  });
});
