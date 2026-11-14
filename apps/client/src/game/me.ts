/**
 * Quién soy en la partida. En solitario hay un solo tripulante; en cooperativo (fase 4) el servidor da a
 * cada jugador un `crewId` y todo lo «mío» (traje, mochila, escena) se lee de ese tripulante.
 */
import type { CrewMember, RunState } from '@payload/shared';

let localCrewId: number | null = null;

/** Lo fija la sesión de sala al empezar la partida (null = solitario). */
export function setLocalCrewId(id: number | null): void {
  localCrewId = id;
}

export const getLocalCrewId = (): number | null => localCrewId;

/** Mi tripulante: el de mi `crewId` en sala; en solitario, el primero vivo (o el único). */
export function myCrew(state: Pick<RunState, 'crew'> | null | undefined): CrewMember | undefined {
  if (!state) return undefined;
  if (localCrewId !== null) return state.crew.find((c) => c.id === localCrewId);
  return state.crew.find((c) => c.alive) ?? state.crew[0];
}
