import { Component, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useGLTF } from '@react-three/drei';
import { Box3, Vector3, type Object3D } from 'three';
import { MODEL_URLS } from './urls';

/** Si un GLB falla (p. ej. aún no existe), muestra una forma simple en lugar de romper la escena. */
export class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.warn('[models] fallo al cargar un modelo, se usa una forma simple:', error);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Precarga diferida de los modelos ligeros (sin lanzar si faltan los archivos). */
export function preloadModels(): void {
  // Fase 5: el tripulante ya es el astronauta articulado procedural; el GLB solo se carga si se monta `AstronautModel`.
  for (const url of [MODEL_URLS.galaxy]) {
    try {
      useGLTF.preload(url);
    } catch {
      /* el ErrorBoundary de cada modelo se ocupa al montar */
    }
  }
}

interface FitProps {
  url: string;
  /** Escala el modelo para que su alto/ancho/largo mayor sea este valor. */
  size?: number;
  /** Escala por altura (Y). Tiene prioridad sobre size. */
  height?: number;
  /** 'feet': origen en los pies (centrado en XZ); 'center': centrado en los tres ejes. */
  origin?: 'feet' | 'center';
}

/** Carga un GLB, lo clona y lo ajusta a un tamaño y origen conocidos. */
function FittedModel({ url, size, height, origin = 'center' }: FitProps) {
  const { scene } = useGLTF(url);
  const { object, scale, offset } = useMemo(() => {
    const object: Object3D = scene.clone(true);
    const box = new Box3().setFromObject(object);
    const dim = box.getSize(new Vector3());
    const c = box.getCenter(new Vector3());
    const ref = height ? dim.y : Math.max(dim.x, dim.y, dim.z);
    const target = height ?? size ?? ref;
    const scale = ref > 0 ? target / ref : 1;
    const offset = new Vector3(-c.x * scale, (origin === 'feet' ? -box.min.y : -c.y) * scale, -c.z * scale);
    return { object, scale, offset };
  }, [scene, size, height, origin]);
  return (
    <group position={offset} scale={scale}>
      <primitive object={object} />
    </group>
  );
}

type GroupProps = { position?: [number, number, number]; rotation?: [number, number, number] };

/** GLB del tripulante (sin esqueleto). Sin uso desde la fase 5: lo sustituye `ArticulatedAstronaut`. */
export function AstronautModel({ height = 1.8, ...g }: { height?: number } & GroupProps) {
  return (
    <group {...g}>
      <ModelBoundary
        fallback={
          <mesh position={[0, height / 2, 0]} castShadow>
            <capsuleGeometry args={[height * 0.18, height * 0.5, 4, 8]} />
            <meshStandardMaterial color="#e8eef5" />
          </mesh>
        }
      >
        <Suspense fallback={null}>
          <FittedModel url={MODEL_URLS.astronaut} height={height} origin="feet" />
        </Suspense>
      </ModelBoundary>
    </group>
  );
}

/** Mecha Aurora G9 con carga diferida (el GLB es pesado). Sin uso en la fase 1: reservado para la superficie (fase 2). */
export function WalkerExhibit({ size = 4, delayMs = 2500, ...g }: { size?: number; delayMs?: number } & GroupProps) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), delayMs);
    return () => window.clearTimeout(id);
  }, [delayMs]);
  return (
    <group {...g}>
      <ModelBoundary
        fallback={
          <mesh position={[0, size / 4, 0]} castShadow>
            <boxGeometry args={[size / 2, size / 2, size / 2]} />
            <meshStandardMaterial color="#6b7a8c" />
          </mesh>
        }
      >
        <Suspense fallback={null}>{ready && <FittedModel url={MODEL_URLS.walker} size={size} origin="feet" />}</Suspense>
      </ModelBoundary>
    </group>
  );
}

/** Consola del timón (GLB ligero, ~0.5 MB). `fallback` se muestra mientras carga o si falla. */
export function ConsoleModel({ height = 1.6, fallback, ...g }: { height?: number; fallback: ReactNode } & GroupProps) {
  return (
    <group {...g}>
      <ModelBoundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <FittedModel url={MODEL_URLS.console} height={height} origin="feet" />
        </Suspense>
      </ModelBoundary>
    </group>
  );
}

/** Galaxia unlit de fondo (el material del GLB ya es unlit; se escala a `width` unidades). */
export function GalaxyBackdrop({ width = 400, ...g }: { width?: number } & GroupProps) {
  return (
    <group {...g}>
      <ModelBoundary
        fallback={
          <mesh>
            <circleGeometry args={[width / 2, 48]} />
            <meshBasicMaterial color="#1c2a55" transparent opacity={0.5} />
          </mesh>
        }
      >
        <Suspense fallback={null}>
          <FittedModel url={MODEL_URLS.galaxy} size={width} origin="center" />
        </Suspense>
      </ModelBoundary>
    </group>
  );
}

/** Estación anular Erizon (~43 × 10 unidades originales, 7.6 MB): carga diferida; se ve por la proa al atracar en una estación. */
export function ErizonStation({ size = 43, delayMs = 3000, ...g }: { size?: number; delayMs?: number } & GroupProps) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), delayMs);
    return () => window.clearTimeout(id);
  }, [delayMs]);
  return (
    <group {...g}>
      <ModelBoundary
        fallback={
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[size / 2, size / 14, 8, 40]} />
            <meshStandardMaterial color="#9aa7b8" metalness={0.6} roughness={0.4} />
          </mesh>
        }
      >
        <Suspense fallback={null}>
          {ready && <FittedModel url={MODEL_URLS.erizon} size={size} origin="center" />}
        </Suspense>
      </ModelBoundary>
    </group>
  );
}
