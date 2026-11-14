/**
 * Atajos de depuración (y de los tests): llevar una partida hasta un destino aterrizable, aterrizar con
 * el perfil de referencia y salir de la nave. Solo usan acciones del motor: nada se escribe a mano.
 */
import { getEconomy, getNode, getNodeKind, getSurfaceCatalog, getWorld, hasShop, referenceBrake, type Run, type RunPhase } from '@payload/shared';
import { isLandableNode } from './surfaceRules';

/** Fase actual (sin el estrechamiento de tipos de TypeScript: la cambian las acciones). */
const phaseOf = (run: Run): RunPhase => run.state.phase;

/** Ruta más corta (en saltos) desde la posición actual hasta un destino aterrizable donde aún no se aterrizó. */
export function routeToLandable(run: Run): string[] | null {
  const s = run.state;
  return routeTo(run, (id) => {
    return isLandableNode(s, id, run.catalog) && !s.landedIds.includes(id);
  });
}

/** Ruta más corta (en saltos) hasta el primer destino que cumpla `isTarget` ([] si ya se está en uno). */
export function routeTo(run: Run, isTarget: (id: string) => boolean): string[] | null {
  const s = run.state;
  const prev = new Map<string, string | null>([[s.locationId, null]]);
  const queue = [s.locationId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (isTarget(id)) {
      const path: string[] = [];
      for (let at: string | null = id; at && at !== s.locationId; at = prev.get(at) ?? null) path.unshift(at);
      return path;
    }
    for (const next of getNode(s.sector, id)?.links ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, id);
      queue.push(next);
    }
  }
  return null;
}

/** Avanza `seconds` atendiendo todo al instante (tripulación perfecta). */
function stepAttended(run: Run, seconds: number): void {
  for (let t = 0; t < seconds && run.state.phase !== 'lost'; t += 0.5) {
    for (const inc of [...run.state.incidents]) for (let k = 0; k < 80 && run.state.incidents.includes(inc); k++) run.apply({ type: 'work-incident', incidentId: inc.id, seconds: 0.5 });
    if (run.state.warnings.some((w) => !w.evaded)) run.apply({ type: 'evade' });
    run.step(0.5);
  }
}

/** Salta hasta el destino aterrizable más cercano. Devuelve true si queda atracada en él. */
export function travelToLandable(run: Run): boolean {
  return travelAlong(run, routeToLandable(run));
}

/** Sigue una ruta saltando a régimen económico (atendiendo averías y esquivas al instante). */
function travelAlong(run: Run, path: string[] | null): boolean {
  if (!path) return false;
  if (phaseOf(run) !== 'docked') return false;
  run.apply({ type: 'set-throttle', throttle: 'eco' });
  for (const toId of path) {
    if (!run.apply({ type: 'jump', toId }).ok) return false;
    for (let i = 0; i < 2000 && phaseOf(run) === 'transit'; i++) stepAttended(run, 0.5);
    if (phaseOf(run) !== 'docked' && phaseOf(run) !== 'won') return false;
  }
  return phaseOf(run) === 'docked';
}

/** Desciende con el perfil de frenado de referencia hasta tocar tierra. */
export function autoDescend(run: Run): void {
  const rules = getSurfaceCatalog(run.catalog).rules;
  for (let i = 0; i < 20000 && run.state.phase === 'landing'; i++) {
    const surface = run.state.surface;
    const d = surface?.descent;
    if (!surface || !d) break;
    const brake = referenceBrake(getWorld(surface.worldId, run.catalog), rules, d.altitudeM, d.speedMps);
    if (brake !== d.brake) run.apply({ type: 'set-descent-brake', on: brake });
    run.step(0.1);
  }
}

/** Atajo completo: viajar, aterrizar y (opcional) quedarse en el descenso para jugarlo. */
export function reachSurface(run: Run, stage: 'descent' | 'landed' | 'eva' = 'eva'): boolean {
  if (run.state.phase === 'docked' && !run.estimateLanding()?.canLand && !travelToLandable(run)) return false;
  const est = run.estimateLanding();
  if (est?.alreadyLanded && !travelToLandable(run)) return false;
  if (!run.apply({ type: 'land' }).ok) return false;
  if (stage === 'descent') return true;
  autoDescend(run);
  if (phaseOf(run) !== 'surface') return false;
  if (stage === 'eva') return run.apply({ type: 'eva-exit' }).ok;
  return true;
}

// ─── Terminal de estación (fase 3) ──────────────────────────────────────────────────────────────

const isShop = (run: Run, id: string): boolean => {
  const n = getNode(run.state.sector, id);
  return !!n && hasShop(getNodeKind(n.kind, run.catalog));
};

/** Salta hasta la estación con terminal más cercana (true si queda atracada en ella). */
export function travelToStation(run: Run): boolean {
  if (phaseOf(run) !== 'docked') return false;
  return travelAlong(run, routeTo(run, (id) => isShop(run, id)));
}

/** Camina (informando `set-position`) hasta (x, z) sin pasar del límite antitrampas del motor. */
function walkTo(run: Run, x: number, z: number): void {
  const suit = run.effectiveSurfaceRules().suit;
  const stepS = 0.1;
  const stepM = suit.maxMoveSpeedMps * stepS * 0.9;
  const me = () => run.state.crew[0]!;
  for (let i = 0; i < 4000 && phaseOf(run) === 'surface' && me().alive && me().location === 'eva'; i++) {
    const dx = x - me().x;
    const dz = z - me().z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const k = Math.min(1, stepM / d);
    run.apply({ type: 'set-position', x: me().x + dx * k, z: me().z + dz * k, grounded: true });
    run.step(stepS);
  }
}

/**
 * En EVA: recoge lo más valioso a la venta de las vetas seguras más cercanas con las herramientas (solo
 * acciones del motor) y vuelve a entrar. Devuelve las unidades que lleva al entrar.
 */
export function mineForSale(run: Run, maxDeposits = 3): number {
  const surface = run.state.surface;
  if (!surface || phaseOf(run) !== 'surface') return 0;
  const prices = getEconomy(run.catalog).sellPrices;
  const suit = run.effectiveSurfaceRules().suit;
  const targets = surface.deposits
    .filter((d) => d.units > 0 && !d.risky && (prices[d.materialId] ?? 0) > 0)
    .sort((a, b) => (prices[b.materialId] ?? 0) - (prices[a.materialId] ?? 0) || Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))
    .slice(0, maxDeposits);
  for (const d of targets) {
    const me = run.state.crew[0]!;
    if (!me.alive || me.suitO2Pct < 45) break;
    const r = Math.hypot(d.x, d.z) || 1;
    // Junto a la veta, del lado de la nave.
    walkTo(run, d.x - (d.x / r) * suit.collectRangeM * 0.5, d.z - (d.z / r) * suit.collectRangeM * 0.5);
    if (!run.apply({ type: 'deploy-tool', depositId: d.id }).ok) continue;
    for (let i = 0; i < 400 && run.state.crew[0]!.suitO2Pct > 35; i++) {
      run.step(0.25);
      const tool = run.state.surface?.tools.find((t) => t.depositId === d.id);
      if (!tool) break;
      if (tool.ready > 0 && !run.apply({ type: 'collect', depositId: d.id }).ok) break;
      if (tool.stopped === 'depleted' && tool.ready === 0) break;
    }
    run.apply({ type: 'retrieve-tool', depositId: d.id });
  }
  walkTo(run, 0, 0);
  const carried = run.state.crew[0]?.carriedUnits ?? 0;
  run.apply({ type: 'eva-enter' });
  return carried;
}

/**
 * Atajo de desarrollo: atracar en la estación más cercana. Con `loot`, antes aterriza en el aterrizable más
 * cercano, recoge carga vendible, despega y luego viaja a la estación (para probar la venta).
 */
export function reachStation(run: Run, loot = false): boolean {
  if (loot && reachSurface(run, 'eva')) {
    mineForSale(run);
    if (phaseOf(run) === 'surface') run.apply({ type: 'take-off' });
    for (let i = 0; i < 200 && phaseOf(run) !== 'docked' && phaseOf(run) !== 'lost'; i++) run.step(0.5);
  }
  if (phaseOf(run) !== 'docked') return false;
  if (isShop(run, run.state.locationId)) return true;
  return travelToStation(run);
}
