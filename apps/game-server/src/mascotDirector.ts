/**
 * Mascota ÚNICA por sala (fase 3). El servidor decide qué dice y lo publica en `view.mascot`
 * (`{ trigger, variant, seq, atS }`); cada cliente muestra `pickMascotDialogue(trigger, catalog.mascot, variant)`.
 * Puro y determinista: sin reloj (el tiempo `nowS` lo pasa la sala) ni azar.
 *
 * Reglas:
 *  - Solo se ofrecen disparadores que tienen diálogo en `catalog.mascot` (si el contenido aún no escribió
 *    un diálogo, la mascota no "habla en vacío" ni tapa un mensaje útil). Sin mascota en el catálogo, calla.
 *  - Cola con prioridad: en cada `flush` se publica UNO, el de mayor prioridad (a igualdad, el más
 *    antiguo). Entre dos publicaciones pasan al menos `MASCOT_MIN_GAP_S` salvo que llegue algo más
 *    prioritario que lo que se está mostrando (lo urgente interrumpe). La sala llama a `flush` tras cada
 *    acción y en cada tick (10 Hz), así la cola se vacía sola.
 *  - Prioridad (`mascotPriority`): falla de lanzamiento / batería agotada / falla de componente /
 *    sobrecalentamiento (100) > fin de misión (96) > informe (95) > tormenta, rueda, basura (90) >
 *    `team:alert` (85) > `team:alert-timeout` (80) > retraso/recorte pre-lanzamiento, `review:no-go`,
 *    `team:vote-no-go` (75) > `review:go`, `team:request-open` (70) > resto de `team:*` de coordinación (65)
 *    > otros eventos del motor (60) > entradas/salidas, reparto, lobby (50) > `phase:*` (40) > `role:*` (35)
 *    > `team:chat`, `team:ping` (20).
 *  - Moderación: `phase:*` una vez por fase y por intento; eventos frecuentes (`eclipse-*`, `contact-*`)
 *    solo la primera vez de cada intento; `battery-low`/`storage-full` como mucho uno cada 60 s;
 *    `team:chat`/`team:ping` como mucho uno cada `MASCOT_CHATTER_MIN_S`. Un disparador ya en cola no se repite.
 *  - Caducidad: lo pendiente caduca a los `MASCOT_PENDING_TTL_S`; lo ligado a una fase (`phase:*`, `role:*`,
 *    votación, solicitudes, reparto, alertas) se descarta al cambiar de fase. Los eventos y el desenlace no.
 *  - `variant` = contador por disparador (0, 1, 2…) para rotar diálogos; `seq` crece siempre.
 */
import { EVENT_RESPONSE_ROLES, type Catalog, type MascotCue, type RoomPhase, type SimEventType } from '@payload/shared';

export const MASCOT_MIN_GAP_S = 6;
export const MASCOT_PENDING_TTL_S = 40;
export const MASCOT_QUEUE_MAX = 8;
/** `team:chat` y `team:ping`: la mascota no comenta cada mensaje del equipo. */
export const MASCOT_CHATTER_MIN_S = 120;
/** Eventos repetibles pero no rutinarios (batería baja, almacenamiento lleno). */
export const MASCOT_REPEAT_EVENT_MIN_S = 60;

const URGENT_EVENTS: ReadonlySet<string> = new Set(['launch-failure', 'battery-depleted', 'component-failure', 'overheating']);
const PRELAUNCH_EVENTS: ReadonlySet<string> = new Set(['launch-delay', 'budget-cut']);
/** Eventos de cada órbita: solo la primera vez de cada intento. */
export const FREQUENT_EVENTS: ReadonlySet<string> = new Set(['eclipse-enter', 'eclipse-exit', 'contact-start', 'contact-end']);
const REPEAT_EVENTS: ReadonlySet<string> = new Set(['battery-low', 'storage-full']);

const TEAM_PRIORITY: Record<string, number> = {
  alert: 85,
  'alert-timeout': 80,
  'vote-no-go': 75,
  'request-open': 70,
  'vote-go': 65,
  'vote-open': 65,
  'request-approved': 65,
  'request-rejected': 65,
  'alert-answered': 65,
  'host-changed': 65,
  'roles-combined': 65,
  'player-left': 50,
  'player-back': 50,
  'player-joined': 50,
  allocation: 50,
  lobby: 50,
  ping: 20,
  chat: 20,
};

/** Disparadores `team:*` que dejan de tener sentido al cambiar de fase. */
const PHASE_BOUND_TEAM: ReadonlySet<string> = new Set([
  'vote-open', 'request-open', 'request-approved', 'request-rejected', 'allocation',
  'alert', 'alert-timeout', 'alert-answered', 'lobby',
]);

function split(trigger: string): [string, string] {
  const i = trigger.indexOf(':');
  return i < 0 ? [trigger, ''] : [trigger.slice(0, i), trigger.slice(i + 1)];
}

/** Prioridad de un disparador (mayor = más urgente). Ver la cabecera del módulo. */
export function mascotPriority(trigger: string): number {
  const [kind, value] = split(trigger);
  switch (kind) {
    case 'event':
      if (URGENT_EVENTS.has(value)) return 100;
      if (value === 'mission-complete') return 96;
      if (EVENT_RESPONSE_ROLES[value as SimEventType]) return 90;
      if (PRELAUNCH_EVENTS.has(value)) return 75;
      return 60;
    case 'report':
      return 95;
    case 'review':
      return value === 'no-go' ? 75 : 70;
    case 'team':
      return TEAM_PRIORITY[value] ?? 50;
    case 'phase':
      return 40;
    case 'role':
      return 35;
    default:
      return 30;
  }
}

/** ¿Se descarta el disparador pendiente si la sala cambia de fase? */
export function isPhaseBound(trigger: string): boolean {
  const [kind, value] = split(trigger);
  return kind === 'phase' || kind === 'role' || (kind === 'team' && PHASE_BOUND_TEAM.has(value));
}

interface Pending {
  trigger: string;
  priority: number;
  atS: number;
  phase: RoomPhase;
  order: number;
}

export interface MascotOfferOptions {
  /** Solo una vez por intento (se rearma con `resetAttempt`). */
  oncePerAttempt?: boolean;
  /** Intervalo mínimo (s) entre dos ofertas aceptadas del mismo disparador. */
  minIntervalS?: number;
}

/** Comprueba si el catálogo tiene diálogo para un disparador. */
export function catalogHasDialogue(cat: Catalog): (trigger: string) => boolean {
  const triggers = new Set((cat.mascot?.dialogues ?? []).map((d) => d.trigger));
  return (trigger) => triggers.has(trigger);
}

export class MascotDirector {
  private pending: Pending[] = [];
  private readonly variants = new Map<string, number>();
  private readonly lastOfferAt = new Map<string, number>();
  private once = new Set<string>();
  private seq = 0;
  private order = 0;
  private shown: { priority: number; atS: number } | null = null;

  constructor(private readonly hasDialogue: (trigger: string) => boolean) {}

  /** Propone un disparador (lo publicará `flush` si le toca). `phase` = fase de la sala a la que pertenece. */
  offer(trigger: string, nowS: number, phase: RoomPhase, opts: MascotOfferOptions = {}): void {
    if (!this.hasDialogue(trigger)) return;
    if (opts.oncePerAttempt) {
      if (this.once.has(trigger)) return;
      this.once.add(trigger);
    }
    if (opts.minIntervalS !== undefined) {
      const last = this.lastOfferAt.get(trigger);
      if (last !== undefined && nowS - last < opts.minIntervalS) return;
      this.lastOfferAt.set(trigger, nowS);
    }
    if (this.pending.some((p) => p.trigger === trigger)) return;
    this.pending.push({ trigger, priority: mascotPriority(trigger), atS: nowS, phase, order: this.order++ });
    if (this.pending.length > MASCOT_QUEUE_MAX) {
      // Se descarta el menos prioritario (a igualdad, el más reciente).
      const worst = [...this.pending].sort((a, b) => a.priority - b.priority || b.order - a.order)[0]!;
      this.pending = this.pending.filter((p) => p !== worst);
    }
  }

  /** Disparador de un evento del motor con la moderación de la cabecera. */
  offerEvent(type: SimEventType, nowS: number, phase: RoomPhase): void {
    const trigger = `event:${type}`;
    if (FREQUENT_EVENTS.has(type)) this.offer(trigger, nowS, phase, { oncePerAttempt: true });
    else if (REPEAT_EVENTS.has(type)) this.offer(trigger, nowS, phase, { minIntervalS: MASCOT_REPEAT_EVENT_MIN_S });
    else this.offer(trigger, nowS, phase);
  }

  /** Nuevo intento (redesign): se rearman los "una vez por intento" y se vacía la cola. */
  resetAttempt(): void {
    this.once = new Set();
    this.pending = [];
  }

  /** Publica como mucho un disparador; devuelve la nueva `MascotCue` o null si no toca. */
  flush(nowS: number, phase: RoomPhase): MascotCue | null {
    this.pending = this.pending.filter(
      (p) => nowS - p.atS <= MASCOT_PENDING_TTL_S && !(p.phase !== phase && isPhaseBound(p.trigger)),
    );
    if (this.pending.length === 0) return null;
    const best = this.pending.reduce((a, b) => (b.priority > a.priority || (b.priority === a.priority && b.order < a.order) ? b : a));
    const free = this.shown === null || nowS - this.shown.atS >= MASCOT_MIN_GAP_S || best.priority > this.shown.priority;
    if (!free) return null;
    this.pending = this.pending.filter((p) => p !== best);
    const variant = this.variants.get(best.trigger) ?? 0;
    this.variants.set(best.trigger, variant + 1);
    this.seq += 1;
    this.shown = { priority: best.priority, atS: nowS };
    return { trigger: best.trigger, variant, seq: this.seq, atS: nowS };
  }

  /** Disparadores en cola (para tests y depuración). */
  get queued(): string[] {
    return [...this.pending].sort((a, b) => b.priority - a.priority || a.order - b.order).map((p) => p.trigger);
  }
}
