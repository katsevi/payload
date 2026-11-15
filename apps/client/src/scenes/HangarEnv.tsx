/**
 * Nave de integración del hangar (fase 4): suelo con marcas, plataforma giratoria, torre de servicio con
 * plataformas, carriles de la grúa puente, focos con haces aditivos (sin luces puntuales), paredes con portón
 * abierto a las estrellas. Todo estático y fusionado con `Builder`; la grúa móvil vive en `Crane`.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Lightformer, Stars } from '@react-three/drei';
import { CylinderGeometry, Group, Mesh, Quaternion, Vector3 } from 'three';
import { Builder, once, Parts, type V3 } from '../gfx/build';
import { Glow } from '../gfx/Glow';
import { lampBeamMaterial } from '../gfx/hangarShaders';
import { mats } from '../gfx/materials';

/** Altura de los carriles de la grúa y su separación (m). */
export const CRANE_Y = 12;
const RAIL_Z = 8.5;
const RAIL_X = 15;
/** Radio y altura de la plataforma giratoria. */
export const PAD_R = 5.2;
export const PAD_TOP = 0.14;
const TOWER: V3 = [-8, 0, -6.5];
const DOOR_Z = -24;

/** Focos: posición de la lámpara y punto al que apunta. */
const LAMPS: { at: V3; to: V3 }[] = [
  { at: [-5, CRANE_Y - 0.6, -RAIL_Z], to: [0.5, 0.5, 0] },
  { at: [5.5, CRANE_Y - 0.6, -RAIL_Z], to: [-0.5, 0.5, 0.5] },
  { at: [-6.5, CRANE_Y - 0.6, RAIL_Z], to: [0, 0.3, -0.5] },
  { at: [TOWER[0] + 1.3, 9.6, TOWER[2] + 1.3], to: [0, 1.5, 0] },
];

const buildHall = once(() => {
  const m = mats();
  const b = new Builder();
  // Suelo y marcas: anillo de peligro, guías y cuadrícula de juntas.
  b.box(m.deckDark, [0, -0.05, 0], [90, 0.1, 90], undefined, 0.25);
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    b.box(m.hazard, [Math.cos(a) * (PAD_R + 0.75), 0.004, Math.sin(a) * (PAD_R + 0.75)], [0.72, 0.008, 0.3], [0, -a + Math.PI / 2, 0], 1.4);
  }
  for (const x of [-13, 13]) b.box(m.guide, [x, 0.003, 0], [0.08, 0.006, 40]);
  for (const z of [-11, 11]) b.box(m.guide, [0, 0.003, z], [26, 0.006, 0.08]);
  for (let i = -6; i <= 6; i++) {
    b.box(m.dark, [i * 4, 0.002, 0], [0.03, 0.004, 60]);
    b.box(m.dark, [0, 0.002, i * 4], [60, 0.004, 0.03]);
  }
  // Base fija de la plataforma giratoria.
  b.cyl(m.machineDark, [0, 0.04, 0], PAD_R + 0.35, PAD_R + 0.45, 0.08, { seg: 64 });
  b.torus(m.trim, [0, 0.08, 0], PAD_R + 0.3, 0.03, { rot: [Math.PI / 2, 0, 0], seg: 72 });
  // Carriles de la grúa puente con sus pilares.
  for (const z of [-RAIL_Z, RAIL_Z]) {
    b.box(m.machine, [0, CRANE_Y, z], [RAIL_X * 2 + 1, 0.6, 0.5], undefined, 0.25);
    b.box(m.hazard, [0, CRANE_Y - 0.31, z], [RAIL_X * 2 + 1, 0.04, 0.5], undefined, 1);
    for (const x of [-RAIL_X, RAIL_X]) {
      b.box(m.machine, [x, CRANE_Y / 2, z], [0.7, CRANE_Y, 0.7], undefined, 0.25);
      b.box(m.hazard, [x, 0.6, z], [0.72, 1.2, 0.72], undefined, 1);
    }
  }
  // Torre de servicio: cuatro pilares, arriostrada, con plataformas y barandillas hacia la plataforma.
  const [tx, , tz] = TOWER;
  const half = 1.1;
  const corners: [number, number][] = [[-half, -half], [half, -half], [half, half], [-half, half]];
  for (const [cx, cz] of corners) b.box(m.steel, [tx + cx, 5.5, tz + cz], [0.16, 11, 0.16]);
  for (let y = 0.5; y < 11; y += 1.4) {
    for (let k = 0; k < 4; k++) {
      const [x0, z0] = corners[k]!;
      const [x1, z1] = corners[(k + 1) % 4]!;
      b.pipe(m.steel, [tx + x0, y, tz + z0], [tx + x1, y + 1.4, tz + z1], 0.03, 6);
      b.pipe(m.steel, [tx + x0, y, tz + z0], [tx + x1, y, tz + z1], 0.035, 6);
    }
  }
  for (const y of [2.6, 5.2, 7.8]) {
    // Plataforma que avanza hacia la nave (diagonal hacia el centro).
    const dir = [0.78, 0.62];
    const len = 3.2;
    const cx = tx + dir[0]! * (half + len / 2);
    const cz = tz + dir[1]! * (half + len / 2);
    const yaw = -Math.atan2(dir[1]!, dir[0]!);
    b.box(m.deckDark, [cx, y, cz], [len, 0.08, 1.4], [0, yaw, 0], 0.6);
    b.box(m.deckDark, [tx, y, tz], [half * 2 + 0.6, 0.08, half * 2 + 0.6], undefined, 0.6);
    for (const side of [-1, 1]) {
      const ox = Math.sin(yaw) * 0.68 * side;
      const oz = Math.cos(yaw) * 0.68 * side;
      b.pipe(m.orange, [cx - dir[0]! * len * 0.5 + ox, y + 1, cz - dir[1]! * len * 0.5 + oz], [cx + dir[0]! * len * 0.5 + ox, y + 1, cz + dir[1]! * len * 0.5 + oz], 0.025, 6);
      for (let i = 0; i <= 3; i++) {
        const t = i / 3 - 0.5;
        b.pipe(m.orange, [cx + dir[0]! * len * t + ox, y, cz + dir[1]! * len * t + oz], [cx + dir[0]! * len * t + ox, y + 1, cz + dir[1]! * len * t + oz], 0.02, 6);
      }
    }
    b.box(m.hazard, [cx + dir[0]! * len * 0.5, y + 0.05, cz + dir[1]! * len * 0.5], [0.15, 0.04, 1.4], [0, yaw, 0]);
  }
  b.box(m.machine, [tx, 11.1, tz], [half * 2 + 0.4, 0.3, half * 2 + 0.4], undefined, 0.5);
  // Lámparas de los focos.
  for (const { at, to } of LAMPS) {
    b.box(m.machineDark, [at[0], at[1] + 0.35, at[2]], [0.18, 0.7, 0.18]);
    const d = new Vector3(to[0] - at[0], to[1] - at[1], to[2] - at[2]).normalize();
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), d);
    const g = new CylinderGeometry(0.42, 0.3, 0.5, 18).applyQuaternion(q);
    b.add(m.machineDark, g, at);
  }
  // Paredes con nervios, pasarela alta y el portón abierto en el fondo.
  const wallH = 18;
  for (const [x0, x1] of [[-40, -9], [9, 40]] as const) b.box(m.wallDark, [(x0 + x1) / 2, wallH / 2, DOOR_Z], [x1 - x0, wallH, 0.4], undefined, 0.12);
  b.box(m.wallDark, [0, 15.5, DOOR_Z], [18, 5, 0.4], undefined, 0.12);
  for (const x of [-9, 9]) b.box(m.machine, [x, wallH / 2, DOOR_Z + 0.4], [0.9, wallH, 0.6], undefined, 0.2);
  b.box(m.hazard, [0, 12.9, DOOR_Z + 0.3], [18, 0.25, 0.3], undefined, 0.6);
  b.box(m.wallDark, [-30, wallH / 2, 0], [0.4, wallH, 60], undefined, 0.12);
  b.box(m.wallDark, [30, wallH / 2, 0], [0.4, wallH, 60], undefined, 0.12);
  for (let i = -5; i <= 5; i++) {
    if (Math.abs(i * 4) < 10) continue;
    b.box(m.machine, [i * 4, wallH / 2, DOOR_Z + 0.35], [0.35, wallH, 0.35], undefined, 0.2);
  }
  for (let i = -6; i <= 6; i++) {
    b.box(m.machine, [-29.7, wallH / 2, i * 4.5], [0.35, wallH, 0.35], undefined, 0.2);
    b.box(m.machine, [29.7, wallH / 2, i * 4.5], [0.35, wallH, 0.35], undefined, 0.2);
  }
  b.box(m.deckDark, [0, 9, DOOR_Z + 1.2], [80, 0.12, 1.6], undefined, 0.4);
  b.box(m.ceiling, [0, wallH, 0], [62, 0.4, 70], undefined, 0.08);
  // Material de taller junto a la torre: cajas, contenedor y carro.
  for (const [x, z, w, h, d, mat] of [
    [-11.5, -2, 1.6, 1.0, 1.2, m.orange],
    [-11.3, -2, 1.0, 0.7, 0.9, m.machine],
    [-12, 1, 2.4, 1.4, 1.4, m.machineDark],
    [7.5, -9, 2.2, 1.2, 1.4, m.machine],
    [9.4, -8.6, 1.2, 0.8, 1.0, m.orange],
  ] as const)
    b.box(mat, [x, h / 2, z], [w, h, d], undefined, 0.5);
  b.box(m.hazard, [-12, 1.41, 1], [2.4, 0.02, 0.3]);
  return b.build();
});

const beamGeometry = once(() => new CylinderGeometry(0.28, 2.6, 1, 36, 1, true).translate(0, -0.5, 0));

/** Haz de un foco: cono de la lámpara al objetivo (orientación fija, calculada una vez). */
function Beam({ at, to }: { at: V3; to: V3 }) {
  const { quat, len } = useMemo(() => {
    const d = new Vector3(to[0] - at[0], to[1] - at[1], to[2] - at[2]);
    const l = d.length();
    return { quat: new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), d.normalize()), len: l * 0.92 };
  }, [at, to]);
  return <mesh position={at} quaternion={quat} scale={[len / 9, len, len / 9]} geometry={beamGeometry()} material={lampBeamMaterial()} dispose={null} />;
}

/** Luces de pared lejanas (profundidad). */
const WALL_LIGHTS: V3[] = [
  ...[-24, -16, 16, 24].map((x) => [x, 9.6, DOOR_Z + 0.8] as V3),
  ...[-20, -10, 0, 10, 20].map((z) => [-29.3, 9.6, z] as V3),
  ...[-20, -10, 0, 10, 20].map((z) => [29.3, 9.6, z] as V3),
];

export function HangarHall() {
  return (
    <group>
      <Parts parts={buildHall()} />
      {LAMPS.map((l, i) => (
        <group key={i}>
          <Beam at={l.at} to={l.to} />
          <Glow position={l.at} color="#fff1d6" size={1.6} opacity={0.85} />
        </group>
      ))}
      {WALL_LIGHTS.map((p, i) => (
        <Glow key={i} position={p} color="#ffb45a" size={1.1} opacity={0.5} />
      ))}
      <Glow position={[0, 6, DOOR_Z - 6]} color="#2a4a8a" size={30} opacity={0.18} />
      <Stars radius={60} depth={30} count={1400} factor={3} saturation={0.15} fade speed={0.2} />
    </group>
  );
}

/** Reflejos para los metales (se hornea una vez): tiras de luz del techo y paneles laterales. */
export function HangarReflections() {
  return (
    <Environment resolution={128} frames={1} environmentIntensity={0.7}>
      <color attach="background" args={['#070b12']} />
      {[-6, 0, 6].map((x) => (
        <Lightformer key={x} form="rect" intensity={2.6} color="#e4ecff" position={[x, 10, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.2, 24, 1]} />
      ))}
      <Lightformer form="rect" intensity={1.2} color="#ffd9a8" position={[12, 3, 6]} rotation={[0, -Math.PI / 2, 0]} scale={[14, 4, 1]} />
      <Lightformer form="rect" intensity={0.9} color="#7fb4ff" position={[-12, 3, -4]} rotation={[0, Math.PI / 2, 0]} scale={[14, 4, 1]} />
      <Lightformer form="rect" intensity={0.15} color="#38e1c0" position={[0, 1, -14]} scale={[18, 1, 1]} />
      <Lightformer form="rect" intensity={0.3} color="#8fa3c4" position={[0, -6, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[16, 16, 1]} />
    </Environment>
  );
}

/** Estado compartido de la grúa: la pieza que llega o se va la reclama cada frame (sin React). */
export const craneClaim = { time: -1, start: Infinity, x: 0, y: 0, z: 0 };

/** Reclama la grúa para una pieza en movimiento (gana la que empezó antes). */
export function claimCrane(now: number, start: number, x: number, y: number, z: number): void {
  if (craneClaim.time === now && craneClaim.start <= start) return;
  craneClaim.time = now;
  craneClaim.start = start;
  craneClaim.x = x;
  craneClaim.y = y;
  craneClaim.z = z;
}

/** ¿Hay una pieza en movimiento (reclamó la grúa hace muy poco)? */
export const craneBusy = (now: number): boolean => now - craneClaim.time < 0.25;

const buildBridge = once(() => {
  const m = mats();
  const b = new Builder();
  b.box(m.orange, [0, 0, 0], [0.7, 0.55, RAIL_Z * 2 + 0.6], undefined, 0.5);
  b.box(m.machineDark, [0, -0.3, 0], [0.5, 0.06, RAIL_Z * 2 + 0.6]);
  for (const z of [-RAIL_Z, RAIL_Z]) b.box(m.machine, [0, 0.35, z], [1.4, 0.4, 0.8]);
  return b.build();
});

const buildTrolley = once(() => {
  const m = mats();
  const b = new Builder();
  b.box(m.machine, [0, -0.45, 0], [1.1, 0.4, 0.9]);
  b.cyl(m.steel, [0, -0.75, 0], 0.22, 0.22, 0.7, { rot: [0, 0, Math.PI / 2], seg: 16 });
  b.box(m.hazard, [0, -0.66, 0.46], [1.1, 0.12, 0.02]);
  return b.build();
});

const buildHook = once(() => {
  const m = mats();
  const b = new Builder();
  b.box(m.orange, [0, 0.18, 0], [0.32, 0.36, 0.14]);
  b.cyl(m.steel, [0, 0.18, 0.08], 0.09, 0.09, 0.03, { rot: [Math.PI / 2, 0, 0], seg: 12 });
  b.torus(m.steel, [0, -0.06, 0], 0.09, 0.025, { arc: Math.PI * 1.5, seg: 14 });
  b.box(m.hazard, [0, 0.3, 0], [0.33, 0.06, 0.15]);
  return b.build();
});

const cableGeometry = once(() => new CylinderGeometry(0.012, 0.012, 1, 6).translate(0, 0.5, 0));

const PARK: V3 = [-9, CRANE_Y - 2.5, 0];
const v1 = new Vector3();
const v2 = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * Grúa puente: el puente corre por X, el carro por Z y el gancho baja hasta la pieza que llega (la reclamada en
 * `craneClaim`); sin pieza, se aparca a un lado. Movimiento suavizado, sin estado de React.
 */
export function Crane() {
  const bridge = useRef<Group>(null);
  const trolley = useRef<Group>(null);
  const hook = useRef<Group>(null);
  const cable = useRef<Mesh>(null);
  const s = useRef({ x: PARK[0], z: PARK[2], hx: PARK[0], hy: PARK[1], hz: PARK[2] });
  useFrame((state, dt) => {
    const now = state.clock.elapsedTime;
    const st = s.current;
    const busy = craneBusy(now);
    const tx = busy ? craneClaim.x : PARK[0];
    const tz = busy ? craneClaim.z : PARK[2];
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * (busy ? 4 : 1.6));
    st.x += (tx - st.x) * k;
    st.z += (tz - st.z) * k;
    const kh = 1 - Math.exp(-Math.min(dt, 0.1) * (busy ? 14 : 2));
    st.hx += ((busy ? craneClaim.x : st.x) - st.hx) * kh;
    st.hz += ((busy ? craneClaim.z : st.z) - st.hz) * kh;
    st.hy += ((busy ? craneClaim.y : PARK[1]) - st.hy) * kh;
    if (bridge.current) bridge.current.position.set(st.x, CRANE_Y + 0.55, 0);
    if (trolley.current) trolley.current.position.set(st.x, CRANE_Y + 0.55, st.z);
    if (hook.current) hook.current.position.set(st.hx, st.hy, st.hz);
    if (cable.current) {
      v1.set(st.hx, st.hy + 0.36, st.hz);
      v2.set(st.x, CRANE_Y - 0.3, st.z).sub(v1);
      const len = Math.max(0.05, v2.length());
      cable.current.position.copy(v1);
      cable.current.quaternion.setFromUnitVectors(UP, v2.normalize());
      cable.current.scale.set(1, len, 1);
    }
  });
  return (
    <group>
      <group ref={bridge}>
        <Parts parts={buildBridge()} />
      </group>
      <group ref={trolley}>
        <Parts parts={buildTrolley()} />
      </group>
      <group ref={hook}>
        <Parts parts={buildHook()} />
      </group>
      <mesh ref={cable} geometry={cableGeometry()} material={mats().steel} dispose={null} />
    </group>
  );
}

const buildPad = once(() => {
  const m = mats();
  const b = new Builder();
  b.cyl(m.deck, [0, PAD_TOP / 2, 0], PAD_R, PAD_R, PAD_TOP - 0.02, { seg: 72, density: 0.6 });
  b.torus(m.trim, [0, PAD_TOP - 0.01, 0], PAD_R, 0.035, { rot: [Math.PI / 2, 0, 0], seg: 80 });
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    b.box(m.dark, [Math.cos(a) * PAD_R * 0.55, PAD_TOP, Math.sin(a) * PAD_R * 0.55], [PAD_R * 0.9, 0.006, 0.025], [0, -a, 0]);
  }
  b.torus(m.guide, [0, PAD_TOP + 0.004, 0], PAD_R - 0.18, 0.018, { rot: [Math.PI / 2, 0, 0], seg: 80, tubeSeg: 4 });
  b.torus(m.guide, [0, PAD_TOP + 0.004, 0], PAD_R * 0.32, 0.012, { rot: [Math.PI / 2, 0, 0], seg: 48, tubeSeg: 4 });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    b.box(m.hazard, [Math.cos(a) * (PAD_R - 0.5), PAD_TOP + 0.004, Math.sin(a) * (PAD_R - 0.5)], [0.6, 0.006, 0.18], [0, -a, 0], 1.5);
  }
  return b.build();
});

/** Plataforma giratoria (la parte que gira; va dentro del grupo de giro). */
export function TurntableTop() {
  return <Parts parts={buildPad()} />;
}
