/**
 * Pilotos simulados para la esquiva (solo tests y calibración): «bueno» replanifica cada paso y ve venir
 * las rocas con tiempo; «medio» reacciona cada 0,2 s, ve menos y se mueve algo más lento; «torpe» reacciona
 * cada 0,45 s y apenas anticipa. Deterministas (semilla de la partida).
 */
import { rng } from '../game/noise';
import { SHIP_RADIUS, stepDodge, type DodgeState } from '../game/dodge';

export interface PilotSkill {
  thinkS: number;
  lookaheadS: number;
  speed: number;
  noise: number;
}

export const PILOTS: Record<'good' | 'medium' | 'bad', PilotSkill> = {
  good: { thinkS: 0, lookaheadS: 0.9, speed: 1, noise: 0 },
  medium: { thinkS: 0.25, lookaheadS: 0.5, speed: 0.8, noise: 0.15 },
  bad: { thinkS: 0.45, lookaheadS: 0.4, speed: 0.65, noise: 0.25 },
};

export function fly(s: DodgeState, skill: PilotSkill): void {
  const dt = 1 / 60;
  const r = rng(s.seed ^ 0x51ed);
  let tx = s.x;
  let ty = s.y;
  let since = Infinity;
  while (!s.done) {
    since += dt;
    if (since >= skill.thinkS) {
      since = 0;
      let best = { x: s.x, y: s.y, score: -Infinity };
      for (let gx = -0.9; gx <= 0.91; gx += 0.15) {
        for (let gy = -0.5; gy <= 0.51; gy += 0.125) {
          let score = -Math.hypot(gx - s.x, gy - s.y) * 0.25;
          for (const rock of s.rocks) {
            const arrive = rock.spawnS + s.travelS - s.t;
            if (arrive < 0 || arrive > skill.lookaheadS) continue;
            const clear = Math.hypot(rock.x - gx, rock.y - gy) - rock.r - SHIP_RADIUS;
            const reach = Math.hypot(gx - s.x, gy - s.y) / (1.5 * skill.speed);
            if (clear < 0.05) score -= (reach > arrive ? 1 : 3) * (1 - clear);
          }
          if (score > best.score) best = { x: gx, y: gy, score };
        }
      }
      tx = best.x + (r() - 0.5) * 2 * skill.noise;
      ty = best.y + (r() - 0.5) * 2 * skill.noise;
    }
    const dx = tx - s.x;
    const dy = ty - s.y;
    const len = Math.hypot(dx, dy);
    const k = (len > 0.04 ? 1 / len : len > 0 ? 1 / 0.04 : 0) * skill.speed;
    stepDodge(s, dx * k, dy * k, dt);
  }
}
