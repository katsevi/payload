import { MAX_WORK_SECONDS } from '@payload/shared';
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Vector3 } from 'three';
import { Physics } from '@react-three/rapier';
import { cue } from '../audio/cues';
import { audio } from '../audio/audioEngine';
import { canPlayDodge, createDodge, DODGE_CUTOFF_S, DODGE_DURATION_S, dodgeDifficulty, dodgeLevelForSector, lateDodgeResult, dodgeResult, evadeAction, maxGrazesOf, SIMPLE_DODGE_RESULT, stepDodge } from '../game/dodge';
import { altAction, chargedAction, dodgeBadges, holdAction, interactionAt, KEY_STEER, promptFor, sendInChunks, startsDodge, type Interaction } from '../game/interaction';
import { mixSeed } from '../game/noise';
import {
  aimOnTarget,
  createPulse,
  createSeal,
  fireWorkS,
  FLAME_RADIUS_M,
  WIDE_AIM_MULT,
  flameOffset,
  pressPulse,
  repairSeed,
  SIMPLE_RATE,
  stepPulse,
  stepSeal,
} from '../game/repairGames';
import { HULL, PLAYER_START, STATIONS, USE_RADIUS, nearestStation } from '../game/layout';
import { fx, getRun, shipSpawn, useGame } from '../game/runStore';
import { bearingTo, SHIP_OFFSET } from '../game/surfaceRules';
import { ShaderClock } from '../gfx/Glow';
import { PlayerController, type CameraBounds } from '../player/PlayerController';
import { isDown, MOUSE_PRIMARY } from '../player/input';
import { playerState, resetPlayerState } from '../player/playerState';
import { minigame, resetMinigames, resetRepairGame } from '../state/minigame';
import { useSettings } from '../state/settings';
import { hudView, useUi } from '../state/ui';
import { IncidentFx, Markers, ZoneLights } from './ShipFx';
import { DodgeHolo, FlameTarget } from './ShipMinigames';
import { Hull } from './ShipInterior';
import { Stations } from './ShipStations';
import { SpaceView } from './SpaceView';
import { SurfaceWorld } from './SurfaceWorld';

const BOUNDS: CameraBounds = { minX: -HULL.halfWidth + 0.4, maxX: HULL.halfWidth - 0.4, minZ: HULL.minZ + 0.4, maxZ: HULL.maxZ - 0.4, maxY: HULL.height - 0.3 };

const isTyping = (e: KeyboardEvent): boolean => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
};

/** Interacción actual según dónde está el jugador (en el timón, con las estimaciones del motor). */
function currentInteraction(): Interaction | null {
  const run = getRun();
  if (!run) return null;
  const station = nearestStation(playerState.pos.x, playerState.pos.z);
  const est = station === 'helm' ? { landing: run.state.phase === 'docked' ? run.estimateLanding() : null, takeOff: run.state.phase === 'surface' ? run.estimateTakeOff() : null } : {};
  return interactionAt(station, run.state, est, run.catalog);
}

/** Cada cuánto vuelve a pitar el aviso de impacto mientras nadie está al timón. */
const WARN_REPEAT_S = 1.4;

/** La habilidad de las averías: clic izquierdo o Espacio. */
const skillDown = (): boolean => isDown(MOUSE_PRIMARY) || isDown('Space');

/** Toma los mandos en el timón: arranca la esquiva del primer impacto avisado. */
function startDodge(): boolean {
  const run = getRun();
  const w = run?.state.warnings.find((x) => !x.evaded);
  if (!run || !w) return false;
  // Semilla y dificultad del motor si las expone (`evadeSeed`/`evadeDifficulty`); si no, derivadas aquí.
  const level = w.evadeDifficulty ?? dodgeLevelForSector(run.state.sector.index);
  const seed = w.evadeSeed ?? mixSeed(run.state.seed, w.hazardId, 0xd0d6e);
  const max = maxGrazesOf(run.catalog.hazards.impact.evade);
  if (!canPlayDodge(w.etaS)) {
    // Sin tiempo para jugarla entera: maniobra a medias, nunca limpia (peor cuanto más tarde).
    const late = lateDodgeResult(w.etaS, level, max);
    minigame.lastDodgeResult = late;
    if (useGame.getState().act(evadeAction(late, max)).ok) cue('dodgeGraze');
    return false;
  }
  minigame.dodge = createDodge(seed, DODGE_DURATION_S, dodgeDifficulty(level));
  minigame.dodgeHazardId = w.hazardId;
  // De cara al holograma del timón.
  playerState.yaw = 0;
  playerState.pitch = -0.08;
  cue('toggle');
  return true;
}

/**
 * Bucle de juego: avanza el motor con el tiempo real y traduce «estar junto a un puesto + control» en
 * acciones. E = usar (mapa, panel, esclusa, aterrizar/despegar, tomar los mandos para esquivar); R =
 * reparar con repuesto; clic/Espacio = la habilidad de cada avería; Q = régimen o soltar carga.
 */
function GameLoop() {
  const charge = useRef(0);
  const chargeKind = useRef<string | null>(null);
  const wasLocked = useRef(false);
  const skillWas = useRef(false);
  const spraying = useRef(false);
  const lastFeedback = useRef(0);
  const warnBeep = useRef(WARN_REPEAT_S);
  const scratch = useMemo(() => ({ dir: new Vector3(), off: { x: 0, y: 0 } }), []);
  const { gl } = useThree();

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.1);
    // Lo que se mantiene cuenta el tiempo real (a menos de 10 FPS no se alarga); tope por si la pestaña se durmió.
    const realDt = Math.min(delta, 1);
    const game = useGame.getState();
    game.tick(dt);
    const run = getRun();
    const ui = useUi.getState();
    minigame.dodgeFlash = Math.max(0, minigame.dodgeFlash - dt * 2.5);
    if (!run || ui.overlay !== null) {
      hudView.helmOn = false;
      charge.current = 0;
      ui.setPrompt(null);
      stopSpray();
      return;
    }
    const settings = useSettings.getState();
    const simple = { dodge: settings.simpleDodge, repairs: settings.simpleRepairs };
    const skill = skillDown();
    const skillPressed = skill && !skillWas.current;
    skillWas.current = skill;

    // ── Esquiva en curso: WASD/flechas pilotan; el motor sigue corriendo (las averías no esperan) ──
    const d = minigame.dodge;
    if (d) {
      hudView.helmOn = false;
      const warning = run.state.warnings.find((w) => w.hazardId === minigame.dodgeHazardId && !w.evaded);
      const still = !!warning;
      // Si el impacto está encima, se termina ya y se envía lo que haya (el `evade` debe llegar antes).
      const late = !!warning && warning.etaS >= 0 && warning.etaS <= DODGE_CUTOFF_S;
      let ix = 0;
      let iy = 0;
      if (isDown('KeyA') || isDown('ArrowLeft')) ix -= 1;
      if (isDown('KeyD') || isDown('ArrowRight')) ix += 1;
      if (isDown('KeyW') || isDown('ArrowUp')) iy += 1;
      if (isDown('KeyS') || isDown('ArrowDown')) iy -= 1;
      stepDodge(d, ix, iy, realDt);
      if (d.stepHits > 0) {
        cue('dodgeHit');
        fx.shake = Math.max(fx.shake, 0.9);
        minigame.dodgeFlash = 1;
      } else if (d.stepGrazes > 0) {
        cue('dodgeGraze');
        fx.shake = Math.max(fx.shake, 0.3);
        minigame.dodgeFlash = Math.max(minigame.dodgeFlash, 0.5);
      }
      if (d.done || late || !still || run.state.phase === 'lost') {
        const result = dodgeResult(d);
        minigame.lastDodgeResult = result;
        minigame.dodge = null;
        // Roces (o choque de lleno = esquiva fallida) al motor; el sonido del resultado llega con el evento.
        if (still) game.act(evadeAction(result, maxGrazesOf(run.catalog.hazards.impact.evade)));
      }
      ui.setPrompt(
        minigame.dodge
          ? { key: 'prompt.dodging', inputKey: KEY_STEER, noVerb: true, hold: false, progress: Math.min(1, d.t / d.durationS), progressBar: true, badges: dodgeBadges(d.grazes, d.hits) }
          : null,
      );
      return;
    }

    // Aviso de impacto: desde cualquier punto de la nave se ve hacia dónde queda el timón y se oye un
    // pitido cada poco hasta que alguien lo atiende (esos segundos son los que cuentan).
    const warned = run.state.warnings.some((w) => !w.evaded);
    const helm = STATIONS.helm;
    const toHelm = Math.hypot(helm.useX - playerState.pos.x, helm.useZ - playerState.pos.z);
    hudView.helmOn = warned && toHelm > USE_RADIUS;
    if (hudView.helmOn) {
      hudView.helmAngle = bearingTo(playerState.pos.x, playerState.pos.z, playerState.yaw, helm.useX, helm.useZ).angle;
      warnBeep.current -= realDt;
      if (warnBeep.current <= 0) {
        cue('warnTick');
        warnBeep.current = WARN_REPEAT_S;
      }
    } else warnBeep.current = WARN_REPEAT_S;

    const interaction = currentInteraction();
    const holdingUse = isDown('KeyE');
    const holdingRepair = isDown('KeyR');

    // ── Averías: micro-interacción por tipo (o mantener R con interacciones simples) ──
    if (interaction?.kind === 'incident') {
      const inc = interaction.incident;
      const repairS = run.catalog.hazards.incidents[inc.kind].repairS;
      const r = minigame.repair;
      if (r.incidentId !== inc.id) {
        resetRepairGame();
        r.incidentId = inc.id;
        r.kind = inc.kind;
        r.seed = repairSeed(run.state.seed, inc.id);
        if (inc.kind === 'short') r.pulse = createPulse(r.seed);
        if (inc.kind === 'leak') r.seal = createSeal(r.seed);
      }
      r.t += realDt;
      let work = 0;
      if (simple.repairs) {
        work = holdingRepair ? realDt * SIMPLE_RATE : 0;
        r.spraying = false;
      } else if (inc.kind === 'fire') {
        // La llama se mueve delante del puesto; el extintor apunta al centro de la vista.
        const st = STATIONS[interaction.systemId];
        flameOffset(r.seed, r.t, scratch.off);
        const fx0 = Math.sin(st.yaw);
        const fz0 = Math.cos(st.yaw);
        r.flame.x = st.x + fx0 * 0.55 + Math.cos(st.yaw) * scratch.off.x;
        r.flame.y = 1.25 + scratch.off.y;
        r.flame.z = st.z + fz0 * 0.55 - Math.sin(st.yaw) * scratch.off.x;
        camera.getWorldDirection(scratch.dir);
        r.spraying = skill;
        r.onTarget = aimOnTarget(camera.position, scratch.dir, r.flame, FLAME_RADIUS_M * (settings.wideAim ? WIDE_AIM_MULT : 1));
        work = fireWorkS(realDt, skill, r.onTarget);
      } else if (inc.kind === 'short' && r.pulse) {
        stepPulse(r.pulse, realDt);
        if (skillPressed) work = pressPulse(r.pulse, repairS);
      } else if (inc.kind === 'leak' && r.seal) {
        work = stepSeal(r.seal, skill, realDt, repairS);
      }
      if (r.spraying && !spraying.current) cue('extinguisher');
      if (!r.spraying && spraying.current) audio.stopLoop('extinguisher', 0.2);
      spraying.current = r.spraying;
      const fb = r.pulse?.feedback ?? r.seal?.feedback ?? 0;
      if (fb !== lastFeedback.current && fb !== 0) cue(fb === 1 ? 'skillHit' : 'skillMiss');
      lastFeedback.current = fb;
      if (work > 0) sendInChunks(work, MAX_WORK_SECONDS, (seconds) => game.act({ type: 'work-incident', incidentId: inc.id, seconds }, true).ok);
      charge.current = 0;
      ui.setPrompt(promptFor(interaction, run.state, 0, simple));
      return;
    }
    if (minigame.repair.incidentId !== -1) resetRepairGame();
    if (interaction?.kind !== 'repair') minigame.spare = null;
    stopSpray();

    // ── Reparación con repuesto: encajar la pieza (mantener R, soltar en la marca; dos tramos) ──
    if (interaction?.kind === 'repair') {
      let work = 0;
      if (interaction.blocked) {
        minigame.spare = null;
      } else if (simple.repairs) {
        work = holdingRepair ? realDt * SIMPLE_RATE : 0;
        minigame.spare = null;
      } else {
        if (!minigame.spare || minigame.spareSystem !== interaction.systemId) {
          minigame.spare = createSeal(mixSeed(run.state.seed, run.state.stats.jumps, interaction.systemId.length, 0x5a7e));
          minigame.spareSystem = interaction.systemId;
        }
        work = stepSeal(minigame.spare, holdingRepair, realDt, run.catalog.hazards.repair.kitRepairS);
        const fb = minigame.spare.feedback;
        if (fb !== lastFeedback.current && fb !== 0) cue(fb === 1 ? 'skillHit' : 'skillMiss');
        lastFeedback.current = fb;
      }
      if (work > 0) {
        sendInChunks(work, MAX_WORK_SECONDS, (seconds) => {
          const action = holdAction(interaction, seconds);
          return !!action && game.act(action, true).ok;
        });
      }
      charge.current = 0;
      ui.setPrompt(promptFor(interaction, run.state, 0, simple));
      return;
    }

    // ── «Mantener E hasta llenar»: descenso, despegue, esclusa (y la esquiva con interacciones simples) ──
    const charged = chargedAction(interaction, simple);
    if (charged) {
      if (chargeKind.current !== interaction?.kind) charge.current = 0;
      chargeKind.current = interaction?.kind ?? null;
      if (holdingUse) {
        charge.current += realDt / charged.holdS;
        if (charge.current >= 1) {
          charge.current = 0;
          // Interacciones simples: la esquiva entra con un resultado medio (1 roce).
          // (Si ya no daba tiempo a jugarla, cuenta como tarde: la red de seguridad no salta la llegada.)
          const w = run.state.warnings.find((x) => !x.evaded);
          const max = maxGrazesOf(run.catalog.hazards.impact.evade);
          const simpleResult = w && !canPlayDodge(w.etaS) ? lateDodgeResult(w.etaS, w.evadeDifficulty ?? dodgeLevelForSector(run.state.sector.index), max) : SIMPLE_DODGE_RESULT;
          const action = charged.action.type === 'evade' ? evadeAction(simpleResult, max) : charged.action;
          if (action.type === 'evade') minigame.lastDodgeResult = simpleResult;
          if (game.act(action).ok) cue('toggle');
        }
      } else charge.current = 0;
    } else charge.current = 0;
    ui.setPrompt(promptFor(interaction, run.state, charge.current, simple));
  });

  function stopSpray() {
    if (spraying.current) audio.stopLoop('extinguisher', 0.2);
    spraying.current = false;
    minigame.repair.spraying = false;
  }

  useEffect(() => {
    const relock = () => void Promise.resolve(gl.domElement.requestPointerLock?.()).catch(() => undefined);
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isTyping(e)) return;
      const ui = useUi.getState();
      const run = getRun();
      if (!run) return;
      if (e.code === 'KeyE') {
        if (ui.overlay === 'map' || ui.overlay === 'power') {
          ui.setOverlay(null);
          relock();
          return;
        }
        if (ui.overlay !== null || minigame.dodge) return;
        const interaction = currentInteraction();
        if (interaction?.kind === 'map' || interaction?.kind === 'power') ui.setOverlay(interaction.kind);
        else if (startsDodge(interaction, useSettings.getState().simpleDodge)) startDodge();
      } else if (e.code === 'KeyQ' && ui.overlay === null && !minigame.dodge) {
        const action = altAction(currentInteraction(), run.state);
        if (action && useGame.getState().act(action).ok) cue('toggle');
      } else if (e.code === 'KeyV' && ui.overlay === null) {
        ui.toggleView();
      } else if (e.code === 'KeyH' || e.code === 'F1') {
        e.preventDefault();
        if (ui.overlay === null || ui.overlay === 'help') ui.toggleOverlay('help');
      } else if (e.code === 'Space' && ui.overlay === null) e.preventDefault();
    };
    // Soltar el ratón con Esc (sin ningún panel abierto) pausa la partida.
    const onLock = () => {
      const phase = getRun()?.state.phase;
      if (document.pointerLockElement === null && useUi.getState().overlay === null && wasLocked.current && (phase === 'docked' || phase === 'transit' || phase === 'surface')) {
        useUi.getState().setOverlay('pause');
      }
      wasLocked.current = document.pointerLockElement !== null;
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerlockchange', onLock);
    // Solo desarrollo: estado del jugador y de los minijuegos a mano para depurar desde la consola.
    if (import.meta.env.DEV) Object.assign(((window as unknown as { __payload?: object }).__payload ??= {}), { playerState, minigame, startDodge });
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerlockchange', onLock);
      audio.stopLoop('extinguisher', 0.1);
      resetMinigames();
    };
  }, [gl]);

  return null;
}

/**
 * Entorno de reflejos de la nave: unas pocas luces de estudio que se rinden UNA vez a un cubemap. Da
 * brillo al metal y luz de relleno sin coste por frame. En un apagón se atenúa (ver `ZoneLights`).
 */
function ShipEnvironment() {
  return (
    <Environment resolution={128} frames={1} environmentIntensity={0.55}>
      <color attach="background" args={['#0a0f18']} />
      <Lightformer form="rect" intensity={3.2} color="#d6e6ff" position={[0, 6, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[5, 22, 1]} />
      <Lightformer form="rect" intensity={1.1} color="#38e1c0" position={[-9, 0.5, 0]} rotation={[0, Math.PI / 2, 0]} scale={[24, 0.6, 1]} />
      <Lightformer form="rect" intensity={1.1} color="#38e1c0" position={[9, 0.5, 0]} rotation={[0, -Math.PI / 2, 0]} scale={[24, 0.6, 1]} />
      <Lightformer form="rect" intensity={0.9} color="#7fa8ff" position={[0, 2, -16]} scale={[14, 5, 1]} />
      <Lightformer form="rect" intensity={0.7} color="#ffb070" position={[0, 2, 16]} rotation={[0, Math.PI, 0]} scale={[10, 4, 1]} />
      <Lightformer form="rect" intensity={0.35} color="#8fa3c4" position={[0, -6, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[12, 26, 1]} />
    </Environment>
  );
}

/**
 * Con la nave posada, por las ventanas se ve la superficie: el mismo mundo que en la EVA, desplazado al
 * sistema del interior (sin colisiones ni niebla, que velaría la propia nave).
 */
function LandedView() {
  return (
    <group position={[-SHIP_OFFSET.x, -SHIP_OFFSET.y, -SHIP_OFFSET.z]}>
      <SurfaceWorld interior />
    </group>
  );
}

/** Al desmontar la nave (descenso, EVA) se guarda dónde estaba el jugador y se limpia lo transitorio. */
function useShipSpawn(): { start: readonly [number, number, number]; yaw: number } {
  // Se lee una vez al montar; al desmontar se guarda la posición actual (la EVA la cambia al entrar).
  const spawn = useMemo(() => {
    const at = shipSpawn.at;
    return at ? { start: [at.x, 0, at.z] as const, yaw: at.yaw } : { start: PLAYER_START, yaw: 0 };
  }, []);
  useEffect(
    () => () => {
      shipSpawn.at = { x: playerState.pos.x, z: playerState.pos.z, yaw: playerState.yaw };
      fx.shake = 0;
      useUi.getState().setPrompt(null);
      resetPlayerState();
    },
    [],
  );
  return spawn;
}

/** Interior caminable de la nave (1ª/3ª persona) con el espacio (o la superficie) al otro lado de las ventanas. */
export function ShipScene() {
  const landed = useGame((s) => s.hud?.phase === 'surface');
  const spawn = useShipSpawn();
  return (
    <Canvas style={{ isolation: 'isolate' }} dpr={[1, 1.75]} camera={{ fov: 75, near: 0.05, far: 2400, position: [PLAYER_START[0], 1.6, PLAYER_START[2]] }}>
      <color attach="background" args={['#01020a']} />
      <ShaderClock />
      <ShipEnvironment />
      {landed ? <LandedView /> : <SpaceView />}
      <ZoneLights />
      {/* Paso variable: con paso fijo de 60 Hz el personaje iría más lento en pantallas de 120/144 Hz. */}
      <Physics gravity={[0, 0, 0]} timeStep="vary">
        <Hull />
        <Stations />
        <PlayerController start={spawn.start} startYaw={spawn.yaw} bounds={BOUNDS} />
      </Physics>
      <IncidentFx />
      <DodgeHolo />
      <FlameTarget />
      <Markers />
      <GameLoop />
    </Canvas>
  );
}
