/**
 * Contexto de audio offline mínimo, en TypeScript puro y sin dependencias (Node no tiene Web Audio).
 * Implementa el subconjunto que usan `synthKit`, `sfxSynth` y `musicSynth` para medir los sonidos en los
 * tests: osciladores (PolyBLEP), ganancias, biquads RBJ, fuentes de buffer, compresor, paneo, retardo,
 * waveshaper, mezcla de canales y AudioParam con automatización y entradas conectadas (LFO).
 *
 * NO se importa desde el código de la app: solo desde `__tests__` y desde `offline/`.
 * Procesa en bloques de 128 muestras tirando desde `destination`; todo nodo es estéreo (2 canales).
 */

export const BLOCK = 128;
const TWO_PI = Math.PI * 2;

type Stereo = [Float32Array, Float32Array];
const newStereo = (): Stereo => [new Float32Array(BLOCK), new Float32Array(BLOCK)];

// ───────────────────────────── AudioBuffer ─────────────────────────────

export class MiniAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly data: Float32Array[];
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number): Float32Array {
    const d = this.data[c];
    if (!d) throw new Error(`canal ${c} fuera de rango`);
    return d;
  }
  copyToChannel(src: Float32Array, c: number, offset = 0): void {
    this.getChannelData(c).set(src, offset);
  }
  copyFromChannel(dst: Float32Array, c: number, offset = 0): void {
    dst.set(this.getChannelData(c).subarray(offset, offset + dst.length));
  }
}

// ───────────────────────────── AudioParam ─────────────────────────────

type EvType = 'set' | 'lin' | 'exp' | 'target' | 'curve';
interface Ev {
  type: EvType;
  t: number;
  v: number;
  tc?: number;
  curve?: Float32Array;
  dur?: number;
  /** Valor al entrar (setTarget) o inicio de la rampa que viene de un setTarget. */
  v0?: number;
  t0?: number;
}

interface Conn {
  src: MiniNode;
  output: number;
  input: number;
}

export class MiniParam {
  readonly events: Ev[] = [];
  readonly inputs: Conn[] = [];
  readonly buf = new Float32Array(BLOCK);
  /** El bloque calculado es constante (`buf[0]`). */
  constant = true;
  private base: number;
  private cur: number;
  private lastBlock = -1;
  constructor(
    private readonly ctx: MiniContext,
    readonly defaultValue: number,
    readonly minValue = -3.4e38,
    readonly maxValue = 3.4e38,
  ) {
    this.base = defaultValue;
    this.cur = defaultValue;
  }

  get value(): number {
    return this.cur;
  }
  set value(v: number) {
    this.base = v;
    this.cur = v;
    if (this.events.length > 0) this.insert({ type: 'set', t: this.ctx.currentTime, v });
  }

  private insert(e: Ev): void {
    const ev = this.events;
    let i = ev.length;
    while (i > 0 && ev[i - 1]!.t > e.t) i--;
    ev.splice(i, 0, e);
  }

  private needStart(t: number): void {
    if (!this.events.some((e) => e.t <= t)) this.insert({ type: 'set', t: this.ctx.currentTime, v: this.cur });
  }

  setValueAtTime(v: number, t: number): this {
    this.insert({ type: 'set', t, v });
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): this {
    this.needStart(t);
    this.insert({ type: 'lin', t, v });
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    this.needStart(t);
    this.insert({ type: 'exp', t, v });
    return this;
  }
  setTargetAtTime(target: number, t: number, tc: number): this {
    this.insert({ type: 'target', t, v: target, tc: Math.max(1e-6, tc) });
    return this;
  }
  setValueCurveAtTime(values: ArrayLike<number>, t: number, dur: number): this {
    const curve = Float32Array.from(values);
    this.insert({ type: 'curve', t, v: curve[0] ?? 0, curve, dur: Math.max(1e-6, dur) });
    return this;
  }
  cancelScheduledValues(t: number): this {
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i]!.t >= t) this.events.splice(i, 1);
    if (this.events.length === 0) this.base = this.cur;
    return this;
  }
  cancelAndHoldAtTime(t: number): this {
    const hold = this.cur;
    this.cancelScheduledValues(t);
    return this.setValueAtTime(hold, t);
  }

  private evalAt(ci: number, t: number): number {
    const ev = this.events;
    if (ci < 0) return this.base;
    const p = ev[ci]!;
    const nx = ev[ci + 1];
    if (nx && (nx.type === 'lin' || nx.type === 'exp')) {
      let v0: number;
      let t0: number;
      if (p.type === 'target') {
        if (p.t0 === undefined) {
          p.t0 = t;
          p.v0 = this.cur;
        }
        v0 = p.v0!;
        t0 = p.t0;
      } else if (p.type === 'curve') {
        v0 = p.curve![p.curve!.length - 1] ?? p.v;
        t0 = p.t + p.dur!;
      } else {
        v0 = p.v;
        t0 = p.t;
      }
      if (nx.t <= t0) return nx.v;
      const f = (t - t0) / (nx.t - t0);
      if (nx.type === 'lin') return v0 + (nx.v - v0) * f;
      return v0 * nx.v > 0 ? v0 * Math.pow(nx.v / v0, f) : v0;
    }
    switch (p.type) {
      case 'target': {
        if (p.v0 === undefined) p.v0 = this.evalAt(ci - 1, p.t);
        return p.v + (p.v0 - p.v) * Math.exp(-(t - p.t) / p.tc!);
      }
      case 'curve': {
        const c = p.curve!;
        if (t >= p.t + p.dur!) return c[c.length - 1] ?? p.v;
        const pos = ((t - p.t) / p.dur!) * (c.length - 1);
        const i = Math.floor(pos);
        const a = c[i] ?? 0;
        const b = c[i + 1] ?? a;
        return a + (b - a) * (pos - i);
      }
      default:
        return p.v;
    }
  }

  /** Calcula el bloque (a-rate) que empieza en `frame0`, con las entradas conectadas sumadas. */
  compute(frame0: number): Float32Array {
    const blk = Math.floor(frame0 / BLOCK);
    if (blk === this.lastBlock) return this.buf;
    this.lastBlock = blk;
    const sr = this.ctx.sampleRate;
    const ev = this.events;
    const buf = this.buf;
    let ci = -1;
    const t0 = frame0 / sr;
    while (ci + 1 < ev.length && ev[ci + 1]!.t <= t0) ci++;
    if (ev.length === 0) {
      buf.fill(this.base);
      this.constant = true;
      this.cur = this.base;
    } else if (ci >= 0 && ev[ci]!.type === 'set' && ci + 1 >= ev.length) {
      buf.fill(ev[ci]!.v);
      this.constant = true;
      this.cur = ev[ci]!.v;
    } else {
      this.constant = false;
      for (let i = 0; i < BLOCK; i++) {
        const t = (frame0 + i) / sr;
        while (ci + 1 < ev.length && ev[ci + 1]!.t <= t) ci++;
        const v = this.evalAt(ci, t);
        buf[i] = v;
        this.cur = v;
      }
    }
    if (this.inputs.length > 0) {
      this.constant = false;
      for (const c of this.inputs) {
        const o = c.src.outputBlock(c.output);
        for (let i = 0; i < BLOCK; i++) buf[i]! += (o[0][i]! + o[1][i]!) * 0.5;
      }
    }
    return buf;
  }
}

// ───────────────────────────── nodos ─────────────────────────────

type Dest = MiniNode | MiniParam;

export abstract class MiniNode {
  readonly inputs: Conn[] = [];
  readonly dests: Dest[] = [];
  protected out: Stereo = newStereo();
  /** La señal de salida es mono duplicado en L y R (para el paneo). */
  mono = true;
  private lastBlock = -1;
  private busy = false;
  channelCount = 2;
  channelCountMode = 'max';
  channelInterpretation = 'speakers';
  constructor(readonly context: MiniContext) {}

  get numberOfInputs(): number {
    return 1;
  }
  get numberOfOutputs(): number {
    return 1;
  }

  connect<T extends Dest>(dest: T, output = 0, input = 0): T {
    const c: Conn = { src: this, output, input };
    if (dest instanceof MiniParam) dest.inputs.push(c);
    else dest.inputs.push(c);
    this.dests.push(dest);
    return dest;
  }

  disconnect(dest?: Dest): void {
    // Durante el procesado de un bloque la desconexión se aplaza a su final: así `sumInputs` no se salta
    // ninguna entrada del bloque en curso (un clic falso en el render, que en el navegador no existe).
    if (this.context.processing) {
      this.context.deferred.push(() => this.disconnect(dest));
      return;
    }
    const targets = dest ? [dest] : [...this.dests];
    for (const d of targets) {
      for (let i = d.inputs.length - 1; i >= 0; i--) if (d.inputs[i]!.src === this) d.inputs.splice(i, 1);
      const k = this.dests.indexOf(d);
      if (k >= 0) this.dests.splice(k, 1);
    }
  }

  /** Salida `k` (los splitters la sobrescriben). */
  outputBlock(_k: number): Stereo {
    return this.pull();
  }

  pull(): Stereo {
    const blk = this.context.blockIndex;
    if (this.lastBlock === blk || this.busy) return this.out;
    this.busy = true;
    this.process(this.context.frame);
    this.busy = false;
    this.lastBlock = blk;
    return this.out;
  }

  protected abstract process(frame0: number): void;

  /** Suma las entradas en `into` (por defecto, la salida). Propaga el flag mono. */
  protected sumInputs(into: Stereo = this.out): Stereo {
    into[0].fill(0);
    into[1].fill(0);
    let mono = true;
    for (const c of this.inputs) {
      const o = c.src.outputBlock(c.output);
      if (!c.src.mono) mono = false;
      const l = into[0];
      const r = into[1];
      for (let i = 0; i < BLOCK; i++) {
        l[i]! += o[0][i]!;
        r[i]! += o[1][i]!;
      }
    }
    this.mono = mono;
    return into;
  }
}

class MiniDestination extends MiniNode {
  protected process(): void {
    this.sumInputs();
  }
}

export class MiniGain extends MiniNode {
  readonly gain: MiniParam;
  constructor(ctx: MiniContext) {
    super(ctx);
    this.gain = new MiniParam(ctx, 1);
  }
  protected process(frame0: number): void {
    this.sumInputs();
    const g = this.gain.compute(frame0);
    const [l, r] = this.out;
    if (this.gain.constant) {
      const v = g[0]!;
      if (v === 1) return;
      for (let i = 0; i < BLOCK; i++) {
        l[i]! *= v;
        r[i]! *= v;
      }
    } else {
      for (let i = 0; i < BLOCK; i++) {
        l[i]! *= g[i]!;
        r[i]! *= g[i]!;
      }
    }
  }
}

/** Base de fuentes programables (`start`/`stop` en s). */
abstract class MiniSource extends MiniNode {
  protected startFrame = -1;
  protected stopFrame = Infinity;
  onended: (() => void) | null = null;
  start(when = 0): void {
    const ctx = this.context;
    this.startFrame = Math.max(ctx.frame, Math.round(when * ctx.sampleRate));
  }
  stop(when = 0): void {
    const ctx = this.context;
    this.stopFrame = Math.max(ctx.frame, Math.round(when * ctx.sampleRate));
  }
  override get numberOfInputs(): number {
    return 0;
  }
  /** Encola `onended` (se ejecuta al terminar el bloque, como el evento asíncrono del navegador). */
  protected checkEnded(finished: boolean): void {
    if (!this.onended || this.startFrame < 0) return;
    if (finished || this.context.frame + BLOCK >= this.stopFrame) {
      const cb = this.onended;
      this.onended = null;
      this.context.queueEnded(cb);
    }
  }
  protected get done(): boolean {
    return this.startFrame < 0 || this.context.frame >= this.stopFrame;
  }
}

const polyBlep = (t: number, dt: number): number => {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
};

export class MiniOscillator extends MiniSource {
  type: OscillatorType = 'sine';
  readonly frequency: MiniParam;
  readonly detune: MiniParam;
  private phase = 0;
  constructor(ctx: MiniContext) {
    super(ctx);
    this.frequency = new MiniParam(ctx, 440);
    this.detune = new MiniParam(ctx, 0);
  }
  setPeriodicWave(): void {
    /* no soportado: se queda con el tipo actual */
  }
  protected process(frame0: number): void {
    const [l, r] = this.out;
    this.mono = true;
    if (this.done) {
      l.fill(0);
      r.fill(0);
      return;
    }
    const fr = this.frequency.compute(frame0);
    const dt = this.detune.compute(frame0);
    const sr = this.context.sampleRate;
    const nyq = sr / 2;
    const detConst = this.detune.constant;
    const detMul = detConst ? Math.pow(2, dt[0]! / 1200) : 1;
    const type = this.type;
    let ph = this.phase;
    for (let i = 0; i < BLOCK; i++) {
      const f = frame0 + i;
      if (f < this.startFrame || f >= this.stopFrame) {
        l[i] = 0;
        continue;
      }
      let hz = fr[i]! * (detConst ? detMul : Math.pow(2, dt[i]! / 1200));
      if (hz > nyq) hz = nyq;
      else if (hz < -nyq) hz = -nyq;
      const inc = Math.abs(hz) / sr;
      let v: number;
      switch (type) {
        case 'square': {
          v = ph < 0.5 ? 1 : -1;
          v += polyBlep(ph, inc);
          v -= polyBlep((ph + 0.5) % 1, inc);
          break;
        }
        case 'sawtooth': {
          const p2 = (ph + 0.5) % 1;
          v = 2 * p2 - 1 - polyBlep(p2, inc);
          break;
        }
        case 'triangle':
          v = ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4;
          break;
        default:
          v = Math.sin(TWO_PI * ph);
      }
      l[i] = v;
      ph += hz / sr;
      ph -= Math.floor(ph);
    }
    this.phase = ph;
    r.set(l);
    this.checkEnded(false);
  }
}

export class MiniConstantSource extends MiniSource {
  readonly offset: MiniParam;
  constructor(ctx: MiniContext) {
    super(ctx);
    this.offset = new MiniParam(ctx, 1);
  }
  protected process(frame0: number): void {
    const [l, r] = this.out;
    this.mono = true;
    const o = this.offset.compute(frame0);
    for (let i = 0; i < BLOCK; i++) {
      const f = frame0 + i;
      l[i] = f >= this.startFrame && this.startFrame >= 0 && f < this.stopFrame ? o[i]! : 0;
    }
    r.set(l);
  }
}

export class MiniBufferSource extends MiniSource {
  buffer: MiniAudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate: MiniParam;
  readonly detune: MiniParam;
  private pos = 0;
  private endFrame = Infinity;
  private ended = false;
  constructor(ctx: MiniContext) {
    super(ctx);
    this.playbackRate = new MiniParam(ctx, 1);
    this.detune = new MiniParam(ctx, 0);
  }
  override start(when = 0, offset = 0, duration?: number): void {
    super.start(when);
    this.pos = Math.max(0, offset) * (this.buffer?.sampleRate ?? this.context.sampleRate);
    if (duration !== undefined) this.endFrame = this.startFrame + Math.round(duration * this.context.sampleRate);
  }
  protected process(frame0: number): void {
    const [l, r] = this.out;
    const buf = this.buffer;
    if (this.done || !buf || this.ended) {
      l.fill(0);
      r.fill(0);
      this.mono = true;
      return;
    }
    const c0 = buf.getChannelData(0);
    const c1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : c0;
    this.mono = buf.numberOfChannels < 2;
    const rate = this.playbackRate.compute(frame0);
    const det = this.detune.compute(frame0);
    const k = buf.sampleRate / this.context.sampleRate;
    const len = buf.length;
    const lEnd = this.loop ? (this.loopEnd > 0 ? Math.min(len, this.loopEnd * buf.sampleRate) : len) : len;
    const lStart = this.loop ? Math.min(lEnd, Math.max(0, this.loopStart * buf.sampleRate)) : 0;
    const span = lEnd - lStart;
    let pos = this.pos;
    for (let i = 0; i < BLOCK; i++) {
      const f = frame0 + i;
      if (f < this.startFrame) {
        l[i] = 0;
        r[i] = 0;
        continue;
      }
      if (f >= this.stopFrame || f >= this.endFrame || this.ended) {
        l[i] = 0;
        r[i] = 0;
        continue;
      }
      if (this.loop && span > 0) {
        while (pos >= lEnd) pos -= span;
      } else if (pos >= len) {
        this.ended = true;
        l[i] = 0;
        r[i] = 0;
        continue;
      }
      const i0 = Math.floor(pos);
      let i1 = i0 + 1;
      if (this.loop && span > 0 && i1 >= lEnd) i1 = lStart;
      else if (i1 >= len) i1 = i0;
      const fr = pos - i0;
      l[i] = c0[i0]! + (c0[i1]! - c0[i0]!) * fr;
      r[i] = c1[i0]! + (c1[i1]! - c1[i0]!) * fr;
      pos += rate[i]! * (det[i] === 0 ? 1 : Math.pow(2, det[i]! / 1200)) * k;
    }
    this.pos = pos;
    this.checkEnded(this.ended);
  }
}

export class MiniBiquad extends MiniNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency: MiniParam;
  readonly detune: MiniParam;
  readonly Q: MiniParam;
  readonly gain: MiniParam;
  private readonly inb = newStereo();
  private z = [0, 0, 0, 0];
  private c = [1, 0, 0, 0, 0];
  constructor(ctx: MiniContext) {
    super(ctx);
    this.frequency = new MiniParam(ctx, 350);
    this.detune = new MiniParam(ctx, 0);
    this.Q = new MiniParam(ctx, 1);
    this.gain = new MiniParam(ctx, 0);
  }
  getFrequencyResponse(): void {
    /* no soportado */
  }
  private coefs(freq: number, q: number, gainDb: number): void {
    const sr = this.context.sampleRate;
    const f = Math.min(Math.max(freq, 1e-3), sr * 0.4999);
    const w0 = (TWO_PI * f) / sr;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    const qLin = Math.max(1e-4, q);
    const A = Math.pow(10, gainDb / 40);
    switch (this.type) {
      case 'lowpass':
      case 'highpass': {
        const alpha = sin / (2 * Math.pow(10, q / 20));
        const hp = this.type === 'highpass';
        b0 = hp ? (1 + cos) / 2 : (1 - cos) / 2;
        b1 = hp ? -(1 + cos) : 1 - cos;
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      }
      case 'bandpass': {
        const alpha = sin / (2 * qLin);
        b0 = alpha; b1 = 0; b2 = -alpha;
        a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      }
      case 'notch': {
        const alpha = sin / (2 * qLin);
        b0 = 1; b1 = -2 * cos; b2 = 1;
        a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      }
      case 'allpass': {
        const alpha = sin / (2 * qLin);
        b0 = 1 - alpha; b1 = -2 * cos; b2 = 1 + alpha;
        a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      }
      case 'peaking': {
        const alpha = sin / (2 * qLin);
        b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
        a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
        break;
      }
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * (sin / 2) * Math.SQRT2;
        b0 = A * (A + 1 - (A - 1) * cos + s);
        b1 = 2 * A * (A - 1 - (A + 1) * cos);
        b2 = A * (A + 1 - (A - 1) * cos - s);
        a0 = A + 1 + (A - 1) * cos + s;
        a1 = -2 * (A - 1 + (A + 1) * cos);
        a2 = A + 1 + (A - 1) * cos - s;
        break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * (sin / 2) * Math.SQRT2;
        b0 = A * (A + 1 + (A - 1) * cos + s);
        b1 = -2 * A * (A - 1 + (A + 1) * cos);
        b2 = A * (A + 1 + (A - 1) * cos - s);
        a0 = A + 1 - (A - 1) * cos + s;
        a1 = 2 * (A - 1 - (A + 1) * cos);
        a2 = A + 1 - (A - 1) * cos - s;
        break;
      }
    }
    const c = this.c;
    c[0] = b0 / a0; c[1] = b1 / a0; c[2] = b2 / a0; c[3] = a1 / a0; c[4] = a2 / a0;
  }
  protected process(frame0: number): void {
    const inp = this.sumInputs(this.inb);
    const fr = this.frequency.compute(frame0);
    const dt = this.detune.compute(frame0);
    const q = this.Q.compute(frame0);
    const g = this.gain.compute(frame0);
    const allConst = this.frequency.constant && this.detune.constant && this.Q.constant && this.gain.constant;
    const step = allConst ? BLOCK : 16;
    const z = this.z;
    const c = this.c;
    for (let s = 0; s < BLOCK; s += step) {
      this.coefs(fr[s]! * Math.pow(2, dt[s]! / 1200), q[s]!, g[s]!);
      const b0 = c[0]!, b1 = c[1]!, b2 = c[2]!, a1 = c[3]!, a2 = c[4]!;
      for (let ch = 0; ch < 2; ch++) {
        const x = inp[ch]!;
        const y = this.out[ch]!;
        let z1 = z[ch * 2]!;
        let z2 = z[ch * 2 + 1]!;
        for (let i = s; i < s + step; i++) {
          const xi = x[i]!;
          const yi = b0 * xi + z1;
          z1 = b1 * xi - a1 * yi + z2;
          z2 = b2 * xi - a2 * yi;
          y[i] = yi;
        }
        // Desnormales y NaN: se limpian para no contaminar el resto del render.
        z[ch * 2] = Math.abs(z1) < 1e-20 || !Number.isFinite(z1) ? 0 : z1;
        z[ch * 2 + 1] = Math.abs(z2) < 1e-20 || !Number.isFinite(z2) ? 0 : z2;
      }
    }
  }
}

/** Curva estática de un compresor (dB de entrada → dB de salida). */
export function compressorCurveDb(x: number, threshold: number, knee: number, ratio: number): number {
  if (2 * (x - threshold) < -knee) return x;
  if (2 * Math.abs(x - threshold) <= knee) {
    const d = x - threshold + knee / 2;
    return x + (1 / ratio - 1) * ((d * d) / (2 * knee));
  }
  return threshold + (x - threshold) / ratio;
}

export class MiniCompressor extends MiniNode {
  readonly threshold: MiniParam;
  readonly knee: MiniParam;
  readonly ratio: MiniParam;
  readonly attack: MiniParam;
  readonly release: MiniParam;
  readonly reduction: MiniParam;
  /** Ganancia automática de compensación del navegador (`(1/curva(0 dB))^0,6`). */
  makeup = true;
  private readonly inb = newStereo();
  private readonly la: Float32Array[];
  private wp = 0;
  private env = 0;
  private readonly laLen: number;
  constructor(ctx: MiniContext) {
    super(ctx);
    this.threshold = new MiniParam(ctx, -24, -100, 0);
    this.knee = new MiniParam(ctx, 30, 0, 40);
    this.ratio = new MiniParam(ctx, 12, 1, 20);
    this.attack = new MiniParam(ctx, 0.003, 0, 1);
    this.release = new MiniParam(ctx, 0.25, 0, 1);
    this.reduction = new MiniParam(ctx, 0);
    // Pre-retardo de 6 ms (como el navegador): el limitador «ve» el pico antes de que llegue.
    this.laLen = Math.max(1, Math.round(0.006 * ctx.sampleRate));
    this.la = [new Float32Array(this.laLen), new Float32Array(this.laLen)];
  }
  protected process(frame0: number): void {
    const inp = this.sumInputs(this.inb);
    const sr = this.context.sampleRate;
    const T = this.threshold.compute(frame0)[0]!;
    const K = this.knee.compute(frame0)[0]!;
    const R = Math.max(1, this.ratio.compute(frame0)[0]!);
    const att = Math.exp(-1 / (Math.max(1e-4, this.attack.compute(frame0)[0]!) * sr));
    const rel = Math.exp(-1 / (Math.max(1e-3, this.release.compute(frame0)[0]!) * sr));
    const mk = this.makeup ? Math.pow(10, (-0.6 * compressorCurveDb(0, T, K, R)) / 20) : 1;
    const [il, ir] = inp;
    const [ol, or] = this.out;
    const [bl, br] = this.la;
    let env = this.env;
    let wp = this.wp;
    const n = this.laLen;
    let minGain = 1;
    for (let i = 0; i < BLOCK; i++) {
      const x0 = il[i]!;
      const x1 = ir[i]!;
      const pk = Math.max(Math.abs(x0), Math.abs(x1));
      env = pk > env ? pk + (env - pk) * att : pk + (env - pk) * rel;
      let gain = 1;
      if (env > 1e-6) {
        const xDb = 20 * Math.log10(env);
        const yDb = compressorCurveDb(xDb, T, K, R);
        gain = Math.pow(10, (yDb - xDb) / 20);
      }
      if (gain < minGain) minGain = gain;
      // salida retardada n muestras
      const d0 = bl![wp]!;
      const d1 = br![wp]!;
      bl![wp] = x0;
      br![wp] = x1;
      wp = wp + 1 >= n ? 0 : wp + 1;
      ol[i] = d0 * gain * mk;
      or[i] = d1 * gain * mk;
    }
    this.env = env < 1e-20 ? 0 : env;
    this.wp = wp;
    this.reduction.value = 20 * Math.log10(minGain);
  }
}

export class MiniStereoPanner extends MiniNode {
  readonly pan: MiniParam;
  private readonly inb = newStereo();
  constructor(ctx: MiniContext) {
    super(ctx);
    this.pan = new MiniParam(ctx, 0, -1, 1);
  }
  protected process(frame0: number): void {
    const inp = this.sumInputs(this.inb);
    const inMono = this.mono;
    const p = this.pan.compute(frame0);
    const [il, ir] = inp;
    const [ol, or] = this.out;
    for (let i = 0; i < BLOCK; i++) {
      const pan = Math.min(1, Math.max(-1, p[i]!));
      if (inMono) {
        const x = (pan + 1) / 2;
        const v = (il[i]! + ir[i]!) * 0.5;
        ol[i] = v * Math.cos((x * Math.PI) / 2);
        or[i] = v * Math.sin((x * Math.PI) / 2);
      } else if (pan <= 0) {
        const x = pan + 1;
        ol[i] = il[i]! + ir[i]! * Math.cos((x * Math.PI) / 2);
        or[i] = ir[i]! * Math.sin((x * Math.PI) / 2);
      } else {
        ol[i] = il[i]! * Math.cos((pan * Math.PI) / 2);
        or[i] = ir[i]! + il[i]! * Math.sin((pan * Math.PI) / 2);
      }
    }
    this.mono = false;
  }
}

export class MiniDelay extends MiniNode {
  readonly delayTime: MiniParam;
  private readonly ring: Stereo;
  private wp = 0;
  private readonly size: number;
  private readonly inb = newStereo();
  constructor(ctx: MiniContext, maxDelayTime = 1) {
    super(ctx);
    this.delayTime = new MiniParam(ctx, 0, 0, maxDelayTime);
    this.size = Math.ceil(maxDelayTime * ctx.sampleRate) + BLOCK + 2;
    this.ring = [new Float32Array(this.size), new Float32Array(this.size)];
  }
  protected process(frame0: number): void {
    const inp = this.sumInputs(this.inb);
    const d = this.delayTime.compute(frame0);
    const sr = this.context.sampleRate;
    const size = this.size;
    const maxD = this.delayTime.maxValue * sr;
    for (let i = 0; i < BLOCK; i++) {
      const w = this.wp;
      this.ring[0]![w] = inp[0]![i]!;
      this.ring[1]![w] = inp[1]![i]!;
      const dl = Math.min(maxD, Math.max(0, d[i]! * sr));
      let rp = w - dl;
      if (rp < 0) rp += size;
      const i0 = Math.floor(rp);
      const i1 = i0 + 1 >= size ? 0 : i0 + 1;
      const f = rp - i0;
      for (let ch = 0; ch < 2; ch++) {
        const rg = this.ring[ch]!;
        this.out[ch]![i] = rg[i0]! + (rg[i1]! - rg[i0]!) * f;
      }
      this.wp = w + 1 >= size ? 0 : w + 1;
    }
  }
}

export class MiniWaveShaper extends MiniNode {
  curve: Float32Array | null = null;
  oversample: OverSampleType = 'none';
  protected process(): void {
    this.sumInputs();
    const c = this.curve;
    if (!c || c.length < 2) return;
    const n = c.length;
    for (let ch = 0; ch < 2; ch++) {
      const o = this.out[ch]!;
      for (let i = 0; i < BLOCK; i++) {
        const x = Math.max(-1, Math.min(1, o[i]!));
        const pos = ((x + 1) / 2) * (n - 1);
        const i0 = Math.floor(pos);
        const a = c[i0]!;
        const b = c[Math.min(n - 1, i0 + 1)]!;
        o[i] = a + (b - a) * (pos - i0);
      }
    }
  }
}

/** Convolver (pasante), panner 3D (pasante) y analyser (pasante). */
export class MiniPassThrough extends MiniNode {
  buffer: MiniAudioBuffer | null = null;
  normalize = true;
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  // Panner 3D
  panningModel = 'equalpower';
  distanceModel = 'inverse';
  refDistance = 1;
  maxDistance = 10000;
  rolloffFactor = 1;
  readonly positionX: MiniParam;
  readonly positionY: MiniParam;
  readonly positionZ: MiniParam;
  readonly orientationX: MiniParam;
  readonly orientationY: MiniParam;
  readonly orientationZ: MiniParam;
  constructor(ctx: MiniContext) {
    super(ctx);
    this.positionX = new MiniParam(ctx, 0);
    this.positionY = new MiniParam(ctx, 0);
    this.positionZ = new MiniParam(ctx, 0);
    this.orientationX = new MiniParam(ctx, 1);
    this.orientationY = new MiniParam(ctx, 0);
    this.orientationZ = new MiniParam(ctx, 0);
  }
  setPosition(): void {}
  setOrientation(): void {}
  getFloatTimeDomainData(): void {}
  getByteTimeDomainData(): void {}
  getFloatFrequencyData(): void {}
  getByteFrequencyData(): void {}
  protected process(): void {
    this.sumInputs();
  }
}

export class MiniSplitter extends MiniNode {
  private readonly mono2: [Stereo, Stereo] = [newStereo(), newStereo()];
  private readonly inb = newStereo();
  override get numberOfOutputs(): number {
    return 2;
  }
  protected process(): void {
    this.sumInputs(this.inb);
    for (let ch = 0; ch < 2; ch++) {
      this.mono2[ch]![0].set(this.inb[ch]!);
      this.mono2[ch]![1].set(this.inb[ch]!);
    }
    this.out[0].set(this.inb[0]);
    this.out[1].set(this.inb[1]);
    this.mono = false;
  }
  override outputBlock(k: number): Stereo {
    this.pull();
    return this.mono2[Math.min(1, Math.max(0, k))]!;
  }
}

export class MiniMerger extends MiniNode {
  override get numberOfInputs(): number {
    return 2;
  }
  protected process(): void {
    this.out[0].fill(0);
    this.out[1].fill(0);
    for (const c of this.inputs) {
      const o = c.src.outputBlock(c.output);
      const dst = this.out[Math.min(1, Math.max(0, c.input))]!;
      for (let i = 0; i < BLOCK; i++) dst[i]! += (o[0][i]! + o[1][i]!) * 0.5;
    }
    this.mono = false;
  }
}

// ───────────────────────────── contexto ─────────────────────────────

export interface Recording {
  readonly left: Float32Array;
  readonly right: Float32Array;
}

export interface MiniContextOptions {
  /** Duración total en s (por defecto 5). */
  seconds?: number;
  sampleRate?: number;
}

export class MiniListener {
  readonly positionX: MiniParam;
  readonly positionY: MiniParam;
  readonly positionZ: MiniParam;
  constructor(ctx: MiniContext) {
    this.positionX = new MiniParam(ctx, 0);
    this.positionY = new MiniParam(ctx, 0);
    this.positionZ = new MiniParam(ctx, 0);
  }
  setPosition(): void {}
  setOrientation(): void {}
}

export class MiniContext {
  readonly sampleRate: number;
  readonly length: number;
  /** Primer fotograma del bloque en curso (múltiplo de 128). */
  frame = 0;
  blockIndex = 0;
  readonly state = 'running';
  readonly destination: MiniNode;
  readonly listener: MiniListener;
  private readonly recs: { node: MiniNode; left: Float32Array; right: Float32Array }[] = [];
  private readonly outL: Float32Array;
  private readonly outR: Float32Array;

  constructor(opts: MiniContextOptions = {}) {
    this.sampleRate = opts.sampleRate ?? 48000;
    this.length = Math.max(1, Math.round((opts.seconds ?? 5) * this.sampleRate));
    const padded = Math.ceil(this.length / BLOCK) * BLOCK;
    this.outL = new Float32Array(padded);
    this.outR = new Float32Array(padded);
    this.destination = new MiniDestination(this);
    this.listener = new MiniListener(this);
  }

  get currentTime(): number {
    return this.frame / this.sampleRate;
  }

  private readonly endedQueue: (() => void)[] = [];
  queueEnded(cb: () => void): void {
    this.endedQueue.push(cb);
  }

  createBuffer(channels: number, length: number, sampleRate: number): MiniAudioBuffer {
    return new MiniAudioBuffer(channels, length, sampleRate);
  }
  createGain(): MiniGain {
    return new MiniGain(this);
  }
  createOscillator(): MiniOscillator {
    return new MiniOscillator(this);
  }
  createBufferSource(): MiniBufferSource {
    return new MiniBufferSource(this);
  }
  createConstantSource(): MiniConstantSource {
    return new MiniConstantSource(this);
  }
  createBiquadFilter(): MiniBiquad {
    return new MiniBiquad(this);
  }
  createDynamicsCompressor(): MiniCompressor {
    return new MiniCompressor(this);
  }
  createStereoPanner(): MiniStereoPanner {
    return new MiniStereoPanner(this);
  }
  createDelay(maxDelayTime = 1): MiniDelay {
    return new MiniDelay(this, maxDelayTime);
  }
  createWaveShaper(): MiniWaveShaper {
    return new MiniWaveShaper(this);
  }
  createConvolver(): MiniPassThrough {
    return new MiniPassThrough(this);
  }
  createPanner(): MiniPassThrough {
    return new MiniPassThrough(this);
  }
  createAnalyser(): MiniPassThrough {
    return new MiniPassThrough(this);
  }
  createChannelSplitter(): MiniSplitter {
    return new MiniSplitter(this);
  }
  createChannelMerger(): MiniMerger {
    return new MiniMerger(this);
  }

  /** Graba la salida de un nodo (suma previa al master, entrada del limitador...). */
  record(node: unknown): Recording {
    const padded = this.outL.length;
    const rec = { node: node as MiniNode, left: new Float32Array(padded), right: new Float32Array(padded) };
    this.recs.push(rec);
    return { left: rec.left.subarray(0, this.length), right: rec.right.subarray(0, this.length) };
  }

  /** Avanza el render hasta `seconds` (redondeado al bloque siguiente). Permite programar entre bloques. */
  /** true mientras se procesa un bloque (las desconexiones se aplazan: ver `MiniNode.disconnect`). */
  processing = false;
  readonly deferred: (() => void)[] = [];

  renderTo(seconds: number): void {
    const until = Math.min(this.outL.length, Math.ceil((seconds * this.sampleRate) / BLOCK) * BLOCK);
    while (this.frame < until) {
      this.processing = true;
      const o = this.destination.pull();
      this.outL.set(o[0], this.frame);
      this.outR.set(o[1], this.frame);
      for (const r of this.recs) {
        const s = r.node.pull();
        r.left.set(s[0], this.frame);
        r.right.set(s[1], this.frame);
      }
      this.processing = false;
      for (const d of this.deferred.splice(0)) d();
      this.frame += BLOCK;
      this.blockIndex++;
      if (this.endedQueue.length > 0) for (const cb of this.endedQueue.splice(0)) cb();
    }
  }

  /** Salida estéreo ya renderizada (recortada a la duración pedida). */
  output(): { left: Float32Array; right: Float32Array } {
    return { left: this.outL.subarray(0, this.length), right: this.outR.subarray(0, this.length) };
  }

  startRendering(): Promise<{ length: number; sampleRate: number; numberOfChannels: number; getChannelData: (c: number) => Float32Array }> {
    this.renderTo(this.length / this.sampleRate);
    const { left, right } = this.output();
    return Promise.resolve({
      length: this.length,
      sampleRate: this.sampleRate,
      numberOfChannels: 2,
      getChannelData: (c: number) => (c === 0 ? left : right),
    });
  }
}

/** Para pasar el contexto mini a código escrito contra `BaseAudioContext`. */
export const asBaseAudioContext = (c: MiniContext): BaseAudioContext => c as unknown as BaseAudioContext;
