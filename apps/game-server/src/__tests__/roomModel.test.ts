// Modelo puro de la sala: lobby, roles, paridad con el motor, antiabuso y presencia.
import { describe, expect, it } from 'vitest';
import {
  catalog, createRun, currentObjective, designEditsBetween, FIXED_STEP_S, getMission, getNode, guidedStartDesign, MAX_WORK_SECONDS, parseCatalog, reviewDesign,
  type Catalog, type RoleId, type Run, type RunAction,
} from '@payload/shared';
import { referenceDesign } from '../../../../packages/shared/src/__tests__/missionFixtures';
import { RoomModel } from '../roomModel';

const SEED = 7;
const newRoom = (): RoomModel => new RoomModel({ code: 'TEST', nextSeed: () => SEED });

/** Sala con `roles.length` jugadores (p1..pn), cada uno con su rol, ya en partida. */
function playing(roles: (RoleId | null)[]): RoomModel {
  const room = newRoom();
  roles.forEach((role, i) => {
    expect(room.join(`p${i + 1}`, `Jugador ${i + 1}`)).toEqual({ ok: true });
    if (role) expect(room.lobby(`p${i + 1}`, { type: 'set-role', role })).toBe(true);
    if (i > 0) room.lobby(`p${i + 1}`, { type: 'set-ready', ready: true });
  });
  expect(room.lobby('p1', { type: 'start' })).toBe(true);
  expect(room.phase).toBe('playing');
  return room;
}

const firstLink = (run: Run): string => getNode(run.state.sector, run.state.locationId)!.links[0]!;

describe('lobby', () => {
  it('el primero es anfitrión; como mucho cuatro jugadores', () => {
    const room = newRoom();
    for (let i = 1; i <= 4; i++) expect(room.join(`p${i}`, `J${i}`)).toEqual({ ok: true });
    expect(room.join('p5', 'J5')).toEqual({ ok: false, code: 'room-full' });
    expect(room.view.players.map((p) => p.host)).toEqual([true, false, false, false]);
    expect(room.view.code).toBe('TEST');
  });

  it('los roles son únicos y opcionales', () => {
    const room = newRoom();
    room.join('p1', 'A');
    room.join('p2', 'B');
    expect(room.lobby('p1', { type: 'set-role', role: 'pilot' })).toBe(true);
    expect(room.lobby('p2', { type: 'set-role', role: 'pilot' })).toBe(false);
    expect(room.lobby('p1', { type: 'set-role', role: null })).toBe(true);
    expect(room.lobby('p2', { type: 'set-role', role: 'pilot' })).toBe(true);
    expect(room.view.players.map((p) => p.role)).toEqual([null, 'pilot']);
  });

  it('solo el anfitrión empieza, y con los demás listos', () => {
    const room = newRoom();
    room.join('p1', 'A');
    room.join('p2', 'B');
    expect(room.lobby('p2', { type: 'start' })).toBe(false);
    expect(room.lobby('p1', { type: 'start' })).toBe(false);
    room.lobby('p2', { type: 'set-ready', ready: true });
    expect(room.lobby('p1', { type: 'start' })).toBe(true);
    expect(room.view.players.map((p) => p.crewId)).toEqual([1, 2]);
    expect(room.run!.state.crew).toHaveLength(2);
    expect(room.join('p3', 'C')).toEqual({ ok: false, code: 'in-progress' });
  });

  it('si el anfitrión se va, pasa al siguiente', () => {
    const room = newRoom();
    room.join('p1', 'A');
    room.join('p2', 'B');
    room.leave('p1');
    expect(room.view.players).toHaveLength(1);
    expect(room.view.players[0]).toMatchObject({ id: 'p2', host: true });
  });

  it('el anfitrión sigue siéndolo aunque se caiga; solo pasa a otro si se va del todo', () => {
    const room = newRoom();
    room.join('p1', 'A');
    room.join('p2', 'B');
    room.lobby('p2', { type: 'set-ready', ready: true });
    room.drop('p1');
    expect(room.view.players.map((p) => p.host)).toEqual([true, false]);
    // Nadie más puede empezar mientras el anfitrión está caído.
    expect(room.lobby('p2', { type: 'start' })).toBe(false);
    room.reconnect('p1');
    expect(room.host).toBe('p1');
    expect(room.lobby('p1', { type: 'start' })).toBe(true);
  });

  it('el dueño que vuelve a entrar con su clave recupera el anfitrión; otra clave no', () => {
    const room = newRoom();
    expect(room.join('p1', 'A', 'clave-del-duenyo')).toEqual({ ok: true });
    room.join('p2', 'B', 'clave-de-beto-01');
    room.leave('p1');
    expect(room.host).toBe('p2');
    room.join('p3', 'C', 'clave-de-otro-02');
    expect(room.host).toBe('p2');
    room.join('p4', 'A', 'clave-del-duenyo');
    expect(room.host).toBe('p4');
    // Una clave con forma inválida se ignora.
    const other = newRoom();
    other.join('q1', 'A', 'x');
    other.leave('q1');
    other.join('q2', 'B');
    other.join('q3', 'A', 'x');
    expect(other.host).toBe('q2');
  });

  it('una persona sola puede jugar en sala', () => {
    const room = playing([null]);
    expect(room.run!.state.crew).toHaveLength(1);
    expect(room.run!.state.crew[0]!.role).toBeUndefined();
  });
});

describe('paridad con el motor', () => {
  it('la sala produce el mismo estado que el motor con las mismas acciones en los mismos pasos', () => {
    const roles: RoleId[] = ['pilot', 'engineer', 'manager', 'explorer'];
    const room = playing(roles);
    const engine = createRun({ seed: SEED, crewSize: 4, roles });
    const roomEvents: unknown[] = [];
    const engineEvents: unknown[] = [];
    let nowS = 0;

    /** Aplica en la sala (con el jugador `who`) y en el motor (con su `crewId`, como hace el servidor). */
    const both = (who: number, action: RunAction, crewAction: boolean): void => {
      const rejected = room.action(`p${who}`, { seq: 1, action }, nowS);
      const result = engine.apply(crewAction ? ({ ...action, crewId: who } as RunAction) : action);
      expect(rejected === null).toBe(result.ok);
    };
    const step = (): void => {
      nowS += FIXED_STEP_S;
      roomEvents.push(...room.advance(FIXED_STEP_S).events);
      engine.step(FIXED_STEP_S);
      engineEvents.push(...engine.takeEvents());
    };

    for (let jumps = 0; jumps < 3 && engine.state.phase !== 'lost'; jumps++) {
      both(3, { type: 'jump', toId: firstLink(engine) }, false);
      both(1, { type: 'set-throttle', throttle: 'burn' }, false);
      for (let i = 0; i < 4000 && engine.state.phase === 'transit'; i++) {
        const inc = engine.state.incidents[0];
        if (inc) both(2, { type: 'work-incident', incidentId: inc.id, seconds: FIXED_STEP_S }, true);
        if (engine.state.warnings.some((w) => !w.evaded)) both(1, { type: 'evade', grazes: 1 }, true);
        const damaged = (['engines', 'reactor', 'shields'] as const).find((s) => engine.state.ship.systems[s].healthPct < 60);
        if (damaged && i % 2 === 0) both(4, { type: 'repair-system', systemId: damaged, seconds: FIXED_STEP_S }, true);
        step();
      }
      both(3, { type: 'service' }, false);
      for (let i = 0; i < 20; i++) step();
    }

    expect(engine.state.stats.jumps).toBeGreaterThan(0);
    expect(room.run!.snapshot()).toEqual(engine.snapshot());
    expect(roomEvents).toEqual(engineEvents);
    expect(room.tick).toBe(Math.round(engine.state.stats.timeS / FIXED_STEP_S));
  });

  it('trocear el tiempo real de otra forma no cambia la partida', () => {
    const a = playing(['pilot']);
    const b = playing(['pilot']);
    for (const room of [a, b]) room.action('p1', { seq: 1, action: { type: 'jump', toId: firstLink(room.run!) } }, 0);
    for (let i = 0; i < 300; i++) a.advance(0.1);
    for (let i = 0; i < 100; i++) {
      b.advance(0.033);
      b.advance(0.167);
      b.advance(0.1);
    }
    expect(b.run!.snapshot()).toEqual(a.run!.snapshot());
  });
});

describe('autoridad y antiabuso', () => {
  it('impone el tripulante de quien envía la acción', () => {
    const room = playing([null, null]);
    const run = room.run!;
    // p2 intenta mover al tripulante 1: el servidor lo cambia por el suyo (y fuera de la superficie se rechaza).
    const rejected = room.action('p2', { seq: 9, action: { type: 'eva-exit', crewId: 1 } }, 0);
    expect(rejected?.seq).toBe(9);
    expect(run.state.crew.every((c) => c.location === 'ship')).toBe(true);
  });

  it('el trabajo mantenido no suma más que el tiempo real', () => {
    const room = playing(['engineer']);
    const run = room.run!;
    room.action('p1', { seq: 1, action: { type: 'jump', toId: firstLink(run) } }, 0);
    let nowS = 0;
    for (let i = 0; i < 6000 && run.state.incidents.length === 0 && run.state.phase === 'transit'; i++) {
      nowS += FIXED_STEP_S;
      room.advance(FIXED_STEP_S);
    }
    const inc = run.state.incidents[0];
    if (!inc) return; // semilla sin averías en este salto: nada que medir
    const before = inc.progress;
    // 100 mensajes en el mismo instante pidiendo el máximo: solo cuenta el presupuesto acumulado.
    for (let i = 0; i < 100; i++) room.action('p1', { seq: i, action: { type: 'work-incident', incidentId: inc.id, seconds: MAX_WORK_SECONDS } }, nowS);
    const after = run.state.incidents.find((x) => x.id === inc.id)?.progress ?? 1;
    const engineerMult = 1.3;
    const maxGain = (MAX_WORK_SECONDS * engineerMult) / run.catalog.hazards.incidents[inc.kind].repairS;
    expect(after - before).toBeLessThanOrEqual(maxGain + 1e-9);
  });

  it('una acción con forma imposible no tira la sala', () => {
    const room = playing([null]);
    expect(room.action('p1', { seq: 1, action: { type: 'jump', toId: { evil: true } } }, 0)).not.toBeNull();
    expect(room.action('p1', { seq: 2, action: { type: 'sell', materialId: 42 } }, 0)).not.toBeNull();
    expect(room.action('p1', 'x', 0)).toBeNull();
    expect(room.action('nadie', { seq: 1, action: { type: 'land' } }, 0)).toBeNull();
    expect(room.run!.state.phase).toBe('docked');
  });
});

describe('cordura (fase 8)', () => {
  const psychCat = (): Catalog => parseCatalog({ ...JSON.parse(JSON.stringify(catalog)), psych: { ...JSON.parse(JSON.stringify(catalog.psych)), enabled: true } });
  function psychRoom(): RoomModel {
    const room = new RoomModel({ code: 'PSY', nextSeed: () => SEED, catalog: psychCat() });
    room.join('p1', 'Uno');
    room.join('p2', 'Dos');
    room.lobby('p2', { type: 'set-ready', ready: true });
    expect(room.lobby('p1', { type: 'start' })).toBe(true);
    return room;
  }

  it('rest y call-earth llevan el crewId del servidor y su `seconds` entra en el presupuesto de trabajo', () => {
    const room = psychRoom();
    const run = room.run!;
    for (const c of run.state.crew) c.sanityPct = 50;
    // p2 intenta descansar con el tripulante 1: el servidor impone el 2. 100 mensajes en el mismo instante: solo cuenta el presupuesto.
    for (let i = 0; i < 100; i++) room.action('p2', { seq: i, action: { type: 'rest', seconds: MAX_WORK_SECONDS, crewId: 1 } }, 0);
    const [a, b] = run.state.crew;
    expect(a!.sanityPct).toBe(50);
    const gain = b!.sanityPct! - 50;
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeLessThanOrEqual(MAX_WORK_SECONDS * run.catalog.psych!.rest.recoverPctPerS + 1e-9);
    expect(room.action('p1', { seq: 1, action: { type: 'call-earth', seconds: MAX_WORK_SECONDS, crewId: 2 } }, 1)).toBeNull();
    expect(run.state.crew[0]!.callProgressS).toBeGreaterThan(0);
    expect(run.state.crew[1]!.callProgressS).toBe(0);
  });

  it('buy-provisions no lleva tripulante y la cordura viaja por snapshot e hydrate', () => {
    const room = psychRoom();
    const run = room.run!;
    expect(room.action('p1', { seq: 1, action: { type: 'buy-provisions', amount: 2, crewId: 2 } }, 0)).toBeNull();
    expect(run.state.psych!.provisions).toBe(2);
    run.state.crew[1]!.sanityPct = 33;
    const snap = run.snapshot();
    const mirror = createRun({ seed: SEED, crewSize: 2, catalog: psychCat() });
    mirror.hydrate(snap);
    expect(mirror.snapshot()).toEqual(snap);
    expect(mirror.snapshot().crew[1]!.sanityPct).toBe(33);
  });
});

describe('caídas, salidas y vuelta al lobby', () => {
  it('sin nadie conectado el tiempo no avanza; al volver, sigue', () => {
    const room = playing([null]);
    room.advance(1);
    const t = room.run!.state.stats.timeS;
    room.drop('p1');
    expect(room.view.players[0]!.connected).toBe(false);
    room.advance(5);
    expect(room.run!.state.stats.timeS).toBe(t);
    room.reconnect('p1');
    room.advance(1);
    expect(room.run!.state.stats.timeS).toBeGreaterThan(t);
  });

  it('quien se va en partida deja su tripulante; la sala queda vacía cuando se van todos', () => {
    const room = playing([null, null]);
    room.leave('p2');
    expect(room.view.players.map((p) => p.id)).toEqual(['p1']);
    expect(room.run!.state.crew).toHaveLength(2);
    expect(room.isEmpty).toBe(false);
    room.leave('p1');
    expect(room.isEmpty).toBe(true);
  });

  it('tras perder, el anfitrión devuelve la sala al lobby y la siguiente partida es nueva', () => {
    const room = playing([null, null]);
    expect(room.lobby('p1', { type: 'restart' })).toBe(false); // aún no se ha perdido
    const run = room.run!;
    // Nadie hace nada en un salto a toda máquina tras otro hasta perder (o se fuerza con el oxígeno).
    for (let i = 0; i < 200_000 && run.state.phase !== 'lost'; i++) {
      if (run.state.phase === 'docked') room.action('p1', { seq: 1, action: { type: 'jump', toId: firstLink(run) } }, i);
      if (run.state.phase === 'won') room.action('p1', { seq: 1, action: { type: 'next-sector' } }, i);
      room.advance(1);
    }
    expect(run.state.phase).toBe('lost');
    expect(room.lobby('p2', { type: 'restart' })).toBe(false);
    expect(room.lobby('p1', { type: 'restart' })).toBe(true);
    expect(room.phase).toBe('lobby');
    expect(room.run).toBeNull();
    expect(room.view.players.every((p) => p.crewId === null && !p.ready)).toBe(true);
    const firstRunId = room.view.runId;
    room.lobby('p2', { type: 'set-ready', ready: true });
    expect(room.lobby('p1', { type: 'start' })).toBe(true);
    expect(room.view.runId).toBe(firstRunId + 1);
  });
});

describe('estado, poses y pings', () => {
  it('el sector solo viaja cuando cambia o se pide entero', () => {
    const room = playing([null]);
    expect(room.stateMessage()?.sector).toBeDefined();
    room.advance(0.1);
    expect(room.stateMessage()?.sector).toBeUndefined();
    expect(room.stateMessage(true)?.sector).toBeDefined();
    expect(room.stateMessage()?.sector).toBeUndefined();
  });

  it('guarda la pose de cada jugador conectado y limita los pings', () => {
    const room = playing([null, null]);
    room.pose('p1', { x: 1, y: 0, z: 2, yaw: 0.5, area: 'ship' });
    room.pose('p2', { x: 'no', y: 0, z: 2, yaw: 0.5, area: 'ship' });
    expect(room.poses).toEqual({ 1: { x: 1, y: 0, z: 2, yaw: 0.5, area: 'ship' } });
    room.drop('p1');
    expect(room.poses).toEqual({});
    expect(room.ping('p2', { kind: 'danger', x: 0, y: 0, z: 0, area: 'ship' }, 10)).toMatchObject({ crewId: 2, kind: 'danger' });
    expect(room.ping('p2', { kind: 'danger', x: 0, y: 0, z: 0, area: 'ship' }, 10.1)).toBeNull();
    expect(room.ping('p2', { kind: 'look', x: 0, y: 0, z: 0, area: 'ship' }, 11)).not.toBeNull();
  });
});

describe('diseño compartido y voto Go/No-Go (ADR 0020)', () => {
  /** Sala en el lobby con `n` jugadores (p1 anfitrión) y la misión de Marte elegida. */
  function marsLobby(n: number): RoomModel {
    const room = newRoom();
    for (let i = 1; i <= n; i++) room.join(`p${i}`, `J${i}`);
    expect(room.lobby('p1', { type: 'set-mission', missionId: 'mission-mars-habitability' })).toBe(true);
    return room;
  }
  /** Monta entre todos el diseño de referencia de Marte (cada jugador añade algunas piezas). */
  function buildMars(room: RoomModel, n: number): void {
    const target = referenceDesign('mission-mars-habitability');
    const edits = designEditsBetween(room.view.design!, target);
    edits.forEach((edit, i) => expect(room.lobby(`p${(i % n) + 1}`, { type: 'edit-design', edit }), JSON.stringify(edit)).toBe(true));
  }

  it('solo el anfitrión elige la misión; sin misión, partida libre como siempre', () => {
    const room = newRoom();
    room.join('p1', 'A');
    room.join('p2', 'B');
    expect(room.lobby('p2', { type: 'set-mission', missionId: 'mission-lunar-ice' })).toBe(false);
    expect(room.lobby('p1', { type: 'set-mission', missionId: 'no-existe' })).toBe(false);
    expect(room.lobby('p1', { type: 'set-mission', missionId: 'mission-lunar-ice' })).toBe(true);
    expect(room.view.design?.missionId).toBe('mission-lunar-ice');
    expect(room.lobby('p1', { type: 'set-mission', missionId: null })).toBe(true);
    expect(room.view.design).toBeNull();
  });

  it('cualquiera edita; cada cambio sube la revisión y borra los votos', () => {
    const room = marsLobby(2);
    expect(room.lobby('p2', { type: 'edit-design', edit: { op: 'add-module', id: 'frame-standard' } })).toBe(true);
    expect(room.lobby('p1', { type: 'vote', go: true })).toBe(true);
    const rev = room.view.designRev!;
    expect(room.lobby('p2', { type: 'edit-design', edit: { op: 'add-instrument', id: 'inst-drill' } })).toBe(true);
    expect(room.view.designRev).toBe(rev + 1);
    expect(room.view.players.map((p) => p.vote)).toEqual([null, null]);
    // Ediciones inválidas o sin efecto no cambian nada.
    expect(room.lobby('p2', { type: 'edit-design', edit: { op: 'add-module', id: 'nope' } })).toBe(false);
    expect(room.lobby('p2', { type: 'edit-design', edit: { op: 'hack' } })).toBe(false);
  });

  it('solo se zarpa con Go del motor y mayoría estricta de Go; el empate es No-Go', () => {
    const room = marsLobby(2);
    // Diseño vacío (No-Go del motor): aunque voten todos Go, no se puede.
    room.lobby('p1', { type: 'vote', go: true });
    room.lobby('p2', { type: 'vote', go: true });
    expect(room.canStart()).toBe(false);
    buildMars(room, 2);
    expect(room.lobby('p1', { type: 'vote', go: true })).toBe(true);
    expect(room.lobby('p2', { type: 'vote', go: false })).toBe(true);
    expect(room.lobby('p1', { type: 'start' })).toBe(false); // 1 a 1: empate
    room.lobby('p2', { type: 'vote', go: true });
    expect(room.lobby('p2', { type: 'start' })).toBe(false); // solo el anfitrión
    expect(room.lobby('p1', { type: 'start' })).toBe(true);
    // La partida es la misión diseñada, con su ciencia.
    const run = room.run!;
    expect(run.state.missionDesign?.missionId).toBe('mission-mars-habitability');
    expect(run.state.science).toBeDefined();
    expect(run.state.crew).toHaveLength(2);
  });

  it('la sala con diseño produce lo mismo que el motor con ese diseño', () => {
    const room = marsLobby(1);
    buildMars(room, 1);
    room.lobby('p1', { type: 'vote', go: true });
    expect(room.lobby('p1', { type: 'start' })).toBe(true);
    const solo = createRun({ seed: SEED, crewSize: 1, roles: [null], design: room.view.design! });
    for (let i = 0; i < 50; i++) {
      room.advance(FIXED_STEP_S);
      solo.step(FIXED_STEP_S);
    }
    const { sector: _a, ...a } = room.run!.snapshot();
    const { sector: _b, ...b } = solo.snapshot();
    expect(a).toEqual(b);
  });

  it('al terminar (o perder) se vuelve al lobby con el mismo diseño y sin votos', () => {
    const room = marsLobby(1);
    buildMars(room, 1);
    room.lobby('p1', { type: 'vote', go: true });
    room.lobby('p1', { type: 'start' });
    expect(room.lobby('p1', { type: 'restart' })).toBe(false); // la misión sigue
    room.run!.state.science!.over = true;
    expect(room.lobby('p1', { type: 'restart' })).toBe(true);
    expect(room.phase).toBe('lobby');
    expect(room.view.design?.instrumentIds.length).toBeGreaterThan(0);
    expect(room.view.players[0]!.vote).toBeNull();
    // En partida no se edita ni se vota.
    room.lobby('p1', { type: 'vote', go: true });
    room.lobby('p1', { type: 'start' });
    expect(room.lobby('p1', { type: 'edit-design', edit: { op: 'clear' } })).toBe(false);
  });
});

describe('misión guiada y objetivo actual en sala', () => {
  const GUIDED = 'mission-cubesat-guided';

  /** Lo que hace el cliente con el `state` que recibe: lo serializa la red, crea el espejo con el diseño y lo hidrata. */
  function mirrorOf(room: RoomModel): Run {
    const msg = JSON.parse(JSON.stringify(room.stateMessage(true))) as NonNullable<ReturnType<RoomModel['stateMessage']>>;
    const state = { ...msg.state, sector: msg.sector! };
    const design = state.missionDesign;
    const mirror = createRun({ seed: state.seed, crewSize: state.crew.length, roles: state.crew.map((c) => c.role ?? null), ...(design ? { design } : {}) });
    mirror.hydrate(state);
    return mirror;
  }

  it('el anfitrión elige la misión guiada y el diseño arranca con su nave y su lanzador, como en solitario', () => {
    const room = newRoom();
    room.join('p1', 'A');
    expect(room.lobby('p1', { type: 'set-mission', missionId: GUIDED })).toBe(true);
    expect(room.view.design).toEqual(guidedStartDesign(GUIDED));
    expect(room.view.design?.launcherId).toBe(getMission(GUIDED).guided!.launcherId);
    expect(room.view.design?.instrumentIds).toEqual([]);
  });

  it('las ediciones que la misión guiada no admite se rechazan sin tocar el diseño ni la revisión', () => {
    const room = newRoom();
    room.join('p1', 'A');
    room.join('p2', 'B');
    room.lobby('p1', { type: 'set-mission', missionId: GUIDED });
    const before = room.view.design;
    const rev = room.view.designRev;
    const forbidden = [
      { op: 'add-module', id: 'frame-standard' },
      { op: 'remove-module', id: 'engine-chemical' },
      { op: 'set-launcher', id: 'launcher-colossus' },
      { op: 'set-launcher', id: null },
      { op: 'set-destination', id: null },
      { op: 'add-instrument', id: 'inst-drill' }, // no es de la carga guiada
      { op: 'clear' }, // sin carga, no cambia nada
    ];
    for (const edit of forbidden) expect(room.lobby('p2', { type: 'edit-design', edit }), JSON.stringify(edit)).toBe(false);
    expect(room.view.design).toEqual(before);
    expect(room.view.designRev).toBe(rev);
    // Sin carga, el motor da No-Go: aunque todos voten Go, no se zarpa.
    expect(reviewDesign(room.view.design!).go).toBe(false);
    room.lobby('p1', { type: 'vote', go: true });
    room.lobby('p2', { type: 'vote', go: true });
    expect(room.lobby('p1', { type: 'start' })).toBe(false);
  });

  it('con la carga CubeSat y Go, la partida lleva diseño y ciencia y el objetivo es el vuelo guiado (paso «launch»)', () => {
    const room = newRoom();
    room.join('p1', 'A');
    room.join('p2', 'B');
    room.lobby('p1', { type: 'set-mission', missionId: GUIDED });
    expect(room.lobby('p1', { type: 'edit-design', edit: { op: 'add-instrument', id: 'inst-cubesat-magnetometer' } })).toBe(true);
    expect(room.lobby('p2', { type: 'edit-design', edit: { op: 'add-instrument', id: 'inst-cubesat-dosimeter' } })).toBe(true);
    expect(reviewDesign(room.view.design!).go).toBe(true);
    room.lobby('p1', { type: 'vote', go: true });
    room.lobby('p2', { type: 'vote', go: true });
    expect(room.lobby('p1', { type: 'start' })).toBe(true);

    const run = room.run!;
    expect(run.state.missionDesign).toEqual(room.view.design);
    expect(run.state.science).toBeDefined();

    // El cliente calcula el objetivo sobre el estado que recibe: debe ser el mismo que en el servidor.
    const mirror = mirrorOf(room);
    const objective = currentObjective(mirror.state);
    expect(objective).toEqual(currentObjective(run.state));
    expect(objective.mode).toBe('mission');
    expect(objective.status).toBe('active');
    expect(objective.steps.map((s) => s.id)).toEqual(['launch', 'reach-target', 'observe', 'downlink', 'return']);
    expect(objective.steps[objective.current]?.id).toBe('launch');
    // Los textos son los de la misión guiada (`guided.<id>.<paso>`), no los genéricos.
    expect(objective.steps[0]!.text.key).toBe(`guided.${GUIDED}.launch.text`);

    // Y en solitario, con el mismo diseño y semilla, es el mismo objetivo.
    const solo = createRun({ seed: SEED, crewSize: 2, roles: [null, null], design: room.view.design! });
    expect(currentObjective(solo.state)).toEqual(objective);
  });

  it('en sala sin misión (partida libre), el objetivo es la guía libre del sector 1', () => {
    const room = playing([null, 'pilot']);
    expect(room.run!.state.missionDesign).toBeUndefined();
    const objective = currentObjective(mirrorOf(room).state);
    expect(objective.mode).toBe('free');
    expect(objective.status).toBe('active');
    expect(objective.steps[objective.current]?.id).toBe('jump');
    expect(objective).toEqual(currentObjective(room.run!.state));
  });
});
