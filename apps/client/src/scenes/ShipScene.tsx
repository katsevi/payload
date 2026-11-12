import { MAX_WORK_SECONDS } from '@payload/shared';
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { cue } from '../audio/cues';
import { altAction, chargedAction, holdAction, interactionAt, promptFor, sendInChunks, type Interaction } from '../game/interaction';
import { HULL, PLAYER_START, nearestStation } from '../game/layout';
import { fx, getRun, shipSpawn, useGame } from '../game/runStore';
import { SHIP_OFFSET } from '../game/surfaceRules';
import { ShaderClock } from '../gfx/Glow';
import { PlayerController, type CameraBounds } from '../player/PlayerController';
import { isDown } from '../player/input';
import { playerState, resetPlayerState } from '../player/playerState';
import { useUi } from '../state/ui';
import { IncidentFx, Markers, ZoneLights } from './ShipFx';
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

/**
 * Bucle de juego: avanza el motor con el tiempo real y traduce «estar junto a un puesto + tecla»
 * en acciones. Mantener E arregla/repara/esquiva; pulsar E abre paneles; Q cambia el régimen en el timón.
 */
function GameLoop() {
  const charge = useRef(0);
  const chargeKind = useRef<string | null>(null);
  const wasLocked = useRef(false);
  const { gl } = useThree();

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    // Mantener E cuenta el tiempo real (a menos de 10 FPS no se alarga); tope por si la pestaña se durmió.
    const realDt = Math.min(delta, 1);
    const game = useGame.getState();
    game.tick(dt);
    const run = getRun();
    const ui = useUi.getState();
    if (!run || ui.overlay !== null) {
      charge.current = 0;
      ui.setPrompt(null);
      return;
    }
    const interaction = currentInteraction();
    const holding = isDown('KeyE');
    // «Mantener hasta llenar»: maniobra evasiva, descenso, despegue y esclusa.
    const charged = chargedAction(interaction);
    if (charged) {
      if (chargeKind.current !== interaction?.kind) charge.current = 0;
      chargeKind.current = interaction?.kind ?? null;
      if (holding) {
        charge.current += realDt / charged.holdS;
        if (charge.current >= 1) {
          charge.current = 0;
          if (game.act(charged.action).ok) cue('toggle');
        }
      } else charge.current = 0;
    } else {
      charge.current = 0;
      if (holding && holdAction(interaction, 0)) {
        sendInChunks(realDt, MAX_WORK_SECONDS, (seconds) => {
          const action = holdAction(interaction, seconds);
          return !!action && game.act(action, true).ok;
        });
      }
    }
    ui.setPrompt(promptFor(interaction, run.state, charge.current));
  });

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
        if (ui.overlay !== null) return;
        const interaction = currentInteraction();
        if (interaction?.kind === 'map' || interaction?.kind === 'power') ui.setOverlay(interaction.kind);
      } else if (e.code === 'KeyQ' && ui.overlay === null) {
        const action = altAction(currentInteraction(), run.state);
        if (action && useGame.getState().act(action).ok) cue('toggle');
      } else if (e.code === 'KeyV' && ui.overlay === null) {
        ui.toggleView();
      } else if (e.code === 'KeyH' || e.code === 'F1') {
        e.preventDefault();
        if (ui.overlay === null || ui.overlay === 'help') ui.toggleOverlay('help');
      }
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
    // Solo desarrollo: estado del jugador a mano para depurar desde la consola.
    if (import.meta.env.DEV) Object.assign(((window as unknown as { __payload?: object }).__payload ??= {}), { playerState });
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerlockchange', onLock);
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
      <Markers />
      <GameLoop />
    </Canvas>
  );
}
