/**
 * Piezas de síntesis compartidas por la música (`musicSynth.ts`) y los efectos (`sfxSynth.ts`).
 * Solo dependen de un `BaseAudioContext`: funcionan igual con el contexto real del navegador y con el
 * renderizador offline de los tests (`offline/miniAudio.ts`), que mide picos, clics y espectro.
 */
import type { SoundBus } from './soundLogic';

export type KitBus = SoundBus | 'music' | 'loops';

/** Bucle en marcha (propulsor, viento, rugido del salto...). */
export interface Loop {
  stop: (fadeS: number) => void;
  /** Volumen relativo 0-1 del bucle (los que lo admiten). */
  level?: (v: number) => void;
}

export interface ToneOpts {
  freq: number;
  dur: number;
  type?: OscillatorType;
  vol?: number;
  slideTo?: number;
  /** Ataque en s (por defecto 5 ms; nunca menos de 2 ms para no hacer clic). */
  attack?: number;
  /** Desafinación en cents. */
  detune?: number;
  /** Paneo estéreo -1..1. */
  pan?: number;
}

export interface NoiseOpts {
  dur: number;
  vol?: number;
  filter?: BiquadFilterType;
  f0: number;
  f1?: number;
  q?: number;
  attack?: number;
  pan?: number;
}

export interface NoiseLoopOpts {
  bus: KitBus;
  filter: BiquadFilterType;
  f0: number;
  f1: number;
  rampS: number;
  vol: number;
  subHz: number;
  subVol: number;
  flutterHz: number;
  q?: number;
}

/** Duración mínima de las rampas de ganancia: por debajo se oyen clics. */
export const MIN_RAMP_S = 0.002;

export class SynthKit {
  private noiseBufs: AudioBuffer[] = [];
  readonly loops = new Map<string, Loop>();

  constructor(
    readonly ctx: BaseAudioContext,
    private readonly buses: Partial<Record<KitBus, AudioNode | null>>,
    /** Aleatoriedad de aspecto (no afecta al juego). Inyectable para renders reproducibles. */
    readonly rand: () => number = Math.random,
  ) {}

  bus(b: KitBus): AudioNode | null {
    return this.buses[b] ?? null;
  }

  /**
   * Ruido blanco (2 s). Hay varias semillas: dos bucles que suenan a la vez no deben compartir la
   * misma secuencia (sumados en fase suenan a «flanger»).
   */
  noise(variant = 0): AudioBuffer {
    const i = Math.abs(Math.floor(variant)) % 4;
    const cached = this.noiseBufs[i];
    if (cached) return cached;
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * 2));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // xorshift con semilla propia por variante: reproducible y descorrelado entre variantes.
    let s = (0x9e3779b9 ^ ((i + 1) * 0x85ebca6b)) >>> 0;
    for (let k = 0; k < data.length; k++) {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      data[k] = (s / 0xffffffff) * 2 - 1;
    }
    // Fundido en los extremos: el bucle no hace clic al volver al principio.
    const edge = Math.min(256, Math.floor(len / 4));
    for (let k = 0; k < edge; k++) {
      const w = k / edge;
      const a = data[k] ?? 0;
      const b = data[len - 1 - k] ?? 0;
      data[k] = a * w + b * (1 - w);
    }
    this.noiseBufs[i] = buf;
    return buf;
  }

  /** Nodo de salida con paneo opcional. */
  private out(bus: KitBus, pan?: number): AudioNode | null {
    const dest = this.bus(bus);
    if (!dest) return null;
    if (pan === undefined || pan === 0 || !('createStereoPanner' in this.ctx)) return dest;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(dest);
    return p;
  }

  /** Tono con envolvente (ataque corto, caída exponencial) y deslizamiento de frecuencia opcional. */
  tone(bus: KitBus, at: number, o: ToneOpts): void {
    const dest = this.out(bus, o.pan);
    if (!dest) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, at);
    if (o.detune) osc.detune.value = o.detune;
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), at + o.dur);
    const g = ctx.createGain();
    const vol = o.vol ?? 0.2;
    const atk = Math.max(MIN_RAMP_S, o.attack ?? 0.005);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vol, at + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(atk + 0.01, o.dur));
    osc.connect(g).connect(dest);
    osc.start(at);
    osc.stop(at + o.dur + 0.05);
  }

  /** Ráfaga de ruido filtrado; la frecuencia del filtro puede barrer de `f0` a `f1`. */
  noiseBurst(bus: KitBus, at: number, o: NoiseOpts): void {
    const dest = this.out(bus, o.pan);
    if (!dest) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(Math.floor(this.rand() * 4));
    const f = ctx.createBiquadFilter();
    f.type = o.filter ?? 'lowpass';
    f.Q.value = o.q ?? 0.7;
    f.frequency.setValueAtTime(o.f0, at);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), at + o.dur);
    const g = ctx.createGain();
    const vol = o.vol ?? 0.3;
    const atk = Math.max(MIN_RAMP_S, o.attack ?? 0.01);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vol, at + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(atk + 0.01, o.dur));
    src.connect(f).connect(g).connect(dest);
    // Desfase aleatorio dentro del buffer: dos ráfagas seguidas no suenan idénticas.
    src.start(at, this.rand() * 1.5);
    src.stop(at + o.dur + 0.05);
  }

  hasLoop(name: string): boolean {
    return this.loops.has(name);
  }

  setLoop(name: string, loop: Loop): void {
    this.loops.get(name)?.stop(0.05);
    this.loops.set(name, loop);
  }

  stopLoop(name: string, fadeS: number): void {
    this.loops.get(name)?.stop(fadeS);
    this.loops.delete(name);
  }

  setLoopLevel(name: string, level: number): void {
    this.loops.get(name)?.level?.(level);
  }

  /** Detiene con fundido una ganancia y las fuentes que cuelgan de ella. */
  fadeOut(g: GainNode, sources: AudioScheduledSourceNode[], fadeS: number): void {
    const now = this.ctx.currentTime;
    const f = Math.max(0.02, fadeS);
    try {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
      g.gain.linearRampToValueAtTime(0.0001, now + f);
      for (const s of sources) s.stop(now + f + 0.1);
    } catch {
      /* ya detenido */
    }
  }

  /** Bucle de ruido filtrado (propulsores, jetpack, viento) hasta `stopLoop(name)`. */
  startNoiseLoop(name: string, o: NoiseLoopOpts): void {
    if (this.loops.has(name)) return;
    const dest = this.bus(o.bus);
    if (!dest) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(this.loops.size + 1);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.filter;
    f.Q.value = o.q ?? (o.filter === 'bandpass' ? 0.9 : 0.7);
    f.frequency.setValueAtTime(o.f0, t);
    f.frequency.linearRampToValueAtTime(o.f1, t + Math.max(0.05, o.rampS));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vol, t + Math.max(0.03, o.rampS));
    const sources: AudioScheduledSourceNode[] = [src];
    if (o.subHz > 0) {
      // Subgrave senoidal (un diente de sierra a 40-60 Hz satura y zumba en altavoces pequeños).
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = o.subHz;
      const sg = ctx.createGain();
      sg.gain.value = o.subVol;
      sub.connect(sg).connect(g);
      sub.start(t);
      sources.push(sub);
    }
    if (o.flutterHz > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = o.flutterHz;
      const lg = ctx.createGain();
      lg.gain.value = o.vol * 0.3;
      lfo.connect(lg).connect(g.gain);
      lfo.start(t);
      sources.push(lfo);
    }
    src.connect(f).connect(g).connect(dest);
    src.start(t, this.rand() * 1.5);
    this.loops.set(name, {
      level: (v) => {
        try {
          const now = ctx.currentTime;
          g.gain.cancelScheduledValues(now);
          g.gain.setTargetAtTime(Math.max(0.0001, o.vol * Math.min(1, Math.max(0, v))), now, 0.25);
        } catch {
          /* detenido */
        }
      },
      stop: (fadeS) => this.fadeOut(g, sources, fadeS),
    });
  }
}
