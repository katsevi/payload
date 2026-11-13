/**
 * Informe de balance: juega N partidas con el tripulante simulado y resume cómo acaban.
 * Incluye el explorador de superficie (fase 2): `crew + prudent` y `crew + greedy`, y la curva
 * «una veta más»: el mismo explorador con distintos márgenes de O₂ para volver.
 *   pnpm --filter @payload/shared balance            (200 semillas, 3 sectores)
 *   pnpm --filter @payload/shared balance 500 5
 */
import { playRun, type BotOptions, type ExploreStyle, type ShipSkill } from '../src/__tests__/bot';

const runs = Number(process.argv[2] ?? 200);
const sectors = Number(process.argv[3] ?? 3);

const profiles: [skill: 'crew' | 'idle', walkS: number, explore?: ExploreStyle, shipSkill?: ShipSkill][] = [
  ['crew', 3.5], ['crew', 7], ['idle', 3.5],
  // Minijuegos imperfectos (roces en la esquiva, ritmo de reparación): medio, modo simple y torpe en todo.
  ['crew', 3.5, undefined, 'medium'], ['crew', 3.5, undefined, 'simple'], ['crew', 5, undefined, 'clumsy'],
  ['crew', 3.5, 'prudent'], ['crew', 3.5, 'greedy'], ['crew', 3.5, 'thorough'],
];

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

interface SurfaceStats {
  evas: number;
  returned: number;
  evaS: number;
  evaSAll: number;
  evaValue: number;
  landings: number;
  hard: number;
  stored: number;
  value: number;
  crewDeaths: number;
  score: number;
  landed: number;
  landValue: number;
  takeOffs: number;
  o2AtTakeOff: number;
  surfaceS: number;
  landIncidents: number;
  idleS: number;
}

function play(options: BotOptions) {
  const reasons: Record<string, number> = {};
  const cleared: number[] = Array.from({ length: sectors + 1 }, () => 0);
  let time = 0;
  let hull = 0;
  let fuel = 0;
  let incidents = 0;
  let impacts = 0;
  let grazed = 0;
  // Fase 3: economía.
  let earned = 0;
  let spent = 0;
  let upgradesBought = 0;
  let credits = 0;
  let emergencies = 0;
  const upgradeCount: Record<string, number> = {};
  const sets = new Set<string>();
  const surf: SurfaceStats = { evas: 0, returned: 0, evaS: 0, evaSAll: 0, evaValue: 0, landings: 0, hard: 0, stored: 0, value: 0, crewDeaths: 0, score: 0, landed: 0, landValue: 0, takeOffs: 0, o2AtTakeOff: 0, surfaceS: 0, landIncidents: 0, idleS: 0 };
  const started = performance.now();
  for (let seed = 1; seed <= runs; seed++) {
    const { state, evas, landings, events } = playRun(seed, { ...options, sectors });
    for (const l of landings) {
      surf.landed++;
      surf.landValue += l.value;
      surf.landIncidents += l.incidents;
      if (l.shipO2AtTakeOffPct === null) continue;
      surf.takeOffs++;
      surf.o2AtTakeOff += l.shipO2AtTakeOffPct;
      surf.surfaceS += l.surfaceS ?? 0;
    }
    surf.landings += state.stats.landings;
    surf.hard += state.stats.hardLandings;
    surf.stored += state.stats.materialsStored;
    surf.value += state.stats.materialsValue;
    surf.score += state.score;
    if (state.lossReason === 'crew') surf.crewDeaths++;
    for (const e of evas) {
      surf.evas++;
      surf.evaSAll += e.durationS;
      surf.evaValue += e.value;
      surf.idleS += e.idleS;
      if (e.returned) {
        surf.returned++;
        surf.evaS += e.durationS;
      }
    }
    reasons[state.lossReason ?? (state.stats.sectorsCleared >= sectors ? 'survived' : 'timeout')] =
      (reasons[state.lossReason ?? (state.stats.sectorsCleared >= sectors ? 'survived' : 'timeout')] ?? 0) + 1;
    for (let i = 0; i <= Math.min(sectors, state.stats.sectorsCleared); i++) cleared[i]!++;
    time += state.stats.timeS;
    hull += state.ship.hull;
    fuel += state.ship.fuel;
    incidents += state.stats.incidentsFixed;
    impacts += state.stats.impactsTaken;
    grazed += state.stats.impactsGrazed ?? 0;
    earned += state.stats.creditsEarned ?? 0;
    spent += state.stats.creditsSpent ?? 0;
    upgradesBought += state.stats.upgradesBought ?? 0;
    credits += state.credits;
    for (const [id, lvl] of Object.entries(state.upgrades)) upgradeCount[id] = (upgradeCount[id] ?? 0) + lvl;
    sets.add(Object.entries(state.upgrades).sort().map(([id, l]) => `${id}${l}`).join(','));
    emergencies += events.filter((e) => e.type === 'service').length;
  }
  const eco = { earned, spent, upgradesBought, credits, emergencies, upgradeCount, distinctSets: sets.size };
  return { reasons, cleared, time, hull, fuel, incidents, impacts, grazed, surf, eco, ms: performance.now() - started };
}

for (const [skill, walkS, explore, shipSkill] of profiles) {
  const r = play({ skill, walkS, explore, shipSkill });
  console.log(`\n== ${skill}${explore ? ` + ${explore}` : ''}${shipSkill ? ` · minijuegos ${shipSkill}` : ''} (puesto a puesto ${walkS} s) · ${runs} partidas · objetivo ${sectors} sectores ==`);
  console.log('final:', r.reasons);
  console.log('superan sector:', r.cleared.slice(1).map((n, i) => `S${i + 1} ${Math.round((n / runs) * 100)} %`).join(' · '));
  console.log(
    `medias: ${Math.round(r.time / runs)} s · casco ${Math.round(r.hull / runs)} · combustible ${Math.round(r.fuel / runs)} · ` +
      `averías resueltas ${(r.incidents / runs).toFixed(1)} · impactos ${(r.impacts / runs).toFixed(1)}${shipSkill ? ` · roces ${(r.grazed / runs).toFixed(1)}` : ''} · puntuación ${Math.round(r.surf.score / runs)}`,
  );
  const e = r.eco;
  const top = Object.entries(e.upgradeCount).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, n]) => `${id} ${(n / runs).toFixed(2)}`).join(', ');
  console.log(
    `economía: ganados ${Math.round(e.earned / runs)} · gastados ${Math.round(e.spent / runs)} · al final ${Math.round(e.credits / runs)} créditos · ` +
      `${(e.upgradesBought / runs).toFixed(1)} mejoras por partida (${e.distinctSets} combinaciones distintas${top ? `; ${top}` : ''}) · ayudas de emergencia ${(e.emergencies / runs).toFixed(1)}`,
  );
  const s = r.surf;
  if (explore) {
    console.log(
      `superficie: ${(s.landings / runs).toFixed(1)} aterrizajes (${pct(s.hard, s.landings)} % bruscos) · ${(s.evas / runs).toFixed(1)} salidas · ` +
        `vuelven ${pct(s.returned, s.evas)} % · salida media ${Math.round(s.evaSAll / Math.max(1, s.evas))} s (solo las que vuelven ${Math.round(s.evaS / Math.max(1, s.returned))} s; ` +
        `quieto ${Math.round(s.idleS / Math.max(1, s.evas))} s, ${pct(s.idleS, s.evaSAll)} %) · ` +
        `${(s.stored / runs).toFixed(1)} materiales (${Math.round(s.value / runs)} puntos, ${Math.round(s.evaValue / Math.max(1, s.evas))} por salida) · muertes en superficie ${pct(s.crewDeaths, runs)} %`,
    );
    console.log(landingLine(s));
  }
  console.log(`rendimiento: ${(r.ms / runs).toFixed(1)} ms por partida`);
}

function landingLine(s: SurfaceStats): string {
  const per = (n: number, d: number, k = 0) => (d > 0 ? (n / d).toFixed(k) : '-');
  return (
    `por aterrizaje: ${per(s.landValue, s.landed)} puntos · ${per(s.evas, s.landed, 1)} salidas · ${per(s.surfaceS, s.takeOffs)} s en tierra · ` +
    `O₂ de la nave al despegar ${per(s.o2AtTakeOff, s.takeOffs)} % · averías en tierra ${per(s.landIncidents, s.landed, 2)}`
  );
}

// «Una veta más»: el explorador prudente con un margen fijo de O₂ para volver.
console.log(`\n== margen de O₂ para volver → valor y riesgo (crew + prudent sin política de la fase 3, ${runs} partidas, ${sectors} sectores) ==`);
console.log('margen | valor/salida | vuelven | muertes/partida | puntos de materiales | puntuación | valor/aterrizaje | O₂ al despegar');
for (const margin of [25, 15, 8, 3]) {
  const r = play({ skill: 'crew', walkS: 3.5, explore: 'prudent', returnMarginPct: margin, economyPolicy: false });
  const s = r.surf;
  console.log(
    `${String(margin).padStart(4)} % | ${String(Math.round(s.evaValue / Math.max(1, s.evas))).padStart(12)} | ${String(pct(s.returned, s.evas)).padStart(5)} % | ` +
      `${String(pct(s.crewDeaths, runs)).padStart(13)} % | ${String(Math.round(s.value / runs)).padStart(20)} | ${String(Math.round(s.score / runs)).padStart(10)} | ` +
      `${String(Math.round(s.landValue / Math.max(1, s.landed))).padStart(16)} | ${Math.round(s.o2AtTakeOff / Math.max(1, s.takeOffs))} %`,
  );
}
