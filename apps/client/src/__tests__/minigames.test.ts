import { describe, expect, it } from 'vitest';
import { catalog, createRun, cruiseSpeedLyPerS, getShip, type RunState } from '@payload/shared';
import { runSecondsBetween, STATION_IDS } from '../game/layout';
import {
  ARENA_HALF_Y,
  classifyArrival,
  createDodge,
  dodgeDifficulty,
  canPlayDodge,
  DODGE_DURATION_S,
  DODGE_LEAD_S,
  lateDodgeResult,
  dodgeLevelForSector,
  dodgeResult,
  generateRocks,
  rockDepth,
  SHIP_RADIUS,
  SIMPLE_DODGE_RESULT,
  stepDodge,
  evadeAction,
  maxGrazesOf,
  type DodgeState,
} from '../game/dodge';
import { fly, PILOTS } from './dodgeBots';
import { holdAction, interactionAt, KEY_REPAIR, KEY_SKILL, promptFor, sendInChunks } from '../game/interaction';
import {
  aimOnTarget,
  createPulse,
  createSeal,
  fireWorkS,
  FIRE_RATE_OFF,
  FIRE_RATE_ON,
  flameOffset,
  PULSE_MISS_COOLDOWN_S,
  PULSE_ZONE_W,
  pressPulse,
  pulseCursor,
  SEAL_FILL_S,
  SEAL_ZONE_W,
  SIMPLE_RATE,
  stepPulse,
  stepSeal,
} from '../game/repairGames';

const LEVELS = [0, 0.5, 1];

/**
 * Piloto automático: cada paso busca el punto del plano más alejado de las rocas que llegan pronto y va
 * hacia él. Si el bot no choca, el minijuego se puede ganar.
 */
function autopilot(s: DodgeState): void {
  const dt = 1 / 60;
  while (!s.done) {
    let best = { x: s.x, y: s.y, score: -Infinity };
    for (let gx = -0.9; gx <= 0.91; gx += 0.15) {
      for (let gy = -0.5; gy <= 0.51; gy += 0.125) {
        let score = -Math.hypot(gx - s.x, gy - s.y) * 0.25;
        for (const rock of s.rocks) {
          const arrive = rock.spawnS + s.travelS - s.t;
          if (arrive < 0 || arrive > 0.9) continue;
          const clear = Math.hypot(rock.x - gx, rock.y - gy) - rock.r - SHIP_RADIUS;
          // Solo vale un hueco al que se llega a tiempo.
          const reach = Math.hypot(gx - s.x, gy - s.y) / 1.5;
          if (clear < 0.05) score -= (reach > arrive ? 1 : 3) * (1 - clear);
        }
        if (score > best.score) best = { x: gx, y: gy, score };
      }
    }
    const dx = best.x - s.x;
    const dy = best.y - s.y;
    const len = Math.hypot(dx, dy);
    const k = len > 0.04 ? 1 / len : len > 0 ? 1 / 0.04 : 0;
    stepDodge(s, dx * k, dy * k, dt);
  }
}

describe('esquiva de asteroides (timón)', () => {
  it('es determinista: misma semilla, mismas rocas; otra semilla, otras', () => {
    const d = dodgeDifficulty(0.5);
    expect(generateRocks(42, 6, d)).toEqual(generateRocks(42, 6, d));
    expect(generateRocks(42, 6, d)).not.toEqual(generateRocks(43, 6, d));
    const hard = dodgeDifficulty(1);
    for (const r of generateRocks(7, 6, hard)) {
      expect(Math.abs(r.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.y)).toBeLessThanOrEqual(ARENA_HALF_Y);
      // Toda roca llega antes de que acabe.
      expect(r.spawnS + hard.travelS).toBeLessThanOrEqual(6 + 1e-9);
    }
  });

  it('el resultado no depende de los FPS (pasos fijos)', () => {
    const run = (dt: number) => {
      const s = createDodge(9, 6, dodgeDifficulty(0.7));
      // Misma entrada, distinto troceo del tiempo.
      for (let t = 0; !s.done && t < 20; t += dt) stepDodge(s, 0.6, -0.4, dt);
      return dodgeResult(s);
    };
    expect(run(1 / 30)).toEqual(run(1 / 144));
  });

  it('se puede ganar: un piloto atento no choca de lleno en ninguna dificultad', () => {
    for (const level of LEVELS) {
      let hits = 0;
      for (let seed = 1; seed <= 25; seed++) {
        const s = createDodge(seed, DODGE_DURATION_S, dodgeDifficulty(level));
        autopilot(s);
        hits += s.hits;
      }
      expect(hits, `nivel ${level}`).toBe(0);
    }
  });

  it('hacerlo mal no bloquea: quieto también termina, y en difícil quieto se choca', () => {
    let hits = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = createDodge(seed, DODGE_DURATION_S, dodgeDifficulty(1));
      for (let i = 0; i < 2000 && !s.done; i++) stepDodge(s, 0, 0, 1 / 60);
      expect(s.done).toBe(true);
      const r = dodgeResult(s);
      expect(typeof r.grazes).toBe('number');
      hits += s.hits + s.grazes;
    }
    expect(hits).toBeGreaterThan(10);
  });

  it('roce frente a choque de lleno y la forma del resultado', () => {
    expect(classifyArrival(0, 0.2)).toBe(3);
    expect(classifyArrival(0.25, 0.2)).toBe(2);
    expect(classifyArrival(0.35, 0.2)).toBe(1);
    const s = createDodge(1, 3, dodgeDifficulty(0));
    expect(dodgeResult(s)).toEqual({ grazes: 0, fullHit: false });
    expect(SIMPLE_DODGE_RESULT).toEqual({ grazes: 1, fullHit: false });
    expect(rockDepth(s, { spawnS: 1, x: 0, y: 0, r: 0.1, spin: 0 }, 1)).toBe(1);
  });

  it('duración fija; las rocas dependen solo de la dificultad; dificultad que sube con el sector', () => {
    expect(DODGE_DURATION_S).toBe(3);
    expect(DODGE_DURATION_S + DODGE_LEAD_S).toBeCloseTo(3.4, 6);
    expect(canPlayDodge(30)).toBe(true);
    expect(canPlayDodge(-1)).toBe(true);
    expect(canPlayDodge(DODGE_DURATION_S + DODGE_LEAD_S - 0.01)).toBe(false);
    // Mismas rocas tome los mandos cuando los tome.
    expect(createDodge(5, DODGE_DURATION_S, dodgeDifficulty(0.5)).rocks).toEqual(createDodge(5, DODGE_DURATION_S, dodgeDifficulty(0.5)).rocks);
    expect(dodgeLevelForSector(1)).toBeLessThan(dodgeLevelForSector(3));
    expect(dodgeDifficulty(1).rocksPerS).toBeGreaterThan(dodgeDifficulty(0).rocksPerS);
    expect(dodgeDifficulty(1).travelS).toBeLessThan(dodgeDifficulty(0).travelS);
  });
});

describe('incentivo: llegar pronto al timón nunca es peor que llegar tarde', () => {
  const ev = catalog.hazards.impact.evade!;
  const max = maxGrazesOf(ev);
  const damage = (r: { grazes: number; fullHit: boolean }) => {
    const g = (evadeAction(r, max) as { grazes: number }).grazes;
    return g >= max ? ev.failDamageFrac : g * ev.grazeDamageFrac;
  };
  /** Daño esperado de jugarla con un piloto dado (media de semillas). */
  const expected = (level: number, pilot: keyof typeof PILOTS, n = 30) => {
    let sum = 0;
    for (let seed = 1; seed <= n; seed++) {
      const s = createDodge(seed * 7919, DODGE_DURATION_S, dodgeDifficulty(level));
      fly(s, PILOTS[pilot]);
      sum += damage(dodgeResult(s));
    }
    return sum / n;
  };

  it('para cualquier ETA, tomar los mandos tarde no es mejor que jugarla bien (ni que un piloto medio)', () => {
    for (const level of [0, 0.3, 0.6, 1]) {
      const good = expected(level, 'good');
      const medium = expected(level, 'medium');
      for (let eta = 0.2; eta < 10; eta += 0.3) {
        if (canPlayDodge(eta)) continue;
        const late = lateDodgeResult(eta, level, max);
        expect(late.grazes, `nivel ${level}, eta ${eta}`).toBeGreaterThanOrEqual(1); // nunca limpia
        expect(damage(late), `nivel ${level}, eta ${eta}`).toBeGreaterThanOrEqual(good);
        expect(damage(late), `nivel ${level}, eta ${eta}`).toBeGreaterThanOrEqual(medium);
      }
      // Peor cuanto más tarde.
      expect(damage(lateDodgeResult(0.5, level, max))).toBeGreaterThanOrEqual(damage(lateDodgeResult(4, level, max)));
    }
  });

  it('la dificultad se nota: el daño esperado de un piloto medio y de uno torpe sube con el sector', () => {
    expect(expected(1, 'medium')).toBeGreaterThan(expected(0.3, 'medium') + 0.04);
    expect(expected(1, 'bad')).toBeGreaterThan(expected(0.3, 'bad') + 0.15);
    // Jugarla mal sigue siendo mejor que no intentarlo (el impacto entero).
    expect(expected(1, 'bad')).toBeLessThan(1);
  });
});

describe('ventana para llegar al timón', () => {
  it('a crucero da tiempo a cruzar la nave entera y jugar la esquiva; la tabla por régimen', () => {
    const ship = getShip(catalog.ships[0]!.id);
    const lead = catalog.hazards.impact.warnLeadLy;
    const worst = Math.max(...STATION_IDS.map((id) => runSecondsBetween(id, 'helm')));
    const rows = ship.throttles.map((th) => {
      const warnS = lead / cruiseSpeedLyPerS(ship, th.id, 100);
      return { id: th.id, warnS, toReach: warnS - DODGE_DURATION_S - DODGE_LEAD_S };
    });
    const cruise = rows.find((r) => r.id === 'cruise')!;
    expect(cruise.toReach).toBeGreaterThanOrEqual(worst);
    // A régimen económico, aún más.
    expect(rows.find((r) => r.id === 'eco')!.toReach).toBeGreaterThan(cruise.toReach);
  });
});

describe('esquiva conectada al motor', () => {
  it('el resultado se traduce a `evade {grazes}`: choque de lleno = esquiva fallida', () => {
    const max = maxGrazesOf(catalog.hazards.impact.evade);
    expect(max).toBe(catalog.hazards.impact.evade?.maxGrazes ?? 4);
    expect(evadeAction({ grazes: 0, fullHit: false }, max)).toEqual({ type: 'evade', grazes: 0 });
    expect(evadeAction({ grazes: 2, fullHit: false }, max)).toEqual({ type: 'evade', grazes: 2 });
    expect(evadeAction({ grazes: 9, fullHit: false }, max)).toEqual({ type: 'evade', grazes: max });
    expect(evadeAction({ grazes: 0, fullHit: true }, max)).toEqual({ type: 'evade', grazes: max });
    expect(evadeAction(SIMPLE_DODGE_RESULT, max)).toEqual({ type: 'evade', grazes: 1 });
  });

  /** Salta hasta que llega un aviso de impacto y devuelve la partida en ese instante. */
  function warned(seed: number) {
    const run = createRun({ seed });
    for (let attempt = 0; attempt < 20 && run.state.warnings.length === 0; attempt++) {
      if (run.state.phase === 'docked') {
        const to = run.state.sector.nodes.find((n) => n.id !== run.state.locationId && run.apply({ type: 'jump', toId: n.id }).ok);
        if (!to) break;
      }
      for (let i = 0; i < 600 && run.state.phase === 'transit' && run.state.warnings.length === 0; i++) run.step(0.1);
    }
    return run;
  }

  it('la esquiva termina (y envía `evade`) antes del impacto, y los roces se ven en el casco', () => {
    const outcome = (result: { grazes: number; fullHit: boolean } | null) => {
      const run = warned(7);
      const w = run.state.warnings.find((x) => !x.evaded)!;
      expect(w, 'hay aviso').toBeTruthy();
      expect(w.evadeSeed).toBeTypeOf('number');
      // Si da tiempo a jugarla, la esquiva termina antes del impacto: el `evade` llega a tiempo.
      const dur = canPlayDodge(w.etaS) ? DODGE_DURATION_S : 0;
      expect(dur).toBeLessThan(w.etaS);
      run.step(Math.ceil(dur * 10) / 10);
      expect(run.state.warnings.some((x) => x.hazardId === w.hazardId)).toBe(true);
      if (result) expect(run.apply(evadeAction(result, maxGrazesOf(run.catalog.hazards.impact.evade))).ok).toBe(true);
      const hull = run.state.ship.hull;
      const events: string[] = [];
      for (let i = 0; i < 200 && run.state.warnings.some((x) => x.hazardId === w.hazardId); i++) run.step(0.1);
      for (const e of run.takeEvents()) if (e.type === 'impact-hit' || e.type === 'impact-evaded') events.push(`${e.type}:${e.subtype ?? ''}`);
      return { lost: hull - run.state.ship.hull, events };
    };
    const clean = outcome({ grazes: 0, fullHit: false });
    const grazed = outcome({ grazes: 2, fullHit: false });
    const failed = outcome({ grazes: 0, fullHit: true });
    expect(clean.events).toContain('impact-evaded:clean');
    expect(grazed.events).toContain('impact-hit:graze');
    expect(failed.events).toContain('impact-hit:failed');
    expect(clean.lost).toBe(0);
    // Con escudos parte se absorbe, pero el roce se nota en el casco y la esquiva fallida más.
    expect(grazed.lost).toBeGreaterThan(0);
    expect(failed.lost).toBeGreaterThan(grazed.lost);
  });
});

describe('reparaciones por tipo de avería', () => {
  const repairS = catalog.hazards.incidents;

  it('fuego: apuntar a la llama rinde más que rociar a ciegas; sin rociar no hay trabajo', () => {
    expect(fireWorkS(1, true, true)).toBe(FIRE_RATE_ON);
    expect(fireWorkS(1, true, false)).toBe(FIRE_RATE_OFF);
    expect(fireWorkS(1, false, true)).toBe(0);
    expect(FIRE_RATE_ON).toBeGreaterThan(SIMPLE_RATE);
    expect(FIRE_RATE_OFF).toBeGreaterThan(0);
    // La llama se mueve y es determinista.
    const a = flameOffset(5, 1, { x: 0, y: 0 });
    expect(flameOffset(5, 1, { x: 0, y: 0 })).toEqual(a);
    expect(flameOffset(5, 2, { x: 0, y: 0 })).not.toEqual(a);
    // Puntería: delante y cerca de la línea de mira.
    const eye = { x: 0, y: 1.6, z: 0 };
    const dir = { x: 0, y: 0, z: -1 };
    expect(aimOnTarget(eye, dir, { x: 0.1, y: 1.6, z: -2 }, 0.3)).toBe(true);
    expect(aimOnTarget(eye, dir, { x: 0.6, y: 1.6, z: -2 }, 0.3)).toBe(false);
    expect(aimOnTarget(eye, dir, { x: 0, y: 1.6, z: 2 }, 0.3)).toBe(false);
  });

  it('cortocircuito: dos aciertos lo arreglan; machacar el botón es más lento pero avanza', () => {
    const rs = repairS.short.repairS;
    // Pulsar justo cuando la marca está en la zona.
    const s = createPulse(3);
    let work = 0;
    let t = 0;
    while (work < rs && t < 10) {
      stepPulse(s, 1 / 60);
      t += 1 / 60;
      const c = pulseCursor(s);
      if (c > s.zoneA + PULSE_ZONE_W * 0.3 && c < s.zoneA + PULSE_ZONE_W * 0.7) work += pressPulse(s, rs);
    }
    expect(s.hits).toBe(2);
    // Perfecto, más rápido que mantener (el `repairS` del catálogo).
    expect(t).toBeLessThan(rs);
    // Machacando sin mirar: también avanza (nunca bloquea), pero más despacio.
    let mw = 0;
    const seeds = 20;
    for (let seed = 1; seed <= seeds; seed++) {
      const m = createPulse(seed);
      for (let i = 0; i < 60 * 6; i++) {
        stepPulse(m, 1 / 60);
        mw += pressPulse(m, rs);
      }
    }
    expect(mw).toBeGreaterThan(0);
    expect(mw / (6 * seeds)).toBeLessThan((rs / t) * 0.75);
    // Tras un clic hay espera (más larga si falló).
    const c = createPulse(1);
    pressPulse(c, rs);
    expect(pressPulse(c, rs)).toBe(0);
    stepPulse(c, PULSE_MISS_COOLDOWN_S + 0.01);
    expect(pressPulse(c, rs)).toBeGreaterThan(0);
  });

  it('fuga: soltar con la presión en la zona sella; pasarse o soltar pronto avanza poco', () => {
    const rs = repairS.leak.repairS;
    const s = createSeal(8);
    const target = s.zoneA + SEAL_ZONE_W / 2;
    let work = 0;
    let t = 0;
    while (work < rs && t < 10) {
      const holding = s.pressure < target;
      work += stepSeal(s, holding, 1 / 60, rs);
      t += 1 / 60;
    }
    expect(s.seals).toBeGreaterThanOrEqual(2);
    expect(t).toBeLessThan(3.5);
    // Mantener sin soltar: revienta (fallo) y vuelve a empezar, entregando algo de trabajo.
    const o = createSeal(8);
    let ow = 0;
    for (let i = 0; i < 60 * (SEAL_FILL_S + 0.2); i++) ow += stepSeal(o, true, 1 / 60, rs);
    expect(o.tries).toBe(1);
    expect(o.seals).toBe(0);
    expect(ow).toBeGreaterThan(0);
    expect(ow).toBeLessThan(rs / 2);
  });

  it('repuesto: encajar la pieza en dos tramos (mantener R y soltar en la marca) en vez de esperar 4 s', () => {
    const kit = catalog.hazards.repair.kitRepairS;
    const s = createSeal(21);
    let work = 0;
    let t = 0;
    while (work < kit && t < 10) {
      const target = s.zoneA + SEAL_ZONE_W / 2;
      work += stepSeal(s, s.pressure < target, 1 / 60, kit);
      t += 1 / 60;
    }
    expect(s.seals).toBe(2);
    expect(t).toBeLessThan(kit * 0.75);
  });

  it('cada avería se traduce a `work-incident` y el aviso enseña su control', () => {
    const run = createRun({ seed: 7 });
    const s: RunState = { ...run.state, incidents: [{ id: 4, kind: 'short', systemId: 'engines', ageS: 0, progress: 0.2, spread: false } as unknown as RunState['incidents'][number]] };
    const i = interactionAt('engines', s);
    expect(i).toMatchObject({ kind: 'incident' });
    expect(holdAction(i, 0.3)).toEqual({ type: 'work-incident', incidentId: 4, seconds: 0.3 });
    // Por defecto: clic (pulsar a tiempo en el cortocircuito); con interacciones simples, mantener R.
    expect(promptFor(i, s)).toMatchObject({ key: 'prompt.fix.short', inputKey: KEY_SKILL, hold: false, progressBar: true });
    expect(promptFor(i, s, 0, true)).toMatchObject({ inputKey: KEY_REPAIR, hold: true });
    // Mucho trabajo de golpe (un acierto) se trocea en acciones que el motor acepta.
    const chunks: number[] = [];
    sendInChunks(1.2, 0.5, (x) => (chunks.push(x), true));
    expect(chunks).toHaveLength(3);
  });
});
