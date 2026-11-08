import { BufferAttribute, Color, IcosahedronGeometry, Vector3 } from 'three';

// Ruido de valor 3D determinista (sin texturas externas).
function hash(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u), v),
    l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}
function fbm(p: Vector3): number {
  let a = 0.5, f = 1.6, sum = 0;
  for (let i = 0; i < 5; i++) {
    sum += a * vnoise(p.x * f + 11, p.y * f + 7, p.z * f + 3);
    a *= 0.5;
    f *= 2.1;
  }
  return sum;
}

const OCEAN_DEEP = new Color('#0b2a66');
const OCEAN_SHALLOW = new Color('#1f6fb2');
const GREEN = new Color('#3f7d3a');
const TAN = new Color('#a58f5c');
const ICE = new Color('#f2f6fa');

/** Esfera con colores por vértice (océanos, continentes, hielo polar) generados con ruido fractal. */
export function buildEarthGeometry(radius: number): IcosahedronGeometry {
  const geo = new IcosahedronGeometry(radius, 30);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const normals = new Float32Array(pos.count * 3);
  const v = new Vector3();
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    normals.set([v.x, v.y, v.z], i * 3);
    const n = fbm(v.clone().multiplyScalar(1.4));
    const lat = Math.abs(v.y);
    if (lat > 0.88 + (n - 0.5) * 0.1) c.copy(ICE);
    else if (n > 0.52) c.copy(GREEN).lerp(TAN, Math.min(1, Math.max(0, (n - 0.52) * 4 + (0.5 - lat) * -0.3)));
    else c.copy(OCEAN_DEEP).lerp(OCEAN_SHALLOW, Math.min(1, Math.max(0, (n - 0.38) * 7)));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.setAttribute('normal', new BufferAttribute(normals, 3));
  return geo;
}
