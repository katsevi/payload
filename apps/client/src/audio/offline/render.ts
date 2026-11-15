/**
 * Render offline de los efectos y la música con el grafo real del motor (`buildOutputChain`, buses como en
 * `AudioEngine.buildGraph`) sobre `MiniContext`. Aleatoriedad inyectada y determinista.
 * Solo para tests: no se importa desde el código de la app.
 */
import { buildOutputChain, busGain, DEFAULT_VOLUMES } from '../audioEngine';
import { musicMixFor, type MusicMix } from '../musicLogic';
import { createMusic, type MusicGenerator } from '../musicSynth';
import { LOOP_SFX, type SfxId } from '../soundLogic';
import { synthSfx } from '../sfxSynth';
import { SynthKit, type KitBus } from '../synthKit';
import { analyze, categoryOf, evaluate, toDb, type PreMasterInfo, type SoundMetrics, type Verdict } from './metrics';
import { asBaseAudioContext, MiniContext, type Recording } from './miniAudio';

/** Volúmenes por defecto del motor (cuadrados) y nivel del duck. */
const SFX_BUS = busGain('sfx', DEFAULT_VOLUMES.sfx);
const ALERTS_BUS = busGain('alerts', DEFAULT_VOLUMES.alerts);
const MUSIC_BUS = busGain('music', DEFAULT_VOLUMES.music);

/** Generador determinista (mulberry32). */
export function makeRand(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RenderOpts {
  /** Duración del render en s (efectos: 4 por defecto; música: 20). */
  seconds?: number;
  rand?: () => number;
  sampleRate?: number;
  /** Instante (s) en que se paran los bucles del efecto (por defecto, la mitad del render). */
  stopLoopsAtS?: number;
}

export interface RenderResult {
  id: string;
  sampleRate: number;
  /** Salida final (tras master y limitador). */
  left: Float32Array;
  right: Float32Array;
  /** Suma de buses antes del master. */
  pre: Recording;
  /** Entrada del limitador (tras el master). */
  limiterIn: Recording;
}

interface Rig {
  mini: MiniContext;
  kit: SynthKit;
  buses: { music: GainNode };
  pre: Recording;
  limiterIn: Recording;
}

/** Monta el grafo igual que `AudioEngine.buildGraph`, con un nodo unitario extra para medir antes del master. */
function buildRig(opts: RenderOpts, seconds: number): Rig {
  const mini = new MiniContext({ seconds, sampleRate: opts.sampleRate });
  const ctx = asBaseAudioContext(mini);
  const { master } = buildOutputChain(ctx);
  const preGain = ctx.createGain();
  preGain.connect(master);
  const mk = (level: number): GainNode => {
    const g = ctx.createGain();
    g.gain.value = level;
    return g;
  };
  const music = mk(MUSIC_BUS);
  const sfx = mk(SFX_BUS);
  const alerts = mk(ALERTS_BUS);
  const duck = ctx.createGain();
  duck.connect(preGain);
  music.connect(duck);
  sfx.connect(preGain);
  alerts.connect(preGain);
  const loopBus = ctx.createGain();
  loopBus.connect(sfx);
  const buses: Partial<Record<KitBus, AudioNode | null>> = { music, sfx, alerts, voice: alerts, loops: loopBus };
  const kit = new SynthKit(ctx, buses, opts.rand ?? makeRand(1));
  return { mini, kit, buses: { music }, pre: mini.record(preGain), limiterIn: mini.record(master) };
}

interface Job {
  at: number;
  fn: () => void;
}

/**
 * Ejecuta los trabajos programados entre bloques; los `setTimeout` del código sintetizador entran como
 * trabajos. `tick(hasta)` se llama antes de cada tramo (la música agenda sus notas con anticipación).
 */
function runJobs(mini: MiniContext, jobs: Job[], seconds: number, tick?: (untilS: number) => void, stepS = Infinity): void {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let nextId = 1;
  const cancelled = new Set<number>();
  (globalThis as { setTimeout: unknown }).setTimeout = (fn: () => void, ms = 0) => {
    const id = nextId++;
    jobs.push({ at: mini.currentTime + ms / 1000, fn: () => !cancelled.has(id) && fn() });
    return id;
  };
  (globalThis as { clearTimeout: unknown }).clearTimeout = (id: number) => void cancelled.add(id);
  try {
    while (mini.currentTime < seconds) {
      for (;;) {
        jobs.sort((a, b) => a.at - b.at);
        const due = jobs[0];
        if (!due || due.at > mini.currentTime) break;
        jobs.shift();
        due.fn();
      }
      const target = Math.min(seconds, jobs[0]?.at ?? seconds, mini.currentTime + stepS);
      tick?.(target);
      mini.renderTo(target);
    }
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
}

function result(id: string, rig: Rig): RenderResult {
  const out = rig.mini.output();
  return { id, sampleRate: rig.mini.sampleRate, left: out.left, right: out.right, pre: rig.pre, limiterIn: rig.limiterIn };
}

/**
 * Renderiza un efecto. Los bucles (`LOOP_SFX`, y cualquier bucle que arranque el efecto) se dejan sonar
 * hasta la mitad del render y entonces se paran con `stopLoop(id, 0.8)`.
 */
export function renderSfx(id: SfxId | string, opts: RenderOpts = {}): RenderResult {
  const seconds = opts.seconds ?? 4;
  const rig = buildRig(opts, seconds);
  const { mini, kit } = rig;
  const jobs: Job[] = [
    {
      at: opts.stopLoopsAtS ?? seconds / 2,
      fn: () => {
        for (const name of [...kit.loops.keys()]) kit.stopLoop(name, 0.8);
      },
    },
  ];
  // Los timers (p. ej. `takeOff`) se capturan durante la síntesis y el render.
  const realSetTimeout = globalThis.setTimeout;
  const captured: Job[] = [];
  (globalThis as { setTimeout: unknown }).setTimeout = (fn: () => void, ms = 0) => {
    captured.push({ at: mini.currentTime + ms / 1000, fn });
    return 0;
  };
  try {
    synthSfx(kit, id as SfxId, mini.currentTime);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  jobs.push(...captured);
  runJobs(mini, jobs, seconds);
  return result(id, rig);
}

export type MusicSequence = { at: number; mix: MusicMix }[];

/** Renderiza la música: una mezcla fija o una secuencia de mezclas (cada una con fundido, como en el juego). */
export function renderMusic(mixes: MusicMix | MusicSequence, opts: RenderOpts & { id?: string } = {}): RenderResult {
  const seconds = opts.seconds ?? 20;
  const rig = buildRig(opts, seconds);
  const seq: MusicSequence = Array.isArray(mixes) ? mixes : [{ at: 0, mix: mixes }];
  const first = seq[0];
  // Sin temporizador: el planificador de la música avanza de forma síncrona con `advance` (si existe).
  const gen = (createMusic as (k: SynthKit, o: AudioNode, opts?: { autoSchedule?: boolean }) => MusicGenerator)(rig.kit, rig.buses.music, { autoSchedule: false });
  if (first) gen.setMix(first.mix, true);
  const jobs: Job[] = seq.slice(1).map((s) => ({ at: s.at, fn: () => gen.setMix(s.mix, false) }));
  const advance = (gen as { advance?: (untilS: number) => void }).advance;
  runJobs(rig.mini, jobs, seconds, advance ? (t) => advance.call(gen, t + 0.3) : undefined, advance ? 0.1 : Infinity);
  gen.stop();
  return result(opts.id ?? 'music', rig);
}

/** Escenas de música de referencia (mezclas de `musicMixFor`). */
export function musicScenes(): Record<string, MusicMix> {
  return {
    menu: musicMixFor({ screen: 'menu' }),
    aboard: musicMixFor({ screen: 'game', phase: 'docked', danger: 0 }),
    'transit-calm': musicMixFor({ screen: 'game', phase: 'transit', danger: 0 }),
    'transit-danger': musicMixFor({ screen: 'game', phase: 'transit', danger: 0.9 }),
    landing: musicMixFor({ screen: 'game', phase: 'landing', danger: 0.3 }),
    'landing-danger': musicMixFor({ screen: 'game', phase: 'landing', danger: 0.8 }),
    'surface-eva': musicMixFor({ screen: 'game', phase: 'surface', outside: true, danger: 0.2 }),
    'surface-eva-danger': musicMixFor({ screen: 'game', phase: 'surface', outside: true, danger: 1 }),
    won: musicMixFor({ screen: 'game', phase: 'won' }),
    lost: musicMixFor({ screen: 'game', phase: 'lost' }),
  };
}

export interface Measured {
  id: string;
  metrics: SoundMetrics;
  pre: PreMasterInfo;
  /** Pico de la entrada del limitador y de su salida (dBFS): la diferencia es lo que trabaja el limitador. */
  limiterInPeakDb: number;
  limiterOutPeakDb: number;
  verdict: Verdict;
}

const peakOf = (...chs: Float32Array[]): number => {
  let p = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]!));
  return p;
};

/** Mide un render con la rúbrica. `category` por defecto: la de `categoryOf` (efectos) o `music`. */
export function measure(r: RenderResult, category?: Parameters<typeof evaluate>[1], opts?: { midSlice?: boolean }): Measured {
  const metrics = analyze(r.left, r.right, r.sampleRate);
  let clipped = 0;
  for (const c of [r.pre.left, r.pre.right]) for (let i = 0; i < c.length; i++) if (Math.abs(c[i]!) >= 1) clipped++;
  const pre: PreMasterInfo = { peak: peakOf(r.pre.left, r.pre.right), clipped };
  const cat = category ?? categoryOf(r.id, (LOOP_SFX as readonly string[]).includes(r.id));
  return {
    id: r.id,
    metrics,
    pre,
    limiterInPeakDb: toDb(peakOf(r.limiterIn.left, r.limiterIn.right)),
    limiterOutPeakDb: toDb(peakOf(r.left, r.right)),
    verdict: evaluate(metrics, cat, pre, opts),
  };
}

/** Recorta un render a [fromS, toS) (p. ej. el crucero del salto, aparte del arranque). */
export function sliceResult(r: RenderResult, fromS: number, toS: number, id = r.id): RenderResult {
  const a = Math.round(fromS * r.sampleRate);
  const b = Math.round(toS * r.sampleRate);
  return {
    id,
    sampleRate: r.sampleRate,
    left: r.left.subarray(a, b),
    right: r.right.subarray(a, b),
    pre: { left: r.pre.left.subarray(a, b), right: r.pre.right.subarray(a, b) },
    limiterIn: { left: r.limiterIn.left.subarray(a, b), right: r.limiterIn.right.subarray(a, b) },
  };
}

/** WAV PCM de 16 bits estéreo. */
export function encodeWav16(left: Float32Array, right: Float32Array, sampleRate: number): Uint8Array {
  const n = left.length;
  const bytes = new Uint8Array(44 + n * 4);
  const dv = new DataView(bytes.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + n * 4, true);
  str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 2, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 4, true);
  dv.setUint16(32, 4, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, n * 4, true);
  const q = (v: number): number => Math.round(Math.max(-1, Math.min(1, v)) * 32767);
  for (let i = 0; i < n; i++) {
    dv.setInt16(44 + i * 4, q(left[i]!), true);
    dv.setInt16(46 + i * 4, q(right[i]!), true);
  }
  return bytes;
}
