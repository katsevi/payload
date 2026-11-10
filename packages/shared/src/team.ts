/**
 * Lógica de EQUIPO de la sala multijugador (fase 3). Funciones puras y deterministas: sin reloj (los
 * tiempos `*AtS` son segundos de sala que pasa quien llama), sin azar y sin E/S. El contrato completo
 * está en docs/MULTIPLAYER.md. El servidor (apps/game-server) valida y aplica con estas funciones; el
 * cliente las usa para explicar y habilitar la UI. Nada de aquí cambia `MissionResult`, `runMission`
 * ni `scoreMission`: la colaboración va aparte (paridad sala ↔ motor).
 *
 * Roles (= asesores) y lo que deciden (`ROLE_PERMISSIONS`, `ROLE_SUBSYSTEMS`, `RESOURCE_OWNER`):
 *   director     órbita, lanzador, reparto del presupuesto, empezar diseño, confirmar lanzamiento,
 *                tiempo, terminar operación, rediseñar · resuelve budget y time
 *   engineering  piezas de structure, power, battery, obc, adcs, thermal · resuelve mass, power, battery
 *   science      piezas de payload
 *   operations   piezas de comms, tiempo de la operación · resuelve data, comms, lifetime
 *
 * Solicitudes automáticas (`checkTeamAction`): una acción de diseño que EMPEORA el estado de un recurso
 * (ok → tight|over, tight → over) evaluable antes y después (disponible > 0) cuyo dueño es un rol que
 * el actor no tiene, no se aplica: se convierte en una solicitud al dueño con `amount` = lo que sube el
 * uso (o, si el uso no cambia, lo que baja el disponible: p. ej. la vida útil al añadir una pieza poco
 * fiable). Con reparto de presupuesto, una pieza que deja su subsistema por encima de lo asignado pide a
 * `director` (`resource: 'budget'`, `subsystem`, `amount` = exceso redondeado hacia arriba al céntimo).
 * Si hay varias, gana la más grave: `over` antes que `tight`, luego el orden de `RESOURCE_IDS`, y a
 * igualdad la del reparto (lleva el subsistema y aprobarla sube su asignación).
 * Aprobar (`applyApprovedRequest`) re-aplica la acción sobre el diseño ACTUAL; si además empeora un
 * recurso de un tercer rol, devuelve una solicitud ENCADENADA a ese rol (`approvedBy` acumula los roles
 * conformes —los del solicitante y los que ya aprobaron—, así que la cadena termina en ≤ 4 pasos).
 *
 * Reparto del presupuesto (`defaultAllocation`): el dinero para piezas es lo que deja `budgets.ts` tras
 * operación y lanzador (`allocatableBudgetMUSD`: presupuesto − costo de operación − lanzador elegido, o
 * el más barato de los permitidos que llega a alguna órbita permitida si aún no hay lanzador). Se
 * reparte en proporción al costo MEDIANO de las piezas permitidas de cada subsistema (una pieza "típica"
 * de cada uno), truncando al céntimo para que la suma nunca supere lo disponible. Con un diseño en
 * curso, primero se cubre lo ya montado y se reparte solo el resto (la sugerencia no deja nada en rojo).
 *
 * Votación (`validateVote`, `tallyGoNoGo`): un voto por rol (cuenta el último). No-Go exige motivo y
 * `other` exige nota; Go se rechaza si el motor da No-Go. Un No-Go válido cierra la votación; Go con los
 * 4 roles en Go y el motor en Go.
 *
 * Alertas (`EVENT_RESPONSE_ROLES`): eventos graves que piden respuesta de ciertos roles. Criterio:
 *   solar-storm             engineering + operations   energía y plan de contactos
 *   reaction-wheel-failure  engineering + science      el apuntado de respaldo afecta a los instrumentos
 *   debris-avoidance        director + operations      la maniobra es una decisión de vuelo
 *   component-failure       engineering + operations   aislar la pieza y reorganizar la operación
 *   overheating             engineering + science      el modo seguro térmico apaga los instrumentos
 *   battery-depleted        director + engineering + operations   apagón: todo el equipo de vuelo
 * Los rutinarios (eclipse, contacto, battery-low, storage-full) no abren alerta: pausarían a cada órbita.
 * Responder NO altera la simulación (paridad): mide coordinación y tiempo de respuesta.
 *
 * Colaboración (`scoreCollaboration`), criterios 0-1 (umbrales en `TEAM_LIMITS`):
 *   requests  media por solicitud (las retiradas no cuentan): abierta al final = 0; resuelta (aprobada o
 *             rechazada: decidir también es colaborar) = 1 si se respondió en ≤ 60 s, baja lineal hasta
 *             0,5 a los 300 s y se queda en 0,5.
 *   alerts    media por respuesta exigida (alerta × rol): 1 si ≤ 20 s, baja lineal hasta 0 a los 70 s
 *             (al cierre por tiempo, 45 s, vale 0,5); sin respuesta = 0. Una alerta aún abierta al final
 *             cuyo plazo no había vencido no cuenta para los roles que no respondieron.
 *   score = 100 · media de los criterios presentes; sin solicitudes ni alertas = 100 (neutro, como en
 *   solitario). `withCollaboration` (scoring.ts) lo combina con la puntuación de la misión.
 *   Historial con tope: `purgeRequests` quita solicitudes cerradas del estado y devuelve sus acumulados
 *   (`CollaborationInput.purged`) para que la nota sea idéntica a la de la lista completa.
 */
import { ADVISOR_ROLES } from './advisors';
import { DEFAULT_OPS_COST_MUSD_PER_YEAR, round } from './analysis';
import { computeBudgets, RESOURCE_IDS, TIGHT_MARGIN } from './budgets';
import { catalog as defaultCatalog } from './catalog';
import { TEAM_LIMITS, TEAM_MASCOT_TRIGGERS, TEAM_TIME_SCALES } from './constants';
import type {
  AlertAck, ApprovalOutcome, Catalog, CollaborationInput, CollaborationScore, GoNoGoResult, GoNoGoVoteValue, MessageRef,
  MissionDesign, NoGoReason, NoGoReasonCode, PurgedRequestStats, RequestRateBucket, RequestTokenResult, ResourceId,
  ResourceImpact, ResourceRequest, ResourceStatus, RoomPhase,
  ScenarioDef, SimEvent, SimEventType, SubsystemAllocation, SubsystemId, SubsystemSpend, TeamAction, TeamActionCheck,
  TeamActionContext, TeamAlert, TeamPermission, TeamPlayer, TeamPollResult, TeamRequestCheck, TeamRole, TeamVote,
} from './types';

// ─── Datos ──────────────────────────────────────────────────────────────────

export const TEAM_ROLES: readonly TeamRole[] = ADVISOR_ROLES;
export const ROOM_PHASES: readonly RoomPhase[] = ['lobby', 'briefing', 'design', 'review', 'prelaunch', 'launch', 'operation', 'report'];
export const SUBSYSTEM_IDS: readonly SubsystemId[] = ['structure', 'power', 'battery', 'comms', 'obc', 'adcs', 'thermal', 'payload'];
export const NO_GO_REASON_CODES: readonly NoGoReasonCode[] = [...RESOURCE_IDS, 'requirements', 'risk', 'other'];
export type TeamMascotTrigger = (typeof TEAM_MASCOT_TRIGGERS)[number];

/** Código de unidad de cada recurso (el mismo `ResourceBudget.unit` de budgets.ts; texto en `unit.<código>`). */
export const RESOURCE_UNITS: Record<ResourceId, string> = {
  mass: 'kg', power: 'W', battery: 'Wh', budget: 'MUSD', data: 'Mbit', comms: 'Mbit/d', time: 'months', lifetime: 'years',
};

/** Subsistemas cuyas piezas monta cada rol. */
export const ROLE_SUBSYSTEMS: Record<TeamRole, readonly SubsystemId[]> = {
  director: [],
  engineering: ['structure', 'power', 'battery', 'obc', 'adcs', 'thermal'],
  science: ['payload'],
  operations: ['comms'],
};

/** Rol dueño de cada recurso (coherente con `ROLE_RESOURCES` de los asesores): resuelve sus solicitudes. */
export const RESOURCE_OWNER: Record<ResourceId, TeamRole> = {
  mass: 'engineering', power: 'engineering', battery: 'engineering',
  budget: 'director', time: 'director',
  data: 'operations', comms: 'operations', lifetime: 'operations',
};

/** Tabla de permisos de docs/MULTIPLAYER.md. */
export const ROLE_PERMISSIONS: Record<TeamRole, readonly TeamPermission[]> = {
  director: [
    'design.orbit', 'design.launcher', 'budget.allocate', 'mission.startDesign', 'launch.confirm', 'time.control',
    'mission.finish', 'mission.redesign', 'request.resolve.budget', 'request.resolve.time',
  ],
  engineering: [
    'design.subsystem.structure', 'design.subsystem.power', 'design.subsystem.battery', 'design.subsystem.obc',
    'design.subsystem.adcs', 'design.subsystem.thermal',
    'request.resolve.mass', 'request.resolve.power', 'request.resolve.battery',
  ],
  science: ['design.subsystem.payload'],
  operations: [
    'design.subsystem.comms', 'time.control',
    'request.resolve.data', 'request.resolve.comms', 'request.resolve.lifetime',
  ],
};

/** Fases en que se acepta cada acción (la UI puede usarlo para habilitar botones). */
export const TEAM_ACTION_PHASES: Record<TeamAction['type'], readonly RoomPhase[]> = {
  'set-name': ROOM_PHASES,
  chat: ROOM_PHASES,
  ping: ROOM_PHASES,
  'claim-roles': ['lobby'],
  'auto-assign-roles': ['lobby'],
  'start-mission': ['lobby'],
  'start-design': ['briefing'],
  'add-component': ['design'],
  'remove-component': ['design'],
  'select-orbit': ['design'],
  'select-launcher': ['design'],
  'allocate-budget': ['briefing', 'design'],
  'request-resource': ['design'],
  'resolve-request': ['design'],
  'withdraw-request': ['design'],
  'request-review': ['design'],
  vote: ['review'],
  'confirm-launch': ['prelaunch'],
  'launch-done': ['launch'],
  'set-time-scale': ['operation'],
  'ack-alert': ['operation'],
  'finish-operation': ['operation'],
  redesign: ['report'],
};

/** Eventos que abren una alerta de equipo y roles que deben responder (criterio en la cabecera). */
export const EVENT_RESPONSE_ROLES: Partial<Record<SimEventType, readonly TeamRole[]>> = {
  'solar-storm': ['engineering', 'operations'],
  'reaction-wheel-failure': ['engineering', 'science'],
  'debris-avoidance': ['director', 'operations'],
  'component-failure': ['engineering', 'operations'],
  overheating: ['engineering', 'science'],
  'battery-depleted': ['director', 'engineering', 'operations'],
};

// ─── Utilidades ─────────────────────────────────────────────────────────────

const EPS = 1e-9;
const STATUS_RANK: Record<ResourceStatus, number> = { ok: 0, tight: 1, over: 2 };
const ref = (key: string, params?: MessageRef['params']): MessageRef => (params ? { key, params } : { key });
const reject = (key: string, params?: MessageRef['params']): TeamActionCheck => ({ kind: 'reject', reason: ref(key, params) });
const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const floorCents = (x: number) => Math.floor(x * 100 + 1e-7) / 100;
const ceilCents = (x: number) => Math.ceil(x * 100 - 1e-7) / 100;

export function isTeamRole(x: unknown): x is TeamRole {
  return typeof x === 'string' && (TEAM_ROLES as readonly string[]).includes(x);
}

/** ¿Es un escenario pensado para jugar en equipo? (`ScenarioDef.team.minPlayers` ≥ 2). */
export function isTeamScenario(scenario: Pick<ScenarioDef, 'team'>): boolean {
  return (scenario.team?.minPlayers ?? 1) >= 2;
}

/** Disparador de mascota `team:<valor>`. */
export function teamMascotTrigger(value: TeamMascotTrigger): string {
  return `team:${value}`;
}

/** Disparador de mascota `role:<rol>` (presentación del rol). */
export function roleMascotTrigger(role: TeamRole): string {
  return `role:${role}`;
}

type DesignAction = Extract<TeamAction, { type: 'add-component' | 'remove-component' | 'select-orbit' | 'select-launcher' }>;

/** ¿Es una acción que cambia el diseño (add/remove/orbit/launcher)? */
export function isDesignAction(action: TeamAction): action is DesignAction {
  return action.type === 'add-component' || action.type === 'remove-component' || action.type === 'select-orbit' ||
    action.type === 'select-launcher';
}

// ─── Roles y permisos ───────────────────────────────────────────────────────

/** Reparto por número de jugadores (docs/MULTIPLAYER.md). Índice = nº de jugadores. */
const ROLE_GROUPS: readonly (readonly (readonly TeamRole[])[])[] = [
  [],
  [['director', 'engineering', 'science', 'operations']],
  [['director', 'operations'], ['engineering', 'science']],
  [['director', 'operations'], ['engineering'], ['science']],
  [['director'], ['engineering'], ['science'], ['operations']],
];

/** Comparación lexicográfica de dos claves de igual longitud (> 0 si `a` es mejor). */
function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Permutaciones de 0..n-1 en orden lexicográfico (n ≤ 4: como mucho 24). */
function permutations(n: number): number[][] {
  const out: number[][] = [];
  const rec = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) {
      out.push(prefix);
      return;
    }
    rest.forEach((x, i) => rec([...prefix, x], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  rec([], Array.from({ length: n }, (_, i) => i));
  return out;
}

/**
 * Reparte los 4 roles entre los jugadores (cubre siempre los 4 sin repetir):
 *   1 → los 4 · 2 → [director, operations] + [engineering, science] ·
 *   3 → [director, operations] + [engineering] + [science] · 4 → uno cada uno.
 * Los grupos son fijos; `preferences` decide QUÉ grupo recibe cada jugador: se elige la asignación que
 * conserva más roles preferidos y, a igualdad, la que da a los primeros jugadores (orden de entrada)
 * su preferencia de mayor rango; a igualdad total, el orden de entrada (jugador i → grupo i).
 * Determinista. Ids repetidos se ignoran; a partir del 5.º jugador reciben [] (sala de 4).
 * Para re-repartir tras una salida, pasa los roles actuales como preferencias: cada uno conserva los suyos si cabe.
 */
export function combineRoles(
  playerIds: readonly string[],
  preferences: Readonly<Record<string, readonly TeamRole[]>> = {},
): Record<string, TeamRole[]> {
  const ids = unique(playerIds);
  const out: Record<string, TeamRole[]> = {};
  for (const id of ids) out[id] = [];
  const n = Math.min(ids.length, TEAM_LIMITS.maxPlayers);
  if (n === 0) return out;
  const groups = ROLE_GROUPS[n]!;
  const prefs = ids.slice(0, n).map((id) => unique((preferences[id] ?? []).filter(isTeamRole)));
  let best: number[] = [];
  let bestKey: number[] | null = null;
  for (const perm of permutations(n)) {
    let kept = 0;
    const ranks: number[] = [];
    perm.forEach((g, i) => {
      const group = groups[g]!;
      const p = prefs[i]!;
      kept += p.filter((r) => group.includes(r)).length;
      const rank = p.findIndex((r) => group.includes(r));
      ranks.push(rank < 0 ? -TEAM_ROLES.length : -rank);
    });
    const key = [kept, ...ranks];
    if (bestKey === null || compareKeys(key, bestKey) > 0) {
      best = perm;
      bestKey = key;
    }
  }
  ids.slice(0, n).forEach((id, i) => {
    out[id] = [...groups[best[i]!]!];
  });
  return out;
}

/** Roles sin ningún jugador CONECTADO que los tenga (orden de `TEAM_ROLES`). */
export function missingRoles(players: readonly Pick<TeamPlayer, 'roles' | 'connected'>[]): TeamRole[] {
  return TEAM_ROLES.filter((r) => !players.some((p) => p.connected && p.roles.includes(r)));
}

/** ¿Alguno de estos roles tiene el permiso? */
export function hasPermission(roles: readonly TeamRole[], permission: TeamPermission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r]?.includes(permission) ?? false);
}

/** Primer rol (orden de `TEAM_ROLES`) con el permiso: a quién le toca la decisión. */
export function roleForPermission(permission: TeamPermission): TeamRole {
  return TEAM_ROLES.find((r) => ROLE_PERMISSIONS[r].includes(permission)) ?? 'director';
}

// ─── Diseño ─────────────────────────────────────────────────────────────────

/**
 * Aplica una acción de diseño SIN mutar (misma semántica que el store `useDesign` del cliente):
 * add añade al final, remove quita la ÚLTIMA unidad de ese id (si no hay, devuelve el mismo diseño),
 * select-orbit/select-launcher sustituyen (null = quitar). Cualquier otra acción devuelve el diseño igual.
 */
export function applyDesignAction(design: MissionDesign, action: TeamAction): MissionDesign {
  switch (action.type) {
    case 'add-component':
      return { ...design, componentIds: [...design.componentIds, action.componentId] };
    case 'remove-component': {
      const i = design.componentIds.lastIndexOf(action.componentId);
      if (i < 0) return design;
      return { ...design, componentIds: design.componentIds.filter((_, j) => j !== i) };
    }
    case 'select-orbit':
      return { ...design, componentIds: [...design.componentIds], orbitId: action.orbitId };
    case 'select-launcher':
      return { ...design, componentIds: [...design.componentIds], launcherId: action.launcherId };
    default:
      return design;
  }
}

/**
 * Efecto de pasar de `before` a `after` en cada recurso (orden de `RESOURCE_IDS`): estados, cambio del
 * uso y del disponible, si es evaluable (disponible > 0 antes y después) y si empeora.
 */
export function actionImpact(before: MissionDesign, after: MissionDesign, cat: Catalog = defaultCatalog): ResourceImpact[] {
  const b = computeBudgets(before, cat).resources;
  const a = computeBudgets(after, cat).resources;
  return RESOURCE_IDS.map((id) => {
    const rb = b.find((r) => r.id === id)!;
    const ra = a.find((r) => r.id === id)!;
    return {
      resource: id,
      before: rb.status,
      after: ra.status,
      usedDelta: round(ra.used - rb.used, 6),
      evaluable: rb.available > 0 && ra.available > 0,
      availableDelta: round(ra.available - rb.available, 6),
      worsened: STATUS_RANK[ra.status] > STATUS_RANK[rb.status],
      unit: ra.unit,
    };
  });
}

// ─── Reparto del presupuesto ────────────────────────────────────────────────

/** Lanzador que se reserva al repartir sin lanzador elegido: el más barato de los permitidos que llega. */
function reservedLauncherCostMUSD(scenario: ScenarioDef, cat: Catalog): number {
  const allowed = cat.launchers.filter((l) => scenario.allowedLaunchers.includes(l.id));
  const reaching = allowed.filter((l) => scenario.allowedOrbits.some((o) => (l.capacityKg[o] ?? 0) > 0));
  const pool = reaching.length > 0 ? reaching : allowed;
  return pool.length > 0 ? Math.min(...pool.map((l) => l.costMUSD)) : 0;
}

/**
 * Dinero disponible para PIEZAS (MUSD), como lo cuenta budgets.ts: presupuesto del escenario − costo de
 * operación (`operationsCostMUSDPerYear × minLifetimeYears`) − lanzador (`launcherId` si se da y existe;
 * si no, el más barato de los permitidos que llega a una órbita permitida). Nunca negativo.
 */
export function allocatableBudgetMUSD(scenario: ScenarioDef, cat: Catalog = defaultCatalog, launcherId?: string | null): number {
  const opsMUSD = (scenario.operationsCostMUSDPerYear ?? DEFAULT_OPS_COST_MUSD_PER_YEAR) * scenario.requirements.minLifetimeYears;
  const chosen = launcherId ? cat.launchers.find((l) => l.id === launcherId) : undefined;
  const launcherMUSD = chosen ? chosen.costMUSD : reservedLauncherCostMUSD(scenario, cat);
  return Math.max(0, round(scenario.budgetMUSD - opsMUSD - launcherMUSD, 6));
}

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Reparto sugerido (los 8 subsistemas) del dinero para piezas (`allocatableBudgetMUSD`):
 *  - sin diseño (briefing): en proporción al costo MEDIANO de las piezas permitidas de cada subsistema
 *    (una pieza "típica" de cada uno), truncado al céntimo;
 *  - con `opts.design`: primero cubre lo que ya gasta cada subsistema y reparte solo el RESTO con esa
 *    misma proporción (así la sugerencia nunca deja en rojo lo ya montado); si el diseño ya gasta más de
 *    lo disponible, reparte lo disponible en proporción a lo gastado.
 * La suma nunca supera lo disponible (es válida para `validateAllocation` con el mismo lanzador).
 * `opts.launcherId` (o, si falta, el del diseño) fija el lanzador que se descuenta.
 */
export function defaultAllocation(
  scenario: ScenarioDef,
  cat: Catalog = defaultCatalog,
  opts: { launcherId?: string | null; design?: MissionDesign } = {},
): SubsystemAllocation {
  const available = allocatableBudgetMUSD(scenario, cat, opts.launcherId ?? opts.design?.launcherId ?? null);
  const allowed = scenario.allowedComponents
    ? cat.components.filter((c) => scenario.allowedComponents!.includes(c.id))
    : cat.components;
  const weights = SUBSYSTEM_IDS.map((s) => median(allowed.filter((c) => c.subsystem === s).map((c) => c.costMUSD)));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const spent = opts.design ? subsystemSpend(opts.design, null, cat).map((s) => s.usedMUSD) : SUBSYSTEM_IDS.map(() => 0);
  const totalSpent = spent.reduce((a, b) => a + b, 0);
  const out: SubsystemAllocation = {};
  if (totalSpent > available + EPS) {
    SUBSYSTEM_IDS.forEach((s, i) => {
      out[s] = floorCents((available * spent[i]!) / totalSpent);
    });
    return out;
  }
  const remaining = available - totalSpent;
  SUBSYSTEM_IDS.forEach((s, i) => {
    const share = totalWeight > 0 ? floorCents((remaining * weights[i]!) / totalWeight) : 0;
    out[s] = round(spent[i]! + share, 6);
  });
  return out;
}

/**
 * Valida un reparto: claves de subsistema, valores finitos ≥ 0 y suma ≤ `allocatableBudgetMUSD`.
 * null (sin reparto) es válido. Devuelve el motivo (`team.reject.allocation*`) o null.
 */
export function validateAllocation(
  allocation: SubsystemAllocation | null,
  scenario: ScenarioDef,
  cat: Catalog = defaultCatalog,
  launcherId?: string | null,
): MessageRef | null {
  if (allocation === null) return null;
  if (typeof allocation !== 'object') return ref('team.reject.invalidAction');
  let total = 0;
  for (const [key, value] of Object.entries(allocation) as [string, unknown][]) {
    if (!(SUBSYSTEM_IDS as readonly string[]).includes(key)) return ref('team.reject.allocationUnknown', { id: key });
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return ref('team.reject.allocationInvalid', { subsystem: key });
    total += value;
  }
  const available = allocatableBudgetMUSD(scenario, cat, launcherId);
  if (total > available + 1e-6) {
    return ref('team.reject.allocationOverBudget', { totalMUSD: round(total, 2), availableMUSD: round(available, 2) });
  }
  return null;
}

/**
 * Gasto de cada subsistema (orden de `SUBSYSTEM_IDS`) frente a su asignación. Sin reparto o sin
 * asignación para ese subsistema: `allocatedMUSD` null, estado ok. Estado como en budgets.ts
 * (over si se pasa, tight si queda < 15 %). Ids desconocidos no cuentan.
 */
export function subsystemSpend(
  design: MissionDesign,
  allocation: SubsystemAllocation | null,
  cat: Catalog = defaultCatalog,
): SubsystemSpend[] {
  const byId = new Map(cat.components.map((c) => [c.id, c] as const));
  const used: Record<SubsystemId, number> = { structure: 0, power: 0, battery: 0, comms: 0, obc: 0, adcs: 0, thermal: 0, payload: 0 };
  for (const id of design.componentIds) {
    const c = byId.get(id);
    if (c) used[c.subsystem] += c.costMUSD;
  }
  return SUBSYSTEM_IDS.map((subsystem): SubsystemSpend => {
    const usedMUSD = round(used[subsystem], 6);
    const a = allocation?.[subsystem];
    if (a === undefined || !Number.isFinite(a)) return { subsystem, allocatedMUSD: null, usedMUSD, margin: null, status: 'ok' };
    if (a > 0) {
      const margin = (a - usedMUSD) / a;
      const status: ResourceStatus = usedMUSD > a + EPS ? 'over' : margin < TIGHT_MARGIN ? 'tight' : 'ok';
      return { subsystem, allocatedMUSD: a, usedMUSD, margin, status };
    }
    return usedMUSD > EPS
      ? { subsystem, allocatedMUSD: a, usedMUSD, margin: -1, status: 'over' }
      : { subsystem, allocatedMUSD: a, usedMUSD, margin: null, status: 'ok' };
  });
}

/**
 * Asignación tras aprobar una solicitud: si es de `budget` con `subsystem`, `amount` > 0 y ese
 * subsistema tiene asignación, la sube en `amount`. En cualquier otro caso devuelve la misma.
 */
export function allocationAfterApproval(
  allocation: SubsystemAllocation | null,
  request: Pick<ResourceRequest, 'resource' | 'subsystem' | 'amount'>,
): SubsystemAllocation | null {
  if (allocation === null || request.resource !== 'budget' || !request.subsystem) return allocation;
  const current = allocation[request.subsystem];
  const amount = request.amount ?? 0;
  if (current === undefined || !(amount > 0)) return allocation;
  return { ...allocation, [request.subsystem]: round(current + amount, 6) };
}

// ─── Solicitudes automáticas ────────────────────────────────────────────────

interface Candidate {
  check: TeamRequestCheck;
  severity: number;
  order: number;
  allocation: boolean;
}

/**
 * Solicitud que necesita pasar de `before` a `after` si actúan (o ya están conformes) `roles`; null si
 * ninguna. Ver la cabecera del módulo para la regla y el desempate.
 */
function automaticRequest(
  before: MissionDesign,
  after: MissionDesign,
  roles: readonly TeamRole[],
  allocation: SubsystemAllocation | null,
  cat: Catalog,
  meta: { fromRole: TeamRole; componentId?: string },
): TeamRequestCheck | null {
  const candidates: Candidate[] = [];
  const consenting = TEAM_ROLES.filter((r) => roles.includes(r));
  const base = {
    fromRole: meta.fromRole,
    ...(meta.componentId !== undefined ? { componentId: meta.componentId } : {}),
    approvedBy: consenting,
  };
  for (const imp of actionImpact(before, after, cat)) {
    if (!imp.evaluable || !imp.worsened) continue;
    const toRole = RESOURCE_OWNER[imp.resource];
    if (roles.includes(toRole)) continue;
    const up = imp.usedDelta > EPS;
    const amount = round(up ? imp.usedDelta : Math.max(0, -imp.availableDelta), 2);
    candidates.push({
      severity: STATUS_RANK[imp.after],
      order: RESOURCE_IDS.indexOf(imp.resource),
      allocation: false,
      check: {
        kind: 'request', toRole, resource: imp.resource, amount, ...base,
        why: ref(up ? 'team.request.resourceUp' : 'team.request.resourceDown', {
          fromRole: meta.fromRole, toRole, resource: imp.resource, amount, unit: imp.unit, before: imp.before, after: imp.after,
        }),
      },
    });
  }
  const budgetOwner = RESOURCE_OWNER.budget;
  if (allocation !== null && !roles.includes(budgetOwner)) {
    const prev = subsystemSpend(before, allocation, cat);
    subsystemSpend(after, allocation, cat).forEach((s, i) => {
      if (s.allocatedMUSD === null) return;
      if (s.usedMUSD <= prev[i]!.usedMUSD + EPS || s.usedMUSD <= s.allocatedMUSD + EPS) return;
      const amount = ceilCents(s.usedMUSD - s.allocatedMUSD);
      candidates.push({
        severity: STATUS_RANK.over,
        order: RESOURCE_IDS.indexOf('budget'),
        allocation: true,
        check: {
          kind: 'request', toRole: budgetOwner, resource: 'budget', amount, subsystem: s.subsystem, ...base,
          why: ref('team.request.allocation', {
            fromRole: meta.fromRole, toRole: budgetOwner, subsystem: s.subsystem, amount,
            usedMUSD: round(s.usedMUSD, 2), allocatedMUSD: round(s.allocatedMUSD, 2),
          }),
        },
      });
    });
  }
  candidates.sort((x, y) => y.severity - x.severity || x.order - y.order || Number(y.allocation) - Number(x.allocation));
  return candidates[0]?.check ?? null;
}

function designPermission(action: DesignAction, cat: Catalog): TeamPermission | MessageRef {
  if (action.type === 'select-orbit') return 'design.orbit';
  if (action.type === 'select-launcher') return 'design.launcher';
  const c = cat.components.find((x) => x.id === action.componentId);
  return c ? `design.subsystem.${c.subsystem}` : ref('team.reject.invalidId', { id: action.componentId });
}

/** ¿Tiene sentido la acción sobre este diseño y escenario? (ids, permitidos, pieza presente). */
function designTargetError(design: MissionDesign, action: DesignAction, cat: Catalog, scenario: ScenarioDef): MessageRef | null {
  switch (action.type) {
    case 'add-component':
      if (!cat.components.some((c) => c.id === action.componentId)) return ref('team.reject.invalidId', { id: action.componentId });
      if (scenario.allowedComponents && !scenario.allowedComponents.includes(action.componentId)) {
        return ref('team.reject.componentNotAllowed', { component: action.componentId });
      }
      return null;
    case 'remove-component':
      return design.componentIds.includes(action.componentId) ? null : ref('team.reject.componentAbsent', { component: action.componentId });
    case 'select-orbit':
      if (action.orbitId === null) return null;
      if (!cat.orbits.some((o) => o.id === action.orbitId)) return ref('team.reject.invalidId', { id: String(action.orbitId) });
      return scenario.allowedOrbits.includes(action.orbitId) ? null : ref('team.reject.orbitNotAllowed', { orbit: action.orbitId });
    case 'select-launcher':
      if (action.launcherId === null) return null;
      if (!cat.launchers.some((l) => l.id === action.launcherId)) return ref('team.reject.invalidId', { id: action.launcherId });
      return scenario.allowedLaunchers.includes(action.launcherId) ? null : ref('team.reject.launcherNotAllowed', { launcher: action.launcherId });
  }
}

/** Tope de piezas del diseño (`TEAM_LIMITS.maxComponents`): protege el estado sincronizado. */
function designLimitError(design: MissionDesign, action: DesignAction): MessageRef | null {
  return action.type === 'add-component' && design.componentIds.length >= TEAM_LIMITS.maxComponents
    ? ref('team.reject.tooManyComponents', { max: TEAM_LIMITS.maxComponents })
    : null;
}

/**
 * ¿Son la misma acción? Comparación estructural (independiente del orden de las claves). Sirve para
 * detectar solicitudes duplicadas (`team.reject.requestPending`).
 */
export function sameTeamAction(a: TeamAction, b: TeamAction): boolean {
  return deepEqual(a, b);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Filtro de las acciones que generarían una solicitud (automática o explícita), por jugador
 * (`ctx.actorId`; sin él no se aplica): si ya tiene ABIERTA una solicitud con la misma acción de diseño
 * en espera ⇒ `requestPending` (pulsar "+" tres veces no crea tres solicitudes); si ya tiene
 * `maxOpenRequestsPerPlayer` abiertas ⇒ `tooManyRequests`.
 */
function gateRequest(ctx: TeamActionContext, action: TeamAction, check: TeamRequestCheck): TeamActionCheck {
  if (ctx.actorId === undefined) return check;
  const open = (ctx.requests ?? []).filter((r) => r.status === 'open' && r.fromPlayerId === ctx.actorId);
  if (isDesignAction(action) && open.some((r) => r.action !== undefined && sameTeamAction(r.action, action))) {
    return reject('team.reject.requestPending');
  }
  if (open.length >= TEAM_LIMITS.maxOpenRequestsPerPlayer) {
    return reject('team.reject.tooManyRequests', { max: TEAM_LIMITS.maxOpenRequestsPerPlayer });
  }
  return check;
}

function checkDesignAction(ctx: TeamActionContext, action: DesignAction, cat: Catalog): TeamActionCheck {
  const scenario = cat.scenarios.find((s) => s.id === ctx.design.scenarioId);
  if (!scenario) return reject('team.reject.invalidId', { id: ctx.design.scenarioId });
  const permission = designPermission(action, cat);
  if (typeof permission !== 'string') return { kind: 'reject', reason: permission };
  if (!hasPermission(ctx.actorRoles, permission)) return reject('team.reject.permission', { role: roleForPermission(permission) });
  const target = designTargetError(ctx.design, action, cat, scenario) ?? designLimitError(ctx.design, action);
  if (target) return { kind: 'reject', reason: target };
  const after = applyDesignAction(ctx.design, action);
  const fromRole = TEAM_ROLES.find((r) => ctx.actorRoles.includes(r) && ROLE_PERMISSIONS[r].includes(permission))!;
  const componentId = action.type === 'add-component' || action.type === 'remove-component' ? action.componentId : undefined;
  const request = automaticRequest(ctx.design, after, ctx.actorRoles, ctx.allocation, cat, { fromRole, ...(componentId ? { componentId } : {}) });
  return request ? gateRequest(ctx, action, request) : { kind: 'apply' };
}

function explicitRequest(ctx: TeamActionContext, action: Extract<TeamAction, { type: 'request-resource' }>): TeamActionCheck {
  const roles = ctx.actorRoles;
  if (roles.length === 0) return reject('team.reject.noRole');
  if (action.amount !== undefined && !(Number.isFinite(action.amount) && action.amount > 0)) return reject('team.reject.invalidAmount');
  if (action.subsystem !== undefined && !SUBSYSTEM_IDS.includes(action.subsystem)) return reject('team.reject.allocationUnknown', { id: String(action.subsystem) });
  const toRole = RESOURCE_OWNER[action.resource];
  if (!toRole) return reject('team.reject.invalidAction');
  if (roles.includes(toRole)) return reject('team.reject.ownResource', { resource: action.resource });
  const sub = action.subsystem;
  const fromRole = (sub !== undefined ? TEAM_ROLES.find((r) => roles.includes(r) && ROLE_SUBSYSTEMS[r].includes(sub)) : undefined) ??
    TEAM_ROLES.find((r) => roles.includes(r))!;
  const amount = action.amount ?? 0;
  const key = `team.request.explicit${sub !== undefined ? 'Subsystem' : ''}${amount > 0 ? 'Amount' : ''}`;
  return gateRequest(ctx, action, {
    kind: 'request', toRole, resource: action.resource, amount, fromRole,
    ...(sub !== undefined ? { subsystem: sub } : {}),
    why: ref(key, {
      fromRole, toRole, resource: action.resource, unit: RESOURCE_UNITS[action.resource],
      ...(amount > 0 ? { amount } : {}), ...(sub !== undefined ? { subsystem: sub } : {}),
    }),
  });
}

// ─── Validación de acciones ─────────────────────────────────────────────────

/**
 * Valida una acción de un jugador en el estado actual de la sala:
 *  1. fase (`TEAM_ACTION_PHASES`): `team.reject.phase`;
 *  2. permiso del rol (`ROLE_PERMISSIONS`) o anfitrión (auto-assign-roles, start-mission);
 *  3. ids del catálogo y permitidos por el escenario; pieza presente al quitar; tope de piezas
 *     (`maxComponents`); roles libres al reclamarlos; al empezar, jugadores conectados ≥
 *     `scenario.team.minPlayers` y los 4 roles cubiertos; solicitud/alerta existente y abierta, etc.;
 *  4. regla de solicitudes automáticas (ver cabecera) → `{ kind: 'request', ... }`;
 *  5. si va a crear una solicitud (automática o explícita) y se conoce `ctx.actorId`: misma acción ya en
 *     espera en una solicitud abierta suya ⇒ `requestPending`; `maxOpenRequestsPerPlayer` abiertas ⇒
 *     `tooManyRequests`. El límite de frecuencia (`requestMinIntervalS`) lo aplica el servidor.
 * `request-resource` (explícita) también devuelve `request` (al rol dueño del recurso), para que el
 * servidor cree ambas con `buildResourceRequest`. NO valida el voto (`validateVote`) ni el texto libre
 * (`sanitizePlayerText`), pero sí que el actor tenga el rol por el que vota o responde.
 */
export function checkTeamAction(ctx: TeamActionContext, action: TeamAction): TeamActionCheck {
  const cat = ctx.catalog ?? defaultCatalog;
  const phases = (TEAM_ACTION_PHASES as Partial<Record<string, readonly RoomPhase[]>>)[action.type];
  if (!phases) return reject('team.reject.invalidAction');
  if (!phases.includes(ctx.phase)) return reject('team.reject.phase', { phase: ctx.phase });
  const roles = ctx.actorRoles;
  const need = (permission: TeamPermission): TeamActionCheck =>
    hasPermission(roles, permission) ? { kind: 'apply' } : reject('team.reject.permission', { role: roleForPermission(permission) });

  switch (action.type) {
    case 'set-name':
    case 'chat':
    case 'ping':
    case 'launch-done':
    case 'request-review':
      return { kind: 'apply' };
    case 'claim-roles': {
      for (const role of unique(action.roles)) {
        if (!isTeamRole(role)) return reject('team.reject.invalidAction');
        const holder = ctx.players?.find((p) => p.id !== ctx.actorId && p.roles.includes(role));
        if (holder) return reject('team.reject.roleTaken', { role });
      }
      return { kind: 'apply' };
    }
    case 'auto-assign-roles':
      return ctx.isHost ? { kind: 'apply' } : reject('team.reject.notHost');
    case 'start-mission': {
      if (!ctx.isHost) return reject('team.reject.notHost');
      const team = cat.scenarios.find((s) => s.id === ctx.design.scenarioId)?.team;
      const connected = (ctx.players ?? []).filter((p) => p.connected).length;
      if (team && connected < team.minPlayers) return reject('team.reject.notEnoughPlayers', { min: team.minPlayers });
      const missing = missingRoles(ctx.players ?? []);
      return missing.length > 0 ? reject('team.reject.missingRoles', { role: missing[0]!, count: missing.length }) : { kind: 'apply' };
    }
    case 'start-design':
      return need('mission.startDesign');
    case 'add-component':
    case 'remove-component':
    case 'select-orbit':
    case 'select-launcher':
      return checkDesignAction(ctx, action, cat);
    case 'allocate-budget': {
      const denied = need('budget.allocate');
      if (denied.kind === 'reject') return denied;
      const scenario = cat.scenarios.find((s) => s.id === ctx.design.scenarioId);
      if (!scenario) return reject('team.reject.invalidId', { id: ctx.design.scenarioId });
      const error = validateAllocation(action.allocation, scenario, cat, ctx.design.launcherId);
      return error ? { kind: 'reject', reason: error } : { kind: 'apply' };
    }
    case 'request-resource':
      return explicitRequest(ctx, action);
    case 'resolve-request': {
      const req = ctx.requests?.find((r) => r.id === action.requestId);
      if (!req) return reject('team.reject.requestNotFound');
      if (req.status !== 'open') return reject('team.reject.requestClosed');
      return roles.includes(req.toRole) ? { kind: 'apply' } : reject('team.reject.notRequestOwner', { role: req.toRole });
    }
    case 'withdraw-request': {
      const req = ctx.requests?.find((r) => r.id === action.requestId);
      if (!req) return reject('team.reject.requestNotFound');
      if (req.status !== 'open') return reject('team.reject.requestClosed');
      return ctx.actorId !== undefined && req.fromPlayerId !== ctx.actorId ? reject('team.reject.notRequester') : { kind: 'apply' };
    }
    case 'vote':
      return roles.includes(action.role) ? { kind: 'apply' } : reject('team.reject.notYourRole', { role: action.role });
    case 'confirm-launch':
      return need('launch.confirm');
    case 'set-time-scale': {
      const denied = need('time.control');
      if (denied.kind === 'reject') return denied;
      return (TEAM_TIME_SCALES as readonly number[]).includes(action.accel)
        ? { kind: 'apply' }
        : reject('team.reject.timeScale', { accel: Number.isFinite(action.accel) ? action.accel : 0 });
    }
    case 'ack-alert': {
      if (!roles.includes(action.role)) return reject('team.reject.notYourRole', { role: action.role });
      const alert = ctx.alerts?.find((a) => a.id === action.alertId);
      if (!alert) return reject('team.reject.alertNotFound');
      if (alert.closedAtS !== null) return reject('team.reject.alertClosed');
      if (!alert.requiredRoles.includes(action.role)) return reject('team.reject.alertRole', { role: action.role });
      if (alert.acks.some((k) => k.role === action.role)) return reject('team.reject.alertAcked', { role: action.role });
      return { kind: 'apply' };
    }
    case 'finish-operation':
      return need('mission.finish');
    case 'redesign':
      return need('mission.redesign');
    default:
      return reject('team.reject.invalidAction');
  }
}

// ─── Solicitudes: crear, aprobar, cerrar ────────────────────────────────────

/**
 * Crea la `ResourceRequest` abierta a partir de un veredicto `request` de `checkTeamAction` (o de una
 * solicitud encadenada de `applyApprovedRequest`). Guarda la acción en espera solo si es de diseño;
 * la nota de `request-resource` pasa por `sanitizePlayerText`. Para una encadenada, pasa la acción y
 * el `fromPlayerId` de la solicitud original.
 */
export function buildResourceRequest(
  check: TeamRequestCheck,
  action: TeamAction | undefined,
  meta: { id: string; fromPlayerId: string; atS: number },
): ResourceRequest {
  const req: ResourceRequest = {
    id: meta.id,
    fromPlayerId: meta.fromPlayerId,
    fromRole: check.fromRole,
    toRole: check.toRole,
    resource: check.resource,
    status: 'open',
    createdAtS: meta.atS,
    why: check.why,
  };
  if (check.amount > 0) req.amount = check.amount;
  if (check.subsystem !== undefined) req.subsystem = check.subsystem;
  if (check.componentId !== undefined) req.componentId = check.componentId;
  if (action && isDesignAction(action)) req.action = { ...action };
  if (action?.type === 'request-resource') {
    const note = sanitizePlayerText(action.note, TEAM_LIMITS.noteMaxChars);
    if (note !== null) req.note = note;
  }
  if (check.approvedBy && check.approvedBy.length > 0) req.approvedBy = [...check.approvedBy];
  return req;
}

/**
 * Re-aplica una solicitud aprobada sobre el estado ACTUAL de la sala:
 *  - sube la asignación (`allocationAfterApproval`) y, si hay acción en espera y se aplica, se asegura
 *    de que el subsistema de la solicitud cubra su gasto;
 *  - sin acción en espera (explícitas) → `applied` con el mismo diseño;
 *  - si la acción ya no tiene sentido (pieza ausente, id no permitido…) → `reject` con el motivo;
 *  - si además empeora un recurso de un rol que no está conforme (ni solicitante, ni quienes ya
 *    aprobaron, ni `approverRoles`) → `request` encadenada (crearla con `buildResourceRequest`).
 * `approverRoles`: los roles de quien aprueba (todos cuentan como conformes).
 */
export function applyApprovedRequest(
  state: { design: MissionDesign; allocation: SubsystemAllocation | null },
  request: ResourceRequest,
  cat: Catalog = defaultCatalog,
  approverRoles: readonly TeamRole[] = [],
): ApprovalOutcome {
  let allocation = allocationAfterApproval(state.allocation, request);
  const action = request.action && isDesignAction(request.action) ? request.action : null;
  if (!action) return { kind: 'applied', design: state.design, allocation };
  const scenario = cat.scenarios.find((s) => s.id === state.design.scenarioId);
  if (!scenario) return { kind: 'reject', reason: ref('team.reject.invalidId', { id: state.design.scenarioId }) };
  const permission = designPermission(action, cat);
  if (typeof permission !== 'string') return { kind: 'reject', reason: permission };
  const target = designTargetError(state.design, action, cat, scenario) ?? designLimitError(state.design, action);
  if (target) return { kind: 'reject', reason: target };
  const after = applyDesignAction(state.design, action);
  const consenting = unique([...(request.approvedBy ?? [request.fromRole]), request.fromRole, request.toRole, ...approverRoles]);
  const next = automaticRequest(state.design, after, consenting, allocation, cat, {
    fromRole: request.fromRole,
    ...(request.componentId !== undefined ? { componentId: request.componentId } : {}),
  });
  if (next) return { kind: 'request', check: next, allocation };
  if (allocation !== null && request.subsystem !== undefined) {
    const cap = allocation[request.subsystem];
    const spend = subsystemSpend(after, allocation, cat).find((s) => s.subsystem === request.subsystem);
    if (cap !== undefined && spend && spend.usedMUSD > cap + EPS) allocation = { ...allocation, [request.subsystem]: spend.usedMUSD };
  }
  return { kind: 'applied', design: after, allocation };
}

/** Cierra una solicitud (aprobada, rechazada o retirada). La nota pasa por `sanitizePlayerText`. */
export function closeRequest(
  request: ResourceRequest,
  outcome: { status: Exclude<ResourceRequest['status'], 'open'>; atS: number; byPlayerId?: string; note?: unknown; reason?: MessageRef },
): ResourceRequest {
  const out: ResourceRequest = { ...request, status: outcome.status, resolvedAtS: outcome.atS };
  if (outcome.byPlayerId !== undefined) out.resolvedByPlayerId = outcome.byPlayerId;
  const note = sanitizePlayerText(outcome.note, TEAM_LIMITS.noteMaxChars);
  if (note !== null) out.resolutionNote = note;
  if (outcome.reason) out.resolutionReason = outcome.reason;
  return out;
}

// ─── Votación Go/No-Go ──────────────────────────────────────────────────────

/**
 * Valida el contenido de un voto: No-Go sin motivo (o con un código desconocido) ⇒ error;
 * `other` sin nota (tras `sanitizePlayerText`) ⇒ error; Go con el motor en No-Go ⇒ error.
 */
export function validateVote(vote: { value: GoNoGoVoteValue; reason?: NoGoReason }, engineGo: boolean): MessageRef | null {
  if (vote.value === 'go') return engineGo ? null : ref('team.reject.voteGoBlocked');
  if (vote.value !== 'no-go') return ref('team.reject.invalidAction');
  const reason = vote.reason;
  if (!reason || !NO_GO_REASON_CODES.includes(reason.code)) return ref('team.reject.voteNeedsReason');
  if (reason.code === 'other' && sanitizePlayerText(reason.note, TEAM_LIMITS.noteMaxChars) === null) return ref('team.reject.voteNeedsNote');
  return null;
}

/** Voto a guardar a partir de la acción `vote` (nota saneada; el motivo solo se guarda en un No-Go). */
export function teamVoteFrom(action: Extract<TeamAction, { type: 'vote' }>, playerId: string, atS: number): TeamVote {
  const vote: TeamVote = { role: action.role, playerId, value: action.value, atS };
  if (action.value === 'no-go' && action.reason) {
    const note = sanitizePlayerText(action.reason.note, TEAM_LIMITS.noteMaxChars);
    vote.reason = note !== null ? { code: action.reason.code, note } : { code: action.reason.code };
  }
  return vote;
}

/**
 * Recuento: un voto por rol (cuenta el ÚLTIMO de la lista); los inválidos (`validateVote`) se ignoran.
 * Algún No-Go válido ⇒ `no-go` (con esos votos en orden cronológico); los 4 roles en Go y el motor en
 * Go ⇒ `go`; si no ⇒ `pending`. `missingRoles` = roles sin voto válido.
 */
export function tallyGoNoGo(votes: readonly TeamVote[], engineReview: Pick<GoNoGoResult, 'go'>): TeamPollResult {
  const last = new Map<TeamRole, { vote: TeamVote; index: number }>();
  votes.forEach((vote, index) => {
    if (isTeamRole(vote.role)) last.set(vote.role, { vote, index });
  });
  const valid = [...last.values()].filter((e) => validateVote(e.vote, engineReview.go) === null);
  const missing = TEAM_ROLES.filter((r) => !valid.some((e) => e.vote.role === r));
  const noGoVotes = valid.filter((e) => e.vote.value === 'no-go').sort((a, b) => a.index - b.index).map((e) => e.vote);
  if (noGoVotes.length > 0) return { status: 'no-go', missingRoles: missing, noGoVotes };
  if (engineReview.go && missing.length === 0) return { status: 'go', missingRoles: [], noGoVotes: [] };
  return { status: 'pending', missingRoles: missing, noGoVotes: [] };
}

// ─── Alertas de equipo ──────────────────────────────────────────────────────

/** Alerta para un evento de `EVENT_RESPONSE_ROLES` (null si el evento no la necesita). */
export function alertForEvent(event: SimEvent, id: string, raisedAtS: number): TeamAlert | null {
  const roles = EVENT_RESPONSE_ROLES[event.type];
  if (!roles || roles.length === 0) return null;
  return { id, event: { ...event }, requiredRoles: [...roles], acks: [], raisedAtS, closedAtS: null, timedOut: false };
}

/** ¿Respondieron todos los roles exigidos? */
export function alertSatisfied(alert: Pick<TeamAlert, 'requiredRoles' | 'acks'>): boolean {
  return alert.requiredRoles.every((r) => alert.acks.some((a) => a.role === r));
}

/**
 * Añade una respuesta (ignora la de un rol no exigido, repetida o con la alerta cerrada). Si con ella
 * responden todos, la alerta queda cerrada en `ack.atS`.
 */
export function ackAlert(alert: TeamAlert, ack: AlertAck): TeamAlert {
  if (alert.closedAtS !== null || !alert.requiredRoles.includes(ack.role) || alert.acks.some((a) => a.role === ack.role)) return alert;
  const next: TeamAlert = { ...alert, acks: [...alert.acks, { ...ack }] };
  return alertSatisfied(next) ? { ...next, closedAtS: ack.atS } : next;
}

/** ¿Venció el plazo (`TEAM_LIMITS.alertTimeoutS`) de una alerta abierta? */
export function alertTimedOut(alert: Pick<TeamAlert, 'closedAtS' | 'raisedAtS'>, nowS: number): boolean {
  return alert.closedAtS === null && nowS - alert.raisedAtS >= TEAM_LIMITS.alertTimeoutS;
}

/** Cierra una alerta (por tiempo: `timedOut` = true). */
export function closeAlert(alert: TeamAlert, atS: number, timedOut: boolean): TeamAlert {
  return alert.closedAtS !== null ? alert : { ...alert, closedAtS: atS, timedOut };
}

// ─── Colaboración ───────────────────────────────────────────────────────────

/** 1 hasta `fullS`, lineal hasta `floor` en `zeroS`, `floor` después. */
function responseCredit(t: number, fullS: number, zeroS: number, floor: number): number {
  if (t <= fullS) return 1;
  if (t >= zeroS) return floor;
  return 1 - ((1 - floor) * (t - fullS)) / (zeroS - fullS);
}

/** Crédito 0-1 de una solicitud resuelta en `t` segundos. */
function requestCredit(t: number): number {
  return responseCredit(t, TEAM_LIMITS.requestFullCreditS, TEAM_LIMITS.requestSlowS, TEAM_LIMITS.requestSlowCredit);
}

const NO_PURGED: PurgedRequestStats = { requestsTotal: 0, requestsResolved: 0, requestCreditSum: 0, responseSumS: 0, responseCount: 0 };

/**
 * Purga el historial de solicitudes para que el estado no crezca sin tope: conserva TODAS las abiertas y
 * como mucho `keepClosed` cerradas (`TEAM_LIMITS.requestHistory`). Quita primero las retiradas (no
 * cuentan para la nota) y luego las resueltas más antiguas (las primeras de la lista: el servidor las
 * añade en orden de creación). Devuelve la lista conservada (mismo orden) y los acumulados de las
 * purgadas sumados a `previous`, de modo que
 *   scoreCollaboration({ requests: kept, purged, ... }) === scoreCollaboration({ requests: todas, ... })
 * exactamente (las sumas se hacen en el mismo orden). Para garantizarlo solo se purga un PREFIJO de las
 * resueltas: si una resuelta no tiene `resolvedAtS` (su tiempo dependería del final), se detiene ahí.
 */
export function purgeRequests<T extends Pick<ResourceRequest, 'status' | 'createdAtS' | 'resolvedAtS'>>(
  requests: readonly T[],
  keepClosed: number = TEAM_LIMITS.requestHistory,
  previous?: PurgedRequestStats,
): { kept: T[]; purged: PurgedRequestStats } {
  const purged: PurgedRequestStats = { ...(previous ?? NO_PURGED) };
  let excess = requests.filter((r) => r.status !== 'open').length - Math.max(0, Math.floor(keepClosed));
  if (excess <= 0) return { kept: [...requests], purged };
  const drop = new Set<number>();
  requests.forEach((r, i) => {
    if (excess > 0 && r.status === 'withdrawn') {
      drop.add(i);
      excess -= 1;
    }
  });
  for (let i = 0; i < requests.length && excess > 0; i++) {
    const r = requests[i]!;
    if (r.status !== 'approved' && r.status !== 'rejected') continue;
    if (r.resolvedAtS === undefined || !Number.isFinite(r.resolvedAtS)) break;
    const t = Math.max(0, r.resolvedAtS - r.createdAtS);
    purged.requestsTotal += 1;
    purged.requestsResolved += 1;
    purged.requestCreditSum += requestCredit(t);
    purged.responseSumS += t;
    purged.responseCount += 1;
    drop.add(i);
    excess -= 1;
  }
  return { kept: requests.filter((_, i) => !drop.has(i)), purged };
}

/**
 * Cubeta de fichas para el límite de frecuencia de solicitudes de un jugador (la aplica el servidor):
 * capacidad `TEAM_LIMITS.requestBurst` (empieza llena), una ficha nueva cada `requestMinIntervalS`.
 * Cada `request-resource` o acción que generaría una solicitud gasta una. Sin ficha ⇒ `ok: false` con
 * `team.reject.requestRateLimited` y los segundos (redondeados hacia arriba) hasta la siguiente.
 * Guarda el `bucket` devuelto en ambos casos. `bucket` null = jugador sin historial.
 */
export function takeRequestToken(bucket: RequestRateBucket | null, nowS: number): RequestTokenResult {
  const cap = TEAM_LIMITS.requestBurst;
  const interval = TEAM_LIMITS.requestMinIntervalS;
  // Si el reloj de la sala retrocediera, no se reponen fichas ni se retrasa la marca.
  const updatedAtS = bucket ? Math.max(nowS, bucket.updatedAtS) : nowS;
  const tokens = bucket ? Math.min(cap, bucket.tokens + Math.max(0, nowS - bucket.updatedAtS) / interval) : cap;
  if (tokens >= 1 - 1e-9) return { ok: true, bucket: { tokens: Math.max(0, tokens - 1), updatedAtS } };
  const seconds = Math.max(1, Math.ceil((1 - tokens) * interval - 1e-9));
  return { ok: false, bucket: { tokens, updatedAtS }, reason: ref('team.reject.requestRateLimited', { seconds }) };
}

/** Puntuación de colaboración 0-100 (criterios y umbrales en la cabecera del módulo y en `TEAM_LIMITS`). */
export function scoreCollaboration(input: CollaborationInput): CollaborationScore {
  const L = TEAM_LIMITS;
  // Acumuladores de solicitudes: parten de lo ya purgado (`purgeRequests`) y suman la lista en orden, así
  // la secuencia de sumas es la misma que con la lista completa y el resultado es idéntico.
  let requestsTotal = input.purged?.requestsTotal ?? 0;
  let requestsResolved = input.purged?.requestsResolved ?? 0;
  let requestCreditSum = input.purged?.requestCreditSum ?? 0;
  let responseSumS = input.purged?.responseSumS ?? 0;
  let responseCount = input.purged?.responseCount ?? 0;
  for (const r of input.requests) {
    if (r.status === 'withdrawn') continue;
    requestsTotal += 1;
    if (r.status !== 'approved' && r.status !== 'rejected') continue;
    const t = Math.max(0, (r.resolvedAtS ?? input.endedAtS) - r.createdAtS);
    requestsResolved += 1;
    requestCreditSum += requestCredit(t);
    responseSumS += t;
    responseCount += 1;
  }
  const criteria: Record<string, number> = {};
  if (requestsTotal > 0) criteria.requests = requestCreditSum / requestsTotal;

  let expected = 0;
  let onTime = 0;
  let alertCredit = 0;
  const alertTimes: number[] = [];
  for (const alert of input.alerts) {
    for (const role of unique(alert.requiredRoles)) {
      const acks = alert.acks.filter((a) => a.role === role);
      if (acks.length === 0) {
        // Abierta al final y aún en plazo: ese rol no tuvo tiempo de responder.
        if (input.endedAtS - alert.raisedAtS < L.alertTimeoutS) continue;
        expected += 1;
        continue;
      }
      const t = Math.max(0, Math.min(...acks.map((a) => a.atS)) - alert.raisedAtS);
      expected += 1;
      alertTimes.push(t);
      alertCredit += responseCredit(t, L.alertFullCreditS, L.alertZeroCreditS, 0);
      if (t <= L.alertTimeoutS) onTime += 1;
    }
  }
  if (expected > 0) criteria.alerts = alertCredit / expected;

  const values = Object.values(criteria);
  const score = values.length > 0 ? 100 * mean(values) : 100;
  return {
    score: round(score, 1),
    requestsTotal,
    requestsResolved,
    avgRequestResponseS: responseCount > 0 ? round(responseSumS / responseCount, 1) : null,
    alertsTotal: input.alerts.length,
    alertAcksExpected: expected,
    alertAcksOnTime: onTime,
    avgAlertResponseS: alertTimes.length > 0 ? round(mean(alertTimes), 1) : null,
    criteria: Object.fromEntries(Object.entries(criteria).map(([k, v]) => [k, round(v, 3)])),
  };
}

// ─── Texto libre de los jugadores ───────────────────────────────────────────

// Las clases de caracteres se construyen desde puntos de código numéricos para que el fuente sea ASCII.
const chars = (...codes: number[]) => String.fromCharCode(...codes);
const range = (from: number, to: number) => `${chars(from)}-${chars(to)}`;
/** Controles de dirección (bidi), marcas invisibles y BOM: se quitan (evitan textos engañosos). */
const INVISIBLE = new RegExp(`[${chars(0x200b, 0x200e, 0x200f, 0xfeff)}${range(0x202a, 0x202e)}${range(0x2066, 0x2069)}]`, 'g');
/** Sustitutos UTF-16 sueltos (no forman un carácter válido). */
const HIGH_SURROGATES = range(0xd800, 0xdbff);
const LOW_SURROGATES = range(0xdc00, 0xdfff);
const LONE_SURROGATE = new RegExp(`[${HIGH_SURROGATES}](?![${LOW_SURROGATES}])|(?<![${HIGH_SURROGATES}])[${LOW_SURROGATES}]`, 'g');
/** Caracteres de control (C0, DEL, C1) y separadores de línea/párrafo (2028, 2029): se convierten en espacio. */
const CONTROL = new RegExp(`[\\p{Cc}${chars(0x2028, 0x2029)}]`, 'gu');

/**
 * Sanea texto libre (nombre, chat, notas): quita controles e invisibles, colapsa espacios, recorta y
 * corta a `maxChars` puntos de código. null si no es una cadena o queda vacío.
 */
export function sanitizePlayerText(text: unknown, maxChars: number): string | null {
  if (typeof text !== 'string' || !(maxChars >= 1)) return null;
  const clean = text.replace(LONE_SURROGATE, '').replace(INVISIBLE, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length === 0) return null;
  const points = Array.from(clean);
  const cut = points.length > maxChars ? points.slice(0, Math.floor(maxChars)).join('').trim() : clean;
  return cut.length > 0 ? cut : null;
}
