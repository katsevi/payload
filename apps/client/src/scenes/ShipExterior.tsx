import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';
import { AdditiveBlending, ConeGeometry, MeshBasicMaterial, type Sprite } from 'three';
import { HULL, STATIONS } from '../game/layout';
import { getRun } from '../game/runStore';
import { DECK_Y } from '../game/surfaceRules';
import { Builder, Parts, once } from '../gfx/build';
import { mats } from '../gfx/materials';
import { beamMaterial, thrusterMaterial } from '../gfx/surfaceShaders';
import { glowTexture } from '../gfx/textures';

const HALF_PI = Math.PI / 2;
const W = HULL.halfWidth;
const LEN = HULL.maxZ - HULL.minZ;
/** Densidad de textura del casco exterior (paneles grandes, se ven de lejos). */
const OUT_TILE = 0.18;
const AIR_Z = STATIONS.airlock.z;
/** Rampa: de la puerta (costado de babor) al suelo, en el sistema del interior. */
const RAMP_FOOT_X = -W - 5;
const RAMP_LEN = Math.hypot(5, DECK_Y);
const RAMP_ANGLE = Math.atan2(DECK_Y, 5);
const LEGS: [number, number][] = [[-1, -9.5], [1, -9.5], [-1, 9.5], [1, 9.5]];
const THRUSTERS: [number, number][] = [[-3.2, -8], [3.2, -8], [-3.2, 8], [3.2, 8]];

const windowMaterial = once(() => new MeshBasicMaterial({ color: '#2b4058', toneMapped: false }));
const doorLightMaterial = once(() => new MeshBasicMaterial({ color: '#ffb347', toneMapped: false }));

/** Casco exterior en el sistema de coordenadas del interior (cubierta en y = 0, proa a −Z). */
const buildExterior = once(() => {
  const m = mats();
  const b = new Builder();
  // Casco, techo escalonado y panza.
  b.box(m.wall, [0, 1.85, 0], [W * 2 + 0.4, 4.1, LEN + 0.4], undefined, OUT_TILE);
  b.box(m.machine, [0, 4.15, 0.5], [W * 2 - 2.4, 0.6, LEN - 3], undefined, OUT_TILE);
  b.box(m.machineDark, [0, -0.3, 0], [W * 2 - 0.4, 0.6, LEN - 1], undefined, OUT_TILE);
  for (const side of [-1, 1]) {
    b.box(m.trim, [side * (W + 0.22), 3.5, 0], [0.08, 0.18, LEN], undefined, OUT_TILE);
    b.box(m.machine, [side * (W + 0.28), 0.35, 0], [0.2, 0.5, LEN - 1], undefined, OUT_TILE);
  }
  // Proa con mirador.
  b.box(m.wall, [0, 1.75, HULL.minZ - 1.3], [W * 2 - 2.6, 3.5, 2.6], undefined, OUT_TILE);
  b.box(m.machine, [0, 3.65, HULL.minZ - 1.1], [W * 2 - 3, 0.5, 2.4], undefined, OUT_TILE);
  // Popa: bloque de motores y toberas.
  b.box(m.machine, [0, 1.7, HULL.maxZ + 1.2], [W * 2 - 1, 3.6, 2.4], undefined, OUT_TILE);
  for (const x of [-2.6, 0, 2.6]) {
    b.cyl(m.dark, [x, 1.7, HULL.maxZ + 2.9], 0.9, 1.25, 1.2, { rot: [HALF_PI, 0, 0], seg: 20 });
    b.torus(m.steel, [x, 1.7, HULL.maxZ + 3.5], 1.25, 0.1, { seg: 24 });
  }
  // Patas de aterrizaje con su amortiguador y su pie.
  for (const [sx, z] of LEGS) {
    const top: [number, number, number] = [sx * (W - 0.4), -0.4, z];
    const foot: [number, number, number] = [sx * (W + 1.4), -DECK_Y + 0.25, z + Math.sign(z) * 1.2];
    b.pipe(m.steel, top, foot, 0.22, 10);
    b.pipe(m.orange, [sx * (W - 0.4), -0.4, z - Math.sign(z) * 1.6], [foot[0], foot[1] + 0.6, foot[2]], 0.12, 8);
    b.cyl(m.machineDark, [foot[0], foot[1] - 0.1, foot[2]], 0.75, 0.9, 0.3, { seg: 18 });
  }
  // Rampa y marco de la esclusa.
  b.box(m.deckDark, [(-W + RAMP_FOOT_X) / 2, -DECK_Y / 2 + 0.05, AIR_Z], [RAMP_LEN, 0.15, 1.8], [0, 0, RAMP_ANGLE], OUT_TILE * 2);
  for (const dz of [-0.95, 0.95]) b.box(m.hazard, [(-W + RAMP_FOOT_X) / 2, -DECK_Y / 2 + 0.15, AIR_Z + dz], [RAMP_LEN, 0.12, 0.1], [0, 0, RAMP_ANGLE]);
  b.box(m.hazard, [-W - 0.25, 1.35, AIR_Z - 1.05], [0.3, 2.7, 0.2]);
  b.box(m.hazard, [-W - 0.25, 1.35, AIR_Z + 1.05], [0.3, 2.7, 0.2]);
  b.box(m.hazard, [-W - 0.25, 2.75, AIR_Z], [0.3, 0.2, 2.3]);
  b.box(m.dark, [-W - 0.2, 1.3, AIR_Z], [0.1, 2.5, 1.9]);
  // Mástil de la baliza y antena.
  b.pipe(m.steel, [0, 4.4, 8], [0, 6.2, 8], 0.12, 8);
  b.lathe(m.dish, [[0.05, 0], [0.6, 0.15], [1.1, 0.5]], [2.5, 4.5, -6], { rot: [0.6, 0, 0.3], seg: 20 });
  return b.build();
});

const buildWindows = once(() => {
  const b = new Builder();
  for (const side of [-1, 1]) {
    for (let k = 0; k < 7; k++) {
      const z = HULL.minZ + 2.4 + k * 3.25;
      if (side < 0 && Math.abs(z - AIR_Z) < 1.8) continue;
      b.box(windowMaterial(), [side * (W + 0.21), 1.95, z], [0.04, 1.1, 2.4]);
    }
  }
  b.box(windowMaterial(), [0, 2.1, HULL.minZ - 2.61], [W * 2 - 3.4, 1.2, 0.04]);
  b.box(doorLightMaterial(), [-W - 0.36, 2.95, AIR_Z], [0.06, 0.12, 1.4]);
  return b.build();
});

const thrusterGeometry = once(() => new ConeGeometry(0.9, 6, 16, 1, true).translate(0, -3, 0));

interface ShipExteriorProps {
  /** Colisiones del casco, las patas y la rampa (solo en la EVA). */
  colliders?: boolean;
}

/**
 * La nave posada vista desde fuera, en el sistema del interior (el grupo que la contiene la coloca en la
 * superficie). Baliza intermitente y haz de luz: se localiza desde cualquier punto del área.
 */
export function ShipExterior({ colliders = false }: ShipExteriorProps) {
  const beacon = useRef<Sprite>(null);
  const beam = useMemo(() => beamMaterial('#38e1c0', 0.32), []);
  const flame = thrusterMaterial();
  const flameScale = useRef(0);
  const flames = useRef<(import('three').Mesh | null)[]>([]);
  useFrame((state, dt) => {
    // Baliza: dos destellos cortos cada 1,6 s.
    const ph = state.clock.elapsedTime % 1.6;
    const on = ph < 0.12 || (ph > 0.28 && ph < 0.4) ? 1 : 0.15;
    if (beacon.current) beacon.current.material.opacity = on;
    const s = getRun()?.state;
    const d = s?.surface?.descent;
    const braking = s?.phase === 'landing' && !!d?.brake && s.ship.systems.engines.online && s.ship.fuel > 0;
    flameScale.current += ((braking ? 1 : 0) - flameScale.current) * Math.min(1, dt * 12);
    flame.u.uPower.value = flameScale.current;
    for (const f of flames.current) if (f) f.visible = flameScale.current > 0.02;
  });
  const rampMid: [number, number, number] = [(-W + RAMP_FOOT_X) / 2, -DECK_Y / 2 + 0.05, AIR_Z];
  return (
    <group>
      <Parts parts={buildExterior()} />
      <Parts parts={buildWindows()} />
      {THRUSTERS.map(([x, z], i) => (
        <mesh key={i} ref={(m) => void (flames.current[i] = m)} position={[x, -0.6, z]} geometry={thrusterGeometry()} material={flame.material} visible={false} dispose={null} />
      ))}
      <sprite ref={beacon} position={[0, 6.4, 8]} scale={[7, 7, 1]}>
        <spriteMaterial map={glowTexture()} color="#38e1c0" transparent blending={AdditiveBlending} depthWrite={false} toneMapped={false} fog={false} />
      </sprite>
      <mesh position={[0, 6.4 + 70, 8]} material={beam.material}>
        <cylinderGeometry args={[0.35, 0.9, 140, 12, 1, true]} />
      </mesh>
      {colliders && (
        <RigidBody type="fixed" colliders={false}>
          <CuboidCollider args={[W + 0.2, 2.35, LEN / 2 + 0.2]} position={[0, 1.75, 0]} />
          <CuboidCollider args={[W - 1.3, 1.75, 1.3]} position={[0, 1.75, HULL.minZ - 1.3]} />
          <CuboidCollider args={[W - 0.5, 1.8, 1.8]} position={[0, 1.7, HULL.maxZ + 1.6]} />
          <CuboidCollider args={[RAMP_LEN / 2, 0.1, 0.9]} position={rampMid} rotation={[0, 0, RAMP_ANGLE]} />
          {LEGS.map(([sx, z], i) => (
            <CylinderCollider key={i} args={[DECK_Y / 2, 0.55]} position={[sx * (W + 1.4), -DECK_Y / 2, z + Math.sign(z) * 1.2]} />
          ))}
        </RigidBody>
      )}
    </group>
  );
}
