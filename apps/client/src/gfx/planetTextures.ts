/**
 * Texturas horneadas de los planetas del mapa solar (ver `planetBake.ts`). Se hornean en Web Workers (fuera del hilo
 * principal, varios a la vez) y se guardan para toda la sesión: abrir el mapa otra vez no repite nada. `warm` las pide
 * en segundo plano al empezar una partida con misión, así que al abrir el mapa normalmente ya están.
 *
 * Las `DataTexture` se comparten entre montajes del mapa: three guarda su copia en la GPU por renderizador, y al
 * cerrar el mapa se pierde el contexto entero (no hace falta `dispose`).
 */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType, type Texture } from 'three';
import { bakePlanet, bakeSize, type BakedSurface, type BakeLook } from './planetBake';
import type { BakeRequest } from './planetBake.worker';
import type { PlanetLook } from './spaceShaders';

export interface PlanetMaps {
  albedo: Texture;
  normal: Texture;
}

const cache = new Map<string, Promise<PlanetMaps>>();
const ready = new Map<string, PlanetMaps>();

function texture(data: Uint8Array, width: number, height: number, srgb: boolean): DataTexture {
  const t = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  // Repetición en U: las nubes se deslizan desplazando la coordenada.
  t.wrapS = RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function toMaps(s: BakedSurface): PlanetMaps {
  return { albedo: texture(s.albedo, s.width, s.height, true), normal: texture(s.normal, s.width, s.height, false) };
}

// ── Cola de trabajos y workers ─────────────────────────────────────────────────────────────────────────────────

interface Job extends BakeRequest {
  priority: number;
  resolve: (s: BakedSurface) => void;
}

const queue: Job[] = [];
const idle: Worker[] = [];
const busy = new Map<Worker, Job>();
let workersMade = 0;
let workersBroken = false;

const maxWorkers = (): number => Math.max(1, Math.min(3, (globalThis.navigator?.hardwareConcurrency ?? 4) - 2));

function makeWorker(): Worker | null {
  if (workersBroken || typeof Worker === 'undefined') return null;
  try {
    const w = new Worker(new URL('./planetBake.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<BakedSurface & { key: string }>) => {
      const job = busy.get(w);
      busy.delete(w);
      idle.push(w);
      job?.resolve(e.data);
      pump();
    };
    w.onerror = () => {
      // Sin worker (CSP, entorno raro): se hornea en el hilo principal, de uno en uno.
      workersBroken = true;
      const job = busy.get(w);
      busy.delete(w);
      w.terminate();
      if (job) queue.unshift(job);
      pump();
    };
    return w;
  } catch {
    workersBroken = true;
    return null;
  }
}

function pump(): void {
  queue.sort((a, b) => b.priority - a.priority);
  while (queue.length > 0) {
    let w = idle.pop();
    if (!w && workersMade < maxWorkers() && !workersBroken) {
      const made = makeWorker();
      if (made) {
        workersMade++;
        w = made;
      }
    }
    if (!w) break;
    const job = queue.shift()!;
    busy.set(w, job);
    const msg: BakeRequest = { key: job.key, look: job.look, width: job.width, height: job.height };
    w.postMessage(msg);
  }
  if (workersBroken && busy.size === 0 && queue.length > 0) {
    // Respaldo: un cuerpo por tarea, para no congelar todo de golpe.
    const job = queue.shift()!;
    setTimeout(() => {
      job.resolve(bakePlanet(job.look, job.width, job.height));
      pump();
    }, 0);
  }
}

function lookKey(id: string, look: PlanetLook, width: number): string {
  return `${id}|${look.type}|${look.seed}|${look.a.getHexString()}${look.b.getHexString()}${look.c.getHexString()}|${width}`;
}

const rgb = (c: PlanetLook['a']): [number, number, number] => [c.r, c.g, c.b];

/**
 * Texturas del cuerpo `id` con el aspecto `look`, pintado con radio `displayRadius` (decide la resolución). La promesa
 * se comparte: pedirla otra vez no hornea de nuevo. Más `priority` = antes (los cuerpos grandes primero).
 */
export function planetMaps(id: string, look: PlanetLook, displayRadius: number, priority = displayRadius): Promise<PlanetMaps> {
  const { width, height } = bakeSize(displayRadius);
  const key = lookKey(id, look, width);
  const hit = cache.get(key);
  if (hit) return hit;
  const bake: BakeLook = { type: look.type, seed: look.seed, a: rgb(look.a), b: rgb(look.b), c: rgb(look.c) };
  const p = new Promise<BakedSurface>((resolve) => {
    queue.push({ key, look: bake, width, height, priority, resolve });
    pump();
  }).then((s) => {
    const maps = toMaps(s);
    ready.set(key, maps);
    return maps;
  });
  cache.set(key, p);
  return p;
}

/** Las texturas si ya están horneadas (para pintar sin esperar ni un fotograma). */
export function planetMapsNow(id: string, look: PlanetLook, displayRadius: number): PlanetMaps | null {
  return ready.get(lookKey(id, look, bakeSize(displayRadius).width)) ?? null;
}
