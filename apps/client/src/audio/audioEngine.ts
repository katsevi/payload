/**
 * Motor de audio procedural con Web Audio API nativa (sin archivos ni dependencias).
 *
 *   música ─► musicBus ─► duck ─┐
 *   efectos ─► sfxBus ──────────┤
 *   bucles ──► loopBus ─► sfxBus │
 *   avisos ──► alertBus ────────┼─► master ─► limitador ─► salida
 *   voz ─────► alertBus ────────┘
 *
 * Reglas:
 *  - El AudioContext solo se crea en `unlock()`, llamado desde un gesto del usuario (política de autoplay).
 *  - Sin AudioContext (tests en node, navegadores antiguos) todo es un no-op: nunca lanza.
 *  - La decisión de QUÉ suena vive en `musicLogic.ts` / `soundLogic.ts` (puras); la síntesis en
 *    `musicSynth.ts` / `sfxSynth.ts` (sobre `SynthKit`, renderizable offline en los tests).
 *  - El limitador del master evita la saturación cuando se suman música, bucles y alarmas.
 *  - Los avisos (`alerts`) bajan la música un momento (ducking) para que se oigan sin subir el volumen.
 */
import { SILENT_MIX, sameMix, type MusicMix } from './musicLogic';
import { createMusic, type MusicGenerator } from './musicSynth';
import { synthSfx } from './sfxSynth';
import { SFX_META, type SfxId } from './soundLogic';
import { SynthKit } from './synthKit';

export interface Volumes {
  muteAll: boolean;
  /** 0-1 (curva cuadrática: el control es más fino en volúmenes bajos). */
  music: number;
  sfx: number;
  alerts: number;
}

export type EmitterKind = 'consoleHum' | 'exhibitHum';
export type Vec3 = readonly [number, number, number];

const MASTER_LEVEL = 0.8;
/** Nivel de los bucles con la partida en pausa (no se cortan del todo: no hay salto al volver). */
const PAUSED_LOOP_LEVEL = 0.12;
/** Cuánto baja la música con un aviso, y durante cuánto. */
const DUCK_LEVEL = 0.55;
const DUCK_HOLD_S = 0.9;

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

/** Construye la cadena de salida: master → limitador → destino. Exportado para el render offline. */
export function buildOutputChain(ctx: BaseAudioContext): { master: GainNode; limiter: DynamicsCompressorNode } {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 4;
  limiter.ratio.value = 16;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  limiter.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = MASTER_LEVEL;
  master.connect(limiter);
  return { master, limiter };
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private failed = false;
  private master: GainNode | null = null;
  private buses: Record<'music' | 'sfx' | 'alerts', GainNode | null> = { music: null, sfx: null, alerts: null };
  private loopBus: GainNode | null = null;
  private duck: GainNode | null = null;
  private kit: SynthKit | null = null;
  private music: MusicGenerator | null = null;
  private mix: MusicMix = { ...SILENT_MIX };
  private volumes: Volumes = { muteAll: false, music: 0.5, sfx: 0.8, alerts: 0.8 };
  private emitters = new Set<EmitterSpec>();
  private background = false;
  private paused = false;

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
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.buildGraph(this.ctx);
      this.applyVolumes();
      this.music?.setMix(this.mix, true);
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
    try {
      this.music?.setMix(this.mix, false);
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

  /** Partida en pausa: los bucles (motor, propulsores, viento) bajan casi a nada; la música sigue. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    const ctx = this.ctx;
    if (!ctx || !this.loopBus) return;
    try {
      const t = ctx.currentTime;
      this.loopBus.gain.cancelScheduledValues(t);
      this.loopBus.gain.setValueAtTime(this.loopBus.gain.value, t);
      this.loopBus.gain.setTargetAtTime(paused ? PAUSED_LOOP_LEVEL : 1, t, 0.15);
    } catch {
      /* ignorar */
    }
  }

  // ─── Efectos ──────────────────────────────────────────────────────────────

  /** Reproduce un efecto. No hace nada sin contexto o con todo silenciado. */
  play(id: SfxId): void {
    const ctx = this.ctx;
    const kit = this.kit;
    if (!ctx || !kit || this.volumes.muteAll || ctx.state === 'closed') return;
    try {
      // Un poco por delante del reloj: con el hilo principal ocupado (p. ej. compilando shaders al
      // saltar) las envolventes que empiezan «ya» llegan tarde y se recortan con un clic.
      synthSfx(kit, id, ctx.currentTime + 0.02);
      if (SFX_META[id].bus === 'alerts') this.duckMusic();
    } catch (e) {
      console.warn('[audio] fallo al sintetizar', id, e);
    }
  }

  /** Ajusta el volumen relativo (0-1) de un bucle que suena (p. ej. el viento que crece antes de la tormenta). */
  setLoopLevel(name: string, level: number): void {
    this.kit?.setLoopLevel(name, level);
  }

  /** Detiene un bucle (p. ej. el rugido del motor) con un fundido. */
  stopLoop(name: string, fadeS = 0.8): void {
    this.kit?.stopLoop(name, fadeS);
  }

  /** true si el bucle suena. */
  isLooping(name: string): boolean {
    return this.kit?.hasLoop(name) ?? false;
  }

  // ─── Sonido posicional ────────────────────────────────────────────────────

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
    if (this.kit) for (const name of [...this.kit.loops.keys()]) this.kit.stopLoop(name, 0);
    for (const e of this.emitters) e.live?.stop();
    this.emitters.clear();
    this.music?.stop();
    try {
      void this.ctx?.close();
    } catch {
      /* ignorar */
    }
    this.ctx = null;
    this.master = null;
    this.buses = { music: null, sfx: null, alerts: null };
    this.loopBus = null;
    this.duck = null;
    this.kit = null;
    this.music = null;
  }

  // ─── Interno: grafo ───────────────────────────────────────────────────────

  private buildGraph(ctx: AudioContext): void {
    const { master } = buildOutputChain(ctx);
    this.master = master;
    for (const k of ['music', 'sfx', 'alerts'] as const) {
      const g = ctx.createGain();
      this.buses[k] = g;
    }
    const duck = ctx.createGain();
    duck.connect(master);
    this.duck = duck;
    this.buses.music?.connect(duck);
    this.buses.sfx?.connect(master);
    this.buses.alerts?.connect(master);
    const loopBus = ctx.createGain();
    loopBus.gain.value = this.paused ? PAUSED_LOOP_LEVEL : 1;
    if (this.buses.sfx) loopBus.connect(this.buses.sfx);
    this.loopBus = loopBus;
    this.kit = new SynthKit(ctx, {
      music: this.buses.music,
      sfx: this.buses.sfx,
      alerts: this.buses.alerts,
      voice: this.buses.alerts,
      loops: loopBus,
    });
    this.startMusic();
  }

  private musicOn(): boolean {
    return !this.volumes.muteAll && this.volumes.music > 0.001;
  }

  /** Crea la música si no existe. */
  private startMusic(): MusicGenerator | null {
    const bus = this.buses.music;
    if (!this.kit || !bus || this.music || !this.musicOn()) return null;
    this.music = createMusic(this.kit, bus);
    return this.music;
  }

  /** Con volumen de música 0 se para la música: no gasta CPU hasta que se suba el volumen. */
  private stopMusic(): void {
    this.music?.stop();
    this.music = null;
  }

  private duckMusic(): void {
    const ctx = this.ctx;
    const d = this.duck;
    if (!ctx || !d) return;
    const t = ctx.currentTime;
    d.gain.cancelScheduledValues(t);
    d.gain.setValueAtTime(d.gain.value, t);
    d.gain.linearRampToValueAtTime(DUCK_LEVEL, t + 0.08);
    d.gain.setValueAtTime(DUCK_LEVEL, t + DUCK_HOLD_S);
    d.gain.linearRampToValueAtTime(1, t + DUCK_HOLD_S + 0.8);
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const v = this.volumes;
    const t = ctx.currentTime;
    if (this.musicOn()) {
      if (!this.music) this.startMusic()?.setMix(this.mix, true);
    } else {
      this.stopMusic();
    }
    const sq = (n: number) => Math.max(0, Math.min(1, n)) ** 2;
    this.master.gain.setTargetAtTime(v.muteAll ? 0 : MASTER_LEVEL, t, 0.05);
    this.buses.music?.gain.setTargetAtTime(sq(v.music), t, 0.1);
    this.buses.sfx?.gain.setTargetAtTime(sq(v.sfx), t, 0.05);
    this.buses.alerts?.gain.setTargetAtTime(sq(v.alerts), t, 0.05);
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
      const osc = (type: OscillatorType, freq: number, level: number) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.value = level;
        o.connect(g).connect(amp);
        o.start();
        oscs.push(o);
      };
      const lfo = (rate: number, depth: number) => {
        const o = ctx.createOscillator();
        o.frequency.value = rate;
        const g = ctx.createGain();
        g.gain.value = depth;
        o.connect(g).connect(amp.gain);
        o.start();
        oscs.push(o);
      };
      if (e.kind === 'consoleHum') {
        // zumbido eléctrico de la consola (100 Hz + armónico) con parpadeo lento
        osc('sine', 100, 0.5);
        osc('triangle', 200.7, 0.25);
        osc('sine', 1200, 0.04);
        lfo(0.35, 0.18);
      } else {
        // zumbido grave de la exhibición: batido de dos tonos casi iguales
        osc('sine', 62, 0.55);
        osc('sine', 64.5, 0.55);
        osc('triangle', 124, 0.12);
        lfo(0.2, 0.15);
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
