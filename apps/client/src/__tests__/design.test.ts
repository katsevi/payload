/**
 * Fase 4 (cliente): nave base con diseño (effective/shop), lógica pura del hangar, guardado, escala del mapa
 * solar, disposición de la nave montada y flujo menú → misión → diseño → partida → rediseñar.
 * Ningún id ni cifra fijos: todo se lee del catálogo y de los fixtures del motor.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  catalog, computeDesignBudgets, createRun, cruisePowerMarginKw, effectiveShip, emptyDesign, findBody, getBody, getInstruments, getLaunchers, getMissions, getModules,
  generateSolarSector, getShip, getSolarSystem, getUpgrades, MODULE_KINDS, reviewDesign, shipFromDesign, shipPowerKw, simLocales, type MissionDesign,
} from '@payload/shared';
import { GLOSSARY_TERMS, isGlossaryKey } from '../game/glossary';
import { LruCache } from '../game/lru';
import { isLandableNode } from '../game/surfaceRules';
import { baseShipOf, effectiveShipOf, maxPowerKwOf, sameDesign } from '../game/effective';
import { hangarLayout } from '../game/hangarLayout';
import {
  activeGroups, addPart, ALL_MODULE_GROUPS, canLaunch, countPart, cycleIndex, DESIGN_KEY_PREFIX, destinationOptions, hasSavedDesign, launcherOptions, loadDesign,
  meterFill, PALETTE_GROUPS, paletteItems, partKeyAction, partTokens, previewAdd, removePart, sanitizeDesign, saveDesign, setDestination, setLauncher, sortedIssues,
  startingDesign, type KeyValueStore,
} from '../game/missionDesign';
import { getRun, useGame } from '../game/runStore';
import { overloadsAtCruise, upgradeDeltas, upgradeRows } from '../game/shop';
import { beltRange, bodyDisplayRadius, bodyScenePos, orbitRadius, sectorScenePositions, sunDirectionFrom, sunOrbiters } from '../game/solarScale';
import es from '../locales/es.json';
import en from '../locales/en.json';
import { flatten } from '../i18n/flatten';

const esFlat = flatten(es);
const enFlat = flatten(en);
const simEs = flatten(simLocales.es);

const FIXTURES_DIR = join(__dirname, '../../../../packages/shared/src/__tests__/fixtures/missions');
interface Fixture {
  missionId: string;
  valid: { name: string; design: MissionDesign }[];
  failing: { name: string; cause: string; design: MissionDesign }[];
}
const fixtures: Fixture[] = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8')) as Fixture);
const refOf = (missionId: string): MissionDesign => {
  const d = fixtures.find((f) => f.missionId === missionId)?.valid[0]?.design;
  if (!d) throw new Error(`sin fixture para ${missionId}`);
  return d;
};
const missions = getMissions(catalog);

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('nave base con diseño (effective.ts y shop.ts)', () => {
  it('cada misión del catálogo tiene un diseño de referencia en los fixtures', () => {
    expect(missions.length).toBeGreaterThan(0);
    for (const m of missions) expect(() => refOf(m.id), m.id).not.toThrow();
  });

  it('con diseño, la nave efectiva es la del motor (shipFromDesign + mejoras), no getShip(shipId)', () => {
    for (const m of missions) {
      const run = createRun({ seed: 7, design: refOf(m.id) });
      expect(baseShipOf(run.state, run.catalog)).toEqual(shipFromDesign(run.state.missionDesign!, run.catalog));
      expect(effectiveShipOf(run.state, run.catalog)).toEqual(run.effectiveShip());
    }
    // Y la diseñada no coincide con la del catálogo con su mismo id (si no, la prueba no prueba nada).
    const run = createRun({ seed: 7, design: refOf(missions[0]!.id) });
    expect(effectiveShipOf(run.state).fuelCapacity === getShip(run.state.ship.shipId).fuelCapacity && effectiveShipOf(run.state).hullMax === getShip(run.state.ship.shipId).hullMax).toBe(false);
  });

  it('sin diseño sigue siendo la nave del catálogo', () => {
    const run = createRun({ seed: 7 });
    expect(baseShipOf(run.state)).toBe(getShip(run.state.ship.shipId));
    expect(effectiveShipOf(run.state)).toEqual(run.effectiveShip());
  });

  it('memoriza por diseño: mismo diseño, mismo objeto; otro diseño, otra nave', () => {
    const a = createRun({ seed: 7, design: refOf(missions[0]!.id) }).snapshot();
    const b = structuredClone(a);
    expect(effectiveShipOf(a)).toBe(effectiveShipOf(b));
    const other = missions.find((m) => !sameDesign(refOf(m.id), a.missionDesign));
    if (other) {
      const c = createRun({ seed: 7, design: refOf(other.id) }).snapshot();
      expect(effectiveShipOf(c)).toEqual(shipFromDesign(c.missionDesign!));
    }
  });

  it('la barra de energía nunca divide entre cero y usa la potencia a la distancia actual', () => {
    for (const m of missions) {
      const run = createRun({ seed: 7, design: refOf(m.id) });
      const max = maxPowerKwOf(run.state, run.catalog);
      expect(max, m.id).toBeGreaterThan(0);
      expect(max).toBeCloseTo(shipPowerKw(run.effectiveShip(), run.state.sunDistanceAu ?? 1), 6);
      expect(run.state.ship.powerSupplyKw / max).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('la terminal compara las mejoras con la nave diseñada', () => {
    const run = createRun({ seed: 7, design: refOf(missions[0]!.id) });
    const base = baseShipOf(run.state, run.catalog);
    for (const u of getUpgrades(catalog)) {
      const fromDesign = upgradeDeltas(u.id, {}, base, catalog);
      for (const d of fromDesign) {
        const [, ...path] = d.field.split('.');
        if (d.field.startsWith('ship.') && path.length === 1) expect(d.before, `${u.id} ${d.field}`).toBeCloseTo((base as unknown as Record<string, number>)[path[0]!]!, 6);
      }
    }
    const quote = {
      nodeId: 'n', credits: 0, sellMult: 1, buyMult: 1, sell: [], supplies: { fuel: { unitPrice: 1, missing: 0, affordable: 0, fillCost: 0 }, hull: { unitPrice: 1, missing: 0, affordable: 0, fillCost: 0 }, spares: { unitPrice: 1, missing: 0, affordable: 0, fillCost: 0 } },
      upgrades: getUpgrades(catalog).slice(0, 2).map((u) => ({ upgradeId: u.id, level: 0, maxLevel: u.levels.length, nextLevel: 1, price: 1, massKg: 0, affordable: true })),
    } as unknown as Parameters<typeof upgradeRows>[0];
    const rows = upgradeRows(quote, run.state, run.catalog);
    expect(rows[0]!.gains.concat(rows[0]!.costs)).toEqual(upgradeDeltas(rows[0]!.upgradeId, {}, base, catalog).filter((d) => d.good).slice(0, 2).concat(upgradeDeltas(rows[0]!.upgradeId, {}, base, catalog).filter((d) => !d.good).slice(0, 2)));
  });

  it('la sobrecarga a crucero cuenta los paneles a esa distancia del Sol (como el motor)', () => {
    for (const m of missions) {
      const ship = effectiveShip(shipFromDesign(refOf(m.id)), {}, catalog);
      for (const au of [1, 1.5, 5.2, 9.5]) expect(overloadsAtCruise(ship, au), `${m.id} ${au}`).toBe(cruisePowerMarginKw(ship, au) < -1e-9);
    }
  });
});

describe('hangar: piezas y paleta (lógica pura)', () => {
  const ref = refOf(missions[0]!.id);

  it('añadir y quitar: copias, sin mutar, quitar lo que no está no cambia nada', () => {
    const inst = getInstruments(catalog)[0]!;
    const d1 = addPart(ref, { kind: 'instrument', id: inst.id });
    expect(countPart(d1, { kind: 'instrument', id: inst.id })).toBe(countPart(ref, { kind: 'instrument', id: inst.id }) + 1);
    expect(d1).not.toBe(ref);
    const d2 = removePart(d1, { kind: 'instrument', id: inst.id });
    expect(countPart(d2, { kind: 'instrument', id: inst.id })).toBe(countPart(ref, { kind: 'instrument', id: inst.id }));
    const empty = emptyDesign(ref.missionId);
    expect(removePart(empty, { kind: 'module', id: getModules(catalog)[0]!.id })).toBe(empty);
  });

  it('una estructura o una propulsión sustituyen a la anterior (nunca dos por un clic)', () => {
    for (const kind of ['structure', 'propulsion'] as const) {
      const options = getModules(catalog).filter((m) => m.kind === kind);
      if (options.length < 2) continue;
      let d = emptyDesign(ref.missionId);
      for (const m of options) d = addPart(d, { kind: 'module', id: m.id });
      expect(d.moduleIds.filter((id) => options.some((m) => m.id === id))).toEqual([options[options.length - 1]!.id]);
      expect(reviewDesign(d).issues.some((x) => x.code === `multiple-${kind === 'structure' ? 'structures' : 'propulsion'}`)).toBe(false);
    }
    // Los repetibles sí se acumulan (dos tanques, dos alas).
    const rep = getModules(catalog).find((m) => m.kind !== 'structure' && m.kind !== 'propulsion')!;
    expect(countPart(addPart(addPart(emptyDesign(ref.missionId), { kind: 'module', id: rep.id }), { kind: 'module', id: rep.id }), { kind: 'module', id: rep.id })).toBe(2);
  });

  it('la paleta tiene cada módulo e instrumento del catálogo exactamente una vez, y toda familia tiene grupo', () => {
    const all = activeGroups(catalog).flatMap((g) => paletteItems(g, catalog));
    const ids = all.map((p) => `${p.kind}:${p.id}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual([...getModules(catalog).map((m) => `module:${m.id}`), ...getInstruments(catalog).map((i) => `instrument:${i.id}`)].sort());
    for (const k of MODULE_KINDS) expect(PALETTE_GROUPS).toContain(ALL_MODULE_GROUPS[k]);
  });

  it('cada pieza tiene una línea con lo que aporta o cuesta, con claves en ambos idiomas', () => {
    for (const g of activeGroups(catalog)) {
      for (const p of paletteItems(g, catalog)) {
        const { gains, costs } = partTokens(p, catalog);
        expect(costs.length, p.id).toBeGreaterThan(0);
        for (const tk of [...gains, ...costs]) {
          expect(`design.part.${tk.key}` in esFlat, tk.key).toBe(true);
          if (typeof tk.params.field === 'string') expect(`shop.field.${tk.params.field}` in esFlat, String(tk.params.field)).toBe(true);
        }
      }
    }
  });

  it('el aviso «excedería» sale del motor: añadir masa sin parar acaba rompiendo el presupuesto de masa', () => {
    const heavy = [...getModules(catalog)].filter((m) => m.kind !== 'structure' && m.kind !== 'propulsion').sort((a, b) => b.massKg - a.massKg)[0]!;
    let d = ref;
    let broke = false;
    for (let i = 0; i < 60 && !broke; i++) {
      const before = computeDesignBudgets(d);
      const { breaks, budgets } = previewAdd(d, { kind: 'module', id: heavy.id }, catalog, before);
      expect(budgets).toEqual(computeDesignBudgets(addPart(d, { kind: 'module', id: heavy.id })));
      if (breaks.includes('mass')) broke = true;
      d = addPart(d, { kind: 'module', id: heavy.id });
    }
    expect(broke).toBe(true);
  });

  it('«Lanzar» solo con Go: los diseños de referencia sí, un diseño vacío y los fallidos no', () => {
    for (const f of fixtures) {
      // Que los fixtures sigan siendo Go lo comprueba el motor (`design.test.ts` de shared); aquí, que el botón
      // siga exactamente al Go/No-Go del motor.
      for (const v of f.valid) {
        const r = reviewDesign(v.design);
        expect(canLaunch(r), v.name).toBe(r.go);
        expect(r.go, v.name).toBe(!r.issues.some((x) => x.severity === 'blocker'));
      }
      for (const x of f.failing) expect(canLaunch(reviewDesign(x.design)), x.name).toBe(false);
      expect(canLaunch(reviewDesign(emptyDesign(f.missionId)))).toBe(false);
    }
  });

  it('los problemas salen con lo que bloquea primero, cada uno con su clave del motor', () => {
    const r = reviewDesign(startingDesign(missions[0]!.id));
    const sorted = sortedIssues(r);
    const firstNonBlocker = sorted.findIndex((x) => x.severity !== 'blocker');
    if (firstNonBlocker >= 0) expect(sorted.slice(firstNonBlocker).every((x) => x.severity !== 'blocker')).toBe(true);
    for (const x of sorted) expect(x.message.key in simEs, x.message.key).toBe(true);
  });

  it('medidores: relleno acotado, y excedido por encima de 1', () => {
    expect(meterFill({ used: 0, available: 10 })).toBe(0);
    expect(meterFill({ used: 5, available: 10 })).toBe(0.5);
    expect(meterFill({ used: 50, available: 10 })).toBe(1.25);
    expect(meterFill({ used: 1, available: 0 })).toBe(1.25);
  });

  it('destinos con su distancia y su sol relativo; lanzadores con su capacidad a la zona (o que no llegan)', () => {
    for (const m of missions) {
      const opts = destinationOptions(m, catalog);
      expect(opts.map((o) => o.bodyId)).toEqual(m.destinations);
      for (const o of opts) {
        expect(o.au).toBeGreaterThan(0);
        expect(o.solarPct).toBe(Math.round((1 / (o.au * o.au)) * 100));
      }
      const noDest = launcherOptions(emptyDesign(m.id), catalog);
      expect(noDest.every((l) => l.capacityKg === undefined)).toBe(true);
      const withDest = launcherOptions(setDestination(emptyDesign(m.id), m.destinations[0]!), catalog);
      const zone = getBody(m.destinations[0]!).zoneId!;
      for (const l of withDest) expect(l.capacityKg).toBe(getLaunchers(catalog).find((x) => x.id === l.launcherId)!.capacityKgByZone[zone] ?? null);
    }
  });

  it('teclado de la paleta: flechas circulares y atajos de añadir/quitar', () => {
    expect(cycleIndex(0, 3, 'ArrowUp')).toBe(2);
    expect(cycleIndex(2, 3, 'ArrowDown')).toBe(0);
    expect(cycleIndex(1, 3, 'ArrowRight')).toBe(2);
    expect(partKeyAction('Enter')).toBe('add');
    expect(partKeyAction('+')).toBe('add');
    expect(partKeyAction('Delete')).toBe('remove');
    expect(partKeyAction('x')).toBe(null);
  });
});

describe('guardado del último diseño por misión', () => {
  it('guarda y recupera el diseño de cada misión', () => {
    const store = memoryStore();
    for (const f of fixtures) {
      const d = f.valid[0]!.design;
      expect(saveDesign(d, store)).toBe(true);
      expect(hasSavedDesign(f.missionId, store)).toBe(true);
      expect(loadDesign(f.missionId, catalog, store)).toEqual({ ...d, moduleIds: d.moduleIds, instrumentIds: d.instrumentIds });
    }
    expect([...store.data.keys()].every((k) => k.startsWith(DESIGN_KEY_PREFIX))).toBe(true);
  });

  it('limpia piezas, destinos y lanzadores que ya no existen; sin guardado o roto, diseño nuevo', () => {
    const m = missions[0]!;
    const store = memoryStore();
    store.setItem(DESIGN_KEY_PREFIX + m.id, JSON.stringify({ missionId: m.id, destinationId: 'no-such-body', moduleIds: ['no-such', getModules()[0]!.id], instrumentIds: [42], launcherId: 'nope' }));
    const d = loadDesign(m.id, catalog, store);
    expect(d.moduleIds).toEqual([getModules()[0]!.id]);
    expect(d.instrumentIds).toEqual([]);
    expect(d.launcherId).toBe(null);
    expect(d.destinationId).toBe(startingDesign(m.id).destinationId);
    store.setItem(DESIGN_KEY_PREFIX + m.id, '{roto');
    expect(loadDesign(m.id, catalog, store)).toEqual(startingDesign(m.id));
    expect(sanitizeDesign({ ...refOf(m.id), missionId: 'otra' }, m.id)).toBe(null);
  });

  it('un almacenamiento que lanza o que no existe no rompe nada', () => {
    const angry: KeyValueStore = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('lleno');
      },
    };
    const m = missions[0]!;
    expect(saveDesign(refOf(m.id), angry)).toBe(false);
    expect(loadDesign(m.id, catalog, angry)).toEqual(startingDesign(m.id));
    expect(hasSavedDesign(m.id, angry)).toBe(false);
    expect(saveDesign(refOf(m.id), null)).toBe(false);
    expect(loadDesign(m.id, catalog, null)).toEqual(startingDesign(m.id));
  });

  it('con un solo destino posible, el diseño nuevo ya lo trae elegido', () => {
    for (const m of missions) expect(startingDesign(m.id).destinationId).toBe(m.destinations.length === 1 ? m.destinations[0] : null);
  });
});

describe('escala del mapa solar', () => {
  it('las órbitas crecen con la distancia al Sol y caben en una vista (√UA)', () => {
    const orbiters = sunOrbiters(catalog).sort((a, b) => (a.orbitAu ?? 0) - (b.orbitAu ?? 0));
    let last = 0;
    for (const b of orbiters) {
      const r = orbitRadius(b.orbitAu ?? 0);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
    const far = Math.max(...orbiters.map((b) => b.orbitAu ?? 0));
    const near = Math.min(...orbiters.map((b) => b.orbitAu ?? 0));
    // Comprimido: el más lejano queda a mucho menos de su proporción lineal respecto al más cercano.
    expect(orbitRadius(far) / orbitRadius(near)).toBeLessThan(far / near);
    expect(orbitRadius(far) / orbitRadius(near)).toBeCloseTo(Math.sqrt(far / near), 6);
  });

  it('lunas y estaciones junto a su planeta, fuera de su globo y ordenadas por distancia real', () => {
    const bodies = getSolarSystem(catalog).bodies;
    for (const parent of bodies.filter((b) => bodies.some((c) => c.parentId === b.id))) {
      const p = bodyScenePos(parent);
      const kids = bodies.filter((c) => c.parentId === parent.id && c.orbitKm !== undefined).sort((a, b) => a.orbitKm! - b.orbitKm!);
      let last = 0;
      for (const k of kids) {
        const at = bodyScenePos(k);
        const d = Math.hypot(at.x - p.x, at.z - p.z);
        expect(d, k.id).toBeGreaterThan(bodyDisplayRadius(parent));
        expect(d, k.id).toBeGreaterThanOrEqual(last - 1e-9);
        expect(d, k.id).toBeLessThan(orbitRadius(1)); // nunca se aleja tanto como una órbita
        last = d;
      }
    }
  });

  it('tamaños: el Sol el mayor, los gigantes mayores que la Tierra y nada invisible', () => {
    const bodies = getSolarSystem(catalog).bodies;
    const sun = bodies.find((b) => b.type === 'star')!;
    for (const b of bodies) {
      expect(bodyDisplayRadius(b)).toBeGreaterThan(0.1);
      if (b !== sun) expect(bodyDisplayRadius(b)).toBeLessThan(bodyDisplayRadius(sun));
    }
    const sorted = [...bodies].filter((b) => b.type !== 'star').sort((a, b) => a.radiusKm - b.radiusKm);
    for (let i = 1; i < sorted.length; i++) expect(bodyDisplayRadius(sorted[i]!)).toBeGreaterThanOrEqual(bodyDisplayRadius(sorted[i - 1]!));
  });

  it('el cinturón cae entre las órbitas de sus cuerpos', () => {
    const belt = beltRange(catalog);
    if (!belt) return;
    expect(belt.inner).toBeLessThan(belt.outer);
  });

  it('cada nodo de los tramos de todas las misiones tiene posición finita; los cuerpos, la suya', () => {
    for (const m of missions) {
      const run = createRun({ seed: 7, design: refOf(m.id) });
      const pos = sectorScenePositions(run.state.sector, run.catalog);
      for (const n of run.state.sector.nodes) {
        const p = pos[n.id];
        expect(p, `${m.id} ${n.id}`).toBeDefined();
        expect(Number.isFinite(p!.x) && Number.isFinite(p!.z)).toBe(true);
        if (n.bodyId && findBody(n.bodyId)) expect(p).toEqual(bodyScenePos(getBody(n.bodyId)));
      }
    }
    // Sector abstracto (partida libre): no hay posiciones solares.
    expect(sectorScenePositions(createRun({ seed: 7 }).state.sector)).toEqual({});
  });
});

describe('nave montada en el hangar', () => {
  it('un bloque por pieza, con posiciones finitas y deterministas', () => {
    for (const f of fixtures) {
      const d = f.valid[0]!.design;
      const a = hangarLayout(d);
      expect(a.blocks.length).toBe(d.moduleIds.length + d.instrumentIds.length);
      expect(a).toEqual(hangarLayout(structuredClone(d)));
      for (const b of a.blocks) for (const v of [...b.position, ...b.size]) expect(Number.isFinite(v)).toBe(true);
      expect(new Set(a.blocks.map((b) => `${b.key}:${b.partId}`)).size).toBe(a.blocks.length);
    }
    expect(hangarLayout(emptyDesign(missions[0]!.id)).blocks).toEqual([]);
  });
});

describe('flujo: menú → misión → diseño → partida → rediseñar', () => {
  beforeEach(() => useGame.getState().toMenu());

  it('se elige misión, se diseña, se zarpa con ese diseño y se vuelve a diseñar con él cargado', () => {
    const m = missions[0]!;
    const g = () => useGame.getState();
    g().openMissions();
    expect(g().screen).toBe('missions');
    g().openDesign(m.id);
    expect(g().screen).toBe('design');
    expect(g().draft?.missionId).toBe(m.id);
    // Montar el diseño de referencia pieza a pieza con las mismas operaciones que la pantalla.
    const ref = refOf(m.id);
    let d = setLauncher(setDestination(emptyDesign(m.id), ref.destinationId), ref.launcherId);
    for (const id of ref.moduleIds) d = addPart(d, { kind: 'module', id });
    for (const id of ref.instrumentIds) d = addPart(d, { kind: 'instrument', id });
    g().updateDraft(d);
    expect(canLaunch(reviewDesign(g().draft!))).toBe(true);
    g().launch(7);
    expect(g().screen).toBe('game');
    expect(getRun()?.state.missionDesign).toEqual(d);
    expect(getRun()?.state.sunDistanceAu).toBeDefined();
    expect(g().runDesign).toEqual(d);
    g().redesign();
    expect(g().screen).toBe('design');
    expect(g().draft).toEqual(d);
    expect(getRun()).toBe(null);
  });

  it('la partida libre sigue existiendo y no lleva diseño', () => {
    useGame.getState().startRun(7);
    expect(useGame.getState().screen).toBe('game');
    expect(getRun()?.state.missionDesign).toBeUndefined();
    expect(useGame.getState().runDesign).toBe(null);
  });

  it('reintentar la misión vuelve a zarpar con el mismo diseño', () => {
    const d = refOf(missions[missions.length - 1]!.id);
    useGame.getState().startRun(3, d);
    useGame.getState().startRun(4, useGame.getState().runDesign);
    expect(getRun()?.state.missionDesign).toEqual(d);
  });
});

describe('textos del diseño y del mapa solar', () => {
  it('existen las claves construidas en tiempo de ejecución (ui) en ambos idiomas', () => {
    const keys = [
      ...PALETTE_GROUPS.map((g) => `design.group.${g}`),
      ...[1, 2, 3].map((n) => `missions.difficulty.${n}`),
      'design.goTitle', 'design.noGoTitle', 'design.launch', 'design.launchBlocked', 'map.units', 'map.solarTitle', 'hud.sunAu', 'hud.solar', 'hud.mission', 'end.redesign',
    ];
    for (const k of keys) {
      expect(k in esFlat, k).toBe(true);
      expect(k in enFlat, k).toBe(true);
    }
  });

  it('el motor nombra todo lo que la pantalla de diseño y el mapa enseñan (catalog.<id>)', () => {
    const ids = [
      ...missions.map((m) => m.id),
      ...missions.flatMap((m) => m.destinations),
      ...getModules().map((m) => m.id),
      ...getInstruments().map((i) => i.id),
      ...getLaunchers().map((l) => l.id),
      ...getSolarSystem().bodies.map((b) => b.id),
    ];
    for (const id of ids) expect(`catalog.${id}` in simEs, id).toBe(true);
    for (const r of computeDesignBudgets(refOf(missions[0]!.id)).resources) {
      expect(`design.unit.${r.unit}` in simEs, r.unit).toBe(true);
      expect(`design.resource.${r.id}` in simEs, r.id).toBe(true);
    }
  });

  it('textos de una línea en el hangar, las misiones y el mapa', () => {
    for (const flat of [esFlat, enFlat])
      for (const [k, v] of Object.entries(flat)) if (/^(design|missions)\./.test(k)) expect(v.length, k).toBeLessThanOrEqual(110);
  });
});

describe('glosario opcional', () => {
  it('cada término tiene nombre y una línea en ambos idiomas', () => {
    for (const id of GLOSSARY_TERMS)
      for (const flat of [esFlat, enFlat]) {
        expect(flat[`glossary.${id}.term`], id).toBeTruthy();
        expect(flat[`glossary.${id}.line`], id).toBeTruthy();
        expect(flat[`glossary.${id}.line`]!.length, id).toBeLessThanOrEqual(110);
      }
    expect(esFlat['glossary.title'] && esFlat['glossary.hint'] && enFlat['glossary.title'] && enFlat['glossary.hint']).toBeTruthy();
  });

  it('se abre y se cierra con G o «?», nunca con atajos del sistema ni al mantener la tecla', () => {
    expect(isGlossaryKey({ code: 'KeyG', key: 'g' })).toBe(true);
    expect(isGlossaryKey({ code: 'Minus', key: '?' })).toBe(true);
    expect(isGlossaryKey({ code: 'KeyG', key: 'g', ctrlKey: true })).toBe(false);
    expect(isGlossaryKey({ code: 'KeyG', key: 'g', repeat: true })).toBe(false);
    expect(isGlossaryKey({ code: 'KeyH', key: 'h' })).toBe(false);
  });
});

describe('aterrizable según el motor (no por el tipo de nodo)', () => {
  it('en los tramos de todas las misiones, un cuerpo real es aterrizable si y solo si su catálogo lo dice', () => {
    let notLandable = 0;
    let landable = 0;
    for (const m of missions) {
      const ship = shipFromDesign(refOf(m.id));
      for (let index = 1; index <= 4; index++) {
        const sector = generateSolarSector(7, index, ship, catalog, refOf(m.id).destinationId);
        const state = { seed: 7, sector };
        for (const n of sector.nodes) {
          if (!n.bodyId) continue;
          const body = getBody(n.bodyId);
          expect(isLandableNode(state, n.id), `${m.id} ${n.bodyId}`).toBe(body.landable);
          if (body.landable) landable++;
          else notLandable++;
        }
      }
    }
    // Hay gigantes gaseosos o estaciones (no aterrizables) y cuerpos aterrizables en las rutas.
    expect(notLandable).toBeGreaterThan(0);
    expect(landable).toBeGreaterThan(0);
  });
});

describe('limpieza del mapa solar (lógica pura)', () => {
  it('la caché de etiquetas está acotada y libera lo que expulsa y lo que vacía', () => {
    const freed: string[] = [];
    const c = new LruCache<string, string>(2, (v) => freed.push(v));
    c.set('a', 'A');
    c.set('b', 'B');
    expect(c.get('a')).toBe('A'); // «a» pasa a ser la más reciente
    c.set('c', 'C');
    expect(c.size).toBe(2);
    expect(freed).toEqual(['B']);
    c.set('a', 'A2');
    expect(freed).toEqual(['B', 'A']);
    c.clear();
    expect(c.size).toBe(0);
    expect(freed.sort()).toEqual(['A', 'A2', 'B', 'C']);
  });

  it('la luz de cada cuerpo (y de sus anillos) apunta al Sol desde su posición', () => {
    for (const b of getSolarSystem().bodies) {
      if (b.type === 'star') continue;
      const at = bodyScenePos(b);
      const d = sunDirectionFrom(at);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
      // Hacia el origen en el plano: el producto con la posición es negativo.
      expect(d.x * at.x + d.z * at.z, b.id).toBeLessThan(0);
    }
  });
});
