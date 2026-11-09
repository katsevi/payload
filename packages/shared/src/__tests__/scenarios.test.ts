/**
 * Balance de TODOS los escenarios del catálogo: cada uno debe tener ≥ 2 soluciones válidas
 * distintas y diseños que fallen por ≥ 2 causas distintas. Los diseños de prueba viven en
 * src/__tests__/fixtures/scenarios/<scenarioId>.json (ver fixtures.ts); si un escenario no tiene
 * fixture, el test falla: al añadir un escenario hay que añadir su archivo.
 */
import { describe, expect, it } from 'vitest';
import { catalog, reviewGoNoGo, runMission } from '../index';
import type { MissionDesign } from '../types';
import { loadScenarioFixture } from './fixtures';

/** Primera semilla de intento (defaultSeed + k) en la que el lanzamiento sale bien. */
function firstLaunchedRun(d: MissionDesign, defaultSeed: number) {
  for (let k = 0; k < 20; k++) {
    const r = runMission(d, catalog, { seed: defaultSeed + k });
    if (r.launchSuccess) return r;
  }
  throw new Error('el lanzamiento falla con 20 semillas seguidas');
}

const signature = (d: MissionDesign) =>
  `${d.orbitId}|${d.launcherId}|${[...d.componentIds].sort().join('+')}`;

describe.each(catalog.scenarios.map((s) => [s.id, s] as const))('escenario %s', (id, scenario) => {
  const fixture = loadScenarioFixture(id);

  it('tiene fixtures de balance (src/__tests__/fixtures/scenarios/<id>.json)', () => {
    expect(fixture, `falta src/__tests__/fixtures/scenarios/${id}.json`).not.toBeNull();
    expect(fixture!.scenarioId).toBe(id);
    for (const f of [...fixture!.valid, ...fixture!.failing]) expect(f.design.scenarioId, f.name).toBe(id);
  });

  it('admite ≥ 2 soluciones válidas distintas que obtienen Go y cumplen la misión', () => {
    expect(fixture).not.toBeNull();
    const valid = fixture!.valid;
    expect(valid.length).toBeGreaterThanOrEqual(2);
    expect(new Set(valid.map((v) => signature(v.design))).size).toBe(valid.length);
    for (const v of valid) {
      const review = reviewGoNoGo(v.design);
      expect(review.issues.filter((i) => i.severity === 'blocker').map((i) => i.code), v.name).toEqual([]);
      const r = firstLaunchedRun(v.design, scenario.defaultSeed);
      expect(r.status, v.name).toBe('complete');
      expect(r.score.objectives, v.name).toBeGreaterThanOrEqual(90);
    }
  });

  it('tiene diseños que fallan por ≥ 2 causas distintas, cada una visible en el Go/No-Go', () => {
    expect(fixture).not.toBeNull();
    const failing = fixture!.failing;
    const causes = new Set(failing.map((f) => f.cause));
    expect(causes.size).toBeGreaterThanOrEqual(2);
    for (const f of failing) {
      expect(f.cause, `${f.name}: falta "cause"`).toBeDefined();
      const review = reviewGoNoGo(f.design);
      expect(review.issues.map((i) => i.code), f.name).toContain(f.cause);
      if (review.go) {
        // Se puede lanzar, pero la misión sale mal: falla o no cumple sus objetivos.
        const r = firstLaunchedRun(f.design, scenario.defaultSeed);
        expect(r.status === 'failed' || r.score.objectives < 70, `${f.name}: objetivos ${r.score.objectives}`).toBe(true);
      }
    }
  });
});
