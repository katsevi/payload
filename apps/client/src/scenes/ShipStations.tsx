import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';
import { BoxGeometry, Color, type Group, type Mesh, type MeshBasicMaterial, type PointLight, type Sprite } from 'three';
import { catalog as defaultCatalog, getPsychRules, SYSTEM_IDS, THROTTLE_IDS, type PoweredSystemId, type SystemId } from '@payload/shared';
import { HULL, STATIONS, type StationId } from '../game/layout';
import { getRun } from '../game/runStore';
import { Builder, Parts, once, type V3 } from '../gfx/build';
import { Glow } from '../gfx/Glow';
import { mats } from '../gfx/materials';
import { beamMaterial, engineGlowMaterial, helmHoloMaterial, ledsMaterial, liquidMaterial, loadMeterMaterial, plasmaMaterial, radarMaterial, shieldMaterial, tableTopMaterial } from '../gfx/shipShaders';
import { ConsoleModel, GalaxyBackdrop } from '../models/Models';
import { Airlock3D, CargoBay } from './ShipCargo';

const H = HULL.height;
const HALF_PI = Math.PI / 2;

const C_OK = new Color('#3ddc84');
const C_WARN = new Color('#ffb020');
const C_BAD = new Color('#ff4d5e');
const C_OFF = new Color('#3a4250');
const C_CORE = new Color('#38e1c0');
const C_CORE_HOT = new Color('#ff7a30');
const C_CORE_DEAD = new Color('#1a0b10');

/** Color de estado de un sistema (verde en línea, ámbar dañado, rojo caído o en corto, gris apagado). */
function statusColor(id: SystemId, out: Color): Color {
  const sys = getRun()?.state.ship.systems[id];
  if (!sys) return out.copy(C_OFF);
  if (sys.healthPct <= 0 || sys.shorted) return out.copy(C_BAD);
  if (!sys.enabled) return out.copy(C_OFF);
  if (!sys.online) return out.copy(C_BAD);
  return out.copy(sys.healthPct < 60 ? C_WARN : C_OK);
}

const isOnline = (id: SystemId): boolean => getRun()?.state.ship.systems[id].online ?? false;

/** Acerca `current` a `target` con suavizado exponencial (independiente de los FPS). */
const approach = (current: number, target: number, dt: number, rate = 5): number => current + (target - current) * Math.min(1, dt * rate);

/** Piloto de estado de un sistema: lente encendida en su casquillo, con halo. */
function StatusLamp({ id, position }: { id: SystemId; position: V3 }) {
  const lens = useRef<Mesh>(null);
  const halo = useRef<Sprite>(null);
  useFrame(() => {
    const m = lens.current?.material as MeshBasicMaterial | undefined;
    if (!m) return;
    statusColor(id, m.color);
    if (halo.current) {
      halo.current.material.color.copy(m.color);
      halo.current.material.opacity = m.color.equals(C_OFF) ? 0.08 : 0.5;
    }
  });
  return (
    <group position={position}>
      <mesh material={mats().dark} dispose={null}>
        <cylinderGeometry args={[0.11, 0.12, 0.05, 16]} />
      </mesh>
      <mesh ref={lens} position={[0, 0.045, 0]}>
        <sphereGeometry args={[0.085, 16, 10, 0, Math.PI * 2, 0, HALF_PI]} />
        <meshBasicMaterial toneMapped={false} />
      </mesh>
      <Glow ref={halo} size={0.75} opacity={0.5} position={[0, 0.07, 0]} />
    </group>
  );
}

function StationGroup({ id, children }: { id: StationId; children: ReactNode }) {
  const s = STATIONS[id];
  return (
    <group position={[s.x, 0, s.z]} rotation={[0, s.yaw, 0]}>
      {children}
    </group>
  );
}

// ───────────────────────────── Timón ─────────────────────────────

const buildHelm = once(() => {
  const m = mats();
  const b = new Builder();
  // Tarima octogonal baja con su anillo de luz.
  b.lathe(m.deckDark, [[1.55, 0], [1.47, 0.025], [0, 0.025]], [0, 0, 0.3], { seg: 8 });
  b.torus(m.guide, [0, 0.03, 0.3], 1.34, 0.012, { rot: [HALF_PI, 0, 0], seg: 8, tubeSeg: 6 });
  // Emisores del holograma a los lados de la consola.
  for (const side of [-1, 1]) {
    b.cyl(m.dark, [side * 0.72, 1.24, -0.42], 0.035, 0.05, 0.1, { seg: 10 });
    b.box(m.led, [side * 0.72, 1.3, -0.42], [0.03, 0.012, 0.03]);
  }
  return b.build();
});

const HOLO_RADIUS = 1.7;
const HOLO_ARC = 0.86;

function Helm() {
  const holo = useMemo(helmHoloMaterial, []);
  useFrame(() => {
    const s = getRun()?.state;
    if (!s) return;
    holo.u.uThrottle.value = THROTTLE_IDS.indexOf(s.ship.throttle);
    holo.u.uWarn.value = s.warnings.some((w) => !w.evaded) ? 1 : 0;
    holo.u.uSpeed.value = s.ship.speedLyPerS;
    holo.u.uOn.value = s.ship.powerSupplyKw > 0 ? 1 : 0.12;
  });
  return (
    <StationGroup id="helm">
      <Parts parts={buildHelm()} />
      <ConsoleModel
        height={1.25}
        fallback={
          <mesh position={[0, 0.55, 0]} material={mats().machine} dispose={null}>
            <boxGeometry args={[1.8, 1.1, 0.7]} />
          </mesh>
        }
      />
      {/* Arco holográfico centrado en quien pilota (el punto de uso queda en z = +1,2). */}
      <mesh position={[0, 1.4, 1.2]} material={holo.material}>
        <cylinderGeometry args={[HOLO_RADIUS, HOLO_RADIUS, 0.3, 32, 1, true, Math.PI - HOLO_ARC / 2, HOLO_ARC]} />
      </mesh>
      <CuboidCollider args={[1, 0.6, 0.45]} position={[0, 0.6, 0]} />
    </StationGroup>
  );
}

// ───────────────────────────── Mesa del mapa estelar ─────────────────────────────

const buildMapTable = once(() => {
  const m = mats();
  const b = new Builder();
  b.lathe(m.machine, [[0.95, 0], [0.95, 0.08], [0.62, 0.2], [0.5, 0.3], [0.5, 0.62], [0.82, 0.82], [0.92, 0.84], [0.92, 0.9], [0, 0.9]]);
  b.torus(m.trim, [0, 0.9, 0], 0.92, 0.03, { rot: [HALF_PI, 0, 0], seg: 36 });
  b.torus(m.copper, [0, 0.46, 0], 0.52, 0.035, { rot: [HALF_PI, 0, 0] });
  b.torus(m.guide, [0, 0.02, 0], 0.98, 0.012, { rot: [HALF_PI, 0, 0], seg: 36, tubeSeg: 6 });
  b.cyl(m.dark, [0, 0.93, 0], 0.11, 0.15, 0.05, { seg: 16 });
  return b.build();
});

function MapTable() {
  const holo = useRef<Group>(null);
  const top = useMemo(tableTopMaterial, []);
  const beam = useMemo(beamMaterial, []);
  useFrame((_, dt) => {
    if (holo.current) holo.current.rotation.y += dt * 0.25;
  });
  return (
    <StationGroup id="map">
      <Parts parts={buildMapTable()} />
      <mesh position={[0, 0.905, 0]} rotation={[-HALF_PI, 0, 0]} material={top.material}>
        <circleGeometry args={[0.89, 40]} />
      </mesh>
      <mesh position={[0, 1.43, 0]} material={beam.material}>
        <cylinderGeometry args={[0.8, 0.1, 0.96, 28, 1, true]} />
      </mesh>
      <group ref={holo} position={[0, 1.5, 0]} rotation={[0.35, 0, 0]}>
        <GalaxyBackdrop width={1.5} />
      </group>
      <Glow color="#38e1c0" size={1.5} opacity={0.3} position={[0, 1.0, 0]} />
      <CylinderCollider args={[0.45, 0.9]} position={[0, 0.45, 0]} />
    </StationGroup>
  );
}

// ───────────────────────────── Panel de energía ─────────────────────────────

const BREAKERS = SYSTEM_IDS.filter((s): s is PoweredSystemId => s !== 'reactor');
const breakerX = (i: number): number => -0.54 + i * 0.36;

const buildPowerPanel = once(() => {
  const m = mats();
  const b = new Builder();
  b.box(m.machineDark, [0, 1.4, -0.25], [1.96, 1.96, 0.1]);
  b.box(m.machine, [0, 1.4, -0.17], [1.74, 1.74, 0.14]);
  for (const side of [-1, 1]) {
    b.box(m.trim, [side * 0.95, 1.4, -0.17], [0.06, 1.96, 0.2]);
    b.box(m.trim, [0, 1.4 + side * 0.95, -0.17], [1.96, 0.06, 0.2]);
  }
  b.box(m.screen, [0, 1.92, -0.095], [1.5, 0.42, 0.02]);
  b.box(m.hazard, [0, 0.64, -0.095], [1.6, 0.1, 0.02], undefined, 3);
  BREAKERS.forEach((_, i) => {
    b.box(m.dark, [breakerX(i), 1.06, -0.095], [0.2, 0.44, 0.03]);
    b.box(m.steel, [breakerX(i), 1.06, -0.085], [0.05, 0.36, 0.03]);
  });
  // Acometidas: del armario al techo y al suelo.
  for (const [x, mat] of [[-0.55, m.orange], [0, m.steel], [0.55, m.steel]] as const) b.pipe(mat, [x, 2.35, -0.2], [x, H - 0.05, -0.2], 0.05);
  b.box(m.machine, [0, 0.36, -0.2], [1.1, 0.32, 0.18]);
  for (const x of [-0.4, 0.4]) b.pipe(m.orange, [x, 0.2, -0.2], [x, 0, -0.2], 0.05);
  return b.build();
});

const buildLever = once(() => {
  const m = mats();
  const b = new Builder();
  b.box(m.steel, [0, 0, 0.09], [0.05, 0.05, 0.18]);
  b.box(m.orange, [0, 0, 0.2], [0.13, 0.08, 0.06]);
  return b.build();
});

/** Armario eléctrico: una palanca y un piloto por sistema, y el medidor de carga del reactor. */
function PowerPanel3D() {
  const levers = useRef<(Group | null)[]>([]);
  const meter = useMemo(loadMeterMaterial, []);
  const leds = useMemo(() => ledsMaterial(28, 3), []);
  useFrame((_, dt) => {
    const ship = getRun()?.state.ship;
    if (!ship) return;
    BREAKERS.forEach((id, i) => {
      const lever = levers.current[i];
      // Arriba = alimentado; abajo = apagado a mano.
      if (lever) lever.rotation.x = approach(lever.rotation.x, ship.systems[id].enabled ? -0.7 : 0.7, dt, 14);
    });
    const up = ship.powerSupplyKw > 0;
    meter.u.uLoad.value = approach(meter.u.uLoad.value, up ? ship.powerDemandKw / Math.max(1, ship.powerSupplyKw) : 0, dt, 6);
    meter.u.uOver.value = ship.overloaded ? 1 : 0;
    leds.u.uOn.value = up ? 1 : 0;
  });
  return (
    <StationGroup id="power">
      {/* Adelantado 7 cm: la cuaderna del casco que queda detrás no debe asomar por el frente. */}
      <group position={[0, 0, 0.07]}>
        <Parts parts={buildPowerPanel()} />
        <mesh position={[0, 2.0, -0.083]} material={meter.material}>
          <planeGeometry args={[1.38, 0.16]} />
        </mesh>
        <mesh position={[0, 1.81, -0.083]} material={leds.material}>
          <planeGeometry args={[1.38, 0.12]} />
        </mesh>
        {BREAKERS.map((id, i) => (
          <group key={id}>
            <group position={[breakerX(i), 1.52, -0.1]} rotation={[HALF_PI, 0, 0]}>
              <StatusLamp id={id} position={[0, 0, 0]} />
            </group>
            <group ref={(g) => void (levers.current[i] = g)} position={[breakerX(i), 1.06, -0.08]} rotation={[-0.7, 0, 0]}>
              <Parts parts={buildLever()} />
            </group>
          </group>
        ))}
      </group>
    </StationGroup>
  );
}

// ───────────────────────────── Reactor ─────────────────────────────

const CORE_Y0 = 0.66;
const CORE_Y1 = H - 0.6;
const CORE_H = CORE_Y1 - CORE_Y0;
const CORE_MID = (CORE_Y0 + CORE_Y1) / 2;

const buildReactor = once(() => {
  const m = mats();
  const b = new Builder();
  b.lathe(m.machine, [[1.15, 0], [1.15, 0.1], [1.02, 0.2], [1.02, 0.4], [0.8, 0.5], [0.66, 0.6], [0.66, CORE_Y0], [0, CORE_Y0]]);
  b.lathe(m.machine, [[0, CORE_Y1], [0.66, CORE_Y1], [0.66, H - 0.52], [0.8, H - 0.42], [0.98, H - 0.3], [0.98, H - 0.12], [1.08, H - 0.05], [1.08, H]]);
  b.torus(m.trim, [0, 0.4, 0], 1.03, 0.035, { rot: [HALF_PI, 0, 0], seg: 40 });
  b.torus(m.trim, [0, H - 0.3, 0], 0.99, 0.035, { rot: [HALF_PI, 0, 0], seg: 40 });
  b.torus(m.guide, [0, 0.02, 0], 1.18, 0.014, { rot: [HALF_PI, 0, 0], seg: 40, tubeSeg: 6 });
  b.cyl(m.dark, [0, CORE_Y0 + 0.04, 0], 0.5, 0.56, 0.08);
  b.cyl(m.dark, [0, CORE_Y1 - 0.04, 0], 0.56, 0.5, 0.08);
  // Cuatro pilares de contención con abrazaderas.
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * HALF_PI;
    const x = Math.cos(a) * 0.84;
    const z = Math.sin(a) * 0.84;
    b.box(m.steel, [x, CORE_MID, z], [0.16, CORE_H + 0.2, 0.1], [0, -a, 0]);
    for (const y of [CORE_Y0 + 0.35, CORE_MID, CORE_Y1 - 0.35]) b.box(m.trim, [x, y, z], [0.2, 0.09, 0.14], [0, -a, 0]);
  }
  // Pupitre local con el piloto del reactor.
  b.box(m.machineDark, [0, 0.36, 1.02], [0.54, 0.36, 0.3]);
  b.box(m.hazard, [0, 0.22, 1.172], [0.54, 0.08, 0.01], undefined, 3);
  return b.build();
});

/** Bobinas magnéticas: giran según la carga del reactor. */
const buildReactorCoils = once(() => {
  const m = mats();
  const b = new Builder();
  [CORE_Y0 + 0.45, CORE_MID, CORE_Y1 - 0.45].forEach((y, i) => {
    b.torus(m.copper, [0, y, 0], 0.7, 0.05, { rot: [HALF_PI, 0, i * 2.1], arc: Math.PI * 1.55, seg: 36 });
  });
  return b.build();
});

function Reactor() {
  const plasma = useMemo(plasmaMaterial, []);
  const coils = useRef<Group>(null);
  const light = useRef<PointLight>(null);
  const halo = useRef<Sprite>(null);
  useFrame((state, dt) => {
    const ship = getRun()?.state.ship;
    if (!ship) return;
    const up = ship.powerSupplyKw > 0;
    const color = plasma.u.uColor.value;
    color.lerp(!up ? C_CORE_DEAD : ship.overloaded ? C_CORE_HOT : C_CORE, Math.min(1, dt * 4));
    const load = up ? Math.min(1.4, ship.powerDemandKw / Math.max(1, ship.powerSupplyKw)) : 0;
    const flicker = Math.sin(state.clock.elapsedTime * (ship.overloaded ? 14 : 3)) * (ship.overloaded ? 0.22 : 0.06);
    const power = up ? 0.75 + load * 0.45 + flicker : 0.12;
    plasma.u.uPower.value = approach(plasma.u.uPower.value, power, dt, 6);
    plasma.u.uFlow.value += dt * (up ? 0.5 + load * 1.4 : 0.05);
    if (coils.current) coils.current.rotation.y += dt * (up ? 0.4 + load : 0);
    if (light.current) {
      light.current.color.copy(color);
      light.current.intensity = plasma.u.uPower.value * 16;
    }
    if (halo.current) {
      halo.current.material.color.copy(color);
      halo.current.material.opacity = Math.min(0.5, plasma.u.uPower.value * 0.32);
    }
  });
  return (
    <StationGroup id="reactor">
      <Parts parts={buildReactor()} />
      <mesh position={[0, CORE_MID, 0]} material={plasma.material}>
        <cylinderGeometry args={[0.4, 0.4, CORE_H, 28, 1, true]} />
      </mesh>
      <mesh position={[0, CORE_MID, 0]} material={mats().glass} dispose={null}>
        <cylinderGeometry args={[0.58, 0.58, CORE_H, 28, 1, true]} />
      </mesh>
      <group ref={coils}>
        <Parts parts={buildReactorCoils()} />
      </group>
      <pointLight ref={light} position={[0, CORE_MID, 0]} distance={9} decay={1.6} intensity={14} />
      <Glow ref={halo} size={4.2} opacity={0.3} position={[0, CORE_MID, 0]} />
      <group position={[0, 0.54, 1.02]}>
        <StatusLamp id="reactor" position={[0, 0, 0]} />
      </group>
      <CylinderCollider args={[H / 2, 0.95]} position={[0, H / 2, 0]} />
    </StationGroup>
  );
}

// ───────────────────────────── Motores ─────────────────────────────

const ENGINE_X = [-1.55, 1.55] as const;
const ENGINE_Y = 1.5;
const FAN_Z = 0.4;

const buildEngines = once(() => {
  const m = mats();
  const b = new Builder();
  b.box(m.machineDark, [0, 1.55, -0.45], [5.6, 3.1, 0.3]);
  b.box(m.machine, [0, 0.2, -0.08], [5.4, 0.4, 0.9]);
  b.box(m.hazard, [0, 0.2, 0.375], [5.4, 0.12, 0.012], undefined, 3);
  for (const x of ENGINE_X) {
    const out = Math.sign(x);
    b.cyl(m.machine, [x, ENGINE_Y, -0.02], 0.98, 0.98, 0.7, { rot: [HALF_PI, 0, 0], seg: 36 });
    b.torus(m.trim, [x, ENGINE_Y, 0.33], 0.88, 0.085, { seg: 40, tubeSeg: 10 });
    b.torus(m.steel, [x, ENGINE_Y, -0.2], 0.99, 0.05, { seg: 40 });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      b.cyl(m.steel, [x + Math.cos(a) * 0.88, ENGINE_Y + Math.sin(a) * 0.88, 0.42], 0.028, 0.028, 0.04, { rot: [HALF_PI, 0, 0], seg: 6 });
    }
    // Aletas de refrigeración sobre la carcasa.
    for (let k = -2; k <= 2; k++) b.box(m.steel, [x + k * 0.2, 2.56, -0.06], [0.04, 0.34 - Math.abs(k) * 0.07, 0.56]);
    // Alimentación de combustible.
    b.pipe(m.orange, [x + out * 0.7, 0.4, 0.16], [x + out * 0.7, 0.92, 0.16], 0.06);
    b.torus(m.steel, [x + out * 0.7, 0.62, 0.16], 0.075, 0.02, { rot: [HALF_PI, 0, 0], seg: 14 });
    b.pipe(m.copper, [x - out * 0.72, 0.4, 0.12], [x - out * 0.72, 0.9, 0.12], 0.04);
  }
  // Colector central con su pantalla.
  b.box(m.machine, [0, 1.5, -0.05], [0.94, 1.2, 0.6]);
  b.box(m.trim, [0, 2.1, -0.05], [1.0, 0.05, 0.66]);
  b.box(m.screen, [0, 1.62, 0.255], [0.66, 0.4, 0.012]);
  for (let k = 0; k < 4; k++) b.box(m.dark, [0, 1.08 + k * 0.07, 0.253], [0.6, 0.03, 0.012]);
  return b.build();
});

const buildFan = once(() => {
  const m = mats();
  const b = new Builder();
  const blades = 11;
  for (let k = 0; k < blades; k++) {
    const a = (k / blades) * Math.PI * 2;
    const blade = new BoxGeometry(0.56, 0.2, 0.014);
    blade.rotateX(0.55);
    b.add(m.steel, blade, [Math.cos(a) * 0.44, Math.sin(a) * 0.44, 0], [0, 0, a]);
  }
  b.lathe(m.trim, [[0.2, 0], [0.17, 0.1], [0.09, 0.2], [0, 0.24]], [0, 0, -0.04], { rot: [HALF_PI, 0, 0], seg: 20 });
  return b.build();
});

function Engines() {
  const glow = useMemo(engineGlowMaterial, []);
  const leds = useMemo(() => ledsMaterial(12, 5), []);
  const fans = useRef<(Group | null)[]>([]);
  const halos = useRef<(Sprite | null)[]>([]);
  const spin = useRef(0);
  useFrame((state, dt) => {
    const ship = getRun()?.state.ship;
    if (!ship) return;
    const online = ship.systems.engines.online;
    const thrust = Math.min(1.6, ship.speedLyPerS / 0.5);
    const flicker = thrust > 0 ? Math.sin(state.clock.elapsedTime * 22) * 0.06 : 0;
    glow.u.uThrust.value = approach(glow.u.uThrust.value, online ? 0.12 + thrust + flicker : 0, dt, 3);
    leds.u.uOn.value = online ? 1 : 0;
    // Las palas giran al ralentí con los motores en línea y aceleran con el empuje.
    spin.current = approach(spin.current, online ? 1.2 + thrust * 16 : 0, dt, 1.5);
    fans.current.forEach((fan, i) => {
      if (fan) fan.rotation.z += dt * spin.current * (i === 0 ? 1 : -1);
    });
    for (const halo of halos.current) {
      if (!halo) continue;
      halo.material.opacity = Math.min(0.55, glow.u.uThrust.value * 0.4);
      halo.scale.setScalar(2.2 + glow.u.uThrust.value * 1.2);
    }
  });
  return (
    <StationGroup id="engines">
      <Parts parts={buildEngines()} />
      {ENGINE_X.map((x, i) => (
        <group key={x} position={[x, ENGINE_Y, 0]}>
          <mesh position={[0, 0, 0.336]} material={glow.material}>
            <circleGeometry args={[0.8, 36]} />
          </mesh>
          <group ref={(g) => void (fans.current[i] = g)} position={[0, 0, FAN_Z]}>
            <Parts parts={buildFan()} />
          </group>
          <Glow ref={(s) => void (halos.current[i] = s)} color="#4aa3ff" size={2.2} opacity={0} position={[0, 0, 0.5]} />
        </group>
      ))}
      <mesh position={[0, 1.62, 0.263]} material={leds.material}>
        <planeGeometry args={[0.6, 0.34]} />
      </mesh>
      <group position={[0, 1.96, 0.27]} rotation={[HALF_PI, 0, 0]}>
        <StatusLamp id="engines" position={[0, 0, 0]} />
      </group>
      <CuboidCollider args={[2.7, 1.3, 0.55]} position={[0, 1.3, -0.1]} />
    </StationGroup>
  );
}

// ───────────────────────────── Soporte vital ─────────────────────────────

const LS_Z = -0.15;
const TANK_X = [-0.7, 0.7] as const;

const buildLifeSupport = once(() => {
  const m = mats();
  const b = new Builder();
  b.box(m.machine, [0, 0.12, LS_Z], [2.2, 0.24, 1.0]);
  b.box(m.hazard, [0, 0.12, LS_Z + 0.505], [2.2, 0.1, 0.012], undefined, 3);
  // Biorreactor central: tapas, varillas y colector.
  b.cyl(m.trim, [0, 0.32, LS_Z], 0.36, 0.4, 0.16, { seg: 24 });
  b.cyl(m.trim, [0, 1.92, LS_Z], 0.4, 0.36, 0.16, { seg: 24 });
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * HALF_PI;
    b.pipe(m.steel, [Math.cos(a) * 0.35, 0.4, LS_Z + Math.sin(a) * 0.35], [Math.cos(a) * 0.35, 1.84, LS_Z + Math.sin(a) * 0.35], 0.018, 8);
  }
  // Botellas de oxígeno a los lados.
  for (const x of TANK_X) {
    b.lathe(m.tank, [[0, 0.26], [0.16, 0.27], [0.25, 0.36], [0.27, 0.48], [0.27, 1.56], [0.25, 1.68], [0.16, 1.78], [0.06, 1.82], [0.06, 1.92], [0, 1.92]], [x, 0, LS_Z], { seg: 24 });
    for (const y of [0.62, 1.42]) b.torus(m.green, [x, y, LS_Z], 0.275, 0.028, { rot: [HALF_PI, 0, 0], seg: 28 });
    b.cyl(m.steel, [x, 1.96, LS_Z], 0.07, 0.07, 0.1, { seg: 12 });
    b.torus(m.orange, [x, 2.04, LS_Z], 0.11, 0.018, { rot: [HALF_PI, 0, 0], seg: 18 });
    b.box(m.orange, [x, 2.04, LS_Z], [0.22, 0.02, 0.025]);
    b.box(m.orange, [x, 2.04, LS_Z], [0.025, 0.02, 0.22]);
    b.box(m.dark, [x, 0.3, LS_Z], [0.62, 0.12, 0.62]);
  }
  // Colector superior hacia el casco.
  b.pipe(m.steel, [TANK_X[0], 1.96, LS_Z], [TANK_X[1], 1.96, LS_Z], 0.045);
  b.box(m.machineDark, [0, 2.06, LS_Z], [0.26, 0.14, 0.26]);
  b.pipe(m.orange, [0, 2.06, LS_Z], [0, 2.06, -0.9], 0.055);
  // Pupitre de medida al frente.
  b.box(m.machineDark, [0, 0.36, LS_Z + 0.44], [0.6, 0.26, 0.16], [-0.5, 0, 0]);
  return b.build();
});

function LifeSupport() {
  const liquid = useMemo(liquidMaterial, []);
  const leds = useMemo(() => ledsMaterial(10, 3), []);
  const halo = useRef<Sprite>(null);
  useFrame((_, dt) => {
    const on = isOnline('lifeSupport') ? 1 : 0;
    liquid.u.uOn.value = approach(liquid.u.uOn.value, on, dt, 2);
    leds.u.uOn.value = on;
    if (halo.current) halo.current.material.opacity = liquid.u.uOn.value * 0.22;
  });
  return (
    <StationGroup id="lifeSupport">
      <Parts parts={buildLifeSupport()} />
      <mesh position={[0, 1.12, LS_Z]} material={liquid.material}>
        <cylinderGeometry args={[0.27, 0.27, 1.44, 24, 1, true]} />
      </mesh>
      <mesh position={[0, 1.12, LS_Z]} material={mats().glass} dispose={null}>
        <cylinderGeometry args={[0.32, 0.32, 1.44, 24, 1, true]} />
      </mesh>
      <group position={[0, 0.36, LS_Z + 0.44]} rotation={[-0.5, 0, 0]}>
        <mesh position={[0, 0, 0.082]} material={leds.material}>
          <planeGeometry args={[0.5, 0.16]} />
        </mesh>
      </group>
      <Glow ref={halo} color="#3ddc84" size={2.4} opacity={0.2} position={[0, 1.12, LS_Z]} />
      <StatusLamp id="lifeSupport" position={[0, 2.13, LS_Z]} />
      <CuboidCollider args={[1, 1, 0.45]} position={[0, 1, LS_Z]} />
    </StationGroup>
  );
}

// ───────────────────────────── Escudos ─────────────────────────────

const SH_Z = -0.15;
const SH_Y = 1.45;

const buildShields = once(() => {
  const m = mats();
  const b = new Builder();
  b.lathe(m.machine, [[0.78, 0], [0.78, 0.08], [0.6, 0.2], [0.44, 0.3], [0.4, 0.7], [0.56, 0.82], [0.62, 0.84], [0.62, 0.92], [0, 0.92]], [0, 0, SH_Z]);
  for (const y of [0.38, 0.49, 0.6]) b.torus(m.copper, [0, y, SH_Z], 0.46, 0.045, { rot: [HALF_PI, 0, 0], seg: 32 });
  b.torus(m.trim, [0, 0.92, SH_Z], 0.62, 0.025, { rot: [HALF_PI, 0, 0], seg: 36 });
  b.torus(m.guide, [0, 0.02, SH_Z], 0.81, 0.012, { rot: [HALF_PI, 0, 0], seg: 36, tubeSeg: 6 });
  b.cyl(m.dark, [0, 0.95, SH_Z], 0.2, 0.5, 0.06, { seg: 24 });
  // Tres garras emisoras alrededor del campo.
  for (let k = 0; k < 3; k++) {
    const a = HALF_PI + (k * Math.PI * 2) / 3;
    const p = (r: number, y: number): V3 => [Math.cos(a) * r, y, SH_Z + Math.sin(a) * r];
    b.pipe(m.steel, p(0.56, 0.92), p(0.74, 1.42), 0.035);
    b.pipe(m.steel, p(0.74, 1.42), p(0.6, 1.94), 0.03);
    b.sphere(m.trim, p(0.74, 1.42), 0.055);
    b.sphere(m.led, p(0.58, 1.97), 0.04);
  }
  return b.build();
});

const buildGimbal = (radius: number) =>
  once(() => {
    const b = new Builder();
    b.torus(mats().trim, [0, 0, 0], radius, 0.016, { seg: 48, tubeSeg: 6 });
    return b.build();
  });
const gimbalInner = buildGimbal(0.47);
const gimbalOuter = buildGimbal(0.53);

function Shields() {
  const field = useMemo(shieldMaterial, []);
  const inner = useRef<Group>(null);
  const outer = useRef<Group>(null);
  const core = useRef<Mesh>(null);
  const halo = useRef<Sprite>(null);
  const spin = useRef(1);
  useFrame((_, dt) => {
    const on = isOnline('shields') ? 1 : 0;
    field.u.uOn.value = approach(field.u.uOn.value, on, dt, 3);
    spin.current = approach(spin.current, on, dt, 1.5);
    if (inner.current) {
      inner.current.rotation.y += dt * 1.2 * spin.current;
      inner.current.rotation.x += dt * 0.5 * spin.current;
    }
    if (outer.current) {
      outer.current.rotation.z -= dt * 0.8 * spin.current;
      outer.current.rotation.x += dt * 0.3 * spin.current;
    }
    const k = field.u.uOn.value;
    if (core.current) (core.current.material as MeshBasicMaterial).color.setRGB(0.05 + 0.55 * k, 0.1 + 0.75 * k, 0.2 + 0.8 * k);
    if (halo.current) halo.current.material.opacity = 0.03 + 0.3 * k;
  });
  return (
    <StationGroup id="shields">
      <Parts parts={buildShields()} />
      <group position={[0, SH_Y, SH_Z]}>
        <mesh ref={core}>
          <sphereGeometry args={[0.1, 16, 12]} />
          <meshBasicMaterial toneMapped={false} />
        </mesh>
        <mesh material={field.material}>
          <sphereGeometry args={[0.4, 36, 24]} />
        </mesh>
        <group ref={inner}>
          <Parts parts={gimbalInner()} />
        </group>
        <group ref={outer} rotation={[HALF_PI, 0, 0]}>
          <Parts parts={gimbalOuter()} />
        </group>
        <Glow ref={halo} color="#4aa3ff" size={2.6} opacity={0.3} />
      </group>
      <StatusLamp id="shields" position={[0, 0.94, SH_Z + 0.52]} />
      <CylinderCollider args={[0.9, 0.7]} position={[0, 0.9, SH_Z]} />
    </StationGroup>
  );
}

// ───────────────────────────── Navegación (sensores) ─────────────────────────────

const NAV_Z = -0.2;
const NAV_TILT = -0.24;

const buildNav = once(() => {
  const m = mats();
  const b = new Builder();
  b.box(m.dark, [0, 0.06, NAV_Z + 0.02], [1.4, 0.12, 0.58]);
  b.box(m.machine, [0, 0.56, NAV_Z], [1.5, 0.9, 0.62]);
  for (let k = 0; k < 4; k++) b.box(m.dark, [0, 0.3 + k * 0.1, NAV_Z + 0.312], [1.1, 0.04, 0.012]);
  b.box(m.trim, [0, 1.02, NAV_Z + 0.03], [1.54, 0.04, 0.7]);
  b.box(m.machine, [0, 1.32, NAV_Z - 0.06], [1.5, 0.6, 0.46], [NAV_TILT, 0, 0]);
  b.box(m.machineDark, [0, 1.6, NAV_Z - 0.1], [1.2, 0.08, 0.4]);
  // Mástil de la antena.
  b.cyl(m.dark, [0, 1.67, NAV_Z - 0.1], 0.1, 0.13, 0.06, { seg: 16 });
  b.cyl(m.steel, [0, 1.84, NAV_Z - 0.1], 0.035, 0.04, 0.3, { seg: 10 });
  return b.build();
});

/** Cara inclinada de la consola (en su propio sistema de coordenadas). */
const buildNavFace = once(() => {
  const m = mats();
  const b = new Builder();
  b.box(m.screen, [0, 0, 0.232], [1.36, 0.5, 0.012]);
  b.torus(m.trim, [-0.38, 0, 0.24], 0.225, 0.016, { seg: 32, tubeSeg: 6 });
  return b.build();
});

const buildDish = once(() => {
  const m = mats();
  const b = new Builder();
  b.lathe(m.dish, [[0.02, 0], [0.14, 0.02], [0.26, 0.07], [0.36, 0.15]], [0, 0, 0], { rot: [1.1, 0, 0], seg: 24 });
  b.pipe(m.steel, [0, 0, 0], [0, 0.14, 0.27], 0.012, 6);
  b.sphere(m.led, [0, 0.14, 0.27], 0.03);
  return b.build();
});

function NavRack() {
  const radar = useMemo(radarMaterial, []);
  const leds = useMemo(() => ledsMaterial(14, 6), []);
  const dish = useRef<Group>(null);
  useFrame((_, dt) => {
    const s = getRun()?.state;
    if (!s) return;
    const online = s.ship.systems.nav.online;
    radar.u.uOn.value = approach(radar.u.uOn.value, online ? 1 : 0, dt, 4);
    radar.u.uWarn.value = online && s.warnings.some((w) => !w.evaded) ? 1 : 0;
    leds.u.uOn.value = online ? 1 : 0;
    if (dish.current && online) dish.current.rotation.y += dt * 1.5;
  });
  return (
    <StationGroup id="nav">
      <Parts parts={buildNav()} />
      <group position={[0, 1.32, NAV_Z - 0.06]} rotation={[NAV_TILT, 0, 0]}>
        <Parts parts={buildNavFace()} />
        <mesh position={[-0.38, 0, 0.24]} material={radar.material}>
          <circleGeometry args={[0.215, 40]} />
        </mesh>
        <mesh position={[0.3, 0.05, 0.24]} material={leds.material}>
          <planeGeometry args={[0.62, 0.3]} />
        </mesh>
        <group position={[0.52, -0.18, 0.238]} rotation={[HALF_PI, 0, 0]}>
          <StatusLamp id="nav" position={[0, 0, 0]} />
        </group>
      </group>
      <group ref={dish} position={[0, 2.0, NAV_Z - 0.1]}>
        <Parts parts={buildDish()} />
      </group>
      <CuboidCollider args={[0.75, 0.8, 0.32]} position={[0, 0.8, NAV_Z]} />
    </StationGroup>
  );
}

// ───────────────────────────── Fase 8 · Litera y comunicaciones ─────────────────────────────

const buildBunk = once(() => {
  const m = mats();
  const b = new Builder();
  // Largo a lo largo de X local (= eje Z de la nave): la cabecera queda a −X.
  b.box(m.machineDark, [0, 0.3, 0], [2.0, 0.5, 0.95]);
  b.box(m.wallDark, [0.05, 0.6, 0], [1.85, 0.14, 0.85]);
  b.box(m.wall, [-0.7, 0.72, 0], [0.32, 0.12, 0.6]);
  b.box(m.machineDark, [0, 1.15, -0.45], [2.0, 0.9, 0.06]);
  b.box(m.led, [0, 0.08, 0.49], [1.6, 0.02, 0.02]);
  return b.build();
});

function Bunk() {
  return (
    <StationGroup id="bunk">
      <Parts parts={buildBunk()} />
      <pointLight position={[0, 1.2, 0.3]} intensity={0.35} distance={3} color="#ffb98a" />
      <CuboidCollider args={[1.0, 0.35, 0.5]} position={[0, 0.35, 0]} />
    </StationGroup>
  );
}

const buildComms = once(() => {
  const m = mats();
  const b = new Builder();
  b.box(m.machineDark, [0, 0.55, 0], [1.1, 1.1, 0.5]);
  b.box(m.dark, [0, 1.35, 0.1], [0.95, 0.55, 0.06]);
  b.box(m.led, [0, 1.35, 0.14], [0.85, 0.45, 0.01]);
  return b.build();
});

function Comms() {
  return (
    <StationGroup id="comms">
      <Parts parts={buildComms()} />
      <StatusLamp id="nav" position={[0.42, 1.12, 0.26]} />
      <CuboidCollider args={[0.55, 0.7, 0.28]} position={[0, 0.7, 0]} />
    </StationGroup>
  );
}

/** Todos los puestos de la nave, con sus colisiones. */
export function Stations() {
  const psych = !!getPsychRules(getRun()?.catalog ?? defaultCatalog);
  return (
    <RigidBody type="fixed" colliders={false}>
      <Helm />
      <MapTable />
      <PowerPanel3D />
      <Reactor />
      <Engines />
      <LifeSupport />
      <Shields />
      <NavRack />
      <Airlock3D />
      <CargoBay />
      {psych && <Bunk />}
      {psych && <Comms />}
    </RigidBody>
  );
}
