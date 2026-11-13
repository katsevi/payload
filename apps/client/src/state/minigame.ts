/**
 * Minijuegos en curso (estado mutable, sin React ni Three.js): lo escribe `GameLoop` y lo leen el
 * holograma del timón, la llama del extintor y los indicadores de la interfaz cada frame.
 */
import type { IncidentKind } from '@payload/shared';
import type { DodgeResult, DodgeState } from '../game/dodge';
import type { PulseState, SealState } from '../game/repairGames';

export const minigame = {
  /** Esquiva en el timón (null = no se está pilotando). */
  dodge: null as DodgeState | null,
  /** Impacto que se está esquivando. */
  dodgeHazardId: -1,
  /** Resultado de la última esquiva terminada (se conectará a `evade` cuando el motor lo acepte). */
  lastDodgeResult: null as DodgeResult | null,
  /** Golpe visual del holograma (0-1, decae). */
  dodgeFlash: 0,
  /** Reparación con repuesto en curso: encajar la pieza en dos tramos (misma mecánica que sellar). */
  spare: null as SealState | null,
  spareSystem: '' as string,
  /** Reparación de avería en curso. */
  repair: {
    incidentId: -1,
    kind: null as IncidentKind | null,
    seed: 0,
    t: 0,
    pulse: null as PulseState | null,
    seal: null as SealState | null,
    /** Extintor: rociando y acertando; posición de la llama en el mundo. */
    spraying: false,
    onTarget: false,
    flame: { x: 0, y: 0, z: 0 },
  },
};

export function resetRepairGame(): void {
  const r = minigame.repair;
  r.incidentId = -1;
  r.kind = null;
  r.t = 0;
  r.pulse = null;
  r.seal = null;
  r.spraying = false;
  r.onTarget = false;
}

export function resetMinigames(): void {
  minigame.spare = null;
  minigame.spareSystem = '';
  minigame.dodge = null;
  minigame.dodgeHazardId = -1;
  minigame.dodgeFlash = 0;
  resetRepairGame();
}
