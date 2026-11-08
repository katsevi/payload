import { Vector3 } from 'three';

/** Estado mutable del jugador compartido entre el controlador y las interacciones (sin re-renders). */
export const playerState = {
  /** Posición de los pies. */
  pos: new Vector3(0, 0, 9),
  yaw: 0,
  pitch: 0,
  moving: false,
};

/** Dirección de mirada a partir de yaw/pitch. */
export function lookDir(out = new Vector3()): Vector3 {
  const cp = Math.cos(playerState.pitch);
  return out.set(-Math.sin(playerState.yaw) * cp, Math.sin(playerState.pitch), -Math.cos(playerState.yaw) * cp);
}
