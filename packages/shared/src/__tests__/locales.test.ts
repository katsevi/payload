import { describe, expect, it } from 'vitest';
import es from '../../locales/es.json';
import en from '../../locales/en.json';
import {
  catalog, createRun, FIXED_STEP_S, flattenKeys, formatMessage, getNode, getNodeKind, getWorld, HAZARD_KINDS, INCIDENT_KINDS, lookupSimKey, MAX_WORK_SECONDS,
  parseCatalog, referenceBrake, simLocales, SYSTEM_IDS, THROTTLE_IDS,
  type MessageRef, type Run, type RunAction,
} from '../index';
import { playRun } from './bot';
import { referenceDesign } from './missionFixtures';
import { operationsScript, scienceScript } from './scienceHelpers';
import { calmPsychCatalog, psychCatalog } from './psychHelpers';

describe('locales del motor (namespace sim)', () => {
  it('es y en tienen exactamente las mismas claves', () => {
    expect(flattenKeys(es).sort()).toEqual(flattenKeys(en).sort());
    expect(flattenKeys(simLocales.es).sort()).toEqual(flattenKeys(simLocales.en).sort());
  });

  it('cada clave usa los mismos {{params}} en ambos idiomas y ningún texto está vacío', () => {
    const params = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const key of flattenKeys(es)) {
      const a = lookupSimKey(key, 'es')!;
      const b = lookupSimKey(key, 'en')!;
      expect(a.length, key).toBeGreaterThan(0);
      expect(b.length, key).toBeGreaterThan(0);
      expect(params(a), key).toEqual(params(b));
    }
  });

  it('texto mínimo: ningún mensaje del motor pasa de 90 caracteres', () => {
    for (const locale of ['es', 'en'] as const) {
      for (const key of flattenKeys(es)) expect(lookupSimKey(key, locale)!.length, `${key} (${locale})`).toBeLessThanOrEqual(90);
    }
  });

  it('hay etiquetas para cada sistema, régimen, avería, peligro y nombre del catálogo', () => {
    for (const locale of ['es', 'en'] as const) {
      for (const s of SYSTEM_IDS) {
        expect(lookupSimKey(`system.${s}`, locale), s).toBeDefined();
        expect(lookupSimKey(`systemName.${s}`, locale), s).toBeDefined();
      }
      for (const t of THROTTLE_IDS) expect(lookupSimKey(`throttle.${t}`, locale), t).toBeDefined();
      for (const k of INCIDENT_KINDS) expect(lookupSimKey(`incident.${k}`, locale), k).toBeDefined();
      for (const k of HAZARD_KINDS) expect(lookupSimKey(`hazard.${k}`, locale), k).toBeDefined();
      const surface = catalog.surface!;
      for (const e of [...catalog.ships, ...catalog.nodeKinds, ...surface.worlds, ...surface.materials]) expect(lookupSimKey(`catalog.${e.id}`, locale)).toBe(e.name[locale]);
    }
  });

  it('toda MessageRef emitida existe en ambos idiomas, trae sus params y se resuelve del todo', () => {
    const refs: MessageRef[] = [];
    for (let seed = 1; seed <= 80; seed++) {
      refs.push(...playRun(seed, { skill: 'crew', sectors: 4, walkS: seed % 2 ? 3.5 : 7 }).events.map((e) => e.message));
      refs.push(...playRun(seed, { skill: 'idle', sectors: 1 }).events.map((e) => e.message));
      if (seed <= 40) {
        refs.push(...playRun(seed, { skill: 'crew', explore: 'prudent', sectors: 3, walkS: 3.5 }).events.map((e) => e.message));
        refs.push(...playRun(seed, { skill: 'crew', explore: 'greedy', sectors: 3, walkS: seed % 2 ? 3.5 : 7 }).events.map((e) => e.message));
      }
    }
    refs.push(...surfaceScript());
    refs.push(...toolScript());
    refs.push(...evadeScript());
    refs.push(...economyScript());
    refs.push(...scienceScript());
    refs.push(...operationsScript());
    // Fase 8: cordura (catálogo con `psych.enabled`; con ella apagada nada de esto se emite).
    refs.push(...psychScript());
    // Fase 4: partidas con misión diseñada sobre el sistema solar (cuerpos reales en los mensajes).
    for (const missionId of ['mission-mars-habitability', 'mission-europa-ocean']) {
      for (let seed = 1; seed <= 6; seed++) {
        refs.push(...playRun(seed, { skill: 'crew', sectors: 2, walkS: 3.5, design: referenceDesign(missionId), explore: seed % 2 ? 'prudent' : undefined }).events.map((e) => e.message));
      }
    }
    // Rechazos: se prueban acciones fuera de lugar en cada fase.
    const actions: RunAction[] = [
      { type: 'jump', toId: 'nope' }, { type: 'evade' }, { type: 'service' }, { type: 'next-sector' },
      { type: 'toggle-system', systemId: 'reactor', enabled: false }, { type: 'work-incident', incidentId: 999, seconds: 1 },
      { type: 'repair-system', systemId: 'nav', seconds: 1 }, { type: 'set-throttle', throttle: 'warp' as never },
      { type: 'toggle-system', systemId: 'toaster' as never, enabled: true }, { type: 'dance' } as never,
    ];
    const run = createRun({ seed: 3 });
    const tryAll = () => {
      for (const a of actions) {
        const r = run.apply(a);
        if (!r.ok) refs.push(r.reason);
      }
    };
    tryAll();
    run.apply({ type: 'toggle-system', systemId: 'engines', enabled: false });
    tryAll();
    const first = run.state.sector.nodes.find((n) => n.id === run.state.locationId)!.links[0]!;
    let r = run.apply({ type: 'jump', toId: first });
    if (!r.ok) refs.push(r.reason);
    run.apply({ type: 'toggle-system', systemId: 'engines', enabled: true });
    run.apply({ type: 'jump', toId: first });
    tryAll();
    r = run.apply({ type: 'jump', toId: first });
    if (!r.ok) refs.push(r.reason);

    const keys = new Set<string>();
    for (const ref of refs) {
      keys.add(ref.key);
      for (const locale of ['es', 'en'] as const) {
        const template = lookupSimKey(ref.key, locale);
        expect(template, `${ref.key} (${locale})`).toBeDefined();
        for (const [, p] of template!.matchAll(/\{\{(\w+)\}\}/g)) {
          expect(ref.params && p! in ref.params, `${ref.key}: falta el param "${p}"`).toBe(true);
        }
        const text = formatMessage(ref, locale);
        expect(text, `${ref.key} (${locale}): ${text}`).not.toMatch(/\{\{|\$t\(|\b(system|systemName|catalog|throttle)\.[A-Za-z]/);
      }
    }
    // El barrido cubre todos los eventos y pérdidas declarados.
    const declared = flattenKeys(es).filter((k) => /^(event|loss)\./.test(k));
    for (const key of declared) expect(keys.has(key), `nunca se emitió ${key}`).toBe(true);
    for (const key of [
      'reject.notLandable', 'reject.alreadyLanded', 'reject.landFuel', 'reject.notDescending', 'reject.notLanded', 'reject.notOnSurface',
      'reject.onSurface', 'reject.crewOutside', 'reject.alreadyOutside', 'reject.notOutside', 'reject.tooFar', 'reject.noDeposit',
      'reject.overCapacity', 'reject.jetpackEmpty', 'reject.takeOffFuel', 'reject.takeOffHeavy', 'reject.nothingToJettison', 'reject.crewDead',
      'reject.enginesOffline', 'reject.collectAirborne',
      'reject.toolAirborne', 'reject.toolPlaced', 'reject.noTool', 'reject.noToolHere', 'reject.nothingReady',
      // Fase 3: terminal de estación.
      'reject.notAtStation', 'reject.noCredits', 'reject.nothingToSell', 'reject.supplyFull', 'reject.notOffered', 'reject.upgradeMaxed',
      'reject.noService', 'reject.serviceUsed', 'reject.serviceNotNeeded',
      // Fase 5: misión terminada.
      'reject.missionOver',
      // Fase 8: cordura.
      'reject.crewResting', 'reject.restEva', 'reject.restDescent', 'reject.restNotNeeded', 'reject.callPhase', 'reject.callNoNav', 'reject.callCooldown',
      'reject.callPower', 'reject.callNoWindow', 'reject.provisionsFull',
    ]) expect(keys.has(key), key).toBe(true);
    for (const key of ['reject.noRoute', 'reject.notInTransit', 'reject.notAtGate', 'reject.reactorAlwaysOn', 'reject.noIncident', 'reject.noDamage', 'reject.invalid', 'reject.enginesOff', 'reject.inTransit', 'reject.noWarning']) {
      expect(keys.has(key), key).toBe(true);
    }
  }, 120_000); // barrido largo (bots de 4 sectores y exploradores con economía)
});

/** Fase 3: terminal de estación (venta, compras, emergencia y mejoras) con sus rechazos. */
function economyScript(): MessageRef[] {
  const refs: MessageRef[] = [];
  const raw = JSON.parse(JSON.stringify(catalog)) as typeof catalog;
  raw.economy!.offer.size = 2;
  raw.ships[0]!.startSpares = raw.ships[0]!.maxSpares;
  const run = createRun({ seed: 5, catalog: parseCatalog(raw) });
  const tryA = (a: RunAction) => {
    const r = run.apply(a);
    if (!r.ok) refs.push(r.reason);
  };
  const offered = run.stationQuote()!.upgrades.map((u) => u.upgradeId);
  const other = run.catalog.upgrades!.find((u) => !offered.includes(u.id))!.id;
  tryA({ type: 'service' }); // no hace falta
  tryA({ type: 'sell' }); // nada que vender
  tryA({ type: 'buy-supply', supply: 'fuel' }); // lleno
  tryA({ type: 'buy-upgrade', upgradeId: other }); // no se ofrece
  run.state.credits = 0;
  run.state.ship.hull = 50;
  tryA({ type: 'buy-supply', supply: 'hull' }); // sin créditos
  run.state.credits = 5000;
  Object.assign(run.state.ship.cargo, { crystal: 2 });
  tryA({ type: 'sell', materialId: 'crystal', units: 1 });
  tryA({ type: 'sell' });
  tryA({ type: 'buy-supply', supply: 'hull' });
  run.state.ship.spares = 0;
  tryA({ type: 'buy-supply', supply: 'spares', amount: 1 });
  run.state.ship.fuel = 50;
  tryA({ type: 'buy-supply', supply: 'fuel' });
  const one = run.catalog.upgrades!.find((u) => u.id === offered[0])!;
  for (let i = 0; i <= one.levels.length; i++) tryA({ type: 'buy-upgrade', upgradeId: one.id }); // hasta el máximo
  run.state.ship.fuel = 10;
  tryA({ type: 'service' });
  tryA({ type: 'service' }); // ya usada
  const here = getNode(run.state.sector, run.state.locationId)!;
  const to = here.links.map((id) => getNode(run.state.sector, id)!).find((n) => n.kind !== 'station')!;
  run.apply({ type: 'jump', toId: to.id });
  for (let t = 0; t < 600 && run.state.phase === 'transit'; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
  tryA({ type: 'sell' }); // no es estación
  tryA({ type: 'service' }); // aquí no hay terminal
  refs.push(...run.takeEvents().map((e) => e.message));
  return refs;
}

/**
 * Secuencia guionizada en superficie con el catálogo por defecto: rechazos fuera de lugar y soltar
 * carga (que el bot casi nunca necesita). Devuelve todas las MessageRef que produce.
 */
function surfaceScript(): MessageRef[] {
  const refs: MessageRef[] = [];
  const tryA = (run: Run, a: RunAction) => {
    const r = run.apply(a);
    if (!r.ok) refs.push(r.reason);
    return r.ok;
  };
  const walk = (run: Run, x: number, z: number) => {
    for (let i = 0; i < 3000; i++) {
      const m = run.state.crew[0]!;
      const d = Math.hypot(x - m.x, z - m.z);
      if (d < 0.1) {
        // Recoger exige los pies en el suelo: primero se intenta en el aire (rechazo) y luego se posa.
        const near = run.state.surface?.deposits.find((dep) => dep.units > 0 && Math.hypot(dep.x - m.x, dep.z - m.z) <= 1);
        if (near) tryA(run, { type: 'collect', depositId: near.id, seconds: 0.1 });
        run.apply({ type: 'set-position', x: m.x, z: m.z, grounded: true });
        return;
      }
      const k = Math.min(1, 0.9 / d);
      run.apply({ type: 'set-position', x: m.x + (x - m.x) * k, z: m.z + (z - m.z) * k, grounded: false });
      run.step(FIXED_STEP_S);
    }
  };
  const station = createRun({ seed: 1 });
  tryA(station, { type: 'land' });
  tryA(station, { type: 'eva-exit' });
  tryA(station, { type: 'set-descent-brake', on: true });

  for (let seed = 1; seed < 200; seed++) {
    const run = createRun({ seed });
    const here = getNode(run.state.sector, run.state.locationId)!;
    const target = here.links.map((id) => getNode(run.state.sector, id)!).find((n) => getNodeKind(n.kind).landable);
    if (!target || !run.apply({ type: 'jump', toId: target.id }).ok) continue;
    for (let t = 0; t < 600 && run.state.phase === 'transit'; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
    if (run.state.phase !== 'docked') continue;
    const fuel = run.state.ship.fuel;
    run.state.ship.fuel = 0.5;
    tryA(run, { type: 'land' });
    run.state.ship.fuel = fuel;
    // Motores encendidos pero sin energía (apagón por un corto en el reactor).
    run.state.incidents.push({ id: 999, kind: 'short', systemId: 'reactor', ageS: 0, progress: 0 });
    run.step(FIXED_STEP_S);
    tryA(run, { type: 'land' });
    run.state.incidents = [];
    run.step(FIXED_STEP_S);
    if (!tryA(run, { type: 'land' })) continue;
    tryA(run, { type: 'eva-exit' });
    const world = getWorld(run.state.surface!.worldId);
    const rules = catalog.surface!.rules;
    for (let t = 0; t < 600 && (run.state.phase as string) === 'landing'; t += FIXED_STEP_S) {
      const d = run.state.surface!.descent!;
      // Frena tarde a propósito: aterrizaje brusco (el bot casi nunca lo provoca).
      run.apply({ type: 'set-descent-brake', on: referenceBrake(world, rules, d.altitudeM, d.speedMps, 1.4) });
      run.step(FIXED_STEP_S);
    }
    const s = run.state.surface!;
    // Hace falta una veta de algo que no se procese (va a la bodega y se puede soltar).
    const rare = s.deposits.find((d) => (d.materialId === 'crystal' || d.materialId === 'sample') && !s.zones.some((z) => Math.hypot(d.x - z.x, d.z - z.z) <= z.radiusM + 1));
    if (!rare) continue;
    tryA(run, { type: 'jettison' });
    tryA(run, { type: 'eva-enter' });
    tryA(run, { type: 'jump', toId: here.id });
    tryA(run, { type: 'land' });
    run.state.ship.systems.nav.healthPct = 50;
    tryA(run, { type: 'eva-exit' });
    tryA(run, { type: 'eva-exit' });
    tryA(run, { type: 'repair-system', systemId: 'nav', seconds: 0.1 });
    tryA(run, { type: 'take-off' });
    tryA(run, { type: 'collect', depositId: rare.id, seconds: 0.1 });
    tryA(run, { type: 'deploy-tool', depositId: rare.id }); // demasiado lejos
    tryA(run, { type: 'collect', depositId: 9999, seconds: 0.1 });
    for (let i = 0; i < 40; i++) tryA(run, { type: 'jetpack', seconds: MAX_WORK_SECONDS });
    walk(run, rare.x, rare.z);
    run.apply({ type: 'deploy-tool', depositId: rare.id });
    for (let i = 0; i < 600 && s.tools.some((t) => t.depositId === rare.id); i++) {
      run.apply({ type: 'collect', depositId: rare.id });
      run.step(FIXED_STEP_S);
    }
    // Llenar la carga a mano para provocar el rechazo por capacidad.
    const m = run.state.crew[0]!;
    const kg = m.carriedKg;
    m.carriedKg = rules.suit.carryCapacityKg;
    const other = s.deposits.find((d) => d.units > 0)!;
    walk(run, other.x, other.z);
    run.apply({ type: 'deploy-tool', depositId: other.id });
    for (let i = 0; i < 200 && !s.tools.some((t) => t.depositId === other.id && t.ready > 0); i++) run.step(FIXED_STEP_S);
    tryA(run, { type: 'collect', depositId: other.id });
    run.apply({ type: 'retrieve-tool', depositId: other.id });
    m.carriedKg = kg;
    walk(run, 0, 0);
    tryA(run, { type: 'eva-enter' });
    // Con poco O₂ a bordo el traje sale a medias.
    const shipO2 = run.state.ship.oxygenPct;
    run.state.ship.oxygenPct = rules.suit.refillMinShipO2Pct + 1;
    tryA(run, { type: 'eva-exit' });
    tryA(run, { type: 'eva-enter' });
    run.state.ship.oxygenPct = shipO2;
    tryA(run, { type: 'eva-exit', crewId: 99 }); // tripulante inexistente o muerto
    const est = run.estimateTakeOff()!;
    run.state.ship.fuel = (est.fuel + est.fuelEmpty) / 2;
    tryA(run, { type: 'take-off' });
    tryA(run, { type: 'jettison' });
    run.state.ship.fuel = est.fuelEmpty / 2;
    tryA(run, { type: 'take-off' });
    run.state.ship.fuel = fuel;
    tryA(run, { type: 'take-off' });
    tryA(run, { type: 'land' });
    refs.push(...run.takeEvents().map((e) => e.message));
    // Ningún hoyo del catálogo mata ya de una caída: una caída letal (p. ej. desde el jetpack) a mano.
    const fall = createRun({ seed });
    fall.apply({ type: 'jump', toId: target.id });
    for (let t = 0; t < 600 && fall.state.phase === 'transit'; t += FIXED_STEP_S) fall.step(FIXED_STEP_S);
    fall.apply({ type: 'land' });
    for (let t = 0; t < 600 && (fall.state.phase as string) === 'landing'; t += FIXED_STEP_S) {
      const d = fall.state.surface!.descent!;
      fall.apply({ type: 'set-descent-brake', on: referenceBrake(world, rules, d.altitudeM, d.speedMps) });
      fall.step(FIXED_STEP_S);
    }
    fall.apply({ type: 'eva-exit' });
    fall.apply({ type: 'fall-impact', speedMps: rules.falls.lethalMps });
    refs.push(...fall.takeEvents().map((e) => e.message));
    return refs;
  }
  throw new Error('ninguna semilla sirvió para el guion de superficie');
}

/** Catálogo por defecto con hielo y tormentas en todos los mundos (el concentrador solar ve tormentas). */
function stormyIceCatalog() {
  const raw = JSON.parse(JSON.stringify(catalog)) as typeof catalog;
  for (const k of raw.nodeKinds) {
    k.hazardPerLy = { impact: 0, short: 0, fire: 0, leak: 0 };
    delete k.cache;
  }
  raw.hazards.wear.chancePerS = 0;
  for (const w of raw.surface!.worlds) {
    w.storms = { meanIntervalS: 5, warnS: 5, durationS: { min: 15, max: 15 }, intensity: { min: 0.5, max: 0.5 }, o2DrainPctPerS: 0, firstStartMinS: 30 };
    w.unstable.zones = { min: 0, max: 0 };
    w.materials = [{ materialId: 'ice', weight: 1, units: { min: 30, max: 30 }, minDistanceFrac: 0, dangerWeightMult: 1 }];
  }
  return parseCatalog(raw);
}

/** Herramientas: colocar, rechazos, parada y reanudación por tormenta, recogida, retirada y pérdida. */
function toolScript(): MessageRef[] {
  const refs: MessageRef[] = [];
  const cat = stormyIceCatalog();
  const rules = cat.surface!.rules;
  const tryA = (run: Run, a: RunAction) => {
    const r = run.apply(a);
    if (!r.ok) refs.push(r.reason);
    return r.ok;
  };
  for (let seed = 1; seed < 200; seed++) {
    const run = createRun({ seed, catalog: cat });
    const here = getNode(run.state.sector, run.state.locationId)!;
    const target = here.links.map((id) => getNode(run.state.sector, id)!).find((n) => getNodeKind(n.kind, cat).landable);
    if (!target || !run.apply({ type: 'jump', toId: target.id }).ok) continue;
    for (let t = 0; t < 600 && run.state.phase === 'transit'; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
    if (!run.apply({ type: 'land' }).ok) continue;
    const world = cat.surface!.worlds.find((w) => w.id === run.state.surface!.worldId)!;
    for (let t = 0; t < 600 && (run.state.phase as string) === 'landing'; t += FIXED_STEP_S) {
      const d = run.state.surface!.descent!;
      run.apply({ type: 'set-descent-brake', on: referenceBrake(world, rules, d.altitudeM, d.speedMps) });
      run.step(FIXED_STEP_S);
    }
    const s = run.state.surface!;
    const m = run.state.crew[0]!;
    run.apply({ type: 'eva-exit' });
    const [a, b] = s.deposits;
    if (!a || !b) continue;
    const goTo = (x: number, z: number, grounded = true) => {
      for (let i = 0; i < 3000 && Math.hypot(x - m.x, z - m.z) > 0.1; i++) {
        const k = Math.min(1, 0.9 / Math.hypot(x - m.x, z - m.z));
        run.apply({ type: 'set-position', x: m.x + (x - m.x) * k, z: m.z + (z - m.z) * k, grounded });
        run.step(FIXED_STEP_S);
        m.suitO2Pct = 100; // (el guion no mide el oxígeno)
      }
    };
    tryA(run, { type: 'collect', depositId: a.id }); // sin herramienta
    goTo(a.x, a.z, false);
    tryA(run, { type: 'deploy-tool', depositId: a.id }); // en el aire
    run.apply({ type: 'set-position', x: m.x, z: m.z, grounded: true });
    tryA(run, { type: 'deploy-tool', depositId: a.id });
    tryA(run, { type: 'deploy-tool', depositId: a.id }); // ya tiene una
    tryA(run, { type: 'collect', depositId: a.id }); // nada listo
    goTo(b.x, b.z);
    tryA(run, { type: 'deploy-tool', depositId: b.id }); // no queda concentrador
    goTo(a.x, a.z);
    // Tormenta: se para y sigue.
    for (let t = 0; t < 120 && !s.storm.active; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
    for (let t = 0; t < 60 && s.storm.active; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
    run.step(FIXED_STEP_S);
    m.suitO2Pct = 100;
    run.apply({ type: 'set-position', x: m.x, z: m.z, grounded: false });
    tryA(run, { type: 'collect', depositId: a.id }); // en el aire
    run.apply({ type: 'set-position', x: m.x, z: m.z, grounded: true });
    tryA(run, { type: 'collect', depositId: a.id });
    tryA(run, { type: 'retrieve-tool', depositId: a.id });
    // Una veta pequeña que se agota (tool-done) y otra herramienta que se queda fuera (tool-lost).
    s.deposits[0]!.units = 1;
    tryA(run, { type: 'deploy-tool', depositId: a.id });
    for (let t = 0; t < 30 && s.tools[0]?.stopped !== 'depleted'; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
    tryA(run, { type: 'collect', depositId: a.id });
    tryA(run, { type: 'collect', depositId: a.id }); // devuelve la herramienta
    goTo(b.x, b.z);
    tryA(run, { type: 'deploy-tool', depositId: b.id });
    goTo(0, 0);
    tryA(run, { type: 'eva-enter' });
    refs.push(...run.takeEvents().map((e) => e.message));
    return refs;
  }
  throw new Error('ninguna semilla sirvió para el guion de herramientas');
}

/** Esquiva por habilidad: un roce informado por el cliente. */
function evadeScript(): MessageRef[] {
  const raw = JSON.parse(JSON.stringify(catalog)) as typeof catalog;
  for (const k of raw.nodeKinds) k.hazardPerLy = { impact: 0.3, short: 0, fire: 0, leak: 0 };
  const cat = parseCatalog(raw);
  for (let seed = 1; seed < 100; seed++) {
    const run = createRun({ seed, catalog: cat });
    const to = getNode(run.state.sector, run.state.locationId)!.links[0]!;
    run.apply({ type: 'jump', toId: to });
    for (let t = 0; t < 300 && run.state.warnings.length === 0 && run.state.phase === 'transit'; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
    if (!run.apply({ type: 'evade', grazes: 1 }).ok) continue;
    for (let t = 0; t < 120 && run.state.phase === 'transit'; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
    const refs = run.takeEvents().map((e) => e.message);
    if (refs.some((r) => r.key === 'event.impactGrazed')) return refs;
  }
  throw new Error('ninguna semilla sirvió para el guion de esquiva');
}

/** Fase 8: cordura. Cada evento y rechazo nuevo se emite al menos una vez (con atajos sobre el estado vivo). */
function psychScript(): MessageRef[] {
  const refs: MessageRef[] = [];
  const tryA = (run: Run, a: RunAction) => {
    const r = run.apply(a);
    if (!r.ok) refs.push(r.reason);
    return r.ok;
  };
  const step = (run: Run, seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
    refs.push(...run.takeEvents().map((e) => e.message));
  };
  const cat = calmPsychCatalog((raw) => {
    raw.psych!.debuffs.lapsePerS = [0, 0, 1, 1]; // lapsus seguros en cuanto toque
    raw.psych!.lapse.cooldownS = 0;
  });
  // Bandas: tensa, crítica, quiebre y recomposición.
  const run = createRun({ seed: 4, catalog: cat, crewSize: 2 });
  const [a, b] = run.state.crew;
  for (const pct of [60, 30, 5, 100]) {
    a!.sanityPct = pct;
    step(run, 0.2);
  }
  // Cohesión baja y recuperada.
  run.state.psych!.cohesionPct = 5;
  step(run, 0.2);
  run.state.psych!.cohesionPct = 95;
  step(run, 0.2);
  // Lapsus a bordo (apaga escudos o sensores) y en EVA (suelta lo que lleva).
  b!.sanityPct = 5;
  step(run, 1);
  const material = catalog.surface!.materials[0]!;
  Object.assign(b!, { location: 'eva', carried: { [material.id]: 2 }, carriedValues: { [material.id]: 10 }, carriedKg: material.massKg * 2, carriedValue: 10, carriedUnits: 2 });
  step(run, 1);
  Object.assign(b!, { location: 'ship', sanityPct: 100 });
  // Descanso: inicio y fin (el sueño llega a 0).
  const rest = createRun({ seed: 4, catalog: cat });
  tryA(rest, { type: 'rest', seconds: 0.5 }); // no hace falta
  step(rest, 3);
  rest.state.crew[0]!.sanityPct = 50;
  for (let i = 0; i < 4; i++) tryA(rest, { type: 'rest', seconds: 0.5 });
  refs.push(...rest.takeEvents().map((e) => e.message));
  // Rechazos de descanso y llamada, y la llamada completa.
  const eva = createRun({ seed: 4, catalog: cat });
  eva.state.crew[0]!.sanityPct = 50;
  eva.state.crew[0]!.location = 'eva';
  tryA(eva, { type: 'rest', seconds: 0.5 });
  const landing = createRun({ seed: 4, catalog: cat });
  landing.state.crew[0]!.sanityPct = 50;
  (landing.state as { phase: string }).phase = 'landing';
  tryA(landing, { type: 'rest', seconds: 0.5 });
  tryA(landing, { type: 'call-earth', seconds: 0.5 });
  const noNav = createRun({ seed: 4, catalog: cat });
  noNav.apply({ type: 'toggle-system', systemId: 'nav', enabled: false });
  tryA(noNav, { type: 'call-earth', seconds: 0.5 });
  const noPower = createRun({ seed: 4, catalog: cat });
  noPower.state.ship.powerSupplyKw = noPower.state.ship.powerDemandKw;
  tryA(noPower, { type: 'call-earth', seconds: 0.5 });
  const call = createRun({ seed: 4, catalog: cat });
  call.state.crew[0]!.sanityPct = 40;
  for (let i = 0; i < 14; i++) tryA(call, { type: 'call-earth', seconds: 0.5 });
  refs.push(...call.takeEvents().map((e) => e.message));
  // Descansando no se trabaja.
  const busy = createRun({ seed: 4, catalog: cat });
  busy.state.crew[0]!.sanityPct = 50;
  busy.state.incidents.push({ id: 1, kind: 'short', systemId: 'nav', ageS: 0, progress: 0 });
  tryA(busy, { type: 'rest', seconds: 0.5 });
  tryA(busy, { type: 'work-incident', incidentId: 1, seconds: 0.5 });
  // Provisiones: compra, despensa llena y fuera de ventana de contacto (con diseño y ciencia).
  const shop = createRun({ seed: 4, catalog: psychCatalog() });
  tryA(shop, { type: 'buy-provisions' });
  tryA(shop, { type: 'buy-provisions' });
  refs.push(...shop.takeEvents().map((e) => e.message));
  const designed = createRun({ seed: 4, catalog: psychCatalog(), design: referenceDesign('mission-mars-habitability') });
  for (let t = 0; t < 4000; t += 5) {
    if (!tryA(designed, { type: 'call-earth', seconds: 0.5 })) break;
    step(designed, 5);
  }
  return refs;
}
