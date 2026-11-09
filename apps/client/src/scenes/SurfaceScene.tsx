import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { Color, PlaneGeometry, type Group } from 'three';
import { WalkerExhibit } from '../models/Models';

const GROUND: Record<'moon' | 'mars', { ground: string; sky: string; fog: string; sun: number }> = {
  moon: { ground: '#8d8d8f', sky: '#000000', fog: '#000000', sun: 3.2 },
  mars: { ground: '#a2492a', sky: '#c8896a', fog: '#c8896a', sun: 2.2 },
};

/** Suelo ondulado procedural (ruido barato sin dependencias), con cráteres suaves. */
function Terrain({ color }: { color: string }) {
  const geo = useMemo(() => {
    const g = new PlaneGeometry(120, 120, 80, 80);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position!;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const flat = Math.min(1, Math.hypot(x, z) / 9); // llano alrededor del rover
      const h = (Math.sin(x * 0.21) * Math.cos(z * 0.17) * 0.9 + Math.sin(x * 0.53 + z * 0.41) * 0.3 + Math.sin(z * 0.09 - x * 0.07) * 1.6) * flat;
      p.setY(i, h);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial color={color} roughness={1} flatShading />
    </mesh>
  );
}

/** Aurora G9 recorre un círculo con un bamboleo de marcha (el GLB no trae animaciones). */
function WalkingRover() {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const a = t * 0.22;
    const r = 4.5;
    if (root.current) {
      root.current.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      root.current.rotation.y = -a; // mira en la dirección de avance
    }
    if (body.current) {
      body.current.position.y = Math.abs(Math.sin(t * 2.6)) * 0.07;
      body.current.rotation.z = Math.sin(t * 2.6) * 0.035;
      body.current.rotation.x = Math.sin(t * 1.3) * 0.015;
    }
  });
  return (
    <group ref={root}>
      <group ref={body}>
        <WalkerExhibit size={2.4} delayMs={0} />
      </group>
    </group>
  );
}

function CameraRig() {
  useFrame(({ camera, clock }) => {
    const t = clock.elapsedTime * 0.05;
    camera.position.set(Math.sin(t) * 10, 2.3, Math.cos(t) * 10);
    camera.lookAt(0, 1.1, 0);
  });
  return null;
}

/** Vista breve de superficie lunar o marciana con el rover Aurora G9 caminando. Carga diferida. */
export function SurfaceScene({ kind }: { kind: 'moon' | 'mars' }) {
  const c = GROUND[kind];
  const sky = useMemo(() => new Color(c.sky), [c.sky]);
  return (
    <Canvas dpr={[1, 1.5]} camera={{ fov: 50, near: 0.1, far: 300, position: [0, 2.3, 10] }}>
      <color attach="background" args={[sky.getStyle()]} />
      {kind === 'mars' && <fog attach="fog" args={[c.fog, 18, 90]} />}
      {kind === 'moon' && <Stars radius={150} depth={40} count={1800} factor={4} fade />}
      <ambientLight intensity={kind === 'moon' ? 0.25 : 0.6} />
      <directionalLight position={[12, 9, 6]} intensity={c.sun} />
      <Terrain color={c.ground} />
      <WalkingRover />
      <CameraRig />
    </Canvas>
  );
}
