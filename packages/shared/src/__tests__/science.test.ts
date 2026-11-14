/**
 * Fase 5 (ADR 0018): ciencia, datos y ventanas de contacto. Observar genera datos y ciencia; el almacenamiento
 * tiene tope; solo lo entregado en la Tierra puntúa; la misión termina al volver a casa tras visitar el destino
 * y el informe explica el resultado con eslabones derivados del estado.
 */
import { describe, expect, it } from 'vitest';
import {
  computeScore, contactWindow, createRun, downlinkMbPerS, FIXED_STEP_S, formatMessage, getScienceRules, lookupSimKey, missionReport, scienceProfile,
  type MessageRef,
} from '../index';
import { referenceDesign } from './missionFixtures';
import { advance, calmScienceCatalog, lunar, lunarMission, mars, pathTo, targetId, toTarget, travelTo } from './scienceHelpers';

describe('reglas puras', () => {
  const rules = getScienceRules();

  it('las ventanas de contacto son periódicas, deterministas y duran lo que dice el catálogo', () => {
    let open = 0;
    const samples = 1800;
    for (let i = 0; i < samples; i++) {
      const t = i * 0.5;
      const w = contactWindow(7, t, rules);
      expect(contactWindow(7, t, rules)).toEqual(w);
      expect(contactWindow(7, t + rules.contactPeriodS, rules).inWindow).toBe(w.inWindow);
      expect(w.changeInS).toBeGreaterThan(0);
      if (w.inWindow) open++;
    }
    expect(open / samples).toBeCloseTo(rules.contactWindowS / rules.contactPeriodS, 1);
    // Otra semilla, otro desfase (casi siempre).
    const a = Array.from({ length: 90 }, (_, t) => contactWindow(7, t, rules).inWindow);
    const b = Array.from({ length: 90 }, (_, t) => contactWindow(8, t, rules).inWindow);
    expect(a).not.toEqual(b);
  });

  it('la tasa de bajada cae con la distancia a la Tierra y es 0 fuera del alcance', () => {
    const profile = scienceProfile(referenceDesign('mission-europa-ocean'));
    const near = downlinkMbPerS(profile, 1, rules);
    const mid = downlinkMbPerS(profile, 2.8, rules);
    const far = downlinkMbPerS(profile, 5.2, rules);
    expect(near.inRange && mid.inRange && far.inRange).toBe(true);
    expect(near.mbPerS).toBeGreaterThan(mid.mbPerS);
    expect(mid.mbPerS).toBeGreaterThan(far.mbPerS);
    expect(downlinkMbPerS(profile, 50, rules)).toEqual({ inRange: false, mbPerS: 0 });
  });

  it('el perfil sale del diseño: almacenamiento de las computadoras y ciencia del destino = la del diseño', () => {
    const profile = scienceProfile(lunar);
    expect(profile.capacityMb).toBe(64 * rules.storageMbPerGb);
    expect(profile.requiredScience).toBe(60);
    expect(profile.sciencePerS * rules.observeMaxS).toBeCloseTo(65, 6); // neutrones 25 + radar 40 (ambos de hielo)
    expect(profile.antennas).toEqual([{ rateMbps: 0.5, rangeAu: 2 }]);
  });
});

describe('partida sin diseño', () => {
  it('no tiene ciencia y la puntuación no cambia', () => {
    const run = createRun({ seed: 3 });
    expect(run.state.science).toBeUndefined();
    expect(run.state.stats.sciencePoints).toBeUndefined();
    expect(missionReport(run.state)).toBeNull();
  });
});

describe('misión con diseño', () => {
  it('empieza sin datos y con la ciencia que pide la misión', () => {
    const run = createRun({ seed: 4, design: lunar });
    const sci = run.state.science!;
    expect(sci).toMatchObject({ storedMb: 0, deliveredScience: 0, requiredScience: 60, targetVisited: false, over: false });
    expect(run.state.stats.sciencePoints).toBe(0);
  });

  it('observar el destino llena el almacenamiento con su ciencia y acaba en el tope de segundos', () => {
    const cat = calmScienceCatalog();
    const rules = getScienceRules(cat);
    const run = createRun({ seed: 4, design: lunar, catalog: cat });
    travelTo(run, targetId(run));
    expect(run.state.science!.targetVisited).toBe(true);
    const events = advance(run, rules.observeMaxS + 5);
    const sci = run.state.science!;
    expect(sci.observedS.luna).toBe(rules.observeMaxS);
    expect(events.some((e) => e.type === 'observation-done')).toBe(true);
    // Todo lo generado está a bordo o ya en la Tierra.
    expect(sci.storedScience + sci.deliveredScience).toBeCloseTo(65, 4);
    expect(sci.observing).toBeNull();
  });

  it('volver a la Tierra tras el destino termina la misión con éxito y lo de a bordo se entrega', () => {
    const cat = calmScienceCatalog();
    const { run, events } = lunarMission(cat);
    const sci = run.state.science!;
    expect(run.state.phase).toBe('won');
    expect(sci.over).toBe(true);
    expect(sci.objectiveMet).toBe(true);
    expect(sci.storedMb).toBe(0);
    // El destino entero (65) y algo de los otros cuerpos de paso.
    expect(sci.deliveredScience).toBeGreaterThanOrEqual(65 - 1e-6);
    expect(events.find((e) => e.type === 'mission-complete')?.subtype).toBe('success');
    expect(events.some((e) => e.type === 'objective-met')).toBe(true);
    expect(run.apply({ type: 'next-sector' })).toEqual({ ok: false, reason: { key: 'reject.missionOver' } });
    // Puntúa la ciencia entregada y el bonus de éxito.
    const rules = getScienceRules(cat);
    expect(run.state.stats.sciencePoints).toBe(Math.round(sci.deliveredScience * rules.scorePerScience) + rules.successBonus);
    expect(run.state.score).toBe(computeScore(run.state.stats));
    const report = missionReport(run.state)!;
    expect(report.outcome).toBe('success');
    expect(report.links.find((l) => l.id === 'science')!.ok).toBe(true);
  });

  it('sin visitar el destino, llegar a la Tierra no termina la misión', () => {
    const run = createRun({ seed: 4, design: lunar, catalog: calmScienceCatalog() });
    const avoid = targetId(run);
    // Ruta al portal que no pase por el destino (si la hay en este sector).
    const goal = run.state.sector.goalId;
    const direct = pathTo(run.state, goal);
    if (direct.includes(avoid)) return; // este sector obliga a pasar por la Luna: nada que comprobar
    travelTo(run, goal);
    expect(run.state.phase).toBe('won');
    expect(run.state.science!.over).toBe(false);
    expect(run.apply({ type: 'next-sector' })).toEqual({ ok: true });
  });

  it('observar poco deja la misión incompleta (resultado parcial) y el informe lo dice', () => {
    const { run, events } = lunarMission(calmScienceCatalog(), { observeS: 10 });
    const sci = run.state.science!;
    expect(sci.over).toBe(true);
    expect(sci.objectiveMet).toBe(false);
    expect(events.find((e) => e.type === 'mission-complete')?.subtype).toBe('partial');
    const report = missionReport(run.state)!;
    expect(report.outcome).toBe('partial');
    expect(report.rootCause).toBe('science');
    expect(run.state.stats.sciencePoints).toBe(Math.round(sci.deliveredScience * getScienceRules().scorePerScience));
  });

  it('sin navegación los instrumentos no observan y el informe culpa a la energía', () => {
    const { run } = lunarMission(calmScienceCatalog(), { observeS: 30, navOff: true });
    const sci = run.state.science!;
    expect(sci.blockedS).toBeGreaterThan(25);
    const report = missionReport(run.state)!;
    expect(report.links.find((l) => l.id === 'power')!.ok).toBe(false);
    expect(['power', 'science']).toContain(report.rootCause);
  });

  it('con el almacenamiento lleno lo nuevo se pierde, se avisa una vez y cuenta en el informe', () => {
    const cat = calmScienceCatalog((raw) => {
      raw.science!.storageMbPerGb = 2; // 128 MB para el radar de 10 MB/s
      raw.science!.downlinkMbPerMbps = 0.01;
    });
    const { run, events } = lunarMission(cat);
    const sci = run.state.science!;
    expect(sci.lostMb).toBeGreaterThan(0);
    expect(sci.lostScience).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === 'storage-full')).toHaveLength(1);
    expect(missionReport(run.state)!.links.find((l) => l.id === 'storage')!.ok).toBe(false);
  });

  it('las ventanas de contacto bajan datos en ruta (con alcance y navegación) y nunca en tierra', () => {
    const cat = calmScienceCatalog();
    const run = createRun({ seed: 4, design: mars, catalog: cat });
    toTarget(run);
    const events = advance(run, 180);
    const sci = run.state.science!;
    expect(sci.deliveredMb).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'contact-start')).toBe(true);
    expect(sci.deliveredScience + sci.storedScience).toBeGreaterThan(0);
  });

  it('perder la nave pierde lo que quedaba a bordo; lo entregado sigue puntuando', () => {
    const cat = calmScienceCatalog((raw) => {
      raw.science!.downlinkMbPerMbps = 0.001; // casi no baja nada: casi todo sigue a bordo
    });
    const run = createRun({ seed: 4, design: lunar, catalog: cat });
    travelTo(run, targetId(run));
    advance(run, 50);
    const aboard = run.state.science!.storedScience;
    expect(aboard).toBeGreaterThan(10);
    run.state.ship.hull = 0.0001;
    run.state.incidents.push({ id: 999, kind: 'fire', systemId: 'nav', ageS: 0, progress: 0 });
    advance(run, 5);
    expect(run.state.phase).toBe('lost');
    const sci = run.state.science!;
    expect(sci.lostWithShipScience).toBeCloseTo(sci.storedScience, 6);
    const report = missionReport(run.state)!;
    expect(report.outcome).toBe('lost');
    expect(report.links.find((l) => l.id === 'link')!.message.key).toBe('report.link.aboard');
    expect(report.links.find((l) => l.id === 'survival')!.ok).toBe(false);
  });

  it('es determinista se trocee como se trocee el tiempo', () => {
    const play = (chunk: number) => {
      const run = createRun({ seed: 9, design: mars, catalog: calmScienceCatalog() });
      toTarget(run);
      advance(run, 120, chunk);
      return run.snapshot().science;
    };
    expect(play(FIXED_STEP_S)).toEqual(play(0.5));
  });
});

describe('informe', () => {
  it('como mucho 6 eslabones, uno por causa, y todos se resuelven en ambos idiomas', () => {
    const cases = [
      lunarMission(calmScienceCatalog()).run.state,
      lunarMission(calmScienceCatalog(), { observeS: 10 }).run.state,
      lunarMission(calmScienceCatalog(), { observeS: 30, navOff: true }).run.state,
      createRun({ seed: 2, design: mars }).state,
    ];
    for (const state of cases) {
      const report = missionReport(state)!;
      expect(report.links.length).toBeLessThanOrEqual(6);
      expect(new Set(report.links.map((l) => l.id)).size).toBe(report.links.length);
      for (const ref of [report.headline, ...report.links.map((l) => l.message)]) expectResolves(ref);
    }
  });
});

function expectResolves(ref: MessageRef): void {
  for (const locale of ['es', 'en'] as const) {
    expect(lookupSimKey(ref.key, locale), ref.key).toBeDefined();
    const text = formatMessage(ref, locale);
    expect(text, `${ref.key}: ${text}`).not.toMatch(/\{\{|\$t\(|\bcatalog\./);
  }
}

