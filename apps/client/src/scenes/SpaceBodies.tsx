import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, Color, IcosahedronGeometry, MeshBasicMaterial, MeshStandardMaterial, Object3D, Vector3, type Group, type InstancedMesh, type Mesh, type Sprite } from 'three';
import type { NodeKind } from '@payload/shared';
import { Builder, Parts, once } from '../gfx/build';
import { Glow } from '../gfx/Glow';
import { mats } from '../gfx/materials';
import { atmosphereMaterial, nebulaMaterial, planetMaterial, ringMaterial, vortexMaterial, type PlanetLook } from '../gfx/spaceShaders';
import { rockMaps } from '../gfx/textures';
import { ErizonStation } from '../models/Models';

const HALF_PI = Math.PI / 2;

/** Hash estable (FNV-1a) del id del destino: cada cuerpo tiene siempre el mismo aspecto. */
function hashOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** PRNG determinista para repartir rocas y restos (el aspecto no depende de `Math.random`). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hsl = (h: number, s: number, l: number): Color => new Color().setHSL(((h % 1) + 1) % 1, s, l);

const SURFACES = ['terran', 'desert', 'gas', 'ice', 'lava'] as const;

/** Tipo de superficie y paleta de un planeta a partir de su id. */
function planetLook(id: string): PlanetLook {
  const h = hashOf(id);
  const type = SURFACES[h % SURFACES.length] ?? 'desert';
  const hue = ((h >>> 8) % 360) / 360;
  const seed = ((h >>> 4) % 997) / 10;
  switch (type) {
    case 'terran':
      return { type, seed, a: hsl(0.56 + (hue - 0.5) * 0.12, 0.7, 0.32), b: hsl(0.25 + (hue - 0.5) * 0.3, 0.45, 0.28), c: hsl(0.08, 0.3, 0.42), atmosphere: hsl(0.58, 0.85, 0.6) };
    case 'desert': {
      const base = 0.03 + hue * 0.1;
      return { type, seed, a: hsl(base, 0.5, 0.3), b: hsl(base + 0.03, 0.55, 0.52), c: hsl(base - 0.03, 0.4, 0.2), atmosphere: hsl(base + 0.02, 0.7, 0.6) };
    }
    case 'gas':
      return { type, seed, a: hsl(hue, 0.5, 0.5), b: hsl(hue + 0.07, 0.45, 0.72), c: hsl(hue - 0.1, 0.6, 0.35), atmosphere: hsl(hue + 0.03, 0.6, 0.65) };
    case 'ice':
      return { type, seed, a: hsl(0.56, 0.4, 0.7), b: hsl(0.55, 0.2, 0.9), c: hsl(0.6, 0.65, 0.4), atmosphere: hsl(0.52, 0.8, 0.7) };
    case 'lava':
      return { type, seed, a: new Color('#17100e'), b: new Color('#3b2a22'), c: new Color('#ff5a14'), atmosphere: new Color('#ff5a2a') };
  }
}

const PLANET_R = 48;

function Planet({ id }: { id: string }) {
  const look = useMemo(() => planetLook(id), [id]);
  const surface = useMemo(() => planetMaterial(look), [look]);
  const atmosphere = useMemo(() => atmosphereMaterial(look.atmosphere, PLANET_R), [look]);
  // Dos de cada tres gigantes gaseosos tienen anillos.
  const ring = useMemo(() => (look.type === 'gas' && hashOf(id) % 3 !== 0 ? ringMaterial(look.b.clone().lerp(new Color('#ffffff'), 0.3), look.seed, PLANET_R * 1.35, PLANET_R * 2.25, PLANET_R) : null), [id, look]);
  const globe = useRef<Mesh>(null);
  useFrame((_, dt) => {
    if (globe.current) globe.current.rotation.y += dt * 0.012;
  });
  return (
    <group rotation={[0.22, 0, 0.3]}>
      <mesh ref={globe} material={surface.material}>
        <sphereGeometry args={[PLANET_R, 96, 64]} />
      </mesh>
      <mesh material={atmosphere} frustumCulled={false}>
        <planeGeometry args={[2, 2]} />
      </mesh>
      {ring && (
        <mesh material={ring} rotation={[HALF_PI - 0.12, 0, 0]}>
          <ringGeometry args={[PLANET_R * 1.35, PLANET_R * 2.25, 128, 1]} />
        </mesh>
      )}
    </group>
  );
}

const MOON_R = 24;

function Moon({ id }: { id: string }) {
  const surface = useMemo(
    () => planetMaterial({ type: 'moon', seed: (hashOf(id) % 997) / 10, a: new Color('#9c9995'), b: new Color('#56534f'), c: new Color('#000000'), atmosphere: new Color('#000000') }),
    [id],
  );
  const globe = useRef<Mesh>(null);
  useFrame((_, dt) => {
    if (globe.current) globe.current.rotation.y += dt * 0.01;
  });
  return (
    <mesh ref={globe} material={surface.material} rotation={[0.1, 0, 0.15]}>
      <sphereGeometry args={[MOON_R, 72, 48]} />
    </mesh>
  );
}

/** Ruido de valor 3D en JS (solo para deformar la roca una vez, al crear la geometría). */
function valueNoise3(x: number, y: number, z: number): number {
  const hash = (ix: number, iy: number, iz: number): number => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const s = (t: number): number => t * t * (3 - 2 * t);
  const fx = s(x - xi);
  const fy = s(y - yi);
  const fz = s(z - zi);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const plane = (iz: number): number => lerp(lerp(hash(xi, yi, iz), hash(xi + 1, yi, iz), fx), lerp(hash(xi, yi + 1, iz), hash(xi + 1, yi + 1, iz), fx), fy);
  return lerp(plane(zi), plane(zi + 1), fz);
}

/** Roca de radio ~1: un icosaedro abollado. Facetada a propósito (se ve tallada con la luz rasante). */
const rockGeometry = once(() => {
  const g = new IcosahedronGeometry(1, 3);
  const pos = g.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const r = 0.72 + 0.5 * valueNoise3(v.x * 1.4 + 5, v.y * 1.4 + 9, v.z * 1.4 + 2) + 0.16 * valueNoise3(v.x * 4 + 1, v.y * 4 + 3, v.z * 4 + 7);
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  g.computeVertexNormals();
  return g;
});

const rockMaterial = once(() => {
  const maps = rockMaps();
  return new MeshStandardMaterial({ color: '#c4b6a4', map: maps.albedo, normalMap: maps.normal, roughnessMap: maps.rough, roughness: 1, metalness: 0.05, flatShading: true });
});

const ROCKS = 70;

/** Campo de asteroides: rocas instanciadas de tamaños muy distintos, cada una girando a su ritmo. */
function AsteroidField({ id }: { id: string }) {
  const mesh = useRef<InstancedMesh>(null);
  const group = useRef<Group>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const rocks = useMemo(() => {
    const r = rng(hashOf(id));
    return Array.from({ length: ROCKS }, (_, i) => {
      // Unas pocas rocas grandes cerca del centro y muchas pequeñas alrededor.
      const big = i < 5;
      const size = big ? 6 + r() * 6 : 0.8 + r() * r() * 4.5;
      const spread = big ? 0.55 : 1;
      return {
        pos: new Vector3((r() - 0.5) * 120 * spread, (r() - 0.5) * 46 * spread, (r() - 0.5) * 90 * spread),
        axis: new Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(),
        speed: (0.03 + r() * 0.22) / Math.sqrt(size),
        phase: r() * Math.PI * 2,
        scale: new Vector3(size * (0.75 + r() * 0.5), size * (0.6 + r() * 0.5), size * (0.75 + r() * 0.5)),
        tone: 0.6 + r() * 0.5,
      };
    });
  }, [id]);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new Color();
    rocks.forEach((rock, i) => m.setColorAt(i, c.setRGB(rock.tone, rock.tone * 0.97, rock.tone * 0.92)));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [rocks]);
  useFrame((state, dt) => {
    const m = mesh.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < ROCKS; i++) {
      const rock = rocks[i];
      if (!rock) continue;
      dummy.position.copy(rock.pos);
      dummy.quaternion.setFromAxisAngle(rock.axis, rock.phase + t * rock.speed);
      dummy.scale.copy(rock.scale);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    if (group.current) group.current.rotation.y += dt * 0.006;
  });
  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[rockGeometry(), rockMaterial(), ROCKS]} frustumCulled={false} dispose={null} />
    </group>
  );
}

function Nebula({ id }: { id: string }) {
  const layers = useMemo(() => {
    const h = hashOf(id);
    const hue = (h % 360) / 360;
    const seed = ((h >>> 6) % 500) / 10;
    return [
      nebulaMaterial(seed, hsl(hue, 0.75, 0.45), hsl(hue + 0.12, 0.8, 0.5), hsl(hue - 0.18, 0.7, 0.6), 1),
      nebulaMaterial(seed + 31.7, hsl(hue + 0.5, 0.6, 0.4), hsl(hue + 0.08, 0.7, 0.45), hsl(hue + 0.3, 0.6, 0.6), 0.55),
    ] as const;
  }, [id]);
  return (
    <group>
      <mesh material={layers[1]} position={[25, -10, -60]} scale={150} frustumCulled={false}>
        <planeGeometry args={[2, 2]} />
      </mesh>
      <mesh material={layers[0]} scale={105} frustumCulled={false}>
        <planeGeometry args={[2, 2]} />
      </mesh>
      {/* Estrellas jóvenes embebidas en el gas. */}
      <Glow color="#ffffff" size={16} opacity={0.9} position={[-18, 12, 4]} />
      <Glow color="#bfd8ff" size={11} opacity={0.8} position={[26, -6, 8]} />
      <Glow color="#ffd9b0" size={8} opacity={0.8} position={[4, -22, 6]} />
    </group>
  );
}

/** Densidad de textura de las naves lejanas: paneles de ~14 m para que el detalle se lea a distancia. */
const FAR_TILE = 0.07;

const buildDerelict = once(() => {
  const m = mats();
  const b = new Builder();
  // Dos mitades de casco desalineadas por la rotura.
  b.box(m.wall, [0, 0, -17], [13, 8, 22], [0, 0, 0], FAR_TILE);
  b.box(m.machine, [0, 0.5, -17], [13.6, 1.2, 20], [0, 0, 0], FAR_TILE);
  b.box(m.wall, [1.8, -1.2, 15], [14, 9, 20], [0.05, 0.13, 0.07], FAR_TILE);
  b.box(m.machine, [1.8, -0.8, 15], [14.6, 1.2, 18], [0.05, 0.13, 0.07], FAR_TILE);
  // Costillas y largueros al aire en la zona partida.
  for (const [z, arc, roll] of [[-5, 4.6, 0.4], [-1.5, 3.4, 1.9], [3.5, 5.2, 3.3]] as const) b.torus(m.steel, [0.6, -0.4, z], 5.2, 0.35, { arc, rot: [0, 0, roll], seg: 24 });
  for (const [x, y] of [[-5, 3], [5, 3.2], [-4.6, -3.4], [5.4, -3.6]] as const) b.pipe(m.steel, [x, y, -6], [x + 1.4, y - 0.9, 5.5], 0.3, 8);
  // Puente, motor y antena.
  b.box(m.machine, [0, 5.4, -21], [6, 3, 8], [0, 0, 0], FAR_TILE);
  b.box(m.screen, [0, 5.8, -25.05], [5, 0.9, 0.1]);
  b.cyl(m.machine, [1.9, -1.3, 27.5], 6, 7.4, 7, { rot: [HALF_PI, 0.13, 0], seg: 20, density: FAR_TILE });
  for (const x of [-1.4, 5]) b.cyl(m.dark, [x, -1.4, 32], 2.6, 2.1, 3, { rot: [HALF_PI, 0, 0], seg: 16 });
  b.pipe(m.steel, [0, 6.9, -21], [3, 15, -23], 0.18, 6);
  b.lathe(m.dish, [[0.1, 0], [1.2, 0.2], [2.2, 0.7], [3, 1.4]], [3, 15, -23], { rot: [0.9, 0, -0.4], seg: 20 });
  // Panel solar arrancado.
  b.box(m.screen, [-13, 1.5, -13], [11, 0.2, 6], [0.3, 0.1, 0.5]);
  b.pipe(m.steel, [-6.5, 0.5, -13], [-8.5, 1, -13], 0.25, 6);
  return b.build();
});

const DEBRIS = 36;
const debrisGeometry = once(() => new BoxGeometry(1, 1, 1));

function Derelict({ id }: { id: string }) {
  const group = useRef<Group>(null);
  const debris = useRef<InstancedMesh>(null);
  const beacon = useRef<Mesh>(null);
  const halo = useRef<Sprite>(null);
  useEffect(() => {
    const m = debris.current;
    if (!m) return;
    const r = rng(hashOf(id));
    const dummy = new Object3D();
    for (let i = 0; i < DEBRIS; i++) {
      dummy.position.set((r() - 0.5) * 34, (r() - 0.5) * 26, (r() - 0.5) * 30);
      dummy.rotation.set(r() * 6, r() * 6, r() * 6);
      dummy.scale.set(0.3 + r() * 2.2, 0.1 + r() * 0.6, 0.3 + r() * 1.8);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, [id]);
  useFrame((state, dt) => {
    if (group.current) {
      group.current.rotation.y += dt * 0.03;
      group.current.rotation.x += dt * 0.011;
    }
    if (debris.current) debris.current.rotation.z += dt * 0.02;
    // Baliza de socorro: dos destellos cortos cada dos segundos.
    const phase = state.clock.elapsedTime % 2;
    const on = phase < 0.12 || (phase > 0.3 && phase < 0.42) ? 1 : 0.06;
    if (beacon.current) (beacon.current.material as MeshBasicMaterial).color.setRGB(on, on * 0.12, on * 0.14);
    if (halo.current) halo.current.material.opacity = on * 0.9;
  });
  return (
    <group ref={group} rotation={[0.4, 0.6, 0.9]}>
      <Parts parts={buildDerelict()} />
      <instancedMesh ref={debris} args={[debrisGeometry(), mats().steel, DEBRIS]} frustumCulled={false} dispose={null} />
      <mesh ref={beacon} position={[0, 7.3, -18]}>
        <sphereGeometry args={[0.5, 12, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </mesh>
      <Glow ref={halo} color="#ff3040" size={14} opacity={0} position={[0, 7.3, -18]} />
    </group>
  );
}

const GATE_R = 36;
const gateLight = once(() => new MeshBasicMaterial({ color: '#38e1c0', toneMapped: false }));

const buildGate = once(() => {
  const m = mats();
  const b = new Builder();
  b.torus(m.machineDark, [0, 0, 0], GATE_R, 2.6, { seg: 96, tubeSeg: 14, uv: [26, 2] });
  const segments = 12;
  for (let k = 0; k < segments; k++) {
    const a = (k / segments) * Math.PI * 2;
    const at = (r: number, z = 0): [number, number, number] => [Math.cos(a) * r, Math.sin(a) * r, z];
    // Collarín que abraza el anillo, con su emisor apuntando al centro.
    b.box(m.machine, at(GATE_R), [6.6, 8.4, 6.8], [0, 0, a], 0.1);
    b.box(m.steel, at(GATE_R + 4.6), [1.6, 5, 3], [0, 0, a], 0.1);
    b.box(m.steel, at(GATE_R - 4.8), [3.4, 1.6, 1.6], [0, 0, a], 0.1);
    for (const z of [-3.45, 3.45]) b.box(gateLight(), at(GATE_R, z), [4.4, 0.7, 0.1], [0, 0, a]);
    b.box(gateLight(), at(GATE_R - 6.6), [0.5, 1.1, 1.1], [0, 0, a]);
  }
  return b.build();
});

function Gate() {
  const vortex = useMemo(vortexMaterial, []);
  const ring = useRef<Group>(null);
  useFrame((_, dt) => {
    if (ring.current) ring.current.rotation.z += dt * 0.04;
  });
  return (
    <group>
      <group ref={ring}>
        <Parts parts={buildGate()} />
      </group>
      <mesh material={vortex}>
        <circleGeometry args={[GATE_R - 2.2, 64]} />
      </mesh>
      <Glow color="#38e1c0" size={170} opacity={0.22} />
    </group>
  );
}

function Station() {
  const ref = useRef<Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.03;
  });
  return (
    <group ref={ref} rotation={[0.5, 0, 0.2]}>
      <ErizonStation size={70} delayMs={1500} />
    </group>
  );
}

/** El cuerpo que representa a un destino del sector, centrado en el origen de su grupo. */
export function Body({ kind, id }: { kind: NodeKind; id: string }) {
  switch (kind) {
    case 'station':
      return <Station />;
    case 'planet':
      return <Planet id={id} />;
    case 'moon':
      return <Moon id={id} />;
    case 'asteroid':
      return <AsteroidField id={id} />;
    case 'nebula':
      return <Nebula id={id} />;
    case 'derelict':
      return <Derelict id={id} />;
    case 'gate':
      return <Gate />;
  }
}
