// Criterio de aceptación de la fase 3: el resultado de una sala es IDÉNTICO (deep-equal) al de
// runMission con el mismo diseño, la misma semilla y preLaunch = rollPreLaunchEvents(design, cat, seed).
// Aquí, a nivel de modelo, para TODOS los diseños `valid` de TODOS los fixtures por escenario, con varias
// semillas (una con eventos pre-lanzamiento cuando el escenario los tiene) y troceando la operación de
// formas distintas (terminar al instante, avanzar a saltos con alertas respondidas o vencidas).
import { describe, expect, it } from 'vitest';
import { catalog, getScenario, rollPreLaunchEvents, runMission, type MissionDesign } from '@payload/shared';
import { RoomModel } from '../roomModel';
import { buildDesign, holder, launch, minPlayersFor, ok, roomInDesign, runOperation, TestClock, validFixtureDesigns } from './helpers';

const FIXTURES = validFixtureDesigns();

/** Primera semilla a partir de `from` con eventos pre-lanzamiento (null si el escenario no los tiene). */
function seedWithPreLaunchEvents(design: MissionDesign, from: number): number | null {
  if (!getScenario(design.scenarioId).eventsEnabled) return null;
  for (let s = from; s < from + 400; s++) if (rollPreLaunchEvents(design, catalog, s).events.length > 0) return s;
  return null;
}

type Mode = 'finish' | 'answer-alerts' | 'alerts-time-out';

function playRoom(design: MissionDesign, seed: number, players: number, mode: Mode) {
  const clock = new TestClock();
  const model = new RoomModel({ roomId: 'paridad', scenarioId: design.scenarioId, seed });
  // Los escenarios de equipo (team.minPlayers) no empiezan con menos jugadores conectados.
  roomInDesign(model, Math.max(players, minPlayersFor(design.scenarioId)), clock);
  buildDesign(model, design, clock);
  launch(model, clock);
  if (model.view.phase === 'operation') {
    if (mode === 'finish') {
      // Un poco de operación troceada y luego "terminar" (finish avanza hasta el final como runMission).
      ok(model, holder(model, 'director'), { type: 'set-time-scale', accel: 1000 }, clock.advance(0.1));
      for (let i = 0; i < 5 && model.view.phase === 'operation'; i++) {
        const open = model.view.alerts.find((a) => a.closedAtS === null);
        if (open) for (const role of open.requiredRoles) ok(model, holder(model, role), { type: 'ack-alert', alertId: open.id, role }, clock.advance(1));
        model.tick(0.37, clock.advance(0.37));
      }
      if (model.view.phase === 'operation') ok(model, holder(model, 'director'), { type: 'finish-operation' }, clock.advance(1));
    } else {
      runOperation(model, clock, { accel: 10000, answerAlerts: mode === 'answer-alerts' });
    }
  }
  expect(model.view.phase).toBe('report');
  return model;
}

describe('paridad sala ↔ runMission (modelo)', () => {
  it('hay fixtures válidos de varios escenarios', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(FIXTURES.map((f) => f.scenarioId)).size).toBeGreaterThanOrEqual(3);
  });

  let withPreLaunch = 0;
  for (const fx of FIXTURES) {
    it(`${fx.scenarioId} · ${fx.name}: mismo MissionResult con varias semillas`, () => {
      const base = getScenario(fx.scenarioId).defaultSeed;
      const special = seedWithPreLaunchEvents(fx.design, base + 2);
      const seeds = [base, base + 1, ...(special !== null ? [special] : [])];
      for (const [i, seed] of seeds.entries()) {
        const model = playRoom(fx.design, seed, (i % 4) + 1, 'finish');
        const preLaunch = rollPreLaunchEvents(fx.design, catalog, seed);
        if (preLaunch.events.length > 0) withPreLaunch++;
        expect(model.view.seed).toBe(seed);
        expect(model.view.preLaunch).toEqual(preLaunch);
        expect(model.view.result).toStrictEqual(runMission(model.view.design, catalog, { seed, preLaunch }));
        // La colaboración va aparte: no toca MissionResult.
        expect(model.view.collaboration).not.toBeNull();
        expect(model.view.teamScore).not.toBeNull();
      }
    });
  }

  it('al menos un caso con eventos pre-lanzamiento (retraso o recorte) confirmado por la Dirección', () => {
    expect(withPreLaunch).toBeGreaterThan(0);
  });

  it('operación completa a saltos de 10 000×, con alertas respondidas o vencidas: mismo resultado', () => {
    // Un diseño por escenario para acotar el tiempo del test.
    const perScenario = new Map<string, MissionDesign>();
    for (const fx of FIXTURES) if (!perScenario.has(fx.scenarioId)) perScenario.set(fx.scenarioId, fx.design);
    let alerts = 0;
    for (const [i, design] of [...perScenario.values()].entries()) {
      const seed = getScenario(design.scenarioId).defaultSeed + 3;
      const mode: Mode = i % 2 === 0 ? 'answer-alerts' : 'alerts-time-out';
      const model = playRoom(design, seed, 4, mode);
      alerts += model.view.alerts.length;
      const preLaunch = rollPreLaunchEvents(design, catalog, seed);
      expect(model.view.result).toStrictEqual(runMission(model.view.design, catalog, { seed, preLaunch }));
      for (const a of model.view.alerts) expect(a.closedAtS).not.toBeNull();
    }
    // Las misiones con eventos abren alertas: si ninguna lo hiciera, el test no probaría la pausa.
    expect(alerts).toBeGreaterThan(0);
  });
});
