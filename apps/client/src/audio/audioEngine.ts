/**
 * Motor de audio procedural con Web Audio API nativa (sin archivos ni dependencias).
 *
 *   capas de música ─► musicBus ─┐
 *   efectos ─────────► sfxBus ───┼─► master ─► salida
 *   avisos y voz ────► alertBus ─┘
 *
 * Reglas:
 *  - El AudioContext solo se crea en `unlock()`, llamado desde un gesto del usuario (política de autoplay).
 *  - Sin AudioContext (tests en node, navegadores antiguos) todo es un no-op: nunca lanza.
 *  - La decisión de QUÉ suena vive en `musicLogic.ts` / `soundLogic.ts` (puras); aquí solo se sintetiza.
 */
import { MUSIC_LAYERS, SILENT_MIX, sameMix, type MusicLayer, type MusicMix } from './musicLogic';
import type { SfxId, SoundBus } from './soundLogic';

export interface Volumes {
  muteAll: boolean;
  /** 0-1 (curva cuadrática: el control es más fino en volúmenes bajos). */
  music: number;
  sfx: number;
  alerts: number;
}

export type EmitterKind = 'consoleHum' | 'exhibitHum';
export type Vec3 = readonly [number, number, number];

/** Segundos de fundido entre mezclas de música. */
const MUSIC_FADE_S = 1.6;
const MASTER_LEVEL = 0.8;

type Ctor = typeof AudioContext;
function audioCtor(): Ctor | null {
  const g = globalThis as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

interface EmitterSpec {
  kind: EmitterKind;
  pos: Vec3;
  live?: { stop: () => void };
}

interface Loop {
  stop: (fadeS: number) => void;
  /** Volumen relativo 0-1 del bucle (los que lo admiten). */
  level?: (v: number) => void;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private failed = false;
  private master: GainNode | null = null;
  private buses: Record<'music' | 'sfx' | 'alerts', GainNode | null> = { music: null, sfx: null, alerts: null };
  private layerGains: Partial<Record<MusicLayer, GainNode>> = {};
  /** Osciladores de la música (para pararlos con volumen 0) y colector activo durante su construcción. */
  private musicSources: OscillatorNode[] = [];
  private collecting = false;
  private mix: MusicMix = { ...SILENT_MIX };
  private volumes: Volumes = { muteAll: false, music: 0.5, sfx: 0.8, alerts: 0.8 };
  private noise: AudioBuffer | null = null;
  private loops = new Map<string, Loop>();
  private emitters = new Set<EmitterSpec>();
  private background = false;

  /** true si el navegador ofrece Web Audio. */
  isAvailable(): boolean {
    return audioCtor() !== null && !this.failed;
  }

  /** true cuando el contexto existe (se desbloqueó con un gesto). */
  isUnlocked(): boolean {
    return this.ctx !== null;
  }

  /** Crea (o reanuda) el AudioContext. Llamar desde un gesto del usuario. Devuelve true si hay audio. */
  unlock(): boolean {
    if (this.failed) return false;
    if (this.ctx) {
      this.syncRunState();
      return true;
    }
    const Ctx = audioCtor();
    if (!Ctx) return false;
    try {
      this.ctx = new Ctx();
      this.buildGraph(this.ctx);
      this.applyVolumes();
      this.applyMix(true);
      for (const e of this.emitters) this.startEmitter(e);
      this.syncRunState();
      return true;
    } catch (e) {
      console.warn('[audio] no se pudo iniciar Web Audio', e);
      this.failed = true;
      this.ctx = null;
      return false;
    }
  }

  setVolumes(v: Volumes): void {
    this.volumes = { ...v };
    if (!this.ctx) return;
    try {
      this.applyVolumes();
      this.syncRunState();
    } catch {
      /* contexto cerrado */
    }
  }

  /** Mezcla objetivo de la música (con fundido). Se recuerda aunque el contexto aún no exista. */
  setMusic(target: MusicMix): void {
    if (sameMix(target, this.mix)) return;
    this.mix = { ...target };
    if (!this.ctx) return;
    try {
      this.applyMix(false);
    } catch {
      /* ignorar */
    }
  }

  getMusic(): MusicMix {
    return { ...this.mix };
  }

  /** Pestaña oculta: se suspende el contexto para no gastar CPU. */
  setBackground(hidden: boolean): void {
    this.background = hidden;
    this.syncRunState();
  }

  // ─── Efectos ──────────────────────────────────────────────────────────────

  /** Reproduce un efecto. No hace nada sin contexto o con todo silenciado. */
  play(id: SfxId): void {
    const ctx = this.ctx;
    if (!ctx || this.volumes.muteAll || ctx.state === 'closed') return;
    try {
      this.synth(ctx, id, ctx.currentTime);
    } catch (e) {
      console.warn('[audio] fallo al sintetizar', id, e);
    }
  }

  /** Ajusta el volumen relativo (0-1) de un bucle que suena (p. ej. el viento que crece antes de la tormenta). */
  setLoopLevel(name: string, level: number): void {
    this.loops.get(name)?.level?.(level);
  }

  /** Detiene un bucle (p. ej. el rugido del motor) con un fundido. */
  stopLoop(name: string, fadeS = 0.8): void {
    this.loops.get(name)?.stop(fadeS);
    this.loops.delete(name);
  }

  // ─── Sonido posicional (sin uso todavía en la nave) ───────────────────────────────────────────

  /** Registra un emisor 3D. Devuelve la función que lo quita. Se activa al desbloquear el audio. */
  addEmitter(kind: EmitterKind, pos: Vec3): () => void {
    const spec: EmitterSpec = { kind, pos };
    this.emitters.add(spec);
    if (this.ctx) this.startEmitter(spec);
    return () => {
      spec.live?.stop();
      this.emitters.delete(spec);
    };
  }

  /** Posición y orientación del oyente (el jugador). `yaw` en radianes; adelante = (−sin, 0, −cos). */
  setListener(pos: Vec3, yaw: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const l = ctx.listener;
      if (l.positionX) {
        l.positionX.value = pos[0];
        l.positionY.value = pos[1];
        l.positionZ.value = pos[2];
        l.forwardX.value = -Math.sin(yaw);
        l.forwardY.value = 0;
        l.forwardZ.value = -Math.cos(yaw);
        l.upX.value = 0;
        l.upY.value = 1;
        l.upZ.value = 0;
      } else {
        l.setPosition?.(pos[0], pos[1], pos[2]);
        l.setOrientation?.(-Math.sin(yaw), 0, -Math.cos(yaw), 0, 1, 0);
      }
    } catch {
      /* ignorar */
    }
  }

  /** Libera todo (para tests y recarga en caliente). */
  dispose(): void {
    for (const l of this.loops.values()) l.stop(0);
    this.loops.clear();
    for (const e of this.emitters) e.live?.stop();
    this.emitters.clear();
    try {
      void this.ctx?.close();
    } catch {
      /* ignorar */
    }
    this.ctx = null;
    this.master = null;
    this.buses = { music: null, sfx: null, alerts: null };
    this.layerGains = {};
    this.musicSources = [];
    this.noise = null;
  }

  // ─── Interno: grafo ───────────────────────────────────────────────────────

  private buildGraph(ctx: AudioContext): void {
    const master = ctx.createGain();
    master.connect(ctx.destination);
    this.master = master;
    for (const k of ['music', 'sfx', 'alerts'] as const) {
      const g = ctx.createGain();
      g.connect(master);
      this.buses[k] = g;
    }
    this.startMusic();
  }

  private musicOn(): boolean {
    return !this.volumes.muteAll && this.volumes.music > 0.001;
  }

  /** Crea las capas de música si no existen. */
  private startMusic(): void {
    const ctx = this.ctx;
    const bus = this.buses.music;
    if (!ctx || !bus || this.musicSources.length > 0 || !this.musicOn()) return;
    this.collecting = true;
    try {
      this.buildMusic(ctx, bus);
    } finally {
      this.collecting = false;
    }
  }

  /** Con volumen de música 0 se paran las capas: no gastan CPU hasta que se suba el volumen. */
  private stopMusic(): void {
    for (const o of this.musicSources) {
      try {
        o.stop();
      } catch {
        /* ya detenido */
      }
    }
    this.musicSources = [];
    for (const g of Object.values(this.layerGains)) g?.disconnect();
    this.layerGains = {};
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const v = this.volumes;
    const t = ctx.currentTime;
    if (this.musicOn()) {
      if (this.musicSources.length === 0) {
        this.startMusic();
        this.applyMix(true);
      }
    } else {
      this.stopMusic();
    }
    const sq = (n: number) => Math.max(0, Math.min(1, n)) ** 2;
    this.master.gain.setTargetAtTime(v.muteAll ? 0 : MASTER_LEVEL, t, 0.05);
    this.buses.music?.gain.setTargetAtTime(sq(v.music), t, 0.1);
    this.buses.sfx?.gain.setTargetAtTime(sq(v.sfx), t, 0.05);
    this.buses.alerts?.gain.setTargetAtTime(sq(v.alerts), t, 0.05);
  }

  private applyMix(immediate: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const layer of MUSIC_LAYERS) {
      const g = this.layerGains[layer];
      if (!g) continue;
      if (immediate) g.gain.setValueAtTime(0, t);
      g.gain.setTargetAtTime(this.mix[layer] * 0.5, t, MUSIC_FADE_S / 3);
    }
  }

  /** Suspende el contexto con todo silenciado o en segundo plano; lo reanuda si no. */
  private syncRunState(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const idle = this.volumes.muteAll || this.background;
      if (idle) {
        if (ctx.state === 'running') void ctx.suspend();
      } else if (ctx.state === 'suspended') {
        void ctx.resume();
      }
    } catch {
      /* ignorar */
    }
  }

  // ─── Interno: música (cinco capas que corren siempre; solo cambia su ganancia) ──

  private osc(ctx: AudioContext, type: OscillatorType, freq: number, dest: AudioNode, level = 1, detune = 0): OscillatorNode {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = level;
    o.connect(g).connect(dest);
    o.start();
    if (this.collecting) this.musicSources.push(o);
    return o;
  }

  /** LFO que modula un parámetro: `param = base + lfo*depth`. */
  private lfo(ctx: AudioContext, rateHz: number, depth: number, param: AudioParam, type: OscillatorType = 'sine'): OscillatorNode {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = rateHz;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start();
    if (this.collecting) this.musicSources.push(o);
    return o;
  }

  private buildMusic(ctx: AudioContext, bus: GainNode): void {
    const layer = (name: MusicLayer): GainNode => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(bus);
      this.layerGains[name] = g;
      return g;
    };

    // pad: acorde de La menor suave (La2 Mi3 La3 Do4), filtrado y con respiración lenta
    {
      const out = layer('pad');
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 800;
      lp.connect(out);
      this.lfo(ctx, 0.08, 300, lp.frequency);
      for (const [f, d] of [[110, -6], [110, 7], [164.81, 0], [220, 4], [261.63, -3]] as const) {
        this.osc(ctx, f > 200 ? 'sine' : 'triangle', f, lp, 0.32, d);
      }
    }
    // pulse: pulso de telemetría (un "bip" grave-agudo que late ~1.4 Hz)
    {
      const out = layer('pulse');
      const amp = ctx.createGain();
      amp.gain.value = 0.5;
      amp.connect(out);
      this.lfo(ctx, 1.4, 0.5, amp.gain, 'square');
      this.osc(ctx, 'sine', 880, amp, 0.35);
      this.osc(ctx, 'sine', 1320.5, amp, 0.15);
    }
    // tension: tritono grave con trémolo
    {
      const out = layer('tension');
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 520;
      const amp = ctx.createGain();
      amp.gain.value = 0.7;
      lp.connect(amp).connect(out);
      this.lfo(ctx, 4.5, 0.3, amp.gain);
      this.osc(ctx, 'sawtooth', 98, lp, 0.4);
      this.osc(ctx, 'sawtooth', 138.6, lp, 0.3, 8);
    }
    // drive: bajo rítmico para el lanzamiento (quinta + fundamental con latido)
    {
      const out = layer('drive');
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 240;
      const amp = ctx.createGain();
      amp.gain.value = 0.6;
      lp.connect(amp).connect(out);
      this.lfo(ctx, 2.2, 0.4, amp.gain);
      this.osc(ctx, 'sawtooth', 55, lp, 0.6);
      this.osc(ctx, 'sawtooth', 82.4, lp, 0.4, 5);
    }
    // resolve: acorde de Do mayor luminoso
    {
      const out = layer('resolve');
      for (const [f, l] of [[261.63, 0.4], [329.63, 0.35], [392, 0.35], [523.25, 0.18]] as const) {
        this.osc(ctx, 'sine', f, out, l);
      }
    }
  }

  // ─── Interno: síntesis de efectos ─────────────────────────────────────────

  private busNode(bus: SoundBus): GainNode | null {
    return bus === 'sfx' ? this.buses.sfx : this.buses.alerts;
  }

  private getNoise(ctx: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const len = Math.max(1, Math.floor(ctx.sampleRate * 2));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return buf;
  }

  /** Tono con envolvente (ataque corto, caída exponencial) y deslizamiento de frecuencia opcional. */
  private tone(
    ctx: AudioContext, bus: SoundBus, at: number,
    o: { freq: number; dur: number; type?: OscillatorType; vol?: number; slideTo?: number },
  ): void {
    const dest = this.busNode(bus);
    if (!dest) return;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, at);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), at + o.dur);
    const g = ctx.createGain();
    const vol = o.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);
    osc.connect(g).connect(dest);
    osc.start(at);
    osc.stop(at + o.dur + 0.05);
  }

  /** Ráfaga de ruido filtrado; la frecuencia del filtro puede barrer de `f0` a `f1`. */
  private noiseBurst(
    ctx: AudioContext, bus: SoundBus, at: number,
    o: { dur: number; vol?: number; filter?: BiquadFilterType; f0: number; f1?: number; q?: number },
  ): void {
    const dest = this.busNode(bus);
    if (!dest) return;
    const src = ctx.createBufferSource();
    src.buffer = this.getNoise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = o.filter ?? 'lowpass';
    f.Q.value = o.q ?? 0.7;
    f.frequency.setValueAtTime(o.f0, at);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), at + o.dur);
    const g = ctx.createGain();
    const vol = o.vol ?? 0.3;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);
    src.connect(f).connect(g).connect(dest);
    src.start(at);
    src.stop(at + o.dur + 0.05);
  }

  private synth(ctx: AudioContext, id: SfxId, t: number): void {
    switch (id) {
      case 'click':
        this.tone(ctx, 'sfx', t, { freq: 1500, dur: 0.035, type: 'square', vol: 0.07 });
        break;
      case 'fixed':
        this.tone(ctx, 'sfx', t, { freq: 190, dur: 0.14, type: 'square', vol: 0.18, slideTo: 90 });
        this.tone(ctx, 'sfx', t + 0.03, { freq: 920, dur: 0.06, type: 'triangle', vol: 0.12 });
        this.noiseBurst(ctx, 'sfx', t, { dur: 0.08, vol: 0.12, filter: 'highpass', f0: 2500 });
        break;
      case 'toggle':
        this.tone(ctx, 'sfx', t, { freq: 520, dur: 0.12, type: 'triangle', vol: 0.15, slideTo: 240 });
        this.noiseBurst(ctx, 'sfx', t, { dur: 0.1, vol: 0.1, filter: 'highpass', f0: 2000 });
        break;
      case 'alarm':
        for (let k = 0; k < 3; k++) {
          this.tone(ctx, 'alerts', t + k * 0.42, { freq: 880, dur: 0.18, type: 'square', vol: 0.16 });
          this.tone(ctx, 'alerts', t + k * 0.42 + 0.2, { freq: 660, dur: 0.18, type: 'square', vol: 0.16 });
        }
        break;
      case 'ok':
        this.tone(ctx, 'alerts', t, { freq: 1568, dur: 0.09, vol: 0.2 });
        this.tone(ctx, 'alerts', t + 0.13, { freq: 2093, dur: 0.12, vol: 0.2 });
        break;
      case 'sparks':
        for (let k = 0; k < 5; k++) {
          this.noiseBurst(ctx, 'sfx', t + k * 0.11 + Math.random() * 0.04, {
            dur: 0.07 + Math.random() * 0.05, vol: 0.14 + Math.random() * 0.1, filter: 'bandpass', f0: 1800 + Math.random() * 1800, q: 1.2,
          });
        }
        break;
      case 'warnTick':
        this.tone(ctx, 'alerts', t, { freq: 880, dur: 0.1, vol: 0.2 });
        break;
      case 'jump':
        this.startRoar(ctx);
        break;
      case 'clunk':
        this.noiseBurst(ctx, 'sfx', t, { dur: 0.3, vol: 0.4, f0: 1800, f1: 300 });
        this.tone(ctx, 'sfx', t, { freq: 130, dur: 0.35, type: 'square', vol: 0.2, slideTo: 55 });
        this.tone(ctx, 'sfx', t + 0.05, { freq: 1900, dur: 0.05, type: 'triangle', vol: 0.1 });
        break;
      case 'impact':
        this.noiseBurst(ctx, 'alerts', t, { dur: 1.8, vol: 0.55, f0: 2200, f1: 90 });
        this.tone(ctx, 'alerts', t, { freq: 80, dur: 1.2, type: 'sawtooth', vol: 0.3, slideTo: 28 });
        break;
      case 'success':
      case 'complete':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => this.tone(ctx, 'alerts', t + k * 0.12, { freq: f, dur: 0.4, vol: 0.14 }));
        break;
      case 'descent':
        // Separación de la órbita: golpe metálico y zumbido descendente.
        this.noiseBurst(ctx, 'sfx', t, { dur: 0.5, vol: 0.35, f0: 1500, f1: 200 });
        this.tone(ctx, 'sfx', t, { freq: 220, dur: 1.4, type: 'sawtooth', vol: 0.12, slideTo: 70 });
        break;
      case 'thruster':
        this.startNoiseLoop(ctx, 'thruster', { bus: 'sfx', filter: 'bandpass', f0: 380, f1: 520, rampS: 0.15, vol: 0.5, subHz: 55, subVol: 0.25, flutterHz: 13 });
        break;
      case 'jetpack':
        this.startNoiseLoop(ctx, 'jetpack', { bus: 'sfx', filter: 'bandpass', f0: 900, f1: 1300, rampS: 0.08, vol: 0.28, subHz: 0, subVol: 0, flutterHz: 22 });
        break;
      case 'storm':
        this.startNoiseLoop(ctx, 'storm', { bus: 'sfx', filter: 'lowpass', f0: 300, f1: 1100, rampS: 3, vol: 0.55, subHz: 0, subVol: 0, flutterHz: 0.35 });
        break;
      case 'wind':
        // Viento que crece durante el aviso de tormenta (la escena sube su volumen con `setLoopLevel`).
        this.startNoiseLoop(ctx, 'wind', { bus: 'sfx', filter: 'bandpass', f0: 250, f1: 600, rampS: 1.5, vol: 0.4, subHz: 0, subVol: 0, flutterHz: 0.5 });
        this.setLoopLevel('wind', 0.15);
        break;
      case 'dodgeGraze':
        // Roce: chirrido metálico corto.
        this.noiseBurst(ctx, 'sfx', t, { dur: 0.25, vol: 0.3, filter: 'bandpass', f0: 2600, f1: 1400, q: 4 });
        break;
      case 'dodgeHit':
        this.noiseBurst(ctx, 'alerts', t, { dur: 0.7, vol: 0.6, f0: 1400, f1: 90 });
        this.tone(ctx, 'alerts', t, { freq: 80, dur: 0.5, type: 'sawtooth', vol: 0.3, slideTo: 35 });
        break;
      case 'skillHit':
        this.tone(ctx, 'sfx', t, { freq: 880, dur: 0.09, type: 'triangle', vol: 0.16 });
        this.tone(ctx, 'sfx', t + 0.07, { freq: 1320, dur: 0.12, type: 'triangle', vol: 0.14 });
        break;
      case 'skillMiss':
        this.tone(ctx, 'sfx', t, { freq: 220, dur: 0.16, type: 'square', vol: 0.1, slideTo: 160 });
        break;
      case 'extinguisher':
        this.startNoiseLoop(ctx, 'extinguisher', { bus: 'sfx', filter: 'highpass', f0: 2200, f1: 3200, rampS: 0.08, vol: 0.3, subHz: 0, subVol: 0, flutterHz: 9 });
        break;
      case 'toolPlace':
        // Patas que se clavan y un zumbido que arranca.
        this.noiseBurst(ctx, 'sfx', t, { dur: 0.15, vol: 0.3, filter: 'bandpass', f0: 500, q: 2 });
        this.tone(ctx, 'sfx', t + 0.12, { freq: 180, dur: 0.5, type: 'sawtooth', vol: 0.08, slideTo: 420 });
        break;
      case 'toolReady':
        // Tres pitidos ascendentes: «hay piezas».
        [988, 1175, 1480].forEach((f, k) => this.tone(ctx, 'alerts', t + k * 0.09, { freq: f, dur: 0.08, type: 'triangle', vol: 0.12 }));
        break;
      case 'toolDone':
        [1480, 1175, 988].forEach((f, k) => this.tone(ctx, 'alerts', t + k * 0.11, { freq: f, dur: 0.12, type: 'triangle', vol: 0.12 }));
        break;
      case 'toolStop':
        this.tone(ctx, 'alerts', t, { freq: 420, dur: 0.6, type: 'sawtooth', vol: 0.1, slideTo: 90 });
        break;
      case 'toolResume':
        this.tone(ctx, 'sfx', t, { freq: 120, dur: 0.5, type: 'sawtooth', vol: 0.08, slideTo: 420 });
        break;
      case 'sale':
        // Monedas: dos campanillas rápidas y un tintineo.
        this.tone(ctx, 'sfx', t, { freq: 1976, dur: 0.07, type: 'triangle', vol: 0.14 });
        this.tone(ctx, 'sfx', t + 0.07, { freq: 2637, dur: 0.12, type: 'triangle', vol: 0.13 });
        this.noiseBurst(ctx, 'sfx', t, { dur: 0.08, vol: 0.1, filter: 'highpass', f0: 5000 });
        break;
      case 'purchase':
        // Caja que se carga: golpe sordo y confirmación corta.
        this.noiseBurst(ctx, 'sfx', t, { dur: 0.12, vol: 0.2, f0: 900, f1: 250 });
        this.tone(ctx, 'sfx', t + 0.08, { freq: 784, dur: 0.1, type: 'triangle', vol: 0.12 });
        break;
      case 'upgrade':
        // Instalación: zumbido que sube y acorde de confirmación.
        this.tone(ctx, 'alerts', t, { freq: 220, dur: 0.35, type: 'sawtooth', vol: 0.07, slideTo: 660 });
        [659.25, 830.61, 987.77].forEach((f, k) => this.tone(ctx, 'alerts', t + 0.3 + k * 0.08, { freq: f, dur: 0.3, vol: 0.12 }));
        break;
      case 'noCredits':
        // Dos tonos graves cortos: «no».
        this.tone(ctx, 'alerts', t, { freq: 240, dur: 0.1, type: 'square', vol: 0.1 });
        this.tone(ctx, 'alerts', t + 0.13, { freq: 180, dur: 0.16, type: 'square', vol: 0.1 });
        break;
      case 'toolLost':
        this.tone(ctx, 'alerts', t, { freq: 330, dur: 0.3, vol: 0.14 });
        this.tone(ctx, 'alerts', t + 0.3, { freq: 220, dur: 0.5, vol: 0.14 });
        break;
      case 'fallWarn':
        // Dos tonos descendentes rápidos: «vas a golpear».
        this.tone(ctx, 'alerts', t, { freq: 980, dur: 0.12, type: 'square', vol: 0.12, slideTo: 700 });
        this.tone(ctx, 'alerts', t + 0.16, { freq: 980, dur: 0.12, type: 'square', vol: 0.12, slideTo: 700 });
        break;
      case 'takeOff':
        this.startNoiseLoop(ctx, 'takeOff', { bus: 'sfx', filter: 'lowpass', f0: 200, f1: 1400, rampS: 1, vol: 0.75, subHz: 38, subVol: 0.3, flutterHz: 0 });
        // Se apaga sola: el despegue dura unos segundos.
        setTimeout(() => this.stopLoop('takeOff', 2.5), 3500);
        break;
      case 'landSoft':
        this.noiseBurst(ctx, 'sfx', t, { dur: 0.6, vol: 0.4, f0: 900, f1: 120 });
        this.tone(ctx, 'sfx', t, { freq: 90, dur: 0.5, type: 'sine', vol: 0.3, slideTo: 45 });
        break;
      case 'landHard':
        this.noiseBurst(ctx, 'alerts', t, { dur: 2.2, vol: 0.7, f0: 2600, f1: 70 });
        this.tone(ctx, 'alerts', t, { freq: 70, dur: 1.5, type: 'sawtooth', vol: 0.4, slideTo: 24 });
        for (let k = 0; k < 4; k++) this.noiseBurst(ctx, 'alerts', t + 0.15 + k * 0.17, { dur: 0.12, vol: 0.25, filter: 'bandpass', f0: 2400 - k * 300, q: 2 });
        break;
      case 'airlock':
        // Siseo de presurización con un cierre al final.
        this.noiseBurst(ctx, 'sfx', t, { dur: 1.1, vol: 0.32, filter: 'highpass', f0: 3000, f1: 900 });
        this.tone(ctx, 'sfx', t + 1, { freq: 160, dur: 0.25, type: 'square', vol: 0.15, slideTo: 80 });
        break;
      case 'collect':
        this.tone(ctx, 'sfx', t, { freq: 1240, dur: 0.08, type: 'triangle', vol: 0.18 });
        this.tone(ctx, 'sfx', t + 0.08, { freq: 1660, dur: 0.12, type: 'triangle', vol: 0.16 });
        this.noiseBurst(ctx, 'sfx', t, { dur: 0.06, vol: 0.15, filter: 'highpass', f0: 3500 });
        break;
      case 'store':
        [392, 523.25, 659.25].forEach((f, k) => this.tone(ctx, 'sfx', t + k * 0.09, { freq: f, dur: 0.22, vol: 0.14 }));
        this.noiseBurst(ctx, 'sfx', t, { dur: 0.25, vol: 0.2, f0: 1200, f1: 300 });
        break;
      case 'stormWarn':
        this.noiseBurst(ctx, 'alerts', t, { dur: 3, vol: 0.3, filter: 'bandpass', f0: 250, f1: 900, q: 0.8 });
        this.tone(ctx, 'alerts', t, { freq: 660, dur: 0.18, vol: 0.14 });
        this.tone(ctx, 'alerts', t + 0.3, { freq: 660, dur: 0.18, vol: 0.14 });
        break;
      case 'crack':
        for (let k = 0; k < 6; k++) {
          this.noiseBurst(ctx, 'alerts', t + k * 0.07 + Math.random() * 0.05, { dur: 0.05 + Math.random() * 0.06, vol: 0.25, filter: 'bandpass', f0: 600 + Math.random() * 900, q: 3 });
        }
        this.tone(ctx, 'alerts', t, { freq: 60, dur: 0.6, type: 'sine', vol: 0.25, slideTo: 40 });
        break;
      case 'collapse':
        this.noiseBurst(ctx, 'alerts', t, { dur: 2.4, vol: 0.6, f0: 900, f1: 50 });
        this.tone(ctx, 'alerts', t, { freq: 55, dur: 2, type: 'sawtooth', vol: 0.3, slideTo: 22 });
        break;
      case 'o2Low':
        this.tone(ctx, 'alerts', t, { freq: 740, dur: 0.15, vol: 0.18 });
        this.tone(ctx, 'alerts', t + 0.22, { freq: 554, dur: 0.22, vol: 0.18 });
        break;
      case 'o2Critical':
        this.tone(ctx, 'alerts', t, { freq: 1320, dur: 0.09, type: 'square', vol: 0.12 });
        break;
      case 'breath':
      case 'breathFast': {
        // Inspiración y espiración: ruido filtrado dentro del casco del traje.
        const fast = id === 'breathFast';
        const inS = fast ? 0.32 : 0.7;
        this.noiseBurst(ctx, 'sfx', t, { dur: inS, vol: fast ? 0.14 : 0.07, filter: 'bandpass', f0: 700, f1: 1100, q: 1.2 });
        this.noiseBurst(ctx, 'sfx', t + inS + 0.05, { dur: inS * 1.2, vol: fast ? 0.11 : 0.05, filter: 'bandpass', f0: 1000, f1: 500, q: 1.2 });
        break;
      }
      case 'suitHit':
        this.noiseBurst(ctx, 'alerts', t, { dur: 0.35, vol: 0.5, f0: 1600, f1: 120 });
        this.noiseBurst(ctx, 'alerts', t + 0.1, { dur: 0.9, vol: 0.2, filter: 'highpass', f0: 4000, f1: 2500 });
        break;
      case 'crewDead':
        this.tone(ctx, 'alerts', t, { freq: 880, dur: 2.2, vol: 0.12 });
        this.tone(ctx, 'alerts', t, { freq: 110, dur: 2, type: 'sawtooth', vol: 0.16, slideTo: 40 });
        break;
      case 'jettison':
        this.noiseBurst(ctx, 'sfx', t, { dur: 0.6, vol: 0.35, f0: 700, f1: 150 });
        this.tone(ctx, 'sfx', t, { freq: 300, dur: 0.3, type: 'square', vol: 0.12, slideTo: 120 });
        break;
      case 'blip': {
        const n = 2 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) {
          const f = 520 + Math.random() * 480;
          this.tone(ctx, 'alerts', t + k * 0.07, { freq: f, dur: 0.06, type: 'triangle', vol: 0.09, slideTo: f * (0.85 + Math.random() * 0.4) });
        }
        break;
      }
    }
  }

  /** Rugido del motor: ruido filtrado que barre en frecuencia, hasta que se detiene con `stopLoop('roar')`. */
  private startRoar(ctx: AudioContext): void {
    this.stopLoop('roar', 0.1);
    const dest = this.buses.sfx;
    if (!dest) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.getNoise(ctx);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(180, t);
    lp.frequency.linearRampToValueAtTime(900, t + 4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.7, t + 1.2);
    // rumble grave
    const sub = ctx.createOscillator();
    sub.type = 'sawtooth';
    sub.frequency.value = 42;
    const subG = ctx.createGain();
    subG.gain.value = 0.18;
    sub.connect(subG).connect(g);
    src.connect(lp).connect(g).connect(dest);
    src.start(t);
    sub.start(t);
    this.loops.set('roar', {
      stop: (fadeS) => {
        const now = ctx.currentTime;
        try {
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(g.gain.value, now);
          g.gain.linearRampToValueAtTime(0.0001, now + Math.max(0.02, fadeS));
          src.stop(now + fadeS + 0.1);
          sub.stop(now + fadeS + 0.1);
        } catch {
          /* ya detenido */
        }
      },
    });
  }

  /** Bucle de ruido filtrado (propulsores, jetpack, viento) hasta `stopLoop(name)`. */
  private startNoiseLoop(
    ctx: AudioContext,
    name: string,
    o: { bus: SoundBus; filter: BiquadFilterType; f0: number; f1: number; rampS: number; vol: number; subHz: number; subVol: number; flutterHz: number },
  ): void {
    if (this.loops.has(name)) return;
    const dest = this.busNode(o.bus);
    if (!dest) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.getNoise(ctx);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.filter;
    f.Q.value = o.filter === 'bandpass' ? 0.9 : 0.7;
    f.frequency.setValueAtTime(o.f0, t);
    f.frequency.linearRampToValueAtTime(o.f1, t + Math.max(0.05, o.rampS));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vol, t + Math.max(0.03, o.rampS));
    const extra: OscillatorNode[] = [];
    if (o.subHz > 0) {
      const sub = ctx.createOscillator();
      sub.type = 'sawtooth';
      sub.frequency.value = o.subHz;
      const sg = ctx.createGain();
      sg.gain.value = o.subVol;
      sub.connect(sg).connect(g);
      sub.start(t);
      extra.push(sub);
    }
    if (o.flutterHz > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = o.flutterHz;
      const lg = ctx.createGain();
      lg.gain.value = o.vol * 0.3;
      lfo.connect(lg).connect(g.gain);
      lfo.start(t);
      extra.push(lfo);
    }
    src.connect(f).connect(g).connect(dest);
    src.start(t);
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
      stop: (fadeS) => {
        const now = ctx.currentTime;
        try {
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(g.gain.value, now);
          g.gain.linearRampToValueAtTime(0.0001, now + Math.max(0.02, fadeS));
          src.stop(now + fadeS + 0.1);
          for (const x of extra) x.stop(now + fadeS + 0.1);
        } catch {
          /* ya detenido */
        }
      },
    });
  }

  /** true si el bucle suena. */
  isLooping(name: string): boolean {
    return this.loops.has(name);
  }

  // ─── Interno: emisores posicionales ───────────────────────────────────────

  private startEmitter(e: EmitterSpec): void {
    const ctx = this.ctx;
    const dest = this.buses.sfx;
    if (!ctx || !dest || e.live) return;
    try {
      const panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1.5;
      panner.maxDistance = 30;
      panner.rolloffFactor = 1.8;
      if (panner.positionX) {
        panner.positionX.value = e.pos[0];
        panner.positionY.value = e.pos[1];
        panner.positionZ.value = e.pos[2];
      } else {
        panner.setPosition?.(e.pos[0], e.pos[1], e.pos[2]);
      }
      const amp = ctx.createGain();
      amp.gain.value = 0.5;
      amp.connect(panner).connect(dest);
      const oscs: OscillatorNode[] = [];
      if (e.kind === 'consoleHum') {
        // zumbido eléctrico de la consola (100 Hz + armónico) con parpadeo lento
        oscs.push(this.osc(ctx, 'sine', 100, amp, 0.5), this.osc(ctx, 'triangle', 200.7, amp, 0.25), this.osc(ctx, 'sine', 1200, amp, 0.04));
        oscs.push(this.lfo(ctx, 0.35, 0.18, amp.gain));
      } else {
        // zumbido grave de la exhibición (reactor del mecha): batido de dos tonos casi iguales
        oscs.push(this.osc(ctx, 'sine', 62, amp, 0.55), this.osc(ctx, 'sine', 64.5, amp, 0.55), this.osc(ctx, 'triangle', 124, amp, 0.12));
        oscs.push(this.lfo(ctx, 0.2, 0.15, amp.gain));
      }
      e.live = {
        stop: () => {
          for (const o of oscs) {
            try {
              o.stop();
            } catch {
              /* ya detenido */
            }
          }
          amp.disconnect();
        },
      };
    } catch (err) {
      console.warn('[audio] emisor 3D', err);
    }
  }
}

/** Motor compartido por toda la aplicación. */
export const audio = new AudioEngine();
