import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { MathUtils, Vector3, type Group, type PerspectiveCamera } from 'three';
import { AstronautModel } from '../models/Models';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { attachKeyboard, isDown } from './input';
import { lookDir, playerState } from './playerState';

type KinematicCharacterController = ReturnType<ReturnType<typeof useRapier>['world']['createCharacterController']>;

const WALK = 3.2;
const RUN = 5.5;
const GRAVITY = -12;
const EYE = 1.6;
const TRANSITION_S = 0.4;
const ROOM = 12.6; // límite para que la cámara en 3ª persona no atraviese las paredes

const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * Personaje con controlador cinemático de Rapier. El mismo cuerpo sirve a la 1ª y 3ª persona:
 * cambiar de vista (V) solo mueve la cámara, nunca la física.
 */
export function PlayerController({ start = [0, 0, 9] as [number, number, number] }) {
  const body = useRef<RapierRigidBody>(null);
  const avatar = useRef<Group>(null);
  const { world } = useRapier();
  const { camera, gl } = useThree();
  const vy = useRef(0);
  const blend = useRef(useUi.getState().view === 'third' ? 1 : 0); // 0 = 1ª persona, 1 = 3ª persona
  const avatarYaw = useRef(Math.PI); // mirando a -Z (yaw inicial)
  const camPos = useRef(new Vector3());
  const camInit = useRef(false);
  const t = useRef(0);
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
    playerState.pos.set(...start);
    playerState.yaw = 0;
    playerState.pitch = 0;
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
    const blocked = ui.overlay !== null || ui.inputBlocked;

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
    const speed = isDown('ShiftLeft') || isDown('ShiftRight') ? RUN : WALK;
    const sy = Math.sin(playerState.yaw);
    const cy = Math.cos(playerState.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    const dx = moving ? ((-sy * fz + cy * fx) / len) * speed * dt : 0;
    const dz = moving ? ((-cy * fz - sy * fx) / len) * speed * dt : 0;
    vy.current = Math.max(vy.current + GRAVITY * dt, -20);

    const col = rb.collider(0);
    controller.computeColliderMovement(col, { x: dx, y: vy.current * dt, z: dz });
    const m = controller.computedMovement();
    const p = rb.translation();
    rb.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
    if (controller.computedGrounded()) vy.current = 0;

    playerState.pos.set(p.x, p.y - 0.85, p.z);
    playerState.moving = moving;

    // ── Cámara (transición suave 1ª ↔ 3ª) ──
    const target = ui.view === 'third' ? 1 : 0;
    blend.current = MathUtils.clamp(blend.current + Math.sign(target - blend.current) * (dt / TRANSITION_S), 0, 1);
    if (Math.abs(target - blend.current) < 1e-4) blend.current = target;
    const e = smooth(blend.current);

    const { dir, fpPos, right, pivot, tpPos, want, lookAt, tmp } = scratch;
    lookDir(dir);
    const feet = playerState.pos;
    const bob = settings.headBob && moving ? Math.sin(t.current * 9) * 0.035 : 0;
    fpPos.set(feet.x, feet.y + EYE + bob, feet.z);
    right.set(cy, 0, -sy);
    pivot.set(feet.x, feet.y + 1.55, feet.z).addScaledVector(right, 0.55);
    tpPos.copy(pivot).addScaledVector(dir, -3.2);
    tpPos.x = MathUtils.clamp(tpPos.x, -ROOM, ROOM);
    tpPos.z = MathUtils.clamp(tpPos.z, -ROOM, ROOM);
    tpPos.y = MathUtils.clamp(tpPos.y, 0.3, 7.4);
    want.copy(fpPos).lerp(tpPos, e);
    if (!camInit.current) {
      camPos.current.copy(want);
      camInit.current = true;
    }
    // Seguimiento amortiguado (casi rígido en 1ª persona).
    camPos.current.lerp(want, 1 - Math.exp(-dt * (e > 0.01 ? 14 : 40)));
    camera.position.copy(camPos.current);
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
        const heading = Math.atan2(dx, dz); // el modelo mira a +Z: orientarlo hacia el movimiento
        const diff = MathUtils.euclideanModulo(heading - avatarYaw.current + Math.PI, Math.PI * 2) - Math.PI;
        avatarYaw.current += diff * Math.min(1, dt * 10);
      }
      av.rotation.set(moving ? 0.1 : 0, avatarYaw.current, moving ? Math.sin(t.current * 9) * 0.06 : 0);
      av.position.y += moving ? Math.abs(Math.sin(t.current * 9)) * 0.04 : 0;
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
        <AstronautModel height={1.8} />
      </group>
    </>
  );
}
