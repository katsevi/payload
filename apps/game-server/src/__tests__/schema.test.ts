// Esquema Colyseus ↔ RoomStateWire: el estado que reconstruye un cliente (por reflexión, sin la clase del
// servidor) decodifica a la MISMA vista que tiene el modelo, tras cada parche; y los parches son pequeños
// (solo lo que cambia), incluido el recorte por delante del historial de eventos y de chat.
import { describe, expect, it, vi } from 'vitest';
import { Encoder, Reflection, type Decoder } from '@colyseus/schema';
import { decodeRoomView, encodeRoomView, TEAM_LIMITS, type RoomView } from '@payload/shared';
import { RoomModel } from '../roomModel';
import { createCachedEncoder, MissionState, StateWriter, syncStringArray } from '../schema';
import { buildDesign, holder, launch, loadPrototypeDesign, ok, roomInDesign, TestClock } from './helpers';

const OK = loadPrototypeDesign('ok-cubesat-leo');

/** Servidor (esquema + codificador) y "cliente" (decodificador construido por reflexión). */
function wire() {
  const state = new MissionState();
  const writer = new StateWriter(state);
  const encoder = new Encoder(state);
  let decoder: Decoder | null = null;
  return {
    state,
    encoder,
    /** Escribe la vista y entrega el parche al cliente; devuelve los bytes del parche. */
    push(view: RoomView): number {
      writer.write(view);
      if (!decoder) {
        encoder.encode();
        encoder.discardChanges();
        decoder = Reflection.decode(Reflection.encode(encoder));
        decoder.decode(encoder.encodeAll());
        return 0;
      }
      const bytes = encoder.encode();
      const size = bytes.byteLength;
      decoder.decode(bytes);
      encoder.discardChanges();
      return size;
    },
    client(): RoomView {
      return decodeRoomView((decoder!.state as unknown as { toJSON(): unknown }).toJSON());
    },
    server(): RoomView {
      return decodeRoomView(state.toJSON());
    },
    fullBytes(): number {
      return encoder.encodeAll().byteLength;
    },
  };
}

describe('esquema de la sala', () => {
  it('cubre exactamente los campos de RoomStateWire y de PlayerWire', () => {
    const m = new RoomModel({ roomId: 'r', scenarioId: OK.scenarioId });
    m.join('a', 'Ana', 0);
    m.move('a', { x: 1, y: 2, z: 3, yaw: 0.25 }, 1);
    const w = wire();
    w.push(m.view);
    const json = w.state.toJSON() as Record<string, unknown>;
    const expected = encodeRoomView(m.view);
    expect(Object.keys(json).sort()).toEqual(Object.keys(expected).sort());
    const players = json.players as Record<string, Record<string, unknown>>;
    expect(Object.keys(players.a!).sort()).toEqual(Object.keys(expected.players.a!).sort());
    expect(json).toEqual(expected);
  });

  it('una partida completa: tras cada parche, servidor y cliente decodifican la vista del modelo', () => {
    const clock = new TestClock();
    const m = new RoomModel({ roomId: 'r', scenarioId: OK.scenarioId, seed: 20260101 });
    const w = wire();
    const cached = createCachedEncoder();
    const check = (what: string) => {
      // El codificador con caché da EXACTAMENTE lo mismo que encodeRoomView de shared.
      expect(cached(m.view), what).toEqual(encodeRoomView(m.view));
      w.push(m.view);
      expect(w.server(), what).toEqual(m.view);
      expect(w.client(), what).toEqual(m.view);
    };
    check('inicial');
    roomInDesign(m, 4, clock);
    check('diseño');
    m.move('p2', { x: 0.5, y: 0, z: -1.25, yaw: 3.1 }, clock.advance(1));
    check('pose');
    buildDesign(m, OK, clock);
    check('diseño hecho');
    m.apply('p1', { type: 'add-component', componentId: 'payload-thermal-camera' }, clock.advance(1)); // director: sin permiso (rechazo)
    ok(m, holder(m, 'science'), { type: 'add-component', componentId: 'payload-thermal-camera' }, clock.advance(1));
    check('solicitud abierta');
    m.apply(holder(m, 'science'), { type: 'remove-component', componentId: 'payload-thermal-camera' }, clock.advance(1));
    check('quitar pieza ausente (rechazo, sin cambios)');
    for (let i = 0; i < TEAM_LIMITS.chatHistory + 7; i++) {
      ok(m, `p${(i % 4) + 1}`, { type: 'chat', text: `mensaje ${i}` }, clock.advance(TEAM_LIMITS.chatMinIntervalS));
      check(`chat ${i}`);
    }
    m.drop('p3', clock.advance(1));
    check('caída');
    m.reconnect('p3', clock.advance(1));
    check('vuelta');
    for (const r of m.view.requests.filter((x) => x.status === 'open')) ok(m, holder(m, r.toRole), { type: 'resolve-request', requestId: r.id, approve: false }, clock.advance(1));
    check('solicitudes rechazadas');
    launch(m, clock);
    check('lanzamiento');
    ok(m, holder(m, 'director'), { type: 'set-time-scale', accel: 10000 }, clock.advance(1));
    let trimmed = false;
    for (let i = 0; i < 2000 && m.view.phase === 'operation'; i++) {
      const open = m.view.alerts.find((a) => a.closedAtS === null);
      if (open) for (const role of open.requiredRoles) ok(m, holder(m, role), { type: 'ack-alert', alertId: open.id, role }, clock.advance(1));
      m.tick(0.25, clock.advance(0.25));
      if (m.view.events.length === TEAM_LIMITS.eventHistory) trimmed = true;
      check(`tick ${i}`);
    }
    expect(trimmed).toBe(true);
    expect(m.view.phase).toBe('report');
    check('informe');
    ok(m, holder(m, 'director'), { type: 'redesign' }, clock.advance(1));
    check('rediseño');
    m.leave('p1', clock.advance(1));
    check('salida del anfitrión');
  });

  it('caché de JSON por referencia: en el informe, un mensaje de chat no vuelve a serializar el resultado ni los eventos', () => {
    const clock = new TestClock();
    const m = new RoomModel({ roomId: 'r', scenarioId: OK.scenarioId, seed: 20260101 });
    roomInDesign(m, 2, clock);
    buildDesign(m, OK, clock);
    launch(m, clock);
    if (m.view.phase === 'operation') ok(m, holder(m, 'director'), { type: 'finish-operation' }, clock.advance(1));
    expect(m.view.phase).toBe('report');
    const w = wire();
    w.push(m.view);
    const result = m.view.result!;
    const events = new Set<object>(m.view.events);
    const spy = vi.spyOn(JSON, 'stringify');
    try {
      ok(m, 'p1', { type: 'chat', text: 'buen trabajo' }, clock.advance(1));
      w.push(m.view);
      const serialized = spy.mock.calls.map((c) => c[0]);
      expect(serialized).not.toContain(result);
      expect(serialized.some((x) => typeof x === 'object' && x !== null && events.has(x))).toBe(false);
      expect(serialized).toContain(m.view.chat.at(-1)); // lo nuevo sí
    } finally {
      spy.mockRestore();
    }
    expect(w.client()).toEqual(m.view);
  });

  it('deltas pequeños: añadir un evento a un historial lleno o un mensaje de chat no reenvía la lista', () => {
    const clock = new TestClock();
    const m = new RoomModel({ roomId: 'r', scenarioId: OK.scenarioId, seed: 20260101 });
    roomInDesign(m, 2, clock);
    buildDesign(m, OK, clock);
    launch(m, clock);
    const w = wire();
    w.push(m.view);
    ok(m, holder(m, 'director'), { type: 'set-time-scale', accel: 100 }, clock.advance(1));
    while (m.view.events.length < TEAM_LIMITS.eventHistory) {
      const open = m.view.alerts.find((a) => a.closedAtS === null);
      if (open) for (const role of open.requiredRoles) ok(m, holder(m, role), { type: 'ack-alert', alertId: open.id, role }, clock.advance(1));
      m.tick(1, clock.advance(1));
      w.push(m.view);
    }
    const full = w.fullBytes();
    // Un tick que añade un evento (y recorta el más antiguo) cuesta una fracción del estado completo.
    let tickBytes = 0;
    for (let i = 0; i < 500 && tickBytes === 0; i++) {
      const before = m.view.events.at(-1);
      m.tick(1, clock.advance(1));
      const size = w.push(m.view);
      if (m.view.events.at(-1) !== before) tickBytes = size;
    }
    expect(tickBytes).toBeGreaterThan(0);
    expect(tickBytes).toBeLessThan(full / 5);
    expect(w.client()).toEqual(m.view);
    // Escribir la misma vista no genera cambios.
    w.push(m.view);
    expect(w.encoder.hasChanges).toBe(false);
    // Un mensaje de chat: el parche ocupa poco más que el propio mensaje.
    ok(m, 'p1', { type: 'chat', text: 'hola' }, clock.advance(1));
    const chatBytes = w.push(m.view);
    expect(chatBytes).toBeLessThan(JSON.stringify(m.view.chat.at(-1)).length + 200);
  });

  it('syncStringArray: recorte por delante, cambios por índice, añadir y quitar', () => {
    const w = wire();
    const m = new RoomModel({ roomId: 'r', scenarioId: OK.scenarioId });
    w.push(m.view);
    const arr = w.state.events;
    const cases: string[][] = [
      ['a', 'b', 'c'], ['a', 'b', 'c', 'd'], ['c', 'd', 'e'], ['c', 'X', 'e', 'f'], [], ['z'], ['z', 'z', 'y'], ['z', 'y', 'x'], ['q'],
    ];
    for (const next of cases) {
      syncStringArray(arr, next);
      expect(arr.toJSON()).toEqual(next);
    }
  });
});
