/**
 * Estado de la sala cooperativa para la interfaz (fase 6). Lo escribe `coopSession`; React lo lee con
 * `useCoop`. Las poses y los pings de los compañeros se leen por frame desde `coopLive` (sin re-render).
 */
import { create } from 'zustand';
import type { CrewPose, JoinErrorCode, LobbyView, PingBroadcast } from '@payload/shared';

export type CoopStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';
/** Motivo por el que no se pudo entrar o se salió de la sala (clave `coop.error.*`). */
export type CoopError = JoinErrorCode | 'not-found' | 'unreachable' | 'lost';

interface CoopState {
  status: CoopStatus;
  /** Vista del lobby (jugadores, roles, fase); null fuera de una sala. */
  lobby: LobbyView | null;
  /** Mi id de sesión en la sala. */
  myId: string | null;
  error: CoopError | null;
}

export const INITIAL_COOP: CoopState = { status: 'idle', lobby: null, myId: null, error: null };

export const useCoop = create<CoopState>(() => ({ ...INITIAL_COOP }));

export interface LivePing extends PingBroadcast {
  /** `performance.now()` al recibirlo. */
  atMs: number;
}

/** Lo que cambia varias veces por segundo: se lee desde `useFrame`, nunca desde el render. */
export const coopLive: { poses: Record<number, CrewPose>; pings: LivePing[] } = { poses: {}, pings: [] };

/** Mi jugador en el lobby. */
export function mePlayer(s: Pick<CoopState, 'lobby' | 'myId'>) {
  return s.lobby?.players.find((p) => p.id === s.myId) ?? null;
}
