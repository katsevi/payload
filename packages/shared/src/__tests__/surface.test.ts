/**
 * Fase 2 · superficie: descenso, salida (EVA), oxígeno del traje, jetpack, caídas, tormentas, terreno
 * inestable, vetas, bodega y despegue. Cada regla se aísla con un catálogo parcheado (un único mundo
 * de prueba para todos los tipos aterrizables, sin peligros en ruta ni desgaste).
 */
import { describe, expect, it } from 'vitest';
import {
  catalog, computeScore, createRun, FIXED_STEP_S, generateSector, generateSurface, getNode, getNodeKind, getNodeWorld, MAX_WORK_SECONDS,
  getMaterial, parseCatalog, referenceBrake, simulateDescent, streakMultiplier, suitRefill, takeOffFuel,
  type Catalog, type RunEvent, type Run, type WorldDef,
} from '../index';

const rules = catalog.surface!.rules;
/** Segundos que dura el tanque del traje. */
const TANK_S = 100 / rules.suit.o2DrainPctPerS;

const TEST_WORLD: WorldDef = {
  id: 'test-world',
  name: { es: 'Mundo de prueba', en: 'Test world' },
  kind: 'planet',
  weight: 1,
  gravityMps2: 5,
  descent: { altitudeM: 200, speedMps: 10 },
  radiusM: 100,
  deposits: { min: 12, max: 12 },
  materials: [{ materialId: 'ice', weight: 1, units: { min: 3, max: 3 }, minDistanceFrac: 0, dangerWeightMult: 1 }],
  storms: null,
  unstable: { zones: { min: 0, max: 0 }, radiusM: { min: 5, max: 5 }, pitDepthM: 10 },
  shipWearMult: 0,
};

/** Catálogo sin azar en ruta y con un único mundo (parcheable) para planetas, lunas y asteroides. */
function surfaceCatalog(patchWorld?: (w: WorldDef) => void, patch?: (raw: Catalog) => void): Catalog {
  const raw = JSON.parse(JSON.stringify(catalog)) as Catalog;
  for (const k of raw.nodeKinds) {
    k.hazardPerLy = { impact: 0, short: 0, fire: 0, leak: 0 };
    delete k.cache;
  }
  raw.hazards.wear.chancePerS = 0;
  const base = JSON.parse(JSON.stringify(TEST_WORLD)) as WorldDef;
  patchWorld?.(base);
  raw.surface!.worlds = (['planet', 'moon', 'asteroid'] as const).map((kind) => ({ ...JSON.parse(JSON.stringify(base)), id: `test-${kind}`, kind }));
  patch?.(raw);
  return parseCatalog(raw);
}

/** Avanza y devuelve los eventos (`step()` no vacía la cola: se leen solo con `takeEvents()`). */
function advance(run: Run, seconds: number, chunk = FIXED_STEP_S): RunEvent[] {
  for (let t = 0; t < seconds - 1e-9; t += chunk) run.step(chunk);
  return run.takeEvents();
}

/** Partida atracada en un destino aterrizable (salta al primer vecino aterrizable). */
function dockedAtLandable(cat: Catalog, firstSeed = 1): Run {
  for (let seed = firstSeed; seed < firstSeed + 80; seed++) {
    const run = createRun({ seed, catalog: cat });
    const here = getNode(run.state.sector, run.state.locationId)!;
    const target = here.links.map((id) => getNode(run.state.sector, id)!).find((n) => getNodeKind(n.kind, cat).landable);
    if (!target || !run.apply({ type: 'jump', toId: target.id }).ok) continue;
    for (let t = 0; t < 600 && run.state.phase === 'transit'; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
    if (run.state.phase === 'docked') {
      run.takeEvents();
      return run;
    }
  }
  throw new Error('ninguna semilla dio un vecino aterrizable');
}

/** Desciende con una política de freno y devuelve los eventos. */
function descend(run: Run, brake: (alt: number, v: number) => boolean): RunEvent[] {
  for (let t = 0; t < 600 && run.state.phase === 'landing'; t += FIXED_STEP_S) {
    const d = run.state.surface!.descent!;
    const want = brake(d.altitudeM, d.speedMps);
    if (want !== d.brake) run.apply({ type: 'set-descent-brake', on: want });
    run.step(FIXED_STEP_S);
  }
  return run.takeEvents();
}

function refBrake(run: Run) {
  const world = run.catalog.surface!.worlds.find((w) => w.id === run.state.surface!.worldId)!;
  return (alt: number, v: number) => referenceBrake(world, run.catalog.surface!.rules, alt, v);
}

function landed(cat: Catalog, firstSeed = 1): Run {
  const run = dockedAtLandable(cat, firstSeed);
  expect(run.apply({ type: 'land' })).toEqual({ ok: true });
  descend(run, refBrake(run));
  expect(run.state.phase).toBe('surface');
  run.takeEvents();
  return run;
}

/** Camina (sin saltarse el antitrampas) hasta (x, z) a `speed` m/s. */
function walkTo(run: Run, x: number, z: number, speed = 4, grounded = true): RunEvent[] {
  for (let i = 0; i < 2000; i++) {
    const m = run.state.crew[0]!;
    const dx = x - m.x;
    const dz = z - m.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05 || !m.alive || run.state.phase !== 'surface') break;
    const k = Math.min(1, (speed * FIXED_STEP_S) / d);
    run.apply({ type: 'set-position', x: m.x + dx * k, z: m.z + dz * k, grounded });
    run.step(FIXED_STEP_S);
  }
  return run.takeEvents();
}

function collectAll(run: Run, depositId: number, maxUnits = 99): void {
  for (let i = 0; i < 2000; i++) {
    const d = run.state.surface!.deposits.find((x) => x.id === depositId)!;
    if (d.units <= 0 || maxUnits <= 0) return;
    const before = d.units;
    if (!run.apply({ type: 'collect', depositId, seconds: FIXED_STEP_S }).ok) return;
    if (d.units < before) maxUnits--;
    run.step(FIXED_STEP_S);
  }
}

describe('catálogo de mundos', () => {
  it('cada tipo aterrizable tiene al menos un mundo y los nombres se validan', () => {
    for (const k of catalog.nodeKinds.filter((n) => n.landable)) expect(catalog.surface!.worlds.some((w) => w.kind === k.id), k.id).toBe(true);
    const raw = JSON.parse(JSON.stringify(catalog)) as Catalog;
    raw.surface!.worlds = raw.surface!.worlds.filter((w) => w.kind !== 'moon');
    expect(() => parseCatalog(raw)).toThrow(/aterrizable "moon"/);
  });

  it('rechaza materiales desconocidos y mundos en destinos no aterrizables', () => {
    const raw = JSON.parse(JSON.stringify(catalog)) as Catalog;
    raw.surface!.worlds[0]!.materials[0]!.materialId = 'unobtainium';
    expect(() => parseCatalog(raw)).toThrow(/material desconocido/);
    const raw2 = JSON.parse(JSON.stringify(catalog)) as Catalog;
    raw2.surface!.worlds[0]!.kind = 'nebula';
    expect(() => parseCatalog(raw2)).toThrow(/no aterrizable/);
  });

  it('un catálogo sin superficie recibe la del catálogo por defecto', () => {
    const raw = JSON.parse(JSON.stringify(catalog)) as Record<string, unknown>;
    delete raw.surface;
    expect(parseCatalog(raw).surface).toEqual(catalog.surface);
  });
});

describe('cifras del catálogo de superficie (decisiones de diseño)', () => {
  it('ningún hoyo mata de la caída y en el mundo pesado es poco hondo (el jetpack apenas sube allí)', () => {
    for (const w of catalog.surface!.worlds) {
      expect(Math.sqrt(2 * w.gravityMps2 * w.unstable.pitDepthM), w.id).toBeLessThan(rules.falls.lethalMps);
      expect(w.unstable.pitDepthM, w.id).toBeLessThanOrEqual(11);
    }
    expect(catalog.surface!.worlds.find((w) => w.id === 'heavy-world')!.unstable.pitDepthM).toBeLessThanOrEqual(7);
  });

  it('el hielo es de los asteroides: bajar a uno da un neto modesto de combustible; a planetas y lunas cuesta', () => {
    const net: Record<string, number[]> = {};
    for (let seed = 1; seed <= 60; seed++) {
      const sector = generateSector(seed, 1, catalog);
      for (const node of sector.nodes.filter((n) => getNodeKind(n.kind).landable)) {
        const s = generateSurface(seed, sector, node.id, catalog)!;
        const w = catalog.surface!.worlds.find((x) => x.id === s.worldId)!;
        const ice = s.deposits.reduce((sum, d) => sum + (getMaterial(d.materialId).yields?.fuel ?? 0) * d.units, 0);
        (net[w.kind] ??= []).push(ice - simulateDescent(w, rules).fuel - takeOffFuel(w, rules, 0));
      }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(net.asteroid!)).toBeGreaterThanOrEqual(8);
    expect(mean(net.asteroid!)).toBeLessThanOrEqual(30);
    for (const kind of ['moon', 'planet']) expect(Math.max(...net[kind]!), kind).toBeLessThan(0);
  });

  it('se recoge rápido (<= 5 s por unidad) y lo raro pesa: la mochila obliga a elegir', () => {
    for (const m of catalog.surface!.materials) expect(m.collectS, m.id).toBeLessThanOrEqual(5);
    for (const m of catalog.surface!.materials.filter((x) => x.streak)) {
      expect(m.massKg, m.id).toBeGreaterThanOrEqual(8);
      expect(m.massKg, m.id).toBeLessThanOrEqual(12);
    }
    expect(rules.suit.carryCapacityKg).toBeLessThanOrEqual(90);
  });
});

describe('mundo de cada nodo', () => {
  it('es determinista, solo existe en destinos aterrizables y no altera el generador de sectores', () => {
    const sector = generateSector(7, 1, catalog);
    for (const node of sector.nodes) {
      const w = getNodeWorld(7, sector, node.id, catalog);
      if (getNodeKind(node.kind).landable) {
        expect(w?.kind).toBe(node.kind);
        expect(getNodeWorld(7, sector, node.id, catalog)).toBe(w);
      } else expect(w).toBeNull();
    }
    // Cambiar los mundos no cambia el mapa.
    const raw = JSON.parse(JSON.stringify(catalog)) as Catalog;
    raw.surface!.worlds = raw.surface!.worlds.map((w) => ({ ...w, weight: w.weight * 3 + 1, deposits: { min: 1, max: 2 } }));
    expect(generateSector(7, 1, parseCatalog(raw))).toEqual(generateSector(7, 1, catalog));
  });

  it('la generación del mundo es determinista y respeta el catálogo (10-20 vetas, zonas, tormentas)', () => {
    const sector = generateSector(11, 1, catalog);
    for (const node of sector.nodes.filter((n) => getNodeKind(n.kind).landable)) {
      const a = generateSurface(11, sector, node.id, catalog)!;
      expect(generateSurface(11, sector, node.id, catalog)).toEqual(a);
      const world = catalog.surface!.worlds.find((w) => w.id === a.worldId)!;
      expect(a.deposits.length).toBeGreaterThanOrEqual(world.deposits.min);
      expect(a.deposits.length).toBeLessThanOrEqual(Math.min(20, world.deposits.max));
      expect(a.zones.length).toBeGreaterThanOrEqual(world.unstable.zones.min);
      expect(a.storms.length > 0).toBe(world.storms !== null);
      for (const d of a.deposits) expect(Math.hypot(d.x, d.z)).toBeLessThanOrEqual(world.radiusM + 0.1);
    }
  });

  it('la veta de cada zona inestable no se alcanza desde suelo firme: hay que pisar la zona', () => {
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const sector = generateSector(seed, 1, catalog);
      for (const node of sector.nodes.filter((n) => getNodeKind(n.kind).landable)) {
        const s = generateSurface(seed, sector, node.id, catalog)!;
        s.zones.forEach((zone, i) => {
          const d = s.deposits[i];
          if (!d) return;
          checked++;
          expect(Math.hypot(d.x - zone.x, d.z - zone.z) + rules.suit.collectRangeM).toBeLessThan(zone.radiusM);
        });
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('lo valioso está lejos o junto al peligro; lo común, cerca', () => {
    const near: number[] = [];
    const far: number[] = [];
    let rareNear = 0;
    let riskyCrystals = 0;
    let crystals = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const sector = generateSector(seed, 1, catalog);
      for (const node of sector.nodes.filter((n) => getNodeKind(n.kind).landable)) {
        const s = generateSurface(seed, sector, node.id, catalog)!;
        for (const d of s.deposits) {
          const frac = Math.hypot(d.x, d.z) / s.radiusM;
          const mat = catalog.surface!.materials.find((m) => m.id === d.materialId)!;
          const v = d.valuePerUnit / mat.value;
          if (!d.risky) (frac < 0.3 ? near : frac > 0.7 ? far : []).push(v);
          if (d.materialId === 'sample' && frac < 0.3) rareNear++;
          if (d.materialId === 'crystal') {
            crystals++;
            if (d.risky) riskyCrystals++;
          }
        }
      }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(far)).toBeGreaterThan(mean(near) * 1.4);
    expect(rareNear).toBe(0);
    expect(riskyCrystals / crystals).toBeGreaterThan(0.3);
  });
});

describe('aterrizaje', () => {
  it('solo en destinos aterrizables, atracado, con combustible para bajar y despegar y una vez por nodo', () => {
    const cat = surfaceCatalog();
    const station = createRun({ seed: 1, catalog: cat });
    expect(station.estimateLanding()).toBeNull();
    expect(station.apply({ type: 'land' })).toEqual({ ok: false, reason: { key: 'reject.notLandable' } });

    const run = dockedAtLandable(cat);
    const est = run.estimateLanding()!;
    expect(est.takeOffFuel).toBeCloseTo(takeOffFuel(TEST_WORLD, rules, 0), 6);
    expect(est.totalFuel).toBeCloseTo(est.descentFuel + est.takeOffFuel, 6);
    expect(est.descentTimeS).toBeGreaterThan(0);
    const fuel = run.state.ship.fuel;
    // Cubrir solo el despegue no basta: el descenso también gasta (y no se puede cancelar).
    run.state.ship.fuel = est.totalFuel - 0.05; // (el test escribe el estado vivo para aislar la regla)
    expect(run.estimateLanding()!.canLand).toBe(false);
    expect(run.apply({ type: 'land' })).toEqual({ ok: false, reason: { key: 'reject.landFuel', params: { fuel: Math.ceil(est.totalFuel) } } });
    run.state.ship.fuel = fuel;
    expect(run.estimateLanding()!.canLand).toBe(true);
    expect(run.apply({ type: 'land' })).toEqual({ ok: true });
    expect(run.state.phase).toBe('landing');
    expect(run.state.landedIds).toContain(run.state.locationId);
    expect(run.takeEvents().some((e) => e.type === 'descent')).toBe(true);
    expect(run.apply({ type: 'land' })).toEqual({ ok: false, reason: { key: 'reject.onSurface' } });
    descend(run, refBrake(run));
    expect(run.apply({ type: 'take-off' })).toEqual({ ok: true });
    expect(run.state.phase).toBe('docked');
    expect(run.estimateLanding()!.alreadyLanded).toBe(true);
    expect(run.apply({ type: 'land' })).toEqual({ ok: false, reason: { key: 'reject.alreadyLanded' } });
  });

  it('motores encendidos pero sin energía o en corto: no se puede iniciar el descenso', () => {
    const run = dockedAtLandable(surfaceCatalog());
    run.state.incidents.push({ id: 999, kind: 'short', systemId: 'reactor', ageS: 0, progress: 0 }); // apagón
    run.step(FIXED_STEP_S);
    expect(run.state.ship.systems.engines).toMatchObject({ enabled: true, online: false });
    expect(run.apply({ type: 'land' })).toEqual({ ok: false, reason: { key: 'reject.enginesOffline' } });
    expect(run.state.phase).toBe('docked');
  });

  it('en todos los mundos hay tiempo de reaccionar: >= 3 s hasta la marca de frenar y >= 2,5 s tras ella (2 s en asteroides)', () => {
    // Caída libre hasta `tb` y freno a fondo desde ahí: ¿toca suelo a velocidad segura?
    const brakeFrom = (tb: number) => {
      let t = 0;
      return () => {
        const on = t >= tb - 1e-9;
        t += FIXED_STEP_S;
        return on;
      };
    };
    for (const w of catalog.surface!.worlds) {
      let alt = w.descent.altitudeM;
      let v = w.descent.speedMps;
      let tAsk = 0;
      while (alt > 0 && !referenceBrake(w, rules, alt, v)) {
        v += w.gravityMps2 * FIXED_STEP_S;
        alt -= v * FIXED_STEP_S;
        tAsk += FIXED_STEP_S;
      }
      let tLast = -1;
      for (let k = 0; k < 3000; k++) {
        if (simulateDescent(w, rules, brakeFrom(k * FIXED_STEP_S)).touchdownSpeedMps > rules.descent.safeSpeedMps) break;
        tLast = k * FIXED_STEP_S;
      }
      expect(tLast - tAsk, w.id).toBeGreaterThanOrEqual((w.kind === 'asteroid' ? 2 : 2.5) - 1e-6);
      if (w.kind !== 'asteroid') continue;
      // En un asteroide, llegar 1 s tarde es barato y frenar todo el camino (lo seguro del novato) es asumible.
      const late = simulateDescent(w, rules, brakeFrom(tLast + 1)).touchdownSpeedMps;
      expect((late - rules.descent.safeSpeedMps) * rules.descent.hullDamagePerMps, w.id).toBeLessThanOrEqual(8);
      const always = simulateDescent(w, rules, () => true);
      expect(always.fuel, w.id).toBeLessThanOrEqual(12);
      expect(always.timeS, w.id).toBeLessThanOrEqual(45);
      // Desde que empieza el descenso hasta la marca de frenar pasan >= 3 s (antes, en el mundo pesado, 1,4 s).
      expect(tAsk, w.id).toBeGreaterThanOrEqual(3 - 1e-6);
    }
  });

  it('el descenso de referencia dura 15-25 s en todos los mundos y toca suelo a velocidad segura', () => {
    for (const w of catalog.surface!.worlds) {
      const ref = simulateDescent(w, rules);
      expect(ref.timeS, w.id).toBeGreaterThanOrEqual(13);
      expect(ref.timeS, w.id).toBeLessThanOrEqual(25);
      expect(ref.touchdownSpeedMps, w.id).toBeLessThanOrEqual(rules.descent.safeSpeedMps);
      // Sin freno es un mal aterrizaje; frenando todo el rato se gasta mucho más.
      expect(simulateDescent(w, rules, () => false).touchdownSpeedMps, w.id).toBeGreaterThan(rules.descent.safeSpeedMps * 2);
      expect(simulateDescent(w, rules, () => true).fuel, w.id).toBeGreaterThan(ref.fuel * 3);
    }
  });

  it('frenar con el perfil de referencia da un aterrizaje suave que coincide con la estimación', () => {
    const run = dockedAtLandable(surfaceCatalog());
    const est = run.estimateLanding()!;
    const fuel = run.state.ship.fuel;
    run.apply({ type: 'land' });
    const t0 = run.state.stats.timeS;
    const events = descend(run, refBrake(run));
    expect(events.find((e) => e.type === 'landing')).toMatchObject({ message: { key: 'event.landing.soft' }, subtype: 'soft' });
    expect(run.state.ship.hull).toBe(catalog.ships[0]!.hullMax);
    expect(fuel - run.state.ship.fuel).toBeCloseTo(est.descentFuel, 5);
    expect(run.state.stats.timeS - t0).toBeCloseTo(est.descentTimeS, 5);
    expect(run.state.surface!.hardLanding).toBe(false);
    expect(run.state.stats.landings).toBe(1);
  });

  it('sin freno el aterrizaje es brusco: daña casco y sistemas en proporción al exceso de velocidad', () => {
    const run = dockedAtLandable(surfaceCatalog());
    run.apply({ type: 'land' });
    const events = descend(run, () => false);
    const hard = events.find((e) => e.type === 'landing')!;
    expect(hard.message.key).toBe('event.landing.hard');
    expect(hard.subtype).toBe('hard');
    const speed = run.state.surface!.touchdownSpeedMps!;
    const excess = speed - rules.descent.safeSpeedMps;
    expect(excess).toBeGreaterThan(5);
    expect(catalog.ships[0]!.hullMax - run.state.ship.hull).toBeCloseTo(excess * rules.descent.hullDamagePerMps, 0);
    expect(Object.values(run.state.ship.systems).some((s) => s.healthPct < 100)).toBe(true);
    expect(run.state.stats.hardLandings).toBe(1);
    expect(run.state.phase).toBe('surface');
  });

  it('frenar gasta combustible de la nave mientras está activo', () => {
    const run = dockedAtLandable(surfaceCatalog());
    run.apply({ type: 'land' });
    const fuel = run.state.ship.fuel;
    run.apply({ type: 'set-descent-brake', on: true });
    advance(run, 2);
    expect(fuel - run.state.ship.fuel).toBeCloseTo(2 * rules.descent.brakeFuelPerS, 5);
    expect(run.apply({ type: 'eva-exit' })).toEqual({ ok: false, reason: { key: 'reject.notLanded' } });
  });
});

describe('acciones fuera de lugar', () => {
  it('lo de superficie no vale atracado; lo de viaje no vale en tierra; reparar exige estar a bordo', () => {
    const run = dockedAtLandable(surfaceCatalog());
    expect(run.apply({ type: 'eva-exit' })).toEqual({ ok: false, reason: { key: 'reject.notOnSurface' } });
    expect(run.apply({ type: 'take-off' })).toEqual({ ok: false, reason: { key: 'reject.notOnSurface' } });
    expect(run.apply({ type: 'set-descent-brake', on: true })).toEqual({ ok: false, reason: { key: 'reject.notDescending' } });
    run.apply({ type: 'land' });
    descend(run, refBrake(run));
    const to = getNode(run.state.sector, run.state.locationId)!.links[0]!;
    expect(run.apply({ type: 'jump', toId: to })).toEqual({ ok: false, reason: { key: 'reject.onSurface' } });
    expect(run.apply({ type: 'service' })).toEqual({ ok: false, reason: { key: 'reject.onSurface' } });
    expect(run.apply({ type: 'evade' })).toEqual({ ok: false, reason: { key: 'reject.onSurface' } });
    expect(run.apply({ type: 'eva-enter' })).toEqual({ ok: false, reason: { key: 'reject.notOutside' } });
    run.state.ship.systems.nav.healthPct = 50;
    run.apply({ type: 'eva-exit' });
    expect(run.apply({ type: 'eva-exit' })).toEqual({ ok: false, reason: { key: 'reject.alreadyOutside' } });
    expect(run.apply({ type: 'repair-system', systemId: 'nav', seconds: 0.1 })).toEqual({ ok: false, reason: { key: 'reject.crewOutside' } });
    expect(run.apply({ type: 'toggle-system', systemId: 'nav', enabled: false })).toEqual({ ok: false, reason: { key: 'reject.crewOutside' } });
    expect(run.apply({ type: 'take-off' })).toEqual({ ok: false, reason: { key: 'reject.crewOutside' } });
  });
});

describe('salida (EVA) y oxígeno del traje', () => {
  it('salir llena traje y jetpack; el O₂ baja a ritmo constante (~3 min) y avisa en bajo y crítico', () => {
    const run = landed(surfaceCatalog());
    expect(run.apply({ type: 'eva-exit' })).toEqual({ ok: true });
    const m = run.state.crew[0]!;
    expect(m).toMatchObject({ location: 'eva', suitO2Pct: 100, jetpackPct: 100 });
    const events = advance(run, 60);
    expect(m.suitO2Pct).toBeCloseTo(100 - 60 * rules.suit.o2DrainPctPerS, 5);
    expect(100 / rules.suit.o2DrainPctPerS).toBeGreaterThan(150);
    expect(100 / rules.suit.o2DrainPctPerS).toBeLessThan(210);
    expect(events.find((e) => e.type === 'airlock')).toMatchObject({ subtype: 'exit', message: { key: 'event.airlock.exit' } });
    const later = advance(run, TANK_S - 60 - 2);
    expect(later.filter((e) => e.message.key === 'event.suitO2.low').map((e) => e.subtype)).toEqual(['low']);
    expect(later.filter((e) => e.message.key === 'event.suitO2.critical').map((e) => e.subtype)).toEqual(['critical']);
  });

  it('volver a salir no es gratis: el relleno del traje se cobra del O₂ de la nave, en proporción', () => {
    const run = landed(surfaceCatalog());
    run.apply({ type: 'toggle-system', systemId: 'lifeSupport', enabled: false }); // sin regeneración: se ve el coste
    run.apply({ type: 'eva-exit' });
    const m = run.state.crew[0]!;
    advance(run, 40);
    const spent = 100 - m.suitO2Pct;
    run.apply({ type: 'eva-enter' });
    const ship = run.state.ship.oxygenPct;
    run.apply({ type: 'eva-exit' });
    expect(m.suitO2Pct).toBeCloseTo(100, 6);
    const cycle = rules.suit.airlockCycleShipO2Pct ?? 0;
    expect(cycle).toBeGreaterThan(0); // trocear en muchas salidas cortas también cuesta
    expect(ship - run.state.ship.oxygenPct).toBeCloseTo(cycle + (spent * rules.suit.refillShipO2PctPerTank) / 100, 6);
    expect(suitRefill(rules, 100 - spent, ship).shipO2Cost).toBeCloseTo(ship - run.state.ship.oxygenPct, 6);
    // Un tanque entero cuesta del orden de un 20-25 % del O₂ de la nave: un aterrizaje da para 2-3 salidas.
    expect(rules.suit.refillShipO2PctPerTank).toBeGreaterThanOrEqual(20);
    expect(rules.suit.refillShipO2PctPerTank).toBeLessThanOrEqual(25);
  });

  it('en tierra el soporte vital no repone el O₂ gastado en trajes; en vuelo, sí', () => {
    const ship = catalog.ships[0]!;
    const surplus = rules.shipO2!.surfaceSurplusRegenMult;
    expect(surplus).toBeLessThanOrEqual(0.1);
    const run = landed(surfaceCatalog());
    run.apply({ type: 'eva-exit' });
    advance(run, 60);
    run.apply({ type: 'eva-enter' });
    run.apply({ type: 'eva-exit' }); // relleno: la nave baja
    const afterRefill = run.state.ship.oxygenPct;
    expect(afterRefill).toBeLessThan(100);
    // Con el tripulante fuera solo se recupera una fracción mínima del excedente.
    advance(run, 20);
    expect(run.state.ship.oxygenPct).toBeCloseTo(afterRefill + 20 * surplus * ship.o2RegenPctPerS, 5);
    // A bordo, el soporte vital cubre su consumo y poco más.
    const m = run.state.crew[0]!;
    walkTo(run, 0, 0);
    run.apply({ type: 'eva-enter' });
    const aboard = run.state.ship.oxygenPct;
    advance(run, 20);
    expect(run.state.ship.oxygenPct).toBeCloseTo(aboard + 20 * surplus * (ship.o2RegenPctPerS - ship.crewO2UsePctPerS), 5);
    expect(m.location).toBe('ship');
    // Tras despegar se recupera como siempre (en vuelo, atracada o en tránsito).
    expect(run.apply({ type: 'take-off' })).toEqual({ ok: true });
    const docked = run.state.ship.oxygenPct;
    advance(run, 10);
    expect(run.state.ship.oxygenPct).toBeCloseTo(Math.min(100, docked + 10 * (ship.o2RegenPctPerS - ship.crewO2UsePctPerS)), 5);
  });

  it('si a la nave le queda poco O₂, el traje sale a medias (no se bloquea la salida ni se vacía la nave)', () => {
    const run = landed(surfaceCatalog());
    run.apply({ type: 'eva-exit' });
    advance(run, 100);
    run.apply({ type: 'eva-enter' });
    const m = run.state.crew[0]!;
    const before = m.suitO2Pct;
    const reserve = rules.suit.refillMinShipO2Pct;
    const cycle = rules.suit.airlockCycleShipO2Pct ?? 0;
    run.state.ship.oxygenPct = reserve + cycle + 2;
    run.takeEvents();
    expect(run.apply({ type: 'eva-exit' })).toEqual({ ok: true });
    const expected = suitRefill(rules, before, reserve + cycle + 2);
    expect(m.suitO2Pct).toBeCloseTo(expected.suitO2Pct, 6);
    expect(m.suitO2Pct).toBeLessThan(100);
    expect(m.suitO2Pct).toBeCloseTo(before + (2 * 100) / rules.suit.refillShipO2PctPerTank, 6);
    expect(run.state.ship.oxygenPct).toBeCloseTo(reserve, 6);
    const exit = run.takeEvents().find((e) => e.type === 'airlock')!;
    expect(exit).toMatchObject({ subtype: 'exit', message: { key: 'event.airlock.exitPartial', params: { o2: Math.floor(m.suitO2Pct) } } });
  });

  it('sin O₂ el tripulante muere, pierde lo que lleva y, si era el último, se pierde la partida', () => {
    const run = landed(surfaceCatalog());
    run.apply({ type: 'eva-exit' });
    const d = run.state.surface!.deposits[0]!;
    walkTo(run, d.x, d.z);
    collectAll(run, d.id, 1);
    expect(run.state.crew[0]!.carriedKg).toBeGreaterThan(0);
    const events = advance(run, TANK_S + 2);
    expect(events.find((e) => e.message.key === 'event.crewDead.oxygen')?.subtype).toBe('oxygen');
    expect(run.state.crew[0]).toMatchObject({ alive: false, deathCause: 'oxygen', carriedKg: 0 });
    expect(run.state.phase).toBe('lost');
    expect(run.state.lossReason).toBe('crew');
    expect(run.state.stats.crewLost).toBe(1);
    expect(run.state.stats.materialsValue).toBe(0);
  });

  it('con dos tripulantes, morir uno no termina la partida', () => {
    const cat = surfaceCatalog();
    const probe = dockedAtLandable(cat);
    const run = createRun({ seed: probe.state.seed, catalog: cat, crewSize: 2 });
    const to = probe.state.locationId;
    run.apply({ type: 'jump', toId: to });
    for (let t = 0; t < 600 && run.state.phase === 'transit'; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
    run.apply({ type: 'land' });
    descend(run, refBrake(run));
    run.apply({ type: 'eva-exit', crewId: 1 });
    advance(run, TANK_S + 2);
    expect(run.state.crew.map((c) => c.alive)).toEqual([false, true]);
    expect(run.state.phase).toBe('surface');
    expect(run.apply({ type: 'take-off' })).toEqual({ ok: true });
  });

  it('volver por la esclusa exige estar junto a ella', () => {
    const run = landed(surfaceCatalog());
    run.apply({ type: 'eva-exit' });
    walkTo(run, 20, 0);
    expect(run.apply({ type: 'eva-enter' })).toEqual({ ok: false, reason: { key: 'reject.tooFar' } });
    walkTo(run, 1, 0);
    run.takeEvents();
    expect(run.apply({ type: 'eva-enter' })).toEqual({ ok: true });
    expect(run.takeEvents().find((e) => e.type === 'airlock')?.subtype).toBe('enter');
    expect(run.state.crew[0]!.location).toBe('ship');
    expect(run.state.stats.evas).toBe(1);
    expect(run.state.stats.evaTimeS).toBeGreaterThan(5);
  });
});

describe('posición, jetpack y caídas', () => {
  it('antitrampas: set-position no mueve más de lo que permite la velocidad máxima', () => {
    const run = landed(surfaceCatalog());
    run.apply({ type: 'eva-exit' });
    run.apply({ type: 'set-position', x: 80, z: 0, grounded: true });
    const m = run.state.crew[0]!;
    expect(m.x).toBeCloseTo(rules.suit.maxMoveSpeedMps * 1, 5); // tope acumulado: 1 s
    run.apply({ type: 'set-position', x: 80, z: 0, grounded: true });
    expect(m.x).toBeCloseTo(rules.suit.maxMoveSpeedMps, 5);
    run.step(1);
    run.apply({ type: 'set-position', x: 80, z: 0, grounded: true });
    expect(m.x).toBeCloseTo(rules.suit.maxMoveSpeedMps * 2, 5);
    // No se sale del área explorable.
    for (let i = 0; i < 40; i++) {
      run.step(1);
      run.apply({ type: 'set-position', x: 500, z: 0, grounded: true });
    }
    expect(Math.hypot(m.x, m.z)).toBeLessThanOrEqual(TEST_WORLD.radiusM + 1e-6);
    expect(run.apply({ type: 'set-position', x: Number.NaN, z: 0, grounded: true })).toEqual({ ok: false, reason: { key: 'reject.invalid' } });
  });

  it('el jetpack gasta mientras se usa, se rechaza vacío y solo recarga en el suelo', () => {
    const run = landed(surfaceCatalog());
    run.apply({ type: 'eva-exit' });
    const m = run.state.crew[0]!;
    run.apply({ type: 'jetpack', seconds: 999 });
    expect(m.jetpackPct).toBeCloseTo(100 - MAX_WORK_SECONDS * rules.jetpack.drainPctPerS, 5);
    for (let i = 0; i < 100; i++) run.apply({ type: 'jetpack', seconds: MAX_WORK_SECONDS });
    expect(m.jetpackPct).toBe(0);
    expect(run.apply({ type: 'jetpack', seconds: 0.1 })).toEqual({ ok: false, reason: { key: 'reject.jetpackEmpty' } });
    run.apply({ type: 'set-position', x: 0, z: 0, grounded: false });
    advance(run, 5);
    expect(m.jetpackPct).toBe(0);
    run.apply({ type: 'set-position', x: 0, z: 0, grounded: true });
    advance(run, 5);
    expect(m.jetpackPct).toBeCloseTo(5 * rules.jetpack.rechargePctPerS, 5);
  });

  it('caídas: suaves no pasan nada, fuertes dañan el tanque de O₂ y por encima del umbral matan', () => {
    const run = landed(surfaceCatalog());
    run.apply({ type: 'eva-exit' });
    const m = run.state.crew[0]!;
    run.apply({ type: 'fall-impact', speedMps: rules.falls.harmlessMps });
    expect(m.suitO2Pct).toBe(100);
    run.apply({ type: 'fall-impact', speedMps: rules.falls.harmlessMps + 4 });
    expect(m.suitO2Pct).toBeCloseTo(100 - 4 * rules.falls.o2LossPctPerMps, 5);
    expect(run.takeEvents().some((e) => e.type === 'suit-damaged')).toBe(true);
    run.apply({ type: 'fall-impact', speedMps: rules.falls.lethalMps });
    expect(m).toMatchObject({ alive: false, deathCause: 'fall' });
    expect(run.state.lossReason).toBe('crew');
    expect(run.takeEvents().some((e) => e.message.key === 'event.crewDead.fall')).toBe(true);
  });
});

describe('tormentas', () => {
  const stormy = () =>
    surfaceCatalog((w) => {
      w.storms = { meanIntervalS: 30, warnS: 25, durationS: { min: 20, max: 20 }, intensity: { min: 1, max: 1 }, o2DrainPctPerS: 0.5 };
    });

  it('se avisan con antelación, empiezan y terminan; el estado dice cuándo y con qué intensidad', () => {
    const run = landed(stormy());
    const s = run.state.surface!;
    const first = s.storms[0]!;
    expect(first.startS).toBeGreaterThanOrEqual(25);
    expect(s.storm.nextInS).toBeCloseTo(first.startS - s.elapsedS, 0);
    const events = advance(run, first.startS - 25 - s.elapsedS + 0.2);
    const warning = events.find((e) => e.type === 'storm-warning');
    expect(warning?.message.params?.seconds).toBeGreaterThanOrEqual(24);
    expect(s.storm.active).toBe(false);
    expect(advance(run, 26).some((e) => e.type === 'storm-start')).toBe(true);
    expect(s.storm).toMatchObject({ active: true, intensity: 1 });
    expect(s.storm.endsInS).toBeGreaterThan(0);
    expect(advance(run, 21).some((e) => e.type === 'storm-end')).toBe(true);
    expect(s.storm.active).toBe(false);
  });

  it('la primera tormenta respeta la calma mínima tras tocar tierra (firstStartMinS)', () => {
    const cat = surfaceCatalog((w) => {
      w.storms = { meanIntervalS: 5, warnS: 25, durationS: { min: 20, max: 20 }, intensity: { min: 1, max: 1 }, o2DrainPctPerS: 1, firstStartMinS: 90 };
    });
    for (let seed = 1; seed <= 6; seed++) {
      const run = landed(cat, seed * 7);
      const storms = run.state.surface!.storms;
      expect(storms[0]!.startS).toBeGreaterThanOrEqual(90);
      expect(storms[1]!.startS).toBeGreaterThan(storms[0]!.endS);
    }
    // En el catálogo, toda tormenta deja >= 60 s sin aviso y drena del orden de 0,9-1 %/s a intensidad 1.
    for (const w of catalog.surface!.worlds.filter((x) => x.storms)) {
      expect((w.storms!.firstStartMinS ?? 0) - w.storms!.warnS, w.id).toBeGreaterThanOrEqual(60);
      expect(w.storms!.o2DrainPctPerS, w.id).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('estar fuera durante la tormenta gasta O₂ extra', () => {
    const run = landed(stormy());
    const s = run.state.surface!;
    advance(run, s.storms[0]!.startS - s.elapsedS + 0.5);
    expect(s.storm.active).toBe(true);
    run.apply({ type: 'eva-exit' });
    advance(run, 10);
    expect(run.state.crew[0]!.suitO2Pct).toBeCloseTo(100 - 10 * (rules.suit.o2DrainPctPerS + 0.5), 5);
  });
});

describe('terreno inestable', () => {
  const unstable = () => surfaceCatalog((w) => { w.unstable = { zones: { min: 1, max: 1 }, radiusM: { min: 6, max: 6 }, pitDepthM: 10 }; });

  it('pisarla avisa y, si sigues encima, se hunde; salir a tiempo lo cancela', () => {
    const run = landed(unstable());
    const zone = run.state.surface!.zones[0]!;
    run.apply({ type: 'eva-exit' });
    walkTo(run, zone.x + zone.radiusM + 2, zone.z);
    let events = walkTo(run, zone.x + zone.radiusM - 1, zone.z);
    events.push(...advance(run, 0.5));
    expect(events.some((e) => e.type === 'terrain-warning')).toBe(true);
    expect(zone.crackingS).toBeGreaterThan(0);
    expect(zone.pressed).toBe(true);
    walkTo(run, zone.x + zone.radiusM + 2, zone.z, 8);
    expect(zone.pressed).toBe(false);
    expect(zone.collapsed).toBe(false);
    // Salir no lo reinicia: el agrietado se recupera poco a poco.
    const left = zone.crackingS;
    expect(left).toBeGreaterThan(0);
    advance(run, 0.5);
    expect(zone.crackingS).toBeCloseTo(Math.max(0, left - 0.5 * rules.terrain.decayPerS), 6);
    advance(run, rules.terrain.collapseS / rules.terrain.decayPerS + 1);
    expect(zone.crackingS).toBe(0);
    // Volando con el jetpack no pesa sobre el suelo.
    walkTo(run, zone.x, zone.z, 8, false);
    advance(run, 3);
    expect(zone.collapsed).toBe(false);
    run.apply({ type: 'set-position', x: zone.x, z: zone.z, grounded: true });
    events = advance(run, rules.terrain.collapseS + 0.2);
    expect(events.some((e) => e.type === 'terrain-collapsed')).toBe(true);
    expect(zone.collapsed).toBe(true);
  });
});

describe('terreno inestable: saltar no lo anula', () => {
  const unstableDeposit = () =>
    surfaceCatalog((w) => { w.unstable = { zones: { min: 1, max: 1 }, radiusM: { min: 6, max: 6 }, pitDepthM: 10 }; });

  it('pisar y saltar a ratos acumula agrietado hasta que se hunde', () => {
    const run = landed(unstableDeposit());
    const zone = run.state.surface!.zones[0]!;
    run.apply({ type: 'eva-exit' });
    walkTo(run, zone.x, zone.z, 8, false);
    const events: RunEvent[] = [];
    // 0,3 s en el suelo y 0,3 s en el aire, una y otra vez.
    for (let i = 0; i < 40 && !zone.collapsed; i++) {
      run.apply({ type: 'set-position', x: zone.x, z: zone.z, grounded: i % 2 === 0 });
      events.push(...advance(run, 0.3));
    }
    expect(zone.collapsed).toBe(true);
    expect(events.filter((e) => e.type === 'terrain-warning').length).toBeGreaterThanOrEqual(2);
  });

  it('recoger exige estar en el suelo', () => {
    const run = landed(surfaceCatalog());
    run.apply({ type: 'eva-exit' });
    const d = run.state.surface!.deposits[0]!;
    walkTo(run, d.x, d.z, 4, false);
    expect(run.apply({ type: 'collect', depositId: d.id, seconds: 0.1 })).toEqual({ ok: false, reason: { key: 'reject.collectAirborne' } });
    run.apply({ type: 'set-position', x: d.x, z: d.z, grounded: true });
    expect(run.apply({ type: 'collect', depositId: d.id, seconds: 0.1 })).toEqual({ ok: true });
  });
});

describe('racha: cada unidad que llevas encima revaloriza la siguiente', () => {
  it('el valor sube con lo que se lleva, con tope; se expone el multiplicador y se consolida al guardar', () => {
    expect(streakMultiplier(rules, 0)).toBe(1);
    expect(streakMultiplier(rules, 1)).toBeCloseTo(1 + rules.streak.bonusPerUnit, 9);
    expect(streakMultiplier(rules, 1000)).toBeCloseTo(1 + rules.streak.maxBonus, 9);

    const run = landed(surfaceCatalog((w) => { w.materials = [{ materialId: 'crystal', weight: 1, units: { min: 4, max: 4 }, minDistanceFrac: 0, dangerWeightMult: 1 }]; }));
    run.apply({ type: 'eva-exit' });
    const m = run.state.crew[0]!;
    expect(m.streakMult).toBe(1);
    const d = run.state.surface!.deposits[0]!;
    walkTo(run, d.x, d.z);
    const values: number[] = [];
    for (let k = 0; k < 4; k++) {
      const before = m.carriedValue;
      collectAll(run, d.id, 1);
      values.push(m.carriedValue - before);
      expect(m.carriedUnits).toBe(k + 1);
      expect(m.streakUnits).toBe(k + 1);
      expect(m.streakMult).toBeCloseTo(streakMultiplier(rules, k + 1), 9);
    }
    expect(values).toEqual([0, 1, 2, 3].map((k) => Math.round(d.valuePerUnit * streakMultiplier(rules, k))));
    expect(values[3]!).toBeGreaterThan(values[0]!);
    walkTo(run, 0, 0);
    run.apply({ type: 'eva-enter' });
    expect(run.state.stats.materialsValue).toBe(values.reduce((a, b) => a + b, 0));
    expect(m).toMatchObject({ streakMult: 1, carriedUnits: 0, streakUnits: 0 });
    // La racha empieza de cero en la siguiente salida.
    run.apply({ type: 'eva-exit' });
    expect(m.streakMult).toBe(1);
  });

  it('lo común no suma racha ni se revaloriza', () => {
    const run = landed(surfaceCatalog());
    run.apply({ type: 'eva-exit' });
    const m = run.state.crew[0]!;
    const d = run.state.surface!.deposits[0]!; // hielo
    expect(getMaterial(d.materialId).streak ?? false).toBe(false);
    walkTo(run, d.x, d.z);
    collectAll(run, d.id, 2);
    expect(m).toMatchObject({ carriedUnits: 2, streakUnits: 0, streakMult: 1, carriedValue: 2 * d.valuePerUnit });
  });

  it('en el catálogo solo lo raro suma racha y la cuarta pieza rara vale claramente más que la primera', () => {
    const streaky = catalog.surface!.materials.filter((x) => x.streak).map((x) => x.id).sort();
    expect(streaky).toEqual(['crystal', 'sample']);
    expect(streakMultiplier(rules, 3)).toBeGreaterThanOrEqual(1.6);
  });

  it('morir pierde la racha y lo que se lleva', () => {
    const run = landed(surfaceCatalog((w) => { w.materials = [{ materialId: 'crystal', weight: 1, units: { min: 3, max: 3 }, minDistanceFrac: 0, dangerWeightMult: 1 }]; }));
    run.apply({ type: 'eva-exit' });
    const d = run.state.surface!.deposits[0]!;
    walkTo(run, d.x, d.z);
    collectAll(run, d.id, 2);
    expect(run.state.crew[0]!.streakMult).toBeGreaterThan(1);
    run.apply({ type: 'fall-impact', speedMps: rules.falls.lethalMps });
    expect(run.state.crew[0]).toMatchObject({ alive: false, streakMult: 1, streakUnits: 0, carriedUnits: 0, carriedValue: 0 });
    expect(run.state.stats.materialsValue).toBe(0);
  });
});

describe('vetas, carga y bodega', () => {
  it('recoger exige alcance, lleva su tiempo por unidad y está limitado por la masa que se puede cargar', () => {
    const run = landed(surfaceCatalog());
    run.apply({ type: 'eva-exit' });
    const d = run.state.surface!.deposits[0]!;
    expect(run.apply({ type: 'collect', depositId: d.id, seconds: 0.1 })).toEqual({ ok: false, reason: { key: 'reject.tooFar' } });
    expect(run.apply({ type: 'collect', depositId: 999, seconds: 0.1 })).toEqual({ ok: false, reason: { key: 'reject.noDeposit' } });
    walkTo(run, d.x, d.z);
    const ice = catalog.surface!.materials.find((m) => m.id === 'ice')!;
    const needed = Math.round(ice.collectS / FIXED_STEP_S);
    for (let i = 0; i < needed - 1; i++) run.apply({ type: 'collect', depositId: d.id, seconds: FIXED_STEP_S });
    expect(d.units).toBe(3);
    run.apply({ type: 'collect', depositId: d.id, seconds: FIXED_STEP_S });
    expect(d.units).toBe(2);
    expect(run.state.crew[0]!.carried).toEqual({ ice: 1 });
    expect(run.takeEvents().some((e) => e.type === 'material-collected')).toBe(true);
    // Capacidad por masa: no se puede pasar del límite.
    const maxUnits = Math.floor(rules.suit.carryCapacityKg / ice.massKg);
    for (const dep of run.state.surface!.deposits) {
      walkTo(run, dep.x, dep.z, 10);
      collectAll(run, dep.id);
      if (run.state.crew[0]!.carriedKg + ice.massKg > rules.suit.carryCapacityKg) break;
    }
    expect(run.state.crew[0]!.carried.ice).toBe(maxUnits);
    const other = run.state.surface!.deposits.find((x) => x.units > 0 && Math.hypot(x.x - run.state.crew[0]!.x, x.z - run.state.crew[0]!.z) <= rules.suit.collectRangeM)
      ?? run.state.surface!.deposits.find((x) => x.units > 0)!;
    walkTo(run, other.x, other.z, 10);
    expect(run.apply({ type: 'collect', depositId: other.id, seconds: 0.1 })).toEqual({ ok: false, reason: { key: 'reject.overCapacity' } });
  });

  it('al entrar, la carga pasa a la nave: suministros si caben, el resto a la bodega; la puntuación suma su valor', () => {
    const cat = surfaceCatalog();
    const run = landed(cat);
    run.apply({ type: 'eva-exit' });
    const d = run.state.surface!.deposits[0]!;
    walkTo(run, d.x, d.z);
    collectAll(run, d.id);
    const carried = run.state.crew[0]!.carriedValue;
    walkTo(run, 0, 0);
    const fuel = run.state.ship.fuel;
    const iceFuel = catalog.surface!.materials.find((x) => x.id === 'ice')!.yields!.fuel!;
    const room = Math.floor((catalog.ships[0]!.fuelCapacity - fuel) / iceFuel);
    run.apply({ type: 'eva-enter' });
    const events = run.takeEvents();
    expect(events.find((e) => e.message.key === 'event.cargoStored')?.message.params).toMatchObject({ units: 3, value: Math.round(carried) });
    const processed = Math.min(3, room);
    expect(run.state.ship.fuel).toBeCloseTo(fuel + processed * iceFuel, 5);
    expect(events.find((e) => e.message.key === 'event.cargoStored')?.subtype).toBe('stored');
    expect(run.state.ship.cargo.ice ?? 0).toBe(3 - processed);
    expect(run.state.stats.materialsStored).toBe(3);
    expect(run.state.stats.materialsValue).toBe(carried);
    expect(run.state.score).toBe(computeScore(run.state.stats));
    expect(run.state.crew[0]!.carriedKg).toBe(0);
  });

  it('los raros solo dan puntos y se quedan en la bodega', () => {
    const run = landed(surfaceCatalog((w) => { w.materials = [{ materialId: 'crystal', weight: 1, units: { min: 2, max: 2 }, minDistanceFrac: 0, dangerWeightMult: 1 }]; }));
    run.apply({ type: 'eva-exit' });
    const d = run.state.surface!.deposits[0]!;
    walkTo(run, d.x, d.z);
    collectAll(run, d.id);
    walkTo(run, 0, 0);
    const fuel = run.state.ship.fuel;
    run.apply({ type: 'eva-enter' });
    expect(run.state.ship.cargo).toEqual({ crystal: 2 });
    expect(run.state.ship.fuel).toBe(fuel);
    expect(run.state.surface!.loadedKg).toBeCloseTo(2 * catalog.surface!.materials.find((m) => m.id === 'crystal')!.massKg, 6);
  });
});

describe('despegue', () => {
  const heavyCargo = () =>
    surfaceCatalog((w) => {
      w.materials = [{ materialId: 'ore', weight: 1, units: { min: 3, max: 3 }, minDistanceFrac: 0, dangerWeightMult: 1 }];
    }, (raw) => {
      raw.ships[0]!.startSpares = raw.ships[0]!.maxSpares; // la mena no se puede convertir en repuestos
      raw.surface!.rules.takeOff.massRefKg = 5;
    });

  it('cuesta combustible según la gravedad y lo cargado en este mundo; vuelve a atracar en el mismo nodo', () => {
    const run = landed(surfaceCatalog());
    const node = run.state.locationId;
    const est = run.estimateTakeOff()!;
    expect(est.fuel).toBeCloseTo(takeOffFuel(TEST_WORLD, rules, 0), 6);
    const fuel = run.state.ship.fuel;
    expect(run.apply({ type: 'take-off' })).toEqual({ ok: true });
    expect(run.state.ship.fuel).toBeCloseTo(fuel - est.fuel, 6);
    expect(run.state.phase).toBe('docked');
    expect(run.state.locationId).toBe(node);
    expect(run.state.surface).toBeNull();
    expect(run.takeEvents().some((e) => e.type === 'take-off')).toBe(true);
    const heavier = { ...TEST_WORLD, gravityMps2: 12 };
    expect(takeOffFuel(heavier, rules, 0)).toBeGreaterThan(takeOffFuel(TEST_WORLD, rules, 0));
    expect(takeOffFuel(TEST_WORLD, rules, 30)).toBeGreaterThan(takeOffFuel(TEST_WORLD, rules, 0));
  });

  it('si la carga pesa demasiado se rechaza; soltarla lo permite y resta sus puntos', () => {
    const run = landed(heavyCargo());
    run.apply({ type: 'eva-exit' });
    const d = run.state.surface!.deposits[0]!;
    walkTo(run, d.x, d.z);
    collectAll(run, d.id);
    walkTo(run, 0, 0);
    run.apply({ type: 'eva-enter' });
    const est = run.estimateTakeOff()!;
    expect(est.fuel).toBeGreaterThan(est.fuelEmpty);
    run.state.ship.fuel = (est.fuel + est.fuelEmpty) / 2;
    expect(run.apply({ type: 'take-off' })).toEqual({ ok: false, reason: { key: 'reject.takeOffHeavy', params: { fuel: Math.ceil(est.fuel) } } });
    expect(run.state.stats.materialsValue).toBeGreaterThan(0);
    expect(run.apply({ type: 'jettison' })).toEqual({ ok: true });
    expect(run.takeEvents().some((e) => e.type === 'jettison')).toBe(true);
    expect(run.state.ship.cargo).toEqual({});
    expect(run.state.stats.materialsValue).toBe(0);
    expect(run.apply({ type: 'jettison' })).toEqual({ ok: false, reason: { key: 'reject.nothingToJettison' } });
    expect(run.apply({ type: 'take-off' })).toEqual({ ok: true });
  });

  it('si ni con la bodega vacía alcanza y no queda hielo, la nave queda varada', () => {
    const run = landed(surfaceCatalog((w) => { w.materials = [{ materialId: 'crystal', weight: 1, units: { min: 1, max: 1 }, minDistanceFrac: 0, dangerWeightMult: 1 }]; }));
    run.state.ship.fuel = run.estimateTakeOff()!.fuelEmpty - 0.5;
    advance(run, 0.2);
    expect(run.state.phase).toBe('lost');
    expect(run.state.lossReason).toBe('stranded');
  });

  it('con hielo a mano no hay varada: se puede ir a por combustible', () => {
    const run = landed(surfaceCatalog());
    const need = run.estimateTakeOff()!.fuelEmpty;
    run.state.ship.fuel = need - 0.5;
    advance(run, 0.2);
    expect(run.state.phase).toBe('surface');
    expect(run.apply({ type: 'take-off' })).toEqual({ ok: false, reason: { key: 'reject.takeOffFuel', params: { fuel: Math.ceil(need) } } });
    run.apply({ type: 'eva-exit' });
    const d = run.state.surface!.deposits[0]!;
    walkTo(run, d.x, d.z);
    collectAll(run, d.id, 1);
    walkTo(run, 0, 0);
    run.apply({ type: 'eva-enter' });
    expect(run.apply({ type: 'take-off' })).toEqual({ ok: true });
  });
});

describe('la nave sigue viva en tierra', () => {
  it('el desgaste sigue corriendo, multiplicado por el factor del mundo', () => {
    const incidents = (mult: number): number => {
      const run = landed(surfaceCatalog((w) => { w.shipWearMult = mult; }));
      // Desgaste solo en tierra: se activa tras aterrizar (el catálogo es el objeto vivo de la partida).
      run.catalog.hazards.wear.chancePerS = 0.2;
      expect(run.state.incidents).toHaveLength(0);
      const events = advance(run, 120);
      return events.filter((e) => e.type === 'incident').length;
    };
    expect(incidents(0)).toBe(0);
    expect(incidents(1)).toBeGreaterThan(0);
  });

  it('con el tripulante fuera la nave no gasta su O₂ en él', () => {
    const run = landed(surfaceCatalog());
    run.apply({ type: 'toggle-system', systemId: 'lifeSupport', enabled: false });
    run.apply({ type: 'eva-exit' });
    const o2 = run.state.ship.oxygenPct;
    advance(run, 20);
    expect(run.state.ship.oxygenPct).toBe(o2);
  });
});

describe('determinismo en superficie', () => {
  function scripted(chunk: number): unknown {
    const cat = surfaceCatalog((w) => {
      w.storms = { meanIntervalS: 20, warnS: 20, durationS: { min: 15, max: 25 }, intensity: { min: 0.5, max: 1 }, o2DrainPctPerS: 0.4 };
      w.unstable = { zones: { min: 2, max: 3 }, radiusM: { min: 5, max: 7 }, pitDepthM: 10 };
      w.shipWearMult = 1;
    });
    const run = dockedAtLandable(cat, 5);
    run.catalog.hazards.wear.chancePerS = 0.02; // desgaste solo desde aquí (catálogo vivo de la partida)
    run.apply({ type: 'land' });
    advance(run, 4, chunk);
    run.apply({ type: 'set-descent-brake', on: true });
    advance(run, 6, chunk);
    run.apply({ type: 'set-descent-brake', on: false });
    for (let i = 0; i < 400 && run.state.phase === 'landing'; i++) advance(run, 0.5, chunk);
    run.apply({ type: 'eva-exit' });
    advance(run, 1, chunk);
    // Un salto de posición enorme: el antitrampas no depende de cómo se trocee el tiempo.
    run.apply({ type: 'set-position', x: 60, z: 20, grounded: true });
    advance(run, 2.5, chunk);
    run.apply({ type: 'set-position', x: 60, z: 20, grounded: true });
    run.apply({ type: 'jetpack', seconds: 0.3 });
    advance(run, 40, chunk);
    return JSON.parse(JSON.stringify(run.snapshot()));
  }

  it('el resultado no depende de cómo se trocee step(), también en descenso y superficie', () => {
    const reference = scripted(FIXED_STEP_S);
    expect(scripted(0.5)).toEqual(reference);
    expect(scripted(0.25)).toEqual(reference);
    expect((reference as { phase: string; lossReason: string }).lossReason).toBe(null);
  });

  it('el estado de superficie es JSON puro', () => {
    const run = landed(surfaceCatalog());
    run.apply({ type: 'eva-exit' });
    const snap = run.snapshot();
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });
});
