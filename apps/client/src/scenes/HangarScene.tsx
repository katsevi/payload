/**
 * Hangar de la pantalla de diseño (fase 4): la nave montada con bloques procedurales sobre una plataforma que
 * gira despacio. La disposición sale de `game/hangarLayout.ts` (puro); aquí solo se pinta. La pieza bajo el
 * ratón en la paleta se dibuja en fantasma donde iría. Sin assets nuevos.
 */
import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { BoxGeometry, CylinderGeometry, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, SphereGeometry, type Group, type Material } from 'three';
import type { ModuleKind, ScienceKind } from '@payload/shared';
import { hangarLayout, type HangarBlock } from '../game/hangarLayout';
import { addPart } from '../game/missionDesign';
import { useGame } from '../game/runStore';
import { once } from '../gfx/build';
import { Glow, ShaderClock } from '../gfx/Glow';
import { mats } from '../gfx/materials';
import { useHangar } from '../state/hangar';

const SCIENCE_COLOR: Record<ScienceKind, string> = {
  geology: '#d08a4c',
  ice: '#9fdcff',
  atmosphere: '#7fd4a8',
  fields: '#c77dff',
  interior: '#ffd25a',
  life: '#3ddc84',
};

const scienceMats = once(() => Object.fromEntries(Object.entries(SCIENCE_COLOR).map(([k, c]) => [k, new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.3 })])) as Record<ScienceKind, MeshStandardMaterial>);
const ghostMat = once(() => new MeshBasicMaterial({ color: '#38e1c0', transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }));
const cellMat = once(() => new MeshStandardMaterial({ color: '#16305e', emissive: '#0a1a3a', roughness: 0.25, metalness: 0.75 }));
const bellGeo = once(() => new CylinderGeometry(0.25, 0.5, 1, 20, 1, true));
const dishGeo = once(() => new CylinderGeometry(0.5, 0.12, 0.18, 24, 1, true));

function materialOf(b: HangarBlock): Material {
  const m = mats();
  if (b.family === 'instrument') return scienceMats()[b.science ?? 'geology'];
  const byKind: Partial<Record<ModuleKind, Material>> = {
    structure: m.machine,
    propulsion: m.steel,
    solar: cellMat(),
    nuclear: m.copper,
    tank: m.tank,
    battery: m.green,
    comms: m.trim,
    computer: m.machineDark,
    thermal: m.wall,
    shielding: m.steel,
  };
  return byKind[b.family] ?? m.orange;
}

/** Geometrías compartidas (una por forma): los bloques solo cambian de posición y escala. */
const boxGeo = once(() => new BoxGeometry(1, 1, 1));
const cylGeo = once(() => new CylinderGeometry(1, 1, 1, 18));
const mastGeo = once(() => new CylinderGeometry(0.03, 0.03, 1, 6));
const coreGeo = once(() => new SphereGeometry(0.5, 16, 12));
const sensorGeo = once(() => new OctahedronGeometry(0.6, 0));

/**
 * Un bloque de la nave. Materiales y geometrías son compartidos (`mats()`, `once`): `dispose={null}` evita que R3F
 * los libere al quitar una pieza.
 */
function Block({ b, ghost = false }: { b: HangarBlock; ghost?: boolean }) {
  const mat = ghost ? ghostMat() : materialOf(b);
  const [sx, sy, sz] = b.size;
  switch (b.shape) {
    case 'bell':
      return <mesh position={b.position} rotation={[0, 0, -Math.PI / 2]} scale={[sy, sx, sz]} geometry={bellGeo()} material={mat} dispose={null} />;
    case 'cylinder':
      return <mesh position={b.position} rotation={[0, 0, Math.PI / 2]} scale={[sy, sx, sz]} geometry={cylGeo()} material={mat} dispose={null} />;
    case 'dish':
      return (
        <group position={b.position}>
          <mesh rotation={[0.5, 0, 0.6]} scale={[sx, sx, sx]} geometry={dishGeo()} material={mat} dispose={null} />
          {!ghost && <mesh position={[0, -sy * 0.3, 0]} scale={[1, sy * 0.6, 1]} geometry={mastGeo()} material={mats().steel} dispose={null} />}
        </group>
      );
    case 'core':
      return (
        <group position={b.position}>
          <mesh scale={[sx, sy, sz]} geometry={coreGeo()} material={mat} dispose={null} />
          {!ghost && <Glow color="#ffb070" size={sx * 2} opacity={0.35} />}
        </group>
      );
    case 'sensor':
      return <mesh position={b.position} scale={[sx, sy, sz]} geometry={sensorGeo()} material={mat} dispose={null} />;
    default:
      return <mesh position={b.position} scale={[sx, sy, sz]} geometry={boxGeo()} material={mat} dispose={null} />;
  }
}

function Ship() {
  const design = useGame((g) => g.draft);
  const hover = useHangar((h) => h.hover);
  const layout = useMemo(() => (design ? hangarLayout(design) : null), [design]);
  // Lo que añadiría la pieza señalada: bloques del diseño con ella que no están ahora.
  const ghosts = useMemo(() => {
    if (!design || !hover || !layout) return [];
    const now = new Set(layout.blocks.map((b) => `${b.key}:${b.partId}`));
    return hangarLayout(addPart(design, hover)).blocks.filter((b) => !now.has(`${b.key}:${b.partId}`));
  }, [design, hover, layout]);
  const turn = useRef<Group>(null);
  useFrame((_, dt) => {
    if (turn.current) turn.current.rotation.y += dt * 0.12;
  });
  const scale = layout ? Math.min(1.4, 7 / Math.max(4, layout.lengthM)) : 1;
  return (
    <group ref={turn} scale={scale} position={[0, 1.4, 0]}>
      {layout?.blocks.map((b) => <Block key={`${b.key}:${b.partId}`} b={b} />)}
      {ghosts.map((b) => <Block key={`ghost-${b.key}`} b={b} ghost />)}
    </group>
  );
}

/** Plataforma del hangar: disco con anillo de luz. */
function Pad() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={mats().deckDark} dispose={null}>
        <circleGeometry args={[4.2, 48]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} material={mats().guide} dispose={null}>
        <ringGeometry args={[4.08, 4.2, 64]} />
      </mesh>
      <gridHelper args={[40, 40, '#1f3a5f', '#10203a']} position={[0, -0.01, 0]} />
    </group>
  );
}

export function HangarScene() {
  return (
    <Canvas dpr={[1, 1.5]} camera={{ fov: 40, near: 0.1, far: 400, position: [0, 5.2, 15] }} onCreated={({ camera }) => camera.lookAt(0, 1.6, 0)}>
      <color attach="background" args={['#030712']} />
      <fog attach="fog" args={['#030712', 18, 45]} />
      <ShaderClock />
      <Stars radius={120} depth={30} count={1500} factor={3} saturation={0.2} fade speed={0.3} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#9fb4d0', '#1a2233', 0.6]} />
      <directionalLight position={[6, 9, 5]} intensity={2.4} />
      <directionalLight position={[-6, 3, -4]} intensity={0.6} color="#7fd4ff" />
      <Pad />
      <Ship />
    </Canvas>
  );
}
