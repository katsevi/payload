import { describe, expect, it } from 'vitest';
import es from '../../locales/es.json';
import en from '../../locales/en.json';
import {
  adviseByRole, applyApprovedRequest, catalog, checkTeamAction, computeBudgets, createRng, defaultAllocation, formatMessage, isTeamScenario,
  lookupSimKey, takeRequestToken,
  NO_GO_REASON_CODES, RESOURCE_IDS, reviewGoNoGo, rollPreLaunchEvents, ROOM_PHASES, runMission, simLocales, SUBSYSTEM_IDS, TEAM_ROLES,
  validateAllocation, validateVote,
} from '../index';
import { flattenKeys } from '../messages';
import type {
  Catalog, MessageRef, MissionDesign, OrbitId, ResourceRequest, SubsystemAllocation, TeamAction, TeamActionContext, TeamRole,
} from '../types';
import { allDesignNames, emptyDesign, loadDesign, SCENARIO_ID } from './fixtures';

/** Diseños aleatorios (incluye órbitas y lanzadores no permitidos) para barrer todas las ramas. */
function randomDesigns(n: number, seed: number): MissionDesign[] {
  const rng = createRng(seed);
  const orbits: (OrbitId | null)[] = [null, 'LEO', 'SSO', 'MEO', 'GEO', 'HEO', 'TLI'];
  const launchers = [null, ...catalog.launchers.map((l) => l.id)];
  const out: MissionDesign[] = [];
  for (let i = 0; i < n; i++) {
    const count = rng.int(0, 14);
    const componentIds = Array.from({ length: count }, () => catalog.components[rng.int(0, catalog.components.length - 1)]!.id);
    if (rng.chance(0.05)) componentIds.push('pieza-inexistente');
    out.push({ scenarioId: SCENARIO_ID, componentIds, orbitId: orbits[rng.int(0, orbits.length - 1)]!, launcherId: launchers[rng.int(0, launchers.length - 1)]! });
  }
  return out;
}

/** Escenario con todos los eventos de la fase 2 forzados (retraso, recorte, fallas, calor). */
const stress: Catalog = {
  ...catalog,
  scenarios: catalog.scenarios.map((s) => (s.id !== SCENARIO_ID ? s : {
    ...s,
    operationDays: 10,
    eventTuning: {
      launchDelayChance: 1, launchDelayMonths: { min: 8, max: 8 }, budgetCutChance: 1, budgetCutPct: { min: 20, max: 20 },
      componentFailureAcceleration: 1e6, overheatingChancePerDay: 1,
    },
  })),
};

function collectRefs(designs: MissionDesign[], seeds: number[], cat: Catalog = catalog, preLaunch = false): MessageRef[] {
  const refs: MessageRef[] = [];
  for (const d of designs) {
    const b = computeBudgets(d, cat);
    const review = reviewGoNoGo(d, cat);
    refs.push(...b.resources.map((r) => r.why));
    refs.push(...review.issues.map((i) => i.message));
    refs.push(...adviseByRole(d, b, review, cat).map((x) => x.message));
    for (const seed of seeds) {
      const pre = preLaunch ? rollPreLaunchEvents(d, cat, seed) : undefined;
      if (pre) refs.push(...computeBudgets(d, cat, pre).resources.map((r) => r.why));
      const m = runMission(d, cat, pre ? { seed, preLaunch: pre } : { seed });
      refs.push(...m.events.map((e) => e.message));
      for (const e of m.report) {
        refs.push(e.message, ...e.causes);
        if (e.suggestion) refs.push(e.suggestion);
      }
    }
  }
  return refs;
}

/** Barrido de la lógica de equipo (fase 3): todas las MessageRef de rechazos, solicitudes, votos y repartos. */
function collectTeamRefs(): MessageRef[] {
  const refs: MessageRef[] = [];
  const take = (c: ReturnType<typeof checkTeamAction>) => {
    if (c.kind === 'reject') refs.push(c.reason);
    if (c.kind === 'request') refs.push(c.why);
  };
  const ok = loadDesign('ok-cubesat-leo');
  const roleSets: TeamRole[][] = [[], ...TEAM_ROLES.map((r) => [r]), [...TEAM_ROLES]];
  const players = [{ id: 'p1', roles: ['director'] as TeamRole[], connected: true }, { id: 'p2', roles: ['science'] as TeamRole[], connected: false }];
  const request: ResourceRequest = { id: 'r1', fromPlayerId: 'p2', fromRole: 'science', toRole: 'engineering', resource: 'power', status: 'open', createdAtS: 0 };
  const alert = {
    id: 'a1', event: { type: 'solar-storm' as const, tSeconds: 0, message: { key: 'event.solarStorm' } }, requiredRoles: ['engineering' as TeamRole],
    acks: [{ role: 'engineering' as TeamRole, playerId: 'p', atS: 1 }], raisedAtS: 0, closedAtS: null, timedOut: false,
  };
  const actions: TeamAction[] = [
    { type: 'claim-roles', roles: ['director'] }, { type: 'auto-assign-roles' }, { type: 'start-mission' }, { type: 'start-design' },
    { type: 'add-component', componentId: 'battery-small' }, { type: 'add-component', componentId: 'nope' },
    { type: 'remove-component', componentId: 'battery-xl' }, { type: 'select-orbit', orbitId: 'GEO' }, { type: 'select-launcher', launcherId: 'launcher-zorzal' },
    { type: 'allocate-budget', allocation: { payload: 99 } }, { type: 'allocate-budget', allocation: { payload: -1 } },
    { type: 'allocate-budget', allocation: { laser: 1 } as SubsystemAllocation },
    { type: 'request-resource', resource: 'budget' }, { type: 'request-resource', resource: 'power', amount: 3 },
    { type: 'request-resource', resource: 'budget', subsystem: 'payload' }, { type: 'request-resource', resource: 'budget', amount: 2, subsystem: 'payload' },
    { type: 'request-resource', resource: 'power', amount: -1 },
    { type: 'resolve-request', requestId: 'r1', approve: true }, { type: 'resolve-request', requestId: 'r9', approve: true },
    { type: 'withdraw-request', requestId: 'r1' }, { type: 'vote', role: 'science', value: 'go' }, { type: 'confirm-launch' },
    { type: 'set-time-scale', accel: 7 }, { type: 'ack-alert', alertId: 'a1', role: 'engineering' }, { type: 'ack-alert', alertId: 'a1', role: 'science' },
    { type: 'ack-alert', alertId: 'a9', role: 'operations' }, { type: 'ack-alert', alertId: 'a2', role: 'operations' },
    { type: 'finish-operation' }, { type: 'redesign' },
  ];
  for (const phase of ROOM_PHASES) {
    for (const actorRoles of roleSets) {
      for (const action of actions) {
        const ctx: TeamActionContext = {
          phase, actorRoles, isHost: actorRoles.length === 1, design: ok, allocation: null, actorId: 'p3', players,
          requests: [request, { ...request, id: 'r2', status: 'approved' }], alerts: [alert, { ...alert, id: 'a2', closedAtS: 5 }],
        };
        take(checkTeamAction(ctx, action));
        take(checkTeamAction(ctx, action.type === 'resolve-request' ? { ...action, requestId: 'r2' } : action));
      }
    }
  }
  // Solicitudes automáticas: cada pieza del catálogo, con y sin reparto, desde cada rol.
  const allocation = defaultAllocation(catalog.scenarios.find((s) => s.id === SCENARIO_ID)!);
  for (const actorRoles of TEAM_ROLES.map((r) => [r])) {
    for (const c of catalog.components) {
      for (const alloc of [null, allocation]) {
        take(checkTeamAction({ phase: 'design', actorRoles, isHost: false, design: ok, allocation: alloc }, { type: 'add-component', componentId: c.id }));
      }
    }
    take(checkTeamAction({ phase: 'design', actorRoles, isHost: false, design: { ...ok, orbitId: null }, allocation: null }, { type: 'select-orbit', orbitId: 'SSO' }));
  }
  // Escenario con piezas restringidas (componentNotAllowed).
  const academy: MissionDesign = { scenarioId: 'academy-cubesat-leo', componentIds: [], orbitId: null, launcherId: null };
  for (const c of catalog.components) {
    take(checkTeamAction({ phase: 'design', actorRoles: [...TEAM_ROLES], isHost: false, design: academy, allocation: null }, { type: 'add-component', componentId: c.id }));
  }
  // Límites: tope de piezas, solicitud duplicada, demasiadas solicitudes abiertas y escenario de equipo.
  const camera: TeamAction = { type: 'add-component', componentId: 'payload-thermal-camera' };
  const full = { ...ok, componentIds: Array.from({ length: 40 }, () => 'battery-small') };
  take(checkTeamAction({ phase: 'design', actorRoles: ['engineering'], isHost: false, design: full, allocation: null }, { type: 'add-component', componentId: 'battery-small' }));
  const mine = (n: number, action?: TeamAction): ResourceRequest[] =>
    Array.from({ length: n }, (_, i) => ({ ...request, id: `m${i}`, fromPlayerId: 'p-sci', ...(action ? { action } : {}) }));
  for (const requests of [mine(1, camera), mine(5)]) {
    take(checkTeamAction({ phase: 'design', actorRoles: ['science'], isHost: false, design: ok, allocation: null, actorId: 'p-sci', requests }, camera));
  }
  const teamScenario = catalog.scenarios.find(isTeamScenario)!;
  const teamDesign: MissionDesign = { scenarioId: teamScenario.id, componentIds: [], orbitId: null, launcherId: null };
  take(checkTeamAction(
    { phase: 'lobby', actorRoles: [...TEAM_ROLES], isHost: true, design: teamDesign, allocation: null, players: [{ id: 'a', roles: [...TEAM_ROLES], connected: true }] },
    { type: 'start-mission' },
  ));
  // Límite de frecuencia (cubeta de fichas que aplica el servidor).
  const limited = takeRequestToken({ tokens: 0, updatedAtS: 0 }, 0);
  if (!limited.ok) refs.push(limited.reason);
  // Vida útil que baja (resourceDown) con una pieza sintética poco fiable.
  const flaky: Catalog = { ...catalog, components: [...catalog.components, { ...catalog.components.find((c) => c.id === 'thermal-passive')!, id: 'thermal-flaky', reliability: 0.6, costMUSD: 0 }] };
  const down = checkTeamAction({ phase: 'design', actorRoles: ['engineering'], isHost: false, design: ok, allocation: null, catalog: flaky }, { type: 'add-component', componentId: 'thermal-flaky' });
  if (down.kind === 'request') refs.push(down.why);
  // Votos, repartos y aprobaciones que ya no tienen sentido.
  for (const v of [{ value: 'go' as const }, { value: 'no-go' as const }, { value: 'no-go' as const, reason: { code: 'other' as const } }]) {
    const r = validateVote(v, false);
    if (r) refs.push(r);
  }
  const scenario = catalog.scenarios.find((s) => s.id === SCENARIO_ID)!;
  for (const a of [{ payload: 99 }, { payload: Number.NaN }, { laser: 1 } as SubsystemAllocation]) {
    const r = validateAllocation(a, scenario);
    if (r) refs.push(r);
  }
  const stale = applyApprovedRequest({ design: ok, allocation: null }, { ...request, action: { type: 'remove-component', componentId: 'battery-xl' } });
  if (stale.kind === 'reject') refs.push(stale.reason);
  return refs;
}

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

  it('simLocales incluye el nombre localizado de cada id del catálogo (catalog.<id>)', () => {
    for (const e of [...catalog.components, ...catalog.orbits, ...catalog.launchers]) {
      expect(lookupSimKey(`catalog.${e.id}`, 'es')).toBe(e.name.es);
      expect(lookupSimKey(`catalog.${e.id}`, 'en')).toBe(e.name.en);
    }
  });

  it('hay textos para cada recurso, estado y unidad del panel', () => {
    for (const r of RESOURCE_IDS) expect(lookupSimKey(`resource.${r}`, 'es')).toBeDefined();
    for (const s of ['ok', 'tight', 'over']) expect(lookupSimKey(`status.${s}`, 'en')).toBeDefined();
    const units = new Set(computeBudgets(loadDesign('ok-cubesat-leo')).resources.map((r) => r.unit));
    for (const u of units) expect(lookupSimKey(`unit.${u}`, 'es'), u).toBeDefined();
  });

  it('toda MessageRef emitida existe en ambos idiomas y trae todos sus params', () => {
    const designs = [
      ...allDesignNames().map(loadDesign),
      emptyDesign(),
      { ...emptyDesign(), orbitId: 'LEO' as const },
      { ...emptyDesign(), launcherId: 'launcher-colibri' },
      { ...emptyDesign(), componentIds: ['structure-cubesat-6u', 'payload-hires-camera'] },
      { ...emptyDesign(), componentIds: ['payload-multispectral-basic'], orbitId: 'GEO' as const, launcherId: 'launcher-albatros' },
      ...randomDesigns(150, 99),
    ];
    const refs = collectRefs(designs.slice(0, 40), [1, 2, 3])
      .concat(collectRefs(designs.slice(40), [7]))
      .concat(collectRefs([...allDesignNames().map(loadDesign), { ...loadDesign('ok-cubesat-leo'), componentIds: [...loadDesign('ok-cubesat-leo').componentIds, 'comms-uhf'] }], [1, 2], stress, true));
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
        expect(text, `${ref.key}: quedó un {{param}} o un id sin traducir`).not.toMatch(/\{\{|\$t\(|catalog\.[A-Za-z0-9]/);
      }
    }
    // El barrido debe cubrir buena parte de las claves de mensajes del motor.
    expect(keys.size).toBeGreaterThan(80);
    // Y las claves nuevas de la fase 2.
    for (const k of [
      'event.launchDelay', 'event.budgetCut', 'event.overheating', 'event.componentFailure.payload', 'event.componentFailure.comms',
      'event.componentFailure.commsBackup', 'event.componentFailure.obc', 'event.componentFailure.adcs', 'event.componentFailure.isolated',
      'report.prelaunch.delay', 'report.prelaunch.budgetCut', 'report.event.overheating', 'report.event.componentFailure',
      'budget.time.delayed', 'budget.budget.cut', 'cause.noScheduleMargin', 'cause.thermalMargin', 'cause.reliabilityRadiation',
      'advisor.director.go', 'advisor.director.noGo', 'advisor.engineering.ok', 'advisor.science.ok', 'advisor.operations.ok',
    ]) {
      expect(keys.has(k), k).toBe(true);
    }
  });

  it('fase 3: los mensajes de equipo (team.*) existen, traen sus params y se resuelven del todo', () => {
    const keys = new Set<string>();
    for (const ref of collectTeamRefs()) {
      keys.add(ref.key);
      for (const locale of ['es', 'en'] as const) {
        const template = lookupSimKey(ref.key, locale);
        expect(template, `${ref.key} (${locale})`).toBeDefined();
        for (const [, p] of template!.matchAll(/\{\{(\w+)\}\}/g)) {
          expect(ref.params && p! in ref.params, `${ref.key}: falta el param "${p}"`).toBe(true);
        }
        // Ni {{param}}, ni $t(...), ni claves anidadas sin resolver (team.role.x, resource.x, unit.x, status.x, catalog.x).
        const text = formatMessage(ref, locale);
        expect(text, `${ref.key} (${locale}): ${text}`).not.toMatch(/\{\{|\$t\(|\b(catalog|team|resource|unit|status)\.[A-Za-z]/);
      }
    }
    // Cobertura: cada clave team.reject.* y team.request.* se emite en el barrido (salvo las que usa solo el servidor).
    const serverOnly = new Set(['team.reject.emptyText', 'team.reject.rateLimited', 'team.reject.invalidAction']);
    const declared = flattenKeys((es as Record<string, unknown>).team).map((k) => `team.${k}`);
    for (const key of declared.filter((k) => /^team\.(reject|request)\./.test(k))) {
      if (!serverOnly.has(key)) expect(keys.has(key), key).toBe(true);
    }
    // Etiquetas por valor para la UI.
    const labels = [
      ...TEAM_ROLES.map((r) => `team.role.${r}`), ...ROOM_PHASES.map((p) => `team.phase.${p}`),
      ...SUBSYSTEM_IDS.map((s) => `team.subsystem.${s}`), ...NO_GO_REASON_CODES.map((c) => `team.noGoReason.${c}`),
    ];
    for (const key of labels) {
      for (const locale of ['es', 'en'] as const) expect(lookupSimKey(key, locale), `${key} (${locale})`).toBeDefined();
    }
    expect(declared.filter((k) => /^team\.(role|phase|subsystem|noGoReason)\./.test(k)).sort()).toEqual(labels.sort());
  });
});
