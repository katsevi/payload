/**
 * SOLO DESARROLLO: sala de ejemplo sin servidor para revisar la UI de equipo en el navegador.
 *   ?room=demo&phase=lobby|briefing|design|review|prelaunch|operation|report[&role=director|engineering|science|operations]
 * Inyecta un `RoomView` de ejemplo en `useRoom` (3 jugadores, solicitudes, votos, una alerta abierta, chat,
 * pings y, en `report`, un `result` real de `runMission`). Las acciones no llegan a ningún sitio: no hay sala real.
 */
import {
  catalog, componentsForScenario, createRoomView, reviewGoNoGo, runMission, type MissionDesign, type OrbitId, type RoomPhase, type RoomView,
  type ResourceRequest, type SubsystemId, type TeamPlayer, type TeamRole,
} from '@payload/shared';
import { useDesign } from '../state/design';
import { useSim } from '../state/sim';
import { INITIAL_ROOM_STATE, PING_TTL_MS, useRoom } from '../net/roomStore';
import { roomScenarios } from '../ui/catalogViews';
import { ROLE_ORDER, defaultRoomScenario } from './roomUiLogic';

const PHASES: RoomPhase[] = ['lobby', 'briefing', 'design', 'review', 'prelaunch', 'launch', 'operation', 'report'];
const NOW_S = 300;

function demoDesign(scenarioId: string): MissionDesign {
  const sc = catalog.scenarios.find((s) => s.id === scenarioId)!;
  const comps = componentsForScenario(scenarioId, catalog);
  const by = (s: SubsystemId) => comps.filter((c) => c.subsystem === s);
  const subs: SubsystemId[] = ['power', 'battery', 'comms', 'obc', 'adcs', 'thermal'];
  let fallback: MissionDesign | null = null;
  for (const st of by('structure')) {
    for (const orbitId of sc.allowedOrbits as OrbitId[]) {
      for (const launcherId of sc.allowedLaunchers) {
        for (const pl of by('payload')) {
          const ids = [st.id, ...subs.map((s) => by(s)[0]?.id).filter((x): x is string => !!x), pl.id];
          const d: MissionDesign = { scenarioId, componentIds: ids, orbitId, launcherId };
          fallback ??= d;
          try {
            if (reviewGoNoGo(d, catalog).go) return d;
          } catch {
            /* siguiente */
          }
        }
      }
    }
  }
  return fallback ?? { scenarioId, componentIds: [], orbitId: null, launcherId: null };
}

/** Vista de ejemplo para una fase y mi rol. Pura (sin stores): la usa `startDevRoom` y se puede probar. */
export function demoRoomView(phase: RoomPhase, myRole: TeamRole = 'director', scenarioId?: string): RoomView {
  const sid = scenarioId ?? defaultRoomScenario(roomScenarios());
  const sc = catalog.scenarios.find((s) => s.id === sid)!;
  const rest = ROLE_ORDER.filter((r) => r !== myRole);
  const players: TeamPlayer[] = [
    { id: 'me', name: 'Ana', roles: [myRole], connected: true, isHost: true, pose: { x: 0, y: 0, z: 9, yaw: Math.PI } },
    { id: 'beto', name: 'Beto', roles: rest.slice(0, 2), connected: true, isHost: false, pose: { x: -3, y: 0, z: 4, yaw: 0.6 } },
    { id: 'carla', name: '', roles: phase === 'lobby' ? [] : rest.slice(2), connected: true, isHost: false, pose: { x: 3.5, y: 0, z: 5, yaw: -0.8 } },
  ];
  const design = phase === 'lobby' || phase === 'briefing' ? { scenarioId: sid, componentIds: [], orbitId: null, launcherId: null } : demoDesign(sid);
  const payload = design.componentIds.find((id) => catalog.components.find((c) => c.id === id)?.subsystem === 'payload');
  const requests: ResourceRequest[] = phase === 'design' || phase === 'review' || phase === 'operation' || phase === 'report'
    ? [
        {
          id: 'r1', fromPlayerId: 'carla', fromRole: rest[2] ?? 'science', toRole: 'engineering', resource: 'power', amount: 40,
          ...(payload ? { componentId: payload } : {}), note: 'Necesitamos más resolución', status: 'open', createdAtS: NOW_S - 40,
          why: { key: 'team.request.resourceUp', params: { amount: 40, unit: 'W', resource: 'power', before: 'ok', after: 'tight', toRole: 'engineering' } },
        },
        {
          id: 'r2', fromPlayerId: 'beto', fromRole: 'operations', toRole: 'director', resource: 'budget', subsystem: 'comms', amount: 1.5,
          status: 'open', createdAtS: NOW_S - 100, approvedBy: ['engineering'],
          why: { key: 'team.request.explicitSubsystemAmount', params: { fromRole: 'operations', amount: 1.5, unit: 'MUSD', resource: 'budget', subsystem: 'comms' } },
        },
        {
          id: 'r3', fromPlayerId: 'me', fromRole: myRole, toRole: 'operations', resource: 'comms', status: 'approved', createdAtS: NOW_S - 220, resolvedAtS: NOW_S - 190,
          resolvedByPlayerId: 'beto', resolutionNote: 'Hecho, sube el enlace',
          why: { key: 'team.request.explicit', params: { fromRole: myRole, resource: 'comms', toRole: 'operations' } },
        },
      ]
    : [];
  const base = createRoomView({ roomId: 'DEMO42', scenarioId: sid, attempt: 0, seed: sc.defaultSeed });
  const view: RoomView = {
    ...base,
    phase,
    hostId: 'me',
    players,
    design,
    requests,
    allocation: phase === 'design' || phase === 'review' ? { structure: 4, power: 4, battery: 3, comms: 3, obc: 2, adcs: 3, thermal: 2, payload: 6 } : null,
    votes: phase === 'review'
      ? [
          { role: 'director', playerId: 'me', value: 'go', atS: NOW_S - 20 },
          { role: 'operations', playerId: 'beto', value: 'go', atS: NOW_S - 10 },
        ]
      : [],
    chat: phase === 'lobby'
      ? []
      : [
          { id: 'c1', playerId: 'beto', name: 'Beto', roles: rest.slice(0, 2), text: '¿Subimos la antena o bajamos la banda?', atS: NOW_S - 90 },
          { id: 'c2', playerId: 'me', name: 'Ana', roles: [myRole], text: 'Mejor mirar primero la energía.', atS: NOW_S - 60 },
          { id: 'c3', playerId: 'carla', name: 'Jugador 3', roles: rest.slice(2), text: 'Pido 40 W para el instrumento.', atS: NOW_S - 40 },
        ],
    alerts: phase === 'operation'
      ? [
          {
            id: 'a1', event: { type: 'solar-storm', tSeconds: 86400 * 3, message: { key: 'event.solarStorm', params: { pct: 30, hours: 12 } } },
            requiredRoles: ['engineering', 'operations'], acks: [{ role: 'operations', playerId: 'beto', atS: NOW_S - 6 }], raisedAtS: NOW_S - 12, closedAtS: null, timedOut: false,
          },
        ]
      : [],
    sim: { ...base.sim, paused: phase === 'operation', accel: 100 },
  };
  if (phase === 'report') {
    const result = runMission(design, catalog, { seed: sc.defaultSeed });
    view.result = result;
    view.collaboration = {
      score: 82, requestsTotal: 3, requestsResolved: 2, avgRequestResponseS: 42, alertsTotal: 1, alertAcksExpected: 2, alertAcksOnTime: 2,
      avgAlertResponseS: 14, criteria: { requests: 0.8, alerts: 0.85 },
    };
    view.teamScore = { ...result.score, collaboration: 82, total: Math.round((result.score.total + 82) / 2) };
  }
  return view;
}

/** Si la URL pide `?room=demo`, inyecta la sala de ejemplo. Devuelve la limpieza (para el efecto de React). */
export function startDevRoom(): () => void {
  if (!import.meta.env.DEV || typeof location === 'undefined') return () => undefined;
  const q = new URLSearchParams(location.search);
  if (q.get('room') !== 'demo') return () => undefined;
  const phase = (PHASES as string[]).includes(q.get('phase') ?? '') ? (q.get('phase') as RoomPhase) : 'lobby';
  const roleParam = q.get('role');
  const role = (ROLE_ORDER as readonly string[]).includes(roleParam ?? '') ? (roleParam as TeamRole) : 'director';
  const view = demoRoomView(phase, role);
  // Estado de diseño y simulación que leen las escenas y paneles.
  const d = useDesign.getState();
  d.startScenario(view.scenarioId);
  view.design.componentIds.forEach((id) => d.add(id));
  d.setOrbit(view.design.orbitId);
  d.setLauncher(view.design.launcherId);
  if (phase === 'operation') useSim.getState().start(view.design, 0);
  if (view.result) useSim.getState().setResult(view.result);
  const mark = (id: number, playerId: string, r: TeamRole, target: import('@payload/shared').PingTarget) => {
    const now = performance.now();
    return { id, playerId, role: r, target, atS: NOW_S, receivedAtMs: now, expiresAtMs: now + PING_TTL_MS };
  };
  useRoom.setState({ ...INITIAL_ROOM_STATE, status: 'connected', view, myId: 'me', myRoles: [role], isHost: true, roomCode: view.roomId });
  let n = 0;
  const targets = [
    () => mark(++n, 'beto', 'operations', { kind: 'subsystem', id: 'comms' }),
    () => mark(++n, 'carla', 'science', { kind: 'point', position: [1, 1.6, 0] }),
    () => mark(++n, 'beto', 'operations', { kind: 'resource', id: 'power' }),
  ];
  const fire = () => {
    const m = targets[n % targets.length]!();
    useRoom.setState((s) => ({ pings: [...s.pings.filter((p) => p.expiresAtMs > performance.now()), m] }));
  };
  fire();
  const id = window.setInterval(fire, 8000);
  return () => {
    window.clearInterval(id);
  };
}
