// Mascota única por sala: cola con prioridad, moderación y disparadores que publica el modelo.
import { describe, expect, it } from 'vitest';
import { catalog, getScenario, pickMascotDialogue, TEAM_MASCOT_TRIGGERS, TEAM_ROLES, type MascotCue } from '@payload/shared';
import {
  isPhaseBound, MASCOT_CHATTER_MIN_S, MASCOT_MIN_GAP_S, MASCOT_PENDING_TTL_S, MascotDirector, mascotPriority,
} from '../mascotDirector';
import { RoomModel } from '../roomModel';
import { buildDesign, catalogWithTeamDialogues, holder, launch, loadPrototypeDesign, ok, roomInDesign, TestClock } from './helpers';

const all = () => true;
const OK = loadPrototypeDesign('ok-cubesat-leo');
const TEAM_CATALOG = catalogWithTeamDialogues([
  ...TEAM_MASCOT_TRIGGERS.map((v) => `team:${v}`),
  ...TEAM_ROLES.map((r) => `role:${r}`),
]);

describe('MascotDirector (puro)', () => {
  it('prioridades: lo urgente primero, luego desenlace, alertas, votación, eventos, fases, roles y charla', () => {
    const order = [
      'event:battery-depleted', 'event:mission-complete', 'report:failure', 'event:solar-storm', 'team:alert', 'team:alert-timeout',
      'review:no-go', 'review:go', 'team:vote-open', 'event:eclipse-enter', 'team:player-joined', 'phase:design', 'role:science', 'team:chat',
    ];
    const prios = order.map(mascotPriority);
    expect([...prios].sort((a, b) => b - a)).toEqual(prios);
    expect(isPhaseBound('phase:review')).toBe(true);
    expect(isPhaseBound('team:vote-open')).toBe(true);
    expect(isPhaseBound('event:solar-storm')).toBe(false);
    expect(isPhaseBound('report:success')).toBe(false);
  });

  it('publica uno por flush, respeta el hueco mínimo y lo urgente interrumpe', () => {
    const d = new MascotDirector(all);
    d.offer('phase:design', 0, 'design');
    d.offer('team:player-joined', 0, 'design');
    expect(d.flush(0, 'design')).toEqual({ trigger: 'team:player-joined', variant: 0, seq: 1, atS: 0 });
    expect(d.flush(1, 'design')).toBeNull(); // hueco mínimo
    d.offer('event:battery-depleted', 2, 'design');
    expect(d.flush(2, 'design')).toMatchObject({ trigger: 'event:battery-depleted', seq: 2 }); // interrumpe
    expect(d.flush(2 + MASCOT_MIN_GAP_S - 0.1, 'design')).toBeNull();
    expect(d.flush(2 + MASCOT_MIN_GAP_S, 'design')).toMatchObject({ trigger: 'phase:design', seq: 3 });
    expect(d.flush(100, 'design')).toBeNull();
  });

  it('variantes por disparador, sin repetir en cola, caducidad y descarte al cambiar de fase', () => {
    const d = new MascotDirector(all);
    const cues: (MascotCue | null)[] = [];
    for (let i = 0; i < 3; i++) {
      d.offer('team:request-open', i * 10, 'design');
      d.offer('team:request-open', i * 10, 'design'); // repetido en cola: se ignora
      cues.push(d.flush(i * 10, 'design'));
    }
    expect(cues.map((c) => [c?.variant, c?.seq])).toEqual([[0, 1], [1, 2], [2, 3]]);
    d.offer('team:vote-open', 50, 'review');
    d.offer('team:player-left', 50, 'review');
    d.offer('event:overheating', 50, 'review');
    expect(d.flush(50, 'review')!.trigger).toBe('event:overheating');
    // Cambio de fase: lo ligado a la fase anterior (vote-open) se descarta; lo demás sigue.
    expect(d.flush(60, 'design')!.trigger).toBe('team:player-left');
    expect(d.flush(70, 'design')).toBeNull();
    d.offer('team:player-joined', 100, 'design');
    expect(d.flush(100 + MASCOT_PENDING_TTL_S + 1, 'design')).toBeNull(); // caducado
  });

  it('solo habla si hay diálogo; una vez por intento; moderación de charla y eventos frecuentes', () => {
    const d = new MascotDirector((t) => t !== 'team:allocation');
    d.offer('team:allocation', 0, 'design');
    expect(d.flush(0, 'design')).toBeNull();
    d.offer('phase:design', 0, 'design', { oncePerAttempt: true });
    expect(d.flush(0, 'design')!.trigger).toBe('phase:design');
    d.offer('phase:design', 10, 'design', { oncePerAttempt: true });
    expect(d.flush(10, 'design')).toBeNull();
    d.resetAttempt();
    d.offer('phase:design', 20, 'design', { oncePerAttempt: true });
    expect(d.flush(20, 'design')!.trigger).toBe('phase:design');
    for (const t of [30, 40, 30 + MASCOT_CHATTER_MIN_S]) d.offer('team:chat', t, 'design', { minIntervalS: MASCOT_CHATTER_MIN_S });
    expect(d.flush(30, 'design')!.trigger).toBe('team:chat');
    expect(d.flush(45, 'design')).toBeNull();
    // Eventos de cada órbita: solo el primero del intento.
    d.offerEvent('eclipse-enter', 200, 'operation');
    expect(d.flush(200, 'operation')!.trigger).toBe('event:eclipse-enter');
    d.offerEvent('eclipse-enter', 300, 'operation');
    expect(d.flush(300, 'operation')).toBeNull();
  });
});

describe('mascota de la sala (modelo)', () => {
  /**
   * Recoge TODAS las publicaciones de la mascota mientras se conduce la sala: envuelve los métodos públicos
   * del modelo para mirar `view.mascot` tras cada llamada (una publicación puede quedar tapada por la
   * siguiente dentro de un mismo helper de test).
   */
  function recorder(m: RoomModel) {
    const seen: MascotCue[] = [];
    const take = () => {
      const cue = m.view.mascot;
      if (cue && cue.seq !== seen.at(-1)?.seq) seen.push(cue);
    };
    // Envolver métodos de una instancia exige escribir en ella: cast acotado a este test.
    const target = m as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const name of ['join', 'drop', 'reconnect', 'leave', 'apply', 'tick', 'move'] as const) {
      const original = target[name]!.bind(m);
      target[name] = (...args: unknown[]) => {
        const r = original(...args);
        take();
        return r;
      };
    }
    return { seen, take };
  }

  it('lobby, presentación de roles en el briefing, diseño y charla moderada; seq siempre crece', () => {
    const clock = new TestClock();
    const m = new RoomModel({ roomId: 'r', scenarioId: OK.scenarioId, catalog: TEAM_CATALOG });
    const rec = recorder(m);
    m.join('p1', 'A', clock.now);
    rec.take();
    expect(rec.seen.at(-1)!.trigger).toBe('team:lobby');
    for (const id of ['p2', 'p3', 'p4']) {
      m.join(id, id, clock.advance(MASCOT_MIN_GAP_S));
      rec.take();
    }
    expect(rec.seen.map((c) => c.trigger)).toEqual(['team:lobby', 'team:player-joined', 'team:player-joined', 'team:player-joined']);
    expect(rec.seen.map((c) => c.variant)).toEqual([0, 0, 1, 2]);
    ok(m, 'p1', { type: 'auto-assign-roles' }, clock.advance(1));
    ok(m, 'p1', { type: 'start-mission' }, clock.advance(MASCOT_MIN_GAP_S));
    rec.take();
    for (let i = 0; i < 40; i++) {
      m.tick(0.5, clock.advance(1));
      rec.take();
    }
    const briefing = rec.seen.slice(4).map((c) => c.trigger);
    expect(briefing).toEqual(['phase:briefing', ...TEAM_ROLES.map((r) => `role:${r}`)]);
    // Entre dos publicaciones (sin urgencias) pasan al menos MASCOT_MIN_GAP_S.
    const times = rec.seen.slice(4).map((c) => c.atS);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(MASCOT_MIN_GAP_S);
    ok(m, holder(m, 'director'), { type: 'start-design' }, clock.advance(1));
    rec.take();
    expect(rec.seen.at(-1)!.trigger).toBe('phase:design');
    // Charla: como mucho un team:chat cada MASCOT_CHATTER_MIN_S.
    const before = rec.seen.length;
    for (let i = 0; i < 20; i++) ok(m, 'p2', { type: 'chat', text: `mensaje ${i}` }, clock.advance(MASCOT_MIN_GAP_S));
    const chats = rec.seen.slice(before).filter((c) => c.trigger === 'team:chat').length;
    expect(chats).toBe(Math.ceil((20 * MASCOT_MIN_GAP_S) / MASCOT_CHATTER_MIN_S));
    const seqs = rec.seen.map((c) => c.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it('revisión, votación, lanzamiento, operación e informe con disparadores del motor (catálogo real)', () => {
    const clock = new TestClock();
    const seed = getScenario(OK.scenarioId).defaultSeed;
    const m = new RoomModel({ roomId: 'r', scenarioId: OK.scenarioId, seed });
    const rec = recorder(m);
    roomInDesign(m, 2, clock);
    rec.take();
    // Con la sala tranquila, la cola se vacía sola en los ticks (lo de la fase anterior ya se descartó).
    for (let i = 0; i < 5; i++) {
      m.tick(0.1, clock.advance(MASCOT_MIN_GAP_S));
      rec.take();
    }
    expect(rec.seen.map((c) => c.trigger)).toContain('phase:design');
    expect(rec.seen.map((c) => c.trigger)).not.toContain('phase:briefing');
    // Revisión con el motor en No-Go (diseño vacío).
    ok(m, 'p1', { type: 'request-review' }, clock.advance(MASCOT_MIN_GAP_S));
    rec.take();
    expect(rec.seen.at(-1)!.trigger).toBe('review:no-go');
    buildDesign(m, OK, clock);
    clock.advance(MASCOT_MIN_GAP_S);
    launch(m, clock);
    rec.take();
    ok(m, holder(m, 'director'), { type: 'set-time-scale', accel: 10000 }, clock.advance(1));
    for (let i = 0; i < 400 && m.view.phase === 'operation'; i++) {
      const open = m.view.alerts.find((a) => a.closedAtS === null);
      if (open) for (const role of open.requiredRoles) ok(m, holder(m, role), { type: 'ack-alert', alertId: open.id, role }, clock.advance(1));
      m.tick(1, clock.advance(1));
      rec.take();
    }
    expect(m.view.phase).toBe('report');
    for (let i = 0; i < 10; i++) {
      m.tick(0.1, clock.advance(MASCOT_MIN_GAP_S));
      rec.take();
    }
    const triggers = rec.seen.map((c) => c.trigger);
    expect(triggers).toContain('phase:design');
    expect(triggers).toContain('review:go');
    expect(triggers.some((t) => t.startsWith('report:'))).toBe(true);
    // Los eventos de cada órbita salen como mucho una vez por intento.
    for (const t of ['event:eclipse-enter', 'event:contact-start']) expect(triggers.filter((x) => x === t).length).toBeLessThanOrEqual(1);
    // Todo lo publicado tiene diálogo en el catálogo real (la mascota no habla en vacío).
    for (const c of rec.seen) expect(pickMascotDialogue(c.trigger, catalog.mascot!, c.variant), c.trigger).not.toBeNull();
  });
});
