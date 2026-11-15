/**
 * Fluidez de las escenas con `<Canvas>` propio (nave, superficie): precompilación de shaders y resolución adaptativa.
 *
 * - `ShaderWarmup`: compila TODOS los materiales de la escena (también los de lo que aún está oculto, como los efectos
 *   de las averías) con `compileAsync`, que con `KHR_parallel_shader_compile` no bloquea el hilo principal. Mientras
 *   compila no se pinta (el juego sigue); sin él, cada shader nuevo se compilaba al verse por primera vez y la escena
 *   se congelaba 1-3 s (medido en una GPU integrada con ANGLE/D3D11, donde enlazar un programa cuesta 50-150 ms).
 *   Va el ÚLTIMO dentro del `<Canvas>`: sus efectos corren después de los de las demás piezas (niebla, entorno).
 * - `useAdaptiveDpr`: con `PerformanceMonitor` de drei baja la resolución interna a escalones si los FPS caen (sin
 *   volver a subirla: ver abajo). Es lo que más pesa en una GPU modesta a pantalla completa (relleno de los shaders del suelo).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { DPR_LEVELS, dprBounds, nextDprLevel } from './dprLevels';

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

export { MAX_DPR } from './dprLevels';

/**
 * Nivel de resolución aprendido en la sesión: si una escena tuvo que bajarla, la siguiente (nave ↔ descenso ↔ EVA, misma
 * GPU y pantalla) empieza ahí y no repite los segundos de tirones hasta que el monitor reacciona.
 */
let learnedLevel = 0;

/**
 * `dpr` para el `<Canvas>` y el monitor que lo ajusta (va dentro del `<Canvas>`). Solo BAJA, a escalones
 * (`DPR_LEVELS`): antes subía y bajaba entre 1 y 1,75 (a 1 iba a 60 FPS, volvía a subir, caía a 45…) y cada cambio
 * redimensiona el lienzo con un tirón de 150-300 ms. `minLevel` empieza la escena ya más baja (el descenso).
 */
export function useAdaptiveDpr(minLevel = 0): { dpr: [number, number]; monitor: ReactNode } {
  const [level, setLevel] = useState(() => Math.max(learnedLevel, minLevel));
  const monitor = useMemo(
    () => (
      <PerformanceMonitor
        bounds={dprBounds}
        onDecline={() =>
          setLevel((l) => {
            const next = nextDprLevel(l);
            learnedLevel = Math.max(learnedLevel, next);
            return next;
          })
        }
      />
    ),
    [],
  );
  return { dpr: [1, DPR_LEVELS[level] ?? 1], monitor };
}
