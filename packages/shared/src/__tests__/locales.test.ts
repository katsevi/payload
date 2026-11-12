import { describe, expect, it } from 'vitest';
import es from '../../locales/es.json';
import en from '../../locales/en.json';
import {
  catalog, createRun, FIXED_STEP_S, flattenKeys, formatMessage, getNode, getNodeKind, getWorld, HAZARD_KINDS, INCIDENT_KINDS, lookupSimKey, MAX_WORK_SECONDS,
  referenceBrake, simLocales, SYSTEM_IDS, THROTTLE_IDS,
  type MessageRef, type Run, type RunAction,
} from '../index';
import { playRun } from './bot';

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
    ]) expect(keys.has(key), key).toBe(true);
    for (const key of ['reject.noRoute', 'reject.notInTransit', 'reject.notAtGate', 'reject.reactorAlwaysOn', 'reject.noIncident', 'reject.noDamage', 'reject.invalid', 'reject.enginesOff', 'reject.inTransit', 'reject.noWarning']) {
      expect(keys.has(key), key).toBe(true);
    }
  });
});

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
    tryA(run, { type: 'collect', depositId: 9999, seconds: 0.1 });
    for (let i = 0; i < 40; i++) tryA(run, { type: 'jetpack', seconds: MAX_WORK_SECONDS });
    walk(run, rare.x, rare.z);
    for (let i = 0; i < 400 && run.state.surface!.deposits.find((d) => d.id === rare.id)!.units > 0; i++) {
      run.apply({ type: 'collect', depositId: rare.id, seconds: FIXED_STEP_S });
      run.step(FIXED_STEP_S);
    }
    // Llenar la carga a mano para provocar el rechazo por capacidad.
    const m = run.state.crew[0]!;
    const kg = m.carriedKg;
    m.carriedKg = rules.suit.carryCapacityKg;
    const other = s.deposits.find((d) => d.units > 0)!;
    walk(run, other.x, other.z);
    tryA(run, { type: 'collect', depositId: other.id, seconds: 0.1 });
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
