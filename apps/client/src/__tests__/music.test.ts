import { describe, expect, it } from 'vitest';
import { DANGER_TIERS, MUSIC_LAYERS, SILENT_MIX, dangerTier, musicMixFor, musicSceneFor, sameMix, type MusicMix } from '../audio/musicLogic';
import { createMusic } from '../audio/musicSynth';
import type { SynthKit } from '../audio/synthKit';

describe('música: lógica', () => {
  it('cada pantalla y fase tiene su escena', () => {
    expect(musicSceneFor({ screen: 'menu' })).toBe('menu');
    expect(musicSceneFor({ screen: 'design' })).toBe('hangar');
    expect(musicSceneFor({ screen: 'missions' })).toBe('hangar');
    expect(musicSceneFor({ screen: 'game', phase: 'docked' })).toBe('calm');
    expect(musicSceneFor({ screen: 'game', phase: 'transit' })).toBe('transit');
    expect(musicSceneFor({ screen: 'game', phase: 'landing' })).toBe('landing');
    expect(musicSceneFor({ screen: 'game', phase: 'surface', outside: true })).toBe('eva');
    expect(musicSceneFor({ screen: 'game', phase: 'surface', outside: false })).toBe('calm');
    expect(musicSceneFor({ screen: 'game', phase: 'won' })).toBe('won');
    expect(musicSceneFor({ screen: 'game', phase: 'lost' })).toBe('lost');
  });

  it('el peligro sube por escalones y cada escalón cambia una sola cosa', () => {
    expect(dangerTier(0)).toBe(0);
    expect(dangerTier(DANGER_TIERS[0])).toBe(1);
    expect(dangerTier(DANGER_TIERS[1])).toBe(2);
    expect(dangerTier(1)).toBe(3);
    const at = (d: number) => musicMixFor({ screen: 'game', phase: 'docked', danger: d });
    const [t0, t1, t2, t3] = [at(0), at(0.3), at(0.6), at(0.9)];
    expect([t0.tier, t1.tier, t2.tier, t3.tier]).toEqual([0, 1, 2, 3]);
    expect(t0.pulse).toBe(0);
    expect(t1.pulse).toBeGreaterThan(0);
    expect(t1.tension).toBe(0);
    expect(t2.tension).toBeGreaterThan(0);
    expect(t3.pulse).toBe(t2.pulse);
    // Un solo cambio por escalón: lo demás queda igual.
    for (const [a, b] of [[t0, t1], [t1, t2], [t2, t3]] as const) expect(MUSIC_LAYERS.filter((l) => a[l] !== b[l]).length).toBeLessThanOrEqual(1);
    // El menú, el hangar y los finales no oyen el peligro.
    expect(musicMixFor({ screen: 'menu', danger: 1 }).tier).toBe(0);
    expect(musicMixFor({ screen: 'game', phase: 'won', danger: 1 }).pulse).toBe(0);
  });

  it('pocas capas por escena y ganancias en [0, 1]', () => {
    for (const phase of ['docked', 'transit', 'landing', 'surface', 'won', 'lost'] as const) {
      for (const danger of [0, 0.4, 1]) {
        const m = musicMixFor({ screen: 'game', phase, danger, outside: true });
        for (const l of MUSIC_LAYERS) {
          expect(m[l]).toBeGreaterThanOrEqual(0);
          expect(m[l]).toBeLessThanOrEqual(1);
        }
        // Hasta 6 capas, pero de 3 familias (pad, campana, bajo).
        expect(MUSIC_LAYERS.filter((l) => m[l] > 0).length).toBeLessThanOrEqual(6);
      }
    }
  });

  it('sameMix distingue escena y escalón', () => {
    const a = musicMixFor({ screen: 'game', phase: 'docked', danger: 0 });
    expect(sameMix(a, { ...a })).toBe(true);
    expect(sameMix(a, { ...a, scene: 'transit' })).toBe(false);
    expect(sameMix(a, { ...a, tier: 1 })).toBe(false);
    expect(sameMix(SILENT_MIX, { ...SILENT_MIX })).toBe(true);
  });
});

// ─── Planificador contra un contexto simulado (sin Web Audio) ─────────────────

interface Started {
  at: number;
  stopAt: number;
}

/** Contexto mínimo: registra cuándo arrancan y paran las fuentes y lo agendado en cada parámetro. */
function fakeContext() {
  const state = { currentTime: 0, started: [] as Started[], pastEvents: 0 };
  const param = (value = 0) => {
    const p = {
      value,
      setValueAtTime: (_v: number, t: number) => check(t, p),
      linearRampToValueAtTime: (_v: number, t: number) => check(t, p),
      exponentialRampToValueAtTime: (v: number, t: number) => {
        if (v <= 0) throw new RangeError('exponencial a 0');
        return check(t, p);
      },
      setTargetAtTime: (_v: number, t: number) => check(t, p),
      cancelScheduledValues: () => p,
    };
    return p;
  };
  const check = <T,>(t: number, p: T): T => {
    if (t < state.currentTime - 1e-9) state.pastEvents++;
    return p;
  };
  const node = () => ({
    connect(dest: unknown) {
      return dest;
    },
    disconnect() {},
  });
  const source = () => {
    const rec: Started = { at: -1, stopAt: Infinity };
    return {
      ...node(),
      type: 'sine',
      frequency: param(440),
      detune: param(),
      onended: null as null | (() => void),
      start(t = state.currentTime) {
        rec.at = t;
        if (t < state.currentTime - 1e-9) state.pastEvents++;
        state.started.push(rec);
      },
      stop(t = state.currentTime) {
        rec.stopAt = t;
      },
    };
  };
  const ctx = {
    get currentTime() {
      return state.currentTime;
    },
    sampleRate: 8000,
    createGain: () => ({ ...node(), gain: param(1) }),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param(350), Q: param(1) }),
    createOscillator: source,
    createStereoPanner: () => ({ ...node(), pan: param() }),
    createDelay: () => ({ ...node(), delayTime: param() }),
    createConvolver: () => ({ ...node(), buffer: null }),
    createBuffer: (ch: number, len: number) => {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { getChannelData: (i: number) => data[i]! };
    },
  };
  return { state, ctx: ctx as unknown as BaseAudioContext };
}

function kitFor(ctx: BaseAudioContext): SynthKit {
  let s = 1;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  return { ctx, rand } as unknown as SynthKit;
}

describe('música: planificador', () => {
  const run = (mixes: { at: number; mix: MusicMix }[], untilS: number, jumpAt?: number) => {
    const { state, ctx } = fakeContext();
    const out = { connect: () => out, disconnect() {} } as unknown as AudioNode;
    const music = createMusic(kitFor(ctx), out, { autoSchedule: false });
    let maxVoices = 0;
    let mi = 0;
    for (let t = 0; t < untilS; t += 0.025) {
      // Bloqueo del hilo: el reloj salta 2 s sin que el planificador corra.
      state.currentTime = jumpAt !== undefined && t >= jumpAt && t < jumpAt + 2 ? jumpAt : t;
      if (jumpAt !== undefined && t >= jumpAt && t < jumpAt + 2) continue;
      while (mi < mixes.length && (mixes[mi]?.at ?? Infinity) <= t) music.setMix(mixes[mi++]!.mix, mi === 1);
      music.advance(t + 0.15);
      const live = state.started.filter((s) => s.at <= t && s.stopAt > t).length;
      maxVoices = Math.max(maxVoices, live);
    }
    music.stop();
    return { state, maxVoices };
  };

  it('nunca agenda en el pasado, ni tras un bloqueo, y respeta el tope de voces', () => {
    const calm = musicMixFor({ screen: 'game', phase: 'docked', danger: 0 });
    const hot = musicMixFor({ screen: 'game', phase: 'transit', danger: 1 });
    const { state, maxVoices } = run(
      [
        { at: 0, mix: musicMixFor({ screen: 'menu' }) },
        { at: 20, mix: calm },
        { at: 45, mix: hot },
      ],
      70,
      30,
    );
    expect(state.started.length).toBeGreaterThan(50);
    expect(state.pastEvents).toBe(0);
    // Cada nota usa 2 osciladores (pad, campana, bajo): ≤ 40 notas ≈ ≤ 80 fuentes.
    expect(maxVoices).toBeLessThanOrEqual(80);
  });

  it('en silencio no agenda nada', () => {
    const { state } = run([{ at: 0, mix: SILENT_MIX }], 10);
    expect(state.started.length).toBe(0);
  });
});
