/**
 * Fluidez de las escenas con `<Canvas>` propio (nave, superficie): precompilación de shaders y resolución adaptativa.
 *
 * - `ShaderWarmup`: compila TODOS los materiales de la escena (también los de lo que aún está oculto, como los efectos
 *   de las averías) con `compileAsync`, que con `KHR_parallel_shader_compile` no bloquea el hilo principal. Mientras
 *   compila no se pinta (el juego sigue); sin él, cada shader nuevo se compilaba al verse por primera vez y la escena
 *   se congelaba 1-3 s (medido en una GPU integrada con ANGLE/D3D11, donde enlazar un programa cuesta 50-150 ms).
 *   Va el ÚLTIMO dentro del `<Canvas>`: sus efectos corren después de los de las demás piezas (niebla, entorno).
 * - `useAdaptiveDpr`: con `PerformanceMonitor` de drei baja la resolución interna a 1 si los FPS caen y la recupera
 *   cuando sobran. Es lo que más pesa en una GPU modesta a pantalla completa (relleno de los shaders del suelo).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';

/** Tope de la espera: si el controlador no informa, se pinta igualmente. */
const WARMUP_MAX_MS = 5000;

/**
 * Toma el control del pintado (prioridad 1): R3F deja de pintar solo y lo hace este componente cuando no hay
 * shaders compilándose. `watch`: al cambiar (p. ej. la nave aterriza y por las ventanas aparece la superficie),
 * se vuelve a precompilar lo nuevo antes de pintarlo.
 */
/** `onReady`: se llama una vez, cuando la escena recién montada ya se ha pintado (quita el fundido de `App`). */
export function ShaderWarmup({ watch, onReady }: { watch?: unknown; onReady?: () => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const compiling = useRef(true);
  /** Aviso tras el PRIMER fotograma pintado con todo compilado (una vez por montaje: es la escena que entra). */
  const announce = useRef(true);
  const readyCb = useRef(onReady);
  readyCb.current = onReady;
  // Antes del siguiente fotograma: lo recién montado no se pinta hasta estar compilado.
  useLayoutEffect(() => {
    compiling.current = true;
  }, [watch]);
  useEffect(() => {
    let alive = true;
    const done = () => {
      if (alive) compiling.current = false;
    };
    const timer = setTimeout(done, WARMUP_MAX_MS);
    gl.compileAsync(scene, camera).then(done, done);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [gl, scene, camera, watch]);
  useFrame((state) => {
    if (compiling.current) return;
    state.gl.render(state.scene, state.camera);
    if (announce.current) {
      announce.current = false;
      readyCb.current?.();
    }
  }, 1);
  return null;
}

/** Resolución máxima de las escenas de juego (pantallas HiDPI). */
export const MAX_DPR = 1.75;

/** `dpr` para el `<Canvas>` y el monitor que lo ajusta (va dentro del `<Canvas>`). */
export function useAdaptiveDpr(): { dpr: [number, number]; monitor: ReactNode } {
  const [max, setMax] = useState(MAX_DPR);
  const monitor = useMemo(
    () => <PerformanceMonitor flipflops={3} onDecline={() => setMax(1)} onIncline={() => setMax(MAX_DPR)} onFallback={() => setMax(1)} />,
    [],
  );
  return { dpr: [1, max], monitor };
}
