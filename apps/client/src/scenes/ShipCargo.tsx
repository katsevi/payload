import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider } from '@react-three/rapier';
import { BoxGeometry, Color, MeshBasicMaterial, Object3D, type InstancedMesh } from 'three';
import { CARGO_BAY, STATIONS } from '../game/layout';
import { getRun } from '../game/runStore';
import { Builder, Parts, once } from '../gfx/build';
import { Glow } from '../gfx/Glow';
import { mats } from '../gfx/materials';
import { DEPOSIT_LOOKS } from '../gfx/surfaceLook';

const A = STATIONS.airlock;

/** Marco de la esclusa, en el sistema del puesto (frente = +Z local, hacia el pasillo). */
const buildAirlock = once(() => {
  const m = mats();
  const b = new Builder();
  b.box(m.machineDark, [0, 1.3, -0.12], [1.9, 2.6, 0.12]);
  b.box(m.dark, [0, 1.2, -0.04], [1.3, 2.3, 0.06]);
  for (const x of [-0.82, 0.82]) b.box(m.hazard, [x, 1.3, 0], [0.22, 2.6, 0.14]);
  b.box(m.hazard, [0, 2.62, 0], [1.86, 0.2, 0.14]);
  b.box(m.trim, [0, 0.03, 0.05], [1.6, 0.06, 0.3]);
  // Rueda de apertura y panel.
  b.torus(m.steel, [0, 1.25, 0.02], 0.26, 0.035, { seg: 24 });
  for (const r of [0, Math.PI / 2]) b.box(m.steel, [0, 1.25, 0.02], [0.5, 0.04, 0.04], [0, 0, r]);
  b.box(m.machine, [0.62, 1.45, 0.05], [0.18, 0.32, 0.08]);
  return b.build();
});

const lampMaterial = once(() => new MeshBasicMaterial({ color: '#ff3b46', toneMapped: false }));
const OPEN = new Color('#3ddc84');
const SEALED = new Color('#ff3b46');

/** Esclusa: piloto verde cuando se puede salir (nave en tierra), rojo si está sellada. */
export function Airlock3D() {
  const halo = useRef<import('three').Sprite>(null);
  useFrame((state) => {
    const s = getRun()?.state;
    const open = s?.phase === 'surface' && s.crew.some((c) => c.alive && c.location === 'ship');
    const lamp = lampMaterial();
    lamp.color.copy(open ? OPEN : SEALED);
    if (halo.current) {
      halo.current.material.color.copy(lamp.color);
      halo.current.material.opacity = open ? 0.55 + Math.sin(state.clock.elapsedTime * 3) * 0.15 : 0.25;
    }
  });
  return (
    <group position={[A.x, 0, A.z]} rotation={[0, A.yaw, 0]}>
      <Parts parts={buildAirlock()} />
      <mesh position={[0.62, 1.52, 0.1]} material={lampMaterial()} dispose={null}>
        <boxGeometry args={[0.12, 0.08, 0.02]} />
      </mesh>
      <Glow ref={halo} size={0.8} opacity={0.3} position={[0.62, 1.52, 0.14]} />
      <CuboidCollider args={[0.95, 1.3, 0.12]} position={[0, 1.3, -0.1]} />
    </group>
  );
}

const MAX_CRATES = 24;
const crateGeometry = once(() => new BoxGeometry(0.62, 0.42, 0.62));

const buildCargoBay = once(() => {
  const m = mats();
  const b = new Builder();
  b.box(m.deckDark, [CARGO_BAY.x, 0.03, CARGO_BAY.z], [CARGO_BAY.halfX * 2 + 0.2, 0.06, CARGO_BAY.halfZ * 2 + 0.2]);
  for (const dz of [-1, 1]) b.box(m.hazard, [CARGO_BAY.x, 0.07, CARGO_BAY.z + dz * (CARGO_BAY.halfZ + 0.05)], [CARGO_BAY.halfX * 2 + 0.2, 0.02, 0.1]);
  // Barras de sujeción contra el costado.
  for (const dz of [-1.2, 0, 1.2]) b.pipe(m.steel, [CARGO_BAY.x + 0.75, 0.1, CARGO_BAY.z + dz], [CARGO_BAY.x + 0.75, 1.9, CARGO_BAY.z + dz], 0.04, 8);
  return b.build();
});

/**
 * Bodega: una caja por unidad guardada (`ship.cargo`), del color de su material. Lo que se procesa en
 * combustible o repuestos no ocupa sitio. La colisión cubre la zona entera (pocas cajas o muchas).
 */
export function CargoBay() {
  const mesh = useRef<InstancedMesh>(null);
  const signature = useRef('');
  const clock = useRef(1);
  const dummy = useMemo(() => new Object3D(), []);
  const color = useMemo(() => new Color(), []);
  useEffect(() => {
    if (mesh.current) mesh.current.count = 0;
  }, []);
  useFrame((_, dt) => {
    clock.current += dt;
    if (clock.current < 0.25) return;
    clock.current = 0;
    const m = mesh.current;
    const cargo = getRun()?.state.ship.cargo ?? {};
    const sig = Object.entries(cargo).map(([k, v]) => `${k}${v}`).join('|');
    if (!m || sig === signature.current) return;
    signature.current = sig;
    let i = 0;
    for (const [id, units] of Object.entries(cargo)) {
      for (let k = 0; k < units && i < MAX_CRATES; k++, i++) {
        const col = i % 2;
        const row = Math.floor(i / 2) % 3;
        const level = Math.floor(i / 6);
        dummy.position.set(CARGO_BAY.x - 0.33 + col * 0.66, 0.27 + level * 0.44, CARGO_BAY.z - 0.85 + row * 0.85);
        dummy.rotation.set(0, ((i * 37) % 7) * 0.03 - 0.09, 0);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        m.setColorAt(i, color.set(DEPOSIT_LOOKS[id]?.color ?? '#9aa4b5'));
      }
    }
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <group>
      <Parts parts={buildCargoBay()} />
      <instancedMesh ref={mesh} args={[crateGeometry(), mats().tank, MAX_CRATES]} frustumCulled={false} dispose={null} />
      <CuboidCollider args={[CARGO_BAY.halfX, 0.9, CARGO_BAY.halfZ]} position={[CARGO_BAY.x, 0.9, CARGO_BAY.z]} />
    </group>
  );
}
