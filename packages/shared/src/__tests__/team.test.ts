import { describe, expect, it } from 'vitest';
import componentsJson from '../../catalog/componentes.json';
import orbitsJson from '../../catalog/orbitas.json';
import launchersJson from '../../catalog/lanzadores.json';
import scenariosJson from '../../catalog/escenarios.json';
import glossaryJson from '../../catalog/glosario.json';
import mascotJson from '../../catalog/mascota.json';
import academyJson from '../../catalog/academia.json';
import {
  ackAlert, actionImpact, ADVISOR_ROLES, alertForEvent, alertSatisfied, alertTimedOut, allocatableBudgetMUSD, allocationAfterApproval,
  applyApprovedRequest, applyDesignAction, buildResourceRequest, catalog, checkTeamAction, closeAlert, closeRequest, combineRoles,
  computeBudgets, createRng, defaultAllocation, EVENT_RESPONSE_ROLES, getScenario, hasPermission, isDesignAction, MASCOT_TRIGGER_KINDS,
  missingRoles, NO_GO_REASON_CODES, parseCatalog, RESOURCE_IDS, RESOURCE_OWNER, RESOURCE_UNITS, ROLE_PERMISSIONS, ROLE_RESOURCES,
  ROLE_SUBSYSTEMS, roleForPermission, roleMascotTrigger, ROOM_PHASES, runMission, sanitizePlayerText, scoreCollaboration,
  SUBSYSTEM_IDS, subsystemSpend, tallyGoNoGo, TEAM_ACTION_PHASES, TEAM_LIMITS, TEAM_MASCOT_TRIGGERS, TEAM_ROLES, TEAM_TIME_SCALES,
  teamMascotTrigger, teamVoteFrom, validateAllocation, validateVote, isTeamScenario, sameTeamAction, purgeRequests, takeRequestToken,
} from '../index';
import { TEAM_ROLE_IDS } from '../catalog';
import type {
  Catalog, MascotDef, MissionDesign, ResourceRequest, RoomPhase, SimEvent, SubsystemAllocation, TeamAction, TeamActionContext,
  TeamAlert, TeamPermission, TeamRequestCheck, TeamRole, TeamVote,
} from '../types';
import { loadDesign, loadScenarioFixture } from './fixtures';

const OK = loadDesign('ok-cubesat-leo');
const SCENARIO = getScenario(OK.scenarioId);

function ctx(actorRoles: TeamRole[], over: Partial<TeamActionContext> = {}): TeamActionContext {
  return { phase: 'design', actorRoles, isHost: false, design: OK, allocation: null, ...over };
}

/** Catálogo de prueba con piezas sintéticas para aislar reglas. */
function withComponents(...extra: Catalog['components']): Catalog {
  return { ...catalog, components: [...catalog.components, ...extra] };
}
const base = (id: string) => catalog.components.find((c) => c.id === id)!;
/** Instrumento carísimo que no consume ni pesa: solo mueve el presupuesto. */
const GOLD = { ...base('payload-ais-receiver'), id: 'payload-gold', costMUSD: 50, powerW: 0, massKg: 0.01, dataMbitPerDay: 0, reliability: 1, devMonths: 0 };
/** Pieza térmica gratis pero poco fiable: solo baja la vida útil. */
const FLAKY = { ...base('thermal-passive'), id: 'thermal-flaky', reliability: 0.6, costMUSD: 0, massKg: 0.01 };

const asRequest = (c: ReturnType<typeof checkTeamAction>): TeamRequestCheck => {
  expect(c.kind).toBe('request');
  return c as TeamRequestCheck;
};
const rejectKey = (c: ReturnType<typeof checkTeamAction>) => (c.kind === 'reject' ? c.reason.key : c.kind);

describe('tablas de equipo', () => {
  it('los roles de equipo son los de los asesores (y los del validador del catálogo)', () => {
    expect(TEAM_ROLES).toEqual(ADVISOR_ROLES);
    expect([...TEAM_ROLE_IDS]).toEqual([...TEAM_ROLES]);
  });

  it('RESOURCE_OWNER es coherente con ROLE_RESOURCES: cada recurso tiene un único dueño', () => {
    for (const id of RESOURCE_IDS) {
      const owners = TEAM_ROLES.filter((r) => ROLE_RESOURCES[r].includes(id));
      expect(owners, id).toEqual([RESOURCE_OWNER[id]]);
    }
  });

  it('cada subsistema lo monta exactamente un rol (Dirección ninguno)', () => {
    for (const s of SUBSYSTEM_IDS) expect(TEAM_ROLES.filter((r) => ROLE_SUBSYSTEMS[r].includes(s)), s).toHaveLength(1);
    expect(ROLE_SUBSYSTEMS.director).toEqual([]);
    expect(ROLE_SUBSYSTEMS.science).toEqual(['payload']);
    expect(ROLE_SUBSYSTEMS.operations).toEqual(['comms']);
  });

  it('ROLE_PERMISSIONS es la tabla de docs/MULTIPLAYER.md', () => {
    const extras: Record<TeamRole, TeamPermission[]> = {
      director: ['design.orbit', 'design.launcher', 'budget.allocate', 'mission.startDesign', 'launch.confirm', 'time.control', 'mission.finish', 'mission.redesign'],
      engineering: [],
      science: [],
      operations: ['time.control'],
    };
    for (const role of TEAM_ROLES) {
      const expected: TeamPermission[] = [
        ...extras[role],
        ...ROLE_SUBSYSTEMS[role].map((s) => `design.subsystem.${s}` as const),
        ...RESOURCE_IDS.filter((id) => RESOURCE_OWNER[id] === role).map((id) => `request.resolve.${id}` as const),
      ];
      expect([...ROLE_PERMISSIONS[role]].sort(), role).toEqual(expected.sort());
    }
    expect(TEAM_ROLES.filter((r) => hasPermission([r], 'time.control'))).toEqual(['director', 'operations']);
    expect(roleForPermission('design.subsystem.payload')).toBe('science');
    expect(roleForPermission('request.resolve.lifetime')).toBe('operations');
  });

  it('RESOURCE_UNITS coincide con las unidades de computeBudgets', () => {
    for (const r of computeBudgets(OK).resources) expect(RESOURCE_UNITS[r.id]).toBe(r.unit);
  });

  it('fases por acción: voto solo en review, diseño solo en design, chat en todas', () => {
    expect(TEAM_ACTION_PHASES.vote).toEqual(['review']);
    expect(TEAM_ACTION_PHASES['add-component']).toEqual(['design']);
    expect(TEAM_ACTION_PHASES['ack-alert']).toEqual(['operation']);
    expect(TEAM_ACTION_PHASES.redesign).toEqual(['report']);
    expect(TEAM_ACTION_PHASES['start-mission']).toEqual(['lobby']);
    for (const t of ['chat', 'ping', 'set-name'] as const) expect(TEAM_ACTION_PHASES[t]).toEqual(ROOM_PHASES);
  });

  it('constantes de sala', () => {
    expect(TEAM_TIME_SCALES).toEqual([0, 1, 10, 100, 1000, 10000]);
    expect(TEAM_LIMITS).toMatchObject({
      maxPlayers: 4, nameMaxChars: 24, chatMaxChars: 280, noteMaxChars: 280, chatHistory: 50, eventHistory: 200,
      reconnectGraceS: 60, alertTimeoutS: 45, launchScreenMaxS: 25,
    });
    expect(NO_GO_REASON_CODES).toEqual([...RESOURCE_IDS, 'requirements', 'risk', 'other']);
  });

  it('EVENT_RESPONSE_ROLES: los 6 eventos graves, con roles válidos y sin repetir', () => {
    expect(Object.keys(EVENT_RESPONSE_ROLES).sort()).toEqual(
      ['battery-depleted', 'component-failure', 'debris-avoidance', 'overheating', 'reaction-wheel-failure', 'solar-storm'],
    );
    for (const roles of Object.values(EVENT_RESPONSE_ROLES)) {
      expect(roles!.length).toBeGreaterThan(0);
      expect(new Set(roles).size).toBe(roles!.length);
      for (const r of roles!) expect(TEAM_ROLES).toContain(r);
    }
  });
});

describe('combineRoles', () => {
  it('reparto por defecto de docs/MULTIPLAYER.md', () => {
    expect(combineRoles([])).toEqual({});
    expect(combineRoles(['a'])).toEqual({ a: ['director', 'engineering', 'science', 'operations'] });
    expect(combineRoles(['a', 'b'])).toEqual({ a: ['director', 'operations'], b: ['engineering', 'science'] });
    expect(combineRoles(['a', 'b', 'c'])).toEqual({ a: ['director', 'operations'], b: ['engineering'], c: ['science'] });
    expect(combineRoles(['a', 'b', 'c', 'd'])).toEqual({ a: ['director'], b: ['engineering'], c: ['science'], d: ['operations'] });
  });

  it('respeta preferencias cuando no chocan y maximiza las que se pueden cumplir', () => {
    expect(combineRoles(['a', 'b', 'c', 'd'], { a: ['science'], b: ['director'], c: ['operations'], d: ['engineering'] })).toEqual({
      a: ['science'], b: ['director'], c: ['operations'], d: ['engineering'],
    });
    // Chocan en Ciencia: a cede a su segunda preferencia para que b tenga la suya.
    const r = combineRoles(['a', 'b', 'c', 'd'], { a: ['science', 'director'], b: ['science'] });
    expect(r.a).toEqual(['director']);
    expect(r.b).toEqual(['science']);
    // Mismo deseo sin alternativa: gana el primero en llegar.
    const tie = combineRoles(['a', 'b', 'c', 'd'], { a: ['science'], b: ['science'] });
    expect(tie.a).toEqual(['science']);
    expect(combineRoles(['a', 'b'], { a: ['science'] })).toEqual({ a: ['engineering', 'science'], b: ['director', 'operations'] });
  });

  it('re-reparto tras una salida: cada uno conserva sus roles si cabe', () => {
    // Se va Operaciones (4 → 3): Dirección absorbe Operaciones.
    expect(combineRoles(['dir', 'eng', 'sci'], { dir: ['director'], eng: ['engineering'], sci: ['science'] })).toEqual({
      dir: ['director', 'operations'], eng: ['engineering'], sci: ['science'],
    });
    // Se va Dirección: Operaciones (que ya la tenía en su grupo) absorbe Dirección.
    expect(combineRoles(['eng', 'sci', 'ops'], { eng: ['engineering'], sci: ['science'], ops: ['operations'] })).toEqual({
      eng: ['engineering'], sci: ['science'], ops: ['director', 'operations'],
    });
  });

  it('siempre cubre los 4 roles sin repetir, es determinista e ignora ids repetidos y jugadores de más', () => {
    const rng = createRng(42);
    for (let i = 0; i < 200; i++) {
      const n = rng.int(1, 4);
      const ids = Array.from({ length: n }, (_, k) => `p${k}`);
      const prefs = Object.fromEntries(ids.map((id) => [id, TEAM_ROLES.filter(() => rng.chance(0.4))]));
      const out = combineRoles(ids, prefs);
      const all = Object.values(out).flat();
      expect(all.sort()).toEqual([...TEAM_ROLES].sort());
      expect(combineRoles(ids, prefs)).toEqual(out);
    }
    expect(combineRoles(['a', 'a', 'b'])).toEqual(combineRoles(['a', 'b']));
    const five = combineRoles(['a', 'b', 'c', 'd', 'e']);
    expect(five.e).toEqual([]);
    expect(Object.values(five).flat()).toHaveLength(4);
  });
});

describe('roles cubiertos y permisos', () => {
  it('missingRoles solo cuenta jugadores conectados', () => {
    expect(missingRoles([])).toEqual(TEAM_ROLES);
    expect(missingRoles([{ roles: ['director', 'operations'], connected: true }, { roles: ['engineering', 'science'], connected: false }]))
      .toEqual(['engineering', 'science']);
    expect(missingRoles([{ roles: [...TEAM_ROLES], connected: true }])).toEqual([]);
  });

  it('hasPermission', () => {
    expect(hasPermission(['science'], 'design.subsystem.payload')).toBe(true);
    expect(hasPermission(['science'], 'design.subsystem.power')).toBe(false);
    expect(hasPermission(['science', 'engineering'], 'design.subsystem.power')).toBe(true);
    expect(hasPermission([], 'design.orbit')).toBe(false);
  });
});

describe('applyDesignAction (misma semántica que el store useDesign)', () => {
  const d: MissionDesign = Object.freeze({ scenarioId: 'leo-earth-observation', componentIds: Object.freeze(['a', 'b', 'a']) as string[], orbitId: null, launcherId: null });

  it('add añade al final; remove quita la ÚLTIMA unidad; sin mutar', () => {
    expect(applyDesignAction(d, { type: 'add-component', componentId: 'c' }).componentIds).toEqual(['a', 'b', 'a', 'c']);
    expect(applyDesignAction(d, { type: 'remove-component', componentId: 'a' }).componentIds).toEqual(['a', 'b']);
    expect(applyDesignAction(d, { type: 'remove-component', componentId: 'zz' })).toBe(d);
    expect(d.componentIds).toEqual(['a', 'b', 'a']);
  });

  it('órbita y lanzador se sustituyen (null quita); el resto de acciones no cambia el diseño', () => {
    expect(applyDesignAction(d, { type: 'select-orbit', orbitId: 'SSO' }).orbitId).toBe('SSO');
    expect(applyDesignAction({ ...d, orbitId: 'SSO' }, { type: 'select-orbit', orbitId: null }).orbitId).toBeNull();
    expect(applyDesignAction(d, { type: 'select-launcher', launcherId: 'launcher-colibri' }).launcherId).toBe('launcher-colibri');
    for (const a of [{ type: 'chat', text: 'hola' }, { type: 'request-review' }, { type: 'redesign' }] as TeamAction[]) {
      expect(applyDesignAction(d, a)).toBe(d);
      expect(isDesignAction(a)).toBe(false);
    }
  });
});

describe('actionImpact', () => {
  it('una cámara térmica en el cubesat dispara la energía y la batería, y aprieta comms y calendario', () => {
    const after = applyDesignAction(OK, { type: 'add-component', componentId: 'payload-thermal-camera' });
    const imp = Object.fromEntries(actionImpact(OK, after).map((i) => [i.resource, i]));
    expect(imp.power).toMatchObject({ before: 'ok', after: 'over', usedDelta: 60, evaluable: true, worsened: true, unit: 'W' });
    expect(imp.battery).toMatchObject({ before: 'ok', after: 'over', worsened: true });
    expect(imp.comms).toMatchObject({ before: 'ok', after: 'tight', usedDelta: 2000 });
    expect(imp.time).toMatchObject({ before: 'ok', after: 'tight', usedDelta: 2.25 });
    expect(imp.mass!.worsened).toBe(false);
    expect(actionImpact(OK, OK).every((i) => !i.worsened && i.usedDelta === 0)).toBe(true);
  });

  it('un recurso sin disponible (diseño vacío) no es evaluable', () => {
    const empty: MissionDesign = { ...OK, componentIds: [], orbitId: null, launcherId: null };
    const after = applyDesignAction(empty, { type: 'add-component', componentId: 'payload-hires-camera' });
    const comms = actionImpact(empty, after).find((i) => i.resource === 'comms')!;
    expect(comms.evaluable).toBe(false);
  });
});

describe('checkTeamAction: fase, permiso e ids', () => {
  const samples: TeamAction[] = [
    { type: 'set-name', name: 'Ada' }, { type: 'claim-roles', roles: ['science'] }, { type: 'auto-assign-roles' }, { type: 'start-mission' },
    { type: 'start-design' }, { type: 'add-component', componentId: 'battery-small' }, { type: 'remove-component', componentId: 'battery-medium' },
    { type: 'select-orbit', orbitId: 'SSO' }, { type: 'select-launcher', launcherId: 'launcher-colibri' }, { type: 'allocate-budget', allocation: null },
    { type: 'request-resource', resource: 'budget' }, { type: 'resolve-request', requestId: 'r1', approve: true }, { type: 'withdraw-request', requestId: 'r1' },
    { type: 'request-review' }, { type: 'vote', role: 'director', value: 'go' }, { type: 'confirm-launch' }, { type: 'launch-done' },
    { type: 'set-time-scale', accel: 10 }, { type: 'ack-alert', alertId: 'a1', role: 'director' }, { type: 'finish-operation' }, { type: 'redesign' },
    { type: 'chat', text: 'hola' }, { type: 'ping', target: { kind: 'resource', id: 'power' } },
  ];

  it('cubre todos los tipos de acción', () => {
    expect(new Set(samples.map((a) => a.type))).toEqual(new Set(Object.keys(TEAM_ACTION_PHASES)));
  });

  it('rechaza por fase exactamente fuera de TEAM_ACTION_PHASES', () => {
    for (const action of samples) {
      for (const phase of ROOM_PHASES) {
        const r = checkTeamAction(ctx([...TEAM_ROLES], { phase, isHost: true }), action);
        const allowed = TEAM_ACTION_PHASES[action.type].includes(phase);
        expect(rejectKey(r) === 'team.reject.phase', `${action.type} en ${phase}`).toBe(!allowed);
        if (!allowed) expect(r).toEqual({ kind: 'reject', reason: { key: 'team.reject.phase', params: { phase } } });
      }
    }
  });

  it('permiso por rol (el motivo dice a qué rol le toca)', () => {
    expect(checkTeamAction(ctx(['science']), { type: 'add-component', componentId: 'battery-small' }))
      .toEqual({ kind: 'reject', reason: { key: 'team.reject.permission', params: { role: 'engineering' } } });
    expect(rejectKey(checkTeamAction(ctx(['engineering']), { type: 'select-orbit', orbitId: 'SSO' }))).toBe('team.reject.permission');
    expect(rejectKey(checkTeamAction(ctx(['science'], { phase: 'operation' }), { type: 'set-time-scale', accel: 10 }))).toBe('team.reject.permission');
    expect(checkTeamAction(ctx(['operations'], { phase: 'operation' }), { type: 'set-time-scale', accel: 10 }).kind).toBe('apply');
    expect(rejectKey(checkTeamAction(ctx(['operations'], { phase: 'report' }), { type: 'redesign' }))).toBe('team.reject.permission');
    expect(checkTeamAction(ctx(['director'], { phase: 'report' }), { type: 'redesign' }).kind).toBe('apply');
    expect(rejectKey(checkTeamAction(ctx(['engineering'], { phase: 'prelaunch' }), { type: 'confirm-launch' }))).toBe('team.reject.permission');
    expect(rejectKey(checkTeamAction(ctx(['science'], { phase: 'briefing' }), { type: 'start-design' }))).toBe('team.reject.permission');
    expect(rejectKey(checkTeamAction(ctx(['operations'], { phase: 'operation' }), { type: 'finish-operation' }))).toBe('team.reject.permission');
    expect(rejectKey(checkTeamAction(ctx(['science']), { type: 'allocate-budget', allocation: null }))).toBe('team.reject.permission');
  });

  it('ids del catálogo, permitidos por el escenario y pieza presente', () => {
    expect(checkTeamAction(ctx(['engineering']), { type: 'add-component', componentId: 'nope' }))
      .toEqual({ kind: 'reject', reason: { key: 'team.reject.invalidId', params: { id: 'nope' } } });
    const academy: MissionDesign = { scenarioId: 'academy-cubesat-leo', componentIds: [], orbitId: null, launcherId: null };
    const notAllowed = catalog.components.find((c) => c.subsystem === 'payload' && !getScenario('academy-cubesat-leo').allowedComponents!.includes(c.id))!;
    expect(checkTeamAction(ctx(['science'], { design: academy }), { type: 'add-component', componentId: notAllowed.id }))
      .toEqual({ kind: 'reject', reason: { key: 'team.reject.componentNotAllowed', params: { component: notAllowed.id } } });
    expect(rejectKey(checkTeamAction(ctx(['director']), { type: 'select-orbit', orbitId: 'GEO' }))).toBe('team.reject.orbitNotAllowed');
    expect(rejectKey(checkTeamAction(ctx(['director']), { type: 'select-launcher', launcherId: 'launcher-zorzal' }))).toBe('team.reject.launcherNotAllowed');
    expect(rejectKey(checkTeamAction(ctx(['director']), { type: 'select-launcher', launcherId: 'cohete-x' }))).toBe('team.reject.invalidId');
    expect(checkTeamAction(ctx(['director']), { type: 'select-orbit', orbitId: null }).kind).toBe('apply');
    expect(checkTeamAction(ctx(['engineering']), { type: 'remove-component', componentId: 'battery-large' }))
      .toEqual({ kind: 'reject', reason: { key: 'team.reject.componentAbsent', params: { component: 'battery-large' } } });
    expect(rejectKey(checkTeamAction(ctx(['engineering'], { design: { ...OK, scenarioId: 'nope' } }), { type: 'add-component', componentId: 'battery-small' })))
      .toBe('team.reject.invalidId');
  });

  it('lobby: roles ocupados, anfitrión y roles cubiertos', () => {
    const players = [
      { id: 'p1', roles: ['director', 'operations'] as TeamRole[], connected: true },
      { id: 'p2', roles: ['engineering'] as TeamRole[], connected: false },
    ];
    const lobby = (over: Partial<TeamActionContext> = {}) => ctx([], { phase: 'lobby', actorId: 'p3', players, ...over });
    expect(checkTeamAction(lobby(), { type: 'claim-roles', roles: ['engineering'] }))
      .toEqual({ kind: 'reject', reason: { key: 'team.reject.roleTaken', params: { role: 'engineering' } } });
    expect(checkTeamAction(lobby(), { type: 'claim-roles', roles: ['science'] }).kind).toBe('apply');
    expect(checkTeamAction(lobby({ actorId: 'p1' }), { type: 'claim-roles', roles: ['director'] }).kind).toBe('apply');
    expect(checkTeamAction(lobby(), { type: 'claim-roles', roles: [] }).kind).toBe('apply');
    expect(rejectKey(checkTeamAction(lobby(), { type: 'auto-assign-roles' }))).toBe('team.reject.notHost');
    expect(checkTeamAction(lobby({ isHost: true }), { type: 'auto-assign-roles' }).kind).toBe('apply');
    expect(rejectKey(checkTeamAction(lobby(), { type: 'start-mission' }))).toBe('team.reject.notHost');
    expect(checkTeamAction(lobby({ isHost: true }), { type: 'start-mission' }))
      .toEqual({ kind: 'reject', reason: { key: 'team.reject.missingRoles', params: { role: 'engineering', count: 2 } } });
    const full = [...players, { id: 'p3', roles: ['engineering', 'science'] as TeamRole[], connected: true }];
    expect(checkTeamAction(lobby({ isHost: true, players: full }), { type: 'start-mission' }).kind).toBe('apply');
  });

  it('votar y responder alertas exige tener el rol; tiempo solo en TEAM_TIME_SCALES', () => {
    expect(checkTeamAction(ctx(['science'], { phase: 'review' }), { type: 'vote', role: 'director', value: 'go' }))
      .toEqual({ kind: 'reject', reason: { key: 'team.reject.notYourRole', params: { role: 'director' } } });
    expect(checkTeamAction(ctx(['science', 'director'], { phase: 'review' }), { type: 'vote', role: 'director', value: 'no-go' }).kind).toBe('apply');
    expect(checkTeamAction(ctx(['director'], { phase: 'operation' }), { type: 'set-time-scale', accel: 5 }))
      .toEqual({ kind: 'reject', reason: { key: 'team.reject.timeScale', params: { accel: 5 } } });
    for (const accel of TEAM_TIME_SCALES) expect(checkTeamAction(ctx(['director'], { phase: 'operation' }), { type: 'set-time-scale', accel }).kind).toBe('apply');

    const ev: SimEvent = { type: 'solar-storm', tSeconds: 100, message: { key: 'event.solarStorm' } };
    const alert = alertForEvent(ev, 'a1', 50)!;
    const op = (roles: TeamRole[], alerts: TeamAlert[]) => ctx(roles, { phase: 'operation', alerts });
    expect(checkTeamAction(op(['engineering'], [alert]), { type: 'ack-alert', alertId: 'a1', role: 'engineering' }).kind).toBe('apply');
    expect(rejectKey(checkTeamAction(op(['engineering'], [alert]), { type: 'ack-alert', alertId: 'a1', role: 'science' }))).toBe('team.reject.notYourRole');
    expect(rejectKey(checkTeamAction(op(['engineering'], []), { type: 'ack-alert', alertId: 'a1', role: 'engineering' }))).toBe('team.reject.alertNotFound');
    expect(rejectKey(checkTeamAction(op(['science'], [alert]), { type: 'ack-alert', alertId: 'a1', role: 'science' }))).toBe('team.reject.alertRole');
    const acked = ackAlert(alert, { role: 'engineering', playerId: 'p', atS: 55 });
    expect(rejectKey(checkTeamAction(op(['engineering'], [acked]), { type: 'ack-alert', alertId: 'a1', role: 'engineering' }))).toBe('team.reject.alertAcked');
    expect(rejectKey(checkTeamAction(op(['engineering'], [closeAlert(alert, 99, true)]), { type: 'ack-alert', alertId: 'a1', role: 'engineering' })))
      .toBe('team.reject.alertClosed');
  });

  it('chat, ping y nombre se aceptan en cualquier fase y sin rol', () => {
    for (const phase of ROOM_PHASES) {
      for (const a of [{ type: 'chat', text: 'x' }, { type: 'ping', target: { kind: 'point', position: [0, 1, 2] } }, { type: 'set-name', name: 'x' }] as TeamAction[]) {
        expect(checkTeamAction(ctx([], { phase }), a).kind).toBe('apply');
      }
    }
  });
});

describe('checkTeamAction: solicitudes automáticas', () => {
  it('Ciencia monta un instrumento que deja la energía en rojo → solicitud a Ingeniería (no se aplica)', () => {
    const r = asRequest(checkTeamAction(ctx(['science']), { type: 'add-component', componentId: 'payload-thermal-camera' }));
    expect(r).toMatchObject({ toRole: 'engineering', resource: 'power', amount: 60, fromRole: 'science', componentId: 'payload-thermal-camera', approvedBy: ['science'] });
    expect(r.why).toEqual({
      key: 'team.request.resourceUp',
      params: { fromRole: 'science', toRole: 'engineering', resource: 'power', amount: 60, unit: 'W', before: 'ok', after: 'over' },
    });
  });

  it('con roles combinados se salta al siguiente dueño; con los 4 roles se aplica directamente', () => {
    // Energía y batería (Ingeniería) ya están conformes → lo más grave que queda es comms tight (antes que time tight).
    const r = asRequest(checkTeamAction(ctx(['engineering', 'science']), { type: 'add-component', componentId: 'payload-thermal-camera' }));
    expect(r).toMatchObject({ toRole: 'operations', resource: 'comms', amount: 2000 });
    expect(checkTeamAction(ctx([...TEAM_ROLES]), { type: 'add-component', componentId: 'payload-thermal-camera' })).toEqual({ kind: 'apply' });
  });

  it('una acción que no empeora nada (o solo recursos propios) se aplica', () => {
    expect(checkTeamAction(ctx(['engineering']), { type: 'add-component', componentId: 'battery-small' })).toEqual({ kind: 'apply' });
    expect(checkTeamAction(ctx(['science']), { type: 'remove-component', componentId: 'payload-multispectral-basic' })).toEqual({ kind: 'apply' });
  });

  it('si el uso no cambia pero baja el disponible (vida útil), amount = lo que baja', () => {
    const cat = withComponents(FLAKY);
    const r = asRequest(checkTeamAction(ctx(['engineering'], { catalog: cat }), { type: 'add-component', componentId: 'thermal-flaky' }));
    expect(r).toMatchObject({ toRole: 'operations', resource: 'lifetime' });
    expect(r.why.key).toBe('team.request.resourceDown');
    expect(r.amount).toBeGreaterThan(0);
    expect(r.why.params).toMatchObject({ unit: 'years', amount: r.amount, before: 'ok', after: 'over' });
  });

  it('con reparto, exceder la asignación del subsistema pide presupuesto a Dirección (amount = exceso)', () => {
    const noPayload = { ...OK, componentIds: OK.componentIds.filter((c) => c !== 'payload-multispectral-basic') };
    const r = asRequest(checkTeamAction(ctx(['science'], { design: noPayload, allocation: { payload: 2 } }), {
      type: 'add-component', componentId: 'payload-multispectral-basic',
    }));
    expect(r).toMatchObject({ toRole: 'director', resource: 'budget', subsystem: 'payload', amount: 0.5 });
    expect(r.why).toEqual({
      key: 'team.request.allocation',
      params: { fromRole: 'science', toRole: 'director', subsystem: 'payload', amount: 0.5, usedMUSD: 2.5, allocatedMUSD: 2 },
    });
    // Sin reparto no hay tope; un subsistema sin asignar tampoco; Dirección no se pide permiso a sí misma.
    expect(checkTeamAction(ctx(['science'], { design: noPayload }), { type: 'add-component', componentId: 'payload-multispectral-basic' }).kind).toBe('apply');
    expect(checkTeamAction(ctx(['science'], { design: noPayload, allocation: { power: 1 } }), { type: 'add-component', componentId: 'payload-multispectral-basic' }).kind).toBe('apply');
    expect(checkTeamAction(ctx(['science', 'director'], { design: noPayload, allocation: { payload: 2 } }), {
      type: 'add-component', componentId: 'payload-multispectral-basic',
    }).kind).toBe('apply');
  });

  it('desempate: over antes que tight, orden de RESOURCE_IDS y, a igualdad, la del reparto', () => {
    // Masa (over) gana al presupuesto del reparto (over) por orden de RESOURCE_IDS.
    const heavy = asRequest(checkTeamAction(ctx(['science'], { allocation: defaultAllocation(SCENARIO) }), {
      type: 'add-component', componentId: 'payload-transponder-ku',
    }));
    expect(heavy.resource).toBe('mass');
    // Presupuesto global over y reparto over (ambos de Dirección): gana la del reparto, que lleva el subsistema.
    const cat = withComponents(GOLD);
    const gold = asRequest(checkTeamAction(ctx(['science'], { catalog: cat, allocation: defaultAllocation(SCENARIO) }), {
      type: 'add-component', componentId: 'payload-gold',
    }));
    expect(gold).toMatchObject({ toRole: 'director', resource: 'budget', subsystem: 'payload' });
    // Sin reparto, la misma pieza pide el presupuesto global (sin subsistema).
    const global = asRequest(checkTeamAction(ctx(['science'], { catalog: cat }), { type: 'add-component', componentId: 'payload-gold' }));
    expect(global).toMatchObject({ toRole: 'director', resource: 'budget', amount: 50 });
    expect(global.subsystem).toBeUndefined();
  });

  it('Dirección eligiendo la órbita también pide permiso si aprieta un recurso de otro rol', () => {
    // Con la batería pequeña y sin órbita, elegir LEO crea el eclipse: la batería pasa de ok a tight.
    const small = { ...OK, componentIds: OK.componentIds.map((c) => (c === 'battery-medium' ? 'battery-small' : c)), orbitId: null };
    const r = asRequest(checkTeamAction(ctx(['director'], { design: small }), { type: 'select-orbit', orbitId: 'LEO' }));
    expect(r).toMatchObject({ toRole: 'engineering', resource: 'battery', fromRole: 'director', approvedBy: ['director'] });
    expect(r.componentId).toBeUndefined();
    expect(r.why.params).toMatchObject({ before: 'ok', after: 'tight', unit: 'Wh' });
    // Con la batería mediana hay margen: se aplica.
    expect(checkTeamAction(ctx(['director'], { design: { ...OK, orbitId: null } }), { type: 'select-orbit', orbitId: 'LEO' }).kind).toBe('apply');
  });
});

describe('checkTeamAction: solicitudes explícitas y su ciclo de vida', () => {
  it('request-resource va al dueño del recurso; no a uno mismo; exige rol y cantidad > 0', () => {
    const r = asRequest(checkTeamAction(ctx(['science']), { type: 'request-resource', resource: 'budget', amount: 2, subsystem: 'payload', note: 'más ciencia' }));
    expect(r).toMatchObject({ toRole: 'director', resource: 'budget', amount: 2, subsystem: 'payload', fromRole: 'science' });
    expect(r.why.key).toBe('team.request.explicitSubsystemAmount');
    expect(asRequest(checkTeamAction(ctx(['science']), { type: 'request-resource', resource: 'power' })).why.key).toBe('team.request.explicit');
    expect(asRequest(checkTeamAction(ctx(['science']), { type: 'request-resource', resource: 'power', amount: 5 })).why.key).toBe('team.request.explicitAmount');
    expect(asRequest(checkTeamAction(ctx(['science']), { type: 'request-resource', resource: 'budget', subsystem: 'payload' })).why.key).toBe('team.request.explicitSubsystem');
    // fromRole: el rol del actor que monta ese subsistema.
    expect(asRequest(checkTeamAction(ctx(['operations', 'science']), { type: 'request-resource', resource: 'budget', subsystem: 'payload' })).fromRole).toBe('science');
    expect(checkTeamAction(ctx(['director']), { type: 'request-resource', resource: 'budget' }))
      .toEqual({ kind: 'reject', reason: { key: 'team.reject.ownResource', params: { resource: 'budget' } } });
    expect(rejectKey(checkTeamAction(ctx([]), { type: 'request-resource', resource: 'budget' }))).toBe('team.reject.noRole');
    expect(rejectKey(checkTeamAction(ctx(['science']), { type: 'request-resource', resource: 'budget', amount: -1 }))).toBe('team.reject.invalidAmount');
  });

  it('buildResourceRequest: guarda la acción de diseño (no la explícita), sanea la nota y omite amount 0', () => {
    const action: TeamAction = { type: 'add-component', componentId: 'payload-thermal-camera' };
    const auto = buildResourceRequest(asRequest(checkTeamAction(ctx(['science']), action)), action, { id: 'r1', fromPlayerId: 'p1', atS: 12 });
    expect(auto).toMatchObject({ id: 'r1', fromPlayerId: 'p1', fromRole: 'science', toRole: 'engineering', resource: 'power', amount: 60, status: 'open', createdAtS: 12, action, approvedBy: ['science'] });
    const explicitAction: TeamAction = { type: 'request-resource', resource: 'power', note: '  dame\n\nenergía  ' };
    const explicit = buildResourceRequest(asRequest(checkTeamAction(ctx(['science']), explicitAction)), explicitAction, { id: 'r2', fromPlayerId: 'p1', atS: 13 });
    expect(explicit.note).toBe('dame energía');
    expect(explicit.action).toBeUndefined();
    expect(explicit.amount).toBeUndefined();
  });

  it('resolver: existe, está abierta y la resuelve el rol destinatario; retirar solo su autor', () => {
    const req: ResourceRequest = { id: 'r1', fromPlayerId: 'p-sci', fromRole: 'science', toRole: 'engineering', resource: 'power', status: 'open', createdAtS: 0 };
    const c = (roles: TeamRole[], over: Partial<TeamActionContext> = {}) => ctx(roles, { requests: [req], ...over });
    expect(checkTeamAction(c(['engineering']), { type: 'resolve-request', requestId: 'r1', approve: true }).kind).toBe('apply');
    expect(checkTeamAction(c(['science']), { type: 'resolve-request', requestId: 'r1', approve: true }))
      .toEqual({ kind: 'reject', reason: { key: 'team.reject.notRequestOwner', params: { role: 'engineering' } } });
    expect(rejectKey(checkTeamAction(c(['engineering']), { type: 'resolve-request', requestId: 'r9', approve: true }))).toBe('team.reject.requestNotFound');
    expect(rejectKey(checkTeamAction(ctx(['engineering']), { type: 'resolve-request', requestId: 'r1', approve: true }))).toBe('team.reject.requestNotFound');
    const closed = closeRequest(req, { status: 'rejected', atS: 5 });
    expect(rejectKey(checkTeamAction(c(['engineering'], { requests: [closed] }), { type: 'resolve-request', requestId: 'r1', approve: false }))).toBe('team.reject.requestClosed');
    expect(checkTeamAction(c(['science'], { actorId: 'p-sci' }), { type: 'withdraw-request', requestId: 'r1' }).kind).toBe('apply');
    expect(rejectKey(checkTeamAction(c(['science'], { actorId: 'otro' }), { type: 'withdraw-request', requestId: 'r1' }))).toBe('team.reject.notRequester');
  });

  it('closeRequest marca el cierre y sanea la nota', () => {
    const req: ResourceRequest = { id: 'r1', fromPlayerId: 'a', fromRole: 'science', toRole: 'director', resource: 'budget', status: 'open', createdAtS: 3 };
    const reason = { key: 'team.reject.componentAbsent', params: { component: 'battery-small' } };
    expect(closeRequest(req, { status: 'rejected', atS: 9, byPlayerId: 'b', note: ' propón otra\tsolución ', reason })).toEqual({
      ...req, status: 'rejected', resolvedAtS: 9, resolvedByPlayerId: 'b', resolutionNote: 'propón otra solución', resolutionReason: reason,
    });
    expect(closeRequest(req, { status: 'withdrawn', atS: 4, note: '   ' }).resolutionNote).toBeUndefined();
  });

  it('aprobar encadena a los demás dueños afectados y termina aplicando la acción', () => {
    const action: TeamAction = { type: 'add-component', componentId: 'payload-thermal-camera' };
    let req = buildResourceRequest(asRequest(checkTeamAction(ctx(['science']), action)), action, { id: 'r1', fromPlayerId: 'p-sci', atS: 0 });
    const state = { design: OK, allocation: null };
    const chain: string[] = [];
    for (let i = 0; i < 5; i++) {
      chain.push(`${req.toRole}:${req.resource}`);
      const out = applyApprovedRequest(state, req, catalog, [req.toRole]);
      if (out.kind === 'applied') {
        expect(out.design.componentIds).toEqual([...OK.componentIds, 'payload-thermal-camera']);
        break;
      }
      expect(out.kind).toBe('request');
      if (out.kind !== 'request') break;
      req = buildResourceRequest(out.check, req.action, { id: `r${i + 2}`, fromPlayerId: req.fromPlayerId, atS: i + 1 });
    }
    expect(chain).toEqual(['engineering:power', 'operations:comms', 'director:time']);
    expect(req.approvedBy).toEqual(['engineering', 'science', 'operations']);
    // Quien aprueba con varios roles cubre de golpe los recursos de todos ellos.
    const first = buildResourceRequest(asRequest(checkTeamAction(ctx(['science']), action)), action, { id: 'x', fromPlayerId: 'p', atS: 0 });
    expect(applyApprovedRequest(state, first, catalog, ['engineering', 'operations', 'director']).kind).toBe('applied');
  });

  it('aprobar una acción que ya no tiene sentido la rechaza con motivo', () => {
    const action: TeamAction = { type: 'remove-component', componentId: 'battery-medium' };
    const req: ResourceRequest = { id: 'r1', fromPlayerId: 'p', fromRole: 'engineering', toRole: 'operations', resource: 'lifetime', status: 'open', createdAtS: 0, action };
    const without = { ...OK, componentIds: OK.componentIds.filter((c) => c !== 'battery-medium') };
    expect(applyApprovedRequest({ design: without, allocation: null }, req)).toEqual({
      kind: 'reject', reason: { key: 'team.reject.componentAbsent', params: { component: 'battery-medium' } },
    });
  });

  it('aprobar una solicitud del reparto sube la asignación y aplica la pieza', () => {
    const noPayload = { ...OK, componentIds: OK.componentIds.filter((c) => c !== 'payload-multispectral-basic') };
    const action: TeamAction = { type: 'add-component', componentId: 'payload-multispectral-basic' };
    const check = asRequest(checkTeamAction(ctx(['science'], { design: noPayload, allocation: { payload: 2, power: 1 } }), action));
    const req = buildResourceRequest(check, action, { id: 'r1', fromPlayerId: 'p', atS: 0 });
    const out = applyApprovedRequest({ design: noPayload, allocation: { payload: 2, power: 1 } }, req, catalog, ['director']);
    expect(out).toEqual({ kind: 'applied', design: { ...noPayload, componentIds: [...noPayload.componentIds, 'payload-multispectral-basic'] }, allocation: { payload: 2.5, power: 1 } });
    // Explícita con subsistema: sube en amount, el diseño no cambia.
    const explicit: ResourceRequest = { id: 'r2', fromPlayerId: 'p', fromRole: 'science', toRole: 'director', resource: 'budget', amount: 3, subsystem: 'payload', status: 'open', createdAtS: 0 };
    expect(applyApprovedRequest({ design: OK, allocation: { payload: 2 } }, explicit)).toEqual({ kind: 'applied', design: OK, allocation: { payload: 5 } });
  });

  it('allocationAfterApproval solo sube asignaciones existentes de presupuesto', () => {
    const r = { resource: 'budget' as const, subsystem: 'payload' as const, amount: 1.5 };
    expect(allocationAfterApproval({ payload: 2 }, r)).toEqual({ payload: 3.5 });
    expect(allocationAfterApproval(null, r)).toBeNull();
    expect(allocationAfterApproval({ power: 2 }, r)).toEqual({ power: 2 });
    expect(allocationAfterApproval({ payload: 2 }, { ...r, resource: 'power' })).toEqual({ payload: 2 });
    expect(allocationAfterApproval({ payload: 2 }, { resource: 'budget', subsystem: 'payload' })).toEqual({ payload: 2 });
  });
});

describe('reparto del presupuesto', () => {
  it('dinero para piezas = presupuesto − operación − lanzador (el más barato que llega si no hay)', () => {
    // leo-earth-observation: 30 − 0,5·3 − 1,5 (Albatros) = 27; con Colibrí (7,5) = 21.
    expect(allocatableBudgetMUSD(SCENARIO)).toBe(27);
    expect(allocatableBudgetMUSD(SCENARIO, catalog, 'launcher-colibri')).toBe(21);
    expect(allocatableBudgetMUSD({ ...SCENARIO, budgetMUSD: 1 })).toBe(0);
  });

  it('defaultAllocation: proporcional al costo mediano de cada subsistema (valores de referencia)', () => {
    // Medianas del catálogo completo (MUSD): structure 3,5 · power 3 · battery 0,5 · comms 1,8 · obc 0,8 ·
    // adcs 1,2 · thermal 0,45 · payload 8 → Σ = 19,25. payload = 27 · 8 / 19,25 = 11,22.
    expect(defaultAllocation(SCENARIO)).toEqual({
      structure: 4.9, power: 4.2, battery: 0.7, comms: 2.52, obc: 1.12, adcs: 1.68, thermal: 0.63, payload: 11.22,
    });
  });

  it('defaultAllocation es válida en todos los escenarios y, con un diseño, no deja en rojo lo ya montado', () => {
    for (const sc of catalog.scenarios) {
      const alloc = defaultAllocation(sc);
      expect(Object.keys(alloc).sort()).toEqual([...SUBSYSTEM_IDS].sort());
      expect(Object.values(alloc).every((v) => v! >= 0)).toBe(true);
      expect(validateAllocation(alloc, sc), sc.id).toBeNull();
      const fx = loadScenarioFixture(sc.id);
      for (const v of fx?.valid ?? []) {
        const withDesign = defaultAllocation(sc, catalog, { design: v.design });
        expect(validateAllocation(withDesign, sc, catalog, v.design.launcherId), v.name).toBeNull();
        expect(subsystemSpend(v.design, withDesign).filter((s) => s.status === 'over'), v.name).toEqual([]);
      }
    }
  });

  it('validateAllocation: claves, valores y suma', () => {
    expect(validateAllocation(null, SCENARIO)).toBeNull();
    expect(validateAllocation({}, SCENARIO)).toBeNull();
    expect(validateAllocation({ payload: 27 }, SCENARIO)).toBeNull();
    expect(validateAllocation({ payload: 20, power: 8 }, SCENARIO))
      .toEqual({ key: 'team.reject.allocationOverBudget', params: { totalMUSD: 28, availableMUSD: 27 } });
    expect(validateAllocation({ payload: 20, power: 8 }, SCENARIO, catalog, 'launcher-colibri')?.params).toEqual({ totalMUSD: 28, availableMUSD: 21 });
    expect(validateAllocation({ payload: -1 }, SCENARIO)).toEqual({ key: 'team.reject.allocationInvalid', params: { subsystem: 'payload' } });
    expect(validateAllocation({ payload: Number.NaN }, SCENARIO)?.key).toBe('team.reject.allocationInvalid');
    expect(validateAllocation({ laser: 1 } as SubsystemAllocation, SCENARIO)).toEqual({ key: 'team.reject.allocationUnknown', params: { id: 'laser' } });
    expect(checkTeamAction(ctx(['director']), { type: 'allocate-budget', allocation: { payload: 99 } }).kind).toBe('reject');
    expect(checkTeamAction(ctx(['director'], { phase: 'briefing' }), { type: 'allocate-budget', allocation: defaultAllocation(SCENARIO) }).kind).toBe('apply');
  });

  it('subsystemSpend: gasto por subsistema y estado frente a la asignación', () => {
    const spend =Object.fromEntries(subsystemSpend(OK, { payload: 2.6, power: 0.7, battery: 0, comms: 0 }).map((s) => [s.subsystem, s]));
    expect(spend.payload).toMatchObject({ usedMUSD: 2.5, allocatedMUSD: 2.6, status: 'tight' });
    expect(spend.power).toMatchObject({ usedMUSD: 0.7, allocatedMUSD: 0.7, status: 'tight', margin: 0 });
    expect(spend.battery).toMatchObject({ usedMUSD: 0.2, allocatedMUSD: 0, status: 'over', margin: -1 });
    expect(spend.structure).toMatchObject({ usedMUSD: 0.45, allocatedMUSD: null, margin: null, status: 'ok' });
    expect(subsystemSpend(OK, null).every((s) => s.allocatedMUSD === null && s.status === 'ok')).toBe(true);
    expect(subsystemSpend({ ...OK, componentIds: [] }, { payload: 0 }).find((s) => s.subsystem === 'payload')).toMatchObject({ status: 'ok', margin: null });
  });
});

describe('votación Go/No-Go', () => {
  const vote = (role: TeamRole, value: TeamVote['value'], reason?: TeamVote['reason'], atS = 0): TeamVote => ({
    role, playerId: `p-${role}`, value, atS, ...(reason ? { reason } : {}),
  });

  it('validateVote', () => {
    expect(validateVote({ value: 'go' }, true)).toBeNull();
    expect(validateVote({ value: 'go' }, false)).toEqual({ key: 'team.reject.voteGoBlocked' });
    expect(validateVote({ value: 'no-go' }, true)).toEqual({ key: 'team.reject.voteNeedsReason' });
    expect(validateVote({ value: 'no-go', reason: { code: 'power' } }, true)).toBeNull();
    expect(validateVote({ value: 'no-go', reason: { code: 'risk' } }, false)).toBeNull();
    expect(validateVote({ value: 'no-go', reason: { code: 'other' } }, true)).toEqual({ key: 'team.reject.voteNeedsNote' });
    expect(validateVote({ value: 'no-go', reason: { code: 'other', note: ' \n\t ' } }, true)).toEqual({ key: 'team.reject.voteNeedsNote' });
    expect(validateVote({ value: 'no-go', reason: { code: 'other', note: 'no me fío del lanzador' } }, true)).toBeNull();
    expect(validateVote({ value: 'no-go', reason: { code: 'oro' as never } }, true)).toEqual({ key: 'team.reject.voteNeedsReason' });
  });

  it('teamVoteFrom sanea la nota y solo guarda el motivo en un No-Go', () => {
    expect(teamVoteFrom({ type: 'vote', role: 'science', value: 'no-go', reason: { code: 'other', note: '  poca\u0007 ciencia ' } }, 'p1', 7))
      .toEqual({ role: 'science', playerId: 'p1', value: 'no-go', atS: 7, reason: { code: 'other', note: 'poca ciencia' } });
    expect(teamVoteFrom({ type: 'vote', role: 'science', value: 'go', reason: { code: 'risk' } }, 'p1', 7))
      .toEqual({ role: 'science', playerId: 'p1', value: 'go', atS: 7 });
  });

  it('tallyGoNoGo: pendiente, Go con los 4 y motor en Go, primer No-Go válido cierra', () => {
    const go = { go: true };
    expect(tallyGoNoGo([], go)).toEqual({ status: 'pending', missingRoles: [...TEAM_ROLES], noGoVotes: [] });
    const three = [vote('director', 'go'), vote('engineering', 'go'), vote('science', 'go')];
    expect(tallyGoNoGo(three, go)).toEqual({ status: 'pending', missingRoles: ['operations'], noGoVotes: [] });
    expect(tallyGoNoGo([...three, vote('operations', 'go')], go)).toEqual({ status: 'go', missingRoles: [], noGoVotes: [] });
    // Un No-Go sin motivo no vale (cuenta como sin votar).
    expect(tallyGoNoGo([...three, vote('operations', 'no-go')], go).status).toBe('pending');
    const noGo = vote('operations', 'no-go', { code: 'comms' }, 5);
    expect(tallyGoNoGo([...three, noGo], go)).toEqual({ status: 'no-go', missingRoles: [], noGoVotes: [noGo] });
    // Cuenta el último voto de cada rol.
    expect(tallyGoNoGo([...three, noGo, vote('operations', 'go')], go).status).toBe('go');
    const sci = vote('science', 'no-go', { code: 'requirements' }, 2);
    expect(tallyGoNoGo([vote('director', 'go'), sci, noGo], go).noGoVotes).toEqual([sci, noGo]);
    // Con el motor en No-Go los Go no valen.
    expect(tallyGoNoGo([...three, vote('operations', 'go')], { go: false })).toEqual({ status: 'pending', missingRoles: [...TEAM_ROLES], noGoVotes: [] });
  });
});

describe('alertas de equipo', () => {
  const ev = (type: SimEvent['type']): SimEvent => ({ type, tSeconds: 3600, message: { key: 'x' } });

  it('alertForEvent solo para eventos graves, con sus roles', () => {
    expect(alertForEvent(ev('eclipse-enter'), 'a', 0)).toBeNull();
    expect(alertForEvent(ev('battery-low'), 'a', 0)).toBeNull();
    const a = alertForEvent(ev('battery-depleted'), 'a1', 120)!;
    expect(a).toEqual({ id: 'a1', event: ev('battery-depleted'), requiredRoles: ['director', 'engineering', 'operations'], acks: [], raisedAtS: 120, closedAtS: null, timedOut: false });
  });

  it('ackAlert ignora roles no exigidos y repetidos, y cierra al responder todos', () => {
    let a = alertForEvent(ev('solar-storm'), 'a1', 100)!;
    a = ackAlert(a, { role: 'science', playerId: 'p', atS: 101 });
    expect(a.acks).toEqual([]);
    a = ackAlert(a, { role: 'engineering', playerId: 'p1', atS: 105 });
    a = ackAlert(a, { role: 'engineering', playerId: 'p1', atS: 106 });
    expect(a.acks).toHaveLength(1);
    expect(alertSatisfied(a)).toBe(false);
    expect(a.closedAtS).toBeNull();
    a = ackAlert(a, { role: 'operations', playerId: 'p2', atS: 112 });
    expect(alertSatisfied(a)).toBe(true);
    expect(a.closedAtS).toBe(112);
    expect(ackAlert(a, { role: 'operations', playerId: 'p2', atS: 120 })).toBe(a);
  });

  it('plazo y cierre por tiempo', () => {
    const a = alertForEvent(ev('overheating'), 'a1', 100)!;
    expect(alertTimedOut(a, 144.9)).toBe(false);
    expect(alertTimedOut(a, 145)).toBe(true);
    const closed = closeAlert(a, 145, true);
    expect(closed).toMatchObject({ closedAtS: 145, timedOut: true });
    expect(alertTimedOut(closed, 999)).toBe(false);
    expect(closeAlert(closed, 200, false)).toBe(closed);
  });

  it('los eventos graves de una misión real abren alertas', () => {
    const stress: Catalog = {
      ...catalog,
      scenarios: catalog.scenarios.map((s) => (s.id !== SCENARIO.id ? s : { ...s, operationDays: 10, eventTuning: { environmentChancePerDay: 1, componentFailureAcceleration: 1e5 } })),
    };
    const r = runMission(OK, stress, { seed: 3 });
    const alerts = r.events.map((e, i) => alertForEvent(e, `a${i}`, i)).filter((a) => a !== null);
    expect(alerts.length).toBeGreaterThan(0);
    for (const a of alerts) expect(a!.requiredRoles).toEqual(EVENT_RESPONSE_ROLES[a!.event.type]);
  });
});

describe('scoreCollaboration', () => {
  it('sin solicitudes ni alertas es neutra (100), como en solitario', () => {
    expect(scoreCollaboration({ requests: [], alerts: [], endedAtS: 1000 })).toEqual({
      score: 100, requestsTotal: 0, requestsResolved: 0, avgRequestResponseS: null, alertsTotal: 0, alertAcksExpected: 0,
      alertAcksOnTime: 0, avgAlertResponseS: null, criteria: {},
    });
  });

  it('curvas de respuesta (umbrales de TEAM_LIMITS)', () => {
    const req = (t: number) => scoreCollaboration({ requests: [{ status: 'approved', createdAtS: 0, resolvedAtS: t }], alerts: [], endedAtS: 9999 }).criteria.requests;
    expect(req(10)).toBe(1);
    expect(req(60)).toBe(1);
    expect(req(180)).toBe(0.75);
    expect(req(300)).toBe(0.5);
    expect(req(5000)).toBe(0.5);
    const alert = (t: number) => scoreCollaboration({
      requests: [], alerts: [{ requiredRoles: ['engineering'], acks: [{ role: 'engineering', playerId: 'p', atS: 100 + t }], raisedAtS: 100 }], endedAtS: 9999,
    }).criteria.alerts;
    expect(alert(5)).toBe(1);
    expect(alert(20)).toBe(1);
    expect(alert(45)).toBe(0.5);
    expect(alert(70)).toBe(0);
  });

  it('valores de referencia de una partida', () => {
    const s = scoreCollaboration({
      requests: [
        { status: 'approved', createdAtS: 0, resolvedAtS: 30 }, // 1
        { status: 'rejected', createdAtS: 100, resolvedAtS: 280 }, // 180 s → 0,75
        { status: 'open', createdAtS: 400 }, // 0
        { status: 'withdrawn', createdAtS: 500, resolvedAtS: 510 }, // no cuenta
      ],
      alerts: [
        // Ingeniería a los 10 s (1) y Operaciones a los 45 s (0,5).
        { requiredRoles: ['engineering', 'operations'], raisedAtS: 1000, acks: [{ role: 'engineering', playerId: 'a', atS: 1010 }, { role: 'operations', playerId: 'b', atS: 1045 }] },
        // Nadie respondió y el plazo venció (0).
        { requiredRoles: ['engineering'], raisedAtS: 2000, acks: [] },
        // Aún abierta al final y en plazo: no cuenta.
        { requiredRoles: ['director'], raisedAtS: 2990, acks: [] },
      ],
      endedAtS: 3000,
    });
    // requests = (1 + 0,75 + 0) / 3 = 0,5833 · alerts = (1 + 0,5 + 0) / 3 = 0,5 → 100 · 0,5417 = 54,2
    expect(s).toEqual({
      score: 54.2, requestsTotal: 3, requestsResolved: 2, avgRequestResponseS: 105, alertsTotal: 3, alertAcksExpected: 3,
      alertAcksOnTime: 2, avgAlertResponseS: 27.5, criteria: { requests: 0.583, alerts: 0.5 },
    });
  });
});

describe('sanitizePlayerText', () => {
  it('recorta, colapsa espacios y quita controles e invisibles', () => {
    // Caracteres especiales por punto de código (el fuente queda legible y en ASCII).
    const ch = (...codes: number[]) => String.fromCharCode(...codes);
    expect(sanitizePlayerText('  hola   equipo \n\n listo\t ', 280)).toBe('hola equipo listo');
    expect(sanitizePlayerText(`a${ch(0x00)}b${ch(0x7f)}c${ch(0x85)}d`, 280)).toBe('a b c d');
    expect(sanitizePlayerText(`ab${ch(0x200b)}c${ch(0x202e)}d${ch(0x2066)}e${ch(0xfeff)}`, 280)).toBe('abcde');
    expect(sanitizePlayerText(`linea${ch(0x2028)}otra${ch(0x2029)}mas`, 280)).toBe('linea otra mas');
    expect(sanitizePlayerText(`x${ch(0xd800)}y${ch(0xdc00)}z`, 280)).toBe('xyz');
  });

  it('null si no es texto o queda vacío; corta por puntos de código sin partir emojis', () => {
    expect(sanitizePlayerText(42, 10)).toBeNull();
    expect(sanitizePlayerText(undefined, 10)).toBeNull();
    expect(sanitizePlayerText(' \n\t ', 10)).toBeNull();
    expect(sanitizePlayerText('hola', 0)).toBeNull();
    expect(sanitizePlayerText('abcdef', 3)).toBe('abc');
    expect(sanitizePlayerText('ab cd', 3)).toBe('ab');
    const rocket = String.fromCodePoint(0x1f680);
    expect(sanitizePlayerText(`${rocket}${rocket}${rocket}`, 2)).toBe(`${rocket}${rocket}`);
    expect(sanitizePlayerText('ñandú', 24)).toBe('ñandú');
  });
});

describe('mascota en sala: disparadores team:* y role:*', () => {
  const raw = () =>
    structuredClone({
      components: componentsJson, orbits: orbitsJson, launchers: launchersJson, scenarios: scenariosJson,
      glossary: glossaryJson, mascot: mascotJson, academy: academyJson,
    });
  const withTrigger = (trigger: string) => {
    const r = raw();
    (r.mascot as MascotDef).dialogues.push({ id: `test-${trigger.replace(':', '-')}`, trigger, expression: 'happy', text: { es: 'x', en: 'x' } });
    return r;
  };

  it('los tipos nuevos están en MASCOT_TRIGGER_KINDS y los valores son kebab-case', () => {
    expect(MASCOT_TRIGGER_KINDS).toEqual(expect.arrayContaining(['team', 'role']));
    for (const t of TEAM_MASCOT_TRIGGERS) expect(t).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    for (const t of ['lobby', 'roles-combined', 'request-open', 'request-approved', 'request-rejected', 'vote-open', 'vote-go', 'vote-no-go',
      'alert', 'alert-answered', 'allocation', 'player-left', 'player-back', 'ping', 'chat']) {
      expect(TEAM_MASCOT_TRIGGERS as readonly string[]).toContain(t);
    }
    expect(teamMascotTrigger('vote-no-go')).toBe('team:vote-no-go');
    expect(roleMascotTrigger('science')).toBe('role:science');
  });

  it('team:vote-no-go y role:science son válidos; team:foo y role:pilot fallan con mensaje legible', () => {
    const ok = withTrigger('team:vote-no-go');
    (ok.mascot as MascotDef).dialogues.push({ id: 'test-role', trigger: 'role:science', expression: 'happy', text: { es: 'x', en: 'x' } });
    expect(() => parseCatalog(ok)).not.toThrow();
    expect(() => parseCatalog(withTrigger('team:foo'))).toThrow(/disparador de equipo "foo" no existe/);
    expect(() => parseCatalog(withTrigger('role:pilot'))).toThrow(/el rol "pilot" no existe/);
    expect(() => parseCatalog(withTrigger('equipo:lobby'))).toThrow(/disparador inválido/);
  });

  it('el catálogo actual sigue validando', () => {
    expect(() => parseCatalog(raw())).not.toThrow();
  });
});

describe('límites contra el crecimiento del estado y solicitudes duplicadas', () => {
  const camera: TeamAction = { type: 'add-component', componentId: 'payload-thermal-camera' };
  const openReq = (id: string, over: Partial<ResourceRequest> = {}): ResourceRequest => ({
    id, fromPlayerId: 'p-sci', fromRole: 'science', toRole: 'director', resource: 'budget', status: 'open', createdAtS: 0, ...over,
  });
  const sci = (over: Partial<TeamActionContext> = {}) => ctx(['science'], { actorId: 'p-sci', ...over });

  it('nuevos límites de TEAM_LIMITS', () => {
    expect(TEAM_LIMITS).toMatchObject({ maxOpenRequestsPerPlayer: 5, requestMinIntervalS: 2, maxComponents: 40 });
  });

  it('add-component con el diseño ya en maxComponents se rechaza (quitar sí se puede)', () => {
    const full = { ...OK, componentIds: Array.from({ length: TEAM_LIMITS.maxComponents }, () => 'battery-small') };
    expect(checkTeamAction(ctx(['engineering'], { design: full }), { type: 'add-component', componentId: 'battery-small' }))
      .toEqual({ kind: 'reject', reason: { key: 'team.reject.tooManyComponents', params: { max: 40 } } });
    expect(checkTeamAction(ctx(['engineering'], { design: full }), { type: 'remove-component', componentId: 'battery-small' }).kind).not.toBe('reject');
    const almost = { ...full, componentIds: full.componentIds.slice(1) };
    expect(rejectKey(checkTeamAction(ctx([...TEAM_ROLES], { design: almost }), { type: 'add-component', componentId: 'battery-small' })))
      .not.toBe('team.reject.tooManyComponents');
    // Aprobar tampoco supera el tope.
    const req = openReq('r1', { toRole: 'engineering', resource: 'power', action: { type: 'add-component', componentId: 'battery-small' } });
    expect(applyApprovedRequest({ design: full, allocation: null }, req)).toEqual({
      kind: 'reject', reason: { key: 'team.reject.tooManyComponents', params: { max: 40 } },
    });
  });

  it('la misma acción con una solicitud propia abierta es requestPending (pulsar + tres veces no crea tres solicitudes)', () => {
    const pending = openReq('r1', { toRole: 'engineering', resource: 'power', action: { componentId: 'payload-thermal-camera', type: 'add-component' } });
    expect(checkTeamAction(sci({ requests: [pending] }), camera)).toEqual({ kind: 'reject', reason: { key: 'team.reject.requestPending' } });
    // También si la abierta es una encadenada (mismo autor y acción) dirigida a otro rol.
    expect(rejectKey(checkTeamAction(sci({ requests: [{ ...pending, toRole: 'operations', resource: 'comms' }] }), camera))).toBe('team.reject.requestPending');
    // Cerrada, de otro jugador o de otra pieza: no bloquea.
    expect(checkTeamAction(sci({ requests: [{ ...pending, status: 'rejected' }] }), camera).kind).toBe('request');
    expect(checkTeamAction(sci({ requests: [{ ...pending, fromPlayerId: 'otro' }] }), camera).kind).toBe('request');
    expect(checkTeamAction(sci({ requests: [{ ...pending, action: { type: 'add-component', componentId: 'payload-hyperspectral' } }] }), camera).kind).toBe('request');
    // Sin actorId no se puede atribuir: no se filtra.
    expect(checkTeamAction(ctx(['science'], { requests: [pending] }), camera).kind).toBe('request');
  });

  it('maxOpenRequestsPerPlayer: con 5 abiertas no se crea otra (automática ni explícita); lo que se aplica directo sí pasa', () => {
    const five = Array.from({ length: TEAM_LIMITS.maxOpenRequestsPerPlayer }, (_, i) => openReq(`r${i}`));
    const tooMany = { kind: 'reject', reason: { key: 'team.reject.tooManyRequests', params: { max: 5 } } };
    expect(checkTeamAction(sci({ requests: five }), camera)).toEqual(tooMany);
    expect(checkTeamAction(sci({ requests: five }), { type: 'request-resource', resource: 'budget', amount: 1 })).toEqual(tooMany);
    expect(checkTeamAction(sci({ requests: five.slice(1) }), camera).kind).toBe('request');
    expect(checkTeamAction(sci({ requests: [...five.slice(1), { ...five[0]!, status: 'withdrawn' }] }), { type: 'request-resource', resource: 'budget' }).kind).toBe('request');
    expect(checkTeamAction(sci({ requests: five }), { type: 'remove-component', componentId: 'payload-multispectral-basic' })).toEqual({ kind: 'apply' });
    // El duplicado se informa antes que el tope.
    const dup = [...five.slice(1), openReq('rx', { action: camera })];
    expect(rejectKey(checkTeamAction(sci({ requests: dup }), camera))).toBe('team.reject.requestPending');
  });

  it('sameTeamAction compara por estructura, sin importar el orden de las claves', () => {
    expect(sameTeamAction(camera, { componentId: 'payload-thermal-camera', type: 'add-component' } as TeamAction)).toBe(true);
    expect(sameTeamAction(camera, { type: 'remove-component', componentId: 'payload-thermal-camera' })).toBe(false);
    expect(sameTeamAction({ type: 'allocate-budget', allocation: { payload: 1, power: 2 } }, { type: 'allocate-budget', allocation: { power: 2, payload: 1 } })).toBe(true);
    expect(sameTeamAction({ type: 'allocate-budget', allocation: { payload: 1 } }, { type: 'allocate-budget', allocation: null })).toBe(false);
    expect(sameTeamAction({ type: 'ping', target: { kind: 'point', position: [1, 2, 3] } }, { type: 'ping', target: { kind: 'point', position: [1, 2, 4] } })).toBe(false);
    expect(sameTeamAction({ type: 'request-resource', resource: 'power', note: undefined }, { type: 'request-resource', resource: 'power' })).toBe(true);
  });
});

describe('escenarios de equipo', () => {
  // Genérico: no depende de qué escenarios concretos sean de equipo (añadir otro por JSON no rompe nada).
  const TEAM = catalog.scenarios.find(isTeamScenario)!;
  type P = { id: string; roles: TeamRole[]; connected: boolean };
  const designOf = (scenarioId: string): MissionDesign => ({ scenarioId, componentIds: [], orbitId: null, launcherId: null });
  const start = (players: P[], design = designOf(TEAM.id), cat: Catalog = catalog) =>
    checkTeamAction(ctx([], { phase: 'lobby', isHost: true, actorId: players[0]?.id, players, design, catalog: cat }), { type: 'start-mission' });
  /** n jugadores conectados con los roles de combineRoles (cubren los 4). */
  const group = (n: number): P[] => {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const roles = combineRoles(ids);
    return ids.map((id) => ({ id, roles: roles[id]!, connected: true }));
  };

  it('isTeamScenario: minPlayers >= 2; hay al menos un escenario de equipo y es coherente con su campo team', () => {
    expect(TEAM).toBeDefined();
    for (const s of catalog.scenarios) expect(isTeamScenario(s), s.id).toBe((s.team?.minPlayers ?? 1) >= 2);
    expect(isTeamScenario({ team: { minPlayers: 2, maxPlayers: 4 } })).toBe(true);
    expect(isTeamScenario({ team: { minPlayers: 1, maxPlayers: 4 } })).toBe(false);
    expect(isTeamScenario({})).toBe(false);
  });

  it('start-mission exige team.minPlayers jugadores CONECTADOS (aunque uno solo cubra los 4 roles)', () => {
    const min = TEAM.team!.minPlayers;
    const solo = group(1);
    expect(start(solo)).toEqual({ kind: 'reject', reason: { key: 'team.reject.notEnoughPlayers', params: { min } } });
    // Los desconectados no cuentan.
    const ghosts = Array.from({ length: min - 1 }, (_, i): P => ({ id: `g${i}`, roles: [], connected: false }));
    expect(rejectKey(start([...solo, ...ghosts]))).toBe('team.reject.notEnoughPlayers');
    expect(start(group(min)).kind).toBe('apply');
    // Con suficientes conectados pero sin cubrir los roles, sigue faltando gente en un rol.
    const uncovered = group(min).map((p, i, all) => (i === all.length - 1 ? { ...p, roles: [] } : p));
    expect(rejectKey(start(uncovered))).toBe('team.reject.missingRoles');
    // Un escenario normal se puede empezar en solitario.
    expect(start(solo, OK).kind).toBe('apply');
  });

  it('el mínimo sale del escenario del diseño (catálogo sintético con minPlayers 3)', () => {
    const cat: Catalog = { ...catalog, scenarios: catalog.scenarios.map((s) => (s.id === OK.scenarioId ? { ...s, team: { minPlayers: 3, maxPlayers: 4 } } : s)) };
    expect(start(group(2), OK, cat)).toEqual({ kind: 'reject', reason: { key: 'team.reject.notEnoughPlayers', params: { min: 3 } } });
    expect(start(group(3), OK, cat).kind).toBe('apply');
  });
});

describe('historial de solicitudes con tope (purgeRequests + CollaborationInput.purged)', () => {
  type Req = Pick<ResourceRequest, 'status' | 'createdAtS' | 'resolvedAtS'> & { id: string };
  const score = (requests: readonly Req[], endedAtS: number, purged?: ReturnType<typeof purgeRequests>['purged']) =>
    scoreCollaboration({ requests, alerts: [], endedAtS, ...(purged ? { purged } : {}) });

  it('constantes nuevas', () => {
    expect(TEAM_LIMITS).toMatchObject({ requestHistory: 100, requestBurst: 3, requestMinIntervalS: 2 });
  });

  it('valores de referencia: purga primero las retiradas y luego las resueltas más antiguas; la nota no cambia', () => {
    const all: Req[] = [
      { id: 'a', status: 'approved', createdAtS: 0, resolvedAtS: 30 }, // 30 s → 1
      { id: 'b', status: 'rejected', createdAtS: 100, resolvedAtS: 280 }, // 180 s → 0,75
      { id: 'c', status: 'open', createdAtS: 300 },
      { id: 'd', status: 'withdrawn', createdAtS: 350, resolvedAtS: 360 },
      { id: 'e', status: 'approved', createdAtS: 400, resolvedAtS: 800 }, // 400 s → 0,5
    ];
    const { kept, purged } = purgeRequests(all, 1);
    expect(kept.map((r) => r.id)).toEqual(['c', 'e']);
    expect(purged).toEqual({ requestsTotal: 2, requestsResolved: 2, requestCreditSum: 1.75, responseSumS: 210, responseCount: 2 });
    expect(score(kept, 900, purged)).toEqual(score(all, 900));
    expect(score(all, 900)).toMatchObject({ requestsTotal: 4, requestsResolved: 3, avgRequestResponseS: 203.3, criteria: { requests: 0.563 } });
    // Sin exceso no se purga nada.
    expect(purgeRequests(all, 10)).toEqual({ kept: all, purged: { requestsTotal: 0, requestsResolved: 0, requestCreditSum: 0, responseSumS: 0, responseCount: 0 } });
    // Las retiradas se purgan antes que una resuelta más antigua.
    expect(purgeRequests(all, 3).kept.map((r) => r.id)).toEqual(['a', 'b', 'c', 'e']);
    // Las abiertas nunca se purgan, aunque keepClosed sea 0.
    expect(purgeRequests(all, 0).kept.map((r) => r.id)).toEqual(['c']);
  });

  it('solo purga un prefijo de las resueltas: se detiene en una sin resolvedAtS (su tiempo depende del final)', () => {
    const all: Req[] = [
      { id: 'a', status: 'approved', createdAtS: 0, resolvedAtS: 10 },
      { id: 'b', status: 'approved', createdAtS: 5 },
      { id: 'c', status: 'rejected', createdAtS: 20, resolvedAtS: 30 },
    ];
    const { kept, purged } = purgeRequests(all, 0);
    expect(kept.map((r) => r.id)).toEqual(['b', 'c']);
    expect(purged.requestsTotal).toBe(1);
    expect(score(kept, 500, purged)).toEqual(score(all, 500));
  });

  it('servidor simulado: purgar tras cada cambio (acumulando) da exactamente la misma nota que nunca purgar', () => {
    const rng = createRng(2026);
    const full: Req[] = [];
    let live: Req[] = [];
    let purged: ReturnType<typeof purgeRequests>['purged'] | undefined;
    let t = 0;
    for (let step = 0; step < 600; step++) {
      t += rng.next() * 40;
      const open = full.filter((r) => r.status === 'open');
      if (open.length > 0 && rng.chance(0.55)) {
        const target = open[rng.int(0, open.length - 1)]!;
        const status = (['approved', 'rejected', 'withdrawn'] as const)[rng.int(0, 2)]!;
        const closed: Req = { ...target, status, resolvedAtS: t };
        full.splice(full.indexOf(target), 1, closed);
        live = live.map((r) => (r.id === target.id ? closed : r));
      } else {
        const r: Req = { id: `r${step}`, status: 'open', createdAtS: t };
        full.push(r);
        live.push(r);
      }
      ({ kept: live, purged } = purgeRequests(live, TEAM_LIMITS.requestHistory, purged));
      expect(live.filter((r) => r.status !== 'open').length).toBeLessThanOrEqual(TEAM_LIMITS.requestHistory);
    }
    expect(full.length).toBeGreaterThan(live.length + 100);
    expect(live.filter((r) => r.status === 'open')).toEqual(full.filter((r) => r.status === 'open'));
    for (const endedAtS of [t, t + 1, t + 1000]) expect(score(live, endedAtS, purged)).toEqual(score(full, endedAtS));
  });
});

describe('límite de frecuencia de solicitudes (takeRequestToken)', () => {
  it('ráfaga de requestBurst y luego una ficha cada requestMinIntervalS', () => {
    let r = takeRequestToken(null, 100);
    expect(r).toEqual({ ok: true, bucket: { tokens: 2, updatedAtS: 100 } });
    r = takeRequestToken(r.bucket, 100);
    r = takeRequestToken(r.bucket, 100);
    expect(r).toEqual({ ok: true, bucket: { tokens: 0, updatedAtS: 100 } });
    const denied = takeRequestToken(r.bucket, 100);
    expect(denied).toEqual({ ok: false, bucket: { tokens: 0, updatedAtS: 100 }, reason: { key: 'team.reject.requestRateLimited', params: { seconds: 2 } } });
    // A mitad de intervalo falta 1 s; al completarlo hay ficha.
    expect(takeRequestToken(denied.bucket, 101)).toMatchObject({ ok: false, reason: { params: { seconds: 1 } } });
    expect(takeRequestToken(denied.bucket, 102)).toEqual({ ok: true, bucket: { tokens: 0, updatedAtS: 102 } });
  });

  it('las fichas no pasan de la capacidad y un reloj que retrocede no repone', () => {
    let b = takeRequestToken(null, 0).bucket;
    for (let i = 0; i < TEAM_LIMITS.requestBurst - 1; i++) b = takeRequestToken(b, 0).bucket;
    let r = takeRequestToken(b, 10_000);
    expect(r).toEqual({ ok: true, bucket: { tokens: TEAM_LIMITS.requestBurst - 1, updatedAtS: 10_000 } });
    const empty = { tokens: 0, updatedAtS: 50 };
    r = takeRequestToken(empty, 40);
    expect(r).toEqual({ ok: false, bucket: { tokens: 0, updatedAtS: 50 }, reason: { key: 'team.reject.requestRateLimited', params: { seconds: 2 } } });
  });
});
