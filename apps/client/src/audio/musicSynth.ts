/**
 * Música adaptativa generativa (síntesis Web Audio en tiempo real, sin archivos).
 *
 * Estructura
 * - Planificador con anticipación: un temporizador cada 25 ms agenda las corcheas que caen en los
 *   próximos 0,15 s con `ctx.currentTime`; si el temporizador llega tarde (shaders, GPU lenta) la
 *   anticipación crece sola hasta 2 s. Tras un bloqueo salta las corcheas pasadas, toca la que tocaba un
 *   poco tarde (nunca en el pasado) y rehace el pad si quedó un hueco. `advance(until)` agenda de forma
 *   síncrona (render offline sin temporizador).
 * - Escenas (`MusicScene` de `musicLogic`), todas con raíz común en Re; cambian de modo y tempo.
 *   El cambio de escena se aplica al empezar el compás siguiente (el acorde cambia en el compás) y
 *   cruza dos buses: el viejo se apaga y el nuevo entra con fundidos de ~2 s.
 *     menu     Re lidio, 66 BPM: tema principal en campana (cada dos vueltas), pad sin tercera, bajo.
 *     hangar   Re mixolidio, 72 BPM: arpegio de telemetría en corcheas, pad, bajo.
 *     calm     Re dórico, 60 BPM: pad lento, bajo en pedal, telemetría dispersa, una campana cada 8-15 s.
 *     transit  Re eólico, 72 BPM: ostinato de bajo en corcheas (impulso), pad, arpegio.
 *     landing  Re frigio, 66 BPM: pedal de Re con el bajo que sube a Mi♭, negras contenidas.
 *     eva      Re (quintas), 54 BPM: pad muy tenue y díadas de quinta cada 10-20 s; casi silencio.
 *     won      Re mayor/lidio, 66 BPM: el tema del menú resuelto (tercera mayor) con acordes rodados.
 *     lost     Re menor, 52 BPM: lamento de una vuelta que acaba en suspenso; luego un dron tenue.
 * - Peligro (`tier` de la mezcla, una variable por escalón): 1 latido por pulso, 2 dron de tritono
 *   (Sol♯), 3 latido al doble.
 * - Voces (`musicVoices.ts`), tres familias: pad (pad, tension), campana FM (arp, bell) y bajo
 *   (bass, drive, pulse). Máximo ~40 notas vivas; reverb de convolución (respuesta generada) y eco
 *   compartidos por todas las escenas. Paso alto a 40 Hz en la salida: nada por debajo de 30 Hz.
 * - Nivel: lecho de -30 a -22 dBFS RMS con los volúmenes por defecto (bus 0,25 × 0,7 × maestro 0,8).
 */
import { MUSIC_LAYERS, SILENT_MIX, type MusicLayer, type MusicMix, type MusicScene } from './musicLogic';
import { bassNote, bellNote, createEcho, createReverb, heartbeat, padNote } from './musicVoices';
import type { SynthKit } from './synthKit';

export interface MusicGenerator {
  /**
   * Aplica la mezcla con fundido (`immediate` = la escena entra en el pulso siguiente, sin esperar el
   * compás). `atS` (opcional, tiempo del contexto) aplaza el cambio: lo usa el render offline.
   */
  setMix(mix: MusicMix, immediate: boolean, atS?: number): void;
  /** Agenda de forma síncrona hasta `untilS` (tiempo del contexto). */
  advance(untilS: number): void;
  /** Para el planificador y apaga con una rampa corta. */
  stop(): void;
}

export interface MusicOptions {
  /** Arranca el temporizador del planificador (por defecto sí; el render offline usa `advance`). */
  autoSchedule?: boolean;
}

// ─── Partitura ──────────────────────────────────────────────────────────────

interface Chord {
  /** Nota MIDI del bajo (0 = sin bajo). D2 = 38 (73 Hz); nunca por debajo de 33 (55 Hz). */
  bass: number;
  pad: readonly number[];
}

/** [pulso dentro de la vuelta, nota MIDI, duración en pulsos]. */
type MelodyNote = readonly [number, number, number];

interface Score {
  bpm: number;
  beatsPerChord: number;
  chords: readonly Chord[];
  padCutoff: number;
  padVel: number;
  padAttack: number;
  bassVel: number;
  drive: 'none' | 'eighths' | 'quarters';
  arp: { mode: 'none' | 'sparse' | 'pattern'; prob: number; low: number; high: number; vel: number };
  bell: 'none' | 'theme' | 'events' | 'fifths' | 'lament';
  /** Cada cuántas vueltas suena el tema (1 = siempre). */
  themeEvery?: number;
  /** Acorde rodado en campana al empezar cada acorde. */
  roll?: boolean;
  melody?: readonly MelodyNote[];
  /** Una sola vuelta completa; después, solo un dron tenue. */
  once?: boolean;
}

/** Tema principal (Re lidio, 32 pulsos). Original: arco A–E–A–Sol♯ que vuelve a Re. */
const THEME: readonly MelodyNote[] = [
  [0, 69, 2], [2, 76, 2], [4, 74, 1], [5, 76, 1], [6, 81, 2],
  [8, 80, 3], [11, 78, 1], [12, 76, 4],
  [16, 74, 2], [18, 78, 2], [20, 81, 1.5], [21.5, 83, 0.5], [22, 81, 2],
  [24, 78, 3], [27, 76, 1], [28, 74, 4],
];
/** Lamento (Re menor, 24 pulsos): baja de Re a Mi sin volver a la tónica. */
const LAMENT: readonly MelodyNote[] = [
  [0, 74, 3], [3, 72, 1], [4, 69, 2],
  [6, 70, 3], [9, 69, 3],
  [12, 67, 2], [14, 65, 4],
  [18, 64, 6],
];

const NO_ARP = { mode: 'none', prob: 0, low: 0, high: 0, vel: 0 } as const;

const SCORES: Record<Exclude<MusicScene, 'none'>, Score> = {
  menu: {
    bpm: 66,
    beatsPerChord: 8,
    chords: [
      { bass: 38, pad: [50, 57, 64, 69] },
      { bass: 38, pad: [52, 56, 59, 66] },
      { bass: 35, pad: [47, 54, 57, 62] },
      { bass: 43, pad: [50, 55, 59, 66] },
    ],
    padCutoff: 1300,
    padVel: 0.075,
    padAttack: 2.5,
    bassVel: 0.15,
    drive: 'none',
    arp: { mode: 'sparse', prob: 0.16, low: 74, high: 90, vel: 0.28 },
    bell: 'theme',
    themeEvery: 2,
    melody: THEME,
  },
  hangar: {
    bpm: 72,
    beatsPerChord: 8,
    chords: [
      { bass: 38, pad: [50, 57, 62, 64] },
      { bass: 36, pad: [48, 52, 55, 62] },
      { bass: 43, pad: [50, 55, 59, 64] },
      { bass: 45, pad: [52, 57, 60, 64] },
    ],
    padCutoff: 1000,
    padVel: 0.06,
    padAttack: 2,
    bassVel: 0.14,
    drive: 'none',
    arp: { mode: 'pattern', prob: 0.7, low: 62, high: 81, vel: 0.26 },
    bell: 'none',
  },
  calm: {
    bpm: 60,
    beatsPerChord: 8,
    chords: [
      { bass: 38, pad: [50, 53, 57, 64] },
      { bass: 38, pad: [50, 55, 59, 64] },
      { bass: 41, pad: [53, 57, 60, 64] },
      { bass: 40, pad: [52, 55, 60, 62] },
    ],
    padCutoff: 1000,
    padVel: 0.07,
    padAttack: 3,
    bassVel: 0.15,
    drive: 'none',
    arp: { mode: 'sparse', prob: 0.2, low: 69, high: 86, vel: 0.28 },
    bell: 'events',
  },
  transit: {
    bpm: 72,
    beatsPerChord: 8,
    chords: [
      { bass: 38, pad: [50, 57, 62, 65] },
      { bass: 46, pad: [50, 53, 58, 62] },
      { bass: 48, pad: [52, 55, 60, 64] },
      { bass: 45, pad: [52, 57, 60, 64] },
    ],
    padCutoff: 900,
    padVel: 0.06,
    padAttack: 2,
    bassVel: 0.15,
    drive: 'eighths',
    arp: { mode: 'pattern', prob: 0.55, low: 69, high: 86, vel: 0.22 },
    bell: 'none',
  },
  landing: {
    bpm: 66,
    beatsPerChord: 8,
    chords: [
      { bass: 38, pad: [50, 57, 62, 65] },
      { bass: 39, pad: [51, 55, 58, 62] },
      { bass: 38, pad: [50, 57, 60, 65] },
      { bass: 39, pad: [51, 55, 58, 63] },
    ],
    padCutoff: 800,
    padVel: 0.065,
    padAttack: 2.5,
    bassVel: 0.15,
    drive: 'quarters',
    arp: { mode: 'sparse', prob: 0.12, low: 62, high: 77, vel: 0.24 },
    bell: 'none',
  },
  eva: {
    bpm: 54,
    beatsPerChord: 16,
    chords: [
      { bass: 0, pad: [50, 57, 64] },
      { bass: 0, pad: [45, 52, 59] },
    ],
    padCutoff: 700,
    padVel: 0.12,
    padAttack: 4,
    bassVel: 0,
    drive: 'none',
    arp: NO_ARP,
    bell: 'fifths',
  },
  won: {
    bpm: 66,
    beatsPerChord: 8,
    chords: [
      { bass: 38, pad: [50, 54, 57, 64] },
      { bass: 38, pad: [52, 56, 59, 66] },
      { bass: 35, pad: [47, 54, 57, 62] },
      { bass: 43, pad: [50, 55, 59, 66] },
    ],
    padCutoff: 1500,
    padVel: 0.075,
    padAttack: 2,
    bassVel: 0.15,
    drive: 'none',
    arp: NO_ARP,
    bell: 'theme',
    themeEvery: 1,
    roll: true,
    melody: THEME,
  },
  lost: {
    bpm: 52,
    beatsPerChord: 6,
    chords: [
      { bass: 38, pad: [50, 53, 57, 62] },
      { bass: 46, pad: [50, 53, 58, 62] },
      { bass: 43, pad: [50, 55, 58, 62] },
      { bass: 45, pad: [45, 50, 52, 57] },
    ],
    padCutoff: 800,
    padVel: 0.1,
    padAttack: 2,
    bassVel: 0.14,
    drive: 'none',
    arp: NO_ARP,
    bell: 'lament',
    melody: LAMENT,
    once: true,
  },
};

/** Dron de tensión (escalón 2): tritono de Re. */
const TENSION_NOTES = [56, 68] as const;
const DRIVE_PATTERN = [0, 0, 12, 0, 7, 0, 12, 7] as const;

/** [envío a reverb, envío a eco] de cada capa. */
const SENDS: Record<MusicLayer, readonly [number, number]> = {
  pad: [0.55, 0],
  bass: [0.06, 0],
  arp: [0.35, 0.45],
  bell: [0.6, 0.3],
  drive: [0.1, 0],
  pulse: [0.04, 0],
  tension: [0.6, 0],
};

// ─── Mezcla y tiempos ───────────────────────────────────────────────────────

/** Ganancia de salida del generador (calibrada para -30..-22 dBFS RMS tras bus 0,25 × `BUS_TRIM.music` 0,7 y maestro 0,8). */
const OUTPUT_LEVEL = 2.1;
const LOOKAHEAD_S = 0.15;
const MAX_LOOKAHEAD_S = 2;
const TIMER_MS = 25;
/** Margen mínimo para agendar: nunca en el pasado. */
const SAFETY_S = 0.02;
/** Constante de tiempo de los fundidos de capa (≈ 95 % en 2,1 s). */
const FADE_TAU_S = 0.7;
const MAX_VOICES = 40;
/** Un bus de escena se desconecta tras apagarse (deja sonar las colas). */
const BUS_LINGER_S = 16;

interface SceneBus {
  scene: MusicScene;
  layers: Record<MusicLayer, GainNode> | null;
  /** Instante en que entra (puede estar por delante de `currentTime`). */
  startAt: number;
  deadAt: number;
}

export function createMusic(k: SynthKit, out: AudioNode, opts: MusicOptions = {}): MusicGenerator {
  const ctx = k.ctx;
  const rand = k.rand;

  // Salida: paso alto (sin subgraves) → nivel con fundido de entrada → bus de música.
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.linearRampToValueAtTime(OUTPUT_LEVEL, ctx.currentTime + 1.5);
  master.connect(out);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 40;
  hp.Q.value = 0.7;
  hp.connect(master);
  const reverb = createReverb(ctx, 3.2);
  const wet = ctx.createGain();
  wet.gain.value = 0.7;
  reverb.output.connect(wet).connect(hp);
  const echo = createEcho(ctx);
  const echoRet = ctx.createGain();
  echoRet.gain.value = 0.5;
  echo.output.connect(echoRet);
  echoRet.connect(hp);
  const echoToRev = ctx.createGain();
  echoToRev.gain.value = 0.3;
  echoRet.connect(echoToRev).connect(reverb.input);

  const makeBus = (scene: MusicScene, t: number, mix: MusicMix): SceneBus => {
    if (scene === 'none') return { scene, layers: null, startAt: t, deadAt: Infinity };
    const layers = {} as Record<MusicLayer, GainNode>;
    for (const l of MUSIC_LAYERS) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.setTargetAtTime(mix[l], t, FADE_TAU_S);
      g.connect(hp);
      const [rv, ec] = SENDS[l];
      if (rv > 0) {
        const s = ctx.createGain();
        s.gain.value = rv;
        g.connect(s).connect(reverb.input);
      }
      if (ec > 0) {
        const s = ctx.createGain();
        s.gain.value = ec;
        g.connect(s).connect(echo.input);
      }
      layers[l] = g;
    }
    return { scene, layers, startAt: t, deadAt: Infinity };
  };

  // ─── Estado del planificador ───
  let bus: SceneBus = { scene: 'none', layers: null, startAt: 0, deadAt: Infinity };
  const dying: SceneBus[] = [];
  let mix: MusicMix = { ...SILENT_MIX };
  let pending: { mix: MusicMix; at: number; immediate: boolean } | null = null;
  let score: Score | null = null;
  let bpm = 60;
  let nextT = ctx.currentTime + 0.1;
  /** Corchea dentro de la escena actual (2 por pulso). */
  let eighth = 0;
  let padUntil = 0;
  let tensionUntil = 0;
  let bassUntil = 0;
  let nextEventT = 0;
  let stopped = false;
  const voiceEnds: number[] = [];

  const room = (now: number, essential: boolean): boolean => {
    for (let i = voiceEnds.length - 1; i >= 0; i--) if ((voiceEnds[i] ?? 0) < now) voiceEnds.splice(i, 1);
    return essential || voiceEnds.length < MAX_VOICES;
  };
  const on = (l: MusicLayer): boolean => mix[l] > 0.01;
  const human = (v: number): number => v * (0.85 + rand() * 0.3);

  const switchScene = (next: MusicMix, t: number): void => {
    // El bus viejo se apaga con fundido y se libera más tarde (sus colas siguen sonando dentro).
    if (bus.layers) {
      for (const l of MUSIC_LAYERS) bus.layers[l].gain.setTargetAtTime(0, t, FADE_TAU_S);
      bus.deadAt = t + BUS_LINGER_S;
      dying.push(bus);
    }
    mix = next;
    bus = makeBus(next.scene, t, next);
    score = next.scene === 'none' ? null : SCORES[next.scene];
    if (score) bpm = score.bpm;
    eighth = 0;
    padUntil = 0;
    tensionUntil = 0;
    bassUntil = 0;
    nextEventT = t + 3 + rand() * 4;
  };

  const releaseDead = (now: number): void => {
    for (let i = dying.length - 1; i >= 0; i--) {
      const b = dying[i];
      if (!b || b.deadAt > now) continue;
      if (b.layers) for (const l of MUSIC_LAYERS) b.layers[l].disconnect();
      dying.splice(i, 1);
    }
  };

  /** Agenda una corchea de la escena en el instante `t`. */
  const scheduleEighth = (t: number): void => {
    const p = pending;
    const barStart = eighth % 8 === 0;
    if (p && p.at <= t + 1e-6 && (barStart || p.immediate || bus.scene === 'none')) {
      pending = null;
      switchScene(p.mix, t);
    }
    const sc = score;
    const L = bus.layers;
    if (!sc || !L) return;
    const spb = 60 / bpm;
    const beat = Math.floor(eighth / 2);
    const half = eighth % 2;
    const cycleBeats = sc.beatsPerChord * sc.chords.length;
    const cycle = Math.floor(beat / cycleBeats);
    const inCycle = beat % cycleBeats;
    const chordIdx = Math.floor(inCycle / sc.beatsPerChord);
    const chord = sc.chords[chordIdx] ?? sc.chords[0]!;
    const posInChord = inCycle % sc.beatsPerChord;
    const chordEnd = t + (sc.beatsPerChord - posInChord) * spb - half * spb * 0.5;
    const faded = sc.once === true && cycle >= 1;

    // Pad: un acorde por cambio (o rehecho si un bloqueo dejó un hueco).
    if (half === 0 && on('pad') && (posInChord === 0 || padUntil < t)) {
      const notes = faded ? [50, 57] : chord.pad;
      const vel = faded ? sc.padVel * 0.6 : sc.padVel;
      const hold = chordEnd - t + 0.3;
      notes.forEach((m, i) => {
        if (!room(t, true)) return;
        const release = 3;
        padNote(ctx, L.pad, {
          midi: m,
          t,
          hold,
          vel: vel * (0.9 + rand() * 0.2),
          attack: posInChord === 0 ? sc.padAttack : 0.6,
          release,
          cutoff: sc.padCutoff * (0.9 + rand() * 0.2),
          pan: notes.length > 1 ? -0.45 + (0.9 * i) / (notes.length - 1) : 0,
          detune: 5 + rand() * 4,
        });
        voiceEnds.push(t + hold + release);
      });
      padUntil = chordEnd;
    }

    // Bajo largo (una nota por acorde).
    if (half === 0 && on('bass') && chord.bass > 0 && !faded && (posInChord === 0 || bassUntil < t)) {
      const hold = chordEnd - t - 0.1;
      if (hold > 0.3 && room(t, true)) {
        bassNote(ctx, L.bass, { midi: chord.bass, t, hold, vel: sc.bassVel, attack: 0.08, release: 1.2, cutoff: 320 });
        voiceEnds.push(t + hold + 1.2);
      }
      bassUntil = chordEnd;
    }

    // Ostinato del bajo: corcheas (salto) o negras (descenso).
    if (on('drive') && chord.bass > 0) {
      if (sc.drive === 'eighths' && room(t, false)) {
        const step = DRIVE_PATTERN[eighth % DRIVE_PATTERN.length] ?? 0;
        const accent = eighth % 4 === 0 ? 1 : 0.7;
        bassNote(ctx, L.drive, { midi: chord.bass + step, t, hold: spb * 0.3, vel: human(0.17 * accent), attack: 0.012, release: 0.3, cutoff: 260, pluck: true });
        voiceEnds.push(t + spb * 0.3 + 0.3);
      } else if (sc.drive === 'quarters' && half === 0 && beat % 4 !== 3 && room(t, false)) {
        bassNote(ctx, L.drive, { midi: chord.bass, t, hold: spb * 0.4, vel: human(beat % 4 === 0 ? 0.2 : 0.15), attack: 0.015, release: 0.4, cutoff: 240, pluck: true });
        voiceEnds.push(t + spb * 0.4 + 0.4);
      }
    }

    // Telemetría: arpegio de campana suave sobre las notas del acorde.
    if (on('arp') && sc.arp.mode !== 'none' && !faded) {
      const pool: number[] = [];
      for (const m of chord.pad) for (const o of [12, 24]) if (m + o >= sc.arp.low && m + o <= sc.arp.high) pool.push(m + o);
      pool.sort((a, b) => a - b);
      if (pool.length > 0 && rand() < sc.arp.prob && room(t, false)) {
        let midi: number;
        if (sc.arp.mode === 'pattern') {
          const n = pool.length;
          const span = Math.max(1, 2 * n - 2);
          const i = eighth % span;
          midi = pool[i < n ? i : span - i] ?? pool[0]!;
        } else {
          midi = pool[Math.floor(rand() * pool.length)] ?? pool[0]!;
        }
        // Retraso humano pequeño y siempre positivo (nunca en el pasado).
        const at = t + rand() * 0.012;
        bellNote(ctx, L.arp, { midi, t: at, vel: human(sc.arp.vel), decay: 0.9, ratio: 2, index: 0.8, pan: rand() * 1.2 - 0.6 });
        voiceEnds.push(at + 0.9);
      }
    }

    // Campanas: tema, eventos sueltos, quintas o lamento.
    if (on('bell')) {
      const themeOn = sc.melody && (sc.bell === 'lament' ? cycle === 0 : sc.bell === 'theme' && cycle % (sc.themeEvery ?? 1) === 0);
      if (themeOn && sc.melody) {
        for (const [b, midi, dur] of sc.melody) {
          const offBeats = b - inCycle - half * 0.5;
          if (offBeats < 0 || offBeats >= 0.5) continue;
          if (!room(t, true)) break;
          const decay = Math.min(5, 1.4 + dur * spb * 0.8);
          bellNote(ctx, L.bell, { midi, t: t + offBeats * spb, vel: human(0.28), decay, ratio: 3.5, index: 1.1, pan: 0.1 });
          voiceEnds.push(t + offBeats * spb + decay);
        }
      }
      if (sc.roll && half === 0 && posInChord === 0) {
        chord.pad.forEach((m, i) => {
          if (!room(t, false)) return;
          const at = t + i * spb * 0.5;
          bellNote(ctx, L.bell, { midi: m + 12, t: at, vel: human(0.1), decay: 2.5, ratio: 2, index: 0.6, pan: -0.5 + i * 0.33 });
          voiceEnds.push(at + 2.5);
        });
      }
      if ((sc.bell === 'events' || sc.bell === 'fifths') && half === 0 && t >= nextEventT && room(t, false)) {
        if (sc.bell === 'events') {
          const pool = chord.pad.map((m) => m + 24).filter((m) => m <= 88);
          const midi = pool[Math.floor(rand() * pool.length)] ?? 74;
          bellNote(ctx, L.bell, { midi, t, vel: human(0.18), decay: 4, ratio: 3.5, index: 1, pan: rand() * 1.4 - 0.7 });
          voiceEnds.push(t + 4);
          nextEventT = t + 8 + rand() * 7;
        } else {
          const root = (chord.pad[0] ?? 50) + 24;
          bellNote(ctx, L.bell, { midi: root, t, vel: human(0.15), decay: 5, ratio: 3.5, index: 0.9, pan: -0.3 });
          bellNote(ctx, L.bell, { midi: root + 7, t: t + spb * 0.5, vel: human(0.13), decay: 5, ratio: 3.5, index: 0.9, pan: 0.3 });
          voiceEnds.push(t + 5, t + spb * 0.5 + 5);
          nextEventT = t + 10 + rand() * 10;
        }
      }
    }

    // Peligro 1+: latido (2: además el dron de tritono; 3: latido en cada corchea).
    if (on('pulse') && mix.tier >= 1 && (mix.tier >= 3 || half === 0) && room(t, true)) {
      heartbeat(ctx, L.pulse, t, 0.3);
      voiceEnds.push(t + 0.55);
    }
    if (half === 0 && on('tension') && mix.tier >= 2 && (posInChord === 0 || tensionUntil < t)) {
      const hold = chordEnd - t + 0.3;
      for (const m of TENSION_NOTES) {
        if (!room(t, true)) break;
        padNote(ctx, L.tension, { midi: m, t, hold, vel: m > 60 ? 0.025 : 0.045, attack: 2.5, release: 2.5, cutoff: 700, pan: m > 60 ? 0.35 : -0.35, detune: 11 });
        voiceEnds.push(t + hold + 2.5);
      }
      tensionUntil = chordEnd;
    }
  };

  /** Agenda todas las corcheas que empiezan antes de `horizon`. */
  const scheduleUntil = (horizon: number): void => {
    if (stopped) return;
    const now = ctx.currentTime;
    const step = () => 30 / bpm;
    // Atrasado (hilo bloqueado o contexto reanudado): salta las corcheas ya pasadas y toca la que tocaba
    // un poco tarde (la rejilla se desplaza; nada se agenda en el pasado).
    if (nextT < now + SAFETY_S) {
      eighth += Math.floor((now + SAFETY_S - nextT) / step());
      nextT = now + SAFETY_S;
    }
    while (nextT < horizon) {
      scheduleEighth(nextT);
      nextT += step();
      eighth++;
    }
    releaseDead(now);
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  if (opts.autoSchedule !== false && typeof setInterval === 'function') {
    // Anticipación adaptable: si el hilo principal va a tirones (shaders, GPU lenta) el temporizador
    // llega tarde; se agenda más por delante (hasta 2 s) para que no queden huecos.
    let lastTick = ctx.currentTime;
    let maxGap = 0;
    timer = setInterval(() => {
      try {
        const now = ctx.currentTime;
        maxGap = Math.max(now - lastTick, maxGap * 0.97);
        lastTick = now;
        scheduleUntil(now + Math.min(MAX_LOOKAHEAD_S, Math.max(LOOKAHEAD_S, maxGap * 1.3 + 0.05)));
      } catch {
        /* contexto cerrado */
      }
    }, TIMER_MS);
  }

  return {
    setMix(next, immediate, atS) {
      if (stopped) return;
      const at = Math.max(atS ?? ctx.currentTime, ctx.currentTime);
      if (next.scene === bus.scene) {
        // Misma escena (o vuelta a ella antes de que cambiara: se anula el cambio pendiente).
        pending = null;
        mix = { ...next };
        // El bus pudo agendarse por delante: el fundido nuevo va después de su entrada.
        const from = Math.max(at, bus.startAt);
        if (bus.layers) for (const l of MUSIC_LAYERS) bus.layers[l].gain.setTargetAtTime(next[l], from, FADE_TAU_S);
        return;
      }
      pending = { mix: { ...next }, at, immediate };
      // El tiempo real lo agenda el temporizador; sin él, el cambio espera al próximo `advance`.
    },
    advance(untilS) {
      scheduleUntil(untilS);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      try {
        const t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), t);
        master.gain.linearRampToValueAtTime(0.0001, t + 0.4);
      } catch {
        /* contexto cerrado */
      }
      const cut = () => {
        try {
          master.disconnect();
        } catch {
          /* ya desconectado */
        }
      };
      if (typeof setTimeout === 'function') setTimeout(cut, 600);
      else cut();
    },
  };
}
