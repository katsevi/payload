/**
 * Música adaptativa: capas que corren siempre y cuya ganancia fija `musicLogic.musicMixFor`.
 * El motor llama a `createMusic` al desbloquear el audio y a `setMix` en cada cambio de mezcla.
 */
import { MUSIC_LAYERS, type MusicLayer, type MusicMix } from './musicLogic';
import type { SynthKit } from './synthKit';

export interface MusicGenerator {
  /** Aplica la mezcla con fundido (`immediate` = parte de 0, al crearse). */
  setMix(mix: MusicMix, immediate: boolean): void;
  /** Para y libera todo. */
  stop(): void;
}

const FADE_S = 1.6;

export function createMusic(k: SynthKit, out: AudioNode): MusicGenerator {
  const ctx = k.ctx;
  const sources: AudioScheduledSourceNode[] = [];
  const gains: Partial<Record<MusicLayer, GainNode>> = {};
  const osc = (type: OscillatorType, freq: number, dest: AudioNode, level = 1, detune = 0) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = level;
    o.connect(g).connect(dest);
    o.start();
    sources.push(o);
  };
  const lfo = (rateHz: number, depth: number, param: AudioParam) => {
    const o = ctx.createOscillator();
    o.frequency.value = rateHz;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start();
    sources.push(o);
  };
  const layer = (name: MusicLayer): GainNode => {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(out);
    gains[name] = g;
    return g;
  };
  {
    const o = layer('pad');
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 800;
    lp.connect(o);
    lfo(0.08, 300, lp.frequency);
    for (const [f, d] of [[110, -6], [110, 7], [164.81, 0], [220, 4], [261.63, -3]] as const) osc(f > 200 ? 'sine' : 'triangle', f, lp, 0.2, d);
  }
  {
    const o = layer('pulse');
    const amp = ctx.createGain();
    amp.gain.value = 0.5;
    amp.connect(o);
    lfo(1.4, 0.45, amp.gain);
    osc('sine', 880, amp, 0.2);
  }
  {
    const o = layer('tension');
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const amp = ctx.createGain();
    amp.gain.value = 0.7;
    lp.connect(amp).connect(o);
    lfo(4.5, 0.3, amp.gain);
    osc('sawtooth', 98, lp, 0.25);
    osc('sawtooth', 138.6, lp, 0.2, 8);
  }
  {
    const o = layer('drive');
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    const amp = ctx.createGain();
    amp.gain.value = 0.6;
    lp.connect(amp).connect(o);
    lfo(2.2, 0.4, amp.gain);
    osc('triangle', 55, lp, 0.5);
    osc('triangle', 82.4, lp, 0.35, 5);
  }
  {
    const o = layer('resolve');
    for (const [f, l] of [[261.63, 0.25], [329.63, 0.22], [392, 0.22], [523.25, 0.12]] as const) osc('sine', f, o, l);
  }
  return {
    setMix(mix, immediate) {
      const t = ctx.currentTime;
      for (const l of MUSIC_LAYERS) {
        const g = gains[l];
        if (!g) continue;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(immediate ? 0 : g.gain.value, t);
        g.gain.setTargetAtTime(mix[l] * 0.5, t, FADE_S / 3);
      }
    },
    stop() {
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          /* ya detenido */
        }
      }
      for (const g of Object.values(gains)) g?.disconnect();
    },
  };
}
