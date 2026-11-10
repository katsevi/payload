/**
 * Texturas procedurales (canvas 2D): no pesan en la descarga y no tienen licencia que atribuir.
 * Cada juego de texturas se genera una sola vez, la primera vez que se pide.
 *
 * Convención: `albedo` va en sRGB; `normal` y `rough` son datos lineales. Todas se repiten (tile).
 */
import { CanvasTexture, NoColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

export interface SurfaceMaps {
  albedo: Texture;
  normal: Texture;
  rough: Texture;
}

type Ctx = CanvasRenderingContext2D;

function makeCanvas(w: number, h = w): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2D no disponible');
  return [c, ctx];
}

/** PRNG determinista (mulberry32): las texturas salen iguales en todas las máquinas. */
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

/** Ruido de valor 2D que se repite cada `period` celdas (para texturas sin costura). */
function tileNoise(seed: number, period: number): (x: number, y: number) => number {
  const r = rng(seed);
  const grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const at = (x: number, y: number): number => grid[(((y % period) + period) % period) * period + (((x % period) + period) % period)] ?? 0;
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/** Suma de octavas de `tileNoise`; `u`,`v` en 0-1. Resultado ~0-1. */
function tileFbm(seed: number, basePeriod: number, octaves: number): (u: number, v: number) => number {
  const layers = Array.from({ length: octaves }, (_, i) => ({ n: tileNoise(seed + i * 101, basePeriod << i), p: basePeriod << i, a: 0.5 ** i }));
  const total = layers.reduce((s, l) => s + l.a, 0);
  return (u, v) => {
    let sum = 0;
    for (const l of layers) sum += l.n(u * l.p, v * l.p) * l.a;
    return sum / total;
  };
}

/** Mapa de normales (convención OpenGL, la de three) a partir de un canvas de alturas en gris. */
function normalFromHeight(height: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = height.width;
  const h = height.height;
  const hctx = height.getContext('2d');
  if (!hctx) throw new Error('canvas 2D no disponible');
  const src = hctx.getImageData(0, 0, w, h).data;
  const [out, ctx] = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const at = (x: number, y: number): number => (src[(((y + h) % h) * w + ((x + w) % w)) * 4] ?? 0) / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      d[i] = (-dx * inv * 0.5 + 0.5) * 255;
      // El canvas tiene la Y hacia abajo y la textura (flipY) hacia arriba: se invierte el signo.
      d[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function tex(canvas: HTMLCanvasElement, srgb: boolean): Texture {
  const t = new CanvasTexture(canvas);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.anisotropy = 8;
  return t;
}

function once<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

/** Multiplica el albedo por suciedad (ruido) y genera la rugosidad a partir del mismo ruido y de las alturas. */
function finish(albedo: HTMLCanvasElement, height: HTMLCanvasElement, opts: { seed: number; dirt: number; roughBase: number; roughVar: number; bump: number }): SurfaceMaps {
  const w = albedo.width;
  const actx = albedo.getContext('2d');
  const hctx = height.getContext('2d');
  if (!actx || !hctx) throw new Error('canvas 2D no disponible');
  const a = actx.getImageData(0, 0, w, w);
  const hd = hctx.getImageData(0, 0, w, w).data;
  const [rough, rctx] = makeCanvas(w);
  const r = rctx.createImageData(w, w);
  const big = tileFbm(opts.seed, 4, 5);
  const fine = tileFbm(opts.seed + 7, 32, 3);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = big(x / w, y / w);
      const f = fine(x / w, y / w);
      const shade = 1 - opts.dirt * (0.65 * n + 0.35 * f);
      a.data[i] = (a.data[i] ?? 0) * shade;
      a.data[i + 1] = (a.data[i + 1] ?? 0) * shade;
      a.data[i + 2] = (a.data[i + 2] ?? 0) * shade;
      // Las juntas (alturas bajas) acumulan polvo: más rugosas.
      const seam = 1 - (hd[i] ?? 0) / 255;
      const rv = Math.min(1, Math.max(0.05, opts.roughBase + opts.roughVar * (n - 0.5) * 2 + 0.25 * (f - 0.5) + seam * 0.3));
      const g = rv * 255;
      r.data[i] = g;
      r.data[i + 1] = g;
      r.data[i + 2] = g;
      r.data[i + 3] = 255;
    }
  }
  actx.putImageData(a, 0, 0);
  rctx.putImageData(r, 0, 0);
  return { albedo: tex(albedo, true), normal: tex(normalFromHeight(height, opts.bump), false), rough: tex(rough, false) };
}

const gray = (v: number): string => {
  const c = Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${c},${c},${c})`;
};

/**
 * Paneles del casco (una baldosa = 2 × 2 m): planchas con juntas, remaches, rejillas y registros.
 * El albedo es casi neutro para que el color lo ponga cada material.
 */
export const panelMaps = once((): SurfaceMaps => {
  const S = 512;
  const U = S / 4;
  const [albedo, a] = makeCanvas(S);
  const [height, h] = makeCanvas(S);
  const r = rng(11);
  a.fillStyle = gray(0.4);
  a.fillRect(0, 0, S, S);
  h.fillStyle = gray(0.1);
  h.fillRect(0, 0, S, S);
  // Planchas en una rejilla de 4 × 4 unidades: [x, y, ancho, alto, detalle]
  const panels: [number, number, number, number, 'plain' | 'vent' | 'hatch' | 'ribs'][] = [
    [0, 0, 2, 2, 'hatch'], [2, 0, 2, 1, 'plain'], [2, 1, 1, 1, 'vent'], [3, 1, 1, 1, 'plain'],
    [0, 2, 1, 2, 'ribs'], [1, 2, 3, 1, 'plain'], [1, 3, 2, 1, 'plain'], [3, 3, 1, 1, 'vent'],
  ];
  for (const [px, py, pw, ph, detail] of panels) {
    const x = px * U + 3;
    const y = py * U + 3;
    const w = pw * U - 6;
    const hh = ph * U - 6;
    const tone = 0.7 + r() * 0.16;
    a.fillStyle = gray(tone);
    a.fillRect(x, y, w, hh);
    // Bisel: borde algo más claro arriba e izquierda, más oscuro abajo y derecha.
    a.fillStyle = 'rgba(255,255,255,0.10)';
    a.fillRect(x, y, w, 2);
    a.fillRect(x, y, 2, hh);
    a.fillStyle = 'rgba(0,0,0,0.22)';
    a.fillRect(x, y + hh - 2, w, 2);
    a.fillRect(x + w - 2, y, 2, hh);
    h.fillStyle = gray(0.55);
    h.fillRect(x, y, w, hh);
    h.fillStyle = gray(0.7);
    h.fillRect(x + 3, y + 3, w - 6, hh - 6);
    // Remaches en las esquinas.
    for (const [cx, cy] of [[x + 11, y + 11], [x + w - 11, y + 11], [x + 11, y + hh - 11], [x + w - 11, y + hh - 11]] as const) {
      h.fillStyle = gray(1);
      h.beginPath();
      h.arc(cx, cy, 3.2, 0, Math.PI * 2);
      h.fill();
      a.fillStyle = 'rgba(0,0,0,0.25)';
      a.beginPath();
      a.arc(cx, cy, 3.6, 0, Math.PI * 2);
      a.fill();
      a.fillStyle = gray(tone + 0.08);
      a.beginPath();
      a.arc(cx - 0.5, cy - 0.5, 2.4, 0, Math.PI * 2);
      a.fill();
    }
    if (detail === 'vent') {
      for (let i = 0; i < 6; i++) {
        const vy = y + 26 + i * 13;
        a.fillStyle = gray(0.12);
        a.fillRect(x + 24, vy, w - 48, 6);
        h.fillStyle = gray(0.2);
        h.fillRect(x + 24, vy, w - 48, 6);
      }
    } else if (detail === 'hatch') {
      a.strokeStyle = gray(0.2);
      a.lineWidth = 3;
      a.strokeRect(x + 34, y + 34, w - 68, hh - 68);
      h.strokeStyle = gray(0.25);
      h.lineWidth = 4;
      h.strokeRect(x + 34, y + 34, w - 68, hh - 68);
      a.fillStyle = gray(tone - 0.06);
      a.fillRect(x + 37, y + 37, w - 74, hh - 74);
      // Tirador del registro.
      a.fillStyle = gray(0.16);
      a.fillRect(x + w / 2 - 18, y + hh - 62, 36, 8);
      h.fillStyle = gray(0.95);
      h.fillRect(x + w / 2 - 18, y + hh - 62, 36, 8);
    } else if (detail === 'ribs') {
      for (let i = 0; i < 5; i++) {
        const rx = x + 18 + i * ((w - 36) / 4) - 4;
        h.fillStyle = gray(0.92);
        h.fillRect(rx, y + 22, 8, hh - 44);
        a.fillStyle = 'rgba(255,255,255,0.07)';
        a.fillRect(rx, y + 22, 8, hh - 44);
      }
    }
    // Arañazos finos.
    a.strokeStyle = 'rgba(255,255,255,0.05)';
    a.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const sx = x + r() * w;
      const sy = y + r() * hh;
      a.beginPath();
      a.moveTo(sx, sy);
      a.lineTo(Math.min(x + w, sx + r() * 40), Math.min(y + hh, sy + (r() - 0.5) * 8));
      a.stroke();
    }
  }
  return finish(albedo, height, { seed: 3, dirt: 0.3, roughBase: 0.55, roughVar: 0.22, bump: 2.2 });
});

/** Cubierta (una baldosa = 1,5 × 1,5 m): chapas antideslizantes con junta y tornillos. */
export const deckMaps = once((): SurfaceMaps => {
  const S = 512;
  const U = S / 2;
  const [albedo, a] = makeCanvas(S);
  const [height, h] = makeCanvas(S);
  const r = rng(29);
  a.fillStyle = gray(0.22);
  a.fillRect(0, 0, S, S);
  h.fillStyle = gray(0.1);
  h.fillRect(0, 0, S, S);
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      const x = px * U + 2;
      const y = py * U + 2;
      const w = U - 4;
      const tone = 0.62 + r() * 0.12;
      a.fillStyle = gray(tone);
      a.fillRect(x, y, w, w);
      h.fillStyle = gray(0.5);
      h.fillRect(x, y, w, w);
      // Relieve antideslizante: lágrimas alternas.
      for (let j = 0; j < 14; j++) {
        for (let i = 0; i < 14; i++) {
          const cx = x + 17 + i * 17 + (j % 2) * 8;
          const cy = y + 16 + j * 17;
          if (cx > x + w - 12) continue;
          const tilt = (i + j) % 2 === 0 ? 0.6 : -0.6;
          h.fillStyle = gray(0.95);
          h.beginPath();
          h.ellipse(cx, cy, 5.5, 2.2, tilt, 0, Math.PI * 2);
          h.fill();
          a.fillStyle = 'rgba(255,255,255,0.06)';
          a.beginPath();
          a.ellipse(cx, cy, 5.5, 2.2, tilt, 0, Math.PI * 2);
          a.fill();
        }
      }
      for (const [cx, cy] of [[x + 8, y + 8], [x + w - 8, y + 8], [x + 8, y + w - 8], [x + w - 8, y + w - 8]] as const) {
        a.fillStyle = gray(0.2);
        a.beginPath();
        a.arc(cx, cy, 3.4, 0, Math.PI * 2);
        a.fill();
        h.fillStyle = gray(0.2);
        h.beginPath();
        h.arc(cx, cy, 3.4, 0, Math.PI * 2);
        h.fill();
      }
    }
  }
  return finish(albedo, height, { seed: 17, dirt: 0.42, roughBase: 0.62, roughVar: 0.25, bump: 2.6 });
});

/** Metal cepillado (vetas horizontales): marcos, tuberías y piezas mecanizadas. */
export const brushedMaps = once((): SurfaceMaps => {
  const S = 256;
  const [albedo, a] = makeCanvas(S);
  const [height, h] = makeCanvas(S);
  const r = rng(53);
  for (let y = 0; y < S; y++) {
    const v = 0.78 + r() * 0.2;
    a.fillStyle = gray(v);
    a.fillRect(0, y, S, 1);
    h.fillStyle = gray(0.5 + (v - 0.88) * 1.4);
    h.fillRect(0, y, S, 1);
  }
  return finish(albedo, height, { seed: 31, dirt: 0.05, roughBase: 0.34, roughVar: 0.1, bump: 0.5 });
});

/** Roca (asteroides): manchas y relieve de ruido. */
export const rockMaps = once((): SurfaceMaps => {
  const S = 256;
  const [albedo, a] = makeCanvas(S);
  const [height, h] = makeCanvas(S);
  const ai = a.createImageData(S, S);
  const hi = h.createImageData(S, S);
  const n1 = tileFbm(71, 4, 6);
  const n2 = tileFbm(83, 8, 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const v = n1(x / S, y / S);
      const pits = Math.abs(n2(x / S, y / S) - 0.5) * 2;
      const c = 150 + v * 90;
      ai.data[i] = c;
      ai.data[i + 1] = c * 0.96;
      ai.data[i + 2] = c * 0.9;
      ai.data[i + 3] = 255;
      const hv = (v * 0.6 + pits * 0.4) * 255;
      hi.data[i] = hv;
      hi.data[i + 1] = hv;
      hi.data[i + 2] = hv;
      hi.data[i + 3] = 255;
    }
  }
  a.putImageData(ai, 0, 0);
  h.putImageData(hi, 0, 0);
  return finish(albedo, height, { seed: 97, dirt: 0.25, roughBase: 0.9, roughVar: 0.1, bump: 5 });
});

function radial(size: number, stops: [number, string][]): [HTMLCanvasElement, Ctx] {
  const [c, ctx] = makeCanvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return [c, ctx];
}

function sprite(canvas: HTMLCanvasElement): Texture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Halo suave (falso resplandor de luces y pilotos; se usa con mezcla aditiva). */
export const glowTexture = once((): Texture => {
  const [c] = radial(128, [[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,255,255,0.75)'], [0.35, 'rgba(255,255,255,0.22)'], [0.7, 'rgba(255,255,255,0.05)'], [1, 'rgba(255,255,255,0)']]);
  return sprite(c);
});

/** Nube blanda e irregular (humo y gas). */
export const puffTexture = once((): Texture => {
  const S = 128;
  const [c, ctx] = makeCanvas(S);
  const img = ctx.createImageData(S, S);
  const n = tileFbm(41, 4, 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x / S - 0.5;
      const dy = y / S - 0.5;
      const d = Math.hypot(dx, dy) * 2;
      const edge = Math.max(0, 1 - d - (n(x / S, y / S) - 0.5) * 0.7);
      const i = (y * S + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(1, edge * edge * 2.2) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return sprite(c);
});

/** Destello de la estrella cercana: núcleo, halo y rayos. */
export const flareTexture = once((): Texture => {
  const S = 512;
  const [c, ctx] = radial(S, [[0, 'rgba(255,255,255,1)'], [0.035, 'rgba(255,250,235,1)'], [0.08, 'rgba(255,225,170,0.55)'], [0.22, 'rgba(255,190,120,0.14)'], [0.5, 'rgba(255,170,110,0.03)'], [1, 'rgba(255,160,100,0)']]);
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(S / 2, S / 2);
  const rays = 6;
  for (let i = 0; i < rays; i++) {
    ctx.save();
    ctx.rotate((i / rays) * Math.PI + 0.3);
    const long = i % 2 === 0 ? S * 0.48 : S * 0.3;
    const g = ctx.createLinearGradient(-long, 0, long, 0);
    g.addColorStop(0, 'rgba(255,230,200,0)');
    g.addColorStop(0.5, 'rgba(255,240,220,0.5)');
    g.addColorStop(1, 'rgba(255,230,200,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-long, 0);
    ctx.quadraticCurveTo(0, -3, long, 0);
    ctx.quadraticCurveTo(0, 3, -long, 0);
    ctx.fill();
    ctx.restore();
  }
  return sprite(c);
});

/** Franjas de aviso amarillo/negro. */
export const hazardTexture = once((): Texture => {
  const S = 64;
  const [c, ctx] = makeCanvas(S);
  ctx.fillStyle = '#16181c';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#e0a21a';
  for (let i = -1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 32, S);
    ctx.lineTo(i * 32 + 16, S);
    ctx.lineTo(i * 32 + 16 + S, 0);
    ctx.lineTo(i * 32 + S, 0);
    ctx.fill();
  }
  return tex(c, true);
});

/**
 * Sombra de contacto del suelo: oscurece el pie de las paredes y de los objetos. `draw` recibe un
 * contexto ya escalado a metros, con el origen en la esquina (minX, minZ).
 */
export function floorShadowTexture(widthM: number, lengthM: number, draw: (ctx: Ctx) => void): Texture {
  const PX = 24;
  const [c, ctx] = makeCanvas(Math.round(widthM * PX), Math.round(lengthM * PX));
  ctx.scale(PX, PX);
  draw(ctx);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
