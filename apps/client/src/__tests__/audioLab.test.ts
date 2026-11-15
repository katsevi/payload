/**
 * Laboratorio de audio offline: valida el renderizador mínimo (`audio/offline/miniAudio.ts`) y mide TODOS los
 * sonidos del juego (efectos y escenas de música) contra la rúbrica `docs/diseno/audio-rubrica.md`.
 * Con `AUDIO_REPORT=1` (`pnpm --filter @payload/client audio:report`) escribe `audio-report/report.json` y un
 * WAV de 16 bits por sonido en `audio-report/wav/`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { SFX_IDS, LOOP_SFX } from '../audio/soundLogic';
import { analyze, detectClicks, evaluate, integratedLufs, toDb } from '../audio/offline/metrics';
import { MiniContext } from '../audio/offline/miniAudio';
import { encodeWav16, makeRand, measure, musicScenes, renderMusic, renderSfx, sliceResult, type Measured, type RenderResult } from '../audio/offline/render';

const SR = 48000;
/** Escenas de música: cortas en `pnpm test`; largas solo con `AUDIO_REPORT=1`. */
const MUSIC_S = process.env.AUDIO_REPORT === '1' ? 20 : 8;
/** El salto: arranque 2,4 s y crucero hasta que se para el bucle (6 s). */
const JUMP = { seconds: 7, stopLoopsAtS: 6 };

// ───────────────────────────── el renderizador ─────────────────────────────

describe('miniAudio: renderizador offline', () => {
  const sineCtx = (seconds: number, gain = 0.5) => {
    const ctx = new MiniContext({ seconds, sampleRate: SR });
    const o = ctx.createOscillator();
    o.frequency.value = 440;
    const g = ctx.createGain();
    g.gain.value = gain;
    o.connect(g).connect(ctx.destination);
    o.start(0);
    return { ctx, o, g };
  };

  it('un seno de 440 Hz da el pico, el RMS y el centroide esperados', () => {
    const { ctx } = sineCtx(1);
    ctx.renderTo(1);
    const { left, right } = ctx.output();
    const m = analyze(left, right, SR);
    expect(m.peakDb).toBeCloseTo(toDb(0.5), 1);
    expect(m.rmsDb).toBeCloseTo(toDb(0.5 / Math.SQRT2), 1);
    expect(Math.abs(m.spectral.centroidHz - 440)).toBeLessThan(40);
    expect(m.clipped).toBe(0);
  });

  it('un lowpass atenúa lo que está por encima de su corte y deja pasar lo de debajo', () => {
    const rms = (hz: number, filter: boolean): number => {
      const ctx = new MiniContext({ seconds: 0.5, sampleRate: SR });
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      if (filter) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 500;
        f.Q.value = 0;
        o.connect(f).connect(ctx.destination);
      } else o.connect(ctx.destination);
      o.start(0);
      ctx.renderTo(0.5);
      const { left } = ctx.output();
      return toDb(Math.sqrt(left.subarray(SR * 0.25).reduce((a, b) => a + b * b, 0) / (left.length - SR * 0.25)));
    };
    expect(rms(100, true) - rms(100, false)).toBeGreaterThan(-0.5);
    expect(rms(4000, true) - rms(4000, false)).toBeLessThan(-30);
  });

  it('las rampas lineales y exponenciales de ganancia son correctas', () => {
    const ctx = new MiniContext({ seconds: 1, sampleRate: SR });
    const c = ctx.createConstantSource();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(1, 1);
    c.connect(g).connect(ctx.destination);
    c.start(0);
    ctx.renderTo(1);
    const { left } = ctx.output();
    expect(left[SR / 2]).toBeCloseTo(0.5, 2);
    expect(left[SR / 4]).toBeCloseTo(0.25, 2);

    const e = new MiniContext({ seconds: 1, sampleRate: SR });
    const c2 = e.createConstantSource();
    const g2 = e.createGain();
    g2.gain.setValueAtTime(0.01, 0);
    g2.gain.exponentialRampToValueAtTime(1, 1);
    c2.connect(g2).connect(e.destination);
    c2.start(0);
    e.renderTo(1);
    expect(e.output().left[SR / 2]).toBeCloseTo(0.1, 2);
  });

  it('setTargetAtTime alcanza el 63 % en una constante de tiempo y las entradas a un AudioParam se suman (LFO)', () => {
    const ctx = new MiniContext({ seconds: 1, sampleRate: SR });
    const c = ctx.createConstantSource();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.setTargetAtTime(1, 0, 0.1);
    c.connect(g).connect(ctx.destination);
    c.start(0);
    ctx.renderTo(0.5);
    expect(ctx.output().left[Math.round(0.1 * SR)]).toBeCloseTo(1 - Math.exp(-1), 2);

    const t = new MiniContext({ seconds: 1, sampleRate: SR });
    const dc = t.createConstantSource();
    const am = t.createGain();
    am.gain.value = 0.5;
    const lfo = t.createOscillator();
    lfo.frequency.value = 1;
    const depth = t.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(am.gain);
    dc.connect(am).connect(t.destination);
    dc.start(0);
    lfo.start(0);
    t.renderTo(1);
    const out = t.output().left;
    expect(out[SR / 4]).toBeCloseTo(1, 2);
    expect(out[(SR * 3) / 4]).toBeCloseTo(0, 2);
  });

  it('un buffer en bucle con offset reproduce y el compresor limita', () => {
    const ctx = new MiniContext({ seconds: 0.5, sampleRate: SR });
    const buf = ctx.createBuffer(1, 100, SR);
    buf.getChannelData(0).fill(0.25);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(0, 0.001);
    s.connect(ctx.destination);
    ctx.renderTo(0.5);
    expect(ctx.output().left[SR * 0.4]).toBeCloseTo(0.25, 5);

    const c = new MiniContext({ seconds: 1, sampleRate: SR });
    const o = c.createOscillator();
    o.frequency.value = 220;
    const comp = c.createDynamicsCompressor();
    Object.assign(comp, { makeup: false });
    comp.threshold.value = -12;
    comp.knee.value = 0;
    comp.ratio.value = 20;
    o.connect(comp).connect(c.destination);
    o.start(0);
    c.renderTo(1);
    const m = analyze(c.output().left.subarray(SR / 2), c.output().right.subarray(SR / 2), SR);
    // Curva estática: -12 + 12/20 = -11.4 dB.
    expect(m.peakDb).toBeCloseTo(-11.4, 0);
  });

  it('un corte brusco se detecta como clic y uno con fundido, no', () => {
    const cut = (fadeS: number) => {
      const { ctx, g } = sineCtx(1);
      g.gain.setValueAtTime(0.5, 0.5);
      if (fadeS > 0) g.gain.linearRampToValueAtTime(0, 0.5 + fadeS);
      else g.gain.setValueAtTime(0, 0.5 + 1 / 4400);
      ctx.renderTo(1);
      const { left, right } = ctx.output();
      return detectClicks([left, right], SR);
    };
    expect(cut(0).count).toBeGreaterThanOrEqual(1);
    expect(cut(0.01).count).toBe(0);
  });

  it('el LUFS integrado de un seno de -20 dBFS (pico) a 1 kHz en estéreo es ~ -20 (K-weighting +0,7 dB)', () => {
    const x = new Float32Array(SR * 2);
    for (let i = 0; i < x.length; i++) x[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / SR);
    expect(integratedLufs([x, x], SR)).toBeCloseTo(-20.0, 0);
  });

  it('un bucle de ruido blanco a nivel alto es fallo duro (3.3) y uno filtrado y bajo, no', () => {
    const noise = (gain: number, lowpass: boolean) => {
      const ctx = new MiniContext({ seconds: 1, sampleRate: SR });
      const buf = ctx.createBuffer(1, SR, SR);
      const d = buf.getChannelData(0);
      const rand = makeRand(5);
      for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = gain;
      if (lowpass) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 300;
        src.connect(f).connect(g);
      } else src.connect(g);
      g.connect(ctx.destination);
      src.start(0);
      ctx.renderTo(1);
      const { left, right } = ctx.output();
      return evaluate(analyze(left, right, SR), 'ambient-loop');
    };
    expect(noise(0.2, false).hard.some((h) => /banda completa/.test(h))).toBe(true);
    expect(noise(0.2, true).hard.some((h) => /banda completa/.test(h))).toBe(false);
  });

  it('es determinista', () => {
    const a = renderSfx('sparks', { seconds: 1, rand: makeRand(3) });
    const b = renderSfx('sparks', { seconds: 1, rand: makeRand(3) });
    expect(Array.from(a.left.subarray(0, 4800))).toEqual(Array.from(b.left.subarray(0, 4800)));
  });
});

// ───────────────────────────── regresión de todos los sonidos ─────────────────────────────

const measured: { kind: 'sfx' | 'music'; m: Measured; r: RenderResult }[] = [];

describe('laboratorio: efectos (todos los SFX_IDS)', () => {
  it.each(SFX_IDS)('%s: sin clipping (antes y después del master), sin clics y con extremos limpios', { timeout: 30000 }, (id) => {
    const r = renderSfx(id, { seconds: 4, rand: makeRand(7), ...(id === 'jump' ? JUMP : {}) });
    const m = measure(r);
    measured.push({ kind: 'sfx', m, r });
    expect(m.verdict.hard, `${id}: ${m.verdict.hard.join(' | ')}`).toEqual([]);
    if (id === 'jump') {
      // El crucero (tras el arranque y antes de parar el bucle) se mide aparte: es lo que suena todo el tránsito.
      const cruise = sliceResult(r, 4.2, 5.8, 'jump-cruise');
      // Un tramo central de un bucle no tiene extremos propios.
      const mc = measure(cruise, 'ambient-loop', { midSlice: true });
      measured.push({ kind: 'sfx', m: mc, r: cruise });
      const hard = mc.verdict.hard;
      expect(hard, `jump-cruise: ${hard.join(' | ')}`).toEqual([]);
    }
  });
});

describe('laboratorio: música (escenas)', () => {
  it.each(Object.entries(musicScenes()))('%s: sin clipping ni clics', { timeout: 60000 }, (name, mix) => {
    const r = renderMusic(mix, { id: `music-${name}`, seconds: MUSIC_S, rand: makeRand(7) });
    const m = measure(r, 'music');
    measured.push({ kind: 'music', m, r });
    // La música es un bucle sin extremos propios: aquí solo cuentan el clipping y los clics.
    const hard = m.verdict.hard.filter((h) => !/inicio|final/.test(h));
    expect(hard, `${name}: ${hard.join(' | ')}`).toEqual([]);
  });
});

afterAll(() => {
  if (process.env.AUDIO_REPORT !== '1' || measured.length === 0) return;
  const dir = fileURLToPath(new URL('../../audio-report/', import.meta.url));
  mkdirSync(`${dir}wav`, { recursive: true });
  const num = (v: number): number | string => (Number.isFinite(v) ? Math.round(v * 100) / 100 : String(v));
  const rows = measured.map(({ kind, m, r }) => {
    writeFileSync(`${dir}wav/${r.id}.wav`, encodeWav16(r.left, r.right, r.sampleRate));
    const x = m.metrics;
    return {
      id: r.id,
      kind,
      loop: (LOOP_SFX as readonly string[]).includes(r.id),
      category: m.verdict.category,
      score: m.verdict.score,
      hard: m.verdict.hard,
      soft: m.verdict.soft,
      peakDb: num(x.peakDb),
      rmsDb: num(x.rmsDb),
      activeRmsDb: num(x.activeRmsDb),
      crestDb: num(x.crestDb),
      lufs: num(x.lufs),
      effectiveS: num(x.effectiveS),
      attackMs: num(x.attackS * 1000),
      centroidHz: Math.round(x.spectral.centroidHz),
      sub30Db: num(10 * Math.log10(Math.max(x.spectral.sub30Fraction, 1e-12))),
      flatness: num(x.spectral.flatness),
      clipped: x.clipped,
      preMasterPeak: num(m.pre.peak),
      preMasterClipped: m.pre.clipped,
      limiterInPeakDb: num(m.limiterInPeakDb),
      limiterOutPeakDb: num(m.limiterOutPeakDb),
      clicks: x.clicks.count,
      maxStep: num(x.clicks.maxStep),
      startAbs: num(x.startAbs),
      endAbs: num(x.endAbs),
    };
  });
  writeFileSync(`${dir}report.json`, JSON.stringify({ sampleRate: SR, sounds: rows }, null, 2));
});
