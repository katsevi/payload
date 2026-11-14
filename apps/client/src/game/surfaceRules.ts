/**
 * Superficie en el cliente (lógica PURA, sin Three.js): dónde se posa la nave respecto al tripulante,
 * qué escena se pinta, qué se puede hacer junto a una veta o a la rampa, hacia dónde queda la nave y
 * la guía del descenso. El motor manda en recursos y consecuencias; aquí solo se traduce.
 */
import { catalog as defaultCatalog, getNodeWorld, getSurfaceCatalog, lodeProgress, referenceBrake, type Catalog, type Deposit, type LodeProgress, type PlacedTool, type RunAction, type RunPhase, type RunState, type StormStatus, type WorldDef } from '@payload/shared';
import { effectiveRulesOf } from './effective';

/**
 * ¿Se puede aterrizar en este nodo? Lo decide el motor: hay mundo de superficie (`getNodeWorld`). Un cuerpo real con
 * `landable: false` (gigantes gaseosos, estaciones) no lo tiene aunque su tipo de nodo sea aterrizable.
 */
export function isLandableNode(state: Pick<RunState, 'seed' | 'sector'>, nodeId: string, cat: Catalog = defaultCatalog): boolean {
  return getNodeWorld(state.seed, state.sector, nodeId, cat) !== null;
}
import type { Prompt, PromptBadge } from '../state/ui';
import { myCrew } from './me';

// ─── Dónde está la nave ──────────────────────────────────────────────────────────────────────────

/**
 * El origen de la superficie (0, 0) es el pie de la rampa de la esclusa: ahí aparece el tripulante al
 * salir y ahí tiene que volver para entrar (`airlockRangeM` del motor). La nave queda a +X, con la
 * cubierta a `DECK_Y` m sobre el suelo (se puede pasar por debajo).
 *
 *   superficie = interior + SHIP_OFFSET
 */
export const DECK_Y = 2.6;
export const SHIP_OFFSET = { x: 10, y: DECK_Y, z: -2.4 } as const;
/** Centro de la nave en superficie y radio de la explanada de aterrizaje. */
export const SHIP_CENTER = { x: SHIP_OFFSET.x, z: SHIP_OFFSET.z } as const;
export const PAD_RADIUS_M = 20;
/** Al salir: al pie de la rampa, de espaldas a la nave (mirando a −X). */
export const EVA_START = { x: 0, z: 0, yaw: Math.PI / 2 } as const;
/** Al entrar: junto a la esclusa, por dentro, mirando a la cubierta (+X). */
export const AIRLOCK_INSIDE = { x: -3.5, z: 2.4, yaw: -Math.PI / 2 } as const;

export function toSurface(ix: number, iz: number): { x: number; z: number } {
  return { x: ix + SHIP_OFFSET.x, z: iz + SHIP_OFFSET.z };
}

// ─── Qué escena se pinta ─────────────────────────────────────────────────────────────────────────

export type SceneId = 'ship' | 'surface';

/**
 * Fuera (superficie) durante el descenso, unos segundos tras tocar tierra (`descentView`) y mientras el
 * tripulante está en EVA, también si muere ahí. Dentro, todo lo demás (también si la nave se pierde
 * en el descenso: la vista exterior no se queda viva bajo la pantalla final).
 */
export function sceneFor(phase: RunPhase | undefined, location: 'ship' | 'eva' | undefined, descentView: boolean): SceneId {
  if (phase === 'landing') return 'surface';
  if ((phase === 'surface' || phase === 'lost') && location === 'eva') return 'surface';
  if (descentView && phase === 'surface') return 'surface';
  return 'ship';
}

// ─── Interacción en la superficie ────────────────────────────────────────────────────────────────

/** Segundos manteniendo E al pie de la rampa para entrar. */
export const ENTER_HOLD_S = 0.6;

/**
 * Qué se puede hacer en la superficie junto al tripulante:
 * - `deploy`: veta con unidades y sin herramienta → E coloca la que toca (`material.tool`);
 * - `tool`: herramienta colocada → E recoge lo listo (o la guarda si la veta se agotó), Q la retira antes;
 * - `enter`: al pie de la rampa → mantener E entra (y avisa de lo que se quedaría fuera).
 */
export type SurfaceInteraction =
  | { kind: 'deploy'; deposit: Deposit; toolId: string; left: number }
  | { kind: 'tool'; tool: PlacedTool; deposit: Deposit | null; full: boolean }
  | { kind: 'enter'; carriedKg: number; toolsOut: number; readyOut: number };

/** Reglas de superficie EFECTIVAS (con las mejoras de `state`); sin estado, las del catálogo. */
export function surfaceRulesOf(cat: Catalog = defaultCatalog, state?: Pick<RunState, 'upgrades'>) {
  return state ? effectiveRulesOf(state, cat) : getSurfaceCatalog(cat).rules;
}

/** Herramienta que extrae un material (la elige el motor por `material.tool`; aquí solo se muestra). */
export function toolFor(materialId: string, cat: Catalog = defaultCatalog): string | null {
  return getSurfaceCatalog(cat).materials.find((m) => m.id === materialId)?.tool ?? null;
}

/** Lo que se perdería al entrar si quien entra es el último fuera: herramientas colocadas y piezas listas. */
export function leftOutside(state: RunState): { toolsOut: number; readyOut: number } {
  const surface = state.surface;
  const othersOut = state.crew.filter((c) => c.alive && c.location === 'eva').length > 1;
  if (!surface || othersOut) return { toolsOut: 0, readyOut: 0 };
  return { toolsOut: surface.tools.length, readyOut: surface.tools.reduce((n, t) => n + t.ready, 0) };
}

/**
 * La veta (con herramienta o con unidades) más cercana dentro del alcance, o la rampa si está a mano. Una
 * herramienta colocada tiene prioridad sobre una veta libre a la misma distancia.
 */
export function surfaceInteractionAt(state: RunState, x: number, z: number, cat: Catalog = defaultCatalog): SurfaceInteraction | null {
  const m = myCrew(state);
  if (state.phase !== 'surface' || !state.surface || !m || !m.alive || m.location !== 'eva') return null;
  const surface = getSurfaceCatalog(cat);
  // Traje EFECTIVO: alcance y mochila con las mejoras compradas.
  const suit = effectiveRulesOf(state, cat).suit;
  const surf = state.surface;
  let bestTool: PlacedTool | null = null;
  let bestToolD = suit.collectRangeM;
  for (const t of surf.tools) {
    const d = Math.hypot(t.x - x, t.z - z);
    if (d <= bestToolD) {
      bestTool = t;
      bestToolD = d;
    }
  }
  let best: Deposit | null = null;
  let bestD = suit.collectRangeM;
  for (const d of surf.deposits) {
    if (d.units <= 0 || surf.tools.some((t) => t.depositId === d.id)) continue;
    const dist = Math.hypot(d.x - x, d.z - z);
    if (dist <= bestD) {
      best = d;
      bestD = dist;
    }
  }
  if (bestTool && (!best || bestToolD <= bestD + 0.5)) {
    const t = bestTool;
    const mass = surface.materials.find((mat) => mat.id === t.materialId)?.massKg ?? 0;
    return { kind: 'tool', tool: t, deposit: surf.deposits.find((d) => d.id === t.depositId) ?? null, full: m.carriedKg + mass > suit.carryCapacityKg + 1e-9 };
  }
  if (best) {
    const toolId = toolFor(best.materialId, cat) ?? '';
    return { kind: 'deploy', deposit: best, toolId, left: m.tools[toolId] ?? 0 };
  }
  if (Math.hypot(x, z) <= suit.airlockRangeM) return { kind: 'enter', carriedKg: m.carriedKg, ...leftOutside(state) };
  return null;
}

/** Teclas de la superficie (claves ui `keys.*`): E usa (colocar, recoger, entrar), Q retira la herramienta. */
export const SURFACE_KEY_USE = 'keys.interact';
export const SURFACE_KEY_ALT = 'keys.alt';

/**
 * Aviso de la acción en la superficie. `airborne`: colocar y recoger exigen pies en el suelo
 * (`reject.toolAirborne` / `reject.collectAirborne`), así que en el aire se ve bloqueado.
 */
export function surfacePromptFor(i: SurfaceInteraction | null, enterProgress = 0, airborne = false): Prompt | null {
  if (!i) return null;
  if (i.kind === 'enter') {
    const badges: PromptBadge[] = [];
    if (i.toolsOut > 0) badges.push({ key: 'prompt.toolsOut', params: { n: i.toolsOut }, tone: 'warn' });
    if (i.readyOut > 0) badges.push({ key: 'prompt.readyOut', params: { n: i.readyOut }, tone: 'warn' });
    return {
      key: i.carriedKg > 0 ? 'prompt.enterCargo' : 'prompt.enter',
      params: { kg: Math.round(i.carriedKg) },
      hold: true,
      progress: Math.min(1, enterProgress),
      ...(badges.length > 0 ? { badges, warn: true } : {}),
    };
  }
  if (i.kind === 'deploy') {
    const params = { tool: i.toolId, material: i.deposit.materialId };
    const icon = i.toolId;
    const badges: PromptBadge[] = [{ key: 'prompt.toolsLeft', params: { n: i.left }, tone: i.left > 0 ? 'info' : 'warn' }];
    if (i.left <= 0) return { key: 'prompt.noToolLeft', params, icon, hold: false, progress: 0, blocked: true, badges };
    if (airborne) return { key: 'prompt.toolAirborne', params, icon, hold: false, progress: 0, blocked: true, badges };
    return { key: 'prompt.deployTool', params, icon, hold: false, progress: 0, badges };
  }
  // Herramienta colocada.
  const t = i.tool;
  const params = { tool: t.toolId, material: t.materialId, units: t.ready, left: i.deposit?.units ?? 0 };
  const alt = { altKey: 'prompt.retrieveTool' };
  const icon = t.toolId;
  if (t.ready > 0) {
    if (i.full) return { key: 'prompt.full', params, icon, hold: false, progress: 0, blocked: true, ...alt };
    if (airborne) return { key: 'prompt.collectAirborne', params, icon, hold: false, progress: 0, blocked: true, ...alt };
    return { key: 'prompt.collectReady', params, icon, hold: false, progress: 0, ...alt };
  }
  if (t.stopped === 'depleted') return { key: 'prompt.toolPickUp', params, icon, hold: false, progress: 0 };
  if (t.stopped === 'storm') return { key: 'prompt.toolStorm', params, icon, hold: false, progress: t.progress, progressBar: true, blocked: true, ...alt };
  return { key: 'prompt.toolWorking', params, icon, hold: false, progress: t.progress, progressBar: true, blocked: true, ...alt };
}

/** Acción del motor al pulsar E en la superficie (entrar es de mantener: la lleva la escena). */
export function surfaceUseAction(i: SurfaceInteraction | null): RunAction | null {
  if (!i) return null;
  if (i.kind === 'deploy') return i.left > 0 ? { type: 'deploy-tool', depositId: i.deposit.id } : null;
  if (i.kind === 'tool') {
    if (i.tool.ready > 0) return i.full ? null : { type: 'collect', depositId: i.tool.depositId };
    // Veta agotada y nada pendiente: `collect` devuelve la herramienta a la mochila.
    if (i.tool.stopped === 'depleted') return { type: 'collect', depositId: i.tool.depositId };
  }
  return null;
}

/** Acción de Q en la superficie: retirar la herramienta antes de que termine. */
export function surfaceAltAction(i: SurfaceInteraction | null): RunAction | null {
  return i?.kind === 'tool' ? { type: 'retrieve-tool', depositId: i.tool.depositId } : null;
}

/** La herramienta con piezas listas más cercana (para la flecha del HUD); null si no hay ninguna. */
export function nearestReadyTool(state: RunState, x: number, z: number): PlacedTool | null {
  return nearestTool(state, x, z, true);
}

/** La herramienta colocada más cercana (con piezas listas si `readyOnly`). */
export function nearestTool(state: RunState, x: number, z: number, readyOnly = false): PlacedTool | null {
  let best: PlacedTool | null = null;
  let bestD = Infinity;
  for (const t of state.surface?.tools ?? []) {
    if (readyOnly && t.ready <= 0) continue;
    const d = Math.hypot(t.x - x, t.z - z);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

// ─── Hacia dónde queda la nave ───────────────────────────────────────────────────────────────────

/**
 * Distancia a la rampa y ángulo respecto a la mirada (rad; 0 = de frente, + = a la derecha). La vista
 * mira a (−sen yaw, −cos yaw) y su derecha es (cos yaw, −sen yaw), como en `PlayerController`.
 */
export function shipBearing(x: number, z: number, yaw: number): { distanceM: number; angle: number } {
  return bearingTo(x, z, yaw, 0, 0);
}

/** Distancia y ángulo respecto a la mirada hacia un punto cualquiera (la herramienta con piezas listas). */
export function bearingTo(x: number, z: number, yaw: number, toX: number, toZ: number): { distanceM: number; angle: number } {
  const tx = toX - x;
  const tz = toZ - z;
  const fwd = -Math.sin(yaw) * tx - Math.cos(yaw) * tz;
  const right = Math.cos(yaw) * tx - Math.sin(yaw) * tz;
  return { distanceM: Math.hypot(tx, tz), angle: Math.atan2(right, fwd) };
}

// ─── Guía del descenso ───────────────────────────────────────────────────────────────────────────

/**
 * Velocidad a partir de la cual el perfil de referencia del motor ya frenaría a esta altitud (la marca
 * de «frena» en la barra de velocidad). Se busca sobre `referenceBrake`, sin duplicar su fórmula.
 */
export function brakeThresholdMps(world: WorldDef, altitudeM: number, cat: Catalog = defaultCatalog): number {
  const rules = getSurfaceCatalog(cat).rules;
  if (referenceBrake(world, rules, altitudeM, 0)) return 0;
  let lo = 0;
  let hi = 200;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (referenceBrake(world, rules, altitudeM, mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

// ─── Oxígeno: lo que se oye ──────────────────────────────────────────────────────────────────────

/** Segundos entre respiraciones: calmada arriba del umbral bajo, cada vez más rápida por debajo. */
export function breathIntervalS(o2Pct: number, lowPct: number): number {
  if (o2Pct >= lowPct) return 3.4;
  const k = Math.max(0, o2Pct) / lowPct;
  return 0.9 + 1.6 * k;
}

/** Segundos entre pitidos de O₂ crítico (null = sin pitido). */
export function o2BeepIntervalS(o2Pct: number, criticalPct: number): number | null {
  if (o2Pct >= criticalPct || o2Pct <= 0) return null;
  return 0.45 + 0.9 * (o2Pct / criticalPct);
}

// ─── Tormenta: lo que se ve ──────────────────────────────────────────────────────────────────────

/**
 * Cuánto se nota la tormenta: `warn` sube de 0 a 1 durante el aviso (el horizonte se oscurece y el
 * viento crece) y `active` es la intensidad mientras dura.
 */
export function stormLevel(storm: StormStatus | undefined, warnS: number): { warn: number; active: number } {
  if (!storm) return { warn: 0, active: 0 };
  if (storm.active) return { warn: 1, active: storm.intensity };
  if (storm.warned && storm.nextInS !== null && warnS > 0) return { warn: Math.min(1, Math.max(0, 1 - storm.nextInS / warnS)), active: 0 };
  return { warn: 0, active: 0 };
}

/** Empuje lateral de la tormenta en plena intensidad (m/s; corriendo se va a ~5,5). */
export const STORM_WIND_MPS = 3;

// ─── Caída: aviso antes del golpe ────────────────────────────────────────────────────────────────

/**
 * Velocidad con la que se llegará al suelo desde `heightM` m bajando a `vy` m/s (+ arriba) con una
 * aceleración neta hacia abajo `downAccelMps2` (la gravedad, o la gravedad menos el freno del jetpack).
 * 0 si con esa aceleración no se llega a golpear (el freno para antes).
 */
export function predictedImpactMps(vy: number, heightM: number, downAccelMps2: number): number {
  const h = Math.max(0, heightM);
  const v2 = vy * vy + 2 * downAccelMps2 * h;
  if (vy >= 0 && downAccelMps2 <= 0) return 0;
  return v2 > 0 ? Math.sqrt(v2) : 0;
}

/** Aviso de caída peligrosa: bajando y, tal como va, el golpe pasará del umbral inofensivo. */
export function fallDanger(vy: number, heightM: number, downAccelMps2: number, harmlessMps: number): boolean {
  return vy < 0 && predictedImpactMps(vy, heightM, downAccelMps2) > harmlessMps;
}

// ─── Oxígeno frente a distancia ──────────────────────────────────────────────────────────────────

/** Margen sobre el O₂ que cuesta volver andando a partir del cual la brújula avisa. */
export const O2_RETURN_MARGIN = 1.5;

/** O₂ (%) que cuesta volver andando en línea recta desde `distanceM` hasta la rampa. */
export function o2ToReturnPct(distanceM: number, drainPctPerS: number, walkMps: number): number {
  return (Math.max(0, distanceM) / Math.max(0.1, walkMps)) * drainPctPerS;
}

/** El O₂ que queda ya no da con holgura (× `O2_RETURN_MARGIN`) para volver andando. */
export function o2ReturnShort(o2Pct: number, distanceM: number, drainPctPerS: number, walkMps: number, margin = O2_RETURN_MARGIN): boolean {
  return o2Pct < margin * o2ToReturnPct(distanceM, drainPctPerS, walkMps);
}

// ─── Oxígeno frente al recorrido por las herramientas ────────────────────────────────────────────

/**
 * Metros de ir recogiendo las herramientas colocadas (la más cercana cada vez) y volver a la rampa. Sin
 * herramientas, la línea recta a la nave.
 */
export function tourDistanceM(x: number, z: number, points: readonly { x: number; z: number }[]): number {
  const left = points.slice();
  let cx = x;
  let cz = z;
  let total = 0;
  while (left.length > 0) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = Math.hypot(left[i]!.x - cx, left[i]!.z - cz);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    total += bd;
    cx = left[bi]!.x;
    cz = left[bi]!.z;
    left.splice(bi, 1);
  }
  return total + Math.hypot(cx, cz);
}

/** Con este colchón sobre lo justo todavía merece la pena ir a por las herramientas. */
export const FETCH_MIN_MARGIN = 1.15;

/**
 * Qué dice la brújula del oxígeno:
 * - `ok`: da para recoger las herramientas y volver con holgura;
 * - `fetch`: ve YA a por tus herramientas (aún da, justo);
 * - `leave`: déjalas y vuelve directo (a por ellas ya no da, pero volver sí con holgura);
 * - `short`: ni volviendo directo hay holgura (el aviso rojo de siempre).
 */
export type O2Route = 'ok' | 'fetch' | 'leave' | 'short';

export function o2RouteStatus(
  o2Pct: number,
  x: number,
  z: number,
  tools: readonly { x: number; z: number }[],
  drainPctPerS: number,
  walkMps: number,
  margin = O2_RETURN_MARGIN,
): O2Route {
  const direct = o2ToReturnPct(Math.hypot(x, z), drainPctPerS, walkMps);
  const tour = o2ToReturnPct(tourDistanceM(x, z, tools), drainPctPerS, walkMps);
  if (o2Pct < margin * direct) return 'short';
  if (o2Pct >= margin * tour) return 'ok';
  return o2Pct >= FETCH_MIN_MARGIN * tour ? 'fetch' : 'leave';
}

// ─── Filones ─────────────────────────────────────────────────────────────────────────────────────

/** Distancia (m) a la que una veta de filón cuenta como «en la que estás trabajando». */
export const LODE_NEAR_M = 8;

/**
 * El filón en el que se está trabajando: el de la veta de filón más cercana (a menos de `LODE_NEAR_M`) o,
 * si no hay ninguna cerca, el que lleva más avance en esta salida. Tolerante: sin datos de filón
 * (`lodeVeinsDone` o `lodeId`), null.
 */
export function currentLode(state: RunState, member: RunState['crew'][number], x: number, z: number): LodeProgress | null {
  const surface = state.surface;
  if (!surface || !Array.isArray((member as { lodeVeinsDone?: unknown }).lodeVeinsDone)) return null;
  const all = lodeProgress(surface.deposits, member);
  if (all.length === 0) return null;
  let nearId: number | null = null;
  let nearD = LODE_NEAR_M;
  for (const d of surface.deposits) {
    if (d.lodeId === undefined) continue;
    const dist = Math.hypot(d.x - x, d.z - z);
    if (dist < nearD) {
      nearD = dist;
      nearId = d.lodeId;
    }
  }
  const near = nearId === null ? undefined : all.find((p) => p.lodeId === nearId);
  if (near) return near;
  let best: LodeProgress | null = null;
  for (const p of all) if (p.done > 0 && p.done < p.total && (!best || p.done > best.done)) best = p;
  return best;
}

/** Vetas que completarían un filón (bonus listo): la que queda de cada filón con `bonusReady`. */
export function lodeFinisherIds(state: RunState, member: RunState['crew'][number]): number[] {
  const surface = state.surface;
  if (!surface || !Array.isArray((member as { lodeVeinsDone?: unknown }).lodeVeinsDone)) return [];
  const ready = new Set(lodeProgress(surface.deposits, member).filter((p) => p.bonusReady).map((p) => p.lodeId));
  return surface.deposits.filter((d) => d.lodeId !== undefined && ready.has(d.lodeId) && !member.lodeVeinsDone.includes(d.id)).map((d) => d.id);
}
