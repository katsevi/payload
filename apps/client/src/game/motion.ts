/**
 * Movimiento del tripulante (lógica PURA): velocidades a partir de las teclas, la gravedad y el
 * jetpack. Las colisiones las resuelve después el controlador cinemático de Rapier en `PlayerController`.
 *
 * En la nave: gravedad fija, sin salto, el paso horizontal sigue a las teclas al instante (igual que en
 * la fase 1). En la superficie: gravedad del mundo, salto corto, jetpack con inercia y poco control en el aire.
 *
 * Jetpack: sube rápido (4-5 m/s en gravedad baja y media) y empuja de lado (más velocidad y control que en
 * caída libre). Lo que impide un vuelo mortal no es un tope de velocidad bajo sino un TECHO DE ALTURA sobre el
 * terreno: cerca de él, el empuje solo deja subir a la velocidad con la que el impulso aún se agotaría antes
 * del techo (v ≤ √(2g·(techo − altura))). Así el punto más alto de un vuelo nunca pasa del techo y soltarse
 * desde ahí no mata. El techo es relativo al suelo de debajo: pegado a una pared se puede seguir subiendo.
 */

import { catalog as defaultCatalog, getSurfaceCatalog, type SurfaceRules } from '@payload/shared';

export interface MotionParams {
  gravityMps2: number;
  walkMps: number;
  runMps: number;
  /** Aceleración horizontal en el suelo (Infinity = sigue a las teclas al instante). */
  groundAccelMps2: number;
  /** Fracción del control horizontal en el aire. */
  airControl: number;
  /** Velocidad vertical del salto (0 = sin salto). */
  jumpMps: number;
  /** Aceleración del jetpack (bruta, contando la gravedad). 0 = sin jetpack. */
  thrustMps2: number;
  /** Techo de la velocidad que da el jetpack al subir (no recorta el salto). */
  maxUpMps: number;
  /** Altura sobre el suelo de debajo que un vuelo no puede superar (Infinity = sin techo). */
  ceilingM: number;
  /** Velocidad horizontal con el jetpack empujando (0 = la de correr) y su fracción de control. */
  jetMps: number;
  jetAirControl: number;
  maxFallMps: number;
  /** Margen para saltar justo después de dejar el suelo. */
  coyoteS: number;
  /** Freno: aceleración neta mínima hacia arriba con Espacio mientras se cae. */
  brakeNetMps2: number;
  /** Empuje hacia abajo (C), sumado a la gravedad; 0 = sin él. */
  downThrustMps2: number;
  /** El empuje hacia abajo no pasa de esta velocidad de caída (por debajo del golpe que duele). */
  downMaxMps: number;
}

export const SHIP_MOTION: MotionParams = {
  gravityMps2: 12,
  walkMps: 3.2,
  runMps: 5.5,
  groundAccelMps2: Infinity,
  airControl: 1,
  jumpMps: 0,
  thrustMps2: 0,
  maxUpMps: 0,
  ceilingM: Infinity,
  jetMps: 0,
  jetAirControl: 0,
  maxFallMps: 20,
  coyoteS: 0,
  brakeNetMps2: 0,
  downThrustMps2: 0,
  downMaxMps: 0,
};

/**
 * Aceleración neta hacia arriba con el jetpack: 3 m/s² en microgravedad, 6 m/s² hacia 7 m/s² y, por
 * encima, cada vez menos: en un mundo pesado apenas levanta (se nota, pero no deja de responder).
 */
export function jetpackNetUpMps2(g: number): number {
  if (g <= 7) return 3 + 3 * (Math.max(0, g) / 7);
  return Math.max(0.5, 6 - (g - 7));
}

/** Un salto dura como mucho esto (en microgravedad se recorta la velocidad del salto). */
export const MAX_JUMP_AIR_S = 2;
/** Techo de vuelo sobre el terreno (en baja gravedad manda este, no el golpe de la caída). */
export const MAX_FLIGHT_HEIGHT_M = 15;
/** El techo se queda en esta fracción de la altura cuya caída daría el golpe permitido (margen numérico). */
const CEILING_MARGIN = 0.97;
/**
 * Peor caso residual: el techo es relativo al suelo de debajo, así que volando al techo sobre el borde y
 * pasando por encima de un abismo (o un hoyo) se queda a techo + profundidad del fondo. Quedarse ahí sin
 * jetpack debe golpear por debajo de esta fracción del golpe mortal.
 */
export const WORST_FALL_FRAC = 0.95;
/** En microgravedad el techo deja estos metros de subida a tope antes de empezar a frenar el ascenso. */
const MICRO_G_CLIMB_M = 5;
/** Velocidad horizontal volando respecto a la de correr. */
export const JET_SPEED_MULT = 1.5;
/**
 * El peor vuelo «normal» (todo el tanque hacia arriba y dejarse caer) golpea a esta fracción del tramo
 * entre el golpe inofensivo y el mortal: duele, pero no mata. Abusar (despegar desde un risco, caer a un
 * abismo) sí puede matar; para eso está el freno.
 */
export const FULL_TANK_IMPACT_FRAC = 0.6;
/** El freno (Espacio cayendo) decelera al menos esto, también en el mundo pesado. */
export const BRAKE_NET_MIN_MPS2 = 4;

/** Lo que necesita el movimiento de las reglas del catálogo. */
export interface FlightLimits {
  harmlessMps: number;
  lethalMps: number;
  /** Segundos de empuje con el tanque lleno (`100 / drainPctPerS`). */
  tankS: number;
}

export function flightLimitsOf(rules: SurfaceRules = getSurfaceCatalog(defaultCatalog).rules): FlightLimits {
  return { harmlessMps: rules.falls.harmlessMps, lethalMps: rules.falls.lethalMps, tankS: 100 / Math.max(1e-6, rules.jetpack.drainPctPerS) };
}

/** Velocidad de impacto que se permite al peor vuelo normal. */
export function fullTankImpactCapMps(l: FlightLimits): number {
  return l.harmlessMps + FULL_TANK_IMPACT_FRAC * (l.lethalMps - l.harmlessMps);
}

export interface FlightResult {
  peakM: number;
  airS: number;
  impactMps: number;
  /** Segundos de empuje gastados. */
  thrustS: number;
  /** Metros recorridos en horizontal (con `run`, saliendo a la carrera). */
  distanceM: number;
  /** Velocidad máxima de subida y horizontal alcanzadas. */
  maxUpMps: number;
  maxSideMps: number;
}

/**
 * Simula en llano un salto manteniendo Espacio hasta gastar `thrustS` segundos de jetpack (0 = solo el
 * salto) y soltando después. Con `run` sale a la carrera y sigue empujando hacia delante. Es la misma
 * `stepMotion` que usa el juego.
 */
export function simulateFlight(p: MotionParams, thrustS: number, opts: { run?: boolean; dt?: number } = {}): FlightResult {
  const dt = opts.dt ?? 1 / 60;
  const s = newMotionState();
  const run = !!opts.run;
  if (run) s.vx = p.runMps;
  const input: MotionInput = { dirX: run ? 1 : 0, dirZ: 0, run, jump: true, down: false, canThrust: true, windX: 0, windZ: 0, heightM: 0 };
  let y = 0;
  let x = 0;
  const r: FlightResult = { peakM: 0, airS: 0, impactMps: 0, thrustS: 0, distanceM: 0, maxUpMps: 0, maxSideMps: 0 };
  for (let i = 0; i < 200_000; i++) {
    input.jump = i === 0 || r.thrustS < thrustS;
    input.heightM = y;
    stepMotion(s, input, p, dt);
    if (s.thrusting) r.thrustS += dt;
    y += s.vy * dt;
    x += s.vx * dt;
    r.airS += dt;
    r.peakM = Math.max(r.peakM, y);
    r.maxUpMps = Math.max(r.maxUpMps, s.vy);
    r.maxSideMps = Math.max(r.maxSideMps, Math.abs(s.vx));
    if (y <= 0 && i > 0) break;
  }
  r.impactMps = -s.vy;
  r.distanceM = x;
  return r;
}

/** Velocidad máxima de subida con el jetpack: 4-4,5 m/s; en el mundo pesado baja (levanta poco). */
export function jetpackMaxUpMps(g: number): number {
  if (g < 1) return 4;
  if (g <= 7) return 4.5;
  return Math.max(3, 4.5 - 0.25 * (g - 7));
}

/**
 * Física del tripulante en un mundo de gravedad `g` con las cifras del catálogo (`flightLimitsOf`). El
 * techo de vuelo es el menor entre `MAX_FLIGHT_HEIGHT_M` (o lo que pida subir a tope en microgravedad) y la
 * altura cuya caída libre daría `fullTankImpactCapMps`: vaciar el tanque y soltarse duele, pero no mata.
 */
export function surfaceMotion(g: number, limits: FlightLimits = flightLimitsOf(), dropM = 0): MotionParams {
  const heavy = g > 9 ? 0.8 : 1;
  const net = jetpackNetUpMps2(g);
  const maxUp = jetpackMaxUpMps(g);
  const cap = fullTankImpactCapMps(limits);
  const fallFor = (v: number) => (v * v) / (2 * Math.max(0.01, g));
  // Lo que se puede caer: el golpe permitido en llano y, contando el fondo más hondo del mundo (`dropM`),
  // nunca cerca de lo mortal.
  const safeFallM = Math.min(fallFor(cap), fallFor(WORST_FALL_FRAC * limits.lethalMps) - Math.max(0, dropM));
  const runMps = 5.5 * heavy;
  return {
    gravityMps2: g,
    walkMps: 3.2 * heavy,
    runMps,
    // En baja gravedad se resbala (poco agarre); en alta se para en seco.
    groundAccelMps2: Math.min(40, 12 + 3 * g),
    airControl: 0.4,
    // Salto corto: nunca más de `MAX_JUMP_AIR_S` en el aire (t = 2v/g).
    jumpMps: Math.min(4, Math.max(1.2, Math.sqrt(2 * g * 0.7)), (g * MAX_JUMP_AIR_S) / 2),
    thrustMps2: g + net,
    maxUpMps: maxUp,
    ceilingM: CEILING_MARGIN * Math.min(safeFallM, Math.max(MAX_FLIGHT_HEIGHT_M, (maxUp * maxUp) / (2 * Math.max(0.01, g)) + MICRO_G_CLIMB_M)),
    jetMps: runMps * JET_SPEED_MULT,
    jetAirControl: 1,
    maxFallMps: 26,
    coyoteS: 0.12,
    brakeNetMps2: Math.max(net, BRAKE_NET_MIN_MPS2),
    downThrustMps2: net,
    downMaxMps: limits.harmlessMps * 0.85,
  };
}

export interface MotionState {
  vx: number;
  vy: number;
  vz: number;
  /** Tocaba suelo en el último paso (lo fija quien resuelve colisiones). */
  grounded: boolean;
  /** Segundos desde que dejó el suelo. */
  airS: number;
  /** El jetpack empuja en este paso. */
  thrusting: boolean;
  /** Espacio pulsado en el paso anterior (el salto se dispara al pulsar, no al mantener). */
  jumpWasDown: boolean;
  /** Se ha usado el jetpack desde que dejó el suelo (activa el estabilizador al soltar). */
  jetUsed: boolean;
}

export interface MotionInput {
  /** Dirección deseada en el mundo (unitaria o 0). */
  dirX: number;
  dirZ: number;
  run: boolean;
  jump: boolean;
  /** Empuje hacia abajo (C). */
  down: boolean;
  /** Queda jetpack (lo dice el motor). */
  canThrust: boolean;
  /** Empuje lateral (m/s) que se suma al desplazamiento (tormenta). */
  windX: number;
  windZ: number;
  /** Altura de los pies sobre el suelo de debajo (m); la usa el techo de vuelo. */
  heightM: number;
}

export const newMotionState = (): MotionState => ({ vx: 0, vy: 0, vz: 0, grounded: true, airS: 0, thrusting: false, jumpWasDown: false, jetUsed: false });

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

/** Avanza las velocidades `dt` segundos. Muta `s`. */
export function stepMotion(s: MotionState, input: MotionInput, p: MotionParams, dt: number): void {
  const moving = input.dirX !== 0 || input.dirZ !== 0;

  s.airS = s.grounded ? 0 : s.airS + dt;
  const pressed = input.jump && !s.jumpWasDown;
  s.jumpWasDown = input.jump;

  // Vertical
  s.thrusting = false;
  if (p.jumpMps > 0 && pressed && s.airS <= p.coyoteS && s.vy <= 0.5) {
    s.vy = p.jumpMps;
    s.grounded = false;
    s.airS = p.coyoteS + dt;
  }
  const g = p.gravityMps2;
  const jet = !s.grounded && input.canThrust && p.thrustMps2 > 0;
  if (jet && input.jump && !pressed) {
    s.thrusting = true;
    // Cayendo, Espacio frena con fuerza (aterrizaje suave); subiendo, el empuje no pasa del techo.
    const net = s.vy < 0 ? Math.max(p.thrustMps2 - g, p.brakeNetMps2) : p.thrustMps2 - g;
    // Techo: cerca de él solo se sube a la velocidad que el impulso agota antes de llegar.
    const vCap = Math.min(p.maxUpMps, Math.sqrt(2 * g * Math.max(0, p.ceilingM - input.heightM)));
    const v = s.vy + net * dt;
    s.vy = v > vCap ? Math.max(vCap, s.vy - g * dt) : v;
  } else if (jet && input.down && p.downThrustMps2 > 0 && s.vy > -p.downMaxMps) {
    // Bajar antes (baja gravedad): empuje hacia abajo hasta una caída que no duele.
    s.thrusting = true;
    const free = s.vy - g * dt;
    s.vy = Math.min(free, Math.max(-p.downMaxMps, s.vy - (g + p.downThrustMps2) * dt));
  } else if (s.jetUsed && !s.grounded && s.vy > 0) {
    // Estabilizador: al soltar el jetpack subiendo, el traje corta el ascenso (en microgravedad no se
    // sigue flotando hacia arriba durante segundos). No gasta combustible.
    s.vy = Math.max(0, s.vy - (g + p.downThrustMps2) * dt);
  } else {
    s.vy -= g * dt;
  }
  if (s.thrusting) s.jetUsed = true;
  else if (s.grounded) s.jetUsed = false;
  s.vy = Math.max(s.vy, -p.maxFallMps);

  // Horizontal
  const jetting = s.thrusting && p.jetMps > 0;
  const speed = jetting ? p.jetMps : input.run ? p.runMps : p.walkMps;
  const tx = input.dirX * speed;
  const tz = input.dirZ * speed;
  if (s.grounded) {
    if (!Number.isFinite(p.groundAccelMps2)) {
      s.vx = tx;
      s.vz = tz;
    } else {
      const step = p.groundAccelMps2 * dt;
      s.vx = approach(s.vx, tx, step);
      s.vz = approach(s.vz, tz, step);
    }
  } else if (moving) {
    // En el aire se conserva la inercia y solo se corrige un poco hacia donde se pulsa.
    // Con el jetpack empujando, más velocidad y control (es la forma rápida de cruzar).
    const step = (Number.isFinite(p.groundAccelMps2) ? p.groundAccelMps2 : 30) * (jetting ? p.jetAirControl : p.airControl) * dt;
    s.vx = approach(s.vx, tx, step);
    s.vz = approach(s.vz, tz, step);
  }
}

/** El controlador de colisiones ha resuelto el paso: actualiza el estado y devuelve la velocidad de choque contra el suelo (0 si no hubo). */
export function settleMotion(s: MotionState, groundedNow: boolean, blockedUp: boolean): number {
  let impact = 0;
  if (groundedNow && s.vy <= 0) {
    if (!s.grounded) impact = -s.vy;
    s.vy = 0;
  }
  if (blockedUp && s.vy > 0) s.vy = 0;
  s.grounded = groundedNow && s.vy <= 0;
  return impact;
}
