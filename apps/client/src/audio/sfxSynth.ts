/**
 * Síntesis de los efectos de sonido: qué capas suenan para cada `SfxId`. Todo pasa por `SynthKit`, así
 * que se puede renderizar offline en los tests (picos, clics, espectro).
 */
import type { SfxId } from './soundLogic';
import type { SynthKit } from './synthKit';

export function synthSfx(s: SynthKit, id: SfxId, t: number): void {
  const R = s.rand;
  switch (id) {
      case 'click':
        s.tone('sfx', t, { freq: 1500, dur: 0.035, type: 'square', vol: 0.07 });
        break;
      case 'fixed':
        s.tone('sfx', t, { freq: 190, dur: 0.14, type: 'square', vol: 0.18, slideTo: 90 });
        s.tone('sfx', t + 0.03, { freq: 920, dur: 0.06, type: 'triangle', vol: 0.12 });
        s.noiseBurst('sfx', t, { dur: 0.08, vol: 0.12, filter: 'highpass', f0: 2500 });
        break;
      case 'toggle':
        s.tone('sfx', t, { freq: 520, dur: 0.12, type: 'triangle', vol: 0.15, slideTo: 240 });
        s.noiseBurst('sfx', t, { dur: 0.1, vol: 0.1, filter: 'highpass', f0: 2000 });
        break;
      case 'alarm':
        for (let k = 0; k < 3; k++) {
          s.tone('alerts', t + k * 0.42, { freq: 880, dur: 0.18, type: 'square', vol: 0.16 });
          s.tone('alerts', t + k * 0.42 + 0.2, { freq: 660, dur: 0.18, type: 'square', vol: 0.16 });
        }
        break;
      case 'ok':
        s.tone('alerts', t, { freq: 1568, dur: 0.09, vol: 0.2 });
        s.tone('alerts', t + 0.13, { freq: 2093, dur: 0.12, vol: 0.2 });
        break;
      case 'sparks':
        for (let k = 0; k < 5; k++) {
          s.noiseBurst('sfx', t + k * 0.11 + R() * 0.04, {
            dur: 0.07 + R() * 0.05, vol: 0.14 + R() * 0.1, filter: 'bandpass', f0: 1800 + R() * 1800, q: 1.2,
          });
        }
        break;
      case 'warnTick':
        s.tone('alerts', t, { freq: 880, dur: 0.1, vol: 0.2 });
        break;
      case 'jump':
        startJump(s);
        break;
      case 'clunk':
        s.noiseBurst('sfx', t, { dur: 0.3, vol: 0.4, f0: 1800, f1: 300 });
        s.tone('sfx', t, { freq: 130, dur: 0.35, type: 'square', vol: 0.2, slideTo: 55 });
        s.tone('sfx', t + 0.05, { freq: 1900, dur: 0.05, type: 'triangle', vol: 0.1 });
        break;
      case 'impact':
        s.noiseBurst('alerts', t, { dur: 1.8, vol: 0.55, f0: 2200, f1: 90 });
        s.tone('alerts', t, { freq: 80, dur: 1.2, type: 'sawtooth', vol: 0.3, slideTo: 28 });
        break;
      case 'success':
      case 'complete':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => s.tone('alerts', t + k * 0.12, { freq: f, dur: 0.4, vol: 0.14 }));
        break;
      case 'descent':
        // Separación de la órbita: golpe metálico y zumbido descendente.
        s.noiseBurst('sfx', t, { dur: 0.5, vol: 0.35, f0: 1500, f1: 200 });
        s.tone('sfx', t, { freq: 220, dur: 1.4, type: 'sawtooth', vol: 0.12, slideTo: 70 });
        break;
      case 'thruster':
        s.startNoiseLoop('thruster', { bus: 'sfx', filter: 'bandpass', f0: 380, f1: 520, rampS: 0.15, vol: 0.5, subHz: 55, subVol: 0.25, flutterHz: 13 });
        break;
      case 'jetpack':
        s.startNoiseLoop('jetpack', { bus: 'sfx', filter: 'bandpass', f0: 900, f1: 1300, rampS: 0.08, vol: 0.28, subHz: 0, subVol: 0, flutterHz: 22 });
        break;
      case 'storm':
        s.startNoiseLoop('storm', { bus: 'sfx', filter: 'lowpass', f0: 300, f1: 1100, rampS: 3, vol: 0.55, subHz: 0, subVol: 0, flutterHz: 0.35 });
        break;
      case 'wind':
        // Viento que crece durante el aviso de tormenta (la escena sube su volumen con `setLoopLevel`).
        s.startNoiseLoop('wind', { bus: 'sfx', filter: 'bandpass', f0: 250, f1: 600, rampS: 1.5, vol: 0.4, subHz: 0, subVol: 0, flutterHz: 0.5 });
        s.setLoopLevel('wind', 0.15);
        break;
      case 'dodgeGraze':
        // Roce: chirrido metálico corto.
        s.noiseBurst('sfx', t, { dur: 0.25, vol: 0.3, filter: 'bandpass', f0: 2600, f1: 1400, q: 4 });
        break;
      case 'dodgeHit':
        s.noiseBurst('alerts', t, { dur: 0.7, vol: 0.6, f0: 1400, f1: 90 });
        s.tone('alerts', t, { freq: 80, dur: 0.5, type: 'sawtooth', vol: 0.3, slideTo: 35 });
        break;
      case 'skillHit':
        s.tone('sfx', t, { freq: 880, dur: 0.09, type: 'triangle', vol: 0.16 });
        s.tone('sfx', t + 0.07, { freq: 1320, dur: 0.12, type: 'triangle', vol: 0.14 });
        break;
      case 'skillMiss':
        s.tone('sfx', t, { freq: 220, dur: 0.16, type: 'square', vol: 0.1, slideTo: 160 });
        break;
      case 'extinguisher':
        s.startNoiseLoop('extinguisher', { bus: 'sfx', filter: 'highpass', f0: 2200, f1: 3200, rampS: 0.08, vol: 0.3, subHz: 0, subVol: 0, flutterHz: 9 });
        break;
      case 'toolPlace':
        // Patas que se clavan y un zumbido que arranca.
        s.noiseBurst('sfx', t, { dur: 0.15, vol: 0.3, filter: 'bandpass', f0: 500, q: 2 });
        s.tone('sfx', t + 0.12, { freq: 180, dur: 0.5, type: 'sawtooth', vol: 0.08, slideTo: 420 });
        break;
      case 'toolReady':
        // Tres pitidos ascendentes: «hay piezas».
        [988, 1175, 1480].forEach((f, k) => s.tone('alerts', t + k * 0.09, { freq: f, dur: 0.08, type: 'triangle', vol: 0.12 }));
        break;
      case 'toolDone':
        [1480, 1175, 988].forEach((f, k) => s.tone('alerts', t + k * 0.11, { freq: f, dur: 0.12, type: 'triangle', vol: 0.12 }));
        break;
      case 'toolStop':
        s.tone('alerts', t, { freq: 420, dur: 0.6, type: 'sawtooth', vol: 0.1, slideTo: 90 });
        break;
      case 'toolResume':
        s.tone('sfx', t, { freq: 120, dur: 0.5, type: 'sawtooth', vol: 0.08, slideTo: 420 });
        break;
      case 'sale':
        // Monedas: dos campanillas rápidas y un tintineo.
        s.tone('sfx', t, { freq: 1976, dur: 0.07, type: 'triangle', vol: 0.14 });
        s.tone('sfx', t + 0.07, { freq: 2637, dur: 0.12, type: 'triangle', vol: 0.13 });
        s.noiseBurst('sfx', t, { dur: 0.08, vol: 0.1, filter: 'highpass', f0: 5000 });
        break;
      case 'purchase':
        // Caja que se carga: golpe sordo y confirmación corta.
        s.noiseBurst('sfx', t, { dur: 0.12, vol: 0.2, f0: 900, f1: 250 });
        s.tone('sfx', t + 0.08, { freq: 784, dur: 0.1, type: 'triangle', vol: 0.12 });
        break;
      case 'upgrade':
        // Instalación: zumbido que sube y acorde de confirmación.
        s.tone('alerts', t, { freq: 220, dur: 0.35, type: 'sawtooth', vol: 0.07, slideTo: 660 });
        [659.25, 830.61, 987.77].forEach((f, k) => s.tone('alerts', t + 0.3 + k * 0.08, { freq: f, dur: 0.3, vol: 0.12 }));
        break;
      case 'noCredits':
        // Dos tonos graves cortos: «no».
        s.tone('alerts', t, { freq: 240, dur: 0.1, type: 'square', vol: 0.1 });
        s.tone('alerts', t + 0.13, { freq: 180, dur: 0.16, type: 'square', vol: 0.1 });
        break;
      case 'toolLost':
        s.tone('alerts', t, { freq: 330, dur: 0.3, vol: 0.14 });
        s.tone('alerts', t + 0.3, { freq: 220, dur: 0.5, vol: 0.14 });
        break;
      case 'fallWarn':
        // Dos tonos descendentes rápidos: «vas a golpear».
        s.tone('alerts', t, { freq: 980, dur: 0.12, type: 'square', vol: 0.12, slideTo: 700 });
        s.tone('alerts', t + 0.16, { freq: 980, dur: 0.12, type: 'square', vol: 0.12, slideTo: 700 });
        break;
      case 'takeOff':
      {
        s.stopLoop('takeOff', 0.1);
        s.startNoiseLoop('takeOff', { bus: 'loops', filter: 'lowpass', f0: 200, f1: 1100, rampS: 1, vol: 0.45, subHz: 45, subVol: 0.25, flutterHz: 0 });
        // Se apaga sola: el despegue dura unos segundos (solo este bucle, no uno posterior).
        const mine = s.loops.get('takeOff');
        setTimeout(() => {
          if (s.loops.get('takeOff') === mine) s.stopLoop('takeOff', 2.5);
        }, 3500);
      }
        break;
      case 'landSoft':
        s.noiseBurst('sfx', t, { dur: 0.6, vol: 0.4, f0: 900, f1: 120 });
        s.tone('sfx', t, { freq: 90, dur: 0.5, type: 'sine', vol: 0.3, slideTo: 45 });
        break;
      case 'landHard':
        s.noiseBurst('alerts', t, { dur: 2.2, vol: 0.7, f0: 2600, f1: 70 });
        s.tone('alerts', t, { freq: 70, dur: 1.5, type: 'sawtooth', vol: 0.4, slideTo: 24 });
        for (let k = 0; k < 4; k++) s.noiseBurst('alerts', t + 0.15 + k * 0.17, { dur: 0.12, vol: 0.25, filter: 'bandpass', f0: 2400 - k * 300, q: 2 });
        break;
      case 'airlock':
        // Siseo de presurización con un cierre al final.
        s.noiseBurst('sfx', t, { dur: 1.1, vol: 0.32, filter: 'highpass', f0: 3000, f1: 900 });
        s.tone('sfx', t + 1, { freq: 160, dur: 0.25, type: 'square', vol: 0.15, slideTo: 80 });
        break;
      case 'collect':
        s.tone('sfx', t, { freq: 1240, dur: 0.08, type: 'triangle', vol: 0.18 });
        s.tone('sfx', t + 0.08, { freq: 1660, dur: 0.12, type: 'triangle', vol: 0.16 });
        s.noiseBurst('sfx', t, { dur: 0.06, vol: 0.15, filter: 'highpass', f0: 3500 });
        break;
      case 'store':
        [392, 523.25, 659.25].forEach((f, k) => s.tone('sfx', t + k * 0.09, { freq: f, dur: 0.22, vol: 0.14 }));
        s.noiseBurst('sfx', t, { dur: 0.25, vol: 0.2, f0: 1200, f1: 300 });
        break;
      case 'stormWarn':
        s.noiseBurst('alerts', t, { dur: 3, vol: 0.3, filter: 'bandpass', f0: 250, f1: 900, q: 0.8 });
        s.tone('alerts', t, { freq: 660, dur: 0.18, vol: 0.14 });
        s.tone('alerts', t + 0.3, { freq: 660, dur: 0.18, vol: 0.14 });
        break;
      case 'crack':
        for (let k = 0; k < 6; k++) {
          s.noiseBurst('alerts', t + k * 0.07 + R() * 0.05, { dur: 0.05 + R() * 0.06, vol: 0.25, filter: 'bandpass', f0: 600 + R() * 900, q: 3 });
        }
        s.tone('alerts', t, { freq: 60, dur: 0.6, type: 'sine', vol: 0.25, slideTo: 40 });
        break;
      case 'collapse':
        s.noiseBurst('alerts', t, { dur: 2.4, vol: 0.6, f0: 900, f1: 50 });
        s.tone('alerts', t, { freq: 55, dur: 2, type: 'sawtooth', vol: 0.3, slideTo: 22 });
        break;
      case 'o2Low':
        s.tone('alerts', t, { freq: 740, dur: 0.15, vol: 0.18 });
        s.tone('alerts', t + 0.22, { freq: 554, dur: 0.22, vol: 0.18 });
        break;
      case 'o2Critical':
        s.tone('alerts', t, { freq: 1320, dur: 0.09, type: 'square', vol: 0.12 });
        break;
      case 'breath':
      case 'breathFast': {
        // Inspiración y espiración: ruido filtrado dentro del casco del traje.
        const fast = id === 'breathFast';
        const inS = fast ? 0.32 : 0.7;
        s.noiseBurst('sfx', t, { dur: inS, vol: fast ? 0.14 : 0.07, filter: 'bandpass', f0: 700, f1: 1100, q: 1.2 });
        s.noiseBurst('sfx', t + inS + 0.05, { dur: inS * 1.2, vol: fast ? 0.11 : 0.05, filter: 'bandpass', f0: 1000, f1: 500, q: 1.2 });
        break;
      }
      case 'suitHit':
        s.noiseBurst('alerts', t, { dur: 0.35, vol: 0.5, f0: 1600, f1: 120 });
        s.noiseBurst('alerts', t + 0.1, { dur: 0.9, vol: 0.2, filter: 'highpass', f0: 4000, f1: 2500 });
        break;
      case 'crewDead':
        s.tone('alerts', t, { freq: 880, dur: 2.2, vol: 0.12 });
        s.tone('alerts', t, { freq: 110, dur: 2, type: 'sawtooth', vol: 0.16, slideTo: 40 });
        break;
      case 'jettison':
        s.noiseBurst('sfx', t, { dur: 0.6, vol: 0.35, f0: 700, f1: 150 });
        s.tone('sfx', t, { freq: 300, dur: 0.3, type: 'square', vol: 0.12, slideTo: 120 });
        break;
      case 'blip': {
        const n = 2 + Math.floor(R() * 3);
        for (let k = 0; k < n; k++) {
          const f = 520 + R() * 480;
          s.tone('alerts', t + k * 0.07, { freq: f, dur: 0.06, type: 'triangle', vol: 0.09, slideTo: f * (0.85 + R() * 0.4) });
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
  ng.gain.value = 0.11;
  src.connect(lp).connect(ng).connect(g);
  const hum = ctx.createGain();
  hum.gain.value = 0.05;
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
