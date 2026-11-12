import { Vector3 } from 'three';

/** Estado mutable del jugador compartido entre el controlador y las interacciones (sin re-renders). */
export const playerState = {
  /** Posición de los pies. */
  pos: new Vector3(0, 0, 9),
  yaw: 0,
  pitch: 0,
  moving: false,
  // ── Superficie (los escribe `PlayerController`; los consume el bucle de la escena de superficie) ──
  grounded: true,
  /** Velocidad vertical (m/s; + hacia arriba). */
  vy: 0,
  /** El jetpack empuja en este frame. */
  thrusting: false,
  /** Segundos de empuje aún no informados al motor (`jetpack {seconds}`). */
  thrustS: 0,
  /** Velocidad del último golpe contra el suelo aún no informada (`fall-impact`); 0 = ninguno. */
  impactMps: 0,
};

/** Entorno del movimiento en la superficie (lo actualiza la escena cada frame). */
export const motionEnv = {
  /** Queda jetpack (según el motor). */
  canThrust: true,
  /** Empuje lateral de la tormenta (m/s). */
  windX: 0,
  windZ: 0,
};

/** Vuelve a dejar el estado del jugador como al empezar (al cambiar de escena o de partida). */
export function resetPlayerState(): void {
  playerState.moving = false;
  playerState.grounded = true;
  playerState.vy = 0;
  playerState.thrusting = false;
  playerState.thrustS = 0;
  playerState.impactMps = 0;
  motionEnv.canThrust = true;
  motionEnv.windX = 0;
  motionEnv.windZ = 0;
}

/** Dirección de mirada a partir de yaw/pitch. */
export function lookDir(out = new Vector3()): Vector3 {
  const cp = Math.cos(playerState.pitch);
  return out.set(-Math.sin(playerState.yaw) * cp, Math.sin(playerState.pitch), -Math.cos(playerState.yaw) * cp);
}
