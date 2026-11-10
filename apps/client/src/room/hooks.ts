/** Hooks de la UI de sala (React): veredicto estable de acciones, reloj de sala, registro de pings. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { useTranslation } from 'react-i18next';
import type { PingTarget, TeamAction, TeamActionCheck, TeamRole } from '@payload/shared';
import { canDoIn, selectInRoom, useRoom, type PingMark } from '../net/roomStore';
import { REQUEST_COOLDOWN_MS, playerLabel, roomNowS } from './roomUiLogic';

/**
 * Como `useCanDo`, pero NO se recalcula con cada cambio de la vista (a ~10 Hz llegan poses de avatares y
 * `sim`): solo cuando cambian fase, diseño, reparto, solicitudes, votos, alertas, roles o conexión.
 * Fuera de una sala devuelve null (sin restricciones).
 */
export function useStableCanDo(action: TeamAction | null): TeamActionCheck | null {
  const inRoom = useRoom(selectInRoom);
  const phase = useRoom((s) => s.view?.phase);
  const design = useRoom((s) => s.view?.design);
  const allocation = useRoom((s) => s.view?.allocation);
  const requests = useRoom((s) => s.view?.requests);
  const votes = useRoom((s) => s.view?.votes);
  const alerts = useRoom((s) => s.view?.alerts);
  const playersKey = useRoom((s) => (s.view ? s.view.players.map((p) => `${p.id}:${p.roles.join('+')}:${p.connected ? 1 : 0}`).join('|') : ''));
  const myId = useRoom((s) => s.myId);
  const myRoles = useRoom((s) => s.myRoles);
  const isHost = useRoom((s) => s.isHost);
  return useMemo(
    () => {
      if (!action || !inRoom) return null;
      const st = useRoom.getState();
      return canDoIn({ view: st.view, myId, myRoles, isHost }, action);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action, inRoom, phase, design, allocation, requests, votes, alerts, playersKey, myId, myRoles, isHost],
  );
}

/** Veredicto de montar cada pieza (para los estantes del hangar). */
export function useAddChecks(ids: readonly string[]): Record<string, TeamActionCheck> {
  const inRoom = useRoom(selectInRoom);
  const phase = useRoom((s) => s.view?.phase);
  const design = useRoom((s) => s.view?.design);
  const allocation = useRoom((s) => s.view?.allocation);
  // Las solicitudes (`requestPending`, `tooManyRequests`) y quién soy también cambian el veredicto.
  const requests = useRoom((s) => s.view?.requests);
  const myId = useRoom((s) => s.myId);
  const myRoles = useRoom((s) => s.myRoles);
  const isHost = useRoom((s) => s.isHost);
  return useMemo(() => {
    const out: Record<string, TeamActionCheck> = {};
    if (!inRoom) return out;
    const st = useRoom.getState();
    for (const id of ids) out[id] = canDoIn(st, { type: 'add-component', componentId: id });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, inRoom, phase, design, allocation, requests, myId, myRoles, isHost]);
}

/**
 * Segundo de sala estimado: el mayor `atS` visible, avanzando con el reloj local mientras `active`.
 * Es una aproximación (el servidor no publica su reloj): sirve para "hace 12 s" y las cuentas atrás.
 */
export function useRoomClock(active = true): number {
  const base = useRoom((s) => (s.view ? roomNowS(s.view) : 0));
  const anchor = useRef({ s: base, at: typeof performance !== 'undefined' ? performance.now() : 0 });
  if (base > anchor.current.s) anchor.current = { s: base, at: performance.now() };
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return anchor.current.s + (performance.now() - anchor.current.at) / 1000;
}

// ─── Registro de pings recientes (lista 2D) ─────────────────────────────────

export interface PingLogEntry {
  id: number;
  playerId: string;
  role: TeamRole | null;
  target: PingTarget;
  receivedAtMs: number;
}
const LOG_MAX = 8;
export const usePingLog = create<{ entries: PingLogEntry[]; add: (p: PingMark) => void; clear: () => void }>((set) => ({
  entries: [],
  add: (p) =>
    set((s) =>
      s.entries.some((e) => e.id === p.id)
        ? s
        : { entries: [{ id: p.id, playerId: p.playerId, role: p.role, target: p.target, receivedAtMs: p.receivedAtMs }, ...s.entries].slice(0, LOG_MAX) },
    ),
  clear: () => set({ entries: [] }),
}));

/** Copia los pings recibidos al registro (se monta una vez en la barra de equipo). */
export function usePingLogger(): void {
  useEffect(() => {
    const feed = (pings: readonly PingMark[]) => pings.forEach((p) => usePingLog.getState().add(p));
    feed(useRoom.getState().pings);
    const unsub = useRoom.subscribe((s, prev) => {
      if (s.pings !== prev.pings) feed(s.pings);
    });
    return () => {
      unsub();
      usePingLog.getState().clear();
    };
  }, []);
}

/**
 * Nombre de cada jugador por id. Solo cambia cuando cambian ids o nombres (NO con las poses, que llegan
 * a ~10 Hz): los paneles que muestran quién hizo algo no se repintan al moverse los avatares.
 */
export function usePlayerLabels(): (id: string) => string {
  const { t } = useTranslation();
  const key = useRoom((s) => (s.view ? s.view.players.map((p) => `${p.id}\u0000${p.name}`).join('\u0001') : ''));
  return useMemo(() => {
    const players = useRoom.getState().view?.players ?? [];
    const map = new Map(players.map((p, i) => [p.id, playerLabel(p, i, (n) => t('room.playerN', { n }))] as const));
    return (id: string) => map.get(id) ?? t('room.unknownPlayer');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, t]);
}

/** true durante `REQUEST_COOLDOWN_MS` tras crear yo una solicitud (`request-created`): evita chocar con el límite de ráfaga. */
export function useRequestCooldown(): boolean {
  const id = useRoom((s) => s.lastRequestId);
  const [active, setActive] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!id) return;
    setActive(true);
    const timer = window.setTimeout(() => setActive(false), REQUEST_COOLDOWN_MS);
    return () => window.clearTimeout(timer);
  }, [id]);
  return active;
}
