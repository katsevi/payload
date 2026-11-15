import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { MathUtils, Vector3, type Group, type PerspectiveCamera, type Sprite } from 'three';
import { applyAstronautPose, ArticulatedAstronaut, newAstronautRig } from '../models/ArticulatedAstronaut';
import { advanceGait, astronautPose } from '../game/astronautPose';
import { newMotionState, settleMotion, SHIP_MOTION, stepMotion, type MotionInput, type MotionParams } from '../game/motion';
import { cue } from '../audio/cues';
import { FOOT_LAND_MIN_MPS, stepSfxFor, STRIDE_RUN_M, STRIDE_WALK_M } from '../audio/soundLogic';
import { fx as viewFx, getRun } from '../game/runStore';
import { Glow } from '../gfx/Glow';
import { useSettings } from '../state/settings';
import { minigame } from '../state/minigame';
import { useUi } from '../state/ui';
import { attachKeyboard, isDown } from './input';
import { lookDir, motionEnv, playerState } from './playerState';

type KinematicCharacterController = ReturnType<ReturnType<typeof useRapier>['world']['createCharacterController']>;

const EYE = 1.6;
/** Desplazamiento lateral de la cámara en 3ª persona (sobre el hombro derecho). */
const SHOULDER_M = 0.55;
const TRANSITION_S = 0.4;

const smooth = (x: number) => x * x * (3 - 2 * x);

export interface CameraBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
}

export interface PlayerControllerProps {
  start: readonly [number, number, number];
  /** Giro inicial de la vista (rad). */
  startYaw?: number;
  /** Límites para que la cámara en 3ª persona no atraviese el casco (interior de la nave). */
  bounds?: CameraBounds;
  /** Física del movimiento: la de la nave por defecto; en la superficie, la del mundo (`surfaceMotion`). */
  motion?: MotionParams;
  /** Altura del suelo (superficie): la cámara en 3ª persona nunca baja de ahí. */
  groundAt?: (x: number, z: number) => number;
  /** Radio explorable: pasado este borde, un empuje suave hacia dentro (no un muro invisible). */
  softRadiusM?: number;
}

/**
 * Personaje con controlador cinemático de Rapier. El mismo cuerpo sirve a la 1ª y 3ª persona:
 * cambiar de vista (V) solo mueve la cámara, nunca la física. Las velocidades salen de
 * `game/motion.ts` (puro); aquí solo se resuelven las colisiones y se coloca la cámara.
 */
export function PlayerController({ start, startYaw = 0, bounds, motion = SHIP_MOTION, groundAt, softRadiusM }: PlayerControllerProps) {
  const body = useRef<RapierRigidBody>(null);
  const avatar = useRef<Group>(null);
  const jetGlow = useRef<Sprite>(null);
  const { world, rapier } = useRapier();
  const camRay = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), [rapier]);
  const { camera, gl } = useThree();
  const ms = useRef(newMotionState());
  const snapping = useRef(true);
  const input = useRef<MotionInput>({ dirX: 0, dirZ: 0, run: false, jump: false, down: false, canThrust: false, windX: 0, windZ: 0, heightM: 0 });
  const blend = useRef(useUi.getState().view === 'third' ? 1 : 0); // 0 = 1ª persona, 1 = 3ª persona
  const avatarYaw = useRef(Math.PI); // mirando a -Z (yaw inicial)
  // Fase 5: astronauta articulado (pose por frame, sin React) y lo que necesita para la zancada.
  const rig = useRef(newAstronautRig());
  const gait = useRef(0);
  const lastFeet = useRef(new Vector3(Number.NaN, 0, 0));
  const camPos = useRef(new Vector3());
  const camInit = useRef(false);
  const t = useRef(0);
  /** Metros recorridos andando desde el último paso sonoro. */
  const strideAcc = useRef(0);
  const scratch = useMemo(
    () => ({ dir: new Vector3(), fpPos: new Vector3(), right: new Vector3(), pivot: new Vector3(), tpPos: new Vector3(), want: new Vector3(), lookAt: new Vector3(), tmp: new Vector3() }),
    [],
  );

  const controllerRef = useRef<KinematicCharacterController | null>(null);
  // Se crea en el efecto (y no en useMemo) para que sobreviva al doble montaje de StrictMode.
  useEffect(() => {
    const c = world.createCharacterController(0.02);
    c.enableAutostep(0.25, 0.15, true);
    c.enableSnapToGround(0.25);
    c.setSlideEnabled(true);
    c.setApplyImpulsesToDynamicBodies(false);
    controllerRef.current = c;
    return () => {
      world.removeCharacterController(c);
      controllerRef.current = null;
    };
  }, [world]);

  // Teclado, ratón (pointer lock) y estado inicial.
  useEffect(() => {
    playerState.pos.set(start[0], start[1], start[2]);
    playerState.yaw = startYaw;
    playerState.pitch = 0;
    avatarYaw.current = startYaw + Math.PI;
    const detach = attachKeyboard();
    const canvas = gl.domElement;
    const onClick = () => {
      if (useUi.getState().overlay === null && document.pointerLockElement !== canvas) {
        void Promise.resolve(canvas.requestPointerLock?.()).catch(() => undefined);
      }
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      const k = 0.0022 * useSettings.getState().sensitivity;
      playerState.yaw -= e.movementX * k;
      const third = useUi.getState().view === 'third';
      playerState.pitch = MathUtils.clamp(playerState.pitch - e.movementY * k, third ? -0.7 : -1.45, third ? 0.9 : 1.45);
    };
    canvas.addEventListener('click', onClick);
    document.addEventListener('mousemove', onMove);
    // Solo desarrollo: `__payload.teleport(x, z)` coloca al tripulante (capturas y revisión de la escena).
    if (import.meta.env.DEV) {
      // `aboveM` (opcional) lo suelta a esa altura sobre el suelo (para revisar caídas).
      const teleport = (x: number, z: number, aboveM = 0) => body.current?.setTranslation({ x, y: (groundAt?.(x, z) ?? 0) + 0.85 + aboveM, z }, true);
      Object.assign(((window as unknown as { __payload?: object }).__payload ??= {}), { teleport });
    }
    return () => {
      detach();
      canvas.removeEventListener('click', onClick);
      document.removeEventListener('mousemove', onMove);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);

  // Al abrir un panel modal se suelta el ratón.
  useEffect(
    () =>
      useUi.subscribe((s, p) => {
        if (s.overlay !== null && p.overlay === null && document.pointerLockElement) document.exitPointerLock();
      }),
    [],
  );

  useFrame((_, delta) => {
    const rb = body.current;
    const controller = controllerRef.current;
    if (!rb || !controller) return;
    const dt = Math.min(delta, 0.05);
    t.current += dt;
    const ui = useUi.getState();
    const settings = useSettings.getState();
    const phase = getRun()?.state.phase;
    // Pilotando en el timón (esquiva), WASD mueve la nave del holograma, no al tripulante.
    const blocked = ui.overlay !== null || phase === 'lost' || phase === 'won' || minigame.dodge !== null;

    // ── Movimiento ──
    let fx = 0;
    let fz = 0;
    if (!blocked) {
      if (isDown('KeyW') || isDown('ArrowUp')) fz += 1;
      if (isDown('KeyS') || isDown('ArrowDown')) fz -= 1;
      if (isDown('KeyD') || isDown('ArrowRight')) fx += 1;
      if (isDown('KeyA') || isDown('ArrowLeft')) fx -= 1;
    }
    const len = Math.hypot(fx, fz);
    const moving = len > 0;
    const sy = Math.sin(playerState.yaw);
    const cy = Math.cos(playerState.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    const inp = input.current;
    inp.dirX = moving ? (-sy * fz + cy * fx) / len : 0;
    inp.dirZ = moving ? (-cy * fz - sy * fx) / len : 0;
    inp.run = isDown('ShiftLeft') || isDown('ShiftRight');
    inp.jump = !blocked && isDown('Space');
    // Bajar con el jetpack: C (no Ctrl: Ctrl+W cerraría la pestaña).
    inp.down = !blocked && isDown('KeyC');
    inp.canThrust = motionEnv.canThrust;
    inp.windX = motionEnv.windX;
    inp.windZ = motionEnv.windZ;
    const s = ms.current;
    const p = rb.translation();
    // Altura de los pies sobre el suelo de debajo (techo de vuelo del jetpack).
    inp.heightM = groundAt ? p.y - 0.85 - groundAt(p.x, p.z) : 0;
    stepMotion(s, inp, motion, dt);

    let ex = inp.windX;
    let ez = inp.windZ;
    if (softRadiusM !== undefined) {
      // Frontera suave: pasado el radio, se empuja hacia dentro cada vez con más fuerza.
      const r = Math.hypot(p.x, p.z);
      if (r > softRadiusM) {
        const push = Math.min(7, (r - softRadiusM) * 1.6);
        ex -= (p.x / r) * push;
        ez -= (p.z / r) * push;
        s.vx *= 0.96;
        s.vz *= 0.96;
      }
    }
    // Pegado al suelo solo al caminar: nunca mientras se sube o se cae (el jetpack no se «engancha»).
    const wantSnap = motion === SHIP_MOTION || (s.grounded && s.vy <= 0 && !s.thrusting);
    if (wantSnap !== snapping.current) {
      if (wantSnap) controller.enableSnapToGround(0.3);
      else controller.disableSnapToGround();
      snapping.current = wantSnap;
    }

    const col = rb.collider(0);
    const wantY = s.vy * dt;
    controller.computeColliderMovement(col, { x: (s.vx + ex) * dt, y: wantY, z: (s.vz + ez) * dt });
    const m = controller.computedMovement();
    rb.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
    if (motion !== SHIP_MOTION && !s.grounded) {
      // Contra una pared en el aire se pierde la inercia en ese eje.
      if (Math.abs(m.x) < Math.abs((s.vx + ex) * dt) * 0.5) s.vx = 0;
      if (Math.abs(m.z) < Math.abs((s.vz + ez) * dt) * 0.5) s.vz = 0;
    }
    const impact = settleMotion(s, controller.computedGrounded(), wantY > 0 && m.y < wantY * 0.5);

    playerState.pos.set(p.x, p.y - 0.85, p.z);
    playerState.moving = moving;
    playerState.grounded = s.grounded;
    playerState.vy = s.vy;
    playerState.thrusting = s.thrusting;
    if (s.thrusting) playerState.thrustS += dt;
    if (impact > playerState.impactMps) playerState.impactMps = impact;

    // ── Sonido de pasos: uno por zancada recorrida, solo con los pies en el suelo ──
    if (impact >= FOOT_LAND_MIN_MPS) {
      cue('footLand');
      strideAcc.current = 0;
    } else if (s.grounded && moving) {
      strideAcc.current += Math.hypot(m.x, m.z);
      if (strideAcc.current >= (inp.run ? STRIDE_RUN_M : STRIDE_WALK_M)) {
        strideAcc.current = 0;
        cue(stepSfxFor(motion !== SHIP_MOTION, getRun()?.state.surface?.worldId));
      }
    } else if (!s.grounded) strideAcc.current = 0;

    // ── Cámara (transición suave 1ª ↔ 3ª) ──
    const target = ui.view === 'third' ? 1 : 0;
    blend.current = MathUtils.clamp(blend.current + Math.sign(target - blend.current) * (dt / TRANSITION_S), 0, 1);
    if (Math.abs(target - blend.current) < 1e-4) blend.current = target;
    const e = smooth(blend.current);

    const { dir, fpPos, right, pivot, tpPos, want, lookAt, tmp } = scratch;
    lookDir(dir);
    const feet = playerState.pos;
    const bob = settings.headBob && moving && s.grounded ? Math.sin(t.current * 9) * 0.035 : 0;
    fpPos.set(feet.x, feet.y + EYE + bob, feet.z);
    right.set(cy, 0, -sy);
    pivot.set(feet.x, feet.y + 1.55, feet.z);
    // La cámara en 3ª persona se acerca si algo (mamparo, rampa, ladera) se interpone.
    let camDist = bounds ? 3.2 : 4.6;
    let shoulder = SHOULDER_M;
    if (blend.current > 0.01) {
      // El pivote va sobre el hombro derecho, pero nunca dentro de una pared o un puesto: el rayo de la cámara
      // saldría desde dentro del colisionador (choque a distancia 0) y la cámara se quedaría en la pared (parpadeo).
      camRay.origin.x = pivot.x;
      camRay.origin.y = pivot.y;
      camRay.origin.z = pivot.z;
      camRay.dir.x = right.x;
      camRay.dir.y = 0;
      camRay.dir.z = right.z;
      const side = world.castRay(camRay, SHOULDER_M + 0.3, true, undefined, undefined, undefined, rb);
      if (side) shoulder = Math.max(0, Math.min(SHOULDER_M, side.timeOfImpact - 0.3));
    }
    pivot.addScaledVector(right, shoulder);
    if (blend.current > 0.01) {
      camRay.origin.x = pivot.x;
      camRay.origin.y = pivot.y;
      camRay.origin.z = pivot.z;
      camRay.dir.x = -dir.x;
      camRay.dir.y = -dir.y;
      camRay.dir.z = -dir.z;
      const hit = world.castRay(camRay, camDist + 0.3, true, undefined, undefined, undefined, rb);
      if (hit) camDist = Math.max(0.4, hit.timeOfImpact - 0.3);
    }
    tpPos.copy(pivot).addScaledVector(dir, -camDist);
    if (bounds) {
      tpPos.x = MathUtils.clamp(tpPos.x, bounds.minX, bounds.maxX);
      tpPos.z = MathUtils.clamp(tpPos.z, bounds.minZ, bounds.maxZ);
      tpPos.y = MathUtils.clamp(tpPos.y, 0.3, bounds.maxY);
    }
    // En la superficie la cámara nunca se mete bajo el terreno (ni en la ladera que queda detrás).
    if (groundAt) tpPos.y = Math.max(tpPos.y, groundAt(tpPos.x, tpPos.z) + 0.7, groundAt((tpPos.x + feet.x) / 2, (tpPos.z + feet.z) / 2) + 0.7);
    want.copy(fpPos).lerp(tpPos, e);
    if (!camInit.current) {
      camPos.current.copy(want);
      camInit.current = true;
    }
    // Seguimiento amortiguado (casi rígido en 1ª persona).
    camPos.current.lerp(want, 1 - Math.exp(-dt * (e > 0.01 ? 14 : 40)));
    camera.position.copy(camPos.current);
    // Sacudida por impactos (decae sola; la fija el almacén de la partida).
    if (viewFx.shake > 0.001) {
      const k = viewFx.shake * 0.12 * settings.effects;
      camera.position.x += Math.sin(t.current * 71) * k;
      camera.position.y += Math.sin(t.current * 93) * k;
      viewFx.shake *= Math.exp(-dt * 3.5);
    } else viewFx.shake = 0;
    lookAt.copy(fpPos).addScaledVector(dir, 10).lerp(tmp.copy(pivot).addScaledVector(dir, 10), e);
    camera.lookAt(lookAt);
    const cam = camera as PerspectiveCamera;
    if (cam.fov !== settings.fov) {
      cam.fov = settings.fov;
      cam.updateProjectionMatrix();
    }

    // ── Avatar (balanceo procedural; sin animaciones en el GLB) ──
    const av = avatar.current;
    if (av) {
      av.visible = e > 0.12;
      av.position.set(feet.x, feet.y, feet.z);
      if (moving) {
        const heading = Math.atan2(inp.dirX, inp.dirZ); // el modelo mira a +Z: orientarlo hacia el movimiento
        const diff = MathUtils.euclideanModulo(heading - avatarYaw.current + Math.PI, Math.PI * 2) - Math.PI;
        avatarYaw.current += diff * Math.min(1, dt * 10);
      }
      av.rotation.set(0, avatarYaw.current, 0);
      // Velocidad real de los pies (incluye viento y empujes): la zancada y la pose salen de ella.
      const last = lastFeet.current;
      const speed = Number.isNaN(last.x) || dt <= 0 ? 0 : Math.hypot(feet.x - last.x, feet.z - last.z) / dt;
      const vy = Number.isNaN(last.x) || dt <= 0 ? 0 : (feet.y - last.y) / dt;
      last.copy(feet);
      const walk = s.grounded ? Math.min(speed, 12) : 0;
      gait.current = advanceGait(gait.current, walk, dt);
      applyAstronautPose(rig.current, astronautPose({ gait: gait.current, speedMps: walk, grounded: s.grounded, thrusting: s.thrusting, verticalMps: vy, timeS: t.current }));
    }
    if (jetGlow.current) {
      const on = s.thrusting ? 0.55 + Math.sin(t.current * 47) * 0.15 : 0;
      jetGlow.current.material.opacity += (on - jetGlow.current.material.opacity) * Math.min(1, dt * 20);
      jetGlow.current.visible = jetGlow.current.material.opacity > 0.02;
    }

  });

  return (
    <>
      <RigidBody
        ref={body}
        type="kinematicPosition"
        position={[start[0], start[1] + 0.85, start[2]]}
        colliders={false}
      >
        <CapsuleCollider args={[0.5, 0.35]} />
      </RigidBody>
      <group ref={avatar} visible={false}>
        <ArticulatedAstronaut lod="high" rig={rig} />
        {motion !== SHIP_MOTION && <Glow ref={jetGlow} color="#7fd8ff" size={1.3} opacity={0} position={[0, 0.7, -0.35]} />}
      </group>
    </>
  );
}
