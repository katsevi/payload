/**
 * Medida de rendimiento del motor, fuera de `pnpm test` para que la carga de la máquina no
 * vuelva inestables los tests. Uso: pnpm --filter @payload/shared bench
 * Objetivos: computeBudgets < 1 ms por llamada (hangar) y 30 días de misión < 200 ms (mediana).
 * Sale con código 1 si no se cumplen.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalog, computeBudgets, reviewGoNoGo, runMission, type MissionDesign } from '../src/index.ts';

const design = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', '..', 'prototype', 'designs', 'ok-microsat-sso-hires.json'), 'utf8'),
) as MissionDesign;

function median(fn: () => void, runs: number): number {
  fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}

const results = [
  { name: 'computeBudgets', ms: median(() => computeBudgets(design), 2000), targetMs: 1 },
  { name: 'reviewGoNoGo', ms: median(() => reviewGoNoGo(design), 2000), targetMs: 1 },
  { name: 'runMission (30 días)', ms: median(() => runMission(design, catalog, { seed: 2 }), 15), targetMs: 200 },
];
let ok = true;
for (const r of results) {
  const pass = r.ms < r.targetMs;
  ok &&= pass;
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${r.name.padEnd(22)} mediana ${r.ms.toFixed(3)} ms (objetivo < ${r.targetMs} ms)`);
}
process.exit(ok ? 0 : 1);
