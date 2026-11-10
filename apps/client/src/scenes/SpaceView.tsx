import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { AdditiveBlending, Color, Object3D, type Group, type InstancedMesh, type Sprite } from 'three';
import { getNode, type NodeKind, NODE_KINDS } from '@payload/shared';
import { getRun, useGame } from '../game/runStore';
import { Glow } from '../gfx/Glow';
import { SkyBackdrop } from '../gfx/Sky';
import { SUN_DIR } from '../gfx/spaceShaders';
import { flareTexture } from '../gfx/textures';
import { Body } from './SpaceBodies';

/** La estrella cercana: destello visible por las ventanas y la luz direccional que ilumina los cuerpos. */
function Sun() {
  return (
    <>
      <directionalLight position={[SUN_DIR.x * 100, SUN_DIR.y * 100, SUN_DIR.z * 100]} intensity={1.1} color="#fff1dd" />
      <sprite position={[SUN_DIR.x * 1500, SUN_DIR.y * 1500, SUN_DIR.z * 1500]} scale={[760, 760, 1]}>
        <spriteMaterial map={flareTexture()} color="#fff3e2" transparent blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </sprite>
    </>
  );
}

const STREAKS = 260;

/** Estelas del salto: pasan junto a las ventanas a una velocidad proporcional a la de la nave. */
function WarpStreaks() {
  const mesh = useRef<InstancedMesh>(null);
  const tunnel = useRef<Sprite>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const seeds = useMemo(
    () =>
      Array.from({ length: STREAKS }, (_, i) => {
        // Reparto determinista (sin azar por frame): ángulo áureo alrededor del casco.
        const angle = i * 2.399963;
        const radius = 9 + ((i * 37) % 100) * 0.42;
        return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.7 + 2, z: -160 + ((i * 53) % 220), len: 4 + ((i * 17) % 11), thick: 0.6 + ((i * 29) % 10) * 0.09 };
      }),
    [],
  );
  const flow = useRef(0);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    // Casi todas blanco azulado; alguna violeta o turquesa para dar profundidad.
    const c = new Color();
    for (let i = 0; i < STREAKS; i++) m.setColorAt(i, i % 7 === 0 ? c.set('#c9a8ff') : i % 5 === 0 ? c.set('#7ff0dc') : c.set('#a9dcff'));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);
  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    const speed = getRun()?.state.ship.speedLyPerS ?? 0;
    // Suavizado para que arrancar y frenar se note.
    flow.current += (speed - flow.current) * Math.min(1, dt * 2.5);
    const v = flow.current * 150;
    const stretch = Math.min(1, flow.current / 0.3);
    for (let i = 0; i < STREAKS; i++) {
      const s = seeds[i]!;
      s.z += v * dt;
      if (s.z > 60) s.z -= 220;
      dummy.position.set(s.x, s.y, s.z);
      dummy.scale.set(s.thick, s.thick, stretch < 0.02 ? 0.0001 : s.len * stretch);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    m.visible = stretch >= 0.02;
    // Resplandor del túnel por la proa: crece con la velocidad.
    if (tunnel.current) {
      tunnel.current.material.opacity = Math.min(0.55, flow.current * 0.9);
      tunnel.current.scale.setScalar(260 + flow.current * 260);
    }
  });
  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, STREAKS]} frustumCulled={false}>
        <boxGeometry args={[0.05, 0.05, 1]} />
        <meshBasicMaterial transparent opacity={0.8} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <Glow ref={tunnel} color="#8fd0ff" size={260} opacity={0} position={[0, 3, -620]} />
    </>
  );
}

const DOCKED: Record<'gate' | 'other', [number, number, number]> = { gate: [0, 4, -150], other: [38, 10, -135] };
/** Fracción del salto a partir de la cual el destino empieza a verse acercarse por la proa. */
const APPROACH_FROM = 0.72;
const APPROACH_DISTANCE = 1500;

/** Solo desarrollo: `?body=planet` (o cualquier `NodeKind`) fuerza el cuerpo que se ve por la proa. */
const debugKind = ((): NodeKind | null => {
  if (!import.meta.env.DEV || typeof location === 'undefined') return null;
  const raw = new URLSearchParams(location.search).get('body');
  return (NODE_KINDS as readonly string[]).includes(raw ?? '') ? (raw as NodeKind) : null;
})();

/**
 * Lo que se ve por la proa: el destino en el que está atracada la nave o, al final de un salto, el
 * destino al que se llega (aparece lejos y frena hasta su sitio).
 */
function Destination() {
  const locationId = useGame((s) => s.hud?.locationId);
  const targetId = useGame((s) => s.hud?.transit?.toId);
  const sectorIndex = useGame((s) => s.hud?.sector.index);
  const group = useRef<Group>(null);
  const id = targetId ?? locationId;
  const node = useMemo(() => {
    const state = getRun()?.state;
    return state && id ? getNode(state.sector, id) : undefined;
    // El sector cambia con `next-sector`: se recalcula también por su índice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, sectorIndex]);
  const kind = debugKind ?? node?.kind;
  const home = DOCKED[kind === 'gate' ? 'gate' : 'other'];
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const transit = getRun()?.state.transit;
    const progress = transit ? transit.traveledLy / Math.max(0.001, transit.distanceLy) : 1;
    const k = Math.min(1, Math.max(0, (progress - APPROACH_FROM) / (1 - APPROACH_FROM)));
    g.visible = k > 0;
    // Frenada: rápido al principio y cada vez más despacio hasta quedar en su sitio.
    const away = (1 - k) * (1 - k);
    g.position.set(home[0] * (1 - away * 0.6), home[1], home[2] - away * APPROACH_DISTANCE);
  });
  if (!node || !kind) return null;
  return (
    <group ref={group} position={home} visible={false}>
      <Body key={`${sectorIndex}:${node.id}`} kind={kind} id={node.id} />
    </group>
  );
}

/** Exterior: cielo, estrellas, la estrella cercana, las estelas del salto y el destino. */
export function SpaceView() {
  const seed = useGame((s) => (s.hud ? s.hud.seed + s.hud.sector.index * 7 : 0));
  return (
    <>
      <SkyBackdrop seed={seed} />
      <Stars radius={340} depth={90} count={4200} factor={5.5} saturation={0.35} fade speed={0.6} />
      <Sun />
      <WarpStreaks />
      <Destination />
    </>
  );
}
