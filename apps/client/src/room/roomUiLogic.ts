/**
 * Lógica PURA de la interfaz de sala (fase 3): sin React ni Three. Todo lo que decide la UI de equipo
 * (colores de rol, estado de los votos, tiempos de alertas, no leídos del chat, caducidad de pings,
 * colocación de avatares, reparto editable, formulario de No-Go) vive aquí para poder probarlo.
 * Las REGLAS de juego (permisos, solicitudes, votos válidos) NO se duplican: salen de `@payload/shared`
 * (`canDo` en net/roomStore.ts).
 */
import {
  RESOURCE_OWNER, RESOURCE_UNITS, isTeamScenario, SUBSYSTEM_IDS, TEAM_LIMITS, TEAM_ROLES, catalog, subsystemSpend, validateAllocation,
  type AvatarPose, type Catalog, type ChatMessage, type CollaborationScore, type MessageRef, type MissionDesign, type NoGoReason,
  type NoGoReasonCode, type PingTarget, type ResourceId, type ResourceRequest, type RoomView, type ScenarioDef, type SubsystemAllocation,
  type SubsystemId, type SubsystemSpend, type TeamAlert, type TeamPlayer, type TeamPollResult, type TeamRole, type TeamVote,
} from '@payload/shared';
import { NO_GO_REASON_CODES } from '@payload/shared';

// ─── Roles ──────────────────────────────────────────────────────────────────

/** Orden fijo de los roles (el mismo del motor). */
export const ROLE_ORDER: readonly TeamRole[] = TEAM_ROLES;

/** Color de cada rol (chips, etiquetas de avatar, pings). Contraste suficiente sobre el fondo oscuro de los paneles. */
export const ROLE_COLOR: Record<TeamRole, string> = {
  director: '#f2b134',
  engineering: '#5b8cff',
  science: '#38e1c0',
  operations: '#ff6fa5',
};
/** Color de quien aún no tiene rol. */
export const NO_ROLE_COLOR = '#94a3b8';

export const roleColor = (role: TeamRole | null | undefined): string => (role ? ROLE_COLOR[role] : NO_ROLE_COLOR);

/** Rol principal de un jugador: el primero en el orden del motor (director, ingeniería, ciencia, operaciones). */
export function primaryRole(roles: readonly TeamRole[]): TeamRole | null {
  return ROLE_ORDER.find((r) => roles.includes(r)) ?? null;
}

/** Recursos que vigila un rol (los que resuelve: `RESOURCE_OWNER`), en el orden de `RESOURCE_UNITS`. */
export function roleResources(role: TeamRole): ResourceId[] {
  return (Object.keys(RESOURCE_UNITS) as ResourceId[]).filter((r) => RESOURCE_OWNER[r] === role);
}

/** Alterna un rol en mi selección (un jugador puede llevar varios), manteniendo el orden del motor. */
export function toggleRole(current: readonly TeamRole[], role: TeamRole): TeamRole[] {
  const set = new Set(current);
  if (set.has(role)) set.delete(role);
  else set.add(role);
  return ROLE_ORDER.filter((r) => set.has(r));
}

/** Nombre a mostrar: el del jugador o "Jugador N" (N = posición de llegada, desde 1). */
export function playerLabel(player: Pick<TeamPlayer, 'name'>, index: number, fallback: (n: number) => string): string {
  const name = player.name.trim();
  return name.length > 0 ? name : fallback(index + 1);
}

export type ConnectionTone = 'ok' | 'warn' | 'bad';
export const connectionTone = (status: string): ConnectionTone =>
  status === 'connected' ? 'ok' : status === 'connecting' || status === 'reconnecting' ? 'warn' : 'bad';

// ─── Tiempo ─────────────────────────────────────────────────────────────────

/**
 * Segundo de sala conocido más reciente (el servidor no publica su reloj: se toma el mayor `atS` visible).
 * Cota inferior del "ahora"; `useRoomClock` (hooks.ts) lo hace avanzar con el reloj local.
 */
export function roomNowS(view: Pick<RoomView, 'chat' | 'requests' | 'votes' | 'alerts' | 'lastNoGo' | 'mascot'> | null): number {
  if (!view) return 0;
  let m = 0;
  const up = (n: number | null | undefined) => {
    if (typeof n === 'number' && Number.isFinite(n) && n > m) m = n;
  };
  view.chat.forEach((c) => up(c.atS));
  view.requests.forEach((r) => {
    up(r.createdAtS);
    up(r.resolvedAtS);
  });
  view.votes.forEach((v) => up(v.atS));
  view.alerts.forEach((a) => {
    up(a.raisedAtS);
    up(a.closedAtS);
    a.acks.forEach((k) => up(k.atS));
  });
  up(view.lastNoGo?.atS);
  up(view.mascot?.atS);
  return m;
}

export interface RelativeAge {
  unit: 's' | 'min' | 'h';
  value: number;
}
/** "hace N s / min / h" a partir de la diferencia en segundos de sala. */
export function relativeAge(nowS: number, atS: number): RelativeAge {
  const d = Math.max(0, Math.floor(nowS - atS));
  if (d < 60) return { unit: 's', value: d };
  if (d < 3600) return { unit: 'min', value: Math.floor(d / 60) };
  return { unit: 'h', value: Math.floor(d / 3600) };
}

export interface DurationParts {
  key: 's' | 'min' | 'minS';
  params: { n?: number; min?: number; s?: number };
}
/** Duración (no «hace…»): «42 s», «2 min», «1 min 5 s». Claves `room.duration.*`. */
export function durationParts(seconds: number): DurationParts {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return { key: 's', params: { n: total } };
  const min = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? { key: 'min', params: { n: min } } : { key: 'minS', params: { min, s } };
}

// ─── Solicitudes ────────────────────────────────────────────────────────────

/** Abiertas primero (las más antiguas arriba: llevan más esperando) y después las resueltas (las más recientes arriba). */
export function sortRequests(requests: readonly ResourceRequest[]): { open: ResourceRequest[]; closed: ResourceRequest[] } {
  const open = requests.filter((r) => r.status === 'open').sort((a, b) => a.createdAtS - b.createdAtS);
  const closed = requests
    .filter((r) => r.status !== 'open')
    .sort((a, b) => (b.resolvedAtS ?? b.createdAtS) - (a.resolvedAtS ?? a.createdAtS));
  return { open, closed };
}

export interface RequestLine {
  id: string;
  status: ResourceRequest['status'];
  fromPlayerId: string;
  fromRole: TeamRole;
  toRole: TeamRole;
  resource: ResourceId;
  /** Cantidad y código de unidad (`unit.<código>` en ns sim); null si no hay cantidad. */
  amount: number | null;
  unit: string;
  subsystem: SubsystemId | null;
  componentId: string | null;
  note: string | null;
  resolutionNote: string | null;
  why: MessageRef | null;
  resolutionReason: MessageRef | null;
  /** Roles que ya aprobaron la acción en espera (cadena de aprobaciones). */
  approvedBy: TeamRole[];
  /** Roles que aún deben decidir (el destinatario si sigue abierta). */
  pendingRole: TeamRole | null;
  /** Solicitud a medias en una cadena: ya la aprobó alguien y ahora espera a otro rol. */
  chained: boolean;
  /** Segundos desde que se creó (o desde que se resolvió, si ya está resuelta). */
  ageS: number;
}

export function requestLine(r: ResourceRequest, nowS: number): RequestLine {
  const approvedBy = r.approvedBy ?? [];
  return {
    id: r.id,
    status: r.status,
    fromPlayerId: r.fromPlayerId,
    fromRole: r.fromRole,
    toRole: r.toRole,
    resource: r.resource,
    amount: typeof r.amount === 'number' && r.amount > 0 ? r.amount : null,
    unit: RESOURCE_UNITS[r.resource],
    subsystem: r.subsystem ?? null,
    componentId: r.componentId ?? null,
    note: r.note ?? null,
    resolutionNote: r.resolutionNote ?? null,
    why: r.why ?? null,
    resolutionReason: r.resolutionReason ?? null,
    approvedBy: [...approvedBy],
    pendingRole: r.status === 'open' ? r.toRole : null,
    chained: r.status === 'open' && approvedBy.length > 0,
    ageS: Math.max(0, nowS - (r.status === 'open' ? r.createdAtS : (r.resolvedAtS ?? r.createdAtS))),
  };
}

/** ¿Puedo aprobar/rechazar esta solicitud (abierta y dirigida a uno de mis roles)? */
export const canResolveRequest = (r: Pick<ResourceRequest, 'status' | 'toRole'>, myRoles: readonly TeamRole[]): boolean =>
  r.status === 'open' && myRoles.includes(r.toRole);
/** ¿Puedo retirarla (abierta y mía)? */
export const canWithdrawRequest = (r: Pick<ResourceRequest, 'status' | 'fromPlayerId'>, myId: string | null): boolean =>
  r.status === 'open' && myId !== null && r.fromPlayerId === myId;

/** Borrador del formulario de solicitud explícita → acción (cantidad > 0 o ausente). */
export interface RequestDraft {
  resource: ResourceId;
  amount: string;
  subsystem: SubsystemId | '';
  note: string;
}
export function parsePositive(text: string): number | null {
  const n = Number(text.replace(',', '.').trim());
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
}
export function requestFromDraft(d: RequestDraft): { resource: ResourceId; amount?: number; subsystem?: SubsystemId; note?: string } {
  const amount = parsePositive(d.amount);
  const note = d.note.trim();
  return {
    resource: d.resource,
    ...(amount !== null ? { amount } : {}),
    ...(d.subsystem ? { subsystem: d.subsystem } : {}),
    ...(note ? { note } : {}),
  };
}

// ─── Votación Go/No-Go ──────────────────────────────────────────────────────

export interface RoleVoteState {
  role: TeamRole;
  state: 'pending' | 'go' | 'no-go';
  playerId: string | null;
  reason: NoGoReason | null;
}

/** Estado del voto de cada rol (cuenta el ÚLTIMO voto; sin voto válido = pendiente). */
export function voteStates(votes: readonly TeamVote[], poll: Pick<TeamPollResult, 'missingRoles'> | null): RoleVoteState[] {
  return ROLE_ORDER.map((role) => {
    const last = [...votes].reverse().find((v) => v.role === role);
    if (!last || (poll && poll.missingRoles.includes(role))) return { role, state: 'pending', playerId: null, reason: null };
    return { role, state: last.value, playerId: last.playerId, reason: last.reason ?? null };
  });
}

export const NO_GO_CODES: readonly NoGoReasonCode[] = NO_GO_REASON_CODES;

export interface NoGoForm {
  code: NoGoReasonCode | null;
  note: string;
}
/** Error de validación del formulario de No-Go: sin motivo, o «otro» sin nota (clave ui `room.vote.error.*`). */
export function noGoFormError(form: NoGoForm): 'code' | 'note' | null {
  if (!form.code || !NO_GO_CODES.includes(form.code)) return 'code';
  if (form.code === 'other' && form.note.trim() === '') return 'note';
  return null;
}
/** Motivo listo para enviar (null si el formulario no es válido). */
export function noGoReasonFrom(form: NoGoForm): NoGoReason | null {
  if (noGoFormError(form) !== null || !form.code) return null;
  const note = form.note.trim();
  return note ? { code: form.code, note } : { code: form.code };
}

/** Líneas del último No-Go para el panel (motivos de la votación con rol y autor). */
export interface NoGoLine {
  role: TeamRole;
  playerId: string;
  code: NoGoReasonCode;
  note: string | null;
}
export function noGoVoteLines(votes: readonly TeamVote[]): NoGoLine[] {
  return votes
    .filter((v) => v.value === 'no-go' && v.reason)
    .map((v) => ({ role: v.role, playerId: v.playerId, code: v.reason!.code, note: v.reason!.note ?? null }));
}

// ─── Alertas de equipo ──────────────────────────────────────────────────────

/** Segundos que quedan para que la alerta cierre sola (0 si ya venció). */
export function alertRemainingS(alert: Pick<TeamAlert, 'raisedAtS' | 'closedAtS'>, nowS: number): number {
  if (alert.closedAtS !== null) return 0;
  return Math.max(0, Math.min(TEAM_LIMITS.alertTimeoutS, TEAM_LIMITS.alertTimeoutS - (nowS - alert.raisedAtS)));
}
/** Roles exigidos que aún no respondieron. */
export const alertPendingRoles = (a: Pick<TeamAlert, 'requiredRoles' | 'acks'>): TeamRole[] =>
  a.requiredRoles.filter((r) => !a.acks.some((k) => k.role === r));
/** Mis roles que deben responder y aún no lo hicieron. */
export const myAlertRoles = (a: Pick<TeamAlert, 'requiredRoles' | 'acks' | 'closedAtS'>, myRoles: readonly TeamRole[]): TeamRole[] =>
  a.closedAtS === null ? alertPendingRoles(a).filter((r) => myRoles.includes(r)) : [];
/** Alertas abiertas que acaban de aparecer respecto a las ya vistas (para el sonido de aviso). */
export function newAlertIds(alerts: readonly Pick<TeamAlert, 'id' | 'closedAtS'>[], seen: ReadonlySet<string>): string[] {
  return alerts.filter((a) => a.closedAtS === null && !seen.has(a.id)).map((a) => a.id);
}

// ─── Chat ───────────────────────────────────────────────────────────────────

/** Mensajes de OTROS jugadores posteriores al último visto (si el visto ya salió del historial, todos). */
export function chatUnread(chat: readonly ChatMessage[], myId: string | null, seenId: string | null): number {
  const i = seenId ? chat.findIndex((m) => m.id === seenId) : -1;
  return chat.slice(i + 1).filter((m) => m.playerId !== myId).length;
}
/** Último mensaje de otro jugador (para la región `aria-live`). */
export function lastFromOthers(chat: readonly ChatMessage[], myId: string | null): ChatMessage | null {
  for (let i = chat.length - 1; i >= 0; i--) if (chat[i]!.playerId !== myId) return chat[i]!;
  return null;
}
/** Texto del chat listo para enviar (recortado; null si vacío). */
export function chatDraft(text: string): string | null {
  const t = text.trim();
  return t === '' ? null : t.slice(0, TEAM_LIMITS.chatMaxChars);
}

// ─── Pings ──────────────────────────────────────────────────────────────────

export const pingActive = (p: { expiresAtMs: number }, nowMs: number): boolean => p.expiresAtMs > nowMs;
/** Opacidad 1 → 0 en el último segundo de vida del marcador. */
export function pingFade(p: { expiresAtMs: number }, nowMs: number): number {
  const left = p.expiresAtMs - nowMs;
  return left <= 0 ? 0 : Math.min(1, left / 1000);
}

/** Punto del suelo/aire al que apunta un rayo: corta el plano `y = planeY` si mira hacia abajo; si no, a `reach` metros. */
export function pingPointFromRay(
  head: readonly [number, number, number],
  dir: readonly [number, number, number],
  opts: { planeY?: number; reach?: number } = {},
): [number, number, number] {
  const planeY = opts.planeY ?? 1.5;
  const reach = opts.reach ?? 6;
  const max = 14;
  let t = reach;
  if (dir[1] < -0.05) t = Math.min(max, Math.max(0.5, (head[1] - planeY) / -dir[1]));
  const r = (n: number) => Math.round(n * 100) / 100;
  return [r(head[0] + dir[0] * t), r(Math.max(0, head[1] + dir[1] * t)), r(head[2] + dir[2] * t)];
}

/** Posición en el hangar de un ping (cajas de los estantes, estantes, nave, consola). */
export function pingWorldPosition(
  target: PingTarget,
  layout: {
    boxes: readonly { id: string; pos: readonly [number, number, number] }[];
    shelves: readonly { subsystem: SubsystemId; x: number }[];
    shelfZ: number;
    ship: readonly [number, number, number];
    console: readonly [number, number, number];
  },
): [number, number, number] {
  switch (target.kind) {
    case 'point':
      return [target.position[0], target.position[1], target.position[2]];
    case 'component': {
      const box = layout.boxes.find((b) => b.id === target.id);
      return box ? [box.pos[0], box.pos[1] + 0.6, box.pos[2]] : [layout.ship[0], layout.ship[1] + 2.4, layout.ship[2]];
    }
    case 'subsystem': {
      const shelf = layout.shelves.find((s) => s.subsystem === target.id);
      return shelf ? [shelf.x, 2.9, layout.shelfZ + 0.5] : [layout.ship[0], layout.ship[1] + 2.4, layout.ship[2]];
    }
    case 'resource':
      return [layout.console[0], layout.console[1] + 2.3, layout.console[2]];
  }
}

/** Texto de un ping para la lista 2D: clave `ui` + parámetros (el componente resuelve nombres del catálogo). */
export function pingTargetKey(target: PingTarget): { kind: PingTarget['kind']; id: string | null } {
  return { kind: target.kind, id: target.kind === 'point' ? null : target.id };
}

// ─── Avatares ───────────────────────────────────────────────────────────────

export interface ConsoleSlot {
  role: TeamRole;
  position: [number, number, number];
  /** Giro Y de la consola para mirar al centro (su frente es +Z local). */
  yaw: number;
}
const CONSOLE_RADIUS = 5.6;
const CONSOLE_ANGLES = [-0.95, -0.32, 0.32, 0.95];
/** Cuatro consolas en arco (una por rol) mirando al centro de la sala de control. */
export const CONSOLE_SLOTS: readonly ConsoleSlot[] = ROLE_ORDER.map((role, i) => {
  const a = CONSOLE_ANGLES[i] ?? 0;
  const x = Math.sin(a) * CONSOLE_RADIUS;
  const z = -Math.cos(a) * CONSOLE_RADIUS + 1;
  return { role, position: [x, 0, z] as [number, number, number], yaw: Math.atan2(-x, -(z - 1)) };
});

export interface AvatarSpot {
  playerId: string;
  role: TeamRole | null;
  position: [number, number, number];
  /** Giro Y del modelo (mira a +Z con yaw 0). */
  yaw: number;
}
/**
 * Dónde se coloca a cada jugador: delante de la consola de su rol principal (mirándola); quien aún no tiene
 * rol espera en una fila delante. Solo jugadores conectados o con rol; el orden de llegada manda.
 */
export function placeAvatars(players: readonly Pick<TeamPlayer, 'id' | 'roles' | 'connected'>[]): AvatarSpot[] {
  const out: AvatarSpot[] = [];
  const idle = players.filter((p) => primaryRole(p.roles) === null);
  players.forEach((p) => {
    const role = primaryRole(p.roles);
    if (role) {
      const slot = CONSOLE_SLOTS.find((s) => s.role === role)!;
      // 1,1 m delante de la consola (hacia el centro), de cara a ella.
      const x = slot.position[0] + Math.sin(slot.yaw) * 1.1;
      const z = slot.position[2] + Math.cos(slot.yaw) * 1.1;
      out.push({ playerId: p.id, role, position: [x, 0, z], yaw: slot.yaw + Math.PI });
    } else {
      const i = idle.findIndex((q) => q.id === p.id);
      out.push({ playerId: p.id, role: null, position: [(i - (idle.length - 1) / 2) * 1.8, 0, 3.2], yaw: 0 });
    }
  });
  return out;
}

const wrapAngle = (a: number): number => {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
};
/** Factor de suavizado independiente de los fps (la pose llega a ~10 Hz). */
export const poseSmoothing = (dt: number, rate = 12): number => 1 - Math.exp(-rate * Math.max(0, dt));
/** Acerca `cur` a `target` (muta `cur`, sin crear objetos); el giro toma el camino corto. */
export function lerpPose(cur: AvatarPose, target: AvatarPose, k: number): AvatarPose {
  cur.x += (target.x - cur.x) * k;
  cur.y += (target.y - cur.y) * k;
  cur.z += (target.z - cur.z) * k;
  cur.yaw = wrapAngle(cur.yaw + wrapAngle(target.yaw - cur.yaw) * k);
  return cur;
}

// ─── Reparto de presupuesto ─────────────────────────────────────────────────

export interface AllocationRow {
  subsystem: SubsystemId;
  allocatedMUSD: number | null;
  usedMUSD: number;
  status: SubsystemSpend['status'];
}
export const allocationRows = (design: MissionDesign, allocation: SubsystemAllocation | null, cat: Catalog = catalog): AllocationRow[] =>
  subsystemSpend(design, allocation, cat).map((s) => ({ subsystem: s.subsystem, allocatedMUSD: s.allocatedMUSD, usedMUSD: s.usedMUSD, status: s.status }));

export type AllocationDraft = Record<SubsystemId, string>;
const fmtDraft = (n: number): string => String(Math.round(n * 100) / 100);
/** Borrador editable (texto por subsistema) desde un reparto (vacío = sin tope). */
export function draftFromAllocation(allocation: SubsystemAllocation | null): AllocationDraft {
  const d = {} as AllocationDraft;
  for (const s of SUBSYSTEM_IDS) d[s] = allocation && typeof allocation[s] === 'number' ? fmtDraft(allocation[s]!) : '';
  return d;
}
/** Borrador → reparto (campos vacíos = sin asignar). null si algún campo no es un número ≥ 0. */
export function allocationFromDraft(draft: AllocationDraft): SubsystemAllocation | null {
  const out: SubsystemAllocation = {};
  for (const s of SUBSYSTEM_IDS) {
    const text = draft[s].trim();
    if (text === '') continue;
    const n = Number(text.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return null;
    out[s] = n;
  }
  return out;
}
export const draftTotal = (draft: AllocationDraft): number =>
  SUBSYSTEM_IDS.reduce((sum, s) => {
    const n = Number(draft[s].replace(',', '.'));
    return sum + (draft[s].trim() !== '' && Number.isFinite(n) ? n : 0);
  }, 0);
/** Validación del borrador con `validateAllocation` de shared (null = válido). */
export function draftError(draft: AllocationDraft, scenario: ScenarioDef, launcherId: string | null, cat: Catalog = catalog): MessageRef | null {
  const allocation = allocationFromDraft(draft);
  if (allocation === null) return { key: 'team.reject.allocationInvalid', params: { subsystem: SUBSYSTEM_IDS.find((s) => Number.isNaN(Number(draft[s].replace(',', '.'))) || Number(draft[s].replace(',', '.')) < 0) ?? 'structure' } };
  return validateAllocation(allocation, scenario, cat, launcherId);
}

// ─── Informe de colaboración ────────────────────────────────────────────────

export interface CollabRow {
  key: 'requests' | 'requestTime' | 'alerts' | 'alertTime';
  /** Valor principal (cuenta o segundos) y total si procede. */
  value: number | null;
  total: number | null;
}
/** Desglose de la colaboración para el informe (solo lo medible; sin datos = null). */
export function collabRows(c: CollaborationScore): CollabRow[] {
  return [
    { key: 'requests', value: c.requestsResolved, total: c.requestsTotal },
    { key: 'requestTime', value: c.avgRequestResponseS, total: null },
    { key: 'alerts', value: c.alertAcksOnTime, total: c.alertAcksExpected },
    { key: 'alertTime', value: c.avgAlertResponseS, total: null },
  ];
}

// ─── Entrada a la sala ──────────────────────────────────────────────────────

/** Escenario por defecto de la sala: el primero de equipo (`isTeamScenario`) si existe; si no, el primero de la lista. */
export function defaultRoomScenario(scenarios: readonly Pick<ScenarioDef, 'id' | 'team'>[]): string {
  return (scenarios.find((s) => isTeamScenario(s)) ?? scenarios[0])?.id ?? '';
}
/** Nombre válido: recortado a `TEAM_LIMITS.nameMaxChars` (puede quedar vacío: el servidor pone "Jugador N"). */
export const cleanName = (name: string): string => name.trim().slice(0, TEAM_LIMITS.nameMaxChars);
/** Código de sala normalizado (sin espacios). */
export const cleanCode = (code: string): string => code.trim();

/** Roles sin ningún jugador conectado (lobby), en el orden del motor. */
export const uncoveredRoles = (players: readonly Pick<TeamPlayer, 'roles' | 'connected'>[]): TeamRole[] =>
  ROLE_ORDER.filter((r) => !players.some((p) => p.connected && p.roles.includes(r)));

// ─── Pieza en la mano y solicitudes rápidas ─────────────────────────────────

/** Tiempo máximo entre soltar una pieza y el rechazo del servidor para devolverla a la mano. */
export const RETURN_TO_HAND_MS = 3000;
/** Tras una solicitud propia, los «+» que generarían otra se desactivan este tiempo (límite de ráfaga del servidor). */
export const REQUEST_COOLDOWN_MS = 2000;

/**
 * Si el servidor rechazó un `add-component` justo después de soltar `dropped`, devuelve el id de la pieza que
 * debe volver a la mano (y solo si la mano sigue libre). Relojes: el mismo (`performance.now()`).
 */
export function pieceToReturn(
  rejected: { action: string; atMs: number } | null,
  dropped: { id: string; atMs: number } | null,
  heldId: string | null,
  windowMs: number = RETURN_TO_HAND_MS,
): string | null {
  if (!rejected || !dropped || heldId !== null || rejected.action !== 'add-component') return null;
  const dt = rejected.atMs - dropped.atMs;
  return dt >= 0 && dt <= windowMs ? dropped.id : null;
}

/** ¿Sigue activo el enfriamiento tras mi última solicitud? */
export const requestCooldownActive = (nowMs: number, lastRequestAtMs: number | null, ms: number = REQUEST_COOLDOWN_MS): boolean =>
  lastRequestAtMs !== null && nowMs - lastRequestAtMs < ms;
