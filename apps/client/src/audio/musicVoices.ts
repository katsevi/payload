/**
 * Voces y efectos de la música generativa (`musicSynth.ts`). Solo dependen de un `BaseAudioContext`.
 * Tres familias tímbricas: pad (dos osciladores desafinados con paso bajo), campana FM (seno modulado)
 * y bajo (seno + triángulo filtrados). Toda nota: ataque ≥ 5 ms y caída exponencial hasta 0,0001;
 * los nodos se desconectan al terminar (`onended`).
 */

export const mtof = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

const FLOOR = 0.0001;

/** Desconecta los nodos de una nota cuando su fuente termina (si el contexto lo admite). */
function cleanupOnEnd(src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  try {
    const cut = () => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* ya desconectado */
        }
      }
    };
    // Fuera del render: desconectar mientras el grafo suma sus entradas podría saltarse otra nota.
    src.onended = () => (typeof setTimeout === 'function' ? setTimeout(cut, 0) : cut());
  } catch {
    /* contexto sin onended */
  }
}

/** Salida con paneo estéreo (si el contexto lo admite). Devuelve el nodo al que conectar. */
function panned(ctx: BaseAudioContext, dest: AudioNode, pan: number, nodes: AudioNode[]): AudioNode {
  if (!pan || !('createStereoPanner' in ctx)) return dest;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(dest);
  nodes.push(p);
  return p;
}

export interface PadNote {
  midi: number;
  t: number;
  /** Segundos desde el inicio hasta que empieza el release. */
  hold: number;
  vel: number;
  attack: number;
  release: number;
  cutoff: number;
  pan?: number;
  /** Desafinación ± entre los dos osciladores (cents). */
  detune?: number;
}

/** Pad: triángulo + seno desafinados, paso bajo que se abre con el ataque. */
export function padNote(ctx: BaseAudioContext, dest: AudioNode, o: PadNote): void {
  const nodes: AudioNode[] = [];
  const out = panned(ctx, dest, o.pan ?? 0, nodes);
  const f = mtof(o.midi);
  const atk = Math.max(0.005, o.attack);
  const hold = Math.max(atk + 0.05, o.hold);
  const end = o.t + hold + o.release;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, o.t);
  g.gain.linearRampToValueAtTime(o.vel, o.t + atk);
  g.gain.setValueAtTime(o.vel, o.t + hold);
  g.gain.exponentialRampToValueAtTime(FLOOR, end);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.5;
  lp.frequency.setValueAtTime(o.cutoff * 0.55, o.t);
  lp.frequency.linearRampToValueAtTime(o.cutoff, o.t + atk);
  lp.frequency.linearRampToValueAtTime(o.cutoff * 0.7, end);
  lp.connect(g).connect(out);
  nodes.push(lp, g);
  const d = o.detune ?? 6;
  const a = ctx.createOscillator();
  a.type = 'triangle';
  a.frequency.value = f;
  a.detune.value = -d;
  const b = ctx.createOscillator();
  b.type = 'sine';
  b.frequency.value = f;
  b.detune.value = d;
  a.connect(lp);
  b.connect(lp);
  nodes.push(a, b);
  a.start(o.t);
  b.start(o.t);
  a.stop(end + 0.05);
  b.stop(end + 0.05);
  cleanupOnEnd(b, nodes);
}

export interface BellNote {
  midi: number;
  t: number;
  vel: number;
  /** Caída total (s). */
  decay: number;
  /** Relación moduladora/portadora: 2 = suave (telemetría), 3,5 = campana. */
  ratio: number;
  /** Índice de modulación inicial (brillo del golpe). */
  index: number;
  pan?: number;
}

/** Campana FM: el brillo cae más rápido que el volumen (golpe que se vuelve seno). */
export function bellNote(ctx: BaseAudioContext, dest: AudioNode, o: BellNote): void {
  const nodes: AudioNode[] = [];
  const out = panned(ctx, dest, o.pan ?? 0, nodes);
  const f = mtof(o.midi);
  const end = o.t + Math.max(0.1, o.decay);
  const car = ctx.createOscillator();
  car.type = 'sine';
  car.frequency.value = f;
  const mod = ctx.createOscillator();
  mod.type = 'sine';
  mod.frequency.value = f * o.ratio;
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(o.index * f, o.t);
  mg.gain.exponentialRampToValueAtTime(Math.max(0.01, o.index * f * 0.03), o.t + Math.max(0.08, o.decay * 0.45));
  mod.connect(mg).connect(car.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, o.t);
  g.gain.linearRampToValueAtTime(o.vel, o.t + 0.006);
  g.gain.exponentialRampToValueAtTime(FLOOR, end);
  car.connect(g).connect(out);
  nodes.push(car, mod, mg, g);
  car.start(o.t);
  mod.start(o.t);
  car.stop(end + 0.05);
  mod.stop(end + 0.05);
  cleanupOnEnd(car, nodes);
}

export interface BassNote {
  midi: number;
  t: number;
  hold: number;
  vel: number;
  attack: number;
  release: number;
  cutoff: number;
  /** Filtro que se cierra tras el golpe (ostinato del salto). */
  pluck?: boolean;
}

/** Bajo cálido: seno + triángulo suave por un paso bajo. Nunca por debajo de ~45 Hz en la partitura. */
export function bassNote(ctx: BaseAudioContext, dest: AudioNode, o: BassNote): void {
  const nodes: AudioNode[] = [];
  const f = mtof(o.midi);
  const atk = Math.max(0.005, o.attack);
  const hold = Math.max(atk + 0.02, o.hold);
  const end = o.t + hold + o.release;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.7;
  if (o.pluck) {
    lp.frequency.setValueAtTime(o.cutoff * 2.4, o.t);
    lp.frequency.setTargetAtTime(o.cutoff, o.t, 0.06);
  } else {
    lp.frequency.value = o.cutoff;
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, o.t);
  g.gain.linearRampToValueAtTime(o.vel, o.t + atk);
  g.gain.setValueAtTime(o.vel, o.t + hold);
  g.gain.exponentialRampToValueAtTime(FLOOR, end);
  lp.connect(g).connect(dest);
  const s = ctx.createOscillator();
  s.type = 'sine';
  s.frequency.value = f;
  const tri = ctx.createOscillator();
  tri.type = 'triangle';
  tri.frequency.value = f;
  const tg = ctx.createGain();
  tg.gain.value = 0.35;
  s.connect(lp);
  tri.connect(tg).connect(lp);
  nodes.push(lp, g, s, tri, tg);
  s.start(o.t);
  tri.start(o.t);
  s.stop(end + 0.05);
  tri.stop(end + 0.05);
  cleanupOnEnd(s, nodes);
}

/** Latido («lub-dub»): dos golpes de seno grave con caída de tono, el segundo más suave. */
export function heartbeat(ctx: BaseAudioContext, dest: AudioNode, t: number, vel: number): void {
  thump(ctx, dest, t, vel);
  thump(ctx, dest, t + 0.19, vel * 0.65);
}

function thump(ctx: BaseAudioContext, dest: AudioNode, t: number, vel: number): void {
  const end = t + 0.3;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.012);
  g.gain.exponentialRampToValueAtTime(FLOOR, end);
  g.connect(dest);
  const a = ctx.createOscillator();
  a.type = 'sine';
  a.frequency.setValueAtTime(72, t);
  a.frequency.exponentialRampToValueAtTime(56, t + 0.22);
  // Armónico: el latido se oye también en altavoces de portátil.
  const b = ctx.createOscillator();
  b.type = 'sine';
  b.frequency.setValueAtTime(144, t);
  b.frequency.exponentialRampToValueAtTime(112, t + 0.22);
  const bg = ctx.createGain();
  bg.gain.value = 0.45;
  a.connect(g);
  b.connect(bg).connect(g);
  a.start(t);
  b.start(t);
  a.stop(end + 0.05);
  b.stop(end + 0.05);
  cleanupOnEnd(a, [g, a, b, bg]);
}

export interface Fx {
  input: AudioNode;
  output: AudioNode;
}

/**
 * Reverb por convolución con una respuesta generada en código: ruido estéreo descorrelado con caída
 * exponencial (-60 dB en `seconds`) que se oscurece con el tiempo (paso bajo de un polo variable).
 * Sin `ConvolverNode` (renderizadores mínimos) devuelve un paso sin efecto.
 */
export function createReverb(ctx: BaseAudioContext, seconds = 3.2): Fx {
  const input = ctx.createGain();
  const output = ctx.createGain();
  if (!('createConvolver' in ctx)) return { input, output };
  try {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const ir = ctx.createBuffer(2, len, rate);
    const tau = seconds / 6.9;
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      let s = (0x2545f491 ^ ((ch + 1) * 0x9e3779b9)) >>> 0;
      let y = 0;
      for (let i = 0; i < len; i++) {
        s ^= s << 13;
        s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5;
        s >>>= 0;
        const x = (s / 0xffffffff) * 2 - 1;
        const tS = i / rate;
        const a = 0.55 - 0.47 * Math.min(1, tS / seconds);
        y += a * (x - y);
        // Subida de 8 ms al principio: la cola no empieza con un golpe.
        const fadeIn = Math.min(1, tS / 0.008);
        data[i] = y * Math.exp(-tS / tau) * fadeIn;
      }
    }
    const pre = ctx.createDelay(0.2);
    pre.delayTime.value = 0.025;
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    // Sin graves en la cola: no embarra el bajo ni suma energía < 30 Hz.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 160;
    input.connect(hp).connect(pre).connect(conv).connect(output);
  } catch {
    /* sin reverb */
  }
  return { input, output };
}

/** Eco estéreo suave (dos retardos con realimentación filtrada), para la telemetría y las campanas. */
export function createEcho(ctx: BaseAudioContext, leftS = 0.42, rightS = 0.63, feedback = 0.32): Fx {
  const input = ctx.createGain();
  const output = ctx.createGain();
  try {
    for (const [time, pan] of [
      [leftS, -0.6],
      [rightS, 0.6],
    ] as const) {
      const d = ctx.createDelay(2);
      d.delayTime.value = time;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      const fb = ctx.createGain();
      fb.gain.value = feedback;
      input.connect(d);
      d.connect(lp).connect(fb).connect(d);
      const o = panned(ctx, output, pan, []);
      lp.connect(o);
    }
  } catch {
    /* sin eco */
  }
  return { input, output };
}
