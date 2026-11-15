/**
 * Escalones de resolución interna de las escenas de juego (PURO, sin three ni React; lo usa `quality.tsx`).
 * Es lo que más pesa en una GPU modesta a pantalla completa: el relleno de los shaders del suelo y del interior.
 */

/** Resolución máxima de las escenas de juego (pantallas HiDPI). */
export const MAX_DPR = 1.75;

/** Densidades por nivel, de mejor a más barata. R3F nunca pasa de la de la pantalla. */
export const DPR_LEVELS: readonly number[] = [MAX_DPR, 1.25, 1];

/** Nivel siguiente al bajar (se queda en el último). */
export function nextDprLevel(level: number): number {
  return Math.min(DPR_LEVELS.length - 1, Math.max(0, level) + 1);
}

/**
 * Umbrales de FPS (bajo, alto) del monitor. Los de drei por defecto ([40, 60] a 60 Hz) dejaban la escena a 40-55 FPS
 * con tirones sin bajar nunca la resolución (medido en el descenso con una Iris Xe a 1080p HiDPI: ~43 FPS a 1,5 de
 * densidad y ~57 a 1). Se baja por debajo de 50 (o del 70 % en pantallas rápidas).
 */
export function dprBounds(refreshRate: number): [number, number] {
  return refreshRate > 100 ? [Math.round(refreshRate * 0.7), Math.round(refreshRate * 0.95)] : [50, 59];
}
