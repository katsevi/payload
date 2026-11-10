import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import type { Group } from 'three';
import { Glow, ShaderClock } from '../gfx/Glow';
import { SkyBackdrop } from '../gfx/Sky';
import { GalaxyBackdrop } from '../models/Models';

function Spin({ speed, children }: { speed: number; children: React.ReactNode }) {
  const ref = useRef<Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * speed;
  });
  return <group ref={ref}>{children}</group>;
}

/** Deriva lenta de la cámara: el fondo del menú nunca está del todo quieto. */
function Drift() {
  useFrame(({ camera, clock }) => {
    const t = clock.elapsedTime;
    camera.position.set(Math.sin(t * 0.05) * 2.2, 6 + Math.sin(t * 0.07) * 0.8, 26 + Math.cos(t * 0.04) * 1.2);
    camera.lookAt(0, 0, 0);
  });
  return null;
}

/** Fondo del menú: la galaxia girando lentamente sobre el cielo profundo. */
export function MenuScene() {
  return (
    <Canvas dpr={[1, 1.5]} camera={{ fov: 50, near: 0.1, far: 2000, position: [0, 6, 26] }}>
      <color attach="background" args={['#01020a']} />
      <ShaderClock />
      <SkyBackdrop seed={3} />
      <Drift />
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 10]} intensity={2} />
      <Stars radius={300} depth={60} count={3600} factor={4.5} saturation={0.35} fade speed={0.5} />
      <group rotation={[0.45, 0, 0.1]}>
        <Spin speed={0.04}>
          <GalaxyBackdrop width={26} />
        </Spin>
        {/* Resplandor del bulbo galáctico. */}
        <Glow color="#ffe2b8" size={11} opacity={0.5} />
      </group>
    </Canvas>
  );
}
