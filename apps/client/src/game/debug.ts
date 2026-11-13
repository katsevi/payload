/**
 * Atajos de depuración (y de los tests): llevar una partida hasta un destino aterrizable, aterrizar con
 * el perfil de referencia y salir de la nave. Solo usan acciones del motor: nada se escribe a mano.
 */
import { getNode, getNodeKind, getSurfaceCatalog, getWorld, referenceBrake, type Run, type RunPhase } from '@payload/shared';

/** Fase actual (sin el estrechamiento de tipos de TypeScript: la cambian las acciones). */
const phaseOf = (run: Run): RunPhase => run.state.phase;

/** Ruta más corta (en saltos) desde la posición actual hasta un destino aterrizable donde aún no se aterrizó. */
export function routeToLandable(run: Run): string[] | null {
  const s = run.state;
  const isTarget = (id: string): boolean => {
    const n = getNode(s.sector, id);
    return !!n && getNodeKind(n.kind, run.catalog).landable && !s.landedIds.includes(id);
  };
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
  const path = routeToLandable(run);
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
