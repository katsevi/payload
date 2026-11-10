/**
 * Qué puede hacer el jugador en el puesto que tiene al lado (lógica pura; la escena solo lee
 * teclas y posición). Tecla principal E (mantener o pulsar) y secundaria Q.
 */
import { SYSTEM_IDS, THROTTLE_IDS, type Incident, type IncidentKind, type RunAction, type RunState, type SystemId, type ThrottleId } from '@payload/shared';
import type { Prompt } from '../state/ui';
import type { StationId } from './layout';

/** Segundos manteniendo E en el timón para ejecutar la maniobra evasiva. */
export const EVADE_HOLD_S = 0.7;
const INCIDENT_PRIORITY: Record<IncidentKind, number> = { fire: 0, leak: 1, short: 2 };

export type Interaction =
  | { kind: 'incident'; systemId: SystemId; incident: Incident }
  | { kind: 'repair'; systemId: SystemId; blocked: boolean }
  | { kind: 'helm'; canEvade: boolean }
  | { kind: 'map' }
  | { kind: 'power' };

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

export function interactionAt(station: StationId | null, state: RunState): Interaction | null {
  if (!station || state.phase === 'lost' || state.phase === 'won') return null;
  if (station === 'map') return { kind: 'map' };
  if (station === 'power') return { kind: 'power' };
  if (station === 'helm') return { kind: 'helm', canEvade: state.warnings.some((w) => !w.evaded) };
  if (!isSystem(station)) return null;
  const incident = incidentAt(state, station);
  if (incident) return { kind: 'incident', systemId: station, incident };
  if (state.ship.systems[station].healthPct < 100) return { kind: 'repair', systemId: station, blocked: state.ship.spares < 1 };
  return null;
}

export function nextThrottle(current: ThrottleId): ThrottleId {
  return THROTTLE_IDS[(THROTTLE_IDS.indexOf(current) + 1) % THROTTLE_IDS.length]!;
}

/** Texto de la acción (claves ui; los nombres de sistema y régimen los traduce quien pinta). */
export function promptFor(interaction: Interaction | null, state: RunState, evadeProgress = 0): Prompt | null {
  if (!interaction) return null;
  switch (interaction.kind) {
    case 'incident':
      return { key: `prompt.fix.${interaction.incident.kind}`, params: { system: interaction.systemId }, hold: true, progress: Math.min(1, interaction.incident.progress) };
    case 'repair':
      return interaction.blocked
        ? { key: 'prompt.repairNoSpares', params: { system: interaction.systemId }, hold: true, progress: 0, blocked: true }
        : { key: 'prompt.repair', params: { system: interaction.systemId, spares: state.ship.spares }, hold: true, progress: state.ship.systems[interaction.systemId].repairProgress };
    case 'helm':
      return {
        key: interaction.canEvade ? 'prompt.evade' : 'prompt.helm',
        hold: interaction.canEvade,
        progress: interaction.canEvade ? Math.min(1, evadeProgress) : 0,
        blocked: !interaction.canEvade,
        altKey: 'prompt.throttle',
        altParams: { throttle: state.ship.throttle },
      };
    case 'map':
      return { key: 'prompt.map', hold: false, progress: 0 };
    case 'power':
      return { key: 'prompt.power', hold: false, progress: 0 };
  }
}

/** Acción del motor al mantener E durante `seconds` (null = nada que mandar, p. ej. abrir un panel). */
export function holdAction(interaction: Interaction | null, seconds: number): RunAction | null {
  if (!interaction) return null;
  if (interaction.kind === 'incident') return { type: 'work-incident', incidentId: interaction.incident.id, seconds };
  if (interaction.kind === 'repair' && !interaction.blocked) return { type: 'repair-system', systemId: interaction.systemId, seconds };
  return null;
}
