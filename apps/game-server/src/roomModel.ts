/**
 * Modelo PURO de una sala cooperativa (sin Colyseus ni reloj: el tiempo entra como `nowS` y `dt`).
 * `CrewRoom` es solo el adaptador de red. Contrato: docs/MULTIPLAYER.md.
 *
 * - Lobby: hasta 4 jugadores eligen rol (único por sala, opcional) y se marcan listos; el anfitrión empieza.
 * - Partida: una sola `Run` del motor con un tripulante por jugador (por orden de entrada). El servidor
 *   pone el `crewId` de quien envía cada acción (nadie actúa por otro) y limita el trabajo mantenido
 *   (`seconds`) al tiempo real transcurrido. Todo lo demás lo decide el motor.
 * - Caídas: el jugador conserva sitio y tripulante; si se va del todo, su tripulante se queda en la nave
 *   (o fuera, hasta que se le acabe el oxígeno). Sin nadie conectado, el tiempo no avanza.
 */
import {
  COOP_LIMITS, createRun, FIXED_STEP_S, MAX_WORK_SECONDS, parseActionMessage, parseLobbyAction, parsePing, parsePose, ROLE_IDS, sanitizePlayerName,
  type ActionResult, type Catalog, type CoopPlayer, type CrewPose, type JoinErrorCode, type LobbyView, type PingBroadcast, type PosesMessage, type ResultMessage,
  type RoleId, type RoomPhase, type Run, type RunAction, type RunEvent, type StateMessage,
} from '@payload/shared';

/** Acciones cuyo `seconds` es trabajo mantenido: no pueden sumar más que el tiempo real transcurrido. */
const WORK_ACTIONS: ReadonlySet<RunAction['type']> = new Set(['work-incident', 'repair-system', 'jetpack']);
/** Holgura del presupuesto de trabajo frente al jitter de red. */
const WORK_BUDGET_SLACK = 1.15;
/** Acciones que llevan el tripulante que actúa (el servidor lo impone). */
const CREW_ACTIONS: ReadonlySet<RunAction['type']> = new Set([
  'work-incident', 'repair-system', 'evade', 'eva-exit', 'eva-enter', 'set-position', 'jetpack', 'fall-impact', 'deploy-tool', 'collect', 'retrieve-tool',
]);

interface Player {
  id: string;
  name: string;
  role: RoleId | null;
  ready: boolean;
  connected: boolean;
  /** Se fue del todo durante la partida (su tripulante sigue en el estado). */
  gone: boolean;
  crewId: number | null;
  pose: CrewPose | null;
  workBudgetS: number;
  workAtS: number;
  lastPingS: number;
}

export interface RoomModelOptions {
  code: string;
  /** Semilla de cada partida nueva (la pone el servidor; en tests, fija). */
  nextSeed: () => number;
  catalog?: Catalog;
}

export interface TickResult {
  events: RunEvent[];
  /** Se ejecutó al menos un paso fijo (hay estado nuevo que difundir). */
  stepped: boolean;
}

export class RoomModel {
  readonly code: string;
  private readonly nextSeed: () => number;
  private readonly catalog: Catalog | undefined;
  private players: Player[] = [];
  private hostId: string | null = null;
  private phaseValue: RoomPhase = 'lobby';
  private runValue: Run | null = null;
  private runId = 0;
  private tickCount = 0;
  private accumulatorS = 0;
  private sectorSent = '';

  constructor(options: RoomModelOptions) {
    this.code = options.code;
    this.nextSeed = options.nextSeed;
    this.catalog = options.catalog;
  }

  get phase(): RoomPhase {
    return this.phaseValue;
  }

  /** La partida en curso (null en el lobby). Solo lectura para quien consume. */
  get run(): Run | null {
    return this.runValue;
  }

  get tick(): number {
    return this.tickCount;
  }

  get view(): LobbyView {
    return {
      code: this.code,
      phase: this.phaseValue,
      runId: this.runId,
      players: this.players
        .filter((p) => !p.gone)
        .map((p): CoopPlayer => ({ id: p.id, name: p.name, role: p.role, ready: p.ready, connected: p.connected, host: p.id === this.hostId, crewId: p.crewId })),
    };
  }

  private find(id: string): Player | undefined {
    return this.players.find((p) => p.id === id && !p.gone);
  }

  private pickHost(): void {
    if (this.hostId && this.find(this.hostId)?.connected) return;
    this.hostId = (this.players.find((p) => !p.gone && p.connected) ?? this.players.find((p) => !p.gone))?.id ?? null;
  }

  // ── Entradas y salidas ──────────────────────────────────────────────────────────────────────

  join(id: string, rawName: unknown): { ok: true } | { ok: false; code: JoinErrorCode } {
    if (this.phaseValue !== 'lobby') return { ok: false, code: 'in-progress' };
    if (this.players.length >= COOP_LIMITS.maxPlayers) return { ok: false, code: 'room-full' };
    const name = sanitizePlayerName(rawName, `#${this.players.length + 1}`);
    this.players.push({ id, name, role: null, ready: false, connected: true, gone: false, crewId: null, pose: null, workBudgetS: 0, workAtS: 0, lastPingS: -Infinity });
    this.pickHost();
    return { ok: true };
  }

  /** Caída sin consentimiento: conserva sitio, rol y tripulante. */
  drop(id: string): void {
    const p = this.find(id);
    if (!p) return;
    p.connected = false;
    p.pose = null;
    this.pickHost();
  }

  reconnect(id: string): void {
    const p = this.find(id);
    if (!p) return;
    p.connected = true;
    this.pickHost();
  }

  /** Salida definitiva. En el lobby libera el sitio; en partida, su tripulante se queda en el estado. */
  leave(id: string): void {
    const p = this.find(id);
    if (!p) return;
    if (this.phaseValue === 'lobby') this.players = this.players.filter((x) => x !== p);
    else {
      p.gone = true;
      p.connected = false;
      p.pose = null;
    }
    if (this.hostId === id) this.hostId = null;
    this.pickHost();
  }

  /** Jugadores conectados (sin ninguno, el tiempo no avanza). */
  get connectedCount(): number {
    return this.players.filter((p) => !p.gone && p.connected).length;
  }

  /** Queda alguien con sitio en la sala (conectado o en gracia). */
  get isEmpty(): boolean {
    return this.players.every((p) => p.gone);
  }

  // ── Lobby ───────────────────────────────────────────────────────────────────────────────────

  /** Devuelve true si la vista del lobby cambió. */
  lobby(id: string, raw: unknown): boolean {
    const p = this.find(id);
    const action = parseLobbyAction(raw);
    if (!p || !action) return false;
    switch (action.type) {
      case 'set-role': {
        if (this.phaseValue !== 'lobby') return false;
        if (action.role !== null && this.players.some((x) => x !== p && !x.gone && x.role === action.role)) return false;
        p.role = action.role;
        return true;
      }
      case 'set-ready':
        if (this.phaseValue !== 'lobby') return false;
        p.ready = action.ready;
        return true;
      case 'start': {
        if (this.phaseValue !== 'lobby' || id !== this.hostId) return false;
        if (this.players.some((x) => x !== p && x.connected && !x.ready)) return false;
        this.start();
        return true;
      }
      case 'restart': {
        if (this.phaseValue !== 'playing' || id !== this.hostId || this.runValue?.state.phase !== 'lost') return false;
        this.toLobby();
        return true;
      }
    }
  }

  private start(): void {
    // Los que estén caídos al empezar pierden el sitio: la tripulación son los presentes.
    this.players = this.players.filter((p) => p.connected);
    this.players.forEach((p, i) => {
      p.crewId = i + 1;
      p.pose = null;
      p.workBudgetS = MAX_WORK_SECONDS;
      p.workAtS = -Infinity;
    });
    const roles = this.players.map((p) => (p.role && ROLE_IDS.includes(p.role) ? p.role : null));
    this.runValue = createRun({ seed: this.nextSeed(), crewSize: this.players.length, roles, ...(this.catalog ? { catalog: this.catalog } : {}) });
    this.runId++;
    this.tickCount = 0;
    this.accumulatorS = 0;
    this.sectorSent = '';
    this.phaseValue = 'playing';
  }

  private toLobby(): void {
    this.players = this.players.filter((p) => !p.gone);
    for (const p of this.players) {
      p.crewId = null;
      p.ready = false;
      p.pose = null;
    }
    this.runValue = null;
    this.phaseValue = 'lobby';
    this.pickHost();
  }

  // ── Partida ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Acción de un jugador. Devuelve el rechazo que hay que enviarle (null si se aceptó o se ignoró).
   * `nowS` es el reloj de la sala (segundos reales).
   */
  action(id: string, raw: unknown, nowS: number): ResultMessage | null {
    const p = this.find(id);
    const msg = parseActionMessage(raw);
    const run = this.runValue;
    if (!p || !msg || !run || p.crewId === null) return null;
    const action = { ...msg.action } as RunAction & { crewId?: number; seconds?: number };
    if (CREW_ACTIONS.has(action.type)) action.crewId = p.crewId;
    else delete action.crewId;
    if (WORK_ACTIONS.has(action.type)) {
      const elapsed = Number.isFinite(p.workAtS) ? Math.max(0, nowS - p.workAtS) : MAX_WORK_SECONDS;
      p.workBudgetS = Math.min(MAX_WORK_SECONDS, p.workBudgetS + elapsed * WORK_BUDGET_SLACK);
      p.workAtS = nowS;
      const seconds = Math.min(Math.max(0, Number(action.seconds) || 0), p.workBudgetS);
      p.workBudgetS -= seconds;
      action.seconds = seconds;
    }
    let result: ActionResult;
    try {
      result = run.apply(action);
    } catch {
      // Una acción con campos imposibles no puede tirar la sala.
      result = { ok: false, reason: { key: 'reject.invalid' } };
    }
    return result.ok ? null : { seq: msg.seq, reason: result.reason };
  }

  /** Avanza el tiempo real `dt` s. Sin nadie conectado, la partida se queda como está. */
  advance(dt: number): TickResult {
    const run = this.runValue;
    if (!run || this.connectedCount === 0 || !(dt > 0) || !Number.isFinite(dt)) return { events: run ? run.takeEvents() : [], stepped: false };
    this.accumulatorS += Math.min(dt, 1);
    let steps = 0;
    while (this.accumulatorS >= FIXED_STEP_S - 1e-9) {
      this.accumulatorS -= FIXED_STEP_S;
      run.step(FIXED_STEP_S);
      steps++;
    }
    this.tickCount += steps;
    return { events: run.takeEvents(), stepped: steps > 0 };
  }

  /**
   * Estado para difundir. El sector solo viaja si cambió desde la última difusión (`full` lo fuerza:
   * al entrar o reconectar, para un único cliente, sin tocar lo ya difundido).
   */
  stateMessage(full = false): StateMessage | null {
    const run = this.runValue;
    if (!run) return null;
    const { sector, ...state } = run.snapshot();
    if (full) return { tick: this.tickCount, state, sector };
    const key = JSON.stringify(sector);
    if (key === this.sectorSent) return { tick: this.tickCount, state };
    this.sectorSent = key;
    return { tick: this.tickCount, state, sector };
  }

  // ── Presencia: poses y pings (efímeros; no entran en el motor) ──────────────────────────────

  pose(id: string, raw: unknown): void {
    const p = this.find(id);
    const pose = parsePose(raw);
    if (p && pose && p.crewId !== null && this.phaseValue === 'playing') p.pose = pose;
  }

  get poses(): PosesMessage {
    const out: PosesMessage = {};
    for (const p of this.players) if (!p.gone && p.connected && p.crewId !== null && p.pose) out[p.crewId] = p.pose;
    return out;
  }

  ping(id: string, raw: unknown, nowS: number): PingBroadcast | null {
    const p = this.find(id);
    const ping = parsePing(raw);
    if (!p || !ping || p.crewId === null || this.phaseValue !== 'playing') return null;
    if (nowS - p.lastPingS < COOP_LIMITS.pingMinIntervalS) return null;
    p.lastPingS = nowS;
    return { ...ping, crewId: p.crewId };
  }
}
