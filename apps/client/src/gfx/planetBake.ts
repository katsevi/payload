/**
 * Horneado de la superficie de los planetas del mapa solar (PURO: sin Three.js ni DOM; corre en un Web Worker).
 *
 * Es el mismo algoritmo que el fragment shader de `planetMaterial` (`spaceShaders.ts`), portado a TS y evaluado una
 * vez por texel de un mapa equirrectangular con el reparto de UV de `SphereGeometry`. El mapa solar pinta después
 * esas texturas con un shader ligero (`mapPlanetMaterial`): antes compilaba el shader procedural completo en su propio
 * contexto WebGL y la escena se congelaba ~2 s al abrirlo (medido en una Iris Xe; el enlace del programa era el 90 %).
 *
 * Salida (RGBA8, fila 0 = polo sur, como lee `DataTexture` sin `flipY`):
 * - `albedo`: color en sRGB; alfa = brillo especular (océanos, hielo) o, en lava, la fase del latido de las grietas.
 * - `normal`: normal en espacio de objeto (×0,5 + 0,5); alfa = nubes (terrestre) o intensidad de las grietas (lava).
 *
 * `snoise` es de «webgl-noise» (Copyright (C) 2011 Ashima Arts, Ian McEwan, licencia MIT) y `hash33` de «Hash without
 * Sine» (Copyright (c) 2014 David Hoskins, licencia MIT), ya registrados en `assets/CREDITS.md`.
 */

export const BAKE_TYPES = ['terran', 'desert', 'gas', 'ice', 'lava', 'moon'] as const;
export type BakeType = (typeof BAKE_TYPES)[number];

type Rgb = readonly [number, number, number];

/** Aspecto que se hornea: tipo, semilla y paleta en color LINEAL (como `Color.r/g/b` de three). */
export interface BakeLook {
  type: BakeType;
  seed: number;
  a: Rgb;
  b: Rgb;
  c: Rgb;
}

export interface BakedSurface {
  width: number;
  height: number;
  albedo: Uint8Array;
  normal: Uint8Array;
}

// ── Ruido (port de `glsl.ts`) ────────────────────────────────────────────────────────────────────────────────────

const mod289 = (x: number): number => x - Math.floor(x * (1 / 289)) * 289;
const permute = (x: number): number => mod289((x * 34 + 1) * x);
const fract = (x: number): number => x - Math.floor(x);
const NS_X = 2 / 7;
const NS_Y = 0.5 / 7 - 1;
const NS_Z = 1 / 7;

/** Contribución de una esquina del símplex (`p` = permutación, `x` = distancia a la esquina). */
function corner(p: number, x: number, y: number, z: number): number {
  let m = 0.6 - (x * x + y * y + z * z);
  if (m <= 0) return 0;
  const j = p - 49 * Math.floor(p * NS_Z * NS_Z);
  const xi = Math.floor(j * NS_Z);
  const yi = Math.floor(j - 7 * xi);
  let gx = xi * NS_X + NS_Y;
  let gy = yi * NS_X + NS_Y;
  const gz = 1 - Math.abs(gx) - Math.abs(gy);
  if (gz <= 0) {
    gx -= Math.floor(gx) * 2 + 1;
    gy -= Math.floor(gy) * 2 + 1;
  }
  const n = 1.79284291400159 - 0.85373472095314 * (gx * gx + gy * gy + gz * gz);
  m *= m;
  return m * m * n * (gx * x + gy * y + gz * z);
}

/** Ruido simplex 3D (≈ [−1, 1]). */
export function snoise(vx: number, vy: number, vz: number): number {
  const s = (vx + vy + vz) / 3;
  let ix = Math.floor(vx + s);
  let iy = Math.floor(vy + s);
  let iz = Math.floor(vz + s);
  const t = (ix + iy + iz) / 6;
  const x0 = vx - ix + t;
  const y0 = vy - iy + t;
  const z0 = vz - iz + t;
  const gx = x0 >= y0 ? 1 : 0;
  const gy = y0 >= z0 ? 1 : 0;
  const gz = z0 >= x0 ? 1 : 0;
  const i1x = Math.min(gx, 1 - gz);
  const i1y = Math.min(gy, 1 - gx);
  const i1z = Math.min(gz, 1 - gy);
  const i2x = Math.max(gx, 1 - gz);
  const i2y = Math.max(gy, 1 - gx);
  const i2z = Math.max(gz, 1 - gy);
  ix = mod289(ix);
  iy = mod289(iy);
  iz = mod289(iz);
  const perm = (ox: number, oy: number, oz: number): number => permute(permute(permute(iz + oz) + iy + oy) + ix + ox);
  return (
    42 *
    (corner(perm(0, 0, 0), x0, y0, z0) +
      corner(perm(i1x, i1y, i1z), x0 - i1x + 1 / 6, y0 - i1y + 1 / 6, z0 - i1z + 1 / 6) +
      corner(perm(i2x, i2y, i2z), x0 - i2x + 1 / 3, y0 - i2y + 1 / 3, z0 - i2z + 1 / 3) +
      corner(perm(1, 1, 1), x0 - 0.5, y0 - 0.5, z0 - 0.5))
  );
}

function fbmN(x: number, y: number, z: number, octaves: number): number {
  let a = 0.5;
  let s = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * snoise(x, y, z);
    x = x * 2.03 + 13.1;
    y = y * 2.03 + 7.7;
    z = z * 2.03 + 3.3;
    a *= 0.5;
  }
  return s;
}
export const fbm = (x: number, y: number, z: number): number => fbmN(x, y, z, 5);
export const fbm3 = (x: number, y: number, z: number): number => fbmN(x, y, z, 3);

/** Campo de cráteres: cuenco hundido y borde levantado alrededor de puntos al azar. */
function craters(px: number, py: number, pz: number, freq: number): number {
  const qx = px * freq;
  const qy = py * freq;
  const qz = pz * freq;
  const idx = Math.floor(qx);
  const idy = Math.floor(qy);
  const idz = Math.floor(qz);
  const fx = qx - idx;
  const fy = qy - idy;
  const fz = qz - idz;
  let d = 9;
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) {
        // hash33(id + g)
        let hx = fract((idx + x) * 0.1031);
        let hy = fract((idy + y) * 0.103);
        let hz = fract((idz + z) * 0.0973);
        const dd = hx * (hy + 33.33) + hy * (hx + 33.33) + hz * (hz + 33.33);
        hx += dd;
        hy += dd;
        hz += dd;
        const ox = fract((hx + hy) * hz);
        const oy = fract((hx + hx) * hy);
        const oz = fract((hy + hx) * hx);
        const ex = x + ox - fx;
        const ey = y + oy - fy;
        const ez = z + oz - fz;
        const v = Math.sqrt(ex * ex + ey * ey + ez * ez) / (0.22 + 0.33 * ox);
        if (v < d) d = v;
      }
  const bowl = smoothstep(0, 1, d) - 1;
  const rim = Math.exp(-(((d - 1) * 5) ** 2));
  return bowl * 0.55 + rim * 0.22;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

function heightOf(type: BakeType, seed: number, x: number, y: number, z: number): number {
  if (type === 'moon') return craters(x + seed, y + seed, z + seed, 2.4) + craters(x - seed, y - seed, z - seed, 5.5) * 0.45 + fbm3(x * 5 + seed, y * 5 + seed, z * 5 + seed) * 0.18;
  return fbm(x * 1.7 + seed, y * 1.7 + seed, z * 1.7 + seed);
}

const toSrgb8 = (c: number): number => {
  const v = c <= 0 ? 0 : c >= 1 ? 1 : c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(v * 255);
};
const unit8 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);

/**
 * Hornea un cuerpo. `width` × `height` texels (equirrectangular). Determinista: el mismo aspecto da los mismos bytes.
 *
 * El relieve se evalúa una vez por texel y la pendiente sale por diferencias centradas en la rejilla (el shader lo
 * evaluaba tres veces por píxel con un paso de 0,012 rad; a 512 texels el paso de la rejilla es casi el mismo).
 */
export function bakePlanet(look: BakeLook, width: number, height: number): BakedSurface {
  const albedo = new Uint8Array(width * height * 4);
  const normal = new Uint8Array(width * height * 4);
  const { type, seed, a, b, c } = look;
  const gas = type === 'gas';
  // Dirección de cada columna y fila (reparto de `SphereGeometry`: fila 0 = polo sur; θ desde el polo norte).
  const sinPhi = new Float64Array(width);
  const cosPhi = new Float64Array(width);
  for (let column = 0; column < width; column++) {
    const phi = ((column + 0.5) / width) * Math.PI * 2;
    sinPhi[column] = Math.sin(phi);
    cosPhi[column] = Math.cos(phi);
  }
  const sinTh = new Float64Array(height);
  const cosTh = new Float64Array(height);
  for (let row = 0; row < height; row++) {
    const theta = (1 - (row + 0.5) / height) * Math.PI;
    sinTh[row] = Math.sin(theta);
    cosTh[row] = Math.cos(theta);
  }
  const hs = gas ? null : new Float64Array(width * height);
  if (hs)
    for (let row = 0; row < height; row++)
      for (let column = 0; column < width; column++)
        hs[row * width + column] = heightOf(type, seed, -cosPhi[column]! * sinTh[row]!, cosTh[row]!, sinPhi[column]! * sinTh[row]!);
  const dPhi = (Math.PI * 2) / width;
  const dTheta = Math.PI / height;
  const col = [0, 0, 0];
  for (let row = 0; row < height; row++) {
    const sinT = sinTh[row]!;
    const py = cosTh[row]!;
    for (let column = 0; column < width; column++) {
      const px = -cosPhi[column]! * sinT;
      const pz = sinPhi[column]! * sinT;
      let nx = px;
      let ny = py;
      let nz = pz;
      let gloss = 0;
      let extra = 0;
      if (!hs) {
        const warp = fbm3(px * 2 + seed, py * 6 + seed, pz * 2 + seed);
        const lat = py + warp * 0.07;
        const bands = Math.sin(lat * 15 + seed) * 0.5 + 0.5;
        const fine = fbm3(px * 3 + seed * 3, lat * 32 + seed * 3, pz * 3 + seed * 3) * 0.5 + 0.5;
        const k = smoothstep(0.2, 0.8, bands * 0.7 + fine * 0.3);
        const storm = smoothstep(0.5, 0.8, fbm3(px * 5 - seed, lat * 14 - seed, pz * 5 - seed)) * 0.65;
        for (let i = 0; i < 3; i++) col[i] = mix(mix(a[i]!, b[i]!, k), c[i]!, storm);
      } else {
        const h = hs[row * width + column]!;
        // Gradiente sobre la esfera: (∂h/∂φ / sen θ) ê_φ + (∂h/∂θ) ê_θ. La fila crece hacia el norte (θ baja).
        const left = hs[row * width + ((column + width - 1) % width)]!;
        const right = hs[row * width + ((column + 1) % width)]!;
        const up = hs[Math.min(height - 1, row + 1) * width + column]!;
        const down = hs[Math.max(0, row - 1) * width + column]!;
        const rows = (row + 1 < height ? 1 : 0) + (row > 0 ? 1 : 0);
        const dhdPhi = (right - left) / (2 * dPhi) / Math.max(0.05, sinT);
        const dhdTheta = -(up - down) / (rows * dTheta);
        const sp = sinPhi[column]!;
        const cp = cosPhi[column]!;
        const gx = dhdPhi * sp - dhdTheta * cp * py;
        const gy = -dhdTheta * sinT;
        const gz = dhdPhi * cp + dhdTheta * sp * py;
        let bump = 0;
        if (type === 'terran') {
          const land = smoothstep(0.02, 0.05, h);
          const sea = smoothstep(-0.6, 0.02, h);
          const hi = smoothstep(0.1, 0.5, h);
          const ice = smoothstep(0.72, 0.84, Math.abs(py) + h * 0.12);
          for (let i = 0; i < 3; i++) {
            const ocean = mix(a[i]! * 0.22, a[i]!, sea);
            const ground = mix(b[i]!, c[i]!, hi);
            col[i] = mix(mix(ocean, ground, land), ICE[i]!, ice);
          }
          gloss = (1 - land) * (1 - ice);
          bump = 0.07 * land;
          extra = smoothstep(0.08, 0.6, fbm(px * 2.6, py * 2.6, pz * 2.6 + seed * 1.7));
        } else if (type === 'desert') {
          const k = smoothstep(-0.5, 0.5, h);
          const k2 = smoothstep(0.25, 0.8, fbm3(px * 6 + seed, py * 6 + seed, pz * 6 + seed));
          for (let i = 0; i < 3; i++) col[i] = mix(mix(a[i]!, b[i]!, k), c[i]!, k2);
          bump = 0.1;
        } else if (type === 'ice') {
          const cracks = 1 - smoothstep(0, 0.05, Math.abs(fbm3(px * 4 + seed, py * 4 + seed, pz * 4 + seed)));
          const k = smoothstep(-0.4, 0.6, h);
          for (let i = 0; i < 3; i++) col[i] = mix(mix(a[i]!, b[i]!, k), c[i]!, cracks * 0.7);
          gloss = 0.35;
          bump = 0.04;
        } else if (type === 'lava') {
          const crack = 1 - smoothstep(0, 0.085, Math.abs(h));
          const k = smoothstep(-0.3, 0.6, h);
          for (let i = 0; i < 3; i++) col[i] = mix(a[i]!, b[i]!, k);
          extra = crack * crack;
          // Fase del latido (h · 20 rad), sin vuelta: en las grietas |h| < 0,085 → |fase| < 1,7 < π.
          gloss = (h * 20 + Math.PI) / (Math.PI * 2);
          bump = 0.1;
        } else {
          const maria = smoothstep(-0.1, 0.5, fbm3(px * 1.4 + seed * 0.5, py * 1.4 + seed * 0.5, pz * 1.4 + seed * 0.5));
          const shade = 0.85 + 0.3 * fbm3(px * 9, py * 9, pz * 9);
          for (let i = 0; i < 3; i++) col[i] = mix(a[i]!, b[i]!, maria) * shade;
          bump = 0.16;
        }
        nx = px - gx * bump;
        ny = py - gy * bump;
        nz = pz - gz * bump;
        const ln = Math.hypot(nx, ny, nz) || 1;
        nx /= ln;
        ny /= ln;
        nz /= ln;
      }
      const o = (row * width + column) * 4;
      albedo[o] = toSrgb8(col[0]!);
      albedo[o + 1] = toSrgb8(col[1]!);
      albedo[o + 2] = toSrgb8(col[2]!);
      albedo[o + 3] = unit8(gloss);
      normal[o] = unit8(nx * 0.5 + 0.5);
      normal[o + 1] = unit8(ny * 0.5 + 0.5);
      normal[o + 2] = unit8(nz * 0.5 + 0.5);
      normal[o + 3] = unit8(extra);
    }
  }
  return { width, height, albedo, normal };
}

const ICE = [0.88, 0.93, 1.0] as const;

/** Resolución del horneado según el radio con que se pinta el cuerpo (los grandes se ven más de cerca). */
export function bakeSize(displayRadius: number): { width: number; height: number } {
  return displayRadius >= 0.3 ? { width: 512, height: 256 } : { width: 256, height: 128 };
}
