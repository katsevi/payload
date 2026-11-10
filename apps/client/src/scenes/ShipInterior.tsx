import { useMemo } from 'react';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { ExtrudeGeometry, MeshBasicMaterial, PlaneGeometry, Shape, Vector2, type BufferGeometry } from 'three';
import { BULKHEADS_Z, BULKHEAD_THICKNESS, DOOR_HALF_WIDTH, HULL, STATIONS, STATION_IDS } from '../game/layout';
import { Builder, Parts, TILE, once, type Part } from '../gfx/build';
import { mats } from '../gfx/materials';
import { floorShadowTexture } from '../gfx/textures';

const W = HULL.halfWidth;
const H = HULL.height;
const LEN = HULL.maxZ - HULL.minZ;
const MID_Z = (HULL.maxZ + HULL.minZ) / 2;
/** Franja de ventanas: de esta altura a la siguiente el casco está abierto al espacio. */
const SILL = 1.15;
const LINTEL = 2.7;
const DOOR_H = 2.6;
/** Separación entre cuadernas (los montantes de las ventanas continúan como vigas del techo). */
const RIB_SPACING = 3.25;
/** Proa: mirador de tres caras que sobresale del casco (la colisión sigue siendo el plano z = minZ). */
const BOW_Z = HULL.minZ - 1.7;
const BOW_HALF = 2.3;
const BOW_SILL = 0.95;
const BOW_LINTEL = 3.05;
const DECK_TILE = 1 / 1.5;

/** Losa horizontal con planta poligonal (puntos [x, z]) entre dos alturas. */
function slab(points: [number, number][], y0: number, y1: number): BufferGeometry {
  const g = new ExtrudeGeometry(new Shape(points.map(([x, z]) => new Vector2(x, -z))), { depth: y1 - y0, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * TILE, uv.getY(i) * TILE);
  return g;
}

const ribsZ = (): number[] => {
  const out: number[] = [];
  for (let z = HULL.minZ; z <= HULL.maxZ + 0.01; z += RIB_SPACING) out.push(z);
  return out;
};

/** Las tres caras del mirador de proa: [x1, z1, x2, z2]. */
const BOW_FACETS: [number, number, number, number][] = [
  [-W, HULL.minZ, -BOW_HALF, BOW_Z],
  [-BOW_HALF, BOW_Z, BOW_HALF, BOW_Z],
  [BOW_HALF, BOW_Z, W, HULL.minZ],
];

const buildHull = once((): { solid: Part[]; glass: Part[] } => {
  const m = mats();
  const b = new Builder();
  const ribs = ribsZ();

  // ── Cubierta ──
  b.box(m.deck, [0, -0.25, MID_Z], [W * 2, 0.5, LEN], undefined, DECK_TILE);
  b.box(m.deckDark, [0, 0.003, MID_Z], [2.6, 0.006, LEN - 0.3], undefined, DECK_TILE);
  for (const side of [-1, 1]) {
    b.box(m.steel, [side * 1.33, 0.005, MID_Z], [0.06, 0.01, LEN - 0.3]);
    // Guía luminosa encastrada junto a cada costado.
    b.box(m.dark, [side * (W - 0.35), 0.004, MID_Z], [0.22, 0.008, LEN - 0.5]);
    b.box(m.guide, [side * (W - 0.35), 0.006, MID_Z], [0.07, 0.012, LEN - 0.6]);
  }

  // ── Techo ──
  b.box(m.ceiling, [0, H + 0.15, MID_Z], [W * 2 + 0.6, 0.3, LEN]);
  for (const z of ribs) b.box(m.wallDark, [0, H - 0.08, z], [W * 2, 0.16, 0.3]);
  for (const side of [-1, 1]) {
    b.box(m.steel, [side * 2.6, H - 0.05, MID_Z], [0.16, 0.1, LEN]);
    b.pipe(side < 0 ? m.orange : m.steel, [side * 3.4, H - 0.2, HULL.minZ], [side * 3.4, H - 0.2, HULL.maxZ], 0.06);
    b.pipe(m.steel, [side * 3.62, H - 0.21, HULL.minZ], [side * 3.62, H - 0.21, HULL.maxZ], 0.035);
  }

  // ── Costados: zócalo, dintel, moldura del techo, cuadernas y tuberías de servicio ──
  for (const side of [-1, 1]) {
    const x = side * (W + 0.15);
    b.box(m.wall, [x, SILL / 2, MID_Z], [0.3, SILL, LEN]);
    b.box(m.wall, [x, (H + LINTEL) / 2, MID_Z], [0.3, H - LINTEL, LEN]);
    b.box(m.dark, [side * (W - 0.03), 0.09, MID_Z], [0.06, 0.18, LEN]);
    b.box(m.trim, [side * (W + 0.04), SILL + 0.03, MID_Z], [0.46, 0.06, LEN]);
    b.box(m.trim, [side * (W + 0.06), LINTEL - 0.03, MID_Z], [0.36, 0.06, LEN]);
    // Moldura a 45° entre pared y techo, con una línea de luz debajo.
    b.box(m.wallDark, [side * (W - 0.21), H - 0.21, MID_Z], [0.62, 0.04, LEN], [0, 0, -side * (Math.PI / 4)]);
    b.box(m.guide, [side * (W - 0.012), H - 0.5, MID_Z], [0.024, 0.03, LEN - 0.4]);
    b.pipe(m.orange, [side * (W - 0.08), 0.66, HULL.minZ], [side * (W - 0.08), 0.66, HULL.maxZ], 0.045);
    b.pipe(m.steel, [side * (W - 0.06), 0.5, HULL.minZ], [side * (W - 0.06), 0.5, HULL.maxZ], 0.03);
    for (const z of ribs) {
      b.box(m.wallDark, [side * (W + 0.03), H / 2, z], [0.42, H, 0.34]);
      b.box(m.steel, [side * (W - 0.19), H / 2, z], [0.03, H - 0.3, 0.12]);
      // Cartela al pie de la cuaderna.
      b.box(m.wallDark, [side * (W - 0.24), 0.16, z], [0.3, 0.05, 0.34], [0, 0, side * (Math.PI / 4)]);
    }
  }

  // ── Proa: repisa de instrumentos, techo del mirador y marcos del cristal ──
  const footprint: [number, number][] = [
    [-W - 0.3, HULL.minZ],
    [-BOW_HALF - 0.12, BOW_Z - 0.3],
    [BOW_HALF + 0.12, BOW_Z - 0.3],
    [W + 0.3, HULL.minZ],
  ];
  b.add(m.wallDark, slab(footprint, 0, BOW_SILL));
  b.add(m.dark, slab(footprint, BOW_SILL, BOW_SILL + 0.02));
  b.add(m.ceiling, slab(footprint, BOW_LINTEL, H + 0.3));
  b.box(m.trim, [0, BOW_SILL + 0.03, HULL.minZ + 0.02], [W * 2, 0.06, 0.1]);
  b.box(m.guide, [0, BOW_SILL + 0.035, HULL.minZ - 0.16], [W * 2 - 1.2, 0.012, 0.03]);
  b.box(m.dark, [0, 0.09, HULL.minZ + 0.03], [W * 2, 0.18, 0.06]);
  for (const [x1, z1, x2, z2] of BOW_FACETS) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const yaw = Math.atan2(-(z2 - z1), x2 - x1);
    const mid: [number, number] = [(x1 + x2) / 2, (z1 + z2) / 2];
    b.box(m.steel, [mid[0], BOW_SILL + 0.06, mid[1]], [len, 0.1, 0.14], [0, yaw, 0]);
    b.box(m.steel, [mid[0], BOW_LINTEL - 0.05, mid[1]], [len, 0.1, 0.14], [0, yaw, 0]);
  }
  for (const side of [-1, 1]) b.box(m.steel, [side * BOW_HALF, (BOW_SILL + BOW_LINTEL) / 2, BOW_Z], [0.16, BOW_LINTEL - BOW_SILL, 0.16], [0, side * 0.5, 0]);

  // ── Popa ──
  b.box(m.wallDark, [0, H / 2, HULL.maxZ + 0.15], [W * 2 + 0.6, H, 0.3]);

  // ── Mamparos con puerta central ──
  const doorSide = (W - DOOR_HALF_WIDTH) / 2 + DOOR_HALF_WIDTH;
  const T = BULKHEAD_THICKNESS;
  for (const z of BULKHEADS_Z) {
    b.box(m.wallDark, [0, (H + DOOR_H) / 2, z], [DOOR_HALF_WIDTH * 2, H - DOOR_H, T]);
    b.box(m.hazard, [0, DOOR_H + 0.21, z], [DOOR_HALF_WIDTH * 2 - 0.5, 0.1, T + 0.04], undefined, 3);
    b.box(m.machineDark, [0, DOOR_H + 0.07, z], [DOOR_HALF_WIDTH * 2 + 0.4, 0.14, T + 0.2]);
    b.box(m.steel, [0, 0.008, z], [DOOR_HALF_WIDTH * 2, 0.016, T + 0.2]);
    for (const side of [-1, 1]) {
      b.box(m.wallDark, [side * doorSide, H / 2, z], [W - DOOR_HALF_WIDTH, H, T]);
      // Marco de la puerta: jamba, cartela a 45° y tira de luz en cada cara.
      b.box(m.machineDark, [side * (DOOR_HALF_WIDTH + 0.1), DOOR_H / 2, z], [0.2, DOOR_H, T + 0.2]);
      b.box(m.machineDark, [side * (DOOR_HALF_WIDTH - 0.13), DOOR_H - 0.13, z], [0.42, 0.1, T + 0.2], [0, 0, side * (Math.PI / 4)]);
      for (const face of [-1, 1]) b.box(m.guide, [side * (DOOR_HALF_WIDTH + 0.1), 1.25, z + face * (T / 2 + 0.103)], [0.05, 2.1, 0.012]);
      // Refuerzos del mamparo.
      b.box(m.steel, [side * (doorSide + 0.1), SILL + 0.03, z], [W - DOOR_HALF_WIDTH - 0.2, 0.06, T + 0.08]);
      b.box(m.dark, [side * (doorSide + 0.1), 0.09, z], [W - DOOR_HALF_WIDTH - 0.2, 0.18, T + 0.06]);
      b.box(m.steel, [side * (doorSide + 0.1), (H + SILL) / 2, z], [0.22, H - SILL, T + 0.1]);
    }
  }

  // ── Cristales: costados y mirador de proa ──
  const g = new Builder();
  for (const side of [-1, 1]) g.add(m.glass, new PlaneGeometry(LEN, LINTEL - SILL), [side * (W + 0.12), (SILL + LINTEL) / 2, MID_Z], [0, Math.PI / 2, 0]);
  for (const [x1, z1, x2, z2] of BOW_FACETS) {
    g.add(m.glass, new PlaneGeometry(Math.hypot(x2 - x1, z2 - z1), BOW_LINTEL - BOW_SILL), [(x1 + x2) / 2, (BOW_SILL + BOW_LINTEL) / 2, (z1 + z2) / 2], [0, Math.atan2(-(z2 - z1), x2 - x1), 0]);
  }
  return { solid: b.build(), glass: g.build() };
});

/** Sombras de contacto pintadas en el suelo: al pie de las paredes, de los mamparos y de cada puesto. */
const shadowMaterial = once(() => {
  const map = floorShadowTexture(W * 2, LEN, (ctx) => {
    const band = (x: number, y: number, w: number, h: number, x0: number, y0: number, x1: number, y1: number, alpha: number) => {
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, `rgba(0,0,0,${alpha})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
    };
    const reach = 1.3;
    band(0, 0, reach, LEN, 0, 0, reach, 0, 0.6);
    band(W * 2 - reach, 0, reach, LEN, W * 2, 0, W * 2 - reach, 0, 0.6);
    band(0, 0, W * 2, reach, 0, 0, 0, reach, 0.6);
    band(0, LEN - reach, W * 2, reach, 0, LEN, 0, LEN - reach, 0.6);
    for (const bz of BULKHEADS_Z) {
      const y = bz - HULL.minZ;
      for (const [x, w] of [[0, W - DOOR_HALF_WIDTH], [W + DOOR_HALF_WIDTH, W - DOOR_HALF_WIDTH]] as const) {
        band(x, y - 1, w, 1, 0, y, 0, y - 1, 0.55);
        band(x, y, w, 1, 0, y, 0, y + 1, 0.55);
      }
    }
    for (const id of STATION_IDS) {
      const s = STATIONS[id];
      const cx = s.x + W;
      const cy = s.z - HULL.minZ;
      const r = id === 'engines' ? 3.4 : id === 'power' ? 1.3 : 1.9;
      const grad = ctx.createRadialGradient(cx, cy, 0.2, cx, cy, r);
      grad.addColorStop(0, 'rgba(0,0,0,0.5)');
      grad.addColorStop(0.45, 'rgba(0,0,0,0.22)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  });
  return new MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
});

/**
 * Casco: cubierta, techo con vigas y conductos, costados con ventanas entre cuadernas, mirador de
 * proa, popa y mamparos con puerta. Las colisiones son las mismas cajas simples de siempre: la
 * geometría que se ve es solo decoración fusionada por material.
 */
export function Hull() {
  const { solid, glass } = useMemo(buildHull, []);
  const doorSide = (W - DOOR_HALF_WIDTH) / 2 + DOOR_HALF_WIDTH;
  return (
    <RigidBody type="fixed" colliders={false}>
      <Parts parts={solid} />
      <group renderOrder={-1}>
        {glass.map((p, i) => (
          <mesh key={i} geometry={p.geometry} material={p.material} renderOrder={-1} dispose={null} />
        ))}
      </group>
      <mesh position={[0, 0.02, MID_Z]} rotation={[-Math.PI / 2, 0, 0]} material={shadowMaterial()} dispose={null}>
        <planeGeometry args={[W * 2, LEN]} />
      </mesh>

      {/* Colisiones: suelo, costados, proa, popa y mamparos. */}
      <CuboidCollider args={[W, 0.25, LEN / 2]} position={[0, -0.25, MID_Z]} />
      {[-1, 1].map((side) => (
        <CuboidCollider key={side} args={[0.15, H / 2, LEN / 2]} position={[side * (W + 0.15), H / 2, MID_Z]} />
      ))}
      <CuboidCollider args={[W, H / 2, 0.15]} position={[0, H / 2, HULL.minZ - 0.15]} />
      <CuboidCollider args={[W + 0.3, H / 2, 0.15]} position={[0, H / 2, HULL.maxZ + 0.15]} />
      {BULKHEADS_Z.map((z) =>
        [-1, 1].map((side) => (
          <CuboidCollider key={`${z}:${side}`} args={[(W - DOOR_HALF_WIDTH) / 2, H / 2, BULKHEAD_THICKNESS / 2]} position={[side * doorSide, H / 2, z]} />
        )),
      )}
    </RigidBody>
  );
}
