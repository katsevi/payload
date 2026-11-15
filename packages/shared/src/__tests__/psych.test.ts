/** Fase 8: la cordura dentro de la partida (`run.ts`). Todo es opcional: sin `psych` el juego es el de siempre. */
import { describe, expect, it } from 'vitest';
import { catalog, createRun, getNode, parseCatalog, reviewDesign, shipFromDesign, type Catalog, type RunAction, type RunState } from '../index';
import { referenceDesign } from './missionFixtures';
import { playRun } from './bot';
import { calmPsychCatalog, psychCatalog, psychOffCatalog, stepSeconds } from './psychHelpers';

const without = (): Catalog => {
  const raw = JSON.parse(JSON.stringify(catalog)) as Catalog;
  delete raw.psych;
  return parseCatalog(raw);
};

function script(run: ReturnType<typeof createRun>, chunk: number): RunState {
  const first = getNode(run.state.sector, run.state.locationId)!.links[0]!;
  run.apply({ type: 'jump', toId: first });
  for (let t = 0; t < 60; t += chunk) run.step(chunk);
  run.apply({ type: 'toggle-system', systemId: 'shields', enabled: false });
  for (let t = 0; t < 60; t += chunk) run.step(chunk);
  return run.snapshot();
}

describe('sin cordura (por defecto o sin `psych`)', () => {
  it('con `enabled: false` el estado no tiene rastro de ella', () => {
    const run = createRun({ seed: 7, catalog: psychOffCatalog() });
    expect(run.state.psych).toBeUndefined();
    expect(run.state.crew[0]!.sanityPct).toBeUndefined();
    expect(run.stationQuote()!.provisions).toBeUndefined();
  });

  it('snapshot idéntico con `psych` apagado y con el catálogo sin `psych`, en la misma partida', () => {
    const a = script(createRun({ seed: 7, catalog: psychOffCatalog() }), 0.1);
    const b = script(createRun({ seed: 7, catalog: without() }), 0.1);
    expect(a).toEqual(b);
    const bot = (cat: Catalog) => playRun(11, { skill: 'crew', sectors: 2, walkS: 3.5, catalog: cat });
    const x = bot(psychOffCatalog());
    const y = bot(without());
    expect(x.state).toEqual(y.state);
    expect(x.events).toEqual(y.events);
  });

  it('las acciones nuevas se rechazan con `reject.invalid` y no cambian nada', () => {
    const run = createRun({ seed: 7, catalog: psychOffCatalog() });
    const before = run.snapshot();
    for (const a of [{ type: 'rest', seconds: 0.1 }, { type: 'call-earth', seconds: 0.1 }, { type: 'buy-provisions' }] as RunAction[]) {
      const r = run.apply(a);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.key).toBe('reject.invalid');
    }
    expect(run.snapshot()).toEqual(before);
  });

  it('las mejoras `crew` no se ofrecen sin cordura (la oferta de siempre no cambia)', () => {
    const run = createRun({ seed: 7, catalog: psychOffCatalog() });
    expect(run.stationQuote()!.upgrades.map((u) => u.upgradeId).some((id) => id.startsWith('crew-') || id === 'leisure-kit')).toBe(false);
  });
});

describe('con cordura activa: estado inicial y oferta', () => {
  it('cada tripulante y la partida arrancan con sus campos; en grupo hay cohesión', () => {
    const solo = createRun({ seed: 3, catalog: psychCatalog() });
    expect(solo.state.crew[0]).toMatchObject({ sanityPct: 100, sanityBand: 'stable', awakeS: 0 });
    expect(solo.state.psych).toMatchObject({ provisions: 0, steps: 0 });
    expect(solo.state.psych!.cohesionPct).toBeUndefined();
    const team = createRun({ seed: 3, catalog: psychCatalog(), crewSize: 3 });
    expect(team.state.psych!.cohesionPct).toBe(80);
  });

  it('la estación ofrece provisiones y mejoras `crew` además de la oferta de siempre', () => {
    const cat = psychCatalog();
    const plain = createRun({ seed: 3, catalog: psychOffCatalog() }).stationQuote()!;
    const run = createRun({ seed: 3, catalog: cat });
    const q = run.stationQuote()!;
    expect(q.provisions).toEqual({ unitPrice: 6, missing: 6, affordable: 6 });
    const crewIds = q.upgrades.filter((u) => ['crew-quarters', 'leisure-kit', 'circadian-lighting', 'comm-relay'].includes(u.upgradeId));
    expect(crewIds).toHaveLength(2);
    expect(q.upgrades.filter((u) => !crewIds.includes(u)).map((u) => u.upgradeId)).toEqual(plain.upgrades.map((u) => u.upgradeId));
  });
});

describe('drenaje extremo: nunca mata ni pierde la partida', () => {
  it('30 minutos con el drenaje ×100: todos en quiebre, nadie muere, sin pérdida, sin tocar sistemas críticos', () => {
    const cat = calmPsychCatalog((raw) => {
      const b = raw.psych!.base;
      for (const k of ['transit', 'docked', 'surfaceAboard', 'eva'] as const) b[k] *= 100;
      raw.psych!.debuffs.lapsePerS = [0, 0, 0.5, 1];
    });
    const run = createRun({ seed: 5, catalog: cat, crewSize: 2 });
    const seen = new Set<string>();
    let sampled = false;
    for (let t = 0; t < 1800; t += 1) {
      if (run.state.phase === 'won') run.apply({ type: 'next-sector' });
      if (run.state.phase === 'docked' && run.state.ship.fuel > 30) {
        const links = getNode(run.state.sector, run.state.locationId)!.links;
        for (const to of links) if (run.apply({ type: 'jump', toId: to }).ok) break;
      }
      run.step(1);
      if (!sampled && run.state.crew.every((c) => c.sanityPct === 0)) {
        sampled = true;
        for (const c of run.state.crew) expect(c.sanityBand).toBe('breakdown');
      }
      for (const e of run.takeEvents()) if (e.type === 'crew-lapse') seen.add(e.message.key);
      for (const id of ['lifeSupport', 'engines', 'reactor'] as const) expect(run.state.ship.systems[id].enabled).toBe(true);
    }
    expect(sampled).toBe(true);
    expect(run.state.lossReason).toBeNull();
    expect(run.state.phase).not.toBe('lost');
    for (const c of run.state.crew) expect(c.alive).toBe(true);
    expect(seen.has('event.lapse.switch')).toBe(true);
    expect(run.state.stats.lapses).toBeGreaterThan(0);
    expect(run.state.stats.sanityCriticalS).toBeGreaterThan(100);
  });
});

describe('descanso (`rest`)', () => {
  const cat = calmPsychCatalog();
  const lowered = (pct = 50) => {
    const run = createRun({ seed: 5, catalog: cat });
    run.state.crew[0]!.sanityPct = pct;
    return run;
  };

  it('recupera cordura y sueño y deja al tripulante en la litera un momento', () => {
    const run = lowered();
    stepSeconds(run, 10);
    const before = run.state.crew[0]!.sanityPct!;
    expect(run.apply({ type: 'rest', seconds: 0.5 }).ok).toBe(true);
    const m = run.state.crew[0]!;
    expect(m.sanityPct!).toBeGreaterThan(before + 0.2);
    expect(m.awakeS!).toBeLessThan(10);
    expect(m.restUntilS!).toBeGreaterThan(run.state.stats.timeS);
    expect(run.state.stats.restS).toBeCloseTo(0.5, 8);
  });

  it('el descanso bloquea el trabajo y la esquiva mientras dura, y luego lo libera', () => {
    const run = lowered();
    run.state.incidents.push({ id: 900, kind: 'short', systemId: 'nav', ageS: 0, progress: 0 });
    run.apply({ type: 'rest', seconds: 0.5 });
    const r = run.apply({ type: 'work-incident', incidentId: 900, seconds: 0.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.key).toBe('reject.crewResting');
    expect(run.state.incidents[0]!.progress).toBe(0);
    stepSeconds(run, 1);
    expect(run.apply({ type: 'work-incident', incidentId: 900, seconds: 0.5 }).ok).toBe(true);
  });

  it('con una alarma activa (fuego o fuga) rinde menos', () => {
    const calm = lowered();
    const alarm = lowered();
    alarm.state.incidents.push({ id: 901, kind: 'leak', systemId: 'nav', ageS: 0, progress: 0 });
    calm.apply({ type: 'rest', seconds: 0.5 });
    alarm.apply({ type: 'rest', seconds: 0.5 });
    const gainCalm = calm.state.crew[0]!.sanityPct! - 50;
    const gainAlarm = alarm.state.crew[0]!.sanityPct! - 50;
    expect(gainAlarm).toBeCloseTo(gainCalm * 0.4, 8);
  });

  it('rechazos: no hace falta, fuera de la nave y durante el descenso', () => {
    const fresh = createRun({ seed: 5, catalog: cat });
    const key = (run: ReturnType<typeof createRun>) => {
      const r = run.apply({ type: 'rest', seconds: 0.5 });
      return r.ok ? 'ok' : r.reason.key;
    };
    expect(key(fresh)).toBe('reject.restNotNeeded');
    const eva = lowered();
    eva.state.crew[0]!.location = 'eva';
    expect(key(eva)).toBe('reject.restEva');
    const landing = lowered();
    (landing.state as { phase: string }).phase = 'landing';
    expect(key(landing)).toBe('reject.restDescent');
  });

  it('el gestor recupera ×1.25 en cooperativo', () => {
    const run = createRun({ seed: 5, catalog: cat, crewSize: 2, roles: ['pilot', 'manager'] });
    for (const c of run.state.crew) c.sanityPct = 50;
    run.apply({ type: 'rest', seconds: 0.5, crewId: 1 });
    run.apply({ type: 'rest', seconds: 0.5, crewId: 2 });
    const [a, b] = run.state.crew;
    expect((b!.sanityPct! - 50) / (a!.sanityPct! - 50)).toBeCloseTo(1.25, 8);
  });
});

describe('llamada a la Tierra (`call-earth`)', () => {
  const cat = calmPsychCatalog();
  const call = (run: ReturnType<typeof createRun>, n = 1) => {
    let last = run.apply({ type: 'call-earth', seconds: 0.5 });
    for (let i = 1; i < n; i++) last = run.apply({ type: 'call-earth', seconds: 0.5 });
    return last;
  };

  it('suma demanda eléctrica mientras se mantiene y se completa a los 6 s acumulados', () => {
    const run = createRun({ seed: 5, catalog: cat });
    run.state.crew[0]!.sanityPct = 40;
    const idle = run.state.ship.powerDemandKw;
    expect(call(run).ok).toBe(true);
    expect(run.state.ship.powerDemandKw).toBeCloseTo(idle + 15, 8);
    for (let i = 0; i < 11; i++) expect(call(run).ok).toBe(true);
    const m = run.state.crew[0]!;
    expect(m.sanityPct!).toBeGreaterThan(40 + 5);
    expect(run.state.stats.callsMade).toBe(1);
    expect(m.callCooldownUntilS!).toBeGreaterThan(run.state.stats.timeS);
    expect(run.state.ship.powerDemandKw).toBeCloseTo(idle, 8);
    const again = call(run);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason.key).toBe('reject.callCooldown');
  });

  it('rechazos: sin sensores, sin margen eléctrico y fuera de tránsito o atraque', () => {
    const key = (run: ReturnType<typeof createRun>) => {
      const r = run.apply({ type: 'call-earth', seconds: 0.5 });
      return r.ok ? 'ok' : r.reason.key;
    };
    const noNav = createRun({ seed: 5, catalog: cat });
    noNav.apply({ type: 'toggle-system', systemId: 'nav', enabled: false });
    expect(key(noNav)).toBe('reject.callNoNav');
    const noPower = createRun({ seed: 5, catalog: cat });
    noPower.state.ship.powerSupplyKw = noPower.state.ship.powerDemandKw + 5;
    expect(key(noPower)).toBe('reject.callPower');
    const surface = createRun({ seed: 5, catalog: cat });
    (surface.state as { phase: string }).phase = 'surface';
    expect(key(surface)).toBe('reject.callPhase');
  });

  it('la mejora comm-relay baja el enfriamiento a 60 s', () => {
    const run = createRun({ seed: 5, catalog: calmPsychCatalog((raw) => { raw.psych!.crewOfferSize = 4; raw.economy!.startCredits = 5000; }) });
    run.state.crew[0]!.sanityPct = 40;
    expect(run.apply({ type: 'buy-upgrade', upgradeId: 'comm-relay' }).ok).toBe(true);
    for (let i = 0; i < 12; i++) run.apply({ type: 'call-earth', seconds: 0.5 });
    const m = run.state.crew[0]!;
    expect(m.callCooldownUntilS! - run.state.stats.timeS).toBeCloseTo(60, 6);
  });
});

describe('provisiones frescas (`buy-provisions`)', () => {
  const cat = calmPsychCatalog();
  it('se compran en la estación, bajan el drenaje y se gastan en tránsito', () => {
    const run = createRun({ seed: 5, catalog: cat });
    const credits = run.state.credits;
    expect(run.apply({ type: 'buy-provisions', amount: 2 }).ok).toBe(true);
    expect(run.state.psych!.provisions).toBe(2);
    expect(run.state.credits).toBe(credits - 12);
    expect(run.stationQuote()!.provisions!.missing).toBe(4);
    const first = getNode(run.state.sector, run.state.locationId)!.links[0]!;
    run.apply({ type: 'jump', toId: first });
    run.state.psych!.provisionsS = 59.5;
    stepSeconds(run, 1);
    expect(run.state.psych!.provisions).toBe(1);
    expect(run.state.stats.provisionsUsed).toBe(1);
  });

  it('rechazos: despensa llena, sin créditos y fuera de estación', () => {
    const run = createRun({ seed: 5, catalog: cat });
    expect(run.apply({ type: 'buy-provisions' }).ok).toBe(true);
    const full = run.apply({ type: 'buy-provisions' });
    expect(!full.ok && full.reason.key).toBe('reject.provisionsFull');
    const poor = createRun({ seed: 5, catalog: cat });
    poor.state.credits = 3;
    const r = poor.apply({ type: 'buy-provisions' });
    expect(!r.ok && r.reason.key).toBe('reject.noCredits');
    const first = getNode(poor.state.sector, poor.state.locationId)!.links[0]!;
    poor.apply({ type: 'jump', toId: first });
    const t = poor.apply({ type: 'buy-provisions' });
    expect(!t.ok && t.reason.key).toBe('reject.inTransit');
  });

  it('con provisiones el desgaste en tránsito es el 70 %', () => {
    const drained = (provisions: number) => {
      const run = createRun({ seed: 5, catalog: cat });
      run.state.psych!.provisions = provisions;
      const first = getNode(run.state.sector, run.state.locationId)!.links[0]!;
      run.apply({ type: 'jump', toId: first });
      stepSeconds(run, 20);
      return 100 - run.state.crew[0]!.sanityPct!;
    };
    expect(drained(3) / drained(0)).toBeCloseTo(0.7, 3);
  });
});

describe('atraque en estación, golpes y recompensas', () => {
  const cat = calmPsychCatalog();
  it('en una estación se recupera con tope por atraque', () => {
    const run = createRun({ seed: 5, catalog: cat });
    run.state.crew[0]!.sanityPct = 10;
    stepSeconds(run, 200);
    const m = run.state.crew[0]!;
    const cap = catalog.psych!.station.capPct;
    expect(m.sanityPct!).toBeCloseTo(10 + cap, 3);
    expect(run.state.psych!.stationRecoveredPct).toBeCloseTo(cap, 3);
  });

  it('vender da una vez por atraque; arreglar una avería da cordura', () => {
    const run = createRun({ seed: 5, catalog: cat });
    run.state.crew[0]!.sanityPct = 50;
    run.state.ship.cargo = { ice: 3 };
    run.apply({ type: 'sell' });
    expect(run.state.crew[0]!.sanityPct).toBe(53);
    expect(run.state.psych!.saleBonusUsed).toBe(true);
    run.state.ship.cargo = { ice: 3 };
    run.apply({ type: 'sell' });
    expect(run.state.crew[0]!.sanityPct).toBe(53);
    run.state.incidents.push({ id: 7, kind: 'short', systemId: 'nav', ageS: 0, progress: 0.99 });
    run.apply({ type: 'work-incident', incidentId: 7, seconds: 0.5 });
    expect(run.state.crew[0]!.sanityPct).toBe(55);
  });

  it('reparar entre dos sube la cohesión y la cordura de ambos', () => {
    const run = createRun({ seed: 5, catalog: cat, crewSize: 2 });
    for (const c of run.state.crew) c.sanityPct = 50;
    run.state.psych!.cohesionPct = 60;
    run.state.incidents.push({ id: 8, kind: 'short', systemId: 'nav', ageS: 0, progress: 0.5 });
    run.apply({ type: 'work-incident', incidentId: 8, seconds: 0.1, crewId: 1 });
    run.apply({ type: 'work-incident', incidentId: 8, seconds: 0.5, crewId: 2 });
    expect(run.state.incidents[0]!.workers).toEqual([1, 2]);
    run.apply({ type: 'work-incident', incidentId: 8, seconds: 0.5, crewId: 2 });
    run.apply({ type: 'work-incident', incidentId: 8, seconds: 0.5, crewId: 1 });
    run.apply({ type: 'work-incident', incidentId: 8, seconds: 0.5, crewId: 1 });
    expect(run.state.incidents).toHaveLength(0);
    expect(run.state.psych!.cohesionPct).toBeCloseTo(65, 8);
    expect(run.state.crew[0]!.sanityPct!).toBeGreaterThanOrEqual(50 + 1 + 2 - 1e-9);
    expect(run.state.crew[1]!.sanityPct!).toBeGreaterThanOrEqual(50 + 1 - 1e-9);
  });

  it('la cohesión baja de 50 avisa y vuelve a avisar al recuperarse', () => {
    const run = createRun({ seed: 5, catalog: cat, crewSize: 2 });
    run.state.psych!.cohesionPct = 10;
    run.step(0.1);
    expect(run.takeEvents().some((e) => e.message.key === 'event.cohesion.low')).toBe(true);
    run.state.psych!.cohesionPct = 90;
    run.step(0.1);
    expect(run.takeEvents().some((e) => e.message.key === 'event.cohesion.recovered')).toBe(true);
  });
});

describe('debuffs en la partida', () => {
  const cat = calmPsychCatalog();
  const workDone = (band: 'stable' | 'critical') => {
    const run = createRun({ seed: 5, catalog: cat });
    run.state.crew[0]!.sanityBand = band;
    run.state.incidents.push({ id: 5, kind: 'short', systemId: 'nav', ageS: 0, progress: 0 });
    run.apply({ type: 'work-incident', incidentId: 5, seconds: 0.5 }); // sin crewId: primer vivo
    return run.state.incidents[0]!.progress;
  };
  it('en solitario sin crewId el trabajo usa al primer vivo: banda crítica ×0.75', () => {
    expect(workDone('critical') / workDone('stable')).toBeCloseTo(0.75, 8);
  });
  it('sin cordura el trabajo es el de siempre', () => {
    const run = createRun({ seed: 5, catalog: psychOffCatalog() });
    run.state.incidents.push({ id: 5, kind: 'short', systemId: 'nav', ageS: 0, progress: 0 });
    run.apply({ type: 'work-incident', incidentId: 5, seconds: 0.5 });
    expect(run.state.incidents[0]!.progress).toBeCloseTo(0.5 / catalog.hazards.incidents.short.repairS, 10);
  });
});

describe('determinismo', () => {
  const cat = psychCatalog((raw) => {
    raw.psych!.base.transit *= 30;
    raw.psych!.debuffs.lapsePerS = [0, 0, 0.2, 0.4];
  });
  const play = (chunk: number) => {
    const run = createRun({ seed: 9, catalog: cat, crewSize: 2 });
    const events: unknown[] = [];
    const first = getNode(run.state.sector, run.state.locationId)!.links[0]!;
    run.apply({ type: 'jump', toId: first });
    for (let t = 0; t < 120; t += chunk) {
      run.step(chunk);
      if (Math.round(t) % 15 === 0) run.apply({ type: 'rest', seconds: 0.5, crewId: 1 });
    }
    events.push(...run.takeEvents());
    return { state: run.snapshot(), events: events.length };
  };
  it('step(0.1) y step(7.3) dan lo mismo si las acciones llegan en los mismos instantes (sin acciones)', () => {
    const idle = (chunk: number) => {
      const run = createRun({ seed: 9, catalog: cat, crewSize: 2 });
      const first = getNode(run.state.sector, run.state.locationId)!.links[0]!;
      run.apply({ type: 'jump', toId: first });
      const total = 73;
      let done = 0;
      while (done < total - 1e-9) {
        const dt = Math.min(chunk, total - done);
        run.step(dt);
        done += dt;
      }
      return run.snapshot();
    };
    const a = idle(0.1);
    const b = idle(7.3);
    expect(a.crew.map((c) => c.sanityPct)).toEqual(b.crew.map((c) => c.sanityPct));
    expect(a.psych).toEqual(b.psych);
    expect(a.stats.lapses).toEqual(b.stats.lapses);
    expect(a.ship.systems).toEqual(b.ship.systems);
  });
  it('misma semilla, mismo resultado', () => {
    expect(play(0.1)).toEqual(play(0.1));
  });
  it('hydrate(snapshot()) a mitad de partida recalcula las reglas y sigue igual', () => {
    const run = createRun({ seed: 9, catalog: cat, crewSize: 2 });
    stepSeconds(run, 40);
    const snap = run.snapshot();
    const other = createRun({ seed: 9, catalog: cat, crewSize: 2 });
    other.hydrate(snap);
    expect(other.snapshot()).toEqual(snap);
    expect(other.stationQuote()?.provisions).toEqual(run.stationQuote()?.provisions);
  });
});

describe('bot: política de cordura', () => {
  it('descansar mantiene la cordura media más alta que ignorarla (sector 4)', () => {
    const cat = psychCatalog();
    const mean = (policy: 'ignore' | 'rest') => {
      let sum = 0;
      let n = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const r = playRun(seed, { skill: 'crew', sectors: 4, walkS: 3.5, catalog: cat, psychPolicy: policy });
        for (const c of r.state.crew) {
          sum += c.sanityPct ?? 0;
          n++;
        }
      }
      return sum / n;
    };
    expect(mean('rest')).toBeGreaterThan(mean('ignore'));
  });
});

describe('diseño: aviso crew-wellbeing y módulos de hábitat', () => {
  const europa = referenceDesign('mission-europa-ocean');
  const codes = (design: typeof europa, cat?: Catalog) => reviewDesign(design, cat).issues.filter((i) => i.severity === 'warning').map((i) => i.code);
  it('misión larga sin hábitat avisa (solo con la cordura activa); con hábitat o apagada, no', () => {
    const cat = psychCatalog();
    expect(codes(europa, cat)).toContain('crew-wellbeing');
    expect(codes(europa, psychOffCatalog())).not.toContain('crew-wellbeing');
    expect(codes({ ...europa, moduleIds: [...europa.moduleIds, 'habitat-cabin'] }, cat)).not.toContain('crew-wellbeing');
    expect(codes(referenceDesign('mission-lunar-ice'), cat)).not.toContain('crew-wellbeing');
  });
  it('los módulos con efectos `crew` no tocan la nave diseñada', () => {
    const plain = shipFromDesign(europa);
    const withHabitat = shipFromDesign({ ...europa, moduleIds: [...europa.moduleIds, 'habitat-cabin'] });
    expect(withHabitat.systemDrawKw.lifeSupport - plain.systemDrawKw.lifeSupport).toBeCloseTo(5, 8);
    expect(withHabitat).not.toHaveProperty('sanityDrainMult');
  });
});
