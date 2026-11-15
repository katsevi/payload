/**
 * Fase 3 · economía y mejoras (ADR 0014): créditos, venta de carga, tienda de suministros, ayuda de
 * emergencia, mejoras (nave efectiva), oferta determinista por estación y masa → combustible.
 * Cada regla se aísla con un catálogo parcheado (sin peligros en ruta ni desgaste).
 */
import { describe, expect, it } from 'vitest';
import {
  cargoFuelMult, catalog, computeScore, cruisePowerMarginKw, createRun, effectiveShip, effectiveSurfaceRules, FIXED_STEP_S, generateSector, getMaterial, getNode, getNodeKind,
  getShip, parseCatalog, priceOf, sectorPriceMults, sellUnitPrice, stationOffer, upgradePrice,
  type Catalog, type Run, type RunAction, type WorldDef,
} from '../index';

const ship = getShip(undefined);
const ALL_UPGRADES = catalog.upgrades!.map((u) => u.id);
/** Fase 8: las mejoras `crew` (cordura) se ofrecen aparte de `offer.size`; estos tests cuentan solo las de siempre. */
const CREW_UPGRADES = new Set(catalog.upgrades!.filter((u) => u.levels.some((l) => l.effects.some((e) => e.target === 'crew'))).map((u) => u.id));
const regularOnly = (ids: string[]) => ids.filter((id) => !CREW_UPGRADES.has(id));

/** Sin azar en ruta; `patch` para aislar la regla. */
function econCatalog(patch?: (raw: Catalog) => void): Catalog {
  const raw = JSON.parse(JSON.stringify(catalog)) as Catalog;
  for (const k of raw.nodeKinds) {
    k.hazardPerLy = { impact: 0, short: 0, fire: 0, leak: 0 };
    delete k.cache;
  }
  raw.hazards.wear.chancePerS = 0;
  patch?.(raw);
  return parseCatalog(raw);
}

/** Muchos créditos y todas las mejoras en todas las estaciones. */
const richCatalog = (patch?: (raw: Catalog) => void) =>
  econCatalog((raw) => {
    raw.economy!.startCredits = 5000;
    raw.economy!.offer.size = raw.upgrades!.length;
    patch?.(raw);
  });

function untilDocked(run: Run, maxS = 600): void {
  for (let t = 0; t < maxS && run.state.phase === 'transit'; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
}

/** Salta a un vecino que no sea estación y espera a atracar. */
function toNonStation(run: Run): string {
  const here = getNode(run.state.sector, run.state.locationId)!;
  const to = here.links.map((id) => getNode(run.state.sector, id)!).find((n) => n.kind !== 'station' && n.kind !== 'gate')!;
  expect(run.apply({ type: 'jump', toId: to.id })).toEqual({ ok: true });
  untilDocked(run);
  expect(run.state.phase).toBe('docked');
  return to.id;
}

/** Pone carga en la bodega para la prueba (en juego llega desde la superficie). */
function loadCargo(run: Run, cargo: Record<string, number>): void {
  Object.assign(run.state.ship.cargo, cargo);
}

describe('créditos y venta en la estación', () => {
  it('se empieza con los créditos del catálogo y la estación de salida tiene terminal', () => {
    const run = createRun({ seed: 1 });
    expect(run.state.credits).toBe(catalog.economy!.startCredits);
    expect(run.state.upgrades).toEqual({});
    const q = run.stationQuote()!;
    expect(q.nodeId).toBe(run.state.locationId);
    expect(q.credits).toBe(run.state.credits);
    expect(regularOnly(q.upgrades.map((u) => u.upgradeId)).length).toBe(catalog.economy!.offer.size);
  });

  it('vende una unidad, todo un material o toda la bodega al precio fijo por material', () => {
    const run = createRun({ seed: 2, catalog: econCatalog() });
    loadCargo(run, { crystal: 3, sample: 2, ore: 1 });
    const c0 = run.state.credits;
    const score0 = run.state.score;
    const price = (id: string) => sellUnitPrice(catalog.economy!, id, 1);
    expect(run.stationQuote()!.sellTotal).toBe(3 * price('crystal') + 2 * price('sample') + price('ore'));

    expect(run.apply({ type: 'sell', materialId: 'crystal', units: 1 })).toEqual({ ok: true });
    expect(run.state.ship.cargo.crystal).toBe(2);
    expect(run.state.credits).toBe(c0 + price('crystal'));
    const ev = run.takeEvents().find((e) => e.type === 'sale')!;
    expect(ev.message).toEqual({ key: 'event.sold', params: { units: 1, credits: price('crystal') } });

    expect(run.apply({ type: 'sell', materialId: 'sample' })).toEqual({ ok: true });
    expect(run.state.ship.cargo.sample).toBeUndefined();
    expect(run.apply({ type: 'sell' })).toEqual({ ok: true });
    expect(run.state.ship.cargo).toEqual({});
    expect(run.state.credits).toBe(c0 + 3 * price('crystal') + 2 * price('sample') + price('ore'));
    expect(run.state.stats.unitsSold).toBe(6);
    expect(run.state.stats.creditsEarned).toBe(run.state.credits - c0);
    // Lo vendido ya puntuó al guardarlo: vender no cambia la puntuación.
    expect(run.state.score).toBe(score0);
    expect(run.state.score).toBe(computeScore(run.state.stats));
    expect(run.apply({ type: 'sell' })).toEqual({ ok: false, reason: { key: 'reject.nothingToSell' } });
    expect(run.apply({ type: 'sell', materialId: 'crystal', units: 0 })).toEqual({ ok: false, reason: { key: 'reject.nothingToSell' } });
  });

  it('el multiplicador de sector sube los precios de venta y de compra', () => {
    const eco = catalog.economy!;
    expect(sectorPriceMults(eco, 1)).toEqual({ sell: 1, buy: 1 });
    expect(sectorPriceMults(eco, 3).sell).toBeCloseTo(1 + 2 * eco.sectorPriceMult.sellPerSector);
    expect(sellUnitPrice(eco, 'sample', 3)).toBeGreaterThan(sellUnitPrice(eco, 'sample', 1));
    const tank = catalog.upgrades!.find((u) => u.id === 'fuel-tank')!;
    expect(upgradePrice(tank, 1, eco, 3)!).toBeGreaterThan(upgradePrice(tank, 1, eco, 1)!);
    expect(upgradePrice(tank, 99, eco, 1)).toBeNull();
    // Un material sin precio no se vende (ni bloquea el resto).
    const cat = econCatalog((raw) => { delete raw.economy!.sellPrices.ice; });
    const run = createRun({ seed: 2, catalog: cat });
    loadCargo(run, { ice: 4 });
    expect(run.apply({ type: 'sell' })).toEqual({ ok: false, reason: { key: 'reject.nothingToSell' } });
  });

  it('solo se comercia atracado en una estación', () => {
    const run = createRun({ seed: 3, catalog: econCatalog() });
    loadCargo(run, { crystal: 1 });
    const station = run.state.locationId;
    const out = toNonStation(run);
    expect(run.stationQuote()).toBeNull();
    for (const a of [{ type: 'sell' }, { type: 'buy-supply', supply: 'fuel' }, { type: 'buy-upgrade', upgradeId: 'fuel-tank' }] as RunAction[]) {
      expect(run.apply(a)).toEqual({ ok: false, reason: { key: 'reject.notAtStation' } });
    }
    expect(run.apply({ type: 'service' })).toEqual({ ok: false, reason: { key: 'reject.noService' } });
    expect(run.apply({ type: 'jump', toId: station })).toEqual({ ok: true });
    expect(run.apply({ type: 'sell' })).toEqual({ ok: false, reason: { key: 'reject.inTransit' } });
    expect(run.stationQuote()).toBeNull();
    untilDocked(run);
    expect(run.state.locationId).not.toBe(out);
    expect(run.apply({ type: 'sell' })).toEqual({ ok: true });
  });
});

describe('tienda de suministros y ayuda de emergencia', () => {
  it('compra combustible, casco y repuestos con créditos (lo que quepa y se pueda pagar)', () => {
    const run = createRun({ seed: 4, catalog: econCatalog((raw) => { raw.economy!.startCredits = 1000; }) });
    const home = run.state.locationId;
    toNonStation(run);
    expect(run.apply({ type: 'jump', toId: home })).toEqual({ ok: true });
    untilDocked(run);
    const eco = catalog.economy!;
    const fuel0 = run.state.ship.fuel;
    const c0 = run.state.credits;
    expect(run.apply({ type: 'buy-supply', supply: 'fuel', amount: 5 })).toEqual({ ok: true });
    expect(run.state.ship.fuel).toBeCloseTo(fuel0 + 5);
    expect(run.state.credits).toBe(c0 - priceOf(5, eco.supplyPrices.fuel));
    expect(run.takeEvents().find((e) => e.type === 'purchase')!.subtype).toBe('fuel');
    // Sin `amount`: hasta llenar.
    expect(run.apply({ type: 'buy-supply', supply: 'fuel' })).toEqual({ ok: true });
    expect(run.state.ship.fuel).toBeCloseTo(ship.fuelCapacity);
    expect(run.apply({ type: 'buy-supply', supply: 'fuel' })).toEqual({ ok: false, reason: { key: 'reject.supplyFull' } });
    // Casco y repuestos.
    run.state.ship.hull = 50;
    run.state.ship.spares = 0;
    expect(run.apply({ type: 'buy-supply', supply: 'hull', amount: 10 })).toEqual({ ok: true });
    expect(run.state.ship.hull).toBe(60);
    expect(run.apply({ type: 'buy-supply', supply: 'spares', amount: 2 })).toEqual({ ok: true });
    expect(run.state.ship.spares).toBe(2);
    expect(run.state.stats.creditsSpent).toBe(c0 - run.state.credits);
  });

  it('sin créditos no se compra; con pocos se compra lo que alcance', () => {
    const run = createRun({ seed: 4, catalog: econCatalog((raw) => { raw.economy!.startCredits = 0; }) });
    run.state.ship.fuel = 50;
    expect(run.apply({ type: 'buy-supply', supply: 'fuel' })).toEqual({ ok: false, reason: { key: 'reject.noCredits', params: { credits: priceOf(1, catalog.economy!.supplyPrices.fuel) } } });
    run.state.credits = 7;
    expect(run.apply({ type: 'buy-supply', supply: 'fuel' })).toEqual({ ok: true });
    expect(run.state.credits).toBeGreaterThanOrEqual(0);
    expect(run.state.ship.fuel).toBeCloseTo(50 + Math.floor(7 / catalog.economy!.supplyPrices.fuel));
    expect(run.apply({ type: 'buy-upgrade', upgradeId: run.stationQuote()!.upgrades[0]!.upgradeId })).toMatchObject({ ok: false, reason: { key: 'reject.noCredits' } });
  });

  it('la ayuda de emergencia es gratis, sube hasta los mínimos del catálogo y se usa una vez por estación', () => {
    const run = createRun({ seed: 5, catalog: econCatalog((raw) => { raw.ships[0]!.startSpares = raw.ships[0]!.maxSpares; }) });
    expect(run.apply({ type: 'service' })).toEqual({ ok: false, reason: { key: 'reject.serviceNotNeeded' } });
    const e = catalog.economy!.emergency;
    run.state.ship.fuel = 10;
    run.state.ship.hull = 10;
    run.state.ship.spares = 0;
    const c0 = run.state.credits;
    expect(run.stationQuote()!.emergency.available).toBe(true);
    expect(run.apply({ type: 'service' })).toEqual({ ok: true });
    expect(run.state.ship.fuel).toBeCloseTo((ship.fuelCapacity * e.fuelPct) / 100);
    expect(run.state.ship.hull).toBeCloseTo((ship.hullMax * e.hullPct) / 100);
    expect(run.state.ship.spares).toBe(e.minSpares);
    expect(run.state.credits).toBe(c0);
    expect(run.stationQuote()!.emergency.available).toBe(false);
    expect(run.apply({ type: 'service' })).toEqual({ ok: false, reason: { key: 'reject.serviceUsed' } });
  });

  it('llegar a una estación sin créditos ni carga no es una muerte segura: no queda varada mientras la ayuda alcance', () => {
    const run = createRun({ seed: 6, catalog: econCatalog((raw) => { raw.economy!.startCredits = 0; }) });
    run.state.ship.fuel = 0;
    run.step(FIXED_STEP_S);
    expect(run.state.phase).toBe('docked');
    expect(run.apply({ type: 'service' })).toEqual({ ok: true });
    expect(run.state.ship.fuel).toBeGreaterThan(0);
    // Sin ayuda (ya usada), sin créditos ni carga y sin combustible: varada.
    run.state.ship.fuel = 0;
    run.step(FIXED_STEP_S);
    expect(run.state.lossReason).toBe('stranded');
  });

  it('con créditos (o carga que vender) para repostar tampoco queda varada', () => {
    const run = createRun({ seed: 6, catalog: econCatalog((raw) => { raw.economy!.startCredits = 0; raw.economy!.emergency.fuelPct = 0; }) });
    run.state.ship.fuel = 0;
    loadCargo(run, { sample: 4 });
    run.step(FIXED_STEP_S);
    expect(run.state.phase).toBe('docked');
    expect(run.apply({ type: 'sell' })).toEqual({ ok: true });
    expect(run.apply({ type: 'buy-supply', supply: 'fuel' })).toEqual({ ok: true });
    expect(run.state.ship.fuel).toBeGreaterThan(0);
  });
});

describe('mejoras', () => {
  it('el catálogo trae al menos depósito, escudos, reactor y tanque de O₂ del traje, con varios niveles y contrapartida', () => {
    for (const id of ['fuel-tank', 'shield-capacitor', 'reactor-heatsink', 'eva-o2-tank']) expect(ALL_UPGRADES).toContain(id);
    expect(catalog.upgrades!.filter((u) => u.levels.length >= 2).length).toBeGreaterThanOrEqual(4);
    // Cada nivel cuesta créditos y algo más: masa o algún efecto en contra.
    for (const u of catalog.upgrades!) {
      for (const l of u.levels) {
        expect(l.price).toBeGreaterThan(0);
        const drawback = l.massKg > 0 || l.effects.some((e) => (e.field.startsWith('systemDrawKw') && (e.add ?? 0) > 0) || ['o2DrainPctPerS', 'refillShipO2PctPerTank'].includes(e.field) && (e.mult ?? 1) > 1 || (e.field === 'carryCapacityKg' && (e.add ?? 0) < 0));
        expect(drawback, `${u.id} nivel sin contrapartida`).toBe(true);
      }
    }
  });

  it('parseCatalog rechaza un efecto sobre un campo no admitido y un precio de material desconocido', () => {
    const bad = JSON.parse(JSON.stringify(catalog)) as Catalog;
    bad.upgrades![0]!.levels[0]!.effects[0]!.field = 'name';
    expect(() => parseCatalog(bad)).toThrow(/no admitido/);
    const bad2 = JSON.parse(JSON.stringify(catalog)) as Catalog;
    bad2.economy!.sellPrices['unobtainium'] = 5;
    expect(() => parseCatalog(bad2)).toThrow(/material desconocido/);
    // Sin economía ni mejoras en el JSON se usan las del catálogo por defecto (no rompe catálogos antiguos).
    const old = JSON.parse(JSON.stringify(catalog)) as Catalog;
    delete old.economy;
    delete old.upgrades;
    expect(parseCatalog(old).economy).toEqual(catalog.economy);
  });

  it('effectiveShip aplica los niveles comprados (mult y luego add) y sin mejoras es la nave base', () => {
    expect(effectiveShip(ship, {}, catalog)).toEqual(ship);
    const s2 = effectiveShip(ship, { 'fuel-tank': 2, 'shield-capacitor': 1, 'reactor-heatsink': 1 }, catalog);
    expect(s2.fuelCapacity).toBe(ship.fuelCapacity + 50);
    expect(s2.shieldAbsorb).toBeCloseTo(ship.shieldAbsorb + 0.1);
    expect(s2.systemDrawKw.shields).toBe(ship.systemDrawKw.shields + 8);
    expect(s2.overloadReactorDamagePctPerS).toBeCloseTo(ship.overloadReactorDamagePctPerS * 0.5);
    expect(s2.reactorOutputKw).toBe(ship.reactorOutputKw + 10);
    // La base no se toca.
    expect(getShip(undefined)).toEqual(ship);
    const r = effectiveSurfaceRules(catalog.surface!.rules, { 'eva-o2-tank': 1 }, catalog);
    expect(r.suit.o2DrainPctPerS).toBeCloseTo(catalog.surface!.rules.suit.o2DrainPctPerS * 0.85);
  });

  it('buy-upgrade compra el siguiente nivel, cambia la nave efectiva y cobra; luego, al máximo', () => {
    const run = createRun({ seed: 7, catalog: richCatalog() });
    const c0 = run.state.credits;
    const tank = run.catalog.upgrades!.find((u) => u.id === 'fuel-tank')!;
    expect(run.apply({ type: 'buy-upgrade', upgradeId: 'fuel-tank' })).toEqual({ ok: true });
    expect(run.state.upgrades['fuel-tank']).toBe(1);
    expect(run.effectiveShip().fuelCapacity).toBe(ship.fuelCapacity + 25);
    expect(run.state.credits).toBe(c0 - upgradePrice(tank, 1, run.catalog.economy!, 1)!);
    expect(run.takeEvents().find((e) => e.type === 'upgrade')!.message).toMatchObject({ key: 'event.upgrade', params: { upgrade: 'fuel-tank', level: 1 } });
    // El depósito más grande no se llena solo: se compra el combustible.
    expect(run.state.ship.fuel).toBe(ship.startFuel);
    expect(run.apply({ type: 'buy-supply', supply: 'fuel' })).toEqual({ ok: true });
    expect(run.state.ship.fuel).toBeCloseTo(ship.fuelCapacity + 25);
    expect(run.apply({ type: 'buy-upgrade', upgradeId: 'fuel-tank' })).toEqual({ ok: true });
    expect(run.apply({ type: 'buy-upgrade', upgradeId: 'fuel-tank' })).toEqual({ ok: false, reason: { key: 'reject.upgradeMaxed' } });
    expect(run.apply({ type: 'buy-upgrade', upgradeId: 'nope' })).toEqual({ ok: false, reason: { key: 'reject.invalid' } });
    expect(run.state.stats.upgradesBought).toBe(2);
    const q = run.stationQuote()!.upgrades.find((u) => u.upgradeId === 'fuel-tank')!;
    expect(q).toMatchObject({ level: 2, maxLevel: 2, nextLevel: null, price: null, affordable: false });
  });

  it('solo se compra lo que ofrece esa estación', () => {
    const run = createRun({ seed: 8, catalog: econCatalog((raw) => { raw.economy!.startCredits = 5000; raw.economy!.offer.size = 2; }) });
    const offered = stationOffer(run.state.seed, run.state.sector, run.state.locationId, run.catalog);
    expect(regularOnly(offered)).toHaveLength(2);
    const missing = regularOnly(ALL_UPGRADES).find((id) => !offered.includes(id))!;
    expect(run.apply({ type: 'buy-upgrade', upgradeId: missing })).toEqual({ ok: false, reason: { key: 'reject.notOffered' } });
    expect(run.apply({ type: 'buy-upgrade', upgradeId: regularOnly(offered)[0]! })).toEqual({ ok: true });
  });

  it('el motor usa la nave efectiva: reactor, escudos y depósito', () => {
    const run = createRun({ seed: 9, catalog: richCatalog() });
    expect(run.state.ship.powerSupplyKw).toBe(ship.reactorOutputKw);
    run.apply({ type: 'buy-upgrade', upgradeId: 'reactor-heatsink' });
    expect(run.state.ship.powerSupplyKw).toBe(ship.reactorOutputKw + 10);
    const demand0 = run.state.ship.powerDemandKw;
    run.apply({ type: 'buy-upgrade', upgradeId: 'shield-capacitor' });
    expect(run.state.ship.powerDemandKw).toBe(demand0 + 8);
  });

  it('el motor usa las reglas de traje efectivas: el tanque de O₂ del traje dura más fuera', () => {
    const drainOver = (buy: boolean): number => {
      const cat = richCatalog((raw) => {
        const w = raw.surface!.worlds;
        const flat = (kind: WorldDef['kind']): WorldDef => ({ ...JSON.parse(JSON.stringify(w.find((x) => x.kind === kind)!)), storms: null, shipWearMult: 0 });
        raw.surface!.worlds = w.map((x) => ({ ...flat(x.kind), id: x.id }));
      });
      for (let seed = 1; seed < 60; seed++) {
        const run = createRun({ seed, catalog: cat });
        if (buy) expect(run.apply({ type: 'buy-upgrade', upgradeId: 'eva-o2-tank' })).toEqual({ ok: true });
        const here = getNode(run.state.sector, run.state.locationId)!;
        const target = here.links.map((id) => getNode(run.state.sector, id)!).find((n) => getNodeKind(n.kind, cat).landable);
        if (!target) continue;
        run.apply({ type: 'jump', toId: target.id });
        untilDocked(run);
        if (!run.apply({ type: 'land' }).ok) continue;
        // Freno permanente: llega lento.
        run.apply({ type: 'set-descent-brake', on: true });
        for (let t = 0; t < 600 && run.state.phase === 'landing'; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
        expect(run.apply({ type: 'eva-exit' })).toEqual({ ok: true });
        const o2 = run.state.crew[0]!.suitO2Pct;
        for (let t = 0; t < 10 - 1e-9; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
        return o2 - run.state.crew[0]!.suitO2Pct;
      }
      throw new Error('sin vecino aterrizable');
    };
    const base = catalog.surface!.rules.suit.o2DrainPctPerS * 10;
    expect(drainOver(false)).toBeCloseTo(base, 3);
    expect(drainOver(true)).toBeCloseTo(base * 0.85, 3);
  });
});

describe('oferta de mejoras por estación', () => {
  it('es determinista por semilla y nodo, no altera el sector y varía entre partidas', () => {
    const sector = generateSector(11, 1);
    const station = sector.nodes.find((n) => n.kind === 'station')!;
    const a = stationOffer(11, sector, station.id, catalog);
    expect(stationOffer(11, sector, station.id, catalog)).toEqual(a);
    expect(regularOnly(a)).toHaveLength(catalog.economy!.offer.size);
    expect(new Set(a).size).toBe(a.length);
    expect(generateSector(11, 1)).toEqual(sector);
    // Un nodo que no es estación no ofrece nada.
    const planet = sector.nodes.find((n) => n.kind !== 'station')!;
    expect(stationOffer(11, sector, planet.id, catalog)).toEqual([]);
    // Partidas distintas → ofertas distintas en la estación de salida (el hito: mejoras distintas).
    const offers = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const run = createRun({ seed });
      offers.add(run.stationQuote()!.upgrades.map((u) => u.upgradeId).join(','));
    }
    expect(offers.size).toBeGreaterThanOrEqual(5);
  });
});

describe('la masa a bordo encarece los saltos', () => {
  it('estimateJump y el consumo real aplican 1 + kg / massRefKg (carga y mejoras)', () => {
    const fuelUsed = (setup: (run: Run) => void): { estimate: number; used: number; mult: number } => {
      const run = createRun({ seed: 12, catalog: richCatalog() });
      setup(run);
      run.apply({ type: 'buy-supply', supply: 'fuel' });
      const to = getNode(run.state.sector, run.state.locationId)!.links[0]!;
      const est = run.estimateJump(to)!;
      const f0 = run.state.ship.fuel;
      run.apply({ type: 'jump', toId: to });
      untilDocked(run);
      return { estimate: est.byThrottle.cruise.fuel, used: f0 - run.state.ship.fuel, mult: est.cargoFuelMult! };
    };
    const empty = fuelUsed(() => {});
    expect(empty.mult).toBe(1);
    const heavy = fuelUsed((run) => loadCargo(run, { sample: 10 }));
    const kg = 10 * getMaterial('sample').massKg;
    expect(heavy.mult).toBeCloseTo(cargoFuelMult(catalog.economy!, kg));
    expect(heavy.estimate).toBeCloseTo(empty.estimate * heavy.mult);
    expect(heavy.used).toBeCloseTo(empty.used * heavy.mult, 4);
    // Las mejoras también pesan.
    const plated = fuelUsed((run) => run.apply({ type: 'buy-upgrade', upgradeId: 'hull-plating' }));
    expect(plated.mult).toBeCloseTo(cargoFuelMult(catalog.economy!, catalog.upgrades!.find((u) => u.id === 'hull-plating')!.levels[0]!.massKg));
    expect(plated.used).toBeGreaterThan(empty.used);
  });

  it('la masa a bordo se expone en el estado (ship.cargoKg)', () => {
    const run = createRun({ seed: 12, catalog: richCatalog() });
    expect(run.state.ship.cargoKg).toBe(0);
    loadCargo(run, { crystal: 2 });
    run.step(FIXED_STEP_S);
    expect(run.state.ship.cargoKg).toBe(2 * getMaterial('crystal').massKg);
  });
});

describe('contrato del sector y determinismo', () => {
  it('superar un sector paga el contrato (× multiplicador de venta)', () => {
    const run = createRun({ seed: 30, catalog: econCatalog() });
    run.apply({ type: 'set-throttle', throttle: 'eco' });
    for (let hops = 0; hops < 12 && run.state.phase === 'docked'; hops++) {
      run.apply({ type: 'buy-supply', supply: 'fuel' });
      const here = getNode(run.state.sector, run.state.locationId)!;
      const next = here.links.map((id) => getNode(run.state.sector, id)!).filter((n) => n.column > here.column)
        .sort((a, b) => (a.kind === 'station' ? -1 : 0) - (b.kind === 'station' ? -1 : 0) || run.estimateJump(a.id)!.distanceLy - run.estimateJump(b.id)!.distanceLy)[0]!;
      run.apply({ type: 'jump', toId: next.id });
      untilDocked(run);
    }
    expect(run.state.phase).toBe('won');
    const ev = run.takeEvents().find((e) => e.type === 'reward')!;
    expect(ev.message).toEqual({ key: 'event.sectorReward', params: { credits: catalog.economy!.sectorRewardCredits } });
  });

  it('misma semilla y mismas acciones de comercio = misma partida, se trocee como se trocee step()', () => {
    const play = (chunkMs: number) => {
      const run = createRun({ seed: 13, catalog: richCatalog() });
      const script: [number, RunAction][] = [
        [0.5, { type: 'buy-upgrade', upgradeId: 'jump-drive' }],
        [1, { type: 'buy-upgrade', upgradeId: 'fuel-tank' }],
        [1.5, { type: 'buy-supply', supply: 'fuel', amount: 12 }],
        [2, { type: 'jump', toId: getNode(run.state.sector, run.state.locationId)!.links[0]! }],
      ];
      // Tiempo en milisegundos enteros para que ambos troceos lleguen exactamente a los mismos instantes.
      let ms = 0;
      const until = (targetMs: number) => {
        while (ms < targetMs) {
          run.step(chunkMs / 1000);
          ms += chunkMs;
        }
      };
      for (const [at, action] of script) {
        until(at * 1000);
        run.apply(action);
      }
      until(80_000);
      return run.snapshot();
    };
    expect(play(250)).toEqual(play(100));
  });
});

describe('mejoras: el motor respeta cada efecto (con frente a sin)', () => {
  it('life-support-boost: el O₂ de la nave se regenera más rápido', () => {
    const gain = (buy: boolean): number => {
      const run = createRun({ seed: 14, catalog: richCatalog() });
      if (buy) expect(run.apply({ type: 'buy-upgrade', upgradeId: 'life-support-boost' })).toEqual({ ok: true });
      run.state.ship.oxygenPct = 40;
      for (let t = 0; t < 10 - 1e-9; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
      expect(run.state.ship.overloaded).toBe(false);
      return run.state.ship.oxygenPct - 40;
    };
    expect(gain(true)).toBeGreaterThan(gain(false) + 0.5);
  });

  it('engine-stabilizers: el motor dañado gasta menos combustible por salto y la esquiva cuesta menos', () => {
    const damagedJumpFuel = (buy: boolean): { damaged: number; healthy: number } => {
      const run = createRun({ seed: 15, catalog: richCatalog() });
      if (buy) expect(run.apply({ type: 'buy-upgrade', upgradeId: 'engine-stabilizers' })).toEqual({ ok: true });
      const to = getNode(run.state.sector, run.state.locationId)!.links[0]!;
      const healthy = run.estimateJump(to)!.byThrottle.cruise.fuel / run.estimateJump(to)!.cargoFuelMult!;
      run.state.ship.systems.engines.healthPct = 30;
      return { damaged: run.estimateJump(to)!.byThrottle.cruise.fuel / run.estimateJump(to)!.cargoFuelMult!, healthy };
    };
    const off = damagedJumpFuel(false);
    const on = damagedJumpFuel(true);
    expect(on.healthy).toBeCloseTo(off.healthy); // sano, igual (sin contar la masa de la mejora)
    expect(on.damaged).toBeLessThan(off.damaged - 1e-6);

    const evadeCost = (buy: boolean): number => {
      const run = createRun({ seed: 16, catalog: richCatalog((raw) => { for (const k of raw.nodeKinds) k.hazardPerLy.impact = 0.5; }) });
      if (buy) expect(run.apply({ type: 'buy-upgrade', upgradeId: 'engine-stabilizers' })).toEqual({ ok: true });
      run.apply({ type: 'jump', toId: getNode(run.state.sector, run.state.locationId)!.links[0]! });
      for (let t = 0; t < 600 && run.state.warnings.length === 0 && run.state.phase === 'transit'; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
      const f0 = run.state.ship.fuel;
      expect(run.apply({ type: 'evade' })).toEqual({ ok: true });
      return f0 - run.state.ship.fuel;
    };
    expect(evadeCost(true)).toBeLessThan(evadeCost(false));
  });
});

describe('límite eléctrico de las mejoras (diseño)', () => {
  const maxed = Object.fromEntries(catalog.upgrades!.map((u) => [u.id, u.levels.length]));
  const all = effectiveShip(ship, maxed, catalog);
  const cruiseDraw = (s: typeof ship, ids: readonly ('engines' | 'lifeSupport' | 'shields' | 'nav')[]) =>
    ids.reduce((sum, id) => sum + s.systemDrawKw[id] * (id === 'engines' ? s.throttles.find((t) => t.id === 'cruise')!.engineDrawMult : 1), 0);

  it('la nave base va a crucero con todo encendido sin sobrecarga', () => {
    expect(cruisePowerMarginKw(ship)).toBeGreaterThanOrEqual(0);
  });

  it('con TODAS las mejoras al máximo existe una configuración jugable: motores + soporte vital + escudos o navegación caben en el reactor', () => {
    // Aceptado por diseño: con todo al máximo puede no caber todo a la vez (hay que elegir qué apagar), pero nunca
    // se queda sin una configuración que viaje, respire y tenga escudos o sensores.
    const options = [cruiseDraw(all, ['engines', 'lifeSupport', 'shields']), cruiseDraw(all, ['engines', 'lifeSupport', 'nav'])];
    expect(Math.min(...options)).toBeLessThanOrEqual(all.reactorOutputKw);
    expect(cruiseDraw(all, ['engines', 'lifeSupport'])).toBeLessThanOrEqual(all.reactorOutputKw);
  });

  it('stationQuote avisa antes de comprar: powerMarginDeltaKw y overloadsAtCruise del siguiente nivel', () => {
    const run = createRun({ seed: 17, catalog: richCatalog() });
    for (let round = 0; round < 3; round++) {
      for (const u of run.stationQuote()!.upgrades) {
        if (u.nextLevel === null) {
          expect(u.powerMarginDeltaKw).toBe(0);
          continue;
        }
        const after = effectiveShip(ship, { ...run.state.upgrades, [u.upgradeId]: u.nextLevel }, run.catalog);
        expect(u.powerMarginDeltaKw).toBeCloseTo(cruisePowerMarginKw(after) - cruisePowerMarginKw(run.effectiveShip()));
        expect(u.overloadsAtCruise).toBe(cruisePowerMarginKw(after) < 0);
      }
      for (const u of run.stationQuote()!.upgrades) run.apply({ type: 'buy-upgrade', upgradeId: u.upgradeId });
    }
    // Con todo comprado, el margen a crucero con todo encendido es el de la nave efectiva.
    expect(cruisePowerMarginKw(run.effectiveShip())).toBe(cruisePowerMarginKw(effectiveShip(ship, run.state.upgrades, run.catalog)));
  });
});

describe('varada en estación', () => {
  it('el combustible comprable no pasa de la capacidad del depósito', () => {
    // Un salto que pide más que el depósito entero: ni con créditos infinitos se puede, así que queda varada.
    const run = createRun({ seed: 18, catalog: econCatalog((raw) => { raw.economy!.startCredits = 100000; raw.economy!.emergency.fuelPct = 0; raw.ships[0]!.fuelPerLy = 50; }) });
    run.apply({ type: 'service' });
    run.step(FIXED_STEP_S);
    expect(run.state.lossReason).toBe('stranded');
  });
});
