// Abuso: cuatro jugadores mandan acciones a 40 msg/s (el tope de Colyseus por cliente, MAX_MESSAGES_PER_SECOND)
// durante 60 s simulados: solicitudes con notas largas (que un cómplice resuelve al instante), piezas, votos
// repetidos, chat, pings y poses. El estado sincronizado debe quedar ACOTADO (antes del arreglo, 2400
// solicitudes ocupaban 1,48 MB). Y 30 min simulados de pedir y retirar / rechazar con nota: el historial de
// solicitudes se purga (`purgeRequests`, `requestHistory` cerradas) sin cambiar la colaboración.
import { describe, expect, it } from 'vitest';
import { encodeRoomView, TEAM_LIMITS, TEAM_ROLES, type TeamAction, type TeamRole } from '@payload/shared';
import { MAX_MESSAGES_PER_SECOND } from '../MissionRoom';
import { RoomModel } from '../roomModel';
import { buildDesign, holder, launch, loadPrototypeDesign, ok, roomInDesign, TestClock } from './helpers';

const OK = loadPrototypeDesign('ok-cubesat-leo');
const LIMIT_BYTES = 300 * 1024;
const SPAM_S = 60;
/** Sesión larga de solicitudes: 30 minutos simulados. */
const LONG_S = 30 * 60;
const NOTE = 'x'.repeat(TEAM_LIMITS.noteMaxChars);
const TEXT = 'y'.repeat(TEAM_LIMITS.chatMaxChars);
/** Una pieza que puede montar cada rol (Dirección no monta piezas). */
const PIECE: Record<TeamRole, string | null> = {
  director: null, engineering: 'battery-small', science: 'payload-multispectral-basic', operations: 'comms-s-band',
};

const wireBytes = (m: RoomModel) => JSON.stringify(encodeRoomView(m.view)).length;

/** `SPAM_S` segundos a `MAX_MESSAGES_PER_SECOND` por jugador; `pick(i, playerId)` elige cada mensaje. */
function spam(m: RoomModel, clock: TestClock, pick: (i: number, playerId: string) => TeamAction | null): number {
  const dt = 1 / MAX_MESSAGES_PER_SECOND;
  let sent = 0;
  for (let i = 0; i < SPAM_S * MAX_MESSAGES_PER_SECOND; i++) {
    const now = clock.advance(dt);
    for (const p of m.view.players) {
      const action = pick(i, p.id);
      if (action) {
        m.apply(p.id, action, now);
        sent++;
      } else {
        m.move(p.id, { x: i % 7, y: 0, z: i % 5, yaw: i / 100 }, now);
      }
    }
    m.tick(dt, now);
  }
  return sent;
}

describe('límites anti-abuso', () => {
  it(`spam en diseño (solicitudes resueltas al instante, piezas, chat, pings): el estado queda < ${LIMIT_BYTES / 1024} KB`, () => {
    const clock = new TestClock();
    const m = new RoomModel({ roomId: 'abuso', scenarioId: OK.scenarioId });
    roomInDesign(m, 4, clock);
    const director = holder(m, 'director');
    const sent = spam(m, clock, (i, id) => {
      const roles = m.player(id)!.roles;
      // Dirección (cómplice) rechaza al momento lo que le piden: así las solicitudes se cierran y caben más.
      if (id === director) {
        const open = m.view.requests.find((r) => r.status === 'open' && roles.includes(r.toRole));
        return open ? { type: 'resolve-request', requestId: open.id, approve: false, note: NOTE } : { type: 'chat', text: TEXT };
      }
      const piece = PIECE[roles[0]!];
      switch (i % 5) {
        case 0: return { type: 'request-resource', resource: 'budget', amount: 1 + (i % 9), note: NOTE };
        case 1: return piece ? { type: 'add-component', componentId: piece } : null;
        case 2: return { type: 'chat', text: TEXT };
        case 3: return { type: 'ping', target: { kind: 'subsystem', id: 'power' } };
        default: return null; // move
      }
    });
    expect(sent).toBeGreaterThan(SPAM_S * MAX_MESSAGES_PER_SECOND * 3);
    const v = m.view;
    // Cada lista está acotada por una regla del juego.
    expect(v.design.componentIds.length).toBeLessThanOrEqual(TEAM_LIMITS.maxComponents);
    expect(v.chat.length).toBeLessThanOrEqual(TEAM_LIMITS.chatHistory);
    for (const p of v.players) {
      expect(v.requests.filter((r) => r.status === 'open' && r.fromPlayerId === p.id).length).toBeLessThanOrEqual(TEAM_LIMITS.maxOpenRequestsPerPlayer);
      expect(v.requests.filter((r) => r.fromPlayerId === p.id).length).toBeLessThanOrEqual(TEAM_LIMITS.requestBurst + SPAM_S / TEAM_LIMITS.requestMinIntervalS);
    }
    expect(wireBytes(m)).toBeLessThan(LIMIT_BYTES);
  });

  it('spam de votos en la revisión: un voto por rol, el estado no crece', () => {
    const clock = new TestClock();
    const m = new RoomModel({ roomId: 'abuso', scenarioId: OK.scenarioId });
    roomInDesign(m, 4, clock);
    buildDesign(m, OK, clock);
    ok(m, 'p1', { type: 'request-review' }, clock.advance(1));
    expect(m.view.phase).toBe('review');
    const holdout = holder(m, 'operations'); // no vota: la votación sigue abierta todo el rato
    const before = wireBytes(m);
    spam(m, clock, (i, id) => {
      if (id === holdout) return i % 2 === 0 ? { type: 'chat', text: TEXT } : null;
      const role = m.player(id)!.roles[0]!;
      return { type: 'vote', role, value: 'go' };
    });
    expect(m.view.phase).toBe('review');
    expect(m.view.votes).toHaveLength(TEAM_ROLES.length - 1);
    expect(new Set(m.view.votes.map((x) => x.role)).size).toBe(m.view.votes.length);
    // Solo crece el chat (acotado a chatHistory).
    expect(wireBytes(m) - before).toBeLessThan(TEAM_LIMITS.chatHistory * (TEAM_LIMITS.chatMaxChars + 200));
    expect(wireBytes(m)).toBeLessThan(LIMIT_BYTES);
  });

  /**
   * Sesión larga de pedir y cerrar: los 3 jugadores sin Dirección piden presupuesto (con nota larga) cada
   * segundo y la cubeta deja pasar ~1 cada requestMinIntervalS; cada solicitud se cierra al momento (la retira
   * su autor o la rechaza Dirección con otra nota larga). Luego se termina la misión para tener la colaboración.
   * `requestHistory` = Infinity desactiva la purga (referencia para comparar).
   */
  function longSession(close: 'withdraw' | 'reject', requestHistory?: number) {
    const clock = new TestClock();
    const m = new RoomModel({ roomId: 'larga', scenarioId: OK.scenarioId, seed: 20260101, ...(requestHistory !== undefined ? { requestHistory } : {}) });
    roomInDesign(m, 4, clock);
    const director = holder(m, 'director');
    const askers = m.view.players.filter((p) => p.id !== director).map((p) => p.id);
    let created = 0;
    let maxBytes = 0;
    for (let s = 0; s < LONG_S; s++) {
      const now = clock.advance(1);
      for (const id of askers) {
        const out = m.apply(id, { type: 'request-resource', resource: 'budget', amount: 1 + (s % 7), note: NOTE }, now);
        if (out.some((o) => o.notice.kind === 'request-created')) created++;
      }
      for (const r of m.view.requests.filter((x) => x.status === 'open')) {
        if (close === 'withdraw') m.apply(r.fromPlayerId, { type: 'withdraw-request', requestId: r.id }, now);
        else m.apply(director, { type: 'resolve-request', requestId: r.id, approve: false, note: NOTE }, now);
      }
      if (s % 60 === 0) maxBytes = Math.max(maxBytes, wireBytes(m));
    }
    maxBytes = Math.max(maxBytes, wireBytes(m));
    buildDesign(m, OK, clock);
    launch(m, clock);
    if (m.view.phase === 'operation') ok(m, holder(m, 'director'), { type: 'finish-operation' }, clock.advance(1));
    expect(m.view.phase).toBe('report');
    return { m, created, maxBytes, reportBytes: wireBytes(m) };
  }

  for (const close of ['withdraw', 'reject'] as const) {
    const verb = close === 'withdraw' ? 'retirando' : 'rechazando con nota';
    it(`30 min pidiendo y ${verb} (3 jugadores): historial acotado y colaboración idéntica a la de la lista completa`, () => {
      const purged = longSession(close);
      const full = longSession(close, Number.POSITIVE_INFINITY);
      // La cubeta deja pasar unas LONG_S / requestMinIntervalS por jugador (+ la ráfaga inicial).
      expect(purged.created).toBe(full.created);
      expect(purged.created).toBeGreaterThan(3 * (LONG_S / TEAM_LIMITS.requestMinIntervalS) * 0.9);
      expect(purged.created).toBeLessThanOrEqual(3 * (LONG_S / TEAM_LIMITS.requestMinIntervalS + TEAM_LIMITS.requestBurst));
      // Con purga: como mucho requestHistory cerradas (más las abiertas) y el estado acotado.
      expect(purged.m.view.requests.filter((r) => r.status !== 'open').length).toBeLessThanOrEqual(TEAM_LIMITS.requestHistory);
      expect(purged.maxBytes).toBeLessThan(LIMIT_BYTES);
      // Sin purga el estado se dispararía (esto es lo que el arreglo evita).
      expect(full.maxBytes).toBeGreaterThan(LIMIT_BYTES);
      // La colaboración (y la nota de equipo) es EXACTAMENTE la misma que sin purgar.
      expect(purged.m.view.collaboration).toStrictEqual(full.m.view.collaboration);
      expect(purged.m.view.teamScore).toStrictEqual(full.m.view.teamScore);
      expect(purged.m.view.result).toStrictEqual(full.m.view.result);
    });
  }
});
