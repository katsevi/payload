/**
 * Manejadores de los botones principales de la UI de sala: delgados y sin React, para probarlos con la
 * sala de pruebas. Todo pasa por la sesión activa (`getSession()`), que envía la `TeamAction`.
 */
import type { PingTarget, TeamRole } from '@payload/shared';
import { currentRoomSession } from '../net/roomSession';
import { useRoom } from '../net/roomStore';
import { getSession } from '../net/sessionStore';
import { chatDraft, noGoReasonFrom, toggleRole, type NoGoForm } from './roomUiLogic';

/** Reclamar o soltar un rol (un jugador puede llevar varios). */
export function toggleMyRole(role: TeamRole) {
  return getSession().claimRoles(toggleRole(useRoom.getState().myRoles, role));
}
export const voteGo = (role: TeamRole) => getSession().vote(role, 'go');
/** No-Go con motivo obligatorio: sin motivo válido no envía nada y devuelve null. */
export function voteNoGo(role: TeamRole, form: NoGoForm) {
  const reason = noGoReasonFrom(form);
  return reason ? getSession().vote(role, 'no-go', reason) : null;
}
export const approveRequest = (id: string, note?: string) => getSession().resolveRequest(id, true, note);
export const rejectRequest = (id: string, note?: string) => getSession().resolveRequest(id, false, note);
export const acknowledgeAlert = (alertId: string, role: TeamRole) => getSession().ackAlert(alertId, role);
/** Envía un mensaje de chat; null si está vacío. */
export function sendChat(text: string) {
  const t = chatDraft(text);
  return t ? getSession().chat(t) : null;
}
export const sendPing = (target: PingTarget) => getSession().ping(target);
/** Ping a un punto del espacio (acción libre del hangar). */
export const sendPointPing = (position: [number, number, number]) => currentRoomSession()?.send({ type: 'ping', target: { kind: 'point', position } });
