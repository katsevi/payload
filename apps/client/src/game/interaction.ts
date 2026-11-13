/**
 * Qué puede hacer el jugador en el puesto que tiene al lado (lógica pura; la escena solo lee
 * teclas y posición). Tecla principal E (mantener o pulsar) y secundaria Q.
 */
import { catalog as defaultCatalog, getSurfaceCatalog, suitRefill, SYSTEM_IDS, THROTTLE_IDS, type Catalog, type Incident, type IncidentKind, type LandingEstimate, type RunAction, type RunState, type SystemId, type TakeOffEstimate, type ThrottleId } from '@payload/shared';
import type { Prompt, PromptBadge } from '../state/ui';
import { canPlayDodge } from './dodge';
import type { StationId } from './layout';

/** Segundos manteniendo E en el timón para ejecutar la maniobra evasiva. */
export const EVADE_HOLD_S = 0.7;
/** Segundos manteniendo E para iniciar el descenso o despegar (decisiones grandes: no por accidente). */
export const LAND_HOLD_S = 0.8;
export const TAKE_OFF_HOLD_S = 0.8;
/** Por debajo de este O₂ de la nave (el nivel «bajo» del HUD) el timón lo muestra al despegar. */
export const SHIP_O2_LOW_PCT = 55;
/** Segundos manteniendo E en la esclusa para salir. */
export const AIRLOCK_HOLD_S = 0.5;
const INCIDENT_PRIORITY: Record<IncidentKind, number> = { fire: 0, leak: 1, short: 2 };

export type Interaction =
  | { kind: 'incident'; systemId: SystemId; incident: Incident }
  | { kind: 'repair'; systemId: SystemId; blocked: boolean }
  | { kind: 'helm'; canEvade: boolean; late?: boolean }
  | { kind: 'land'; worldId: string; gravity: number; fuel: number; canLand: boolean; enoughFuel: boolean; engines: boolean }
  | { kind: 'takeoff'; fuel: number; enoughFuel: boolean; heavy: boolean; canJettison: boolean; lootUnits: number }
  | { kind: 'airlock'; open: boolean; refill?: { shipO2Cost: number; suitO2Pct: number } }
  | { kind: 'map' }
  | { kind: 'power' };

/** Estimaciones del motor que necesita el timón (las da `run.estimateLanding()` / `estimateTakeOff()`). */
export interface HelmEstimates {
  landing?: LandingEstimate | null;
  takeOff?: TakeOffEstimate | null;
}

const isSystem = (id: StationId): id is SystemId => (SYSTEM_IDS as readonly string[]).includes(id);

/** La avería más urgente de un sistema (fuego > fuga > corto). */
export function incidentAt(state: RunState, systemId: SystemId): Incident | null {
  let best: Incident | null = null;
  for (const inc of state.incidents) {
    if (inc.systemId !== systemId) continue;
    if (!best || INCIDENT_PRIORITY[inc.kind] < INCIDENT_PRIORITY[best.kind]) best = inc;
  }
  return best;
}

function helmAt(state: RunState, est: HelmEstimates): Interaction {
  const warning = state.warnings.find((w) => !w.evaded);
  const canEvade = !!warning;
  // Sin tiempo para jugar la esquiva entera: tomar los mandos da una maniobra a medias (`lateDodgeResult`).
  if (warning) return canPlayDodge(warning.etaS) ? { kind: 'helm', canEvade } : { kind: 'helm', canEvade, late: true };
  if (state.phase === 'surface' && est.takeOff) {
    const t = est.takeOff;
    const lootUnits = state.surface ? state.surface.deposits.reduce((n, d) => n + Math.max(0, d.units), 0) : 0;
    return { kind: 'takeoff', fuel: t.fuel, enoughFuel: t.enoughFuel, heavy: !t.enoughFuel && t.enoughFuelEmpty, canJettison: t.loadedKg > 0, lootUnits };
  }
  const l = est.landing;
  if (state.phase === 'docked' && l && !l.alreadyLanded) {
    // El motor exige además motores en línea (`reject.enginesOffline`): sin ellos no habría freno.
    const engines = state.ship.systems.engines.online;
    return { kind: 'land', worldId: l.worldId, gravity: l.gravityMps2, fuel: l.totalFuel, canLand: l.canLand && engines, enoughFuel: l.enoughFuel, engines };
  }
  return { kind: 'helm', canEvade };
}

export function interactionAt(station: StationId | null, state: RunState, est: HelmEstimates = {}, cat: Catalog = defaultCatalog): Interaction | null {
  if (!station || state.phase === 'lost' || state.phase === 'won') return null;
  if (station === 'map') return { kind: 'map' };
  if (station === 'power') return { kind: 'power' };
  if (station === 'helm') return helmAt(state, est);
  if (station === 'airlock') {
    const aboard = state.crew.find((c) => c.alive && c.location === 'ship');
    const open = state.phase === 'surface' && !!aboard;
    if (!open || !aboard) return { kind: 'airlock', open };
    // Salir rellena el traje con O₂ de la nave: el coste lo calcula el motor (`suitRefill`).
    return { kind: 'airlock', open, refill: suitRefill(getSurfaceCatalog(cat).rules, aboard.suitO2Pct, state.ship.oxygenPct) };
  }
  if (!isSystem(station)) return null;
  const incident = incidentAt(state, station);
  if (incident) return { kind: 'incident', systemId: station, incident };
  if (state.ship.systems[station].healthPct < 100) return { kind: 'repair', systemId: station, blocked: state.ship.spares < 1 };
  return null;
}

export function nextThrottle(current: ThrottleId): ThrottleId {
  return THROTTLE_IDS[(THROTTLE_IDS.indexOf(current) + 1) % THROTTLE_IDS.length]!;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Teclas (claves ui de `keys.*`). E = usar/abrir; R = reparar con repuesto; clic (o Espacio) = la
 * habilidad de cada avería. Con «interacciones simples» las averías se arreglan manteniendo R y la
 * esquiva manteniendo E.
 */
export const KEY_USE = 'keys.interact';
export const KEY_REPAIR = 'keys.repair';
export const KEY_SKILL = 'keys.click';
export const KEY_STEER = 'keys.move';

/** Texto de la acción (claves ui; los nombres de sistema, régimen, mundo y material los traduce quien pinta). */
/** Modos simples (ajustes): esquiva sin minijuego y averías/repuestos manteniendo R. `true` = los dos. */
export type SimpleModes = boolean | { dodge: boolean; repairs: boolean };
const simpleOf = (s: SimpleModes) => (typeof s === 'boolean' ? { dodge: s, repairs: s } : s);

export function promptFor(interaction: Interaction | null, state: RunState, chargeProgress = 0, simpleModes: SimpleModes = false): Prompt | null {
  if (!interaction) return null;
  const { dodge: simpleDodge, repairs: simple } = simpleOf(simpleModes);
  const charge = Math.min(1, chargeProgress);
  switch (interaction.kind) {
    case 'incident': {
      const kind = interaction.incident.kind;
      return {
        key: `prompt.fix.${kind}`,
        params: { system: interaction.systemId },
        inputKey: simple ? KEY_REPAIR : KEY_SKILL,
        // Fuego y fuga se mantienen (rociar, cargar presión); el cortocircuito se pulsa a tiempo.
        hold: simple || kind !== 'short',
        progress: Math.min(1, interaction.incident.progress),
        progressBar: true,
      };
    }
    case 'repair':
      return interaction.blocked
        ? { key: 'prompt.repairNoSpares', params: { system: interaction.systemId }, hold: true, progress: 0, blocked: true }
        : { key: 'prompt.repair', params: { system: interaction.systemId, spares: state.ship.spares }, inputKey: KEY_REPAIR, hold: true, progress: state.ship.systems[interaction.systemId].repairProgress };
    case 'helm':
      return {
        // Con aviso de impacto: pulsar E toma los mandos (esquiva); con interacciones simples, mantener E.
        key: interaction.canEvade ? (interaction.late ? 'prompt.evadeLate' : simpleDodge ? 'prompt.evade' : 'prompt.evadeDodge') : 'prompt.helm',
        ...(interaction.late ? { warn: true } : {}),
        hold: interaction.canEvade && simpleDodge,
        progress: interaction.canEvade && simpleDodge ? charge : 0,
        blocked: !interaction.canEvade,
        altKey: 'prompt.throttle',
        altParams: { throttle: state.ship.throttle },
      };
    case 'land':
      return {
        key: interaction.canLand ? 'prompt.land' : interaction.engines ? 'prompt.landNoFuel' : 'prompt.landNoEngines',
        params: { world: interaction.worldId, gravity: round1(interaction.gravity), fuel: Math.ceil(interaction.fuel) },
        hold: true,
        progress: interaction.canLand ? charge : 0,
        blocked: !interaction.canLand,
        warn: interaction.canLand && !interaction.enoughFuel,
        altKey: 'prompt.throttle',
        altParams: { throttle: state.ship.throttle },
      };
    case 'takeoff': {
      // No se puede volver a aterrizar aquí: lo que quede en el suelo se pierde. Y el O₂ de la nave, si va bajo.
      const badges: PromptBadge[] = [];
      if (interaction.lootUnits > 0) badges.push({ key: 'prompt.lootLeft', params: { units: interaction.lootUnits } });
      if (state.ship.oxygenPct < SHIP_O2_LOW_PCT) badges.push({ key: 'prompt.shipO2', params: { pct: Math.floor(state.ship.oxygenPct) }, tone: 'warn' });
      return {
        key: interaction.enoughFuel ? 'prompt.takeOff' : interaction.heavy ? 'prompt.takeOffHeavy' : 'prompt.takeOffNoFuel',
        params: { fuel: Math.ceil(interaction.fuel) },
        hold: true,
        progress: interaction.enoughFuel ? charge : 0,
        blocked: !interaction.enoughFuel,
        ...(interaction.canJettison ? { altKey: 'prompt.jettison' } : {}),
        ...(badges.length > 0 ? { badges } : {}),
      };
    }
    case 'airlock': {
      if (!interaction.open) return { key: 'prompt.airlockSealed', hold: false, progress: 0, blocked: true };
      // Salir rellena el traje con O₂ de la nave (`suitRefill` del motor). Si no alcanza, el aviso entero
      // va en ámbar y dice con cuánto se sale.
      const r = interaction.refill;
      const partial = !!r && r.suitO2Pct < 99.5;
      const cost = r ? Math.round(r.shipO2Cost) : 0;
      const badges: PromptBadge[] = partial
        ? [{ key: 'prompt.exitShort', params: { cost, suit: Math.floor(r.suitO2Pct) }, tone: 'warn' }]
        : cost >= 1
          ? [{ key: 'prompt.exitCost', params: { cost } }]
          : [];
      return { key: 'prompt.airlockExit', hold: true, progress: charge, ...(partial ? { warn: true } : {}), ...(badges.length > 0 ? { badges } : {}) };
    }
    case 'map':
      return { key: 'prompt.map', hold: false, progress: 0 };
    case 'power':
      return { key: 'prompt.power', hold: false, progress: 0 };
  }
}

/**
 * Las acciones de «mantener» se informan con el tiempo real acumulado, troceado en partes de como mucho
 * `maxS` (el motor limita lo que aporta cada acción). Así a pocos FPS no tardan más. Devuelve cuántas
 * se enviaron; para si `send` devuelve false (rechazada).
 */
export function sendInChunks(seconds: number, maxS: number, send: (chunkS: number) => boolean): number {
  let left = seconds;
  let n = 0;
  while (left > 1e-9 && n < 100) {
    const chunk = Math.min(maxS, left);
    n++;
    if (!send(chunk)) break;
    left -= chunk;
  }
  return n;
}

/** Acción del motor al trabajar `seconds` en una avería o reparación (null = nada que mandar, p. ej. abrir un panel). */
export function holdAction(interaction: Interaction | null, seconds: number): RunAction | null {
  if (!interaction) return null;
  if (interaction.kind === 'incident') return { type: 'work-incident', incidentId: interaction.incident.id, seconds };
  if (interaction.kind === 'repair' && !interaction.blocked) return { type: 'repair-system', systemId: interaction.systemId, seconds };
  return null;
}

/**
 * Acciones de «mantener hasta llenar»: el cliente acumula `holdS` segundos con E pulsada y envía la
 * acción una vez (maniobra evasiva, iniciar el descenso, despegar, salir por la esclusa).
 */
export function chargedAction(interaction: Interaction | null, simpleModes: SimpleModes = false): { action: RunAction; holdS: number } | null {
  if (!interaction) return null;
  const simple = simpleOf(simpleModes).dodge;
  switch (interaction.kind) {
    case 'helm':
      // Sin interacciones simples la esquiva es el minijuego (`startsDodge`), no mantener E.
      return interaction.canEvade && simple ? { action: { type: 'evade' }, holdS: EVADE_HOLD_S } : null;
    case 'land':
      return interaction.canLand ? { action: { type: 'land' }, holdS: LAND_HOLD_S } : null;
    case 'takeoff':
      return interaction.enoughFuel ? { action: { type: 'take-off' }, holdS: TAKE_OFF_HOLD_S } : null;
    case 'airlock':
      return interaction.open ? { action: { type: 'eva-exit' }, holdS: AIRLOCK_HOLD_S } : null;
    default:
      return null;
  }
}

/** Pulsar E en el timón con un aviso de impacto toma los mandos para esquivar (minijuego). */
export function startsDodge(interaction: Interaction | null, simple: boolean): boolean {
  return !simple && interaction?.kind === 'helm' && interaction.canEvade;
}

/** Acción de la tecla Q en el puesto (régimen en el timón; soltar carga antes de despegar). */
export function altAction(interaction: Interaction | null, state: RunState): RunAction | null {
  if (!interaction) return null;
  if (interaction.kind === 'takeoff') return interaction.canJettison ? { type: 'jettison' } : null;
  if (interaction.kind === 'helm' || interaction.kind === 'land') return { type: 'set-throttle', throttle: nextThrottle(state.ship.throttle) };
  return null;
}

/** Roces y choques de la esquiva en curso, como datos breves del aviso. */
export function dodgeBadges(grazes: number, hits: number): PromptBadge[] {
  const out: PromptBadge[] = [];
  if (grazes > 0) out.push({ key: 'prompt.grazes', params: { n: grazes }, tone: 'warn' });
  if (hits > 0) out.push({ key: 'prompt.hits', params: { n: hits }, tone: 'warn' });
  return out;
}
