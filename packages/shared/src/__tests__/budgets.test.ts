import { describe, expect, it } from 'vitest';
import { computeBudgets, computeOrbitParams, getOrbit, TIGHT_MARGIN } from '../index';
import { getResource } from '../budgets';
import type { MissionDesign } from '../types';
import { emptyDesign, loadDesign } from './fixtures';

describe('computeBudgets', () => {
  const design = loadDesign('ok-cubesat-leo');
  const b = computeBudgets(design);
  const leo = computeOrbitParams(getOrbit('LEO'));

  it('devuelve los 8 recursos en orden con su "¿por qué?"', () => {
    expect(b.resources.map((r) => r.id)).toEqual(['mass', 'power', 'battery', 'budget', 'data', 'comms', 'time', 'lifetime']);
    for (const r of b.resources) {
      expect(r.why.key).toMatch(/^budget\./);
      if (r.available > 0) expect(r.margin).toBeCloseTo((r.available - r.used) / r.available, 12);
    }
  });

  it('masa: suma de piezas contra el límite más restrictivo (estructura 12U = 24 kg < lanzador 30 kg)', () => {
    const m = getResource(b, 'mass');
    expect(m.used).toBeCloseTo(10.1, 6);
    expect(m.available).toBe(24);
    expect(m.why.key).toBe('budget.mass.structure');
  });

  it('energía: generación × fracción de sol vs consumo', () => {
    const p = getResource(b, 'power');
    expect(p.used).toBeCloseTo(26.5, 6);
    expect(p.available).toBeCloseTo(65 * (1 - leo.eclipseFraction), 6);
  });

  it('batería: energía del eclipse vs capacidad útil (DoD)', () => {
    const bat = getResource(b, 'battery');
    expect(bat.used).toBeCloseTo((26.5 * leo.eclipseMin) / 60, 6);
    expect(bat.available).toBeCloseTo(120 * 0.4, 6);
    expect(bat.why.params?.eclipseMin).toBe(36);
  });

  it('presupuesto: piezas + lanzador + operación', () => {
    const c = getResource(b, 'budget');
    expect(c.used).toBeCloseTo(4.7 + 1.5 + 0.5 * 3, 6);
    expect(c.available).toBe(30);
  });

  it('datos y comunicaciones: generados vs almacenamiento y vs capacidad de bajada', () => {
    expect(getResource(b, 'data').used).toBe(6000);
    expect(getResource(b, 'data').available).toBe(64000);
    const comms = getResource(b, 'comms');
    expect(comms.available).toBeCloseTo(leo.contactMinPerDayPerStation * 2 * 60 * 2, 6);
    expect(b.totals.downlinkCapacityMbitPerDay).toBeCloseTo(comms.available, 6);
  });

  it('tiempo: pieza más lenta + integración + espera del lanzador', () => {
    const t = getResource(b, 'time');
    expect(t.used).toBeCloseTo(6 + 0.25 * 9 + 10, 6);
    expect(t.why.params?.component).toBe('payload-multispectral-basic');
  });

  it('vida útil: min(arrastre, fiabilidad) — en LEO manda el arrastre (4 años)', () => {
    const l = getResource(b, 'lifetime');
    expect(l.available).toBe(4);
    expect(l.used).toBe(3);
    expect(l.why.key).toBe('budget.lifetime.drag');
  });

  it('la resolución en suelo escala con la altitud', () => {
    expect(b.totals.groundResolutionM).toBeCloseTo((30 * 450) / 500, 6);
    const sso = computeBudgets({ ...design, orbitId: 'SSO' });
    expect(sso.totals.groundResolutionM).toBeCloseTo((30 * 700) / 500, 6);
  });

  it('umbrales de estado: over < 0 ≤ tight < 15 % ≤ ok', () => {
    expect(TIGHT_MARGIN).toBe(0.15);
    for (const r of [...b.resources, ...computeBudgets(loadDesign('fail-budget-gold-plated')).resources]) {
      if (r.available <= 0) continue;
      const expected = r.margin < 0 ? 'over' : r.margin < TIGHT_MARGIN ? 'tight' : 'ok';
      expect(r.status).toBe(expected);
    }
    expect(getResource(computeBudgets(loadDesign('ok-microsat-sso-hires')), 'budget').status).toBe('tight');
  });

  it('limiting = recurso con menor margen', () => {
    const min = [...b.resources].sort((x, y) => x.margin - y.margin)[0]!;
    expect(b.limiting).toBe(min.id);
    expect(computeBudgets(loadDesign('fail-mass-rideshare')).limiting).toBe('mass');
  });

  describe('diseños parciales no lanzan', () => {
    const partials: [string, MissionDesign][] = [
      ['vacío', emptyDesign()],
      ['solo órbita', { ...emptyDesign(), orbitId: 'LEO' }],
      ['solo lanzador', { ...emptyDesign(), launcherId: 'launcher-colibri' }],
      ['piezas sin órbita', { ...emptyDesign(), componentIds: ['structure-microsat', 'payload-thermal-camera', 'power-deployable'] }],
      ['id desconocido', { ...emptyDesign(), componentIds: ['nope'], orbitId: 'TLI', launcherId: 'launcher-albatros' }],
    ];
    it.each(partials)('%s', (_n, d) => {
      const r = computeBudgets(d);
      expect(r.resources).toHaveLength(8);
      for (const x of r.resources) {
        expect(Number.isFinite(x.used)).toBe(true);
        expect(Number.isFinite(x.margin)).toBe(true);
      }
    });
    it('diseño vacío: limiting null y sin órbita', () => {
      const r = computeBudgets(emptyDesign());
      expect(r.limiting).toBeNull();
      expect(r.orbit).toBeNull();
      expect(r.totals.groundResolutionM).toBeNull();
    });
    it('sin órbita: energía y batería lo explican', () => {
      const r = computeBudgets(partials[3]![1]);
      expect(getResource(r, 'power').why.key).toBe('budget.power.noOrbit');
      expect(getResource(r, 'battery').why.key).toBe('budget.battery.noOrbit');
      expect(getResource(r, 'comms').why.key).toBe('budget.comms.noOrbit');
    });
    it('lanzador que no llega a la órbita: masa excedida', () => {
      const r = computeBudgets({ ...design, orbitId: 'GEO', launcherId: 'launcher-colibri' });
      expect(getResource(r, 'mass').status).toBe('over');
      expect(getResource(r, 'mass').why.key).toBe('budget.mass.unreachable');
    });
  });

  it('es barata (guarda 20×; la medida fina es `pnpm bench`)', () => {
    // Objetivo real: ~0.05 ms por llamada. Margen 20× para no depender de la carga de la máquina
    // (turbo corre typecheck/test/build en paralelo): 1000 llamadas < 1 s.
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) computeBudgets(design);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
