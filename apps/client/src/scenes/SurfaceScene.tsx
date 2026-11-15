import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { Vector3, type Group, type Points } from 'three';
import { getSurfaceCatalog, getWorld } from '@payload/shared';
import { audio } from '../audio/audioEngine';
import { cue } from '../audio/cues';
import { flightLimitsOf, surfaceMotion, type MotionParams } from '../game/motion';
import { fx, getRun, shipSpawn, useGame } from '../game/runStore';
import {
  AIRLOCK_INSIDE,
  breathIntervalS,
  ENTER_HOLD_S,
  EVA_START,
  fallDanger,
  o2BeepIntervalS,
  o2RouteStatus,
  nearestTool,
  SHIP_CENTER,
  SHIP_OFFSET,
  STORM_WIND_MPS,
  stormLevel,
  nearestReadyTool,
  surfaceAltAction,
  surfaceInteractionAt,
  surfacePromptFor,
  surfaceUseAction,
} from '../game/surfaceRules';
import { seedGeometry } from '../gfx/fxShaders';
import { ShaderClock } from '../gfx/Glow';
import { dustMaterial } from '../gfx/surfaceShaders';
import { surfaceLook } from '../gfx/surfaceLook';
import { PlayerController } from '../player/PlayerController';
import { attachKeyboard, isDown } from '../player/input';
import { motionEnv, playerState, resetPlayerState } from '../player/playerState';
import { useSettings } from '../state/settings';
import { hudView, revealScene, useUi } from '../state/ui';
import { ShipExterior } from './ShipExterior';
import { LodeFinishers, SurfaceTools } from './SurfaceTools';
import { deepestDropM } from '../game/terrain';
import { liveTerrain, SurfaceWorld, windAngleOf } from './SurfaceWorld';
import { effectiveRulesOf } from '../game/effective';
import { myCrew } from '../game/me';
import { KEY_PING, reportPose, sendPing } from '../net/coopSession';
import { CrewAvatars } from './CrewAvatars';
import { ShaderWarmup, useAdaptiveDpr } from '../gfx/quality';

const isTyping = (e: KeyboardEvent): boolean => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
};

/** Cada cuánto se informa la posición al motor (no hace falta cada frame). */
const POSITION_EVERY_S = 0.1;
/** Golpes contra el suelo por debajo de esto no se informan (el motor los ignora igualmente). */
const REPORT_IMPACT_MPS = 3;
/** Segundos de vista exterior tras tocar tierra antes de volver al puente. */
const TOUCHDOWN_LINGER_S = 2.8;

/** V (vista), H (ayuda) y Esc → pausa. Comunes a la descenso y a la EVA. */
function useSceneKeys(pauseOnUnlock: boolean) {
  const { gl } = useThree();
  const wasLocked = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isTyping(e)) return;
      const ui = useUi.getState();
      if (e.code === 'KeyV' && ui.overlay === null) ui.toggleView();
      else if (e.code === 'KeyH' || e.code === 'F1') {
        e.preventDefault();
        if (ui.overlay === null || ui.overlay === 'help') ui.toggleOverlay('help');
      } else if (e.code === 'Escape' && !pauseOnUnlock && ui.overlay === null) ui.setOverlay('pause');
      else if (e.code === 'Space' && ui.overlay === null) e.preventDefault();
      else if (e.code === KEY_PING && ui.overlay === null && pauseOnUnlock) sendPing('look', playerState.pos.x, playerState.pos.y, playerState.pos.z, 'surface');
    };
    const onLock = () => {
      const phase = getRun()?.state.phase;
      if (pauseOnUnlock && document.pointerLockElement === null && useUi.getState().overlay === null && wasLocked.current && (phase === 'surface' || phase === 'landing')) {
        useUi.getState().setOverlay('pause');
      }
      wasLocked.current = document.pointerLockElement !== null;
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerlockchange', onLock);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerlockchange', onLock);
    };
  }, [gl, pauseOnUnlock]);
}

/** Al cambiar de escena no se arrastran sacudidas, avisos de acción ni el estado del jugador. */
function useSceneCleanup() {
  useEffect(
    () => () => {
      fx.shake = 0;
      useUi.getState().setPrompt(null);
      audio.stopLoop('jetpack', 0.1);
      audio.stopLoop('thruster', 0.2);
      audio.stopLoop('wind', 0.4);
      hudView.fallDanger = false;
      hudView.o2Short = false;
      resetPlayerState();
    },
    [],
  );
}

// ─── Descenso ────────────────────────────────────────────────────────────────────────────────────

/**
 * Minijuego del descenso: la nave baja hacia la superficie vista desde fuera; mantener Espacio (o E)
 * enciende los propulsores de frenado. Tras tocar tierra se queda unos segundos y vuelve al puente.
 */
function DescentLoop({ ship, dust }: { ship: RefObject<Group | null>; dust: { strength: { value: number } } }) {
  const { camera } = useThree();
  const braking = useRef(false);
  const landedAt = useRef<number | null>(null);
  const clock = useRef(0);
  const target = useMemo(() => new Vector3(), []);
  const orbit = useRef(0.75);
  useSceneKeys(false);
  useSceneCleanup();
  // Sin controlador de personaje en el descenso: el teclado se escucha aquí.
  useEffect(() => attachKeyboard(), []);
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    clock.current = state.clock.elapsedTime;
    const game = useGame.getState();
    game.tick(dt);
    const s = getRun()?.state;
    if (!s) return;
    const ui = useUi.getState();
    const d = s.surface?.descent;
    // Frenar: un único control mantenido.
    const want = !!d && ui.overlay === null && (isDown('Space') || isDown('KeyE'));
    if (d && want !== d.brake) game.act({ type: 'set-descent-brake', on: want }, true);
    const firing = !!d && want && s.ship.systems.engines.online && s.ship.fuel > 0;
    if (firing && !braking.current) cue('thruster');
    if (!firing && braking.current) audio.stopLoop('thruster', 0.25);
    braking.current = firing;
    if (firing) fx.shake = Math.max(fx.shake, 0.12);

    const alt = d?.altitudeM ?? 0;
    const g = ship.current;
    if (g) g.position.y = SHIP_OFFSET.y + alt;
    // Polvo del suelo cuando los propulsores lo alcanzan, y al tocar tierra.
    const near = Math.max(0, 1 - alt / 30);
    dust.strength.value += ((firing ? near * 1.4 : 0) + (landedAt.current !== null ? Math.max(0, 1.2 - (clock.current - landedAt.current) * 0.5) : 0) - dust.strength.value) * Math.min(1, dt * 4);

    // Tras el contacto: unos segundos fuera y de vuelta al puente.
    if (s.phase !== 'landing' && landedAt.current === null) landedAt.current = clock.current;
    if (landedAt.current !== null && s.phase === 'surface' && clock.current - landedAt.current > TOUCHDOWN_LINGER_S) ui.setDescentView(false);

    // Cámara de persecución: arriba se mira casi en picado (el suelo detrás de la nave, creciendo);
    // cerca del suelo baja a un lado para ver el contacto.
    orbit.current += dt * 0.02;
    const shipY = SHIP_OFFSET.y + alt;
    const high = Math.min(alt, 150) / 150;
    const dist = 26 + high * 6;
    const cx = SHIP_CENTER.x + Math.cos(orbit.current) * dist;
    const cz = SHIP_CENTER.z + Math.sin(orbit.current) * dist;
    const ground = liveTerrain.current?.heightAt(cx, cz) ?? 0;
    camera.position.set(cx, Math.max(shipY + 6 + high * 22, ground + 2.5), cz);
    target.set(SHIP_CENTER.x, shipY - 3 - Math.min(alt, 120) * 0.5, SHIP_CENTER.z);
    camera.lookAt(target);
    if (fx.shake > 0.001) {
      const k = fx.shake * 0.25 * useSettings.getState().effects;
      camera.position.x += Math.sin(clock.current * 71) * k;
      camera.position.y += Math.sin(clock.current * 93) * k;
      fx.shake *= Math.exp(-dt * 3);
    } else fx.shake = 0;
  });
  return null;
}

/** Polvo levantado bajo la nave. */
function PadDust({ worldId, strength }: { worldId: string; strength: { value: number } }) {
  const look = surfaceLook(worldId);
  const dust = useMemo(() => dustMaterial(look.dust), [look]);
  const geom = useMemo(() => seedGeometry(60, 53), []);
  const ref = useRef<Points>(null);
  useEffect(() => () => {
    dust.material.dispose();
    geom.dispose();
  }, [dust, geom]);
  useFrame(() => {
    dust.u.uStrength.value = strength.value;
    dust.u.uRadius.value = 9;
  });
  return <points ref={ref} position={[SHIP_CENTER.x, 0, SHIP_CENTER.z]} geometry={geom} material={dust.material} frustumCulled={false} />;
}

// ─── EVA ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Bucle de la EVA: avanza el motor, informa de lo que simula el cliente (posición, jetpack, golpes),
 * traduce E/Q en colocar, recoger o retirar herramientas y entrar, y hace oír el oxígeno.
 */
function SurfaceLoop({ motion }: { motion: MotionParams }) {
  const posClock = useRef(0);
  const windLoop = useRef(false);
  const falling = useRef(false);
  const eWasDown = useRef(false);
  const qWasDown = useRef(false);
  const readyBefore = useRef(0);
  const lastGrounded = useRef(true);
  const enter = useRef(0);
  const jetLoop = useRef(false);
  const breathIn = useRef(2);
  const beepIn = useRef(0);
  const hailIn = useRef(0);
  useSceneKeys(true);
  useSceneCleanup();
  useEffect(() => {
    // Con la tormenta encima, el viento vuelve a sonar al salir.
    if (getRun()?.state.surface?.storm.active) cue('storm');
    // Solo desarrollo: estado del jugador y terreno a mano desde la consola.
    if (import.meta.env.DEV) Object.assign(((window as unknown as { __payload?: object }).__payload ??= {}), { playerState, liveTerrain });
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    // Las acciones de mantener cuentan el tiempo real (a pocos FPS no se alargan); tope por si la pestaña se durmió.
    const realDt = Math.min(delta, 1);
    const game = useGame.getState();
    game.tick(dt);
    const run = getRun();
    const s = run?.state;
    const ui = useUi.getState();
    const me = myCrew(s);
    if (!run || !s || !s.surface || !me || me.location !== 'eva' || !me.alive) {
      if (jetLoop.current) audio.stopLoop('jetpack', 0.1);
      jetLoop.current = false;
      if (windLoop.current) audio.stopLoop('wind', 0.5);
      windLoop.current = false;
      hudView.fallDanger = false;
      hudView.o2Short = false;
      hudView.toolOn = false;
      ui.setPrompt(null);
      return;
    }
    const world = getWorld(s.surface.worldId);
    // Reglas EFECTIVAS del motor (objeto vivo: con el traje o el jetpack mejorados).
    const rules = effectiveRulesOf(s, run.catalog);

    reportPose(playerState.pos.x, playerState.pos.y, playerState.pos.z, playerState.yaw, 'surface');
    hudView.x = playerState.pos.x;
    hudView.z = playerState.pos.z;
    hudView.yaw = playerState.yaw;
    // Entorno del movimiento: jetpack disponible y viento de la tormenta.
    motionEnv.canThrust = me.jetpackPct > 0;
    const st = stormLevel(s.surface.storm, world.storms?.warnS ?? 0);
    const terrain = liveTerrain.current;
    const wind = terrain ? windAngleOf(terrain) : 0;
    const push = st.active * STORM_WIND_MPS;
    motionEnv.windX = Math.cos(wind) * push;
    motionEnv.windZ = Math.sin(wind) * push;
    // Viento que crece durante el aviso; en plena tormenta lo sustituye el bucle `storm` (evento del motor).
    const windUp = st.warn > 0 && st.active === 0;
    if (windUp && !windLoop.current) cue('wind');
    if (windUp) audio.setLoopLevel('wind', 0.15 + 0.85 * st.warn);
    if (!windUp && windLoop.current) audio.stopLoop('wind', st.active > 0 ? 2 : 0.8);
    // Granizo de polvo contra el traje: una ráfaga de golpecitos cada tanto, más seguida cuanto más fuerte la tormenta.
    hailIn.current -= dt;
    if (st.active > 0.15 && hailIn.current <= 0) {
      cue('hail');
      hailIn.current = (0.5 + Math.random() * 0.9) / (0.4 + st.active);
    }
    windLoop.current = windUp;

    // Caída peligrosa: tal como va (con el freno si se está usando), ¿golpeará por encima de lo inofensivo?
    const groundY = terrain ? terrain.heightAt(playerState.pos.x, playerState.pos.z) : 0;
    const braking = playerState.thrusting && playerState.vy < 0;
    const downAccel = braking ? motion.gravityMps2 - motion.brakeNetMps2 : motion.gravityMps2;
    const danger = !playerState.grounded && fallDanger(playerState.vy, playerState.pos.y - groundY, downAccel, rules.falls.harmlessMps);
    if (danger && !falling.current) cue('fallWarn');
    falling.current = danger;
    hudView.fallDanger = danger;

    // Oxígeno frente a distancia: la brújula avisa si ya no da con holgura para volver andando.
    const drain = rules.suit.o2DrainPctPerS + (world.storms && s.surface.storm.active ? world.storms.o2DrainPctPerS * s.surface.storm.intensity : 0);
    // …y contando el rodeo por las herramientas colocadas (lo que ahora mata): ve ya a por ellas o déjalas.
    hudView.o2Route = o2RouteStatus(me.suitO2Pct, me.x, me.z, s.surface.tools, drain, motion.walkMps);
    hudView.o2Short = hudView.o2Route === 'short';

    // Jetpack: lo gastado se informa; si el motor dice que está vacío, se corta.
    if (playerState.thrustS > 0) {
      const ok = game.act({ type: 'jetpack', seconds: Math.min(0.5, playerState.thrustS) }, true).ok;
      if (!ok) motionEnv.canThrust = false;
      playerState.thrustS = 0;
    }
    if (playerState.thrusting && !jetLoop.current) cue('jetpack');
    if (!playerState.thrusting && jetLoop.current) audio.stopLoop('jetpack', 0.15);
    jetLoop.current = playerState.thrusting;

    // Golpes contra el suelo.
    if (playerState.impactMps > 0) {
      if (playerState.impactMps >= REPORT_IMPACT_MPS) {
        game.act({ type: 'fall-impact', speedMps: playerState.impactMps }, true);
        fx.shake = Math.max(fx.shake, Math.min(1, playerState.impactMps / 12));
      }
      playerState.impactMps = 0;
    }

    // Posición a ritmo fijo (y en cuanto cambia si pisa suelo: lo usan la recarga y el terreno inestable).
    posClock.current += dt;
    if (posClock.current >= POSITION_EVERY_S || playerState.grounded !== lastGrounded.current) {
      posClock.current = 0;
      lastGrounded.current = playerState.grounded;
      game.act({ type: 'set-position', x: playerState.pos.x, z: playerState.pos.z, grounded: playerState.grounded }, true);
    }

    // Interacción: E coloca la herramienta o recoge lo listo (una pulsación), Q la retira, mantener E entra.
    const i = ui.overlay === null ? surfaceInteractionAt(s, me.x, me.z, run.catalog) : null;
    const eDown = isDown('KeyE') && ui.overlay === null;
    const pressed = eDown && !eWasDown.current;
    eWasDown.current = eDown;
    const qDown = isDown('KeyQ') && ui.overlay === null;
    const qPressed = qDown && !qWasDown.current;
    qWasDown.current = qDown;
    if (pressed && playerState.grounded) {
      const action = surfaceUseAction(i);
      if (action) game.act(action);
    }
    if (qPressed) {
      const action = surfaceAltAction(i);
      if (action) game.act(action);
    }
    if (i?.kind === 'enter' && eDown) {
      enter.current += realDt / ENTER_HOLD_S;
      if (enter.current >= 1) {
        enter.current = 0;
        if (game.act({ type: 'eva-enter' }).ok) {
          shipSpawn.at = { ...AIRLOCK_INSIDE };
          audio.stopLoop('storm', 0.6);
          audio.stopLoop('jetpack', 0.1);
          jetLoop.current = false;
        }
      }
    } else enter.current = 0;

    // Herramientas: aviso cuando una tiene piezas nuevas listas, y flecha hacia la más cercana con piezas.
    let readyNow = 0;
    for (const t of s.surface.tools) readyNow += t.ready;
    if (readyNow > readyBefore.current) cue('toolReady');
    readyBefore.current = readyNow;
    const near = hudView.o2Route === 'fetch' ? nearestTool(s, me.x, me.z) : hudView.o2Route === 'leave' ? null : nearestReadyTool(s, me.x, me.z);
    hudView.toolOn = !!near;
    hudView.toolX = near?.x ?? 0;
    hudView.toolZ = near?.z ?? 0;
    ui.setPrompt(surfacePromptFor(i, enter.current, !playerState.grounded));

    // Oxígeno que se oye: respiración cada vez más rápida y pitido al final.
    breathIn.current -= dt;
    if (breathIn.current <= 0) {
      const low = me.suitO2Pct < rules.suit.lowO2Pct;
      cue(low ? 'breathFast' : 'breath');
      breathIn.current = breathIntervalS(me.suitO2Pct, rules.suit.lowO2Pct);
    }
    const beep = o2BeepIntervalS(me.suitO2Pct, rules.suit.criticalO2Pct);
    beepIn.current -= dt;
    if (beep !== null && beepIn.current <= 0) {
      cue('o2Critical');
      beepIn.current = beep;
    }
  });
  return null;
}

/**
 * Escena de superficie (descenso o EVA), con su propio `<Canvas>`. El mundo sale de la semilla y de
 * lo que dice el motor (`state.surface`); la física del tripulante es del cliente.
 */
export function SurfaceScene({ mode }: { mode: 'descent' | 'eva' }) {
  const worldId = useGame((g) => g.hud?.surface?.worldId ?? '');
  const ship = useRef<Group>(null);
  const dust = useMemo(() => ({ strength: { value: 0 } }), []);
  const gravity = worldId ? getWorld(worldId).gravityMps2 : 1.6;
  const motion = useMemo(
    () => surfaceMotion(gravity, flightLimitsOf(effectiveRulesOf(getRun()?.state, getRun()?.catalog)), worldId ? deepestDropM(worldId, getWorld(worldId).unstable.pitDepthM) : 0),
    [gravity, worldId],
  );
  const radius = useGame((g) => g.hud?.surface?.radiusM ?? 100);
  const groundAt = useMemo(() => (x: number, z: number) => liveTerrain.current?.heightAt(x, z) ?? 0, []);
  const descentAlt = getRun()?.state.surface?.descent?.altitudeM ?? 0;
  const { dpr, monitor } = useAdaptiveDpr();
  if (!worldId) return null;
  return (
    <Canvas style={{ isolation: 'isolate' }} dpr={dpr} camera={{ fov: 75, near: 0.1, far: 1300, position: [0, 3, 30] }}>
      {monitor}
      <ShaderClock />
      <Physics gravity={[0, 0, 0]} timeStep="vary">
        <SurfaceWorld physics={mode === 'eva'} />
        {/* En el descenso no hay herramientas colocadas (se pierden al despegar): no se montan sus 12 huecos. */}
        {mode === 'eva' && <SurfaceTools />}
        {mode === 'eva' && <CrewAvatars area="surface" />}
        <LodeFinishers />
        <group ref={ship} position={[SHIP_OFFSET.x, SHIP_OFFSET.y + (mode === 'descent' ? descentAlt : 0), SHIP_OFFSET.z]}>
          <ShipExterior colliders={mode === 'eva'} />
        </group>
        {mode === 'eva' && (
          <PlayerController start={[EVA_START.x, 0, EVA_START.z]} startYaw={EVA_START.yaw} motion={motion} groundAt={groundAt} softRadiusM={radius - 1} />
        )}
      </Physics>
      <PadDust worldId={worldId} strength={dust.strength} />
      {mode === 'descent' ? <DescentLoop ship={ship} dust={dust} /> : <SurfaceLoop motion={motion} />}
      <ShaderWarmup onReady={revealScene} />
    </Canvas>
  );
}

