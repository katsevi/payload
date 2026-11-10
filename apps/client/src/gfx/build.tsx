/**
 * Modelado procedural: se describen las piezas (cajas, cilindros, perfiles de torno…) y se fusionan
 * en UNA malla por material. Un puesto con cien piezas acaba en tres o cuatro llamadas de dibujo.
 *
 * Las piezas estáticas se construyen una vez por sesión (`once`) y se pintan con `<Parts>`.
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Euler,
  LatheGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type V3 = [number, number, number];

export interface Part {
  geometry: BufferGeometry;
  material: Material;
}

/** Baldosas de textura por metro (una baldosa de panel = 2 m). */
export const TILE = 0.5;

const m4 = new Matrix4();
const quat = new Quaternion();
const euler = new Euler();
const pos3 = new Vector3();
const scl3 = new Vector3();

/** Reescala las UV de una caja para que la textura tenga la misma densidad en todas sus caras. */
function tileBoxUv(g: BoxGeometry, [w, h, d]: V3, density: number): void {
  const uv = g.getAttribute('uv');
  // Orden de caras de BoxGeometry: +x, −x, +y, −y, +z, −z (4 vértices por cara).
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face++) {
    const [su, sv] = dims[face] ?? [1, 1];
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      uv.setXY(i, uv.getX(i) * su * density, uv.getY(i) * sv * density);
    }
  }
}

function scaleUv(g: BufferGeometry, su: number, sv: number): void {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

export class Builder {
  private readonly buckets = new Map<Material, BufferGeometry[]>();

  /** Añade una geometría cualquiera (se queda con posición, normal y UV). */
  add(material: Material, geometry: BufferGeometry, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 | number = 1): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (typeof scale === 'number') scl3.setScalar(scale);
    else scl3.set(scale[0], scale[1], scale[2]);
    m4.compose(pos3.set(pos[0], pos[1], pos[2]), quat.setFromEuler(euler.set(rot[0], rot[1], rot[2])), scl3);
    g.applyMatrix4(m4);
    const list = this.buckets.get(material);
    if (list) list.push(g);
    else this.buckets.set(material, [g]);
    return this;
  }

  box(material: Material, pos: V3, size: V3, rot?: V3, density = TILE): this {
    const g = new BoxGeometry(size[0], size[1], size[2]);
    tileBoxUv(g, size, density);
    return this.add(material, g, pos, rot);
  }

  /** Cilindro (eje Y salvo que se gire). `open` quita las tapas. */
  cyl(material: Material, pos: V3, rTop: number, rBottom: number, height: number, opts: { seg?: number; rot?: V3; open?: boolean; density?: number } = {}): this {
    const g = new CylinderGeometry(rTop, rBottom, height, opts.seg ?? 20, 1, opts.open ?? false);
    const density = opts.density ?? TILE;
    scaleUv(g, Math.max(1, Math.round(2 * Math.PI * Math.max(rTop, rBottom) * density)), Math.max(0.25, height * density));
    return this.add(material, g, pos, opts.rot);
  }

  /** Tubo entre dos puntos. */
  pipe(material: Material, from: V3, to: V3, radius: number, seg = 10): this {
    const a = new Vector3(from[0], from[1], from[2]);
    const b = new Vector3(to[0], to[1], to[2]);
    const len = a.distanceTo(b);
    const g = new CylinderGeometry(radius, radius, len, seg, 1, false);
    scaleUv(g, 1, Math.max(0.25, len * TILE));
    quat.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyQuaternion(quat);
    const mid = a.add(b).multiplyScalar(0.5);
    return this.add(material, g, [mid.x, mid.y, mid.z]);
  }

  /** Toro en el plano XY (eje Z). `uv` = repeticiones de textura [a lo largo del anillo, alrededor del tubo]. */
  torus(material: Material, pos: V3, radius: number, tube: number, opts: { rot?: V3; arc?: number; seg?: number; tubeSeg?: number; uv?: [number, number] } = {}): this {
    const g = new TorusGeometry(radius, tube, opts.tubeSeg ?? 8, opts.seg ?? 28, opts.arc ?? Math.PI * 2);
    if (opts.uv) scaleUv(g, opts.uv[0], opts.uv[1]);
    return this.add(material, g, pos, opts.rot);
  }

  sphere(material: Material, pos: V3, radius: number, scale: V3 | number = 1, seg = 16): this {
    return this.add(material, new SphereGeometry(radius, seg, Math.max(8, Math.round(seg * 0.7))), pos, [0, 0, 0], scale);
  }

  /** Sólido de revolución a partir de un perfil [radio, altura] de abajo arriba. */
  lathe(material: Material, profile: [number, number][], pos: V3 = [0, 0, 0], opts: { seg?: number; rot?: V3 } = {}): this {
    const g = new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), opts.seg ?? 28);
    const maxR = profile.reduce((mx, [r]) => Math.max(mx, r), 0);
    const height = Math.abs((profile[profile.length - 1]?.[1] ?? 0) - (profile[0]?.[1] ?? 0));
    scaleUv(g, Math.max(1, Math.round(2 * Math.PI * maxR * TILE)), Math.max(0.25, height * TILE));
    return this.add(material, g, pos, opts.rot);
  }

  build(): Part[] {
    const parts: Part[] = [];
    for (const [material, list] of this.buckets) {
      const geometry = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (geometry) parts.push({ geometry, material });
    }
    this.buckets.clear();
    return parts;
  }
}

/** Memoriza una construcción para toda la sesión (los modelos son estáticos). */
export function once<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

/**
 * Pinta las mallas de un modelo procedural. `dispose={null}`: la geometría y los materiales son
 * compartidos y sobreviven a la escena (R3F no debe liberarlos al desmontar).
 */
export function Parts({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.geometry} material={p.material} dispose={null} />
      ))}
    </>
  );
}
