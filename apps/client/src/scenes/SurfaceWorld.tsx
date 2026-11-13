import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, Stars } from '@react-three/drei';
import { BallCollider, RigidBody, TrimeshCollider } from '@react-three/rapier';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Fog,
  IcosahedronGeometry,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  type InstancedMesh,
  type Material,
  type Points,
  type Sprite,
} from 'three';
import { getWorld, type Deposit, type RunState } from '@payload/shared';
import { mixSeed, rng, valueNoise2 } from '../game/noise';
import { getRun } from '../game/runStore';
import { PAD_RADIUS_M, SHIP_CENTER, stormLevel } from '../game/surfaceRules';
import { createTerrain, gridSizeFor, terrainGrid, terrainSeed, type Terrain } from '../game/terrain';
import { Builder, once } from '../gfx/build';
import { seedGeometry, sparkMaterial } from '../gfx/fxShaders';
import { pebbleGeometry, rockGeometry, rockMaterial } from '../gfx/rocks';
import { DEPOSIT_LOOKS, surfaceLook, type SurfaceLook } from '../gfx/surfaceLook';
import { beamMaterial, dustMaterial, MAX_SHADER_ZONES, patchTerrainMaterial, skyDomeMaterial, stormMaterial, terrainUniforms } from '../gfx/surfaceShaders';
import { glowTexture, rockMaps } from '../gfx/textures';

/** Terreno vivo de la superficie (para la cámara y el jugador, que lo consultan por frame). */
export const liveTerrain: { current: Terrain | null } = { current: null };

/** Firma de lo que cambia el relieve: el nodo y qué zonas se han hundido. */
function terrainKey(s: RunState | undefined): string {
  const surface = s?.surface;
  if (!s || !surface) return '';
  return `${s.seed}|${s.sector.index}|${surface.nodeId}|${surface.zones.map((z) => (z.collapsed ? 1 : 0)).join('')}`;
}

function buildTerrain(s: RunState | undefined): Terrain | null {
  const surface = s?.surface;
  if (!s || !surface) return null;
  const world = getWorld(surface.worldId);
  return createTerrain({
    seed: s.seed,
    sectorIndex: s.sector.index,
    nodeId: surface.nodeId,
    worldId: surface.worldId,
    radiusM: surface.radiusM,
    pitDepthM: world.unstable.pitDepthM,
    deposits: surface.deposits.map((d) => ({ x: d.x, z: d.z })),
    zones: surface.zones.map((z) => ({ x: z.x, z: z.z, radiusM: z.radiusM, collapsed: z.collapsed })),
    padX: SHIP_CENTER.x,
    padZ: SHIP_CENTER.z,
    padRadiusM: PAD_RADIUS_M,
  });
}

/** El terreno se reconstruye solo cuando cambia su firma (al hundirse una zona), no por frame. */
export function useLiveTerrain(): Terrain | null {
  const [key, setKey] = useState(() => terrainKey(getRun()?.state));
  const clock = useRef(0);
  useFrame((_, dt) => {
    clock.current += dt;
    if (clock.current < 0.1) return;
    clock.current = 0;
    const k = terrainKey(getRun()?.state);
    if (k !== key) setKey(k);
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const terrain = useMemo(() => buildTerrain(getRun()?.state), [key]);
  useEffect(() => {
    liveTerrain.current = terrain;
    return () => {
      if (liveTerrain.current === terrain) liveTerrain.current = null;
    };
  }, [terrain]);
  return terrain;
}

// ─── Suelo ───────────────────────────────────────────────────────────────────────────────────────

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function terrainGeometry(terrain: Terrain, look: SurfaceLook): { geometry: BufferGeometry; heights: Float32Array; n: number } {
  const n = gridSizeFor(terrain);
  const heights = terrainGrid(terrain, n);
  const half = terrain.halfSizeM;
  const step = (half * 2) / (n - 1);
  const pos = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      const x = -half + ix * step;
      const z = -half + iz * step;
      pos[i * 3] = x;
      pos[i * 3 + 1] = heights[i]!;
      pos[i * 3 + 2] = z;
      uv[i * 2] = x / 6;
      uv[i * 2 + 1] = z / 6;
    }
  }
  const index = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let iz = 0; iz < n - 1; iz++) {
    for (let ix = 0; ix < n - 1; ix++) {
      const a = iz * n + ix;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      index[k++] = a;
      index[k++] = c;
      index[k++] = b;
      index[k++] = b;
      index[k++] = c;
      index[k++] = d;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeVertexNormals();
  // Color por vértice: llano, alto y paredes empinadas; el fondo de los abismos, más oscuro.
  const normal = g.getAttribute('normal');
  const colors = new Float32Array(n * n * 3);
  const low = new Color(look.ground[0]);
  const high = new Color(look.ground[1]);
  const steep = new Color(look.ground[2]);
  const c = new Color();
  const amp = Math.max(1, terrain.style.amp);
  const seed = terrainSeed(terrain.input.seed, terrain.input.sectorIndex, terrain.input.nodeId);
  for (let i = 0; i < n * n; i++) {
    const h = pos[i * 3 + 1]!;
    const slope = 1 - normal.getY(i);
    const vary = valueNoise2(pos[i * 3]! / 9, pos[i * 3 + 2]! / 9, seed) * 0.25 - 0.12;
    c.copy(low).lerp(high, smoothstep(-amp * 0.3, amp * 1.1, h) * 0.8);
    // Las paredes empinadas, oscuras; el borde del área (pared de cráter), más claro para que se lea.
    const rim = smoothstep(terrain.input.radiusM - 2, terrain.input.radiusM + 12, Math.hypot(pos[i * 3]!, pos[i * 3 + 2]!));
    c.lerp(steep, smoothstep(0.18, 0.5, slope) * (1 - rim * 0.8));
    c.lerp(high, rim * 0.5);
    const dark = 1 - 0.5 * smoothstep(-2, -9, h);
    colors[i * 3] = c.r * (1 + vary) * dark;
    colors[i * 3 + 1] = c.g * (1 + vary) * dark;
    colors[i * 3 + 2] = c.b * (1 + vary) * dark;
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.computeBoundingSphere();
  return { geometry: g, heights, n };
}

function TerrainMesh({ terrain, look, physics }: { terrain: Terrain; look: SurfaceLook; physics: boolean }) {
  const uniforms = useMemo(terrainUniforms, []);
  const material = useMemo(() => {
    const maps = rockMaps();
    const m = new MeshStandardMaterial({ vertexColors: true, map: maps.albedo, normalMap: maps.normal, roughness: 0.95, metalness: 0.02 });
    m.normalScale.setScalar(0.7);
    patchTerrainMaterial(m, uniforms);
    return m;
  }, [uniforms]);
  const built = useMemo(() => terrainGeometry(terrain, look), [terrain, look]);
  useEffect(() => () => built.geometry.dispose(), [built]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    uniforms.uRadius.value = terrain.input.radiusM;
    uniforms.uPad.value.set(terrain.input.padX, terrain.input.padZ, 15);
    uniforms.uLavaOn.value = look.lava ? 1 : 0;
    if (look.lava) uniforms.uLava.value.set(look.lava);
  }, [terrain, look, uniforms]);
  // Estado de las zonas para el shader (crujir = brillo que late).
  useFrame(() => {
    const zones = getRun()?.state.surface?.zones ?? [];
    const count = Math.min(MAX_SHADER_ZONES, zones.length);
    uniforms.uZoneCount.value = count;
    for (let i = 0; i < count; i++) {
      const z = zones[i]!;
      uniforms.uZones.value[i]!.set(z.x, z.z, z.radiusM, z.collapsed ? -1 : Math.min(1, z.crackingS / 1.2));
    }
  });
  const outer = useMemo(() => {
    // Llanura más allá del borde modelado, a la altura del borde: desde el aire el mundo sigue hasta el horizonte.
    const h = terrain.halfSizeM;
    const rimY = Math.min(terrain.heightAt(h, 0), terrain.heightAt(0, h), terrain.heightAt(-h, 0), terrain.heightAt(0, -h)) - 0.6;
    // Mismo tono que el borde de la rejilla (media de sus vértices), para que no se note la costura.
    const col = built.geometry.getAttribute('color');
    const avg = new Color(0, 0, 0);
    for (let i = 0; i < built.n; i++) {
      const k = (built.n - 1) * built.n + i;
      avg.r += col.getX(k) / built.n;
      avg.g += col.getY(k) / built.n;
      avg.b += col.getZ(k) / built.n;
    }
    const tex = new Color(look.rock).multiplyScalar(0.75);
    const m = new MeshStandardMaterial({ color: avg.multiply(tex), roughness: 1, metalness: 0 });
    return { rimY, inner: h * 0.97, material: m };
  }, [terrain, look, built]);
  useEffect(() => () => outer.material.dispose(), [outer]);
  return (
    <>
      <mesh geometry={built.geometry} material={material} />
      <mesh position={[0, outer.rimY, 0]} rotation={[-Math.PI / 2, 0, 0]} material={outer.material}>
        <ringGeometry args={[outer.inner, 2400, 96, 1]} />
      </mesh>
      {physics && (
        <RigidBody key={`${terrain.input.nodeId}:${terrainKeyOf(terrain)}`} type="fixed" colliders={false}>
          <TrimeshCollider args={[built.geometry.getAttribute('position').array as Float32Array, built.geometry.getIndex()!.array as Uint32Array]} />
        </RigidBody>
      )}
    </>
  );
}

const terrainKeyOf = (t: Terrain): string => t.input.zones.map((z) => (z.collapsed ? 1 : 0)).join('');

// ─── Rocas ───────────────────────────────────────────────────────────────────────────────────────

const PEBBLES = 340;
const BOULDERS = 34;

interface Placed {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
  tone: number;
}

function placeRocks(terrain: Terrain, count: number, big: boolean, salt: number): Placed[] {
  const r = rng(mixSeed(terrainSeed(terrain.input.seed, terrain.input.sectorIndex, terrain.input.nodeId), salt));
  const out: Placed[] = [];
  const R = terrain.input.radiusM;
  for (let tries = 0; out.length < count && tries < count * 8; tries++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * (R + 22);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const s = big ? 1.1 + r() * r() * 2.6 : 0.12 + r() * r() * 0.55;
    const rot = r() * Math.PI * 2;
    const tone = 0.75 + r() * 0.4;
    if (Math.hypot(x - SHIP_CENTER.x, z - SHIP_CENTER.z) < PAD_RADIUS_M + (big ? 4 : 0)) continue;
    if (Math.hypot(x, z) < 4) continue;
    if (terrain.chasmAt(x, z) > 0.05) continue;
    if (terrain.input.deposits.some((p) => Math.hypot(p.x - x, p.z - z) < (big ? 5 : 2.2))) continue;
    if (terrain.input.zones.some((zn) => Math.hypot(zn.x - x, zn.z - z) < zn.radiusM + 1.5)) continue;
    out.push({ x, y: terrain.heightAt(x, z) - s * 0.25, z, s, rot, tone });
  }
  return out;
}

function Rocks({ terrain, look, physics }: { terrain: Terrain; look: SurfaceLook; physics: boolean }) {
  const pebbles = useRef<InstancedMesh>(null);
  const boulders = useRef<InstancedMesh>(null);
  const small = useMemo(() => placeRocks(terrain, PEBBLES, false, 11), [terrain]);
  const big = useMemo(() => placeRocks(terrain, BOULDERS, true, 23), [terrain]);
  useEffect(() => {
    const dummy = new Object3D();
    const base = new Color(look.rock);
    const c = new Color();
    for (const [mesh, list] of [[pebbles.current, small], [boulders.current, big]] as const) {
      if (!mesh) continue;
      list.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(p.rot * 0.3, p.rot, 0);
        dummy.scale.set(p.s * 1.1, p.s * 0.8, p.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, c.copy(base).multiplyScalar(p.tone * 1.3));
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [small, big, look]);
  return (
    <>
      <instancedMesh ref={pebbles} args={[pebbleGeometry(), rockMaterial(), PEBBLES]} dispose={null} />
      <instancedMesh ref={boulders} args={[rockGeometry(), rockMaterial(), BOULDERS]} dispose={null} />
      {physics && (
        <RigidBody type="fixed" colliders={false}>
          {big.map((p, i) => (
            <BallCollider key={i} args={[p.s * 0.8]} position={[p.x, p.y, p.z]} />
          ))}
        </RigidBody>
      )}
    </>
  );
}

// ─── Vetas ───────────────────────────────────────────────────────────────────────────────────────

/** Forma propia de cada material (no solo el color): bloques, terrones, prismas y cápsula. */
const depositGeometries = once(() => {
  const tmp = new MeshStandardMaterial();
  const take = (b: Builder) => b.build()[0]!.geometry;
  const ice = new Builder()
    .box(tmp, [0, 0.35, 0], [0.9, 0.8, 0.7], [0.1, 0.3, 0.05])
    .box(tmp, [0.55, 0.25, 0.3], [0.5, 0.55, 0.5], [0.2, 0.9, 0.15])
    .box(tmp, [-0.45, 0.2, 0.35], [0.45, 0.45, 0.6], [-0.1, 0.4, 0.2])
    .box(tmp, [0.1, 0.18, -0.55], [0.6, 0.4, 0.4], [0.05, 1.3, -0.1]);
  const ore = new Builder()
    .add(tmp, new IcosahedronGeometry(0.55, 1), [0, 0.3, 0], [0.4, 0, 0.2], [1.1, 0.75, 1])
    .add(tmp, new IcosahedronGeometry(0.4, 1), [0.6, 0.2, 0.25], [0.2, 0.7, 0], [1, 0.8, 1.1])
    .add(tmp, new IcosahedronGeometry(0.35, 1), [-0.5, 0.18, -0.3], [0, 1.1, 0.3], [1.1, 0.7, 0.9]);
  const crystal = new Builder();
  for (const [x, z, h, tx, tz] of [[0, 0, 1.6, 0, 0], [0.35, 0.15, 1.1, 0.35, 0.2], [-0.3, 0.2, 1.2, 0.1, -0.4], [0.05, -0.35, 0.9, -0.4, 0.1], [-0.2, -0.15, 0.7, -0.3, -0.3]] as const) {
    // Prisma hexagonal con punta, con la base en el origen para inclinarlo desde el suelo.
    const spike = new Builder()
      .add(tmp, new CylinderGeometry(0.16, 0.22, h, 6), [0, h / 2, 0])
      .add(tmp, new CylinderGeometry(0, 0.16, 0.35, 6), [0, h + 0.17, 0])
      .build()[0]!.geometry;
    crystal.add(tmp, spike, [x, 0, z], [tx, 0, tz]);
  }
  const sample = new Builder()
    .add(tmp, new SphereGeometry(0.5, 20, 14), [0, 0.3, 0], [0, 0, 0], [1, 0.85, 1])
    .add(tmp, new TorusGeometry(0.52, 0.05, 8, 28), [0, 0.35, 0], [Math.PI / 2, 0, 0])
    .add(tmp, new TorusGeometry(0.46, 0.04, 8, 28), [0, 0.35, 0], [0.3, 0, Math.PI / 2])
    .add(tmp, new CylinderGeometry(0.03, 0.03, 0.9, 6), [0, 0.9, 0]);
  return { ice: take(ice), ore: take(ore), crystal: take(crystal), sample: take(sample) } as Record<string, BufferGeometry>;
});

const depositMaterials = once(() => {
  const out: Record<string, Material> = {};
  for (const [id, l] of Object.entries(DEPOSIT_LOOKS)) {
    out[id] = new MeshStandardMaterial({
      color: l.color,
      emissive: l.emissive,
      emissiveIntensity: id === 'crystal' || id === 'sample' ? 1.6 : 0.5,
      roughness: id === 'ore' ? 0.45 : id === 'ice' ? 0.12 : 0.25,
      metalness: id === 'ore' ? 0.75 : 0.1,
      flatShading: id !== 'sample',
      transparent: id === 'ice',
      opacity: id === 'ice' ? 0.88 : 1,
    });
  }
  return out;
});

const MATERIAL_IDS = Object.keys(DEPOSIT_LOOKS);

/** Escala visible de una veta según lo que queda (desaparece al agotarse). */
export function depositScale(units: number, initialUnits: number): number {
  if (units <= 0 || initialUnits <= 0) return 0;
  return 0.45 + 0.55 * Math.min(1, units / initialUnits);
}

function Deposits({ terrain, onCollectFx }: { terrain: Terrain; onCollectFx: (d: Deposit | null) => void }) {
  const meshes = useRef<Record<string, InstancedMesh | null>>({});
  const glows = useRef<(Sprite | null)[]>([]);
  const beams = useRef<(import('three').Mesh | null)[]>([]);
  const dummy = useMemo(() => new Object3D(), []);
  // La lista de vetas no cambia durante la estancia (solo sus unidades): se toma al montar.
  const deposits = useMemo(() => getRun()?.state.surface?.deposits.map((d) => ({ ...d })) ?? [], [terrain.input.nodeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const initial = useMemo(() => new Map(deposits.map((d) => [d.id, d.units])), [deposits]);
  const slots = useMemo(() => {
    const byMat: Record<string, Deposit[]> = {};
    for (const d of deposits) (byMat[d.materialId] ??= []).push(d);
    return byMat;
  }, [deposits]);
  const lastProgress = useRef(new Map<number, number>());
  const beamMats = useMemo(() => beamMaterial(DEPOSIT_LOOKS.sample!.glow!, 0.45), []);
  useFrame((state) => {
    const live = getRun()?.state.surface?.deposits;
    if (!live) return;
    const t = state.clock.elapsedTime;
    let working: Deposit | null = null;
    for (const id of MATERIAL_IDS) {
      const mesh = meshes.current[id];
      const list = slots[id];
      if (!mesh || !list) continue;
      list.forEach((d0, i) => {
        const d = live.find((x) => x.id === d0.id) ?? d0;
        const prev = lastProgress.current.get(d.id) ?? 0;
        const busy = d.progress !== prev && d.units > 0;
        if (busy) working = d;
        lastProgress.current.set(d.id, d.progress);
        const s = depositScale(d.units, initial.get(d.id) ?? d.units);
        const jitter = busy ? Math.sin(t * 60 + i) * 0.03 : 0;
        dummy.position.set(d.x + jitter, terrain.heightAt(d.x, d.z) - 0.05, d.z);
        dummy.rotation.set(0, (d.id * 2.399) % (Math.PI * 2), 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    deposits.forEach((d0, i) => {
      const d = live.find((x) => x.id === d0.id) ?? d0;
      const on = d.units > 0;
      const g = glows.current[i];
      if (g) {
        g.visible = on;
        g.position.set(d.x, terrain.heightAt(d.x, d.z) + 1, d.z);
        g.material.opacity = 0.55 + Math.sin(t * 2 + i) * 0.15;
      }
      const b = beams.current[i];
      if (b) {
        // Filón (vetas raras agrupadas, `lodeId`): un único haz por filón, en la primera veta que quede.
        const lead = d.lodeId === undefined || !live.some((o, k) => o.lodeId === d.lodeId && o.units > 0 && k < live.findIndex((x) => x.id === d.id));
        b.visible = on && lead;
        b.position.set(d.x, terrain.heightAt(d.x, d.z) + 15, d.z);
      }
    });
    onCollectFx(working);
  });
  return (
    <>
      {MATERIAL_IDS.map((id) =>
        slots[id] ? (
          <instancedMesh
            key={id}
            ref={(m) => void (meshes.current[id] = m)}
            args={[depositGeometries()[id], depositMaterials()[id], slots[id].length]}
            frustumCulled={false}
            dispose={null}
          />
        ) : null,
      )}
      {deposits.map((d, i) => {
        const look = DEPOSIT_LOOKS[d.materialId];
        return (
          <group key={d.id}>
            {look?.glow && (
              <sprite ref={(s) => void (glows.current[i] = s)} scale={glowScale(d)}>
                <spriteMaterial map={glowTexture()} color={look.glow} transparent blending={AdditiveBlending} depthWrite={false} toneMapped={false} fog={false} />
              </sprite>
            )}
            {look?.beam && (
              <mesh ref={(m) => void (beams.current[i] = m)} material={beamMats.material}>
                <cylinderGeometry args={[0.18, 0.4, 30, 8, 1, true]} />
              </mesh>
            )}
          </group>
        );
      })}
    </>
  );
}

/** Halo de una veta rara: más pequeño si va en filón (varias a pocos metros no se funden en una mancha). */
function glowScale(d: Deposit): [number, number, number] {
  const base = d.materialId === 'sample' ? 4 : 3.2;
  const k = d.lodeId === undefined ? 1 : 0.6;
  return [base * k, base * k, 1];
}

/** Chispas en la veta que se está arrancando. */
function CollectSparks({ terrain, target }: { terrain: Terrain; target: { current: Deposit | null } }) {
  const ref = useRef<Points>(null);
  const geom = useMemo(() => seedGeometry(30, 77), []);
  useEffect(() => () => geom.dispose(), [geom]);
  useFrame(() => {
    const p = ref.current;
    if (!p) return;
    const d = target.current;
    p.visible = !!d;
    if (d) p.position.set(d.x, terrain.heightAt(d.x, d.z) - 0.9, d.z);
  });
  return <points ref={ref} geometry={geom} material={sparkMaterial()} frustumCulled={false} visible={false} />;
}

// ─── Terreno inestable: polvo y crujido ──────────────────────────────────────────────────────────

function ZoneDust({ terrain, look }: { terrain: Terrain; look: SurfaceLook }) {
  const zones = terrain.input.zones;
  const dusts = useMemo(() => zones.map(() => dustMaterial(look.dust)), [zones.length, look]); // eslint-disable-line react-hooks/exhaustive-deps
  const geom = useMemo(() => seedGeometry(40, 19), []);
  const burst = useRef<number[]>([]);
  const wasCollapsed = useRef<boolean[]>([]);
  useEffect(() => () => {
    geom.dispose();
    for (const d of dusts) d.material.dispose();
  }, [geom, dusts]);
  useFrame((_, dt) => {
    const live = getRun()?.state.surface?.zones ?? [];
    dusts.forEach((d, i) => {
      const z = live[i];
      if (!z) return;
      if (z.collapsed && !wasCollapsed.current[i]) burst.current[i] = 1;
      wasCollapsed.current[i] = z.collapsed;
      burst.current[i] = Math.max(0, (burst.current[i] ?? 0) - dt / 4);
      const target = z.crackingS > 0 ? 0.6 + z.crackingS : burst.current[i]! * 1.6;
      d.u.uStrength.value += (target - d.u.uStrength.value) * Math.min(1, dt * 6);
      d.u.uRadius.value = z.radiusM * 0.7;
    });
  });
  return (
    <>
      {zones.map((z, i) => (
        <points key={i} position={[z.x, terrain.heightAt(z.x, z.z) + (z.collapsed ? 0 : 0.1), z.z]} geometry={geom} material={dusts[i]!.material} frustumCulled={false} />
      ))}
    </>
  );
}

// ─── Cielo, luz, niebla y tormenta ───────────────────────────────────────────────────────────────

const STORM_PARTICLES = 1400;

function SkyAndWeather({ look, warnS, windAngle, interior }: { look: SurfaceLook; warnS: number; windAngle: number; interior: boolean }) {
  const scene = useThree((s) => s.scene);
  const sky = useMemo(() => skyDomeMaterial(look), [look]);
  const storm = useMemo(() => stormMaterial(look.storm), [look]);
  const stormGeom = useMemo(() => seedGeometry(STORM_PARTICLES, 41), []);
  const fog = useMemo(() => new Fog(look.fog, look.fogNearM, look.fogFarM), [look]);
  const fogBase = useMemo(() => new Color(look.fog), [look]);
  const fogStorm = useMemo(() => new Color(look.storm).multiplyScalar(0.6), [look]);
  const level = useRef(0);
  const particles = useRef<Points>(null);
  useEffect(() => {
    // Desde dentro de la nave no hay niebla: velaría el propio interior.
    if (interior) return;
    const prev = scene.fog;
    scene.fog = fog;
    return () => {
      scene.fog = prev;
    };
  }, [scene, fog, interior]);
  useEffect(
    () => () => {
      sky.material.dispose();
      storm.material.dispose();
      stormGeom.dispose();
    },
    [sky, storm, stormGeom],
  );
  useFrame(({ camera }, dt) => {
    const st = stormLevel(getRun()?.state.surface?.storm, warnS);
    // Aviso: el horizonte se oscurece; activa: se cierra la visibilidad.
    const want = st.active > 0 ? 0.55 + st.active * 0.45 : st.warn * 0.45;
    level.current += (want - level.current) * Math.min(1, dt * 0.8);
    const k = level.current;
    sky.u.uStorm.value = k;
    // Desde el aire (descenso) la niebla se aleja con la altura: el suelo se ve venir.
    const lift = Math.max(0, camera.position.y - 20);
    fog.near = look.fogNearM * (1 - k * 0.85) + lift;
    fog.far = look.fogFarM * (1 - k * 0.72) + lift * 1.6;
    fog.color.copy(fogBase).lerp(fogStorm, k);
    storm.u.uIntensity.value = st.active > 0 ? st.active : st.warn * 0.15;
    storm.u.uCam.value.copy(camera.position);
    particles.current?.parent?.worldToLocal(storm.u.uCam.value);
    storm.u.uWind.value.set(Math.cos(windAngle), Math.sin(windAngle));
  });
  const sunAt: [number, number, number] = [look.sunDir[0] * 12, look.sunDir[1] * 12, look.sunDir[2] * 12];
  return (
    <>
      {/* Reflejos: el cielo y el sol del mundo horneados una vez a un cubemap (el traje y la nave no se ven negros). */}
      {!interior && (
        <Environment resolution={64} frames={1} environmentIntensity={0.7}>
          <color attach="background" args={[look.hemiSky]} />
          <Lightformer form="circle" intensity={4} color={look.sun} position={sunAt} scale={4} target={[0, 0, 0]} />
          <Lightformer form="rect" intensity={0.8} color={look.ground[1]} position={[0, -8, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[40, 40, 1]} />
        </Environment>
      )}
      <mesh material={sky.material} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[900, 32, 16]} />
      </mesh>
      {look.stars && <Stars radius={420} depth={60} count={2600} factor={6} saturation={0.2} fade speed={0.2} />}
      <hemisphereLight args={[look.hemiSky, look.hemiGround, look.hemiIntensity]} />
      <directionalLight position={[look.sunDir[0] * 100, look.sunDir[1] * 100, look.sunDir[2] * 100]} intensity={look.sunIntensity} color={look.sun} />
      {/* Relleno frío desde el lado contrario al sol (sin sombras ni coste por frame): el relieve se lee también a contraluz. */}
      {(look.fillIntensity ?? 0) > 0 && <directionalLight position={[-look.sunDir[0] * 100, 60, -look.sunDir[2] * 100]} intensity={look.fillIntensity} color={look.hemiSky} />}
      {!interior && <points ref={particles} geometry={stormGeom} material={storm.material} frustumCulled={false} />}
    </>
  );
}

/** Dirección del viento de las tormentas en un mundo (determinista). */
export function windAngleOf(terrain: Terrain): number {
  return (terrainSeed(terrain.input.seed, terrain.input.sectorIndex, terrain.input.nodeId) % 6283) / 1000;
}

/**
 * La superficie del destino: suelo, rocas, vetas, terreno inestable, cielo y tiempo. La pintan la escena
 * de superficie (con colisiones) y la vista desde la nave posada (sin ellas, desplazada).
 */
export function SurfaceWorld({ physics = false, interior = false }: { physics?: boolean; interior?: boolean }) {
  const terrain = useLiveTerrain();
  const worldId = terrain?.input.worldId ?? '';
  const look = useMemo(() => surfaceLook(worldId), [worldId]);
  const working = useRef<Deposit | null>(null);
  const onCollectFx = useMemo(() => (d: Deposit | null) => void (working.current = d), []);
  if (!terrain) return null;
  const world = getWorld(worldId);
  return (
    <group>
      <SkyAndWeather look={look} warnS={world.storms?.warnS ?? 0} windAngle={windAngleOf(terrain)} interior={interior} />
      <TerrainMesh terrain={terrain} look={look} physics={physics} />
      <Rocks terrain={terrain} look={look} physics={physics} />
      <Deposits terrain={terrain} onCollectFx={onCollectFx} />
      <CollectSparks terrain={terrain} target={working} />
      <ZoneDust terrain={terrain} look={look} />
    </group>
  );
}
