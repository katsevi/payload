import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import type { Group } from 'three';
import { GalaxyBackdrop } from '../models/Models';

function Spin({ speed, children }: { speed: number; children: React.ReactNode }) {
  const ref = useRef<Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * speed;
  });
  return <group ref={ref}>{children}</group>;
}

/** Fondo del menú: galaxia girando lentamente (Erizon solo se carga en la escena orbital). */
export function MenuScene() {
  return (
    <Canvas dpr={[1, 1.5]} camera={{ fov: 50, near: 0.1, far: 2000, position: [0, 6, 26] }}>
      <color attach="background" args={['#01020a']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 10]} intensity={2} />
      <Stars radius={300} depth={60} count={3000} factor={4} fade />
      <group rotation={[0.45, 0, 0.1]}>
        <Spin speed={0.04}>
          <GalaxyBackdrop width={26} />
        </Spin>
      </group>
    </Canvas>
  );
}
