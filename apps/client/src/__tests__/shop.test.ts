import { beforeEach, describe, expect, it } from 'vitest';
import {
  catalog, createRun, crewFieldValues, effectivePsychRules, effectiveShip, effectiveSurfaceRules, getShip, getSurfaceCatalog, getUpgrades, parseCatalog, type Catalog, type Run, type StationQuote,
} from '@payload/shared';
import { resetCueMemory, useCues } from '../audio/cues';
import { sfxForRunEvent } from '../audio/soundLogic';
import { reachStation, travelToStation } from '../game/debug';
import { effectiveRulesOf, effectiveShipOf, sameLevels } from '../game/effective';
import { atStationShop, interactionAt, promptFor } from '../game/interaction';
import { STATIONS } from '../game/layout';
import { getRun, useGame } from '../game/runStore';
import {
  ALL_FIELDS, FIELD_INFO, buySupplyAction, buyUpgradeAction, cargoFuelPct, deltaText, dispatchShop, installedUpgrades, overloadsAtCruise, upgradeOverloads, moveFocus, sellAction, sellRows, supplyRows,
  upgradeDeltas, upgradeRows,
} from '../game/shop';
import es from '../locales/es.json';
import { flatten } from '../i18n/flatten';

const esFlat = flatten(es);

/** Catálogo con muchos créditos al empezar (para comprar sin depender del balance del content-designer). */
function richCatalog(): Catalog {
  const raw = structuredClone(catalog) as Catalog;
  raw.economy = { ...raw.economy!, startCredits: 100000 };
  return parseCatalog(raw);
}

/** Partida atracada en una estación con terminal (solo con acciones del motor). */
function runAtStation(cat: Catalog = catalog, seed = 7): Run {
  const run = createRun({ seed, catalog: cat });
  expect(reachStation(run, false)).toBe(true);
  return run;
}

/** Cotización a mano (lógica pura sin partida). */
function quoteOf(over: Partial<StationQuote> = {}): StationQuote {
  return {
    nodeId: 'n',
    credits: 50,
    sellMult: 1,
    buyMult: 1,
    sell: [],
    sellTotal: 0,
    supplies: {
      fuel: { unitPrice: 2, missing: 40, affordable: 25, fillCost: 80 },
      hull: { unitPrice: 1, missing: 0, affordable: 0, fillCost: 0 },
      spares: { unitPrice: 60, missing: 2, affordable: 0, fillCost: 120 },
    },
    emergency: { available: false, fuel: 0, hull: 0, spares: 0 },
    upgrades: [],
    ...over,
  };
}

beforeEach(() => {
  useGame.getState().toMenu();
  resetCueMemory();
});

describe('terminal: venta', () => {
  it('una fila por material, lo más valioso arriba; vende 1, un material o toda la bodega', () => {
    const q = quoteOf({
      sell: [
        { materialId: 'a', units: 3, unitPrice: 1, total: 3 },
        { materialId: 'b', units: 2, unitPrice: 20, total: 40 },
        { materialId: 'c', units: 0, unitPrice: 5, total: 0 },
      ],
    });
    expect(sellRows(q).map((r) => r.materialId)).toEqual(['b', 'a']);
    expect(sellAction('b', 1)).toEqual({ type: 'sell', materialId: 'b', units: 1 });
    expect(sellAction('b')).toEqual({ type: 'sell', materialId: 'b' });
    expect(sellAction()).toEqual({ type: 'sell' });
  });

  it('con carga real: vender sube los créditos y vacía la bodega (lo hace el motor)', () => {
    const run = createRun({ seed: 7 });
    expect(reachStation(run, true)).toBe(true);
    const q = run.stationQuote()!;
    const rows = sellRows(q);
    expect(rows.length).toBeGreaterThan(0);
    const before = run.state.credits;
    const first = rows[0]!;
    expect(run.apply(sellAction(first.materialId, 1)).ok).toBe(true);
    expect(run.state.credits).toBe(before + first.unitPrice);
    expect(run.apply(sellAction()).ok).toBe(true);
    expect(run.state.credits).toBe(before + q.sellTotal);
    expect(sellRows(run.stationQuote()!)).toEqual([]);
    expect(run.apply(sellAction()).ok).toBe(false);
  });
});

describe('terminal: suministros', () => {
  it('lleno, sin créditos (con el precio a la vista) o compra parcial', () => {
    const s = createRun({ seed: 7 }).state;
    const rows = supplyRows(quoteOf(), s, getShip(s.ship.shipId));
    const [fuel, hull, spares] = rows;
    expect(hull!.fillBlock).toBe('full');
    expect(hull!.stepBlock).toBe('full');
    // 25 de 40 pagables: «+25» parcial, no «llenar».
    expect(fuel!.fillBlock).toBeNull();
    expect(fuel!.fillsUp).toBe(false);
    expect(fuel!.fillUnits).toBe(25);
    expect(fuel!.fillCost).toBe(50);
    expect(fuel!.stepUnits).toBe(10);
    expect(fuel!.stepCost).toBe(20);
    // Sin créditos para un repuesto: deshabilitado, pero enseña lo que costaría.
    expect(spares!.fillBlock).toBe('noCredits');
    expect(spares!.fillCost).toBe(120);
    expect(spares!.stepBlock).toBe('noCredits');
    expect(spares!.stepCost).toBe(60);
    expect(buySupplyAction('fuel')).toEqual({ type: 'buy-supply', supply: 'fuel' });
    expect(buySupplyAction('spares', 1)).toEqual({ type: 'buy-supply', supply: 'spares', amount: 1 });
  });

  it('comprar con la acción despachada cambia el combustible y los créditos como dice la cotización', () => {
    // Bajar a un mundo y volver gasta combustible: hay sitio en el depósito.
    const run = createRun({ seed: 7, catalog: richCatalog() });
    expect(reachStation(run, true)).toBe(true);
    const row = supplyRows(run.stationQuote()!, run.state, run.effectiveShip()).find((r) => r.supply === 'fuel')!;
    expect(row.fillBlock).toBeNull();
    expect(row.fillsUp).toBe(true);
    const credits = run.state.credits;
    expect(run.apply(buySupplyAction('fuel')).ok).toBe(true);
    expect(run.state.credits).toBe(credits - row.fillCost);
    expect(run.state.ship.fuel).toBeCloseTo(run.effectiveShip().fuelCapacity, 6);
    expect(supplyRows(run.stationQuote()!, run.state, run.effectiveShip())[0]!.fillBlock).toBe('full');
  });
});

describe('terminal: mejoras', () => {
  it('todo campo que puede tocar una mejora tiene presentación y nombre en la interfaz', () => {
    for (const f of ALL_FIELDS) {
      expect(FIELD_INFO[f], f).toBeDefined();
      expect(`shop.field.${f}` in esFlat, f).toBe(true);
    }
  });

  it('la línea de efecto sale de comparar la nave/reglas efectivas con un nivel más', () => {
    const shipId = createRun({ seed: 7 }).state.ship.shipId;
    for (const u of getUpgrades(catalog)) {
      const deltas = upgradeDeltas(u.id, {}, shipId, catalog);
      expect(deltas.length, u.id).toBeGreaterThan(0);
      const next = { [u.id]: 1 };
      const ship = effectiveShip(getShip(shipId), next, catalog);
      const rules = effectiveSurfaceRules(getSurfaceCatalog(catalog).rules, next, catalog);
      const base = getShip(shipId);
      for (const d of deltas) {
        const [target, ...rest] = d.field.split('.');
        const path = rest.join('.');
        const pick = (o: unknown) => path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], o) as number;
        // Fase 8: los campos `crew` salen de las reglas de cordura efectivas (no de las de superficie).
        const crewOf = (levels: Record<string, number>) => crewFieldValues(effectivePsychRules(catalog.psych!, levels, catalog)) as unknown;
        const after = target === 'ship' ? pick(ship) : target === 'crew' ? pick(crewOf(next)) : pick((rules as unknown as Record<string, unknown>)[target!]);
        const before = target === 'ship' ? pick(base) : target === 'crew' ? pick(crewOf({})) : pick((getSurfaceCatalog(catalog).rules as unknown as Record<string, unknown>)[target!]);
        expect(d.after, `${u.id} ${d.field}`).toBeCloseTo(after, 9);
        expect(d.before, `${u.id} ${d.field}`).toBeCloseTo(before, 9);
        expect(d.good).toBe(d.after > d.before === FIELD_INFO[d.field]!.up);
      }
      // Toda mejora gana algo; al máximo ya no hay línea.
      expect(deltas.some((d) => d.good), u.id).toBe(true);
      expect(upgradeDeltas(u.id, { [u.id]: u.levels.length }, shipId, catalog)).toEqual([]);
    }
  });

  it('texto del efecto: antes → después, % relativo o kW', () => {
    expect(deltaText({ field: 'ship.fuelCapacity', before: 100, after: 125, good: true, style: 'abs' })).toEqual({ before: 100, after: 125 });
    expect(deltaText({ field: 'ship.shieldAbsorb', before: 0.5, after: 0.6, good: true, style: 'pct01' })).toEqual({ before: 50, after: 60 });
    expect(deltaText({ field: 'ship.fuelPerLy', before: 2, after: 1.76, good: true, style: 'rel' })).toEqual({ change: -12 });
    expect(deltaText({ field: 'ship.systemDrawKw.shields', before: 20, after: 28, good: false, style: 'kw' })).toEqual({ change: 8 });
  });

  it('deshabilitada si no se puede pagar o está al máximo; comprarla despacha buy-upgrade', () => {
    const q = quoteOf({
      upgrades: [
        { upgradeId: getUpgrades(catalog)[0]!.id, level: 0, maxLevel: 2, nextLevel: 1, price: 999, massKg: 10, affordable: false, powerMarginDeltaKw: 0, overloadsAtCruise: false },
        { upgradeId: getUpgrades(catalog)[1]!.id, level: 2, maxLevel: 2, nextLevel: null, price: null, massKg: 0, affordable: false, powerMarginDeltaKw: 0, overloadsAtCruise: false },
      ],
    });
    const s = createRun({ seed: 7 }).state;
    const [poor, maxed] = upgradeRows(q, s, catalog);
    expect(poor!.block).toBe('noCredits');
    expect(poor!.gains.length).toBeGreaterThan(0);
    expect(maxed!.block).toBe('maxed');
    expect(buyUpgradeAction('x')).toEqual({ type: 'buy-upgrade', upgradeId: 'x' });
  });

  it('comprar una mejora ofrecida la instala, cambia la nave efectiva del HUD y cobra su precio', () => {
    const run = runAtStation(richCatalog());
    const rows = upgradeRows(run.stationQuote()!, run.state, run.catalog);
    const row = rows.find((r) => r.block === null);
    expect(row).toBeDefined();
    const credits = run.state.credits;
    expect(run.apply(buyUpgradeAction(row!.upgradeId)).ok).toBe(true);
    expect(run.state.credits).toBe(credits - row!.price!);
    expect(run.state.upgrades[row!.upgradeId]).toBe(1);
    // La nave y las reglas que pinta el HUD son las del motor.
    expect(effectiveShipOf(run.state, run.catalog)).toEqual(run.effectiveShip());
    expect(effectiveRulesOf(run.state, run.catalog)).toEqual(run.effectiveSurfaceRules());
    expect(installedUpgrades(run.state.upgrades, run.catalog).map((u) => u.upgradeId)).toEqual([row!.upgradeId]);
    // El efecto anunciado es el que se ve ahora (antes → después).
    for (const g of row!.gains) {
      const [target, ...rest] = g.field.split('.');
      const live = target === 'ship' ? run.effectiveShip() : (run.effectiveSurfaceRules() as unknown as Record<string, unknown>)[target!];
      const value = rest.reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], live) as number;
      expect(value).toBeCloseTo(g.after, 9);
    }
  });
});

describe('terminal: apertura, avisos y sonido', () => {
  it('atracada en una estación, la esclusa abre el terminal; en otro sitio sigue sellada', () => {
    const run = runAtStation();
    expect(atStationShop(run.state, run.catalog)).toBe(true);
    const at = interactionAt('airlock', run.state, {}, run.catalog);
    expect(at).toEqual({ kind: 'terminal', credits: run.state.credits });
    const prompt = promptFor(at, run.state)!;
    expect(prompt.key).toBe('prompt.terminal');
    expect(prompt.blocked).toBeFalsy();
    expect(prompt.badges?.[0]?.params).toEqual({ credits: run.state.credits });
    // El mapa sigue siendo el mapa.
    expect(interactionAt('map', run.state, {}, run.catalog)).toEqual({ kind: 'map' });
    expect(STATIONS.airlock).toBeDefined();
    // Sin estación: esclusa sellada (no hay superficie).
    const other = createRun({ seed: 7 });
    if (!atStationShop(other.state, other.catalog)) expect(interactionAt('airlock', other.state, {}, other.catalog)).toEqual({ kind: 'airlock', open: false });
  });

  it('sin créditos: rechazo del motor como aviso y cue noCredits (destello + subtítulo)', () => {
    useGame.getState().startRun(7);
    const run = getRun()!;
    expect(travelToStation(run) || atStationShop(run.state, run.catalog)).toBe(true);
    useGame.getState().tick(0);
    // Gastar casi todo en suministros para que alguna mejora quede fuera de alcance (sin depender del balance).
    for (const supply of ['spares', 'fuel', 'hull'] as const) useGame.getState().act(buySupplyAction(supply), true);
    const q = run.stationQuote()!;
    const tooDear = q.upgrades.find((u) => u.price !== null && u.price > run.state.credits);
    expect(tooDear, 'ninguna mejora más cara que los créditos iniciales: revisa la prueba').toBeDefined();
    if (!tooDear) return;
    const r = useGame.getState().act(buyUpgradeAction(tooDear.upgradeId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.key).toBe('reject.noCredits');
    expect(useGame.getState().toasts.some((t) => t.message.key === 'reject.noCredits')).toBe(true);
    expect(useCues.getState().captions.some((c) => c.key === 'sound.noCredits')).toBe(true);
  });

  it('venta, compra, mejora y contrato suenan', () => {
    expect(sfxForRunEvent({ type: 'sale' })).toBe('sale');
    expect(sfxForRunEvent({ type: 'reward' })).toBe('sale');
    expect(sfxForRunEvent({ type: 'purchase', subtype: 'fuel' })).toBe('purchase');
    expect(sfxForRunEvent({ type: 'upgrade' })).toBe('upgrade');
  });
});

describe('utilidades', () => {
  it('sobrecoste por carga del mapa en % entero', () => {
    expect(cargoFuelPct(undefined)).toBe(0);
    expect(cargoFuelPct(1)).toBe(0);
    expect(cargoFuelPct(1.184)).toBe(18);
  });

  it('flechas: arriba/abajo en la columna (con vuelta), izquierda/derecha a la otra columna', () => {
    expect(moveFocus([3, 5], { col: 0, row: 2 }, 'ArrowDown')).toEqual({ col: 0, row: 0 });
    expect(moveFocus([3, 5], { col: 0, row: 0 }, 'ArrowUp')).toEqual({ col: 0, row: 2 });
    expect(moveFocus([3, 5], { col: 1, row: 4 }, 'ArrowLeft')).toEqual({ col: 0, row: 2 });
    expect(moveFocus([3, 5], { col: 0, row: 1 }, 'ArrowRight')).toEqual({ col: 1, row: 1 });
    expect(moveFocus([0, 5], { col: 1, row: 1 }, 'ArrowLeft')).toEqual({ col: 1, row: 1 });
  });

  it('niveles iguales (lo que falta cuenta como 0) y memo de la nave efectiva', () => {
    expect(sameLevels({ a: 1 }, { a: 1, b: 0 })).toBe(true);
    expect(sameLevels({ a: 1 }, { a: 2 })).toBe(false);
    const s = createRun({ seed: 7 }).state;
    expect(effectiveShipOf(s)).toBe(effectiveShipOf(s));
    expect(effectiveShipOf(s).fuelCapacity).toBe(getShip(s.ship.shipId).fuelCapacity);
  });
});

describe('terminal: un rechazo se ve una sola vez y aviso de sobrecarga', () => {
  it('dispatchShop despacha en silencio (sin aviso global) y devuelve el motivo; sin créditos, suena', () => {
    const calls: [unknown, boolean | undefined][] = [];
    let cues = 0;
    const reason = dispatchShop((a, quiet) => {
      calls.push([a, quiet]);
      return { ok: false, reason: { key: 'reject.noCredits', params: { credits: 9 } } };
    }, buyUpgradeAction('x'), () => cues++);
    expect(calls).toEqual([[{ type: 'buy-upgrade', upgradeId: 'x' }, true]]);
    expect(reason?.key).toBe('reject.noCredits');
    expect(cues).toBe(1);
    expect(dispatchShop(() => ({ ok: true }), sellAction(), () => cues++)).toBeNull();
    expect(cues).toBe(1);
  });

  it('con la partida real: el rechazo no deja aviso en el HUD y el éxito sí refresca la copia', () => {
    useGame.getState().startRun(7);
    const run = getRun()!;
    expect(travelToStation(run) || atStationShop(run.state, run.catalog)).toBe(true);
    const act = useGame.getState().act;
    const before = useGame.getState().toasts.length;
    const reason = dispatchShop(act, sellAction(), () => undefined); // bodega vacía
    expect(reason?.key).toBe('reject.nothingToSell');
    expect(useGame.getState().toasts.length).toBe(before);
    expect(useGame.getState().toasts.some((t) => t.message.key === 'reject.nothingToSell')).toBe(false);
    if (run.stationQuote()!.supplies.spares.affordable >= 1) {
      expect(dispatchShop(act, buySupplyAction('spares', 1), () => undefined)).toBeNull();
      expect(useGame.getState().hud!.credits).toBe(run.state.credits);
    }
  });

  it('sobrecarga a crucero: demanda con todo encendido frente al reactor', () => {
    const ship = structuredClone(getShip(createRun({ seed: 7 }).state.ship.shipId));
    ship.reactorOutputKw = 1e6;
    expect(overloadsAtCruise(ship)).toBe(false);
    ship.reactorOutputKw = 0.001;
    expect(overloadsAtCruise(ship)).toBe(true);
  });

  it('usa el campo del motor si existe; si no, lo calcula con la nave efectiva de un nivel más', () => {
    const shipId = createRun({ seed: 7 }).state.ship.shipId;
    const u = getUpgrades(catalog)[0]!;
    type Entry = StationQuote['upgrades'][number];
    const withEngine: Entry = { upgradeId: u.id, level: 0, maxLevel: u.levels.length, nextLevel: 1, price: 1, massKg: 0, affordable: true, powerMarginDeltaKw: 0, overloadsAtCruise: true };
    expect(upgradeOverloads(withEngine, {}, shipId, catalog)).toBe(true);
    expect(upgradeOverloads({ ...withEngine, overloadsAtCruise: false }, {}, shipId, catalog)).toBe(false);
    // Motor anterior (sin el campo): se calcula en el cliente.
    const { overloadsAtCruise: _omit, powerMarginDeltaKw: _omit2, ...legacy } = withEngine;
    const entry = legacy as Entry;
    const computed = overloadsAtCruise(effectiveShip(getShip(shipId), { [u.id]: 1 }, catalog));
    expect(upgradeOverloads(entry, {}, shipId, catalog)).toBe(computed);
    expect(upgradeOverloads({ ...entry, nextLevel: null }, {}, shipId, catalog)).toBe(false);
    // Con un reactor sin margen, la mejora que sube un consumo avisa.
    const drawUp = getUpgrades(catalog).find((x) => x.levels[0]!.effects.some((e) => e.field.startsWith('systemDrawKw.') && (e.add ?? 0) > 0));
    if (drawUp) {
      const raw = structuredClone(catalog) as Catalog;
      const sh = raw.ships.find((x) => x.id === shipId)!;
      const t = sh.throttles.find((x) => x.id === 'cruise')!;
      const d = sh.systemDrawKw;
      sh.reactorOutputKw = d.engines * t.engineDrawMult + d.lifeSupport + d.shields + d.nav;
      const tight = parseCatalog(raw);
      expect(overloadsAtCruise(getShip(shipId, tight))).toBe(false);
      expect(upgradeOverloads({ ...entry, upgradeId: drawUp.id, maxLevel: drawUp.levels.length }, {}, shipId, tight)).toBe(true);
    }
  });
});
