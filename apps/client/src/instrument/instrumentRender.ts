import type { InstrumentTarget } from './instrumentLogic';

/**
 * Dibujo procedural (Canvas 2D, sin assets) de lo que ve el instrumento: Tierra, Luna, Marte o campo de
 * estrellas. Se pinta a baja resolución y se escala (el pixelado suave imita un sensor). El avance del
 * terreno sale de `orbitPhase` del motor, no de un reloj propio.
 */

export const GRID_W = 128;
export const GRID_H = 72;

const hash = (x: number, y: number): number => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const smooth = (t: number): number => t * t * (3 - 2 * t);

function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

function fbm(x: number, y: number): number {
  return vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.15;
}

/** Cráter por celda: anillo claro con interior oscuro; devuelve un factor de brillo (~0.7-1.25). */
function crater(x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const px = cx + 0.25 + hash(cx, cy) * 0.5;
  const py = cy + 0.25 + hash(cy, cx + 7) * 0.5;
  const r = 0.12 + hash(cx + 3, cy + 5) * 0.22;
  if (hash(cx + 11, cy + 13) < 0.45) return 1;
  const d = Math.hypot(x - px, y - py) / r;
  if (d > 1.25) return 1;
  if (d < 0.85) return 0.78;
  return 1.0 + 0.25 * (1 - Math.abs(d - 1) / 0.25);
}

function pixelEarth(nx: number, ny: number): [number, number, number] {
  const land = fbm(nx * 1.3, ny * 1.3);
  const cloud = fbm(nx * 2.4 + 40, ny * 2.4 + 9);
  let r: number, g: number, b: number;
  if (land < 0.5) {
    const k = 0.7 + (0.5 - land) * 0.9; // océano más profundo en el centro de la cuenca
    r = 12 * k; g = 70 * k; b = 150 * k;
  } else if (land < 0.56) {
    r = 200; g = 190; b = 130; // costa
  } else {
    const h = (land - 0.56) * 3;
    r = 60 + 110 * h; g = 120 + 20 * (1 - h); b = 55 + 20 * h; // llanura a montaña
  }
  const c = Math.max(0, cloud - 0.55) * 3.2;
  return [r + (245 - r) * Math.min(1, c), g + (248 - g) * Math.min(1, c), b + (250 - b) * Math.min(1, c)];
}

function pixelMoon(nx: number, ny: number): [number, number, number] {
  const base = 0.36 + 0.34 * fbm(nx * 1.6, ny * 1.6);
  const v = base * crater(nx * 2.2, ny * 2.2) * (0.92 + 0.16 * crater(nx * 5.1 + 3, ny * 5.1 + 8));
  const k = Math.min(1, Math.max(0, v)) * 255;
  return [k, k * 0.98, k * 0.94];
}

function pixelMars(nx: number, ny: number): [number, number, number] {
  const f = fbm(nx * 1.4, ny * 1.4);
  const dark = f < 0.42 ? 0.62 : 1; // mares oscuros (como Syrtis Major)
  const v = (0.55 + 0.6 * f) * dark * crater(nx * 2.6, ny * 2.6);
  return [Math.min(255, 190 * v), Math.min(255, 92 * v), Math.min(255, 52 * v)];
}

const PIXEL: Record<Exclude<InstrumentTarget, 'stars'>, (nx: number, ny: number) => [number, number, number]> = {
  earth: pixelEarth,
  moon: pixelMoon,
  mars: pixelMars,
};

/** Estrellas determinísticas (LCG) para el telescopio. */
const STARS = (() => {
  let s = 20250611;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: 260 }, () => ({ x: rnd(), y: rnd(), r: 0.4 + rnd() * 1.4, ph: rnd() * 6.28, hue: rnd() }));
})();

export interface RenderBuffers {
  low: HTMLCanvasElement;
  lowCtx: CanvasRenderingContext2D;
  image: ImageData;
}

export function createBuffers(): RenderBuffers | null {
  if (typeof document === 'undefined') return null;
  const low = document.createElement('canvas');
  low.width = GRID_W;
  low.height = GRID_H;
  const lowCtx = low.getContext('2d');
  if (!lowCtx) return null;
  return { low, lowCtx, image: lowCtx.createImageData(GRID_W, GRID_H) };
}

/**
 * Pinta un fotograma. `scroll` avanza con la fase orbital (el suelo pasa bajo el instrumento);
 * `timeS` solo anima el parpadeo de estrellas. `lost` pinta ruido de pantalla sin señal.
 */
export function renderFrame(
  g: CanvasRenderingContext2D, w: number, h: number, buf: RenderBuffers,
  target: InstrumentTarget, scroll: number, timeS: number, lost: boolean,
): void {
  if (lost) {
    const d = buf.image.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 90;
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
    }
    buf.lowCtx.putImageData(buf.image, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(buf.low, 0, 0, w, h);
    return;
  }
  if (target === 'stars') {
    g.fillStyle = '#01030a';
    g.fillRect(0, 0, w, h);
    const neb = g.createRadialGradient(w * 0.62, h * 0.4, 0, w * 0.62, h * 0.4, Math.max(w, h) * 0.55);
    neb.addColorStop(0, 'rgba(90,60,160,.28)');
    neb.addColorStop(0.5, 'rgba(30,60,140,.12)');
    neb.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = neb;
    g.fillRect(0, 0, w, h);
    const drift = (scroll * 0.02) % 1;
    for (const st of STARS) {
      const x = ((st.x + drift) % 1) * w;
      const a = 0.55 + 0.45 * Math.sin(timeS * 1.6 + st.ph);
      g.fillStyle = `hsla(${st.hue < 0.5 ? 210 : 35}, 60%, 88%, ${a})`;
      g.beginPath();
      g.arc(x, st.y * h, st.r, 0, Math.PI * 2);
      g.fill();
    }
    return;
  }
  const px = PIXEL[target];
  const d = buf.image.data;
  const sx = scroll * 40; // una órbita recorre 40 "celdas" de terreno
  let i = 0;
  for (let y = 0; y < GRID_H; y++) {
    const ny = (y / GRID_H) * 3.4;
    for (let x = 0; x < GRID_W; x++) {
      const [r, gr, b] = px((x / GRID_W) * 6 + sx, ny);
      d[i++] = r; d[i++] = gr; d[i++] = b; d[i++] = 255;
    }
  }
  buf.lowCtx.putImageData(buf.image, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(buf.low, 0, 0, w, h);
}
