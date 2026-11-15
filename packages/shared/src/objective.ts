/**
 * Objetivo actual: qué tiene que hacer ahora la tripulación, derivado SOLO del `RunState` (función pura, sin estado
 * propio). Sirve igual en solitario y en el cooperativo (el cliente recibe el `RunState` del servidor y la llama).
 *
 * - Con misión diseñada: salir → llegar al destino → observarlo → bajar los datos → volver a la Tierra. El paso
 *   actual sale del estado de la ciencia (`science.ts`) y puede volver atrás (p. ej. si se pierden datos).
 *   Las misiones guiadas pueden poner sus propios textos (`guided.flightSteps`, claves `guided.<id>.<paso>`).
 * - Partida libre: en el sector 1, una guía para conocer el juego (saltar, reparar, la estación y la salida); en
 *   los siguientes, solo la salida del sector.
 *
 * Todo texto es `MessageRef` (`objective.*`); `hint` es la explicación opcional de una línea (ADR 0015).
 */
import { catalog as defaultCatalog, getNodeKind } from './catalog';
import { getMissions } from './design';
import { hasShop } from './economy';
import { getNode } from './galaxy';
import { getScienceRules } from './science';
import { getNodeWorld } from './surface';
import type {
  Catalog, GuidedFlightStep, MessageRef, MissionDesign, MissionStepId, ObjectiveProgress, ObjectiveStationId, ObjectiveStep, ObjectiveTarget,
  ObjectiveView, RunState, ScienceState, SectorNode,
} from './types';

const EPS = 1e-6;
/** Hacia abajo a 1 decimal: el progreso nunca muestra el tope antes de alcanzarlo. */
const floor1 = (n: number): number => Math.floor(n * 10 + 1e-6) / 10;

/** Paso en construcción: `situational` es la ayuda que manda cuando el paso es el actual (sobre la del catálogo). */
interface Draft extends Omit<ObjectiveStep, 'active'> {
  situational?: MessageRef;
  /** Puesto y destino que solo valen si el paso es el actual (sustituyen a los de por defecto). */
  situationalStation?: ObjectiveStationId;
  situationalTarget?: ObjectiveTarget;
}

const msg = (key: string, params?: MessageRef['params']): MessageRef => (params ? { key, params } : { key });
const targetOf = (node: SectorNode): ObjectiveTarget => (node.bodyId ? { nodeId: node.id, bodyId: node.bodyId } : { nodeId: node.id });

/** Avance en columnas del mapa hasta `to` (la columna del nodo en el que está la nave, acotada). */
function columnProgress(state: RunState, to: SectorNode | undefined): ObjectiveProgress | undefined {
  const here = getNode(state.sector, state.locationId);
  if (!here || !to || to.column <= 0) return undefined;
  return { value: Math.min(here.column, to.column), max: to.column, unit: 'jumps' };
}

/**
 * Objetivo actual de la partida. Pura y barata: se puede llamar en cada frame. `cat` = el catálogo con el que se creó
 * la partida (los textos de las misiones guiadas salen del catálogo por defecto, que es el que llega a `simLocales`).
 */
export function currentObjective(state: RunState, cat: Catalog = defaultCatalog): ObjectiveView {
  return state.missionDesign && state.science ? missionObjective(state, state.missionDesign, state.science, cat) : freeObjective(state, cat);
}

/** Ensambla la vista: marca el paso actual y aplica sus ayudas, puesto y destino de situación. */
function finish(mode: ObjectiveView['mode'], state: RunState, title: MessageRef, drafts: Draft[], current: number, complete: boolean): ObjectiveView {
  const steps: ObjectiveStep[] = drafts.map((d, i) => {
    const { situational, situationalStation, situationalTarget, ...rest } = d;
    const active = i === current;
    const step: ObjectiveStep = { ...rest, active };
    if (active && situational) step.hint = situational;
    if (active && situationalStation) step.station = situationalStation;
    if (active && situationalTarget) step.target = situationalTarget;
    if (active && state.phase === 'won' && !complete) {
      // Portal alcanzado: lo siguiente es pasar de tramo/sector, no ir a ningún puesto.
      step.hint = msg(mode === 'mission' ? 'objective.hint.nextLeg' : 'objective.hint.nextSector');
      delete step.station;
    }
    return step;
  });
  const cur = current >= 0 ? steps[current] : undefined;
  return {
    mode,
    status: state.phase === 'lost' ? 'failed' : complete ? 'complete' : 'active',
    title,
    steps,
    current,
    ...(cur?.target ? { target: cur.target } : {}),
    ...(cur?.station ? { station: cur.station } : {}),
    awaitingNextSector: state.phase === 'won' && !complete,
  };
}

// ─── Misión diseñada ──────────────────────────────────────────────────────────────────────────────

function missionObjective(state: RunState, design: MissionDesign, sci: ScienceState, cat: Catalog): ObjectiveView {
  const rules = getScienceRules(cat);
  const cap = rules.observeMaxS;
  const sector = state.sector;
  const targetNode = sector.nodes.find((n) => n.missionTarget);
  const goal = getNode(sector, sector.goalId);
  const body = design.destinationId ?? targetNode?.bodyId ?? '';
  const phase = state.phase;
  const onGround = phase === 'landing' || phase === 'surface';
  const atTarget = !!targetNode && state.locationId === targetNode.id && phase !== 'transit';
  const navOnline = state.ship.systems.nav.online;

  const orbitS = sci.observedS[body] ?? 0;
  const surfaceS = sci.observedS[`${body}:surface`] ?? 0;
  const orbitLeft = orbitS < cap - EPS;
  const surfaceLeft = surfaceS < cap - EPS;
  const canLand = !!targetNode && !state.landedIds.includes(targetNode.id) && getNodeWorld(state.seed, sector, targetNode.id, cat) !== null;
  const required = sci.requiredScience;
  const enough = sci.objectiveMet || (required > 0 ? sci.deliveredScience + sci.storedScience + EPS >= required : !orbitLeft || !surfaceLeft);
  const storageFull = sci.capacityMb > 0 && sci.storedMb >= sci.capacityMb - EPS;
  const hasData = sci.storedMb > EPS;
  const jumped = state.stats.jumps > 0 || state.transit !== null || sci.targetVisited;
  const wayTo = targetNode ?? goal;

  // 1 · Salir
  const launch: Draft = {
    id: 'launch', done: jumped, text: msg('objective.step.launch', { body }), hint: msg('objective.hint.openSolarMap'), station: 'map',
    ...(wayTo ? { target: targetOf(wayTo) } : {}),
  };
  // 2 · Llegar al destino
  const reachProgress = columnProgress(state, wayTo);
  const reach: Draft = {
    id: 'reach-target', done: sci.targetVisited, text: msg('objective.step.reachTarget', { body }),
    hint: targetNode ? msg('objective.hint.targetAhead', { body }) : msg('objective.hint.targetNextLeg'), station: 'map',
    ...(wayTo ? { target: targetOf(wayTo) } : {}),
    ...(reachProgress ? { progress: reachProgress } : {}),
  };
  // 3 · Observar
  const observe: Draft = {
    id: 'observe', done: enough, text: msg('objective.step.observe', { body, seconds: cap }), hint: msg('objective.hint.observe', { body }),
    progress: { value: floor1(Math.min(cap, Math.max(orbitS, surfaceS))), max: cap, unit: 's' },
    ...(targetNode ? { target: targetOf(targetNode) } : {}),
  };
  if (atTarget && !navOnline && (onGround ? surfaceLeft : orbitLeft)) {
    observe.situational = msg('objective.hint.navOffline');
    observe.situationalStation = 'power';
  } else if (atTarget && onGround) {
    if (!surfaceLeft) observe.situational = msg('objective.hint.observeOthers', { body });
  } else if (orbitLeft) {
    if (!atTarget && targetNode) {
      observe.situational = msg('objective.hint.backToTarget', { body });
      observe.situationalStation = 'map';
    }
  } else if (canLand && surfaceLeft) {
    observe.situational = msg('objective.hint.observeSurface', { body });
    observe.situationalStation = 'helm';
  } else observe.situational = msg('objective.hint.observeOthers', { body });
  // 4 · Bajar los datos
  const downlink: Draft = {
    id: 'downlink', done: sci.objectiveMet, text: msg('objective.step.downlink', { required }),
    progress: { value: floor1(Math.min(sci.deliveredScience, required)), max: required, unit: 'science' },
  };
  if (onGround) {
    downlink.situational = msg('objective.hint.noLinkGround');
    downlink.situationalStation = 'helm';
  } else if (!navOnline) {
    downlink.situational = msg('objective.hint.navOffline');
    downlink.situationalStation = 'power';
  } else if (storageFull && !enough) downlink.situational = msg('objective.hint.storageFull');
  else if (!sci.inRange) downlink.situational = msg('objective.hint.outOfRange');
  else if (sci.contact) downlink.situational = msg('objective.hint.contact');
  else if (!sci.inWindow) downlink.situational = msg('objective.hint.nextWindow', { seconds: Math.max(1, Math.ceil(sci.windowChangeInS - EPS)) });
  // 5 · Volver a casa
  const returnProgress = columnProgress(state, goal);
  const ret: Draft = {
    id: 'return', done: sci.over, text: msg('objective.step.return'), hint: msg('objective.hint.return'), station: 'map',
    ...(goal ? { target: targetOf(goal) } : {}),
    ...(returnProgress ? { progress: returnProgress } : {}),
  };

  const byId: Record<MissionStepId, Draft> = { launch, 'reach-target': reach, observe, downlink, return: ret };
  let currentId: MissionStepId | null;
  if (sci.over) currentId = null;
  else if (!jumped) currentId = 'launch';
  else if (!sci.targetVisited) currentId = 'reach-target';
  else if (!enough && !storageFull) currentId = 'observe';
  else if (!sci.objectiveMet && hasData) currentId = 'downlink';
  else if (!enough) currentId = 'observe';
  else currentId = 'return';

  // Misión guiada con textos propios: mismo orden lógico, textos del catálogo (claves generadas en `simLocales`).
  const mission = getMissions(cat).find((m) => m.id === design.missionId);
  const flight: GuidedFlightStep[] | undefined = mission?.guided?.flightSteps;
  let drafts: Draft[];
  if (flight && flight.length > 0) {
    drafts = flight.map((f) => {
      const generic = byId[f.check];
      return {
        ...generic,
        text: msg(`guided.${design.missionId}.${f.check}.text`, generic.text.params),
        ...(f.hint ? { hint: msg(`guided.${design.missionId}.${f.check}.hint`, generic.text.params) } : {}),
      };
    });
  } else drafts = [launch, reach, observe, downlink, ret];
  const current = currentId === null ? -1 : drafts.findIndex((d) => d.id === currentId);
  const title = msg('objective.title.mission', { mission: design.missionId, body });
  return finish('mission', state, title, drafts, current, sci.over);
}

// ─── Partida libre ────────────────────────────────────────────────────────────────────────────────

function freeObjective(state: RunState, cat: Catalog): ObjectiveView {
  const sector = state.sector;
  const goal = getNode(sector, sector.goalId);
  const here = getNode(sector, state.locationId);
  const won = state.phase === 'won';
  const exitProgress = columnProgress(state, goal);
  const exit: Draft = {
    id: 'exit', done: won, text: msg('objective.step.exit', { sector: sector.index }), hint: msg('objective.hint.exit'), station: 'map',
    ...(goal ? { target: targetOf(goal) } : {}),
    ...(exitProgress ? { progress: exitProgress } : {}),
  };
  const title = msg('objective.title.free', { sector: sector.index });
  if (sector.index > 1) return finish('free', state, title, [exit], 0, false);

  const stats = state.stats;
  const jumped = stats.jumps > 0 || state.transit !== null;
  const jump: Draft = { id: 'jump', done: jumped, text: msg('objective.step.jump'), hint: msg('objective.hint.openStarMap'), station: 'map' };

  const incident = state.incidents[0];
  const overloaded = state.ship.overloaded;
  const repair: Draft = {
    id: 'repair', optional: true, done: stats.incidentsFixed > 0,
    text: incident ? msg('objective.step.repairNow', { system: incident.systemId }) : overloaded ? msg('objective.step.overload') : msg('objective.step.repair'),
    hint: incident ? msg('objective.hint.repair') : overloaded ? msg('objective.hint.overload') : msg('objective.hint.watch'),
    ...(incident ? { station: incident.systemId } : overloaded ? { station: 'power' as const } : {}),
  };

  const isShop = (n: SectorNode) => hasShop(getNodeKind(n.kind, cat));
  const atShop = jumped && state.phase === 'docked' && !!here && isShop(here);
  const ahead = here
    ? sector.nodes.filter((n) => n.column > here.column && isShop(n)).sort((a, b) => a.column - b.column || Math.hypot(a.x - here.x, a.y - here.y) - Math.hypot(b.x - here.x, b.y - here.y))[0]
    : undefined;
  const stationDone = (stats.unitsSold ?? 0) > 0 || (stats.creditsSpent ?? 0) > 0 || state.servicedIds.length > 0;
  const station: Draft = {
    id: 'station', done: stationDone, text: msg('objective.step.station'),
    ...(atShop && here
      ? { hint: msg('objective.hint.station'), station: 'airlock' as const, target: targetOf(here) }
      : ahead
        ? { hint: msg('objective.hint.stationAhead'), station: 'map' as const, target: targetOf(ahead) }
        : { hint: msg('objective.hint.station') }),
  };

  const drafts = [jump, repair, station, exit];
  let current: number;
  if (won) current = 3;
  else if (incident || overloaded) current = 1;
  else if (!jumped) current = 0;
  else if (!stationDone && (atShop || ahead)) current = 2;
  else current = 3;
  return finish('free', state, title, drafts, current, false);
}
