/**
 * Registro de la sesión activa. Siempre hay una `LocalSession` (App la enlaza con la máquina XState);
 * mientras hay sala, la activa es la `RoomSession`. Fuera de React usa `getSession()`; en componentes,
 * `useMissionSession()` (re-renderiza al entrar o salir de una sala).
 */
import { create } from 'zustand';
import { LocalSession } from './localSession';
import type { RoomSession } from './roomSession';
import type { MissionSession } from './session';

interface SessionRegistry {
  local: LocalSession;
  room: RoomSession | null;
}

export const useSession = create<SessionRegistry>(() => ({ local: new LocalSession(), room: null }));

/** Sesión activa: la sala si la hay; si no, la de solitario. */
export function getSession(): MissionSession {
  const s = useSession.getState();
  return s.room ?? s.local;
}

/** La sesión de solitario (siempre existe): menú, Academia y vuelta al menú al salir de una sala. */
export function getLocalSession(): LocalSession {
  return useSession.getState().local;
}

export function useMissionSession(): MissionSession {
  return useSession((s) => s.room ?? s.local);
}
