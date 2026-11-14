// Fase 4 (ADR 0015): roles con ventajas pasivas, espejo del cliente (`hydrate`) y validación de red.
import { describe, expect, it } from 'vitest';
import {
  catalog, COOP_LIMITS, createRun, crewCarryCapacityKg, crewJetpackDrainPctPerS, crewPerks, FIXED_STEP_S, getNode, getRole, getRoles, makeRoomCode,
  normalizeRoomCode, parseActionMessage, parseCatalog, parseLobbyAction, parsePing, parsePose, ROLE_IDS, ROOM_CODE_ALPHABET, sanitizePlayerName,
  createRng, type Catalog, type Run,
} from '../index';

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

const firstLink = (run: Run): string => getNode(run.state.sector, run.state.locationId)!.links[0]!;

/** Salta y avanza hasta que haya una avería (catálogo con cortos garantizados). */
function untilIncident(run: Run): number {
  expect(run.apply({ type: 'jump', toId: firstLink(run) })).toEqual({ ok: true });
  for (let i = 0; i < 6000 && run.state.incidents.length === 0; i++) run.step(FIXED_STEP_S);
  const inc = run.state.incidents[0];
  expect(inc).toBeDefined();
  return inc!.id;
}

describe('roles de tripulación', () => {
  it('el catálogo define los cuatro roles con nombre en ambos idiomas', () => {
    expect(getRoles(catalog).map((r) => r.id).sort()).toEqual([...ROLE_IDS].sort());
    for (const r of getRoles(catalog)) {
      expect(r.name.es.length).toBeGreaterThan(0);
      expect(r.name.en.length).toBeGreaterThan(0);
    }
  });

  it('en solitario no hay roles y nada cambia', () => {
    const run = createRun({ seed: 3 });
    expect(run.state.crew).toHaveLength(1);
    expect(run.state.crew[0]!.role).toBeUndefined();
    expect(crewPerks(run.state.crew[0], catalog)).toEqual({});
  });

  it('asigna los roles por orden e ignora los desconocidos', () => {
    const run = createRun({ seed: 3, crewSize: 3, roles: ['pilot', null, 'bogus' as never] });
    expect(run.state.crew.map((c) => c.role)).toEqual(['pilot', undefined, undefined]);
  });

  it('el ingeniero repara más rápido, solo si actúa él', () => {
    const cat = calmCatalog((raw) => {
      for (const k of raw.nodeKinds) k.hazardPerLy.short = 0.5;
    });
    const mult = getRole('engineer', cat)!.perks.repairSpeedMult!;
    expect(mult).toBeGreaterThan(1);
    const progressWith = (crewId: number | undefined): number => {
      const run = createRun({ seed: 5, catalog: cat, crewSize: 2, roles: ['engineer', 'pilot'] });
      const id = untilIncident(run);
      run.apply({ type: 'work-incident', incidentId: id, seconds: 0.1, ...(crewId === undefined ? {} : { crewId }) });
      return run.state.incidents.find((i) => i.id === id)!.progress;
    };
    const base = progressWith(undefined);
    expect(progressWith(2)).toBeCloseTo(base, 9);
    expect(progressWith(1)).toBeCloseTo(base * mult, 9);
  });

  it('el piloto gasta menos combustible al esquivar', () => {
    const cat = calmCatalog((raw) => {
      for (const k of raw.nodeKinds) k.hazardPerLy.impact = 0.5;
    });
    const mult = getRole('pilot', cat)!.perks.evadeFuelMult!;
    const fuelSpent = (crewId: number): number => {
      const run = createRun({ seed: 5, catalog: cat, crewSize: 2, roles: ['pilot', 'engineer'] });
      expect(run.apply({ type: 'jump', toId: firstLink(run) })).toEqual({ ok: true });
      for (let i = 0; i < 6000 && !run.state.warnings.some((w) => !w.evaded); i++) run.step(FIXED_STEP_S);
      const before = run.state.ship.fuel;
      expect(run.apply({ type: 'evade', crewId })).toEqual({ ok: true });
      return before - run.state.ship.fuel;
    };
    const base = fuelSpent(2);
    expect(base).toBeGreaterThan(0);
    expect(fuelSpent(1)).toBeCloseTo(base * mult, 9);
  });

  it('el explorador lleva más carga y gasta menos jetpack', () => {
    const run = createRun({ seed: 3, crewSize: 2, roles: ['explorer', 'manager'] });
    const rules = run.effectiveSurfaceRules();
    const [explorer, manager] = run.state.crew;
    expect(crewCarryCapacityKg(rules, explorer, catalog)).toBeGreaterThan(crewCarryCapacityKg(rules, manager, catalog));
    expect(crewCarryCapacityKg(rules, manager, catalog)).toBe(rules.suit.carryCapacityKg);
    expect(crewJetpackDrainPctPerS(rules, explorer, catalog)).toBeLessThan(rules.jetpack.drainPctPerS);
  });
});

describe('espejo del cliente (hydrate)', () => {
  it('una partida hidratada responde a las consultas como la original', () => {
    const server = createRun({ seed: 11, crewSize: 2, roles: ['pilot', 'explorer'] });
    const toId = firstLink(server);
    server.apply({ type: 'jump', toId });
    for (let i = 0; i < 5000 && server.state.phase === 'transit'; i++) server.step(FIXED_STEP_S);
    server.takeEvents();

    const mirror = createRun({ seed: 0 });
    mirror.hydrate(server.snapshot());
    expect(mirror.snapshot()).toEqual(server.snapshot());
    for (const link of getNode(server.state.sector, server.state.locationId)!.links) {
      expect(mirror.estimateJump(link)).toEqual(server.estimateJump(link));
    }
    expect(mirror.stationQuote()).toEqual(server.stationQuote());
    expect(mirror.estimateLanding()).toEqual(server.estimateLanding());
    expect(mirror.takeEvents()).toEqual([]);
  });

  it('recalcula la nave efectiva con las mejoras recibidas y no comparte memoria con el origen', () => {
    const server = createRun({ seed: 11 });
    const snap = server.snapshot();
    const upgrade = catalog.upgrades![0]!;
    snap.upgrades = { [upgrade.id]: 1 };
    const mirror = createRun({ seed: 0 });
    const before = JSON.stringify(mirror.effectiveShip()) + JSON.stringify(mirror.effectiveSurfaceRules());
    mirror.hydrate(snap);
    expect(JSON.stringify(mirror.effectiveShip()) + JSON.stringify(mirror.effectiveSurfaceRules())).not.toBe(before);
    expect(mirror.state.upgrades).toEqual({ [upgrade.id]: 1 });
    snap.ship.fuel = -1;
    expect(mirror.state.ship.fuel).not.toBe(-1);
    // Hidratar de nuevo sin mejoras las quita.
    mirror.hydrate(server.snapshot());
    expect(mirror.state.upgrades).toEqual({});
  });
});

describe('contrato de red', () => {
  it('limpia los nombres de jugador', () => {
    expect(sanitizePlayerName('  Ana   María  ', 'x')).toBe('Ana María');
    expect(sanitizePlayerName('<b>\u0007</b>', 'x')).toBe('b/b');
    expect(sanitizePlayerName('', 'Tripulante 2')).toBe('Tripulante 2');
    expect(sanitizePlayerName(42, 'x')).toBe('x');
    expect(sanitizePlayerName('a'.repeat(99), 'x')).toHaveLength(COOP_LIMITS.nameMaxLen);
  });

  it('genera y normaliza códigos de sala', () => {
    const rng = createRng(1);
    const code = makeRoomCode(() => rng.next());
    expect(code).toHaveLength(COOP_LIMITS.roomCodeLen);
    for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    expect(normalizeRoomCode(` ${code.toLowerCase()} `)).toBe(code);
    expect(normalizeRoomCode('AB')).toBeNull();
    expect(normalizeRoomCode('O0I1')).toBeNull();
    expect(makeRoomCode(() => 1)).toHaveLength(COOP_LIMITS.roomCodeLen);
  });

  it('valida las acciones del lobby', () => {
    expect(parseLobbyAction({ type: 'set-role', role: 'pilot' })).toEqual({ type: 'set-role', role: 'pilot' });
    expect(parseLobbyAction({ type: 'set-role', role: null })).toEqual({ type: 'set-role', role: null });
    expect(parseLobbyAction({ type: 'set-role', role: 'captain' })).toBeNull();
    expect(parseLobbyAction({ type: 'set-ready', ready: 'yes' })).toEqual({ type: 'set-ready', ready: false });
    expect(parseLobbyAction({ type: 'start', extra: 1 })).toEqual({ type: 'start' });
    expect(parseLobbyAction('start')).toBeNull();
    expect(parseLobbyAction({ type: 'kick' })).toBeNull();
  });

  it('valida la forma de acciones, poses y pings', () => {
    expect(parseActionMessage({ seq: 3.7, action: { type: 'land' } })).toEqual({ seq: 3, action: { type: 'land' } });
    expect(parseActionMessage({ action: 'land' })).toBeNull();
    expect(parseActionMessage(null)).toBeNull();
    expect(parsePose({ x: 1.234, y: 0, z: -2, yaw: 0.5, area: 'ship' })).toEqual({ x: 1.23, y: 0, z: -2, yaw: 0.5, area: 'ship' });
    expect(parsePose({ x: NaN, y: 0, z: 0, yaw: 0, area: 'ship' })).toBeNull();
    expect(parsePose({ x: 1e9, y: 0, z: 0, yaw: 0, area: 'ship' })).toBeNull();
    expect(parsePose({ x: 0, y: 0, z: 0, yaw: 0, area: 'moon' })).toBeNull();
    expect(parsePing({ kind: 'danger', x: 1, y: 2, z: 3, area: 'surface' })).toEqual({ kind: 'danger', x: 1, y: 2, z: 3, area: 'surface' });
    expect(parsePing({ kind: 'dance', x: 1, y: 2, z: 3, area: 'surface' })).toBeNull();
  });
});
