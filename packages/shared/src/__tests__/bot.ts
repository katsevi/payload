/**
 * Tripulante simulado para los tests de balance y de mensajes. Juega como UNA persona: ir de un
 * puesto a otro cuesta tiempo (`walkS`), así que no puede atenderlo todo a la vez.
 *   - `crew`: esquiva impactos, apaga fuegos, sella fugas, repara y gestiona la energía.
 *   - `idle`: solo elige destino y salta (nadie repara nada): sirve de grupo de control.
 */
import { createRun, FIXED_STEP_S, getNode, getNodeKind, type Run, type RunEvent, type RunState, type SystemId } from '../index';

export interface BotOptions {
  skill: 'crew' | 'idle';
  /** Segundos que tarda en llegar a otro puesto. */
  walkS?: number;
  /** Sectores a superar antes de parar. */
  sectors?: number;
  maxSeconds?: number;
}

export interface BotResult {
  state: RunState;
  events: RunEvent[];
}

type Post = SystemId | 'helm' | 'map';

function chooseJump(run: Run): string | null {
  const s = run.state;
  const here = getNode(s.sector, s.locationId)!;
  let best: { id: string; value: number } | null = null;
  for (const id of here.links) {
    const node = getNode(s.sector, id)!;
    const est = run.estimateJump(id);
    if (!est || !est.byThrottle.eco.enoughFuel) continue;
    const forward = node.column > here.column ? 100 : s.visitedIds.includes(id) ? -200 : -50;
    const station = node.kind === 'station' && (s.ship.hull < 60 || s.ship.fuel < 55) ? 60 : 0;
    const goal = id === s.sector.goalId ? 500 : 0;
    const value = forward + station + goal - est.riskLevel * 22 - est.distanceLy + (node.cache ? 10 : 0);
    if (!best || value > best.value) best = { id, value };
  }
  return best?.id ?? null;
}

export function playRun(seed: number, options: BotOptions): BotResult {
  const { skill, walkS = 3.5, sectors = 1, maxSeconds = 3600 } = options;
  const run = createRun({ seed });
  const s = run.state;
  const events: RunEvent[] = [];
  let post: Post = 'map';
  let walkLeftS = 0;
  let planLeftS = 2;

  const goTo = (target: Post): boolean => {
    if (post !== target) {
      post = target;
      walkLeftS = walkS;
    }
    return walkLeftS <= 0;
  };

  for (let t = 0; t < maxSeconds; t += FIXED_STEP_S) {
    if (s.phase === 'lost') break;
    if (s.phase === 'won') {
      if (s.stats.sectorsCleared >= sectors) break;
      run.apply({ type: 'next-sector' });
    }
    walkLeftS = Math.max(0, walkLeftS - FIXED_STEP_S);

    if (skill === 'crew') {
      const ship = s.ship;
      // Energía: si hay sobrecarga, primero fuera sensores y luego escudos; se recuperan cuando sobra.
      if (ship.overloaded) {
        if (ship.systems.nav.enabled) run.apply({ type: 'toggle-system', systemId: 'nav', enabled: false });
        else if (ship.systems.shields.enabled) run.apply({ type: 'toggle-system', systemId: 'shields', enabled: false });
      } else {
        const spare = ship.powerSupplyKw - ship.powerDemandKw;
        if (!ship.systems.shields.enabled && spare >= 32) run.apply({ type: 'toggle-system', systemId: 'shields', enabled: true });
        else if (!ship.systems.nav.enabled && spare >= 12) run.apply({ type: 'toggle-system', systemId: 'nav', enabled: true });
      }

      const warning = s.warnings.find((w) => !w.evaded);
      const urgent = [...s.incidents].sort((a, b) => rank(a.kind) - rank(b.kind))[0];
      const damaged = (['reactor', 'engines', 'lifeSupport', 'shields', 'nav'] as const).find((id) => ship.systems[id].healthPct < 45);
      if (warning && warning.etaS >= 0 && warning.etaS < walkS + 4) {
        if (goTo('helm')) run.apply({ type: 'evade' });
      } else if (urgent) {
        if (goTo(urgent.systemId)) run.apply({ type: 'work-incident', incidentId: urgent.id, seconds: FIXED_STEP_S });
      } else if (damaged && ship.spares > 0) {
        if (goTo(damaged)) run.apply({ type: 'repair-system', systemId: damaged, seconds: FIXED_STEP_S });
      }
    }

    if (s.phase === 'docked') {
      const here = getNode(s.sector, s.locationId)!;
      if (getNodeKind(here.kind).service && !s.servicedIds.includes(here.id)) run.apply({ type: 'service' });
      planLeftS -= FIXED_STEP_S;
      const busy = skill === 'crew' && s.incidents.length > 0;
      if (planLeftS <= 0 && !busy) {
        const to = chooseJump(run);
        if (to) {
          const est = run.estimateJump(to)!;
          run.apply({ type: 'set-throttle', throttle: est.byThrottle.cruise.fuel < s.ship.fuel - 25 ? 'cruise' : 'eco' });
          if (run.apply({ type: 'jump', toId: to }).ok) planLeftS = 2;
        }
      }
    }
    run.step(FIXED_STEP_S);
    events.push(...run.takeEvents());
  }
  return { state: run.snapshot(), events };
}

function rank(kind: string): number {
  return kind === 'fire' ? 0 : kind === 'leak' ? 1 : 2;
}
