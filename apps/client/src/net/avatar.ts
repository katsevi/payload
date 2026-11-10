/**
 * Pose del avatar propio hacia la sala. Se puede llamar en CADA frame (p. ej. desde `useFrame` del
 * `PlayerController`): reutiliza un objeto, y la sesión limita a 10 Hz y solo envía si la pose cambió.
 * En solitario no hace nada. Las poses de los demás llegan en `useRoom.view.players[i].pose`.
 */
import type { AvatarPose } from '@payload/shared';
import { useSession } from './sessionStore';

const scratch: AvatarPose = { x: 0, y: 0, z: 0, yaw: 0 };

/** Publica la pose (pies en metros; `yaw` = giro Y del modelo, que mira a +Z). Devuelve true si se envió. */
export function publishAvatarPose(x: number, y: number, z: number, yaw: number): boolean {
  const room = useSession.getState().room;
  if (!room) return false;
  scratch.x = x;
  scratch.y = y;
  scratch.z = z;
  scratch.yaw = yaw;
  return room.move(scratch);
}

/** Hook para componentes 3D: devuelve la función estable `publishAvatarPose`. */
export function useAvatarPublisher(): typeof publishAvatarPose {
  return publishAvatarPose;
}
