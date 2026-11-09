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

  /** Detiene un bucle (p. ej. el rugido del motor) con un fundido. */
  stopLoop(name: string, fadeS = 0.8): void {
    this.loops.get(name)?.stop(fadeS);
    this.loops.delete(name);
  }

  // ─── Sonido posicional (hangar) ───────────────────────────────────────────

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
      case 'mount':
        this.tone(ctx, 'sfx', t, { freq: 190, dur: 0.14, type: 'square', vol: 0.18, slideTo: 90 });
        this.tone(ctx, 'sfx', t + 0.03, { freq: 920, dur: 0.06, type: 'triangle', vol: 0.12 });
        this.noiseBurst(ctx, 'sfx', t, { dur: 0.08, vol: 0.12, filter: 'highpass', f0: 2500 });
        break;
      case 'unmount':
        this.tone(ctx, 'sfx', t, { freq: 520, dur: 0.12, type: 'triangle', vol: 0.15, slideTo: 240 });
        this.noiseBurst(ctx, 'sfx', t, { dur: 0.1, vol: 0.1, filter: 'highpass', f0: 2000 });
        break;
      case 'batteryAlarm':
        for (let k = 0; k < 3; k++) {
          this.tone(ctx, 'alerts', t + k * 0.42, { freq: 880, dur: 0.18, type: 'square', vol: 0.16 });
          this.tone(ctx, 'alerts', t + k * 0.42 + 0.2, { freq: 660, dur: 0.18, type: 'square', vol: 0.16 });
        }
        break;
      case 'contact':
        this.tone(ctx, 'alerts', t, { freq: 1568, dur: 0.09, vol: 0.2 });
        this.tone(ctx, 'alerts', t + 0.13, { freq: 2093, dur: 0.12, vol: 0.2 });
        break;
      case 'radioStatic':
        for (let k = 0; k < 5; k++) {
          this.noiseBurst(ctx, 'sfx', t + k * 0.11 + Math.random() * 0.04, {
            dur: 0.07 + Math.random() * 0.05, vol: 0.14 + Math.random() * 0.1, filter: 'bandpass', f0: 1800 + Math.random() * 1800, q: 1.2,
          });
        }
        break;
      case 'countdownTick':
        this.tone(ctx, 'alerts', t, { freq: 880, dur: 0.1, vol: 0.2 });
        break;
      case 'liftoff':
        this.startRoar(ctx);
        break;
      case 'separation':
        this.noiseBurst(ctx, 'sfx', t, { dur: 0.3, vol: 0.4, f0: 1800, f1: 300 });
        this.tone(ctx, 'sfx', t, { freq: 130, dur: 0.35, type: 'square', vol: 0.2, slideTo: 55 });
        this.tone(ctx, 'sfx', t + 0.05, { freq: 1900, dur: 0.05, type: 'triangle', vol: 0.1 });
        break;
      case 'explosion':
        this.noiseBurst(ctx, 'alerts', t, { dur: 1.8, vol: 0.55, f0: 2200, f1: 90 });
        this.tone(ctx, 'alerts', t, { freq: 80, dur: 1.2, type: 'sawtooth', vol: 0.3, slideTo: 28 });
        break;
      case 'success':
      case 'complete':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => this.tone(ctx, 'alerts', t + k * 0.12, { freq: f, dur: 0.4, vol: 0.14 }));
        break;
      case 'mascotBlip': {
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
