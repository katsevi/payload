import { describe, expect, it } from 'vitest';
import {
  catalog, computeScore, createRun, cruiseSpeedLyPerS, FIXED_STEP_S, fuelPerLy, getNode, getShip, MAX_WORK_SECONDS, parseCatalog,
  type Catalog, type Run, type RunEvent, type SystemId,
} from '../index';

const ship = getShip(undefined);

/** Catálogo sin azar en ruta: ni peligros ni desgaste (para probar una mecánica cada vez). */
function calmCatalog(patch?: (raw: Catalog) => void): Catalog {
  const raw = JSON.parse(JSON.stringify(catalog)) as Catalog;
  for (const k of raw.nodeKinds) {
    k.hazardPerLy = { impact: 0, short: 0, fire: 0, leak: 0 };
    delete k.cache;
  }
  raw.hazards.wear.chancePerS = 0;
  patch?.(raw);
  return parseCatalog(raw);
}

/** Catálogo con un único tipo de peligro garantizado en cada salto. */
function hazardCatalog(kind: 'impact' | 'short' | 'fire' | 'leak', perLy = 0.5): Catalog {
  return calmCatalog((raw) => {
    for (const k of raw.nodeKinds) k.hazardPerLy[kind] = perLy;
  });
}

function advance(run: Run, seconds: number, chunk = FIXED_STEP_S): RunEvent[] {
  const events: RunEvent[] = [];
  for (let t = 0; t < seconds - 1e-9; t += chunk) events.push(...run.step(chunk));
  return events;
}

function firstLink(run: Run): string {
  return getNode(run.state.sector, run.state.locationId)!.links[0]!;
}

function jump(run: Run, toId = firstLink(run)): string {
  expect(run.apply({ type: 'jump', toId })).toEqual({ ok: true });
  return toId;
}

function untilDocked(run: Run, maxS = 600): RunEvent[] {
  const events: RunEvent[] = [];
  for (let t = 0; t < maxS && run.state.phase === 'transit'; t += FIXED_STEP_S) events.push(...run.step(FIXED_STEP_S));
  return events;
}

/** Trabaja una avería hasta resolverla (como mantener pulsada la tecla). */
function fix(run: Run, incidentId: number): void {
  for (let i = 0; i < 200 && run.state.incidents.some((x) => x.id === incidentId); i++) {
    run.apply({ type: 'work-incident', incidentId, seconds: FIXED_STEP_S });
  }
}

describe('inicio de la partida', () => {
  it('empieza atracada en la estación de salida con la nave intacta', () => {
    const run = createRun({ seed: 1 });
    const s = run.state;
    expect(s.phase).toBe('docked');
    expect(s.locationId).toBe(s.sector.startId);
    expect(s.ship).toMatchObject({ hull: ship.hullMax, fuel: ship.startFuel, oxygenPct: 100, spares: ship.startSpares, throttle: 'cruise', overloaded: false });
    expect(Object.values(s.ship.systems).every((x) => x.online && x.healthPct === 100)).toBe(true);
    expect(s.score).toBe(0);
  });

  it('atracada y sin averías, la nave se mantiene estable indefinidamente', () => {
    const run = createRun({ seed: 1 });
    advance(run, 300);
    expect(run.state.phase).toBe('docked');
    expect(run.state.ship.oxygenPct).toBe(100);
    expect(run.state.ship.hull).toBe(ship.hullMax);
    expect(run.state.ship.fuel).toBe(ship.startFuel);
  });
});

describe('determinismo', () => {
  function scripted(chunk: number): unknown {
    const run = createRun({ seed: 99 });
    jump(run);
    // Mismas acciones en los mismos instantes, con el tiempo troceado de formas distintas.
    advance(run, 5, chunk);
    run.apply({ type: 'set-throttle', throttle: 'burn' });
    advance(run, 5, chunk);
    run.apply({ type: 'toggle-system', systemId: 'shields', enabled: false });
    advance(run, 30, chunk);
    return run.snapshot();
  }

  it('el resultado no depende de cómo se trocee step()', () => {
    const reference = scripted(FIXED_STEP_S);
    expect(scripted(0.5)).toEqual(reference);
    expect(scripted(2.5)).toEqual(reference);
    expect(scripted(5)).toEqual(reference);
  });

  it('semillas distintas dan partidas distintas', () => {
    const a = createRun({ seed: 1 }).snapshot();
    const b = createRun({ seed: 2 }).snapshot();
    expect(a.sector).not.toEqual(b.sector);
  });

  it('snapshot() es una copia: no la altera el avance de la partida', () => {
    const run = createRun({ seed: 3 });
    const before = run.snapshot();
    jump(run);
    advance(run, 3);
    expect(before.phase).toBe('docked');
    expect(run.state.phase).toBe('transit');
  });
});

describe('viaje y combustible', () => {
  it('el salto consume el combustible y el tiempo estimados', () => {
    const run = createRun({ seed: 5, catalog: calmCatalog() });
    const toId = firstLink(run);
    const est = run.estimateJump(toId)!;
    jump(run, toId);
    const t0 = run.state.stats.timeS;
    const events = untilDocked(run);
    expect(run.state.locationId).toBe(toId);
    expect(ship.startFuel - run.state.ship.fuel).toBeCloseTo(est.byThrottle.cruise.fuel, 5);
    expect(run.state.stats.timeS - t0).toBeGreaterThanOrEqual(est.byThrottle.cruise.timeS - 1e-6);
    expect(run.state.stats.timeS - t0).toBeLessThan(est.byThrottle.cruise.timeS + 0.3);
    expect(events.map((e) => e.type)).toContain('arrived');
    expect(run.state.stats.jumps).toBe(1);
    expect(run.state.stats.distanceLy).toBeCloseTo(est.distanceLy, 5);
  });

  it('régimen de motores: máxima llega antes y gasta más; económico al revés', () => {
    const results = (['eco', 'cruise', 'burn'] as const).map((throttle) => {
      const run = createRun({ seed: 5, catalog: calmCatalog() });
      // A máxima no hay energía para todo: se apagan los escudos.
      run.apply({ type: 'toggle-system', systemId: 'shields', enabled: false });
      run.apply({ type: 'set-throttle', throttle });
      jump(run);
      untilDocked(run);
      return { time: run.state.stats.timeS, fuel: ship.startFuel - run.state.ship.fuel };
    });
    const [eco, cruise, burn] = results as [typeof results[0], typeof results[0], typeof results[0]];
    expect(burn.time).toBeLessThan(cruise.time);
    expect(cruise.time).toBeLessThan(eco.time);
    expect(burn.fuel).toBeGreaterThan(cruise.fuel);
    expect(cruise.fuel).toBeGreaterThan(eco.fuel);
  });

  it('los motores dañados van más lentos y gastan más', () => {
    expect(fuelPerLy(ship, 'cruise', 40)).toBeGreaterThan(fuelPerLy(ship, 'cruise', 100));
    expect(cruiseSpeedLyPerS(ship, 'cruise', 40)).toBeLessThan(cruiseSpeedLyPerS(ship, 'cruise', 100));
    expect(cruiseSpeedLyPerS(ship, 'cruise', 0)).toBe(0);
  });

  it('con los motores apagados o en corto la nave se detiene en pleno salto', () => {
    const run = createRun({ seed: 5, catalog: calmCatalog() });
    jump(run);
    advance(run, 2);
    run.apply({ type: 'toggle-system', systemId: 'engines', enabled: false });
    const at = run.state.transit!.traveledLy;
    const fuel = run.state.ship.fuel;
    advance(run, 5);
    expect(run.state.ship.speedLyPerS).toBe(0);
    expect(run.state.transit!.traveledLy).toBe(at);
    expect(run.state.ship.fuel).toBe(fuel);
  });

  it('rechaza saltos imposibles con su motivo', () => {
    const run = createRun({ seed: 5, catalog: calmCatalog() });
    expect(run.apply({ type: 'jump', toId: 'no-existe' })).toEqual({ ok: false, reason: { key: 'reject.noRoute' } });
    expect(run.apply({ type: 'jump', toId: run.state.sector.goalId })).toEqual({ ok: false, reason: { key: 'reject.noRoute' } });
    run.apply({ type: 'toggle-system', systemId: 'engines', enabled: false });
    expect(run.apply({ type: 'jump', toId: firstLink(run) })).toEqual({ ok: false, reason: { key: 'reject.enginesOff' } });
    run.apply({ type: 'toggle-system', systemId: 'engines', enabled: true });
    jump(run);
    expect(run.apply({ type: 'jump', toId: firstLink(run) })).toEqual({ ok: false, reason: { key: 'reject.inTransit' } });
    expect(run.apply({ type: 'service' })).toEqual({ ok: false, reason: { key: 'reject.inTransit' } });
  });

  it('al llegar se recoge el contenedor del destino una sola vez', () => {
    const cat = calmCatalog((raw) => {
      for (const k of raw.nodeKinds) if (k.id !== 'station' && k.id !== 'gate') k.cache = { chance: 1, fuel: { min: 10, max: 10 }, spares: { min: 1, max: 1 } };
    });
    for (let seed = 1; seed < 40; seed++) {
      const run = createRun({ seed, catalog: cat });
      const here = getNode(run.state.sector, run.state.locationId)!;
      const target = here.links.map((id) => getNode(run.state.sector, id)!).find((n) => n.cache);
      if (!target) continue;
      const est = run.estimateJump(target.id)!;
      jump(run, target.id);
      const events = untilDocked(run);
      expect(events.filter((e) => e.type === 'cache')).toHaveLength(1);
      expect(run.state.ship.fuel).toBeCloseTo(ship.startFuel - est.byThrottle.cruise.fuel + 10, 5);
      expect(run.state.ship.spares).toBe(ship.startSpares + 1);
      // Ir y volver no lo repite.
      jump(run, here.id);
      untilDocked(run);
      jump(run, target.id);
      expect(untilDocked(run).filter((e) => e.type === 'cache')).toHaveLength(0);
      return;
    }
    throw new Error('ninguna semilla dio un vecino con contenedor');
  });
});

describe('energía', () => {
  it('a máxima con todo encendido hay sobrecarga y el reactor se daña; apagar escudos la corta', () => {
    const run = createRun({ seed: 8, catalog: calmCatalog() });
    run.apply({ type: 'set-throttle', throttle: 'burn' });
    jump(run);
    advance(run, 3);
    const events = run.takeEvents();
    expect(run.state.ship.overloaded).toBe(true);
    expect(events.filter((e) => e.type === 'overload')).toHaveLength(1);
    expect(run.state.ship.systems.reactor.healthPct).toBeLessThan(100);
    run.apply({ type: 'toggle-system', systemId: 'shields', enabled: false });
    const health = run.state.ship.systems.reactor.healthPct;
    advance(run, 3);
    expect(run.state.ship.overloaded).toBe(false);
    expect(run.state.ship.systems.reactor.healthPct).toBe(health);
    expect(run.state.ship.systems.shields.online).toBe(false);
  });

  it('un corto en el reactor deja la nave a oscuras hasta que se repara', () => {
    const run = createRun({ seed: 8, catalog: hazardCatalog('short', 2) });
    jump(run);
    let blackout: RunEvent | undefined;
    for (let t = 0; t < 120 && !blackout; t += FIXED_STEP_S) blackout = run.step(FIXED_STEP_S).find((e) => e.type === 'blackout');
    expect(blackout).toBeDefined();
    const s = run.state.ship;
    expect(s.powerSupplyKw).toBe(0);
    expect(s.systems.lifeSupport.online).toBe(false);
    expect(s.speedLyPerS).toBe(0);
    fix(run, run.state.incidents.find((i) => i.kind === 'short' && i.systemId === 'reactor')!.id);
    expect(s.powerSupplyKw).toBeGreaterThan(0);
  });

  it('el reactor no se puede apagar', () => {
    const run = createRun({ seed: 8 });
    expect(run.apply({ type: 'toggle-system', systemId: 'reactor', enabled: false })).toEqual({ ok: false, reason: { key: 'reject.reactorAlwaysOn' } });
  });
});

describe('averías', () => {
  function withIncident(kind: 'fire' | 'short' | 'leak'): Run {
    const run = createRun({ seed: 12, catalog: hazardCatalog(kind, 1) });
    jump(run);
    for (let t = 0; t < 120 && run.state.incidents.length === 0; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
    expect(run.state.incidents[0]?.kind).toBe(kind);
    return run;
  }

  it('una fuga vacía el oxígeno aunque el soporte vital funcione, y sellarla lo recupera', () => {
    const run = withIncident('leak');
    const before = run.state.ship.oxygenPct;
    advance(run, 5);
    expect(run.state.ship.oxygenPct).toBeLessThan(before - 3);
    for (const inc of [...run.state.incidents]) fix(run, inc.id);
    const low = run.state.ship.oxygenPct;
    // Con todo sellado el soporte vital vuelve a ganar (pueden surgir fugas nuevas en ruta: se sellan).
    for (let t = 0; t < 8; t += FIXED_STEP_S) {
      run.step(FIXED_STEP_S);
      for (const inc of [...run.state.incidents]) fix(run, inc.id);
    }
    expect(run.state.ship.oxygenPct).toBeGreaterThan(low);
  });

  it('el fuego daña el sistema, el casco y consume oxígeno', () => {
    const run = withIncident('fire');
    const fire = run.state.incidents[0]!;
    const health = run.state.ship.systems[fire.systemId].healthPct;
    const hull = run.state.ship.hull;
    advance(run, 4);
    expect(run.state.ship.systems[fire.systemId].healthPct).toBeLessThan(health);
    expect(run.state.ship.hull).toBeLessThan(hull);
  });

  it('un corto apaga su sistema y, si nadie lo atiende, acaba en incendio', () => {
    const run = withIncident('short');
    const short = run.state.incidents[0]!;
    expect(run.state.ship.systems[short.systemId].shorted).toBe(true);
    expect(run.state.ship.systems[short.systemId].online).toBe(false);
    const events = advance(run, catalog.hazards.incidents.short.escalateToFireAfterS + 1);
    expect(events.some((e) => e.type === 'incident-escalated' && e.systemId === short.systemId)).toBe(true);
    expect(run.state.incidents.some((i) => i.kind === 'fire' && i.systemId === short.systemId)).toBe(true);
  });

  it('arreglar una avería lleva el tiempo indicado y cuenta en las estadísticas', () => {
    const run = withIncident('leak');
    const leak = run.state.incidents[0]!;
    const needed = Math.ceil(catalog.hazards.incidents.leak.repairS / FIXED_STEP_S);
    for (let i = 0; i < needed - 1; i++) run.apply({ type: 'work-incident', incidentId: leak.id, seconds: FIXED_STEP_S });
    expect(run.state.incidents.some((i) => i.id === leak.id)).toBe(true);
    run.apply({ type: 'work-incident', incidentId: leak.id, seconds: FIXED_STEP_S });
    run.apply({ type: 'work-incident', incidentId: leak.id, seconds: FIXED_STEP_S });
    expect(run.state.incidents.some((i) => i.id === leak.id)).toBe(false);
    expect(run.state.stats.incidentsFixed).toBe(1);
    expect(run.takeEvents().some((e) => e.type === 'incident-fixed')).toBe(true);
    expect(run.apply({ type: 'work-incident', incidentId: leak.id, seconds: 1 })).toEqual({ ok: false, reason: { key: 'reject.noIncident' } });
  });

  it('una acción no puede aportar más trabajo que MAX_WORK_SECONDS', () => {
    const run = withIncident('fire');
    const fire = run.state.incidents[0]!;
    run.apply({ type: 'work-incident', incidentId: fire.id, seconds: 999 });
    expect(run.state.incidents.find((i) => i.id === fire.id)?.progress).toBeCloseTo(MAX_WORK_SECONDS / catalog.hazards.incidents.fire.repairS, 6);
  });

  it('un fuego desatendido se propaga a otro sistema', () => {
    const run = withIncident('fire');
    const events = advance(run, catalog.hazards.incidents.fire.spreadAfterS + 2);
    if (run.state.phase !== 'lost') expect(events.some((e) => e.type === 'fire-spread') || run.state.incidents.filter((i) => i.kind === 'fire').length > 1).toBe(true);
  });

  it('un kit de repuestos restaura parte de la salud de un sistema dañado', () => {
    const run = withIncident('fire');
    const fire = run.state.incidents[0]!;
    advance(run, 6);
    for (const inc of [...run.state.incidents]) fix(run, inc.id);
    const target: SystemId = fire.systemId;
    const health = run.state.ship.systems[target].healthPct;
    expect(health).toBeLessThan(100);
    const spares = run.state.ship.spares;
    for (let i = 0; i < 100 && run.state.ship.spares === spares; i++) run.apply({ type: 'repair-system', systemId: target, seconds: FIXED_STEP_S });
    expect(run.state.ship.spares).toBe(spares - 1);
    expect(run.state.ship.systems[target].healthPct).toBeCloseTo(Math.min(100, health + catalog.hazards.repair.kitRestorePct), 5);
    expect(run.state.stats.kitsUsed).toBe(1);
  });

  it('reparar exige daños y repuestos', () => {
    const run = createRun({ seed: 1 });
    expect(run.apply({ type: 'repair-system', systemId: 'engines', seconds: 1 })).toEqual({ ok: false, reason: { key: 'reject.noDamage' } });
  });
});

describe('impactos', () => {
  function toWarning(run: Run): void {
    jump(run);
    for (let t = 0; t < 200 && run.state.warnings.length === 0 && run.state.phase === 'transit'; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
    expect(run.state.warnings.length).toBeGreaterThan(0);
  }
  function passImpact(run: Run): RunEvent[] {
    const events: RunEvent[] = [];
    for (let t = 0; t < 60 && !events.some((e) => e.type === 'impact-hit' || e.type === 'impact-evaded'); t += FIXED_STEP_S) events.push(...run.step(FIXED_STEP_S));
    return events;
  }

  it('los sensores avisan antes del impacto y la maniobra evasiva lo evita a cambio de combustible', () => {
    const run = createRun({ seed: 21, catalog: hazardCatalog('impact', 0.2) });
    toWarning(run);
    expect(run.state.warnings[0]!.etaS).toBeGreaterThan(0);
    const fuel = run.state.ship.fuel;
    expect(run.apply({ type: 'evade' })).toEqual({ ok: true });
    expect(run.state.ship.fuel).toBeCloseTo(fuel - ship.evadeFuel, 6);
    expect(run.state.warnings[0]!.evaded).toBe(true);
    const events = passImpact(run);
    expect(events.some((e) => e.type === 'impact-evaded')).toBe(true);
    expect(run.state.ship.hull).toBe(ship.hullMax);
    expect(run.state.stats.impactsEvaded).toBe(1);
  });

  it('con escudos el impacto duele menos que sin ellos', () => {
    const hit = (shields: boolean): number => {
      const run = createRun({ seed: 21, catalog: hazardCatalog('impact', 0.2) });
      run.apply({ type: 'toggle-system', systemId: 'shields', enabled: shields });
      toWarning(run);
      passImpact(run);
      return ship.hullMax - run.state.ship.hull;
    };
    const shielded = hit(true);
    const bare = hit(false);
    expect(shielded).toBeGreaterThan(0);
    expect(bare).toBeGreaterThan(shielded * 2);
  });

  it('sin navegación no hay aviso ni forma de esquivar', () => {
    const run = createRun({ seed: 21, catalog: hazardCatalog('impact', 0.2) });
    run.apply({ type: 'toggle-system', systemId: 'nav', enabled: false });
    jump(run);
    const events: RunEvent[] = [];
    for (let t = 0; t < 200 && run.state.stats.impactsTaken === 0 && run.state.phase === 'transit'; t += FIXED_STEP_S) {
      events.push(...run.step(FIXED_STEP_S));
      expect(run.state.warnings).toHaveLength(0);
      expect(run.apply({ type: 'evade' }).ok).toBe(false);
    }
    expect(run.state.stats.impactsTaken).toBe(1);
    expect(events.some((e) => e.type === 'impact-warning')).toBe(false);
  });

  it('ir más rápido deja menos tiempo para reaccionar', () => {
    const eta = (throttle: 'eco' | 'burn'): number => {
      const run = createRun({ seed: 21, catalog: hazardCatalog('impact', 0.2) });
      run.apply({ type: 'toggle-system', systemId: 'shields', enabled: false });
      run.apply({ type: 'set-throttle', throttle });
      toWarning(run);
      return run.state.warnings[0]!.etaS;
    };
    expect(eta('burn')).toBeLessThan(eta('eco') * 0.6);
  });
});

describe('estaciones, portal y derrota', () => {
  it('el servicio de estación reposta y repara una sola vez, y solo si hace falta', () => {
    const run = createRun({ seed: 30, catalog: calmCatalog((raw) => { raw.ships[0]!.startSpares = raw.ships[0]!.maxSpares; }) });
    expect(run.apply({ type: 'service' })).toEqual({ ok: false, reason: { key: 'reject.serviceNotNeeded' } });
    const home = run.state.locationId;
    const out = jump(run);
    untilDocked(run);
    if (getNode(run.state.sector, out)!.kind !== 'station') expect(run.apply({ type: 'service' })).toEqual({ ok: false, reason: { key: 'reject.noService' } });
    jump(run, home);
    untilDocked(run);
    expect(run.state.ship.fuel).toBeLessThan(ship.fuelCapacity);
    expect(run.apply({ type: 'service' })).toEqual({ ok: true });
    expect(run.state.ship.fuel).toBe(ship.fuelCapacity);
    expect(run.takeEvents().some((e) => e.type === 'service')).toBe(true);
    expect(run.apply({ type: 'service' })).toEqual({ ok: false, reason: { key: 'reject.serviceUsed' } });
  });

  it('llegar al portal supera el sector; next-sector genera el siguiente, más difícil', () => {
    const run = createRun({ seed: 30, catalog: calmCatalog() });
    expect(run.apply({ type: 'next-sector' })).toEqual({ ok: false, reason: { key: 'reject.notAtGate' } });
    run.apply({ type: 'set-throttle', throttle: 'eco' });
    for (let hops = 0; hops < 12 && run.state.phase === 'docked'; hops++) {
      run.apply({ type: 'service' });
      const here = getNode(run.state.sector, run.state.locationId)!;
      const next = here.links.map((id) => getNode(run.state.sector, id)!).filter((n) => n.column > here.column)
        .sort((a, b) => (a.kind === 'station' ? -1 : 0) - (b.kind === 'station' ? -1 : 0) || run.estimateJump(a.id)!.distanceLy - run.estimateJump(b.id)!.distanceLy)[0]!;
      jump(run, next.id);
      untilDocked(run);
    }
    expect(run.state.phase).toBe('won');
    expect(run.state.stats.sectorsCleared).toBe(1);
    expect(run.state.score).toBe(computeScore(run.state.stats));
    expect(run.state.score).toBeGreaterThanOrEqual(1000);
    const time = run.state.stats.timeS;
    advance(run, 10);
    expect(run.state.stats.timeS).toBe(time); // en el portal el tiempo no corre
    expect(run.apply({ type: 'jump', toId: 'x' })).toEqual({ ok: false, reason: { key: 'reject.sectorCleared' } });
    expect(run.apply({ type: 'next-sector' })).toEqual({ ok: true });
    expect(run.state.sector.index).toBe(2);
    expect(run.state.phase).toBe('docked');
    expect(run.state.locationId).toBe(run.state.sector.startId);
  });

  it('casco a cero: la nave se pierde y la partida termina (permadeath)', () => {
    const run = createRun({ seed: 4, catalog: hazardCatalog('fire', 2) });
    jump(run);
    let lost: RunEvent | undefined;
    for (let t = 0; t < 1200 && !lost; t += FIXED_STEP_S) lost = run.step(FIXED_STEP_S).find((e) => e.type === 'lost');
    expect(run.state.phase).toBe('lost');
    expect(['hull', 'oxygen', 'stranded']).toContain(run.state.lossReason);
    expect(lost?.message.key).toBe(`loss.${run.state.lossReason}`);
    expect(run.apply({ type: 'set-throttle', throttle: 'eco' })).toEqual({ ok: false, reason: { key: 'reject.runOver' } });
    const frozen = run.snapshot();
    advance(run, 5);
    expect(run.snapshot()).toEqual(frozen);
  });

  it('sin oxígeno la tripulación muere', () => {
    const run = createRun({ seed: 4, catalog: calmCatalog() });
    run.apply({ type: 'toggle-system', systemId: 'lifeSupport', enabled: false });
    const events = advance(run, 100 / ship.crewO2UsePctPerS + 2);
    expect(events.some((e) => e.type === 'low-oxygen')).toBe(true);
    expect(run.state.phase).toBe('lost');
    expect(run.state.lossReason).toBe('oxygen');
  });

  it('quedarse sin combustible en ruta deja la nave varada', () => {
    // Depósito justo para llegar en económico; a máxima el combustible se acaba a medio camino.
    const cat = calmCatalog((raw) => { raw.ships[0]!.startFuel = 13; });
    for (let seed = 1; seed <= 60; seed++) {
      const run = createRun({ seed, catalog: cat });
      const est = run.estimateJump(firstLink(run))!;
      if (!est.byThrottle.eco.enoughFuel || est.byThrottle.burn.enoughFuel) continue;
      jump(run);
      run.apply({ type: 'toggle-system', systemId: 'shields', enabled: false });
      run.apply({ type: 'set-throttle', throttle: 'burn' });
      const events = advance(run, 200);
      expect(events.some((e) => e.type === 'low-fuel')).toBe(true);
      expect(run.state.phase).toBe('lost');
      expect(run.state.lossReason).toBe('stranded');
      expect(run.state.ship.fuel).toBe(0);
      return;
    }
    throw new Error('ninguna semilla dio un salto que solo se completa en económico');
  });

  it('atracada sin combustible para ningún salto ni servicio: varada', () => {
    const cat = calmCatalog((raw) => {
      raw.ships[0]!.fuelCapacity = 40;
      raw.ships[0]!.startFuel = 40;
    });
    // Ir y volver agota el depósito pequeño; la estación ya atendió o el destino no tiene servicio.
    for (let seed = 1; seed <= 60; seed++) {
      const run = createRun({ seed, catalog: cat });
      const home = run.state.locationId;
      const target = getNode(run.state.sector, home)!.links.map((id) => getNode(run.state.sector, id)!).find((n) => n.kind !== 'station');
      if (!target || !run.apply({ type: 'jump', toId: target.id }).ok) continue;
      untilDocked(run);
      for (let i = 0; i < 6 && run.state.phase === 'docked'; i++) {
        const to = run.state.locationId === home ? target.id : home;
        if (!run.apply({ type: 'jump', toId: to }).ok) break;
        untilDocked(run);
      }
      advance(run, 1);
      if (run.state.phase === 'lost') {
        expect(run.state.lossReason).toBe('stranded');
        return;
      }
    }
    throw new Error('ninguna semilla dejó la nave varada');
  });
});
