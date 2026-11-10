import { forwardRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, type ColorRepresentation, type Sprite } from 'three';
import { VIEW_H } from './fxShaders';
import { TIME } from './glsl';
import { glowTexture } from './textures';

/** Avanza el reloj común de los shaders y publica el alto del lienzo. Una instancia por `<Canvas>`. */
export function ShaderClock() {
  useFrame((state) => {
    TIME.value = state.clock.elapsedTime;
    VIEW_H.value = state.gl.domElement.height;
  });
  return null;
}

interface GlowProps {
  color?: ColorRepresentation;
  /** Diámetro del halo en metros. */
  size?: number;
  opacity?: number;
  position?: [number, number, number];
}

/**
 * Halo aditivo que mira siempre a la cámara: el resplandor de una luz sin post-proceso. Para animarlo,
 * usa la ref y cambia `material.color` / `material.opacity` / `scale` en `useFrame`.
 */
export const Glow = forwardRef<Sprite, GlowProps>(function Glow({ color = '#ffffff', size = 1, opacity = 0.6, position }, ref) {
  return (
    <sprite ref={ref} position={position} scale={[size, size, 1]}>
      <spriteMaterial map={glowTexture()} color={color} opacity={opacity} transparent blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
    </sprite>
  );
});
