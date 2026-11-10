/**
 * Informe de balance: juega N partidas con el tripulante simulado y resume cómo acaban.
 *   pnpm --filter @payload/shared balance            (200 semillas, 3 sectores)
 *   pnpm --filter @payload/shared balance 500 5
 */
import { playRun } from '../src/__tests__/bot';

const runs = Number(process.argv[2] ?? 200);
const sectors = Number(process.argv[3] ?? 3);

for (const [skill, walkS] of [['crew', 3.5], ['crew', 7], ['idle', 3.5]] as const) {
  const reasons: Record<string, number> = {};
  const cleared: number[] = Array.from({ length: sectors + 1 }, () => 0);
  let time = 0;
  let hull = 0;
  let fuel = 0;
  let incidents = 0;
  let impacts = 0;
  const started = performance.now();
  for (let seed = 1; seed <= runs; seed++) {
    const { state } = playRun(seed, { skill, sectors, walkS });
    reasons[state.lossReason ?? 'survived'] = (reasons[state.lossReason ?? 'survived'] ?? 0) + 1;
    for (let i = 0; i <= Math.min(sectors, state.stats.sectorsCleared); i++) cleared[i]!++;
    time += state.stats.timeS;
    hull += state.ship.hull;
    fuel += state.ship.fuel;
    incidents += state.stats.incidentsFixed;
    impacts += state.stats.impactsTaken;
  }
  const ms = performance.now() - started;
  console.log(`\n== ${skill} (puesto a puesto ${walkS} s) · ${runs} partidas · objetivo ${sectors} sectores ==`);
  console.log('final:', reasons);
  console.log('superan sector:', cleared.slice(1).map((n, i) => `S${i + 1} ${Math.round((n / runs) * 100)} %`).join(' · '));
  console.log(`medias: ${Math.round(time / runs)} s · casco ${Math.round(hull / runs)} · combustible ${Math.round(fuel / runs)} · averías resueltas ${(incidents / runs).toFixed(1)} · impactos ${(impacts / runs).toFixed(1)}`);
  console.log(`rendimiento: ${(ms / runs).toFixed(1)} ms por partida`);
}
