/**
 * Síntesis de los efectos de sonido: qué capas suenan para cada `SfxId`. Todo pasa por `SynthKit`, así
 * que se puede renderizar offline en los tests (picos, clics, espectro).
 *
 * Paleta común (ver `docs/diseno/audio-rubrica.md`):
 *  - consola / interfaz: FM suave y triángulos cálidos (`s.fm`, `tone` triangular);
 *  - mecánico: golpe grave senoidal + ruido filtrado (`thud`, `servo`, `latch`);
 *  - alarmas: cuadrada con paso bajo en 800-1600 Hz, cada una con su patrón (inequívocas entre sí);
 *  - sin dientes de sierra crudos ni ruido de banda ancha a nivel alto.
 */
import { SFX_GAIN, type SfxId } from './soundLogic';
import type { SynthKit } from './synthKit';

/** Golpe sordo: seno que cae de `freq` y un transitorio de ruido paso bajo. */
function thud(s: SynthKit, bus: 'sfx' | 'alerts', t: number, freq: number, dur: number, vol: number, click = 0.5): void {
  s.tone(bus, t, { freq, slideTo: Math.max(35, freq * 0.5), dur, vol, attack: 0.003 });
  if (click > 0) s.noiseBurst(bus, t, { dur: Math.min(0.12, dur * 0.5), vol: vol * click, filter: 'lowpass', f0: 1400, f1: 300, attack: 0.002 });
}

/** Servo corto: ruido de banda estrecha que sube (`up`) o baja más un tono de motor. */
function servo(s: SynthKit, t: number, dur: number, vol: number, up: boolean): void {
  const a = up ? 700 : 1700;
  const b = up ? 1700 : 700;
  s.noiseBurst('sfx', t, { dur, vol, filter: 'bandpass', f0: a, f1: b, q: 5, attack: 0.006 });
  s.tone('sfx', t, { freq: up ? 240 : 520, slideTo: up ? 520 : 240, dur, type: 'triangle', vol: vol * 0.7, attack: 0.006, lowpass: 1500 });
}

/** Cierre metálico seco: tic agudo breve y golpe grave. */
function latch(s: SynthKit, t: number, vol: number, low = 120): void {
  s.noiseBurst('sfx', t, { dur: 0.035, vol: vol * 0.8, filter: 'bandpass', f0: 3200, q: 6, attack: 0.002 });
  s.tone('sfx', t, { freq: low, slideTo: low * 0.6, dur: 0.09, vol, attack: 0.002 });
}

/** Pulso de alarma: cuadrada filtrada con un toque de FM para que no suene a pitido crudo. */
function pulse(s: SynthKit, t: number, freq: number, dur: number, vol: number, slideTo?: number): void {
  s.tone('alerts', t, { freq, dur, type: 'square', vol, slideTo, lowpass: 1600, attack: 0.003 });
}

/**
 * Fachada del kit para un sonido: aplica su ganancia (`SFX_GAIN`) y mantiene un tramo a volumen pleno en
 * tonos y ráfagas (`hold`), de modo que el nivel se mide en RMS y no solo en pico. Los bucles escalan `vol`.
 */
function shaped(kit: SynthKit, gain: number): SynthKit {
  const f = Object.create(kit) as SynthKit;
  f.tone = (bus, at, o) => kit.tone(bus, at, { hold: o.dur * 0.4, ...o, vol: (o.vol ?? 0.2) * gain });
  f.fm = (bus, at, o) => kit.fm(bus, at, { hold: o.dur * 0.4, ...o, vol: (o.vol ?? 0.15) * gain });
  f.noiseBurst = (bus, at, o) => kit.noiseBurst(bus, at, { hold: o.dur * 0.3, ...o, vol: (o.vol ?? 0.3) * gain });
  f.startNoiseLoop = (name, o) => kit.startNoiseLoop(name, { ...o, vol: o.vol * gain, subVol: o.subVol * gain });
  return f;
}

export function synthSfx(kit: SynthKit, id: SfxId, t: number): void {
  // `jump` conserva su nivel (ya afinado aparte).
  const s = id === 'jump' ? kit : shaped(kit, SFX_GAIN[id] ?? 1);
  const R = s.rand;
  const pan = (w = 0.12) => (R() * 2 - 1) * w;
  switch (id) {
    // ─── Interfaz (consola: FM cálida) ───────────────────────────────────────
    case 'click':
      s.tone('sfx', t, { freq: 1250 + R() * 80, slideTo: 760, dur: 0.035, type: 'triangle', vol: 0.198, attack: 0.002 });
      break;
    case 'hover':
      s.tone('sfx', t, { freq: 1500 + R() * 200, dur: 0.028, vol: 0.12, attack: 0.004 });
      break;
    case 'select':
      s.fm('sfx', t, { freq: 880, dur: 0.07, vol: 0.18, ratio: 2, index: 0.5 });
      s.fm('sfx', t + 0.06, { freq: 1175, dur: 0.1, vol: 0.18, ratio: 2, index: 0.5 });
      break;
    case 'panelOpen':
      s.noiseBurst('sfx', t, { dur: 0.14, vol: 0.1, filter: 'bandpass', f0: 600, f1: 2200, q: 2, attack: 0.02 });
      s.fm('sfx', t, { freq: 520, slideTo: 880, dur: 0.14, vol: 0.18, ratio: 2, index: 0.6 });
      break;
    case 'panelClose':
      s.noiseBurst('sfx', t, { dur: 0.12, vol: 0.09, filter: 'bandpass', f0: 2000, f1: 600, q: 2, attack: 0.01 });
      s.fm('sfx', t, { freq: 760, slideTo: 420, dur: 0.12, vol: 0.16, ratio: 2, index: 0.5 });
      break;
    case 'mapOpen':
      // Holograma que se enciende: barrido ascendente y un «ping» de confirmación.
      s.noiseBurst('sfx', t, { dur: 0.22, vol: 0.1, filter: 'bandpass', f0: 400, f1: 2400, q: 3, attack: 0.006, pan: -0.15 });
      s.fm('sfx', t, { freq: 330, slideTo: 880, dur: 0.2, vol: 0.18, ratio: 3, index: 0.7, attack: 0.003 });
      s.fm('sfx', t + 0.12, { freq: 1319, dur: 0.18, vol: 0.14, ratio: 3.5, index: 0.8, pan: 0.15 });
      break;
    case 'mapClose':
      s.noiseBurst('sfx', t, { dur: 0.22, vol: 0.08, filter: 'bandpass', f0: 2600, f1: 400, q: 3, attack: 0.004 });
      s.fm('sfx', t, { freq: 880, slideTo: 330, dur: 0.22, vol: 0.16, ratio: 3, index: 0.5, attack: 0.002 });
      break;
    case 'terminalOpen':
      [740, 988, 1319].forEach((f, k) => s.fm('sfx', t + k * 0.06, { freq: f, dur: 0.07, vol: 0.16, ratio: 2, index: 0.4 }));
      latch(s, t, 0.16, 150);
      break;
    case 'powerOn':
      thud(s, 'sfx', t, 150, 0.14, 0.252, 0.3);
      s.fm('sfx', t + 0.03, { freq: 220, slideTo: 520, dur: 0.26, vol: 0.18, ratio: 2, index: 0.5, attack: 0.03 });
      break;
    case 'powerOff':
      thud(s, 'sfx', t, 130, 0.14, 0.234, 0.3);
      s.fm('sfx', t, { freq: 440, slideTo: 150, dur: 0.28, vol: 0.162, ratio: 2, index: 0.4, attack: 0.002 });
      break;
    case 'partAdd':
      // La pieza encaja (golpe seco) y el servo la ajusta: el transitorio va primero, sin ataque lento.
      latch(s, t, 0.24, 180);
      servo(s, t + 0.04, 0.05, 0.14, true);
      break;
    case 'partRemove':
      latch(s, t, 0.12, 100);
      servo(s, t + 0.05, 0.14, 0.12, false);
      break;
    case 'go':
      // Luz verde: dos notas ascendentes y una tercera abierta (acorde mayor).
      s.fm('sfx', t, { freq: 659.25, dur: 0.2, vol: 0.216, ratio: 2, index: 0.5 });
      s.fm('sfx', t + 0.1, { freq: 830.61, dur: 0.22, vol: 0.216, ratio: 2, index: 0.5 });
      s.fm('sfx', t + 0.2, { freq: 987.77, dur: 0.4, vol: 0.216, ratio: 2, index: 0.4 });
      break;
    case 'noGo':
      // Luz roja: dos notas graves que caen y un zumbido corto.
      s.tone('sfx', t, { freq: 330, slideTo: 300, dur: 0.18, type: 'triangle', vol: 0.216, lowpass: 1400 });
      s.tone('sfx', t + 0.17, { freq: 247, slideTo: 200, dur: 0.3, type: 'triangle', vol: 0.216, lowpass: 1200 });
      s.tone('sfx', t, { freq: 110, dur: 0.14, type: 'square', vol: 0.09, lowpass: 500 });
      break;
    case 'launch': {
      // Cuenta atrás (tres tics) e ignición: ruido grave que sube y se abre.
      [0, 0.3, 0.6].forEach((d) => s.fm('sfx', t + d, { freq: 880, dur: 0.1, vol: 0.1, ratio: 2, index: 0.3 }));
      s.fm('sfx', t + 0.9, { freq: 1320, dur: 0.3, vol: 0.1, ratio: 2, index: 0.3 });
      s.noiseBurst('sfx', t + 0.9, { dur: 1.0, vol: 0.28, filter: 'lowpass', f0: 140, f1: 1800, q: 0.8, attack: 0.5 });
      s.tone('sfx', t + 0.9, { freq: 50, slideTo: 95, dur: 1.0, vol: 0.2, attack: 0.5 });
      break;
    }

    // ─── Tripulante: pasos ───────────────────────────────────────────────────
    case 'stepShip': {
      // Suela sobre rejilla metálica.
      const p = pan();
      s.tone('sfx', t, { freq: 150 + R() * 25, slideTo: 85, dur: 0.1, vol: 0.264, attack: 0.002, pan: p });
      s.noiseBurst('sfx', t, { dur: 0.05, vol: 0.11, filter: 'bandpass', f0: 1800 + R() * 700, q: 3, attack: 0.002, pan: p });
      s.tone('sfx', t + 0.005, { freq: 480 + R() * 120, dur: 0.12, vol: 0.04, attack: 0.002, pan: p });
      break;
    }
    case 'stepDust': {
      // Polvo bajo la bota del traje: apagado y blando.
      const p = pan();
      s.noiseBurst('sfx', t, { dur: 0.14, vol: 0.22, filter: 'lowpass', f0: 600 + R() * 150, f1: 250, attack: 0.012, pan: p });
      s.tone('sfx', t, { freq: 90 + R() * 15, slideTo: 65, dur: 0.1, vol: 0.08, attack: 0.004, pan: p });
      break;
    }
    case 'stepRock': {
      // Grava y roca: crujido seco más corto.
      const p = pan();
      s.noiseBurst('sfx', t, { dur: 0.07, vol: 0.198, filter: 'bandpass', f0: 1100 + R() * 500, q: 1.6, attack: 0.003, pan: p });
      s.noiseBurst('sfx', t + 0.025, { dur: 0.05, vol: 0.11, filter: 'bandpass', f0: 1400 + R() * 400, q: 2, attack: 0.002, pan: p });
      s.tone('sfx', t, { freq: 105 + R() * 20, slideTo: 60, dur: 0.09, vol: 0.176, attack: 0.003, pan: p });
      break;
    }
    case 'stepIce': {
      // Hielo: costra que cruje, más aguda, con un golpe sordo debajo.
      const p = pan();
      s.noiseBurst('sfx', t, { dur: 0.09, vol: 0.1, filter: 'bandpass', f0: 1800 + R() * 500, q: 4, attack: 0.002, pan: p });
      s.noiseBurst('sfx', t + 0.03, { dur: 0.05, vol: 0.064, filter: 'bandpass', f0: 2600, q: 5, attack: 0.002, pan: p });
      s.tone('sfx', t, { freq: 95 + R() * 15, slideTo: 60, dur: 0.1, vol: 0.1, attack: 0.003, pan: p });
      break;
    }
    case 'footLand':
      thud(s, 'sfx', t, 85, 0.2, 0.225, 0.5);
      s.noiseBurst('sfx', t + 0.01, { dur: 0.16, vol: 0.105, filter: 'lowpass', f0: 700, f1: 200, attack: 0.01 });
      break;

    // ─── Reparaciones y avisos de la nave ────────────────────────────────────
    case 'fixed':
      s.tone('sfx', t, { freq: 190, slideTo: 100, dur: 0.14, vol: 0.16, attack: 0.003 });
      s.fm('sfx', t + 0.03, { freq: 988, dur: 0.13, vol: 0.1, ratio: 2, index: 0.5 });
      s.noiseBurst('sfx', t, { dur: 0.05, vol: 0.06, filter: 'bandpass', f0: 3200, q: 2, attack: 0.002 });
      break;
    case 'toggle':
      s.tone('sfx', t, { freq: 520, slideTo: 300, dur: 0.06, type: 'triangle', vol: 0.12, attack: 0.003, lowpass: 2200 });
      s.noiseBurst('sfx', t, { dur: 0.05, vol: 0.05, filter: 'bandpass', f0: 2500, q: 3, attack: 0.002 });
      break;
    case 'alarm':
      // Crítica: seis pulsos alternos 1175/880 Hz (200 ms de pulso, 160 de silencio). La nave en llamas.
      for (let k = 0; k < 6; k++) pulse(s, t + k * 0.36, k % 2 === 0 ? 1175 : 880, 0.2, 0.22);
      break;
    case 'ok':
      s.fm('alerts', t, { freq: 1568, dur: 0.12, vol: 0.18, ratio: 2, index: 0.3 });
      s.fm('alerts', t + 0.1, { freq: 2093, dur: 0.14, vol: 0.18, ratio: 2, index: 0.3 });
      break;
    case 'sparks':
      for (let k = 0; k < 5; k++) {
        s.noiseBurst('sfx', t + k * 0.11 + R() * 0.04, {
          dur: 0.06 + R() * 0.05, vol: 0.09 + R() * 0.07, filter: 'bandpass', f0: 900 + R() * 700, q: 1.5, attack: 0.002, pan: pan(0.4),
        });
      }
      s.tone('sfx', t, { freq: 120, dur: 0.5, vol: 0.04, attack: 0.01, lowpass: 400 });
      break;
    case 'warnTick':
      // Impacto inminente: dos golpes secos y agudos (distinto del pulso largo de la alarma).
      s.fm('alerts', t, { freq: 1320, dur: 0.09, vol: 0.24, ratio: 2, index: 0.5 });
      s.fm('alerts', t + 0.16, { freq: 1320, dur: 0.09, vol: 0.24, ratio: 2, index: 0.5 });
      break;
    case 'jump':
      startJump(s);
      break;
    case 'clunk':
      // Atraque: golpe, ruido de acople y segundo cierre de los anclajes.
      s.tone('sfx', t, { freq: 120, slideTo: 55, dur: 0.4, vol: 0.28, attack: 0.003 });
      s.noiseBurst('sfx', t, { dur: 0.25, vol: 0.22, filter: 'lowpass', f0: 1500, f1: 250, attack: 0.004 });
      s.fm('sfx', t + 0.02, { freq: 1900, dur: 0.18, vol: 0.04, ratio: 3.5, index: 0.8 });
      latch(s, t + 0.2, 0.12, 100);
      break;
    case 'impact':
      s.noiseBurst('alerts', t, { dur: 0.9, vol: 0.42, filter: 'lowpass', f0: 1800, f1: 90, attack: 0.004 });
      s.tone('alerts', t, { freq: 80, slideTo: 38, dur: 0.8, vol: 0.2, attack: 0.004 });
      s.noiseBurst('alerts', t + 0.02, { dur: 0.3, vol: 0.18, filter: 'bandpass', f0: 900, q: 1.5, attack: 0.003 });
      break;
    case 'success':
    case 'complete':
      [783.99, 1046.5].forEach((f, k) => s.fm('alerts', t + k * 0.09, { freq: f, dur: 0.16, vol: 0.1, ratio: 2, index: 0.4 }));
      break;

    // ─── Superficie ──────────────────────────────────────────────────────────
    case 'descent':
      // Separación de la órbita: golpe metálico y zumbido descendente.
      thud(s, 'sfx', t, 130, 0.3, 0.25, 0.6);
      s.noiseBurst('sfx', t, { dur: 0.5, vol: 0.28, filter: 'lowpass', f0: 1200, f1: 200, q: 0.7, attack: 0.01 });
      s.tone('sfx', t + 0.1, { freq: 220, slideTo: 75, dur: 1.4, type: 'triangle', vol: 0.12, lowpass: 600, attack: 0.05 });
      break;
    case 'thruster':
      s.startNoiseLoop('thruster', { bus: 'loops', filter: 'lowpass', f0: 200, f1: 350, rampS: 0.15, vol: 0.2, subHz: 55, subVol: 0.1, flutterHz: 13 });
      break;
    case 'jetpack':
      s.startNoiseLoop('jetpack', { bus: 'loops', filter: 'lowpass', f0: 250, f1: 350, rampS: 0.08, vol: 0.18, subHz: 0, subVol: 0, flutterHz: 22 });
      break;
    case 'storm':
      s.startNoiseLoop('storm', { bus: 'loops', filter: 'lowpass', f0: 150, f1: 350, q: 1, rampS: 3, vol: 0.4, subHz: 0, subVol: 0, flutterHz: 0.35 });
      break;
    case 'wind':
      // Viento que crece durante el aviso de tormenta (la escena sube su volumen con `setLoopLevel`).
      s.startNoiseLoop('wind', { bus: 'loops', filter: 'lowpass', f0: 300, f1: 200, rampS: 1.5, vol: 0.3, subHz: 0, subVol: 0, flutterHz: 0.5 });
      s.setLoopLevel('wind', 0.15);
      break;
    case 'hail': {
      // Granizo de polvo contra el traje: unos cuantos golpecitos secos repartidos.
      const n = 6 + Math.floor(R() * 5);
      for (let k = 0; k < n; k++) {
        s.noiseBurst('sfx', t + R() * 0.55, {
          dur: 0.04 + R() * 0.04, vol: 0.16 + R() * 0.2, filter: 'lowpass', f0: 1800 - R() * 800, q: 0.7, attack: 0.006, pan: pan(0.7),
        });
      }
      break;
    }
    case 'dodgeGraze':
      // Roce: chirrido metálico corto.
      s.noiseBurst('sfx', t, { dur: 0.35, vol: 0.14, filter: 'bandpass', f0: 1200, f1: 900, q: 3, attack: 0.01 });
      s.fm('sfx', t, { freq: 1200, slideTo: 900, dur: 0.2, vol: 0.04, ratio: 3.5, index: 0.8 });
      break;
    case 'dodgeHit':
      s.noiseBurst('alerts', t, { dur: 0.7, vol: 0.6, filter: 'lowpass', f0: 1400, f1: 200, attack: 0.004, hp: 40 });
      s.tone('alerts', t, { freq: 110, slideTo: 70, dur: 0.5, vol: 0.06, attack: 0.003 });
      latch(s, t, 0.05, 140);
      break;
    case 'skillHit':
      s.fm('sfx', t, { freq: 880, dur: 0.035, vol: 0.13, ratio: 2, index: 0.4 });
      s.fm('sfx', t + 0.025, { freq: 1320, dur: 0.03, vol: 0.12, ratio: 2, index: 0.4 });
      break;
    case 'skillMiss':
      s.tone('sfx', t, { freq: 230, slideTo: 150, dur: 0.05, type: 'triangle', vol: 0.12, attack: 0.003, lowpass: 900 });
      break;
    case 'extinguisher':
      s.startNoiseLoop('extinguisher', { bus: 'loops', filter: 'lowpass', f0: 2000, f1: 2000, q: 0.7, rampS: 0.08, vol: 0.08, subHz: 0, subVol: 0, flutterHz: 9 });
      break;
    case 'toolPlace':
      // Patas que se clavan y un zumbido que arranca.
      thud(s, 'sfx', t, 110, 0.14, 0.18, 0.5);
      latch(s, t + 0.06, 0.08, 150);
      s.tone('sfx', t + 0.12, { freq: 180, slideTo: 420, dur: 0.15, type: 'triangle', vol: 0.08, lowpass: 900, attack: 0.03 });
      break;
    case 'toolReady':
      // Tres pitidos ascendentes: «hay piezas».
      [988, 1175, 1480].forEach((f, k) => s.fm('alerts', t + k * 0.07, { freq: f, dur: 0.08, vol: 0.12, ratio: 2, index: 0.3 }));
      break;
    case 'toolDone':
      [1480, 1175, 988].forEach((f, k) => s.fm('alerts', t + k * 0.07, { freq: f, dur: 0.09, vol: 0.12, ratio: 2, index: 0.3 }));
      break;
    case 'toolStop':
      s.tone('alerts', t, { freq: 420, slideTo: 100, dur: 0.22, type: 'triangle', vol: 0.12, lowpass: 900, attack: 0.01 });
      break;
    case 'toolResume':
      s.tone('sfx', t, { freq: 120, slideTo: 420, dur: 0.2, type: 'triangle', vol: 0.09, lowpass: 900, attack: 0.08 });
      break;
    case 'sale':
      // Monedas: dos campanillas rápidas y un tintineo.
      s.fm('sfx', t, { freq: 1976, dur: 0.1, vol: 0.16, ratio: 3.5, index: 0.6 });
      s.fm('sfx', t + 0.07, { freq: 2637, dur: 0.18, vol: 0.14, ratio: 3.5, index: 0.6 });
      s.noiseBurst('sfx', t, { dur: 0.06, vol: 0.05, filter: 'bandpass', f0: 5000, q: 3, attack: 0.002 });
      break;
    case 'purchase':
      // Caja que se carga: golpe sordo y confirmación corta.
      thud(s, 'sfx', t, 140, 0.14, 0.12, 0.7);
      s.fm('sfx', t + 0.08, { freq: 784, dur: 0.12, vol: 0.1, ratio: 2, index: 0.4 });
      break;
    case 'upgrade':
      // Instalación: zumbido que sube y acorde de confirmación.
      s.tone('alerts', t, { freq: 220, slideTo: 660, dur: 0.12, type: 'triangle', vol: 0.09, lowpass: 1400, attack: 0.03 });
      [659.25, 830.61, 987.77].forEach((f, k) => s.fm('alerts', t + 0.08 + k * 0.04, { freq: f, dur: 0.09, vol: 0.1, ratio: 2, index: 0.35 }));
      break;
    case 'noCredits':
      // Dos tonos graves cortos: «no».
      s.tone('alerts', t, { freq: 240, dur: 0.1, type: 'triangle', vol: 0.12, lowpass: 900 });
      s.tone('alerts', t + 0.1, { freq: 180, dur: 0.12, type: 'triangle', vol: 0.12, lowpass: 800 });
      break;
    case 'toolLost':
      s.fm('alerts', t, { freq: 330, dur: 0.14, vol: 0.2, ratio: 2, index: 0.3 });
      s.fm('alerts', t + 0.11, { freq: 220, dur: 0.15, vol: 0.2, ratio: 2, index: 0.3 });
      break;
    case 'fallWarn':
      // Dos barridos descendentes rápidos: «vas a golpear».
      pulse(s, t, 1100, 0.14, 0.2, 760);
      pulse(s, t + 0.18, 1100, 0.14, 0.2, 760);
      break;
    case 'takeOff':
    {
      s.stopLoop('takeOff', 0.1);
      s.startNoiseLoop('takeOff', { bus: 'loops', filter: 'lowpass', f0: 150, f1: 300, rampS: 1, vol: 0.25, subHz: 45, subVol: 0.1, flutterHz: 0 });
      // Se apaga sola: el despegue dura unos segundos (solo este bucle, no uno posterior).
      const mine = s.loops.get('takeOff');
      setTimeout(() => {
        if (s.loops.get('takeOff') === mine) s.stopLoop('takeOff', 2.5);
      }, 3500);
    }
      break;
    case 'landSoft':
      thud(s, 'sfx', t, 90, 0.5, 0.28, 0);
      s.noiseBurst('sfx', t, { dur: 0.6, vol: 0.34, filter: 'lowpass', f0: 900, f1: 120, attack: 0.005 });
      latch(s, t + 0.3, 0.07, 110);
      break;
    case 'landHard':
      s.noiseBurst('alerts', t, { dur: 1.6, vol: 0.36, filter: 'lowpass', f0: 1400, f1: 70, attack: 0.004 });
      s.tone('alerts', t, { freq: 75, slideTo: 38, dur: 1.4, vol: 0.28, attack: 0.003 });
      for (let k = 0; k < 4; k++) s.noiseBurst('alerts', t + 0.15 + k * 0.17, { dur: 0.1, vol: 0.18, filter: 'bandpass', f0: 2400 - k * 300, q: 3, attack: 0.002, pan: pan(0.5) });
      break;
    case 'airlock':
      // Siseo de presurización con un cierre al final.
      s.noiseBurst('sfx', t, { dur: 1.1, vol: 0.2, filter: 'lowpass', f0: 1000, f1: 400, q: 0.7, attack: 0.06 });
      servo(s, t + 0.7, 0.3, 0.05, false);
      latch(s, t + 1.0, 0.16, 100);
      break;
    case 'collect':
      s.fm('sfx', t, { freq: 1240, dur: 0.1, vol: 0.2, ratio: 2, index: 0.4 });
      s.fm('sfx', t + 0.08, { freq: 1660, dur: 0.14, vol: 0.18, ratio: 2, index: 0.4 });
      s.noiseBurst('sfx', t, { dur: 0.05, vol: 0.06, filter: 'bandpass', f0: 3800, q: 3, attack: 0.002 });
      break;
    case 'store':
      [392, 523.25, 659.25].forEach((f, k) => s.fm('sfx', t + k * 0.06, { freq: f, dur: 0.12, vol: 0.11, ratio: 2, index: 0.3 }));
      thud(s, 'sfx', t, 120, 0.2, 0.15, 0.8);
      break;
    case 'stormWarn':
      s.noiseBurst('alerts', t, { dur: 3, vol: 0.2, filter: 'lowpass', f0: 700, f1: 300, q: 0.7, attack: 1.2, hp: 80 });
      s.fm('alerts', t, { freq: 660, dur: 0.2, vol: 0.14, ratio: 2, index: 0.3 });
      s.fm('alerts', t + 0.3, { freq: 660, dur: 0.2, vol: 0.14, ratio: 2, index: 0.3 });
      break;
    case 'crack':
      for (let k = 0; k < 6; k++) {
        s.noiseBurst('alerts', t + k * 0.07 + (k === 0 ? 0 : R() * 0.05), { dur: 0.05 + R() * 0.06, vol: 0.2, filter: 'bandpass', f0: 600 + R() * 900, q: 4, attack: 0.002, pan: pan(0.4) });
      }
      s.tone('alerts', t, { freq: 70, slideTo: 45, dur: 0.6, vol: 0.22, attack: 0.01 });
      break;
    case 'collapse':
      s.noiseBurst('alerts', t, { dur: 2.2, vol: 0.5, filter: 'lowpass', f0: 900, f1: 60, attack: 0.05 });
      s.tone('alerts', t, { freq: 60, slideTo: 38, dur: 2, vol: 0.2, attack: 0.04 });
      for (let k = 0; k < 5; k++) s.noiseBurst('alerts', t + 0.2 + k * 0.25 + R() * 0.1, { dur: 0.1, vol: 0.14, filter: 'bandpass', f0: 500 + R() * 600, q: 2, attack: 0.002, pan: pan(0.6) });
      break;
    case 'o2Low':
      s.fm('alerts', t, { freq: 880, dur: 0.17, vol: 0.24, ratio: 2, index: 0.3 });
      s.fm('alerts', t + 0.22, { freq: 660, dur: 0.24, vol: 0.24, ratio: 2, index: 0.3 });
      break;
    case 'o2Critical':
      // Dos pulsos secos: la escena lo repite a su ritmo, no hace falta más largo.
      pulse(s, t, 1320, 0.15, 0.2);
      pulse(s, t + 0.2, 1320, 0.15, 0.2);
      break;
    case 'breath':
    case 'breathFast': {
      // Inspiración y espiración: ruido filtrado dentro del casco del traje.
      const fast = id === 'breathFast';
      // El ritmo lo marca la escena (`breathIntervalS`: 3,4 s en calma, ≥ 0,9 s agitada): el ciclo cabe en él.
      const inS = fast ? 0.32 : 1.2;
      s.noiseBurst('sfx', t, { dur: inS, vol: fast ? 0.14 : 0.22, filter: 'lowpass', f0: 1100, f1: 1500, q: 0.7, attack: inS * 0.4 });
      s.noiseBurst('sfx', t + inS + 0.05, { dur: inS * 1.2, vol: fast ? 0.11 : 0.18, filter: 'lowpass', f0: 1400, f1: 700, q: 0.7, attack: inS * 0.2 });
      break;
    }
    case 'suitHit':
      s.noiseBurst('alerts', t, { dur: 0.35, vol: 0.3, filter: 'lowpass', f0: 1000, f1: 120, attack: 0.003 });
      s.tone('alerts', t, { freq: 110, slideTo: 60, dur: 0.25, vol: 0.1, attack: 0.003 });
      break;
    case 'crewDead':
      // Tres golpes de tono que cae sobre un dron grave: constantes perdidas.
      [1175, 988, 830].forEach((f, k) => s.fm('alerts', t + k * 0.55, { freq: f, dur: 0.4, vol: 0.18, ratio: 2, index: 0.2 }));
      s.tone('alerts', t, { freq: 110, slideTo: 45, dur: 2, type: 'triangle', vol: 0.03, lowpass: 400, attack: 0.003 });
      break;
    case 'jettison':
      s.noiseBurst('sfx', t, { dur: 0.6, vol: 0.3, filter: 'lowpass', f0: 700, f1: 150, attack: 0.005 });
      latch(s, t, 0.16, 140);
      s.tone('sfx', t + 0.05, { freq: 300, slideTo: 120, dur: 0.3, type: 'triangle', vol: 0.1, lowpass: 900 });
      break;
    case 'creak': {
      // Casco que cruje bajo esfuerzo: gemido grave con batido y chasquidos.
      s.tone('sfx', t, { freq: 96, slideTo: 68, dur: 1, type: 'triangle', vol: 0.12, lowpass: 380, attack: 0.15 });
      s.tone('sfx', t, { freq: 101, slideTo: 72, dur: 1, type: 'triangle', vol: 0.1, lowpass: 380, attack: 0.15 });
      s.noiseBurst('sfx', t + 0.05, { dur: 0.9, vol: 0.09, filter: 'bandpass', f0: 220, f1: 130, q: 8, attack: 0.2 });
      for (let k = 0; k < 3; k++) s.noiseBurst('sfx', t + 0.2 + R() * 0.7, { dur: 0.03, vol: 0.1, filter: 'bandpass', f0: 1200 + R() * 800, q: 5, attack: 0.002, pan: pan(0.5) });
      break;
    }

    // ─── Cooperativo ─────────────────────────────────────────────────────────
    case 'ping':
      s.fm('voice', t, { freq: 1319, dur: 0.07, vol: 0.13, ratio: 3, index: 0.6 });
      s.fm('voice', t + 0.07, { freq: 1760, dur: 0.12, vol: 0.13, ratio: 3, index: 0.6 });
      break;
    case 'crewJoin':
      s.fm('voice', t, { freq: 523.25, dur: 0.18, vol: 0.18, ratio: 2, index: 0.3 });
      s.fm('voice', t + 0.1, { freq: 784, dur: 0.22, vol: 0.18, ratio: 2, index: 0.3 });
      s.noiseBurst('voice', t, { dur: 0.25, vol: 0.072, filter: 'lowpass', f0: 1200, f1: 700, q: 0.8, attack: 0.05 });
      break;
    case 'crewLeave':
      s.fm('voice', t, { freq: 784, dur: 0.18, vol: 0.18, ratio: 2, index: 0.3 });
      s.fm('voice', t + 0.1, { freq: 523.25, dur: 0.24, vol: 0.18, ratio: 2, index: 0.3 });
      s.noiseBurst('voice', t, { dur: 0.25, vol: 0.072, filter: 'lowpass', f0: 700, f1: 1200, q: 0.8, attack: 0.05 });
      break;

    // ─── Ciencia y estado de la nave ─────────────────────────────────────────
    case 'contact':
      // Enlace de radio: squelch, tres pitidos ascendentes y un chorro de datos.
      s.noiseBurst('voice', t, { dur: 0.07, vol: 0.108, filter: 'bandpass', f0: 1800, q: 2, attack: 0.003 });
      [1200, 1500, 1800].forEach((f, k) => s.tone('voice', t + 0.08 + k * 0.08, { freq: f, dur: 0.05, vol: 0.22, attack: 0.003 }));
      for (let k = 0; k < 6; k++) s.tone('voice', t + 0.36 + k * 0.045, { freq: 1400 + R() * 800, dur: 0.03, vol: 0.09, attack: 0.002, pan: pan(0.3) });
      break;
    case 'observation':
      // Instrumento que termina: campana FM clara de dos notas.
      s.fm('sfx', t, { freq: 1175, dur: 0.5, vol: 0.12, ratio: 3.5, index: 0.9 });
      s.fm('sfx', t + 0.13, { freq: 1568, dur: 0.6, vol: 0.1, ratio: 3.5, index: 0.9 });
      break;
    case 'earthCall':
      // Llamada a la Tierra: squelch y dos tonos de llamada dobles.
      s.noiseBurst('voice', t, { dur: 0.08, vol: 0.108, filter: 'bandpass', f0: 1800, q: 2, attack: 0.003 });
      for (let k = 0; k < 2; k++) {
        s.fm('voice', t + 0.1 + k * 0.28, { freq: 880, dur: 0.12, vol: 0.18, ratio: 2, index: 0.3 });
        s.fm('voice', t + 0.1 + k * 0.28 + 0.1, { freq: 1100, dur: 0.12, vol: 0.18, ratio: 2, index: 0.3 });
      }
      break;
    case 'overheat':
      // Sobrecalentamiento: tres pulsos que suben de tono sobre un siseo de vapor (la alarma alterna, esta asciende).
      [700, 830, 980].forEach((f, k) => pulse(s, t + k * 0.3, f, 0.22, 0.12));
      s.noiseBurst('alerts', t, { dur: 0.9, vol: 0.006, filter: 'bandpass', f0: 1000, f1: 1400, q: 0.9, attack: 0.1 });
      break;
    case 'powerDown':
      // Pérdida de energía: el zumbido de la nave cae a graves y se apaga con dos relés.
      s.tone('alerts', t, { freq: 330, slideTo: 60, dur: 1.4, type: 'triangle', vol: 0.14, lowpass: 700, attack: 0.02 });
      s.fm('alerts', t, { freq: 660, slideTo: 90, dur: 1.2, vol: 0.06, ratio: 2, index: 0.3 });
      latch(s, t + 0.5, 0.1, 110);
      latch(s, t + 1.1, 0.1, 90);
      break;
    case 'storageFull':
      // Memoria llena: dos golpes sordos de «lleno» y un tono plano.
      [0, 0.22].forEach((d) => {
        s.fm('alerts', t + d, { freq: 880, dur: 0.14, vol: 0.14, ratio: 2, index: 0.6 });
        thud(s, 'alerts', t + d, 160, 0.12, 0.04, 0.3);
      });
      s.fm('alerts', t + 0.5, { freq: 1046, dur: 0.1, vol: 0.09, ratio: 2, index: 0.3 });
      break;
    case 'blip': {
      const n = 2;
      for (let k = 0; k < n; k++) {
        const f = 520 + R() * 480;
        s.fm('alerts', t + k * 0.04, { freq: f, slideTo: f * (0.85 + R() * 0.4), dur: 0.04, vol: 0.08, ratio: 2, index: 0.3 });
      }
      break;
    }
  }
}

/**
 * Salto: arranque del motor (barrido que sube ~2,5 s) y después un zumbido de crucero GRAVE y SUAVE que
 * dura todo el tránsito hasta `stopLoop('roar')`. Antes era ruido blanco a 0,7 + sierra a 42 Hz durante
 * todo el viaje: saturaba al sumarse con la música y las alarmas y cansaba el oído.
 */
function startJump(s: SynthKit): void {
  const ctx = s.ctx;
  const dest = s.bus('loops');
  if (!dest) return;
  s.stopLoop('roar', 0.1);
  const t = ctx.currentTime;
  const spool = 2.4;
  // 1 · Arranque: barrido de ruido de banda que sube y se abre, con un tono que acelera.
  s.noiseBurst('sfx', t, { dur: spool + 0.6, vol: 0.22, filter: 'bandpass', f0: 160, f1: 1500, q: 1.3, attack: 1.4 });
  s.tone('sfx', t, { freq: 48, dur: spool + 0.4, vol: 0.16, slideTo: 120, attack: 1.2 });
  s.tone('sfx', t + 0.2, { freq: 96, dur: spool, type: 'triangle', vol: 0.05, slideTo: 300, attack: 1 });
  // Golpe de entrada en el salto: soplo descendente.
  s.noiseBurst('sfx', t + spool - 0.1, { dur: 1.4, vol: 0.2, filter: 'lowpass', f0: 2400, f1: 180, attack: 0.08 });

  // 2 · Crucero: ruido muy filtrado y dos senos graves con respiración lenta.
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.setValueAtTime(0.0001, t + spool - 0.4);
  g.gain.linearRampToValueAtTime(1, t + spool + 1.6);
  g.connect(dest);
  const src = ctx.createBufferSource();
  src.buffer = s.noise(3);
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 240;
  lp.Q.value = 0.5;
  const ng = ctx.createGain();
  ng.gain.value = 0.09;
  // Paso alto: el ruido grave no lleva energía por debajo de 30 Hz (no se oye, solo gasta altavoz).
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 40;
  src.connect(lp).connect(hp).connect(ng).connect(g);
  const hum = ctx.createGain();
  hum.gain.value = 0.04;
  hum.connect(g);
  const sources: AudioScheduledSourceNode[] = [src];
  for (const f of [55, 55.35, 82.5]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(hum);
    o.start(t);
    sources.push(o);
  }
  const breath = ctx.createOscillator();
  breath.frequency.value = 0.13;
  const bg = ctx.createGain();
  bg.gain.value = 0.03;
  breath.connect(bg).connect(ng.gain);
  breath.start(t);
  sources.push(breath);
  src.start(t, s.rand() * 1.5);
  s.setLoop('roar', { stop: (fadeS) => s.fadeOut(g, sources, fadeS) });
}
