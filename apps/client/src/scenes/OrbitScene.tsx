import { useEffect, useMemo, useRef, type ElementRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line, OrbitControls, Stars } from '@react-three/drei';
import { Vector3, type Group, type PerspectiveCamera } from 'three';
import { catalog, computeOrbitParams, type OrbitDef } from '@payload/shared';
import { ErizonStation, GalaxyBackdrop } from '../models/Models';
import { useDesign } from '../state/design';
import { getLiveSnapshot, useSim } from '../state/sim';
import { useUi } from '../state/ui';
import { buildEarthGeometry } from './earth';
import { EARTH_R, orbitShape } from './orbitMath';
import { Ship } from './Ship';

function Earth() {
  const geo = useMemo(() => buildEarthGeometry(EARTH_R), []);
  const ref = useRef<Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.02;
  });
  return (
    <group>
      <group ref={ref}>
        <mesh geometry={geo}>
          <meshStandardMaterial vertexColors roughness={0.9} />
        </mesh>
      </group>
      {/* Atmósfera */}
      <mesh scale={1.035}>
        <sphereGeometry args={[EARTH_R, 48, 32]} />
        <meshBasicMaterial color="#5aa6ff" transparent opacity={0.18} depthWrite={false} side={1} />
      </mesh>
    </group>
  );
}

/** Cono de sombra de la Tierra (el Sol está en +X). */
function EarthShadow() {
  return (
    <mesh position={[-EARTH_R - 30, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[EARTH_R, EARTH_R, 60, 40, 1, true]} />
      <meshBasicMaterial color="#000010" transparent opacity={0.4} depthWrite={false} side={2} />
    </mesh>
  );
}

function useOrbitDef(): OrbitDef | undefined {
  const orbitId = useDesign((s) => s.orbitId);
  return catalog.orbits.find((o) => o.id === orbitId);
}

function Orbit({ def }: { def: OrbitDef }) {
  const { points, eclipsePts } = useMemo(() => {
    const shape = orbitShape(def.perigeeKm, def.apogeeKm, def.inclinationDeg);
    const N = 160;
    const ef = computeOrbitParams(def).eclipseFraction;
    const half = Math.PI * ef; // eclipse centrado en θ = π (cara nocturna)
    const pts: Vector3[] = [];
    const ecl: Vector3[] = [];
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      const p = new Vector3(...shape.at(th));
      pts.push(p);
      if (Math.abs(th - Math.PI) <= half) ecl.push(p);
    }
    return { points: pts, eclipsePts: ecl };
  }, [def]);
  return (
    <>
      <Line points={points} color="#38e1c0" lineWidth={1.2} transparent opacity={0.7} />
      {eclipsePts.length > 1 && <Line points={eclipsePts} color="#ffb020" lineWidth={2.4} />}
    </>
  );
}

function SpacecraftAndCamera({ def }: { def: OrbitDef }) {
  const shape = useMemo(() => orbitShape(def.perigeeKm, def.apogeeKm, def.inclinationDeg), [def]);
  const ids = useDesign((s) => s.componentIds);
  const craft = useRef<Group>(null);
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const { camera } = useThree();
  const camPos = useRef(new Vector3());
  const look = useRef(new Vector3());
  const tmp = useMemo(() => ({ p: new Vector3(), want: new Vector3(), out: new Vector3(), ahead: new Vector3() }), []);
  const view = useUi((s) => s.view);

  // Al volver a la cámara orbital, reencuadrar la vista general.
  useEffect(() => {
    if (view === 'third') {
      camera.position.set(0, shape.apogeeR * 0.9, shape.apogeeR * 1.9 + 6);
      controls.current?.target.set(0, 0, 0);
      controls.current?.update();
    }
    camPos.current.copy(camera.position);
    (camera as PerspectiveCamera).fov = view === 'first' ? 55 : 50;
    (camera as PerspectiveCamera).updateProjectionMatrix();
  }, [view, camera, shape]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    useSim.getState().tick(dt);
    const snap = getLiveSnapshot();
    const phase = snap?.orbitPhase ?? 0;
    const p = tmp.p;
    shape.atTo(phase * Math.PI * 2, p);
    const g = craft.current;
    if (g) {
      g.position.copy(p);
      // Orientar el instrumento (+Z del modelo) hacia la Tierra.
      g.lookAt(0, 0, 0);
    }
    if (useUi.getState().view === 'first') {
      // Vista a través del instrumento: desde la nave, mirando al nadir y ligeramente hacia delante.
      tmp.want.copy(p).addScaledVector(tmp.out.copy(p).normalize(), 0.35);
      camPos.current.lerp(tmp.want, 1 - Math.exp(-dt * 6));
      shape.atTo((phase + 0.03) * Math.PI * 2, tmp.ahead);
      look.current.lerp(tmp.ahead.multiplyScalar(0.92), 1 - Math.exp(-dt * 6));
      camera.position.copy(camPos.current);
      camera.lookAt(look.current);
    }
  });

  return (
    <>
      <group ref={craft}>
        <group scale={0.35} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <group position={[0, -1.4, 0]}>
            <Ship componentIds={ids} />
          </group>
        </group>
        <mesh>
          <sphereGeometry args={[0.2, 12, 12]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      </group>
      <OrbitControls ref={controls} enabled={view === 'third'} enablePan={false} minDistance={8} maxDistance={140} />
    </>
  );
}

export function OrbitScene() {
  const def = useOrbitDef();
  return (
    <Canvas dpr={[1, 1.75]} camera={{ fov: 50, near: 0.05, far: 4000, position: [0, 20, 40] }}>
      <color attach="background" args={['#01020a']} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[100, 0, 0]} intensity={3.2} />
      <Stars radius={900} depth={80} count={4000} factor={6} fade />
      <GalaxyBackdrop width={1800} position={[0, -300, -1500]} rotation={[0.5, 0, 0]} />
      <Earth />
      <EarthShadow />
      <ErizonStation size={12} position={[24, 8, -30]} rotation={[0.4, 0.3, 0.2]} />
      {def && <Orbit def={def} />}
      {def && <SpacecraftAndCamera def={def} />}
    </Canvas>
  );
}
