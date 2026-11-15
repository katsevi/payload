/**
 * Medidas objetivas de una señal renderizada (umbrales de `docs/diseno/audio-rubrica.md`): pico, RMS,
 * LUFS aproximado, clics, clipping, duración efectiva, centroide, energía sub-30 Hz y planitud espectral.
 * TS puro, sin dependencias. Solo para tests y para el informe offline.
 */

const EPS = 1e-12;
export const toDb = (lin: number): number => (lin > EPS ? 20 * Math.log10(lin) : -Infinity);

// ───────────────────────────── FFT ─────────────────────────────

/** FFT radix-2 en sitio (`re`, `im` de longitud potencia de 2). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a]! += xr;
        im[a]! += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export interface SpectralStats {
  centroidHz: number;
  /** Fracción (0-1) de la energía por debajo de 30 Hz. */
  sub30Fraction: number;
  /** Planitud 100 Hz-16 kHz (0 tonal, 1 ruido blanco). */
  flatness: number;
  /** Fracción de la energía entre 800 y 1600 Hz (alarmas). */
  band800to1600: number;
}

const nextPow2 = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

export function spectralStats(mono: Float32Array, sampleRate: number): SpectralStats {
  const N = Math.min(4096, Math.max(512, nextPow2(mono.length)));
  const hop = N / 2;
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const bins = N / 2 + 1;
  const mag = new Float64Array(bins);
  const pow = new Float64Array(bins);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const last = Math.max(1, mono.length - N / 4);
  for (let s = 0; s < last; s += hop) {
    let e = 0;
    for (let i = 0; i < N; i++) {
      const v = (mono[s + i] ?? 0) * win[i]!;
      re[i] = v;
      im[i] = 0;
      e += v * v;
    }
    if (e < 1e-12) continue; // ventana en silencio
    fft(re, im);
    for (let k = 0; k < bins; k++) {
      const p = re[k]! * re[k]! + im[k]! * im[k]!;
      pow[k]! += p;
      mag[k]! += Math.sqrt(p);
    }
  }
  const df = sampleRate / N;
  let num = 0;
  let den = 0;
  let totalPow = 0;
  let subPow = 0;
  let bandPow = 0;
  let lnSum = 0;
  let aSum = 0;
  let cnt = 0;
  for (let k = 0; k < bins; k++) {
    const f = k * df;
    totalPow += pow[k]!;
    if (f < 30) subPow += pow[k]!;
    if (f >= 800 && f <= 1600) bandPow += pow[k]!;
    if (k >= 1) {
      num += f * mag[k]!;
      den += mag[k]!;
    }
    if (f >= 100 && f <= 16000) {
      lnSum += Math.log(mag[k]! + EPS);
      aSum += mag[k]!;
      cnt++;
    }
  }
  return {
    centroidHz: den > EPS ? num / den : 0,
    sub30Fraction: totalPow > EPS ? subPow / totalPow : 0,
    flatness: cnt > 0 && aSum > EPS ? Math.exp(lnSum / cnt) / (aSum / cnt) : 0,
    band800to1600: totalPow > EPS ? bandPow / totalPow : 0,
  };
}

// ───────────────────────────── loudness ─────────────────────────────

type Biq = { b0: number; b1: number; b2: number; a1: number; a2: number };

function kWeightingFilters(sr: number): [Biq, Biq] {
  // BS.1770-4 (coeficientes derivados para cualquier frecuencia de muestreo).
  const shelf = (): Biq => {
    const G = 3.999843853973347;
    const Q = 0.7071752369554196;
    const fc = 1681.9744509555319;
    const K = Math.tan((Math.PI * fc) / sr);
    const Vh = Math.pow(10, G / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    return {
      b0: (Vh + (Vb * K) / Q + K * K) / a0,
      b1: (2 * (K * K - Vh)) / a0,
      b2: (Vh - (Vb * K) / Q + K * K) / a0,
      a1: (2 * (K * K - 1)) / a0,
      a2: (1 - K / Q + K * K) / a0,
    };
  };
  const rlb = (): Biq => {
    const Q = 0.5003270373238773;
    const fc = 38.13547087613982;
    const K = Math.tan((Math.PI * fc) / sr);
    const a0 = 1 + K / Q + K * K;
    return { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  };
  return [shelf(), rlb()];
}

function applyBiquad(x: Float32Array | Float64Array, f: Biq): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
}

/** LUFS integrado aproximado (K-weighting, bloques de 400 ms, compuertas -70 y -10 LU). */
export function integratedLufs(channels: Float32Array[], sampleRate: number): number {
  const [s1, s2] = kWeightingFilters(sampleRate);
  const z = channels.map((c) => applyBiquad(applyBiquad(c, s1), s2));
  const len = z[0]?.length ?? 0;
  if (len === 0) return -Infinity;
  const blockLen = Math.round(0.4 * sampleRate);
  const step = Math.round(0.1 * sampleRate);
  const energies: number[] = [];
  const blockEnergy = (a: number, b: number): number => {
    let sum = 0;
    for (const ch of z) {
      let s = 0;
      for (let i = a; i < b; i++) s += ch[i]! * ch[i]!;
      sum += s / (b - a);
    }
    return sum;
  };
  if (len < blockLen) energies.push(blockEnergy(0, len));
  else for (let a = 0; a + blockLen <= len; a += step) energies.push(blockEnergy(a, a + blockLen));
  const lufs = (e: number): number => -0.691 + 10 * Math.log10(Math.max(e, 1e-20));
  const abs = energies.filter((e) => lufs(e) > -70);
  if (abs.length === 0) return -Infinity;
  const rel = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const kept = abs.filter((e) => lufs(e) > rel);
  if (kept.length === 0) return -Infinity;
  return lufs(kept.reduce((a, b) => a + b, 0) / kept.length);
}

// ───────────────────────────── clics ─────────────────────────────

export interface ClickReport {
  /** Eventos de discontinuidad (segunda diferencia muy por encima de su entorno). */
  count: number;
  /** Mayor |x[n] - x[n-1]| (rúbrica: ≤ 0,3 fuera de ataques percusivos). */
  maxStep: number;
  /** Mayor error de predicción lineal en un evento. */
  maxJump: number;
  /** Instantes (s) de los primeros eventos. */
  atS: number[];
}

/**
 * Detector de clics: error de predicción lineal e[n] = x[n] - 2x[n-1] + x[n-2]. En un tono suave es
 * minúsculo; un corte brusco lo dispara. Se compara con el RMS de e en una ventana local (excluyendo
 * los vecinos inmediatos) para no marcar el ruido ni los ataques percusivos de banda ancha.
 */
export function detectClicks(channels: Float32Array[], sampleRate: number, opts: { ratio?: number; floor?: number } = {}): ClickReport {
  const ratio = opts.ratio ?? 8;
  const floor = opts.floor ?? 0.01;
  const W = 128;
  let count = 0;
  let maxStep = 0;
  let maxJump = 0;
  const atS: number[] = [];
  for (const x of channels) {
    const n = x.length;
    const e2 = new Float64Array(n + 1); // suma acumulada de e²
    const e = new Float64Array(n);
    for (let i = 2; i < n; i++) e[i] = x[i]! - 2 * x[i - 1]! + x[i - 2]!;
    for (let i = 0; i < n; i++) e2[i + 1] = e2[i]! + e[i]! * e[i]!;
    for (let i = 1; i < n; i++) maxStep = Math.max(maxStep, Math.abs(x[i]! - x[i - 1]!));
    let lastHit = -1000;
    for (let i = 2; i < n; i++) {
      const a = Math.abs(e[i]!);
      if (a < floor) continue;
      const l0 = Math.max(0, i - W);
      const l1 = Math.max(0, i - 3);
      const r0 = Math.min(n, i + 4);
      const r1 = Math.min(n, i + W);
      const cnt = Math.max(1, l1 - l0 + Math.max(0, r1 - r0));
      const sum = e2[l1]! - e2[l0]! + (r1 > r0 ? e2[r1]! - e2[r0]! : 0);
      const local = Math.sqrt(sum / cnt);
      if (a > ratio * Math.max(local, 1e-4)) {
        if (i - lastHit > 16) {
          count++;
          if (atS.length < 8) atS.push(i / sampleRate);
        }
        lastHit = i;
        maxJump = Math.max(maxJump, a);
      }
    }
  }
  return { count, maxStep, maxJump, atS };
}

// ───────────────────────────── análisis completo ─────────────────────────────

export interface SoundMetrics {
  seconds: number;
  peakDb: number;
  rmsDb: number;
  /** RMS solo dentro de la duración efectiva. */
  activeRmsDb: number;
  crestDb: number;
  lufs: number;
  /** Muestras con |x| ≥ 1,0. */
  clipped: number;
  clicks: ClickReport;
  /** |x[0]| y |x[N-1]| (máximo de los canales). */
  startAbs: number;
  endAbs: number;
  /** Segundos por encima de -60 dBFS (de la primera a la última muestra audible). */
  effectiveS: number;
  effectiveStartS: number;
  /** Ataque: segundos desde el inicio audible hasta alcanzar el 90 % del pico. */
  attackS: number;
  spectral: SpectralStats;
}

const rmsOf = (chs: Float32Array[], a = 0, b = chs[0]?.length ?? 0): number => {
  let s = 0;
  for (const c of chs) for (let i = a; i < b; i++) s += c[i]! * c[i]!;
  const n = (b - a) * chs.length;
  return n > 0 ? Math.sqrt(s / n) : 0;
};

export function analyze(left: Float32Array, right: Float32Array, sampleRate: number): SoundMetrics {
  const chs = [left, right];
  const n = left.length;
  let peak = 0;
  let clipped = 0;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.abs(left[i]!);
    const b = Math.abs(right[i]!);
    peak = Math.max(peak, a, b);
    if (a >= 1) clipped++;
    if (b >= 1) clipped++;
    mono[i] = (left[i]! + right[i]!) * 0.5;
  }
  // Duración efectiva con ventanas de 10 ms por encima de -60 dBFS.
  const w = Math.max(1, Math.round(0.01 * sampleRate));
  let first = -1;
  let lastBlk = -1;
  for (let a = 0; a < n; a += w) {
    if (toDb(rmsOf(chs, a, Math.min(n, a + w))) > -60) {
      if (first < 0) first = a;
      lastBlk = Math.min(n, a + w);
    }
  }
  const effStart = Math.max(0, first);
  const effEnd = first < 0 ? 0 : lastBlk;
  const rms = rmsOf(chs);
  // Ataque: de la primera muestra por encima de -60 dBFS al primer máximo local importante (≥ 70 % del
  // pico de la primera fracción del sonido), no al máximo global ni desde el inicio del bloque de análisis.
  let attack = 0;
  if (first >= 0 && peak > 0) {
    const amp = (i: number) => Math.max(Math.abs(left[i]!), Math.abs(right[i]!));
    let start = effStart;
    while (start < n && amp(start) < 0.001) start++;
    // Primer máximo local: primera muestra que supera el 70 % del pico de los primeros 30 ms y es cresta.
    const win = Math.min(n, start + Math.round(0.03 * sampleRate));
    let localPeak = 0;
    for (let i = start; i < win; i++) localPeak = Math.max(localPeak, amp(i));
    for (let i = start; i < win; i++) {
      if (amp(i) >= 0.9 * localPeak) {
        attack = (i - start) / sampleRate;
        break;
      }
    }
  }
  return {
    seconds: n / sampleRate,
    peakDb: toDb(peak),
    rmsDb: toDb(rms),
    activeRmsDb: first < 0 ? -Infinity : toDb(rmsOf(chs, effStart, effEnd)),
    crestDb: toDb(peak) - toDb(rms),
    lufs: integratedLufs(chs, sampleRate),
    clipped,
    clicks: detectClicks(chs, sampleRate),
    startAbs: Math.max(Math.abs(left[0] ?? 0), Math.abs(right[0] ?? 0)),
    endAbs: Math.max(Math.abs(left[n - 1] ?? 0), Math.abs(right[n - 1] ?? 0)),
    effectiveS: (effEnd - effStart) / sampleRate,
    effectiveStartS: effStart / sampleRate,
    attackS: attack,
    spectral: spectralStats(mono, sampleRate),
  };
}

// ───────────────────────────── rúbrica ─────────────────────────────

export type SoundCategory = 'ui' | 'ui-nav' | 'notification' | 'presence' | 'ui-confirm' | 'effect' | 'alarm-critical' | 'alarm-warning' | 'music' | 'ambient-loop';

const UI = new Set(['click', 'toggle', 'blip', 'skillHit', 'skillMiss', 'hover']);
const NAV = new Set(['toolPlace', 'select', 'panelOpen', 'panelClose', 'mapOpen', 'mapClose', 'terminalOpen', 'partAdd', 'partRemove', 'powerOn', 'powerOff']);
const NOTIFICATION = new Set(['go', 'noGo', 'contact', 'observation', 'earthCall', 'crewJoin', 'crewLeave']);
const PRESENCE = new Set(['stepShip', 'stepDust', 'stepRock', 'stepIce', 'footLand', 'breath', 'breathFast', 'hail']);
const CONFIRM = new Set(['ok', 'fixed', 'collect', 'store', 'sale', 'purchase', 'noCredits', 'success', 'complete', 'upgrade', 'ping', 'toolReady', 'toolDone', 'toolStop', 'toolResume', 'toolLost']);
const CRITICAL = new Set(['alarm', 'o2Critical', 'suitHit', 'dodgeHit', 'crewDead']);
const WARNING = new Set(['warnTick', 'stormWarn', 'o2Low', 'fallWarn', 'crack', 'overheat', 'storageFull']);

/** Categoría de la rúbrica de un efecto (por id; los bucles son «ambient-loop»). */
export function categoryOf(id: string, isLoop: boolean): SoundCategory {
  if (isLoop) return 'ambient-loop';
  if (UI.has(id)) return 'ui';
  if (NAV.has(id)) return 'ui-nav';
  if (NOTIFICATION.has(id)) return 'notification';
  if (PRESENCE.has(id)) return 'presence';
  if (CONFIRM.has(id)) return 'ui-confirm';
  if (CRITICAL.has(id)) return 'alarm-critical';
  if (WARNING.has(id)) return 'alarm-warning';
  return 'effect';
}

interface Range {
  rms: [number, number];
  centroidMax?: number;
  centroidMin?: number;
  durationS?: [number, number];
  /** Energía sub-30 Hz máxima (dB relativos). */
  sub30Db: number;
  crestMinDb?: number;
  flatnessMax?: number;
}

const RUBRIC: Record<SoundCategory, Range> = {
  ui: { rms: [-24, -18], centroidMax: 4000, durationS: [0.005, 0.06], sub30Db: -30 },
  'ui-nav': { rms: [-24, -18], centroidMax: 3000, durationS: [0.05, 0.3], sub30Db: -30 },
  notification: { rms: [-22, -16], centroidMax: 4000, durationS: [0.2, 1], sub30Db: -30 },
  presence: { rms: [-28, -22], centroidMax: 2500, sub30Db: -20 },
  'ui-confirm': { rms: [-22, -16], centroidMax: 4000, durationS: [0.08, 0.25], sub30Db: -30 },
  effect: { rms: [-20, -12], centroidMax: 1500, durationS: [0.2, 2], sub30Db: -20 },
  'alarm-critical': { rms: [-16, -10], centroidMin: 800, centroidMax: 1600, sub30Db: -30 },
  'alarm-warning': { rms: [-18, -12], centroidMin: 800, centroidMax: 1600, sub30Db: -30 },
  music: { rms: [-30, -22], centroidMax: 800, crestMinDb: 8, sub30Db: -30, flatnessMax: 0.3 },
  'ambient-loop': { rms: [-34, -26], centroidMax: 600, sub30Db: -30, flatnessMax: 0.3 },
};

export interface Verdict {
  category: SoundCategory;
  /** Fallos duros (3.1): clipping, pico, clics, inicio/final sin fundido. */
  hard: string[];
  /** Criterios blandos fuera de rango (3.2/3.3). */
  soft: string[];
  /** Puntuación aproximada de la escala de la rúbrica (solo criterios objetivos). */
  score: number;
}

export interface PreMasterInfo {
  /** Pico lineal de la suma de buses antes del master. */
  peak: number;
  /** Muestras ≥ 1,0 en esa suma. */
  clipped: number;
}

/** `midSlice`: tramo central de un bucle (sin extremos propios: no se exige inicio ni final sin fundido). */
export function evaluate(m: SoundMetrics, category: SoundCategory, pre?: PreMasterInfo, opts: { midSlice?: boolean } = {}): Verdict {
  const r = RUBRIC[category];
  const hard: string[] = [];
  const soft: string[] = [];
  if (m.clipped > 0) hard.push(`clipping en la salida (${m.clipped} muestras >= 1.0)`);
  if (pre && pre.clipped > 0) hard.push(`clipping antes del master (${pre.clipped} muestras >= 1.0, pico ${pre.peak.toFixed(2)})`);
  if (m.peakDb > -0.5) hard.push(`pico ${m.peakDb.toFixed(1)} dBFS > -0.5`);
  if (m.clicks.count > 0) hard.push(`${m.clicks.count} clic(s) en ${m.clicks.atS.map((t) => t.toFixed(3)).join(', ')} s`);
  // La música es un flujo continuo: solo los efectos tienen principio y fin propios.
  if (category !== 'music' && !opts.midSlice && m.startAbs > 0.01) hard.push(`inicio sin fundido (|x0| = ${m.startAbs.toFixed(3)})`);
  if (category !== 'music' && !opts.midSlice && m.endAbs > 0.01) hard.push(`final sin fundido (|xN| = ${m.endAbs.toFixed(3)})`);
  const level = category === 'music' ? m.rmsDb : m.activeRmsDb;
  // 3.3: un bucle o lecho de ruido de banda completa (planitud > 0,5) a más de -30 dBFS es fallo duro.
  if ((category === 'ambient-loop' || category === 'music') && m.spectral.flatness > 0.5 && level > -30) {
    hard.push(`ruido de banda completa (planitud ${m.spectral.flatness.toFixed(2)} > 0.5 a ${level.toFixed(1)} dBFS > -30)`);
  }
  if (level < r.rms[0] || level > r.rms[1]) soft.push(`RMS ${level.toFixed(1)} dBFS fuera de ${r.rms[0]}..${r.rms[1]}`);
  const c = m.spectral.centroidHz;
  if (r.centroidMax !== undefined && c > r.centroidMax) soft.push(`centroide ${Math.round(c)} Hz > ${r.centroidMax}`);
  if (r.centroidMin !== undefined && c < r.centroidMin) soft.push(`centroide ${Math.round(c)} Hz < ${r.centroidMin}`);
  if (r.durationS && category !== 'ambient-loop' && (m.effectiveS < r.durationS[0] || m.effectiveS > r.durationS[1])) {
    soft.push(`duración ${m.effectiveS.toFixed(2)} s fuera de ${r.durationS[0]}..${r.durationS[1]}`);
  }
  const subDb = 10 * Math.log10(Math.max(m.spectral.sub30Fraction, 1e-12));
  if (subDb > r.sub30Db) soft.push(`energía < 30 Hz ${subDb.toFixed(1)} dB > ${r.sub30Db}`);
  if (r.crestMinDb !== undefined && m.crestDb < r.crestMinDb) soft.push(`crest ${m.crestDb.toFixed(1)} dB < ${r.crestMinDb}`);
  if (r.flatnessMax !== undefined && m.spectral.flatness > r.flatnessMax) soft.push(`planitud ${m.spectral.flatness.toFixed(2)} > ${r.flatnessMax}`);
  if ((category === 'ui' || category === 'ui-nav' || category.startsWith('alarm')) && m.attackS > 0.005) soft.push(`ataque ${(m.attackS * 1000).toFixed(1)} ms > 5`);
  const score = hard.length > 0 ? 0 : soft.length === 0 ? 9 : soft.length <= 2 ? 5 : 2;
  return { category, hard, soft, score };
}
