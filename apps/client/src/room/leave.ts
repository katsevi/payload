/**
 * Salir de la sala con confirmación. En el lobby se sale directamente; en cualquier otra fase de sala se abre
 * el modal propio (`LeaveRoomModal`), porque la sala se bloquea al empezar y no se puede volver a entrar.
 */
import { useRoom } from '../net/roomStore';
import { getSession } from '../net/sessionStore';
import { useUi } from '../state/ui';

export function requestLeave(): void {
  const view = useRoom.getState().view;
  if (view && view.phase !== 'lobby') useUi.getState().setConfirmLeave(true);
  else getSession().toMenu();
}
export function confirmLeave(): void {
  useUi.getState().setConfirmLeave(false);
  getSession().toMenu();
}
