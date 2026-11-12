import { beforeEach, describe, expect, it } from 'vitest';
import { catalog, createRun, getNodeWorld, getSurfaceCatalog, getWorld, type RunState } from '@payload/shared';
import { resetCueMemory, useCues } from '../audio/cues';
import { dangerLevel, musicMixFor } from '../audio/musicLogic';
import { SFX_META, sfxForRunEvent } from '../audio/soundLogic';
import { autoDescend, reachSurface, routeToLandable, travelToLandable } from '../game/debug';
import { altAction, chargedAction, interactionAt, promptFor, sendInChunks } from '../game/interaction';
import { CARGO_BAY, STATIONS, nearestStation } from '../game/layout';
import {
  flightLimitsOf,
  fullTankImpactCapMps,
  jetpackNetUpMps2,
  MAX_JUMP_AIR_S,
  newMotionState,
  settleMotion,
  SHIP_MOTION,
  simulateFlight,
  stepMotion,
  surfaceMotion,
  WORST_FALL_FRAC,
  type MotionInput,
} from '../game/motion';
import { fx, getRun, shakeForEvent, useGame } from '../game/runStore';
import {
  brakeThresholdMps,
  breathIntervalS,
  ENTER_HOLD_S,
  o2BeepIntervalS,
  PAD_RADIUS_M,
  SHIP_CENTER,
  fallDanger,
  o2ReturnShort,
  o2ToReturnPct,
  predictedImpactMps,
  sceneFor,
  shipBearing,
  surfaceInteractionAt,
  surfacePromptFor,
} from '../game/surfaceRules';
import { createTerrain, deepestDropM, gridSizeFor, pitDropM, pitRimM, terrainGrid, TERRAIN_STYLES, type TerrainInput } from '../game/terrain';
import { useUi } from '../state/ui';

const rules = getSurfaceCatalog(catalog).rules;

function terrainInput(worldId: string, over: Partial<TerrainInput> = {}): TerrainInput {
  const world = getWorld(worldId);
  return {
    seed: 7,
    sectorIndex: 1,
    nodeId: 'n3',
    worldId,
    radiusM: world.radiusM,
    pitDepthM: world.unstable.pitDepthM,
    deposits: [],
    zones: [],
    padX: SHIP_CENTER.x,
    padZ: SHIP_CENTER.z,
    padRadiusM: PAD_RADIUS_M,
    ...over,
  };
}

/** Lo más hondo que hay al ir en línea recta desde la nave hasta el borde, en una dirección. */
function deepestAlong(t: ReturnType<typeof createTerrain>, angle: number): number {
  let min = Infinity;
  for (let d = 0; d <= t.input.radiusM - 6; d += 0.5) min = Math.min(min, t.heightAt(Math.cos(angle) * d, Math.sin(angle) * d));
  return min;
}

/** Un tripulante simulado: avanza por frames como lo hace la escena. */
function play(seconds: number, frame = 1 / 30): void {
  for (let t = 0; t < seconds; t += frame) useGame.getState().tick(frame);
}

beforeEach(() => {
  useGame.getState().toMenu();
  resetCueMemory();
});

describe('terreno de superficie', () => {
  it('es determinista: misma semilla y nodo, mismo relieve; otro nodo, otro relieve', () => {
    const a = createTerrain(terrainInput('dust-moon'));
    const b = createTerrain(terrainInput('dust-moon'));
    const c = createTerrain(terrainInput('dust-moon', { nodeId: 'n4' }));
    let diff = 0;
    for (let i = 0; i < 50; i++) {
      const x = -60 + i * 2.3;
      const z = 40 - i * 1.7;
      expect(a.heightAt(x, z)).toBe(b.heightAt(x, z));
      diff += Math.abs(a.heightAt(x, z) - c.heightAt(x, z));
    }
    expect(diff).toBeGreaterThan(1);
  });

  it('la explanada de la nave es llana y el pie de la rampa está a nivel 0', () => {
    for (const worldId of Object.keys(TERRAIN_STYLES)) {
      const t = createTerrain(terrainInput(worldId));
      expect(Math.abs(t.heightAt(0, 0)), worldId).toBeLessThan(0.05);
      for (let dz = -14; dz <= 14; dz += 4) for (let dx = -4; dx <= 4; dx += 4) expect(Math.abs(t.heightAt(SHIP_CENTER.x + dx, SHIP_CENTER.z + dz)), worldId).toBeLessThan(0.05);
    }
  });

  it('un abismo separa lo cercano de lo lejano en casi todas las direcciones, con pasos para cruzar andando', () => {
    for (const worldId of Object.keys(TERRAIN_STYLES)) {
      const t = createTerrain(terrainInput(worldId));
      const depth = t.style.chasmDepthM;
      let blocked = 0;
      let open = 0;
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * Math.PI * 2;
        if (deepestAlong(t, a) < -depth * 0.6) blocked++;
        else open++;
      }
      expect(blocked / 72, worldId).toBeGreaterThan(0.6);
      // Con un solo anillo, los pasos dejan alguna dirección recta sin abismo (el fracturado obliga a rodear).
      if (t.style.rings === 1 && t.style.radialCracks === 0) expect(open, worldId).toBeGreaterThan(0);
      // Cada paso natural del primer anillo está a nivel.
      for (const f of t.rings[0]!.fords) {
        const r = t.rings[0]!.radiusM;
        expect(t.chasmAt(Math.cos(f) * r, Math.sin(f) * r), worldId).toBeLessThan(0.05);
      }
    }
  });

  it('las vetas nunca quedan en el fondo del abismo y una zona que cede abre un hoyo', () => {
    const world = getWorld('fractured-world');
    const t0 = createTerrain(terrainInput('fractured-world'));
    const ring = t0.rings[0]!;
    // Una veta justo en mitad del abismo (lejos de los pasos).
    const a = ring.fords[0]! + Math.PI / ring.fords.length;
    const dep = { x: Math.cos(a) * ring.radiusM, z: Math.sin(a) * ring.radiusM };
    const t = createTerrain(terrainInput('fractured-world', { deposits: [dep] }));
    expect(t.chasmAt(dep.x, dep.z)).toBeLessThan(0.05);
    const zone = { x: 30, z: 30, radiusM: 6, collapsed: false };
    const before = createTerrain(terrainInput('fractured-world', { zones: [zone] })).heightAt(30, 30);
    const after = createTerrain(terrainInput('fractured-world', { zones: [{ ...zone, collapsed: true }] })).heightAt(30, 30);
    expect(before - after).toBeCloseTo(world.unstable.pitDepthM, 0);
  });

  it('más allá del radio explorable sube una pared (frontera visible) y la rejilla cubre el área', () => {
    const t = createTerrain(terrainInput('storm-world'));
    const R = t.input.radiusM;
    expect(t.heightAt(R + 25, 0)).toBeGreaterThan(t.heightAt(R - 10, 0) + 10);
    const n = gridSizeFor(t);
    expect(n).toBeGreaterThanOrEqual(97);
    expect(n).toBeLessThanOrEqual(193);
    const grid = terrainGrid(t, n);
    expect(grid).toHaveLength(n * n);
    expect(grid[0]).toBeCloseTo(t.heightAt(-t.halfSizeM, -t.halfSizeM), 4);
    expect(grid[n * n - 1]).toBeCloseTo(t.heightAt(t.halfSizeM, t.halfSizeM), 4);
  });
});

describe('movimiento con jetpack', () => {
  const idle: MotionInput = { dirX: 0, dirZ: 0, run: false, jump: false, down: false, canThrust: true, windX: 0, windZ: 0, heightM: 0 };
  const limits = flightLimitsOf(rules);
  /** El movimiento tal como lo monta la escena (con el fondo más hondo del mundo). */
  const motionOf = (id: string) => surfaceMotion(getWorld(id).gravityMps2, limits, deepestDropM(id, getWorld(id).unstable.pitDepthM));
  const worlds = getSurfaceCatalog(catalog).worlds;

  /** Simula `seconds` en el aire (sin suelo) y devuelve la velocidad vertical. */
  function airborne(g: number, input: MotionInput, seconds: number, vy = 0) {
    const s = newMotionState();
    s.grounded = false;
    s.vy = vy;
    s.jumpWasDown = input.jump;
    const p = surfaceMotion(g);
    for (let t = 0; t < seconds; t += 1 / 60) stepMotion(s, input, p, 1 / 60);
    return s;
  }

  /**
   * Sale de un hoyo (perfil real `pitDropM`) desde el centro del fondo: salta y mantiene Espacio hacia la
   * pared. La pared bloquea en horizontal (como el controlador de Rapier) y los escalones pequeños se suben.
   */
  function escapePit(worldId: string, radiusM: number) {
    const w = getWorld(worldId);
    const g = w.gravityMps2;
    const depthM = w.unstable.pitDepthM;
    const p = motionOf(worldId);
    const ground = (x: number) => -pitDropM(Math.abs(x), radiusM, depthM);
    const rim = pitRimM(radiusM, depthM);
    const s = newMotionState();
    const inp: MotionInput = { ...idle, dirX: 1, run: true, jump: true };
    const dt = 1 / 60;
    let x = 0;
    let y = ground(0);
    let usedS = 0;
    for (let i = 0; i < 60 * 40; i++) {
      inp.canThrust = usedS < limits.tankS;
      // Se suelta Espacio en cuanto se asoma por encima del borde.
      inp.jump = y < 0.5;
      inp.heightM = y - ground(x);
      stepMotion(s, inp, p, dt);
      if (s.thrusting) usedS += dt;
      let nx = x + s.vx * dt;
      let ny = y + s.vy * dt;
      if (ny < ground(nx)) {
        if (ground(nx) - ny > 0.25) {
          nx = x;
          s.vx = 0;
        }
        ny = Math.max(ny, ground(nx));
      }
      const onGround = ny <= ground(nx) + 1e-6;
      settleMotion(s, onGround, false);
      x = nx;
      y = ny;
      if (onGround && ground(x) > -0.5 && i > 0) return { out: true, usedS, timeS: i * dt, depthM, rim };
    }
    return { out: false, usedS, x, y, depthM, rim };
  }

  it('aceleración neta hacia arriba manejable: 3-6 m/s² hasta gravedad media; en un mundo pesado apenas levanta', () => {
    for (const w of getSurfaceCatalog(catalog).worlds) {
      const net = jetpackNetUpMps2(w.gravityMps2);
      if (w.gravityMps2 <= 7) {
        expect(net, w.id).toBeGreaterThanOrEqual(3);
        expect(net, w.id).toBeLessThanOrEqual(6);
      } else expect(net, w.id).toBeLessThan(1.5);
      const p = surfaceMotion(w.gravityMps2);
      const s = airborne(w.gravityMps2, { ...idle, jump: true }, 0.25);
      expect(s.thrusting, w.id).toBe(true);
      expect(s.vy, w.id).toBeCloseTo(Math.min(net * 0.25, p.maxUpMps), 0);
    }
  });

  it('la velocidad vertical tiene tope al subir y al caer', () => {
    expect(airborne(1.6, { ...idle, jump: true }, 6).vy).toBeLessThanOrEqual(surfaceMotion(1.6).maxUpMps + 1e-9);
    expect(airborne(13, idle, 6).vy).toBeGreaterThanOrEqual(-26);
    expect(airborne(13, idle, 6).vy).toBeLessThan(-20);
  });

  it('sin combustible el jetpack no empuja', () => {
    const s = airborne(1.6, { ...idle, jump: true, canThrust: false }, 0.5);
    expect(s.thrusting).toBe(false);
    expect(s.vy).toBeLessThan(0);
  });

  it('en el aire se conserva la inercia y el control es reducido', () => {
    const p = surfaceMotion(1.6);
    const s = newMotionState();
    s.grounded = false;
    s.vx = 5;
    stepMotion(s, idle, p, 0.5);
    expect(s.vx).toBe(5);
    const g = newMotionState();
    stepMotion(g, { ...idle, dirX: -1 }, p, 0.1);
    const air = newMotionState();
    air.grounded = false;
    stepMotion(air, { ...idle, dirX: -1 }, p, 0.1);
    expect(Math.abs(air.vx)).toBeCloseTo(Math.abs(g.vx) * p.airControl, 5);
  });

  it('salto al pulsar (no al mantener) con margen coyote; el choque contra el suelo da la velocidad de caída', () => {
    const p = surfaceMotion(6);
    const s = newMotionState();
    stepMotion(s, { ...idle, jump: true }, p, 1 / 60);
    expect(s.vy).toBeGreaterThan(0);
    // Mantener sin soltar no vuelve a saltar al aterrizar.
    settleMotion(s, true, false);
    s.vy = 0;
    s.grounded = true;
    stepMotion(s, { ...idle, jump: true }, p, 1 / 60);
    expect(s.vy).toBeLessThanOrEqual(0);
    // Coyote: 80 ms después de dejar el suelo aún se puede saltar; 200 ms después, no.
    const late = newMotionState();
    late.grounded = false;
    late.airS = 0.08;
    stepMotion(late, { ...idle, jump: true }, p, 1 / 60);
    expect(late.vy).toBeCloseTo(p.jumpMps - p.gravityMps2 / 60, 5);
    const tooLate = newMotionState();
    tooLate.grounded = false;
    tooLate.airS = 0.2;
    stepMotion(tooLate, { ...idle, jump: true }, p, 1 / 60);
    expect(tooLate.vy).toBeLessThan(0);
    const falling = newMotionState();
    falling.grounded = false;
    falling.vy = -9;
    expect(settleMotion(falling, true, false)).toBe(9);
    expect(falling.vy).toBe(0);
    expect(falling.grounded).toBe(true);
  });

  // Tabla de los 7 mundos con las cifras del catálogo (tanque y umbrales de caída).
  it.each(worlds.map((w) => [w.id, w.gravityMps2] as const))('%s: salto corto, jetpack potente y vaciar el tanque no mata', (_id, g) => {
    const p = surfaceMotion(g, limits);
    const jump = simulateFlight(p, 0);
    expect(jump.airS).toBeLessThanOrEqual(MAX_JUMP_AIR_S + 0.05);
    expect(jump.peakM).toBeLessThan(1);
    expect(jump.impactMps).toBeLessThan(limits.harmlessMps);
    const full = simulateFlight(p, limits.tankS);
    expect(full.thrustS).toBeCloseTo(limits.tankS, 0);
    expect(full.peakM).toBeLessThanOrEqual(p.ceilingM + 0.1);
    expect(full.peakM).toBeGreaterThan(5);
    expect(full.impactMps).toBeLessThanOrEqual(fullTankImpactCapMps(limits) + 0.1);
    expect(full.impactMps).toBeLessThan(limits.lethalMps);
    // Medio tanque, nunca duele más que el tanque entero.
    expect(simulateFlight(p, limits.tankS / 2).impactMps).toBeLessThanOrEqual(full.impactMps + 0.1);
    // Potente: en gravedad baja y media sube a 4-5 m/s (no «un ascensor»); en el pesado, menos.
    if (g <= 7) expect(full.maxUpMps).toBeGreaterThanOrEqual(3.9);
    else expect(p.maxUpMps).toBeLessThan(4);
    // Volar es más rápido que correr.
    const flying = simulateFlight(p, 2, { run: true });
    expect(flying.maxSideMps).toBeGreaterThan(p.runMps * 1.3);
  });

  it('el abismo no se cruza de un salto en los planetas, pero con 2 s de jetpack y carrerilla sí (también en el pesado)', () => {
    for (const w of worlds) {
      const p = surfaceMotion(w.gravityMps2, limits);
      const style = TERRAIN_STYLES[w.id]!;
      const widest = style.chasmWidthM * 1.25;
      if (w.gravityMps2 >= 5) expect(simulateFlight(p, 0, { run: true }).distanceM, w.id).toBeLessThan(style.chasmWidthM * 0.8);
      expect(simulateFlight(p, 2, { run: true }).distanceM, w.id).toBeGreaterThan(widest);
    }
  });

  it.each(worlds.flatMap((w) => [[w.id, 'min'] as const, [w.id, 'max'] as const]))('%s: desde el fondo de un hoyo (zona de radio %s) se sale con el jetpack lleno', (id, which) => {
    const w = getWorld(id);
    const r = escapePit(id, w.unstable.radiusM[which]);
    expect(r.out, `${id}: ${JSON.stringify(r)}`).toBe(true);
    expect(r.usedS).toBeLessThan(limits.tankS);
  });

  it.each(worlds.map((w) => [w.id] as const))('%s: peor caso residual (al techo sobre el borde, encima del fondo más hondo, sin jetpack) no mata', (id) => {
    const w = getWorld(id);
    const p = motionOf(id);
    const drop = deepestDropM(id, w.unstable.pitDepthM);
    const worst = Math.sqrt(2 * w.gravityMps2 * (p.ceilingM + drop));
    expect(worst).toBeLessThanOrEqual(WORST_FALL_FRAC * limits.lethalMps + 1e-9);
    // Y el vuelo real hasta vaciar el tanque no pasa del techo.
    expect(simulateFlight(p, limits.tankS).peakM).toBeLessThanOrEqual(p.ceilingM + 0.1);
  });

  it('cayendo, Espacio frena hasta un aterrizaje suave (también en el mundo pesado)', () => {
    for (const w of worlds) {
      const p = surfaceMotion(w.gravityMps2, limits);
      const s = newMotionState();
      s.grounded = false;
      s.vy = -limits.lethalMps * 0.9;
      s.jumpWasDown = true;
      let t = 0;
      while (s.vy < -limits.harmlessMps * 0.5 && t < 10) {
        stepMotion(s, { ...idle, jump: true }, p, 1 / 60);
        t += 1 / 60;
      }
      expect(t, w.id).toBeLessThan(limits.tankS);
      expect(s.thrusting, w.id).toBe(true);
    }
  });

  it('estabilizador: al soltar el jetpack subiendo, el ascenso se corta enseguida (también en microgravedad)', () => {
    const p = surfaceMotion(0.4, limits);
    const s = newMotionState();
    s.grounded = false;
    s.vy = 4;
    s.jetUsed = true;
    let t = 0;
    while (s.vy > 0 && t < 5) {
      stepMotion(s, idle, p, 1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeLessThan(1.5);
    // Un salto sin jetpack sigue siendo balístico.
    const j = newMotionState();
    j.grounded = false;
    j.vy = p.jumpMps;
    stepMotion(j, idle, p, 0.1);
    expect(j.vy).toBeCloseTo(p.jumpMps - p.gravityMps2 * 0.1, 6);
  });

  it('C empuja hacia abajo en baja gravedad sin pasar de una caída inofensiva', () => {
    const p = surfaceMotion(0.4, limits);
    const free = airborne(0.4, idle, 1, 0.5);
    const down = airborne(0.4, { ...idle, down: true }, 1, 0.5);
    expect(down.vy).toBeLessThan(free.vy - 1);
    expect(down.thrusting).toBe(true);
    const long = airborne(0.4, { ...idle, down: true }, 6, 0);
    // Pasado el tope deja de empujar: solo la gravedad sigue acelerando.
    expect(long.thrusting).toBe(false);
    expect(-long.vy).toBeLessThan(p.downMaxMps + 0.4 * 6);
    expect(p.downMaxMps).toBeLessThan(limits.harmlessMps);
    // Sin combustible no empuja.
    expect(airborne(0.4, { ...idle, down: true, canThrust: false }, 1, 0.5).thrusting).toBe(false);
  });

  it('en la nave todo sigue como en la fase 1: sin salto ni jetpack, paso inmediato', () => {
    const s = newMotionState();
    stepMotion(s, { ...idle, dirZ: -1, jump: true }, SHIP_MOTION, 1 / 60);
    expect(s.vz).toBe(-SHIP_MOTION.walkMps);
    expect(s.vy).toBeLessThan(0);
    expect(s.thrusting).toBe(false);
  });
});

describe('reglas de la superficie en el cliente', () => {
  it('qué escena se pinta: descenso y EVA fuera; a bordo dentro', () => {
    expect(sceneFor('docked', 'ship', false)).toBe('ship');
    expect(sceneFor('landing', 'ship', true)).toBe('surface');
    expect(sceneFor('surface', 'ship', true)).toBe('surface');
    expect(sceneFor('surface', 'ship', false)).toBe('ship');
    expect(sceneFor('surface', 'eva', false)).toBe('surface');
    expect(sceneFor('lost', 'eva', false)).toBe('surface');
    expect(sceneFor('lost', 'ship', false)).toBe('ship');
    // Nave perdida en el descenso: la vista exterior no se queda bajo la pantalla final.
    expect(sceneFor('lost', 'ship', true)).toBe('ship');
  });

  it('la nave se localiza: distancia y ángulo respecto a la mirada', () => {
    // Mirando a −Z (yaw 0) con la nave detrás.
    expect(shipBearing(0, -10, 0)).toMatchObject({ distanceM: 10 });
    expect(Math.abs(shipBearing(0, -10, 0).angle)).toBeCloseTo(Math.PI, 5);
    // La nave delante.
    expect(shipBearing(0, 10, 0).angle).toBeCloseTo(0, 5);
    // A la derecha: la derecha de yaw 0 es +X; la nave (origen) está a +X si estoy en x = −5.
    expect(shipBearing(-5, 0, 0).angle).toBeCloseTo(Math.PI / 2, 5);
  });

  it('aviso de caída: antes del golpe, según la altura y el freno', () => {
    const g = 7;
    const harmless = rules.falls.harmlessMps;
    expect(predictedImpactMps(-2, 10, g)).toBeCloseTo(Math.sqrt(4 + 140), 5);
    expect(fallDanger(-2, 10, g, harmless)).toBe(true);
    expect(fallDanger(-2, 0.5, g, harmless)).toBe(false);
    // Subiendo no avisa; frenando con fuerza (aceleración neta hacia arriba) tampoco.
    expect(fallDanger(2, 30, g, harmless)).toBe(false);
    expect(fallDanger(-6, 10, -3, harmless)).toBe(false);
  });

  it('la brújula avisa cuando el O₂ ya no da con holgura (×1,5) para volver andando', () => {
    const drain = rules.suit.o2DrainPctPerS;
    const walk = 3.2;
    const need = o2ToReturnPct(64, drain, walk);
    expect(need).toBeCloseTo((64 / walk) * drain, 5);
    expect(o2ReturnShort(need * 1.6, 64, drain, walk)).toBe(false);
    expect(o2ReturnShort(need * 1.4, 64, drain, walk)).toBe(true);
    expect(o2ReturnShort(5, 0, drain, walk)).toBe(false);
  });

  it('las acciones de mantener se trocean con el tiempo real (a 4 FPS no tardan más)', () => {
    const sent: number[] = [];
    expect(sendInChunks(0.25, 0.5, (x) => (sent.push(x), true))).toBe(1);
    expect(sendInChunks(1.2, 0.5, (x) => (sent.push(x), true))).toBe(3);
    expect(sent.slice(1)).toEqual([0.5, 0.5, expect.closeTo(0.2, 9)]);
    // Si el motor rechaza, para.
    expect(sendInChunks(1.2, 0.5, () => false)).toBe(1);
    expect(sendInChunks(0, 0.5, () => true)).toBe(0);
  });

  it('respiración y pitidos: más rápidos cuanto menos oxígeno', () => {
    expect(breathIntervalS(80, rules.suit.lowO2Pct)).toBeGreaterThan(breathIntervalS(30, rules.suit.lowO2Pct));
    expect(breathIntervalS(30, rules.suit.lowO2Pct)).toBeGreaterThan(breathIntervalS(5, rules.suit.lowO2Pct));
    expect(o2BeepIntervalS(50, rules.suit.criticalO2Pct)).toBeNull();
    expect(o2BeepIntervalS(10, rules.suit.criticalO2Pct)!).toBeGreaterThan(o2BeepIntervalS(3, rules.suit.criticalO2Pct)!);
  });

  it('la guía de frenado: arriba se puede caer rápido; abajo hay que ir despacio', () => {
    const world = getWorld('dust-moon');
    const high = brakeThresholdMps(world, world.descent.altitudeM);
    const low = brakeThresholdMps(world, 0.5);
    expect(high).toBeGreaterThan(low);
    expect(low).toBeLessThan(rules.descent.safeSpeedMps + 1);
    expect(brakeThresholdMps(world, 0)).toBeLessThanOrEqual(rules.descent.safeSpeedMps);
  });

  it('la esclusa y la bodega están en la cubierta media sin pisar a otros puestos', () => {
    const a = STATIONS.airlock;
    expect(nearestStation(a.useX, a.useZ)).toBe('airlock');
    expect(Math.abs(CARGO_BAY.x)).toBeLessThan(5);
    for (const id of ['lifeSupport', 'shields', 'power'] as const) expect(Math.hypot(STATIONS[id].useX - a.useX, STATIONS[id].useZ - a.useZ)).toBeGreaterThan(2.5);
  });
});

describe('la salida completa (runStore + motor)', () => {
  it('aterrizar, salir, recoger, volver, guardar y despegar', () => {
    useGame.getState().startRun(7);
    const run = getRun()!;
    // Al destino aterrizable más cercano.
    expect(routeToLandable(run)).not.toBeNull();
    if (!run.estimateLanding()) expect(travelToLandable(run)).toBe(true);
    play(0.2);

    // Timón: ofrece aterrizar con mundo, gravedad y coste.
    const est = { landing: run.estimateLanding(), takeOff: run.estimateTakeOff() };
    const helm = interactionAt('helm', run.state, est);
    expect(helm).toMatchObject({ kind: 'land', canLand: true });
    expect(promptFor(helm, run.state, 0.5)).toMatchObject({ key: 'prompt.land', hold: true, progress: 0.5, params: { world: est.landing!.worldId } });
    const charged = chargedAction(helm)!;
    expect(charged.action).toEqual({ type: 'land' });
    expect(useGame.getState().act(charged.action).ok).toBe(true);
    expect(useGame.getState().hud?.phase).toBe('landing');
    expect(useUi.getState().descentView).toBe(true);
    expect(useCues.getState().captions.some((c) => c.key === 'sound.descent')).toBe(true);

    // Descenso con el perfil de referencia: suave.
    autoDescend(run);
    play(0.2);
    expect(useGame.getState().hud?.phase).toBe('surface');
    expect(useGame.getState().toasts.some((t) => t.message.key === 'event.landing.soft')).toBe(true);
    useUi.getState().setDescentView(false);
    expect(sceneFor(run.state.phase, run.state.crew[0]!.location, false)).toBe('ship');

    // A bordo: la esclusa abre; el timón ofrece despegar.
    const airlock = interactionAt('airlock', run.state);
    expect(airlock).toMatchObject({ kind: 'airlock', open: true });
    expect(interactionAt('helm', run.state, { takeOff: run.estimateTakeOff() })).toMatchObject({ kind: 'takeoff', enoughFuel: true, canJettison: false });
    expect(useGame.getState().act(chargedAction(airlock)!.action).ok).toBe(true);
    expect(run.state.crew[0]!.location).toBe('eva');
    expect(sceneFor(run.state.phase, 'eva', false)).toBe('surface');
    expect(surfaceInteractionAt(run.state, 0, 0)).toMatchObject({ kind: 'enter' });

    // A la veta más cercana, informando de la posición como la escena (a 10 Hz, como mucho a 6 m/s).
    const target = [...run.state.surface!.deposits].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0]!;
    const walkTo = (x: number, z: number) => {
      for (let i = 0; i < 400; i++) {
        const m = run.state.crew[0]!;
        const d = Math.hypot(x - m.x, z - m.z);
        if (d < 0.5) break;
        const k = Math.min(1, 0.6 / d);
        useGame.getState().act({ type: 'set-position', x: m.x + (x - m.x) * k, z: m.z + (z - m.z) * k, grounded: true }, true);
        play(0.1);
      }
    };
    walkTo(target.x, target.z);
    const near = surfaceInteractionAt(run.state, run.state.crew[0]!.x, run.state.crew[0]!.z);
    expect(near).toMatchObject({ kind: 'collect', full: false });
    expect(surfacePromptFor(near)).toMatchObject({ key: 'prompt.collect', hold: true, params: { material: target.materialId } });
    // Mantener E hasta arrancar una unidad.
    for (let i = 0; i < 600 && run.state.crew[0]!.carriedKg === 0; i++) {
      useGame.getState().act({ type: 'collect', depositId: target.id, seconds: 1 / 30 }, true);
      play(1 / 30);
    }
    expect(run.state.crew[0]!.carriedKg).toBeGreaterThan(0);
    expect(useCues.getState().captions.some((c) => c.key === 'sound.collect')).toBe(true);

    // De vuelta a la rampa y dentro.
    walkTo(0, 0);
    expect(surfacePromptFor(surfaceInteractionAt(run.state, run.state.crew[0]!.x, run.state.crew[0]!.z), 0.5)).toMatchObject({ key: 'prompt.enterCargo', progress: 0.5 });
    expect(ENTER_HOLD_S).toBeGreaterThan(0);
    expect(useGame.getState().act({ type: 'eva-enter' }).ok).toBe(true);
    expect(run.state.crew[0]!.location).toBe('ship');
    expect(run.state.stats.materialsStored).toBeGreaterThan(0);
    // Volver a salir rellena el traje con O₂ de la nave: la esclusa deja ver el coste (lo calcula el motor).
    const again = interactionAt('airlock', run.state);
    expect(again).toMatchObject({ kind: 'airlock', open: true });
    const cost = again?.kind === 'airlock' ? (again.refill?.shipO2Cost ?? 0) : 0;
    expect(cost).toBeGreaterThanOrEqual(1);
    expect(promptFor(again, run.state)).toMatchObject({ key: 'prompt.airlockExit', badges: [{ key: 'prompt.exitCost', params: { cost: Math.round(cost) } }] });

    // Despegue.
    const off = interactionAt('helm', run.state, { takeOff: run.estimateTakeOff() });
    expect(off).toMatchObject({ kind: 'takeoff', enoughFuel: true });
    // Queda botín en el suelo: el aviso del timón lo deja ver (no se puede volver a este nodo).
    const left = run.state.surface!.deposits.reduce((n, d) => n + d.units, 0);
    expect(left).toBeGreaterThan(0);
    expect(promptFor(off, run.state)).toMatchObject({ key: 'prompt.takeOff', badges: [{ key: 'prompt.lootLeft', params: { units: left } }] });
    expect(useGame.getState().act(chargedAction(off)!.action).ok).toBe(true);
    expect(useGame.getState().hud?.phase).toBe('docked');
    expect(useCues.getState().captions.some((c) => c.key === 'sound.takeOff')).toBe(true);
    // No se puede volver a aterrizar en el mismo destino.
    expect(interactionAt('helm', run.state, { landing: run.estimateLanding() })).toMatchObject({ kind: 'helm' });
  });

  it('un aterrizaje sin frenar es brusco: sacude la cámara y suena el golpe', () => {
    useGame.getState().startRun(7);
    const run = getRun()!;
    expect(reachSurface(run, 'descent')).toBe(true);
    play(0.1);
    fx.shake = 0;
    for (let i = 0; i < 4000 && run.state.phase === 'landing'; i++) play(0.1, 0.1);
    expect(['surface', 'lost']).toContain(run.state.phase);
    expect(run.state.surface?.hardLanding ?? true).toBe(true);
    expect(useCues.getState().captions.some((c) => c.key === 'sound.landHard' || c.key === 'sound.impact')).toBe(true);
  });

  it('soltar carga desde el timón cuando pesa demasiado (Q)', () => {
    const run = createRun({ seed: 7 });
    expect(reachSurface(run, 'landed')).toBe(true);
    const s = run.state as RunState;
    const heavy = interactionAt('helm', { ...s }, { takeOff: { fuel: 30, fuelEmpty: 5, loadedKg: 40, enoughFuel: false, enoughFuelEmpty: true } });
    expect(heavy).toMatchObject({ kind: 'takeoff', enoughFuel: false, heavy: true, canJettison: true });
    expect(promptFor(heavy, s)).toMatchObject({ key: 'prompt.takeOffHeavy', blocked: true, altKey: 'prompt.jettison' });
    expect(chargedAction(heavy)).toBeNull();
    expect(altAction(heavy, s)).toEqual({ type: 'jettison' });
  });

  it('avisos legibles de lo que el motor rechaza o cobra: esclusa a medias, O₂ bajo al despegar, sin motores, recoger en el aire', () => {
    const run = createRun({ seed: 11 });
    expect(reachSurface(run, 'landed')).toBe(true);
    const st = run.state;
    // Traje a medias y la nave sin O₂ que ceder: la esclusa avisa en ámbar con cuánto se sale.
    st.crew[0]!.suitO2Pct = 30;
    st.ship.oxygenPct = getSurfaceCatalog(catalog).rules.suit.refillMinShipO2Pct + 1;
    const exit = promptFor(interactionAt('airlock', st, {}, run.catalog), st);
    expect(exit).toMatchObject({ key: 'prompt.airlockExit', warn: true, badges: [{ key: 'prompt.exitShort', tone: 'warn' }] });
    expect(Number(exit!.badges![0]!.params!.suit)).toBeLessThan(100);
    // Despegar con la nave baja de O₂: se ve.
    const off = promptFor(interactionAt('helm', st, { takeOff: run.estimateTakeOff() }, run.catalog), st);
    expect(off?.badges?.some((b) => b.key === 'prompt.shipO2' && b.tone === 'warn')).toBe(true);
    // Recoger en el aire: bloqueado (el motor lo rechaza con `reject.collectAirborne`).
    const dep = st.surface!.deposits[0]!;
    const near = { kind: 'collect' as const, deposit: dep, full: false };
    expect(surfacePromptFor(near, 0, true)).toMatchObject({ key: 'prompt.collectAirborne', blocked: true });
    expect(surfacePromptFor(near, 0, false)).toMatchObject({ key: 'prompt.collect' });
  });

  it('sin motores no se puede iniciar el descenso (y se dice por qué)', () => {
    const run = createRun({ seed: 7 });
    if (!run.estimateLanding()) expect(travelToLandable(run)).toBe(true);
    run.state.ship.systems.engines.online = false;
    const land = interactionAt('helm', run.state, { landing: run.estimateLanding() });
    expect(land).toMatchObject({ kind: 'land', canLand: false, engines: false });
    expect(promptFor(land, run.state)).toMatchObject({ key: 'prompt.landNoEngines', blocked: true });
    expect(chargedAction(land)).toBeNull();
  });

  it('el atajo de depuración llega a la superficie y sale', () => {
    const run = createRun({ seed: 11 });
    expect(reachSurface(run)).toBe(true);
    expect(run.state.phase).toBe('surface');
    expect(run.state.crew[0]!.location).toBe('eva');
    expect(getNodeWorld(run.state.seed, run.state.sector, run.state.locationId, run.catalog)?.id).toBe(run.state.surface!.worldId);
  });
});

describe('audio y música de la superficie', () => {
  it('cada evento nuevo del motor suena y tiene su subtítulo', () => {
    const cases: [Parameters<typeof sfxForRunEvent>[0], string][] = [
      [{ type: 'descent' }, 'descent'],
      [{ type: 'landing', subtype: 'soft' }, 'landSoft'],
      [{ type: 'landing', subtype: 'hard' }, 'landHard'],
      [{ type: 'airlock', subtype: 'exit' }, 'airlock'],
      [{ type: 'airlock', subtype: 'enter' }, 'airlock'],
      [{ type: 'material-collected' }, 'collect'],
      [{ type: 'cargo-stored', subtype: 'stored' }, 'store'],
      [{ type: 'storm-warning' }, 'stormWarn'],
      [{ type: 'storm-start' }, 'storm'],
      [{ type: 'terrain-warning' }, 'crack'],
      [{ type: 'terrain-collapsed' }, 'collapse'],
      [{ type: 'suit-o2', subtype: 'low' }, 'o2Low'],
      [{ type: 'suit-o2', subtype: 'critical' }, 'o2Critical'],
      [{ type: 'suit-damaged' }, 'suitHit'],
      [{ type: 'crew-dead', subtype: 'oxygen' }, 'crewDead'],
      [{ type: 'crew-dead', subtype: 'fall' }, 'crewDead'],
      [{ type: 'take-off' }, 'takeOff'],
      [{ type: 'jettison' }, 'jettison'],
    ];
    // Procesar en suministros llega junto a «guardado»: no suena dos veces.
    expect(sfxForRunEvent({ type: 'cargo-stored', subtype: 'processed' })).toBeNull();
    // El subtipo manda, no el tono.
    expect(sfxForRunEvent({ type: 'landing', subtype: 'soft', tone: 'bad' })).toBe('landSoft');
    for (const [event, id] of cases) {
      expect(sfxForRunEvent(event), event.type).toBe(id);
      expect(SFX_META[id as keyof typeof SFX_META].captionKey, id).not.toBeNull();
    }
    // Los avisos de peligro destellan en pantalla (no dependen solo del sonido).
    for (const id of ['landHard', 'stormWarn', 'crack', 'collapse', 'o2Low', 'o2Critical', 'suitHit'] as const) expect(SFX_META[id].flash).not.toBeNull();
  });

  it('la sacudida acompaña al golpe: más fuerte cuanto más rápido', () => {
    const hard = (speed: number) => shakeForEvent({ type: 'landing', subtype: 'hard', message: { key: 'event.landing.hard', params: { speed } } });
    expect(hard(14)).toBeGreaterThan(hard(7));
    expect(shakeForEvent({ type: 'landing', subtype: 'soft', message: { key: 'event.landing.soft' } })).toBeLessThan(hard(7));
    expect(shakeForEvent({ type: 'jettison', message: { key: 'event.jettison' } })).toBe(0);
  });

  it('la música sigue el descenso y el oxígeno del traje', () => {
    expect(musicMixFor({ screen: 'game', phase: 'landing', danger: 0 }).drive).toBeGreaterThan(0.3);
    const base = { incidents: 0, warnings: 0, overloaded: false, hullPct: 100, oxygenPct: 100 };
    expect(dangerLevel({ ...base, suitO2Pct: 90 })).toBe(0);
    expect(dangerLevel({ ...base, suitO2Pct: 10 })).toBeGreaterThan(0.5);
    expect(dangerLevel({ ...base, storm: 1 })).toBeGreaterThan(0);
    const calm = musicMixFor({ screen: 'game', phase: 'surface', outside: true, danger: 0 });
    const scared = musicMixFor({ screen: 'game', phase: 'surface', outside: true, danger: 1 });
    expect(scared.tension).toBeGreaterThan(calm.tension);
  });
});
