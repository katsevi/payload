/**
 * Fase 4 (ADR 0016): diseño de misión. Catálogo, fixtures por misión (>= 2 soluciones válidas y >= 2 causas de
 * fallo distintas), presupuestos, Go/No-Go, nave diseñada + mejoras y mensajes de una línea en es/en.
 */
import { describe, expect, it } from 'vitest';
import es from '../../locales/es.json';
import {
  catalog, computeDesignBudgets, createRun, cruisePowerMarginKw, DESIGN_RESOURCE_IDS, effectiveShip, emptyDesign, generateSolarSector, normalizeDesign, parseMissionDesign,
  routeWorstSunDistance, routeZones, flattenKeys, formatMessage, getDesignRules, getMission, getMissions,
  getModule, getShip, lookupSimKey, parseCatalog, reviewDesign, shipFromDesign, solarPowerFactor,
  type Catalog, type MessageRef, type MissionDesign,
} from '../index';
import { hasMissionFixture, loadMissionFixture, referenceDesign } from './missionFixtures';

const T = 'fuel-tank-module';
const clone = (): Catalog => JSON.parse(JSON.stringify(catalog)) as Catalog;

/** Diseño lunar sin ningún aviso (márgenes sanos). */
const healthyLunar: MissionDesign = {
  missionId: 'mission-lunar-ice', destinationId: 'luna', launcherId: 'launcher-condor',
  moduleIds: ['frame-heavy', 'engine-chemical', 'solar-array-hi', 'solar-array-hi', 'comms-lga', 'computer-flight', 'battery-pack', 'shield-generator', T, T],
  instrumentIds: ['inst-neutron', 'inst-neutron', 'inst-neutron'],
};

const codes = (d: MissionDesign, severity?: 'blocker' | 'warning', cat: Catalog = catalog) =>
  reviewDesign(d, cat).issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);

describe('catálogo del diseño (fase 4)', () => {
  it('trae misiones, módulos, instrumentos, lanzadores, reglas y sistema solar, y parseCatalog los pone si faltan', () => {
    expect(getMissions().length).toBeGreaterThanOrEqual(5);
    expect(catalog.modules!.length).toBeGreaterThan(10);
    expect(catalog.instruments!.length).toBeGreaterThan(5);
    expect(catalog.launchers!.length).toBeGreaterThanOrEqual(3);
    const raw = clone() as unknown as Record<string, unknown>;
    for (const k of ['design', 'missions', 'modules', 'instruments', 'launchers', 'solarSystem']) delete raw[k];
    const parsed = parseCatalog(raw);
    expect(parsed.missions).toEqual(catalog.missions);
    expect(parsed.solarSystem).toEqual(catalog.solarSystem);
  });

  it('rechaza referencias rotas con un mensaje legible', () => {
    const bad = clone();
    bad.missions![0]!.destinations = ['pluton'];
    bad.launchers![0]!.capacityKgByZone = { 'zone-kuiper': 10 };
    bad.solarSystem!.bodies.find((b) => b.id === 'luna')!.worldId = 'storm-world';
    bad.modules![0]!.effects = [{ target: 'ship', field: 'warpCores', add: 1 }];
    expect(() => parseCatalog(bad)).toThrow(/pluton[\s\S]*zone-kuiper|zone-kuiper[\s\S]*pluton/);
    expect(() => parseCatalog(bad)).toThrow(/storm-world/);
    expect(() => parseCatalog(bad)).toThrow(/warpCores/);
    const dup = clone();
    dup.modules![1]!.id = dup.modules![0]!.id;
    expect(() => parseCatalog(dup)).toThrow(/id repetido/);
  });
});

describe('fixtures por misión: varias soluciones válidas y fallos por causas distintas', () => {
  it.each(getMissions().map((m) => m.id))('%s tiene fixture', (missionId) => {
    expect(hasMissionFixture(missionId), `falta src/__tests__/fixtures/missions/${missionId}.json`).toBe(true);
    const f = loadMissionFixture(missionId);
    expect(f.missionId).toBe(missionId);
    expect(f.valid.length).toBeGreaterThanOrEqual(2);
    expect(f.failing.length).toBeGreaterThanOrEqual(2);
  });

  it.each(getMissions().map((m) => m.id))('%s: los válidos tienen Go y son soluciones distintas', (missionId) => {
    const f = loadMissionFixture(missionId);
    const shapes = new Set<string>();
    for (const v of f.valid) {
      expect(v.design.missionId).toBe(missionId);
      const r = reviewDesign(v.design);
      expect(r.go, `${v.name}: ${r.issues.map((i) => i.code).join(', ')}`).toBe(true);
      expect(r.issues.some((i) => i.severity === 'blocker')).toBe(false);
      shapes.add(JSON.stringify([[...v.design.moduleIds].sort(), [...v.design.instrumentIds].sort(), v.design.launcherId]));
    }
    expect(shapes.size).toBe(f.valid.length);
  });

  it.each(getMissions().map((m) => m.id))('%s: cada fallo es No-Go por su causa, y las causas son distintas', (missionId) => {
    const f = loadMissionFixture(missionId);
    const causes = new Set<string>();
    for (const x of f.failing) {
      expect(x.cause, x.name).toBeTruthy();
      const r = reviewDesign(x.design);
      expect(r.go, x.name).toBe(false);
      const blockers = r.issues.filter((i) => i.severity === 'blocker').map((i) => i.code);
      expect(blockers, `${x.name}: ${blockers.join(', ')}`).toContain(x.cause);
      causes.add(x.cause!);
    }
    expect(causes.size).toBeGreaterThanOrEqual(2);
  });
});

describe('presupuestos del diseño', () => {
  it('devuelve los seis recursos en orden, con totales coherentes', () => {
    const b = computeDesignBudgets(healthyLunar);
    expect(b.resources.map((r) => r.id)).toEqual([...DESIGN_RESOURCE_IDS]);
    const ship = shipFromDesign(healthyLunar);
    expect(b.totals.massKg).toBe(ship.dryMassKg);
    expect(b.totals.fuelCapacity).toBe(ship.fuelCapacity);
    expect(b.totals.slots).toBe(getModule('frame-heavy').slots);
    for (const r of b.resources) {
      expect(['ok', 'tight', 'over']).toContain(r.status);
      expect(r.why.key.startsWith('design.why.')).toBe(true);
    }
  });

  it('margen y estado: over si se excede, tight por debajo de tightMargin, ok si sobra', () => {
    const tight = getDesignRules().tightMargin;
    for (const r of computeDesignBudgets(healthyLunar).resources) {
      expect(r.margin).toBeCloseTo((r.available - r.used) / r.available, 9);
      expect(r.status).toBe(r.margin < 0 ? 'over' : r.margin < tight ? 'tight' : 'ok');
    }
    const heavy = { ...healthyLunar, moduleIds: [...healthyLunar.moduleIds, T, T, T] };
    const mass = computeDesignBudgets(heavy).resources.find((r) => r.id === 'mass')!;
    expect(mass.status).toBe('over');
    expect(mass.why.key).toBe('design.why.mass.launcher');
  });

  it('la masa disponible es el menor límite: lanzador hacia la zona del destino o estructura', () => {
    const light = { ...healthyLunar, moduleIds: healthyLunar.moduleIds.map((m) => (m === 'frame-heavy' ? 'frame-light' : m)) };
    const byStructure = computeDesignBudgets({ ...light, launcherId: 'launcher-colossus' }).resources.find((r) => r.id === 'mass')!;
    expect(byStructure.available).toBe(getModule('frame-light').maxMassKg);
    expect(byStructure.why.key).toBe('design.why.mass.structure');
    // El mismo lanzador lleva menos cuanto más lejos está el destino.
    const toMars = computeDesignBudgets({ ...healthyLunar, missionId: 'mission-mars-habitability', destinationId: 'mars' }).resources.find((r) => r.id === 'mass')!;
    const toMoon = computeDesignBudgets(healthyLunar).resources.find((r) => r.id === 'mass')!;
    expect(toMars.available).toBeLessThan(toMoon.available);
  });

  it('la potencia en el destino baja con 1/d² en los paneles y no en los RTG', () => {
    const solar = computeDesignBudgets({ ...healthyLunar, missionId: 'mission-mars-habitability', destinationId: 'mars' }).totals;
    const atMoon = computeDesignBudgets(healthyLunar).totals;
    expect(solar.solarKwAt1Au).toBe(atMoon.solarKwAt1Au);
    expect(solar.solarKwAtDestination).toBeCloseTo(atMoon.solarKwAt1Au * solarPowerFactor(1.524), 6);
    const rtg = { ...healthyLunar, moduleIds: healthyLunar.moduleIds.map((m) => (m.startsWith('solar') ? 'rtg' : m)) };
    const rtgMoon = computeDesignBudgets(rtg).totals;
    const rtgMars = computeDesignBudgets({ ...rtg, missionId: 'mission-mars-habitability', destinationId: 'mars' }).totals;
    expect(rtgMars.powerAtDestinationKw).toBe(rtgMoon.powerAtDestinationKw);
    expect(rtgMars.powerAtDestinationKw).toBe(2 * 25);
  });

  it('un diseño vacío no rompe nada: sin recurso limitante y todo explicado', () => {
    const b = computeDesignBudgets(emptyDesign('mission-lunar-ice'));
    expect(b.limiting).toBeNull();
    expect(b.resources.every((r) => r.why.key.length > 0)).toBe(true);
    expect(reviewDesign(emptyDesign('mission-lunar-ice')).go).toBe(false);
  });

  it('el orden de las piezas no importa (sumas y productos)', () => {
    const shuffled = { ...healthyLunar, moduleIds: [...healthyLunar.moduleIds].reverse(), instrumentIds: [...healthyLunar.instrumentIds].reverse() };
    expect(computeDesignBudgets(shuffled)).toEqual(computeDesignBudgets(healthyLunar));
    expect(shipFromDesign(shuffled)).toEqual(shipFromDesign(healthyLunar));
  });

  it('es barata: 300 evaluaciones completas en menos de un segundo', () => {
    // Los diseños se leen del disco ANTES de cronometrar: se mide la revisión, no la lectura de los fixtures.
    const designs = getMissions().map((m) => referenceDesign(m.id));
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) reviewDesign(designs[i % designs.length]!);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('Go/No-Go', () => {
  it('un diseño sano es Go sin avisos', () => {
    const r = reviewDesign(healthyLunar);
    expect(r.go).toBe(true);
    expect(r.issues.map((i) => i.code)).toEqual(['all-clear']);
  });

  it('bloquea lo que falta o sobra en la nave', () => {
    const base = { ...healthyLunar, moduleIds: [] as string[] };
    expect(codes(base, 'blocker')).toEqual(expect.arrayContaining(['no-structure', 'no-propulsion', 'no-power', 'no-comms', 'no-computer']));
    const twice = { ...healthyLunar, moduleIds: [...healthyLunar.moduleIds, 'frame-light', 'engine-ion'] };
    expect(codes(twice, 'blocker')).toEqual(expect.arrayContaining(['multiple-structures', 'multiple-propulsion']));
  });

  it('bloquea selecciones desconocidas o no permitidas', () => {
    expect(codes({ ...healthyLunar, missionId: 'mission-nope' }, 'blocker')).toContain('unknown-mission');
    expect(codes({ ...healthyLunar, destinationId: null }, 'blocker')).toContain('no-destination');
    expect(codes({ ...healthyLunar, destinationId: 'pluton' }, 'blocker')).toContain('unknown-destination');
    expect(codes({ ...healthyLunar, destinationId: 'mars' }, 'blocker')).toContain('destination-not-allowed');
    expect(codes({ ...healthyLunar, launcherId: null }, 'blocker')).toContain('no-launcher');
    expect(codes({ ...healthyLunar, launcherId: 'launcher-nope' }, 'blocker')).toContain('unknown-launcher');
    expect(codes({ ...healthyLunar, moduleIds: [...healthyLunar.moduleIds, 'warp-core'] }, 'blocker')).toContain('unknown-module');
    expect(codes({ ...healthyLunar, instrumentIds: ['inst-tricorder'] }, 'blocker')).toContain('unknown-instrument');
  });

  it('explica cada recurso que no llega: ranuras, masa, potencia, coste, calendario, combustible y enlace', () => {
    const light = healthyLunar.moduleIds.map((m) => (m === 'frame-heavy' ? 'frame-light' : m));
    expect(codes({ ...healthyLunar, moduleIds: [...light, 'whipple-armor'], instrumentIds: ['inst-neutron', 'inst-radar', 'inst-camera'] }, 'blocker')).toContain('slots');
    expect(codes({ ...healthyLunar, moduleIds: [...healthyLunar.moduleIds, T, T, T] }, 'blocker')).toContain('mass-launcher');
    expect(codes({ ...healthyLunar, moduleIds: [...light, T, T], launcherId: 'launcher-colossus' }, 'blocker')).toContain('mass-structure');
    expect(codes({ ...healthyLunar, missionId: 'mission-europa-ocean', destinationId: 'europa', launcherId: 'launcher-condor' }, 'blocker')).toContain('launcher-cannot-reach');
    expect(codes({ ...healthyLunar, moduleIds: healthyLunar.moduleIds.filter((m, i) => i !== healthyLunar.moduleIds.indexOf('solar-array-hi')) }, 'blocker')).toContain('power');
    expect(codes({ ...healthyLunar, launcherId: 'launcher-colossus' }, 'blocker')).toContain('cost');
    expect(codes({ ...healthyLunar, moduleIds: [...healthyLunar.moduleIds, 'fission-reactor'] }, 'blocker')).toContain('schedule');
    expect(codes({ ...healthyLunar, moduleIds: healthyLunar.moduleIds.filter((m) => m !== T) }, 'blocker')).toContain('range');
    const ceres = referenceDesign('mission-belt-ice');
    expect(codes({ ...ceres, moduleIds: ceres.moduleIds.map((m) => (m === 'comms-hga' ? 'comms-lga' : m)) }, 'blocker')).toContain('comms-range');
  });

  it('exige los tipos de ciencia de la misión y la ciencia mínima', () => {
    const geo = codes({ ...healthyLunar, instrumentIds: ['inst-camera'] }, 'blocker');
    expect(geo).toContain('missing-science-kind');
    expect(geo).toContain('science');
    const mission = getMission('mission-lunar-ice');
    const r = computeDesignBudgets({ ...healthyLunar, instrumentIds: ['inst-neutron', 'inst-camera'] });
    expect(r.totals.scienceValue).toBe(25 + 20 * getDesignRules().offKindScienceMult);
    expect(r.totals.scienceValue).toBeLessThan(mission.requirements.minScience);
  });

  it('avisa (sin bloquear) de fiabilidad baja, baterías, calor, radiación, escudos y márgenes justos', () => {
    const cat = clone();
    cat.missions!.find((m) => m.id === 'mission-lunar-ice')!.requirements.minReliabilityPct = 99;
    expect(codes(healthyLunar, 'warning', parseCatalog(cat))).toContain('reliability');
    const noBattery = { ...healthyLunar, moduleIds: healthyLunar.moduleIds.filter((m) => m !== 'battery-pack') };
    expect(codes(noBattery, 'warning')).toContain('no-battery');
    expect(reviewDesign(noBattery).go).toBe(true);
    const hot = { ...healthyLunar, moduleIds: healthyLunar.moduleIds.map((m) => (m === 'engine-chemical' ? 'engine-ion' : m)) };
    expect(codes(hot, 'warning')).toContain('thermal');
    const europa = referenceDesign('mission-europa-ocean');
    expect(codes({ ...europa, moduleIds: europa.moduleIds.map((m) => (m === 'computer-rad' ? 'computer-flight' : m)) }, 'warning')).toContain('radiation');
    expect(codes({ ...healthyLunar, moduleIds: healthyLunar.moduleIds.filter((m) => m !== 'shield-generator') }, 'warning')).toContain('no-shielding');
    const tight = reviewDesign({ ...healthyLunar, moduleIds: [...healthyLunar.moduleIds, T] }).issues.filter((i) => i.code === 'tight');
    expect(tight.map((i) => i.message.params?.resource)).toContain('mass');
  });
});

describe('nave diseñada (shipFromDesign) y mejoras encima (effectiveShip)', () => {
  it('los módulos dan casco, depósito, energía, escudos y consumos; los instrumentos tiran de los sensores', () => {
    const ship = shipFromDesign(healthyLunar);
    const base = getShip(getDesignRules().baseShipId);
    expect(ship.id).toBe(base.id); // el cliente puede seguir buscando la nave en el catálogo
    expect(ship.name).toEqual(getDesignRules().shipName);
    expect(ship.hullMax).toBe(130);
    expect(ship.fuelCapacity).toBe(80);
    expect(ship.startFuel).toBe(ship.fuelCapacity);
    expect(ship.reactorOutputKw).toBe(0);
    expect(ship.solarKwAt1Au).toBe(200);
    expect(ship.shieldAbsorb).toBeCloseTo(0.65, 9);
    expect(ship.systemDrawKw.engines).toBe(40);
    expect(ship.systemDrawKw.shields).toBe(30);
    expect(ship.systemDrawKw.nav).toBe(base.systemDrawKw.nav + 2 + 1 + 3 * 1);
    expect(ship.throttles).toBe(base.throttles);
  });

  it('la masa encarece el combustible por año luz (× masa / referencia)', () => {
    const rules = getDesignRules();
    const ship = shipFromDesign(healthyLunar);
    expect(ship.fuelPerLy).toBeCloseTo(getShip(rules.baseShipId).fuelPerLy * (ship.dryMassKg! / rules.referenceMassKg) ** rules.massFuelExponent, 9);
    const heavier = shipFromDesign({ ...healthyLunar, moduleIds: [...healthyLunar.moduleIds, 'whipple-armor'] });
    expect(heavier.fuelPerLy).toBeGreaterThan(ship.fuelPerLy);
    expect(heavier.hullMax).toBe(ship.hullMax + 40);
    // La propulsión iónica gasta la mitad por año luz (con la misma masa) y pide más potencia.
    const ion = shipFromDesign({ ...healthyLunar, moduleIds: healthyLunar.moduleIds.map((m) => (m === 'engine-chemical' ? 'engine-ion' : m)) });
    expect(ion.fuelPerLy).toBeLessThan(ship.fuelPerLy * 0.5);
    expect(ion.systemDrawKw.engines).toBeGreaterThan(ship.systemDrawKw.engines);
  });

  it('las mejoras de la fase 3 se aplican encima de la nave diseñada', () => {
    const designed = shipFromDesign(healthyLunar);
    const upgraded = effectiveShip(designed, { 'fuel-tank': 1, 'reactor-heatsink': 1, 'hull-plating': 2 }, catalog);
    expect(upgraded.fuelCapacity).toBe(designed.fuelCapacity + 25);
    expect(upgraded.hullMax).toBe(designed.hullMax + 50);
    expect(upgraded.reactorOutputKw).toBe(designed.reactorOutputKw + 10);
    expect(upgraded.solarKwAt1Au).toBe(designed.solarKwAt1Au);
    expect(effectiveShip(designed, {}, catalog)).toEqual(designed);
  });
});

describe('mensajes del diseño (una línea, es/en)', () => {
  it('toda MessageRef de presupuestos y revisiones existe en ambos idiomas y se resuelve del todo', () => {
    const designs: MissionDesign[] = [healthyLunar, emptyDesign('mission-lunar-ice'), emptyDesign('mission-nope')];
    for (const m of getMissions()) {
      const f = loadMissionFixture(m.id);
      designs.push(...f.valid.map((x) => x.design), ...f.failing.map((x) => x.design));
      designs.push({ ...f.valid[0]!.design, destinationId: null }, { ...f.valid[0]!.design, launcherId: 'launcher-nope', moduleIds: [] });
    }
    // Rarezas para cubrir todos los códigos.
    const light = healthyLunar.moduleIds.map((x) => (x === 'frame-heavy' ? 'frame-light' : x));
    designs.push(
      { ...healthyLunar, destinationId: 'pluton', moduleIds: [...healthyLunar.moduleIds, 'warp-core', 'frame-light', 'engine-ion'], instrumentIds: ['inst-tricorder'] },
      { ...healthyLunar, destinationId: 'mars' },
      { ...healthyLunar, moduleIds: [...light, T, T], launcherId: 'launcher-colossus' },
      { ...healthyLunar, moduleIds: [...light, 'whipple-armor'], instrumentIds: ['inst-neutron', 'inst-radar', 'inst-camera'] },
      { ...healthyLunar, moduleIds: [...healthyLunar.moduleIds, 'fission-reactor'] },
      { ...healthyLunar, moduleIds: healthyLunar.moduleIds.filter((x) => x !== 'battery-pack' && x !== 'shield-generator') },
    );
    const europa = referenceDesign('mission-europa-ocean');
    designs.push({ ...europa, moduleIds: europa.moduleIds.map((x) => (x === 'computer-rad' ? 'computer-flight' : x)) });
    const strict = clone();
    for (const m of strict.missions!) m.requirements.minReliabilityPct = 99;
    const strictCat = parseCatalog(strict);

    const refs: MessageRef[] = [];
    for (const d of designs) {
      const r = reviewDesign(d);
      refs.push(...r.issues.map((i) => i.message), ...r.budgets.resources.map((x) => x.why));
    }
    refs.push(...reviewDesign(healthyLunar, strictCat).issues.map((i) => i.message));
    // Fase 8: con la cordura activa, las misiones largas sin hábitat avisan (`crew-wellbeing`).
    const psychCat = parseCatalog({ ...clone(), psych: { ...catalog.psych!, enabled: true } });
    refs.push(...reviewDesign(europa, psychCat).issues.map((i) => i.message));

    const keys = new Set<string>();
    for (const ref of refs) {
      keys.add(ref.key);
      for (const locale of ['es', 'en'] as const) {
        const template = lookupSimKey(ref.key, locale);
        expect(template, `${ref.key} (${locale})`).toBeDefined();
        for (const [, p] of template!.matchAll(/\{\{(\w+)\}\}/g)) expect(ref.params && p! in ref.params, `${ref.key}: falta "${p}"`).toBe(true);
        const text = formatMessage(ref, locale);
        expect(text, `${ref.key} (${locale}): ${text}`).not.toMatch(/\{\{|\$t\(|\b(catalog|design)\.[A-Za-z]/);
        expect(text.length, text).toBeLessThanOrEqual(100);
        expect(text).not.toMatch(/\n/);
      }
    }
    // Todos los motivos declarados salen en algún diseño.
    for (const key of flattenKeys(es).filter((k) => /^design\.(review|why)\./.test(k))) expect(keys.has(key), `nunca se emitió ${key}`).toBe(true);
  });

  it('hay etiqueta para cada recurso, unidad, estado, tipo de ciencia y familia de módulo, y nombre para cada pieza', () => {
    for (const locale of ['es', 'en'] as const) {
      for (const r of computeDesignBudgets(healthyLunar).resources) {
        expect(lookupSimKey(`design.resource.${r.id}`, locale)).toBeDefined();
        expect(lookupSimKey(`design.unit.${r.unit}`, locale)).toBeDefined();
        expect(lookupSimKey(`design.status.${r.status}`, locale)).toBeDefined();
      }
      for (const i of catalog.instruments!) expect(lookupSimKey(`design.science.${i.scienceKind}`, locale)).toBeDefined();
      for (const m of catalog.modules!) expect(lookupSimKey(`design.moduleKind.${m.kind}`, locale)).toBeDefined();
      for (const e of [...catalog.missions!, ...catalog.modules!, ...catalog.instruments!, ...catalog.launchers!, ...catalog.solarSystem!.zones, ...catalog.solarSystem!.bodies]) {
        expect(lookupSimKey(`catalog.${e.id}`, locale)).toBe(e.name[locale]);
      }
    }
  });
});

describe('potencia en el peor punto de la ruta', () => {
  it('se mide en el punto más alejado del Sol de la ruta y el «¿por qué?» dice dónde está', () => {
    const t = computeDesignBudgets(healthyLunar).totals;
    // La Luna está a 1 UA, pero la ruta pasa por Ryugu (1,19 UA).
    expect(t.worstBodyId).toBe('ryugu');
    expect(t.worstAu).toBeCloseTo(1.19, 3);
    expect(t.powerAtWorstKw).toBeLessThan(t.powerAtDestinationKw);
    const power = computeDesignBudgets(healthyLunar).resources.find((r) => r.id === 'power')!;
    expect(power.available).toBeCloseTo(t.powerAtWorstKw, 9);
    expect(power.why).toMatchObject({ key: 'design.why.power.worst', params: { body: 'ryugu' } });
    expect(routeWorstSunDistance('vesta').bodyId).toBe('psyche');
  });

  it('ningún diseño Go se sobrecarga a crucero en ningún nodo de su ruta', () => {
    const designs = [healthyLunar, ...getMissions().flatMap((m) => loadMissionFixture(m.id).valid.map((v) => v.design))];
    for (const design of designs) {
      expect(reviewDesign(design).go).toBe(true);
      const ship = shipFromDesign(design);
      const legs = Math.max(2, 2 * (routeZones(design.destinationId).length - 1));
      for (let seed = 1; seed <= 8; seed++) {
        for (let index = 1; index <= legs; index++) {
          const sector = generateSolarSector(seed, index, ship, catalog, design.destinationId);
          for (const n of sector.nodes) {
            expect(cruisePowerMarginKw(ship, n.sunDistanceAu!), `${design.missionId} ${n.bodyId ?? n.name} ${n.sunDistanceAu}`).toBeGreaterThanOrEqual(-1e-9);
          }
        }
      }
    }
  });
});

describe('forma del diseño (MissionDesign)', () => {
  it('createRun rechaza un diseño mal formado con un error claro', () => {
    expect(() => createRun({ seed: 1, design: { ...healthyLunar, moduleIds: null } as unknown as MissionDesign })).toThrow(/Diseño de misión inválido[\s\S]*moduleIds/);
    expect(() => parseMissionDesign({ missionId: 'mission-lunar-ice' })).toThrow(/Diseño de misión inválido/);
    expect(parseMissionDesign(healthyLunar)).toEqual(healthyLunar);
  });

  it('las funciones puras tratan lo mal formado como vacío (no lanzan)', () => {
    const broken = { missionId: 'mission-lunar-ice', moduleIds: null, instrumentIds: 'x', destinationId: 7 } as unknown as MissionDesign;
    expect(normalizeDesign(broken)).toEqual(emptyDesign('mission-lunar-ice'));
    expect(() => shipFromDesign(broken)).not.toThrow();
    expect(shipFromDesign(broken)).toEqual(shipFromDesign(emptyDesign('mission-lunar-ice')));
    expect(reviewDesign(broken).go).toBe(false);
    expect(computeDesignBudgets(broken)).toEqual(computeDesignBudgets(emptyDesign('mission-lunar-ice')));
  });

  it('el tope de absorción de los escudos sale de las reglas del catálogo', () => {
    const cat = clone();
    cat.design!.maxShieldAbsorb = 0.5;
    expect(shipFromDesign(healthyLunar, parseCatalog(cat)).shieldAbsorb).toBe(0.5);
  });
});
