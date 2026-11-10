import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { Color, CubeCamera, HalfFloatType, Mesh, Scene, SphereGeometry, WebGLCubeRenderTarget } from 'three';
import { skyMaterial } from './spaceShaders';

/**
 * Cielo profundo: el shader de nubes de gas se rinde UNA vez a un cubemap y queda como fondo de la
 * escena (coste por frame casi nulo). `seed` cambia el dibujo y los tonos: cada sector tiene su cielo.
 */
export function SkyBackdrop({ seed }: { seed: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const hue = (((seed * 0.618034) % 1) + 1) % 1;
    const target = new WebGLCubeRenderTarget(512, { type: HalfFloatType, generateMipmaps: false });
    const material = skyMaterial((seed % 97) * 1.37, new Color().setHSL(hue, 0.75, 0.5), new Color().setHSL((hue + 0.38) % 1, 0.7, 0.5));
    const dome = new Mesh(new SphereGeometry(5, 32, 16), material);
    const bakeScene = new Scene();
    bakeScene.add(dome);
    new CubeCamera(0.1, 10, target).update(gl, bakeScene);
    const previous = scene.background;
    scene.background = target.texture;
    return () => {
      scene.background = previous;
      target.dispose();
      material.dispose();
      dome.geometry.dispose();
    };
  }, [gl, scene, seed]);
  return null;
}
