import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { Color, MathUtils, Vector3, type Group, type Mesh } from 'three';
import { useLaunch, type LaunchPhase } from '../state/launch';
import { useSettings } from '../state/settings';
import { useSim } from '../state/sim';
import { useUi } from '../state/ui';

const COUNTDOWN_S = 8;
const SEP_AFTER_S = 6; // separación de etapas tras el despegue
const FAIL_AFTER_S = 7; // si el lanzamiento falla, la anomalía ocurre aquí
const ACCEL = 3.2;
const SKY_LOW = new Color('#7fb2e5');
const SKY_HIGH = new Color('#02040a');

function Tower() {
  return (
    <group position={[-3.2, 0, 0]}>
      <mesh position={[0, 12, 0]} castShadow>
        <boxGeometry args={[0.9, 24, 0.9]} />
        <meshStandardMaterial color="#b4472f" metalness={0.4} roughness={0.6} wireframe />
      </mesh>
      <mesh position={[0, 12, 0]}>
        <boxGeometry args={[0.7, 24, 0.7]} />
        <meshStandardMaterial color="#8a3523" />
      </mesh>
      {[6, 12, 18].map((y) => (
        <mesh key={y} position={[1.5, y, 0]}>
          <boxGeometry args={[3, 0.15, 0.3]} />
          <meshStandardMaterial color="#8a3523" />
        </mesh>
      ))}
    </group>
  );
}

function Flame({ scale }: { scale: number }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.scale.set(1, scale * (0.85 + Math.sin(clock.elapsedTime * 40) * 0.15), 1);
  });
  return (
    <mesh ref={ref} position={[0, -0.9 * scale, 0]} rotation={[Math.PI, 0, 0]}>
      <coneGeometry args={[0.38, 1.8, 12]} />
      <meshBasicMaterial color="#ffb347" />
    </mesh>
  );
}

function Debris() {
  const ref = useRef<Group>(null);
  const vel = useRef(Array.from({ length: 14 }, (_, i) => new Vector3(Math.cos(i * 1.7) * 6, 4 + (i % 5) * 2, Math.sin(i * 2.3) * 6)));
  useFrame((_, dt) => {
    ref.current?.children.forEach((c, i) => {
      const v = vel.current[i];
      if (!v) return;
      v.y -= 9 * dt;
      c.position.addScaledVector(v, dt);
      c.rotation.x += dt * 3;
    });
  });
  return (
    <group ref={ref}>
      {vel.current.map((_, i) => (
        <mesh key={i}>
          <boxGeometry args={[0.3, 0.3, 0.3]} />
          <meshStandardMaterial color={i % 2 ? '#e8e8e8' : '#444'} />
        </mesh>
      ))}
    </group>
  );
}

/** Secuencia: cuenta atrás → despegue → separación de etapas (o anomalía si la simulación dice que falla). */
function Sequence({ onDone }: { onDone: () => void }) {
  const rocket = useRef<Group>(null);
  const stage1 = useRef<Group>(null);
  const sepVel = useRef(0);
  const boom = useRef<Mesh>(null);
  const t = useRef(0);
  const phase = useRef<LaunchPhase>('countdown');
  const done = useRef(false);
  const camPos = useRef(new Vector3(9, 4, 14));
  const lookAt = useRef(new Vector3(0, 3, 0));
  const { camera, scene } = useThree();
  const sepStage = useRef({ y: 0, rel: 0 });
  const pos = useRef(new Vector3());
  const wantRef = useRef(new Vector3());

  useEffect(() => {
    useLaunch.getState().reset();
    scene.background = SKY_LOW.clone();
  }, [scene]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const ok = useSim.getState().launchOk !== false;
    const launch = useLaunch.getState();
    if (launch.skip && !done.current) {
      // Saltar: fija el tiempo al final de la secuencia.
      t.current = COUNTDOWN_S + (ok ? 12 : FAIL_AFTER_S + 3);
      launch.set({ skip: false });
    }
    t.current += dt;
    const tl = t.current - COUNTDOWN_S; // tiempo desde el despegue
    let y = tl > 0 ? 0.5 * ACCEL * tl * tl : 0;
    const failed = !ok && tl > FAIL_AFTER_S;
    if (!ok && tl > FAIL_AFTER_S) y = 0.5 * ACCEL * FAIL_AFTER_S * FAIL_AFTER_S;

    let next: LaunchPhase = 'countdown';
    if (tl > 0) next = 'ascent';
    if (ok && tl > SEP_AFTER_S) next = 'separation';
    if (failed) next = 'failure';
    if (ok && tl > SEP_AFTER_S + 5) next = 'success';
    const count = Math.max(0, Math.ceil(COUNTDOWN_S - t.current));
    if (next !== phase.current || (next === 'countdown' && count !== launch.count)) {
      phase.current = next;
      launch.set({ phase: next, count });
    }

    pos.current.set(0, 3 + y, 0);
    const r = rocket.current;
    if (r) {
      r.visible = !failed;
      r.position.y = y;
      r.rotation.z = tl > 3 ? Math.min(0.12, (tl - 3) * 0.015) : 0;
    }
    // Primera etapa se separa y cae.
    const s1 = stage1.current;
    if (s1) {
      if (ok && tl > SEP_AFTER_S) {
        sepVel.current += dt * 0.5;
        sepStage.current.rel -= sepVel.current * dt * 6;
        s1.position.y = sepStage.current.rel;
        s1.rotation.x += dt * 0.4;
        s1.visible = sepStage.current.rel > -60;
      } else {
        s1.position.set(0, 0, 0);
        s1.rotation.set(0, 0, 0);
        s1.visible = true;
      }
    }
    const b = boom.current;
    if (b) {
      b.visible = failed;
      if (failed) {
        const k = Math.min(1, (tl - FAIL_AFTER_S) / 1.2);
        b.position.set(0, 3 + y, 0);
        b.scale.setScalar(1 + k * 9);
        (b.material as import('three').MeshBasicMaterial).opacity = 1 - k;
      }
    }

    // Fondo: cielo → espacio con la altitud.
    if (scene.background instanceof Color) scene.background.copy(SKY_LOW).lerp(SKY_HIGH, MathUtils.clamp(y / 160, 0, 1));

    // Cámaras
    const view = useUi.getState().view;
    const rp = pos.current;
    const want = wantRef.current;
    if (view === 'third') want.set(11 + y * 0.02, rp.y * 0.6 + 4, 16 + y * 0.06);
    else want.set(-6.5, 20, 7); // vista desde la torre
    camPos.current.lerp(want, 1 - Math.exp(-dt * 3));
    lookAt.current.lerp(rp, 1 - Math.exp(-dt * 4));
    camera.position.copy(camPos.current);
    camera.lookAt(lookAt.current);

    const endAt = ok ? SEP_AFTER_S + 6 : FAIL_AFTER_S + 3;
    if (tl > endAt && !done.current) {
      done.current = true;
      onDone();
    }
  });

  const ok = useSim.getState().launchOk !== false;
  return (
    <>
      <group ref={rocket}>
        {/* Primera etapa */}
        <group ref={stage1}>
          <mesh position={[0, 3, 0]} castShadow>
            <cylinderGeometry args={[0.55, 0.55, 6, 24]} />
            <meshStandardMaterial color="#f2f2f2" roughness={0.4} />
          </mesh>
          <mesh position={[0, 1.4, 0]}>
            <cylinderGeometry args={[0.56, 0.56, 0.5, 24]} />
            <meshStandardMaterial color="#222" />
          </mesh>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} position={[Math.cos((i * Math.PI) / 2) * 0.7, 0.8, Math.sin((i * Math.PI) / 2) * 0.7]} rotation={[0, -(i * Math.PI) / 2, 0]}>
              <boxGeometry args={[0.5, 1.2, 0.05]} />
              <meshStandardMaterial color="#c0392b" />
            </mesh>
          ))}
          <group position={[0, 0.2, 0]}>
            <Flame scale={ok || t.current < COUNTDOWN_S + FAIL_AFTER_S ? 1 : 0.01} />
          </group>
        </group>
        {/* Segunda etapa + carga útil */}
        <mesh position={[0, 7.4, 0]} castShadow>
          <cylinderGeometry args={[0.42, 0.52, 2.8, 24]} />
          <meshStandardMaterial color="#e6e6e6" roughness={0.4} />
        </mesh>
        <mesh position={[0, 9.6, 0]} castShadow>
          <coneGeometry args={[0.42, 1.6, 24]} />
          <meshStandardMaterial color="#d9d9d9" />
        </mesh>
      </group>
      <mesh ref={boom} visible={false}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshBasicMaterial color="#ff9d3a" transparent />
      </mesh>
      {!ok && <FailureDebris />}
    </>
  );
}

function FailureDebris() {
  // Los restos solo existen tras la anomalía.
  const phase = useLaunch((s) => s.phase);
  return phase === 'failure' ? (
    <group position={[0, 25, 0]}>
      <Debris />
    </group>
  ) : null;
}

export function LaunchScene({ onDone }: { onDone: () => void }) {
  const shadows = useSettings((s) => s.shadows);
  return (
    <Canvas shadows={shadows} dpr={[1, 1.75]} camera={{ fov: 60, near: 0.1, far: 3000, position: [11, 4, 16] }}>
      <ambientLight intensity={0.8} />
      <directionalLight position={[20, 40, 10]} intensity={2} castShadow={shadows} shadow-mapSize={[1024, 1024]} />
      <Stars radius={500} depth={50} count={2500} factor={5} fade />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[800, 48]} />
        <meshStandardMaterial color="#5a7a45" />
      </mesh>
      <mesh position={[0, 0.15, 0]} receiveShadow>
        <cylinderGeometry args={[5, 5.5, 0.3, 32]} />
        <meshStandardMaterial color="#777b80" />
      </mesh>
      <Tower />
      <Sequence onDone={onDone} />
    </Canvas>
  );
}
