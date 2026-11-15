/**
 * Informe de balance: juega N partidas con el tripulante simulado y resume cómo acaban.
 * Incluye el explorador de superficie (fase 2): `crew + prudent` y `crew + greedy`, y la curva
 * «una veta más»: el mismo explorador con distintos márgenes de O₂ para volver.
 *   pnpm --filter @payload/shared balance            (200 semillas, 3 sectores)
 *   pnpm --filter @payload/shared balance 500 5
 */
import { playRun, type BotOptions, type ExploreStyle, type ShipSkill } from '../src/__tests__/bot';
import { loadMissionFixture } from '../src/__tests__/missionFixtures';
import { psychCatalog } from '../src/__tests__/psychHelpers';
import { getMissions, routeZones } from '../src/index';

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
  const goal = options.sectors ?? sectors;
  const cleared: number[] = Array.from({ length: goal + 1 }, () => 0);
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
  let overloads = 0;
  let targets = 0;
  // Fase 5: misiones cumplidas, terminadas sin el objetivo y ciencia entregada.
  let missionsOk = 0;
  let missionsPartial = 0;
  let science = 0;
  const upgradeCount: Record<string, number> = {};
  const sets = new Set<string>();
  const surf: SurfaceStats = { evas: 0, returned: 0, evaS: 0, evaSAll: 0, evaValue: 0, landings: 0, hard: 0, stored: 0, value: 0, crewDeaths: 0, score: 0, landed: 0, landValue: 0, takeOffs: 0, o2AtTakeOff: 0, surfaceS: 0, landIncidents: 0, idleS: 0 };
  const started = performance.now();
  for (let seed = 1; seed <= runs; seed++) {
    const { state, evas, landings, events, targetReached } = playRun(seed, { sectors, ...options });
    if (targetReached) targets++;
    if (state.science?.over) {
      if (state.science.objectiveMet) missionsOk++;
      else missionsPartial++;
    }
    science += state.science?.deliveredScience ?? 0;
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
    const outcome = state.lossReason ?? (state.stats.sectorsCleared >= goal || state.science?.over ? 'survived' : 'timeout');
    reasons[outcome] = (reasons[outcome] ?? 0) + 1;
    for (let i = 0; i <= Math.min(goal, state.stats.sectorsCleared); i++) cleared[i]!++;
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
    overloads += events.filter((e) => e.type === 'overload').length;
  }
  const eco = { earned, spent, upgradesBought, credits, emergencies, upgradeCount, distinctSets: sets.size };
  return { reasons, cleared, time, hull, fuel, incidents, impacts, grazed, surf, eco, overloads, targets, missionsOk, missionsPartial, science, ms: performance.now() - started };
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

// Fase 4: el diseño de referencia de cada misión (primer válido de su fixture) con la tripulación atenta y la
// prudente, sobre el mapa del sistema solar.
// Cada misión juega su ruta completa de ida y vuelta: 2·(zonas − 1) tramos (al menos 2). Se juegan los dos primeros
// diseños válidos y hasta dos No-Go que fallan en vuelo (potencia, combustible, enlace), para ver CÓMO se pierde.
// «destino» = % de partidas que atracan alguna vez en el nodo destino (`missionTarget`). Fase 5 (ADR 0018): «cumplida» =
// vuelve a la Tierra con la ciencia pedida entregada; «parcial» = vuelve sin ella; «ciencia» = media entregada / pedida.
const OPERATIONAL_CAUSES = ['power', 'range', 'comms-range'];
console.log(`\n== fase 4 · diseños por misión (${runs} partidas, ruta completa de ida y vuelta) ==`);
console.log('misión · diseño | Go | perfil | tramos | superan T1..Tn | destino | cumplida | parcial | ciencia | pérdidas | casco | sobrecargas/partida | puntuación');
for (const mission of getMissions()) {
  const fixture = loadMissionFixture(mission.id);
  const legs = Math.max(2, 2 * (routeZones(mission.destinations[0] ?? null).length - 1));
  const failing = fixture.failing.filter((f) => OPERATIONAL_CAUSES.includes(f.cause ?? '')).slice(0, 2);
  const entries = [...fixture.valid.slice(0, 2).map((v) => ({ ...v, go: true })), ...failing.map((f) => ({ ...f, go: false }))];
  for (const entry of entries) {
    const profiles4 = entry.go
      ? ([['crew 3.5', { skill: 'crew', walkS: 3.5 }], ['crew 7', { skill: 'crew', walkS: 7 }], ['prudent', { skill: 'crew', walkS: 3.5, explore: 'prudent' }]] as const)
      : ([['crew 3.5', { skill: 'crew', walkS: 3.5 }]] as const);
    for (const [label, options] of profiles4) {
      const r = play({ ...options, design: entry.design, sectors: legs, maxSeconds: 10_800 });
      const lost = Object.entries(r.reasons).filter(([k]) => k !== 'survived').map(([k, n]) => `${k} ${n}`).join(', ') || '-';
      console.log(
        `${mission.id} · ${entry.name} | ${entry.go ? 'Go' : `No-Go (${entry.cause})`} | ${label} | ${legs} | ` +
          `${r.cleared.slice(1).map((n) => `${Math.round((n / runs) * 100)}`).join(' · ')} % | ${pct(r.targets, runs)} % | ` +
          `${pct(r.missionsOk, runs)} % | ${pct(r.missionsPartial, runs)} % | ${Math.round(r.science / runs)}/${mission.requirements.minScience} | ${lost} | ` +
          `${Math.round(r.hull / runs)} | ${(r.overloads / runs).toFixed(1)} | ${Math.round(r.surf.score / runs)}`,
      );
    }
  }
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

// Fase 8: cordura de la tripulación. El catálogo por defecto la trae apagada; aquí se juega con ella activa y las tres
// políticas del bot (`ignore`, `rest`, `buy`). Por sector: cordura media y percentil 10 al terminar; después, tiempo en
// banda crítica y contramedidas usadas.
console.log(`\n== fase 8 · cordura (catálogo con psych.enabled, crew 3.5, ${runs} partidas, hasta 4 sectores) ==`);
console.log('política | cordura media y p10 al terminar S1..S4 | segundos en crítica | descansos (s) | llamadas | lapsus | provisiones | créditos gastados | pérdidas');
const psychCat = psychCatalog();
for (const policy of ['ignore', 'rest', 'buy'] as const) {
  const perSector: number[][] = [[], [], [], []];
  let critical = 0;
  let restS = 0;
  let calls = 0;
  let lapses = 0;
  let provisions = 0;
  let spent = 0;
  const lost: Record<string, number> = {};
  for (let seed = 1; seed <= runs; seed++) {
    for (let k = 1; k <= 4; k++) {
      const { state } = playRun(seed, { skill: 'crew', walkS: 3.5, sectors: k, catalog: psychCat, psychPolicy: policy });
      const alive = state.crew.filter((c) => c.sanityPct !== undefined);
      if (state.stats.sectorsCleared >= k) perSector[k - 1]!.push(alive.reduce((s, c) => s + (c.sanityPct ?? 0), 0) / Math.max(1, alive.length));
      if (k === 4) {
        critical += state.stats.sanityCriticalS ?? 0;
        restS += state.stats.restS ?? 0;
        calls += state.stats.callsMade ?? 0;
        lapses += state.stats.lapses ?? 0;
        provisions += state.stats.provisionsUsed ?? 0;
        spent += state.stats.creditsSpent ?? 0;
        if (state.lossReason) lost[state.lossReason] = (lost[state.lossReason] ?? 0) + 1;
      }
    }
  }
  const cell = (xs: number[]) => {
    if (xs.length === 0) return '-';
    const sorted = [...xs].sort((a, b) => a - b);
    return `${Math.round(xs.reduce((s, x) => s + x, 0) / xs.length)}/${Math.round(sorted[Math.floor(sorted.length * 0.1)]!)}`;
  };
  console.log(
    `${policy.padEnd(6)} | ${perSector.map(cell).join(' · ')} | ${Math.round(critical / runs)} | ${Math.round(restS / runs)} | ${(calls / runs).toFixed(1)} | ` +
      `${(lapses / runs).toFixed(1)} | ${(provisions / runs).toFixed(1)} | ${Math.round(spent / runs)} | ${Object.entries(lost).map(([k, n]) => `${k} ${n}`).join(', ') || '-'}`,
  );
}
