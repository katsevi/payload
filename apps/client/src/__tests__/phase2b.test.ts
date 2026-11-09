import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalog, type SimEvent } from '@payload/shared';
import type { PhaseName } from '../app/missionMachine';
import { AudioEngine } from '../audio/audioEngine';
import { cue, resetCueMemory, useCues } from '../audio/cues';
import { LOW_BATTERY_PCT, MUSIC_LAYERS, musicMixFor, sameMix } from '../audio/musicLogic';
import { SFX_IDS, SFX_META, countdownTickAt, sfxForLaunchPhase, sfxForSimEvent } from '../audio/soundLogic';
import {
  hasRover, payloadCountOf, instrumentState, instrumentTarget, mainInstrument, roverComponentIds, surfaceKind, ROVER_MODEL_FILE,
} from '../instrument/instrumentLogic';
import { dialogueFor, mascotDef, missionHelpTrigger } from '../mascot/mascotLogic';
import { isMicrogravity } from '../state/launch';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import es from '../locales/es.json';
import en from '../locales/en.json';
import { flatten } from '../i18n/flatten';

const PHASES: PhaseName[] = ['menu', 'briefing', 'design', 'review', 'prelaunch', 'launch', 'operation', 'report'];

describe('motor de audio sin AudioContext (node)', () => {
  it('no hay AudioContext y nada lanza', () => {
    const a = new AudioEngine();
    expect(a.isAvailable()).toBe(false);
    expect(a.unlock()).toBe(false);
    expect(a.isUnlocked()).toBe(false);
    expect(() => {
      a.setVolumes({ muteAll: false, music: 1, sfx: 1, alerts: 1 });
      a.setMusic(musicMixFor({ phase: 'launch', launchPhase: 'ascent' }));
      for (const id of SFX_IDS) a.play(id);
      a.stopLoop('roar');
      const remove = a.addEmitter('consoleHum', [1, 1, 1]);
      a.setListener([0, 1.6, 0], 0.3);
      a.setBackground(true);
      remove();
      a.dispose();
    }).not.toThrow();
  });

  it('recuerda la mezcla de música aunque el contexto aún no exista', () => {
    const a = new AudioEngine();
    const mix = musicMixFor({ phase: 'review' });
    a.setMusic(mix);
    expect(sameMix(a.getMusic(), mix)).toBe(true);
  });

  it('cue() deja flash y subtítulo aunque no haya audio', () => {
    resetCueMemory();
    expect(cue('batteryAlarm')).toBe(true);
    const s = useCues.getState();
    expect(s.flash?.tone).toBe('bad');
    expect(s.captions.map((c) => c.key)).toContain('sound.batteryAlarm');
    // un segundo aviso inmediato se descarta (enfriamiento)
    expect(cue('batteryAlarm')).toBe(false);
    resetCueMemory();
  });
});

describe('motor de audio con un AudioContext simulado', () => {
  // Proxy profundo: cualquier propiedad/llamada devuelve el propio proxy. Sirve para recorrer todo el
  // código de síntesis y comprobar que no lanza ni deja el motor en un estado raro.
  function deepMock(): unknown {
    const fn = function () {};
    const p: unknown = new Proxy(fn, {
      get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : k === 'state' ? 'running' : p),
      apply: () => p,
      construct: () => p as object,
      set: () => true,
    });
    return p;
  }
  beforeEach(() => {
    vi.stubGlobal('AudioContext', function () {
      return deepMock();
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('con volumen de música 0 se paran las capas y se reanudan al subirlo', () => {
    const a = new AudioEngine();
    a.setVolumes({ muteAll: false, music: 0, sfx: 1, alerts: 1 });
    a.unlock();
    const n = () => (a as unknown as { musicSources: unknown[] }).musicSources.length;
    expect(n()).toBe(0);
    a.setVolumes({ muteAll: false, music: 0.5, sfx: 1, alerts: 1 });
    expect(n()).toBeGreaterThan(0);
    a.setVolumes({ muteAll: false, music: 0, sfx: 1, alerts: 1 });
    expect(n()).toBe(0);
    a.dispose();
  });

  it('construye el grafo, sintetiza todos los efectos y emisores 3D', () => {
    const a = new AudioEngine();
    const remove = a.addEmitter('exhibitHum', [-9, 1, 9]); // antes del desbloqueo: queda pendiente
    expect(a.unlock()).toBe(true);
    expect(a.isUnlocked()).toBe(true);
    a.setMusic(musicMixFor({ phase: 'operation', status: 'degraded', batteryPct: 10 }));
    a.setVolumes({ muteAll: false, music: 0.4, sfx: 0.7, alerts: 0.9 });
    for (const id of SFX_IDS) expect(() => a.play(id)).not.toThrow();
    expect(() => {
      a.setListener([1, 1.6, 2], 1);
      a.stopLoop('roar', 1);
      a.setVolumes({ muteAll: true, music: 0.4, sfx: 0.7, alerts: 0.9 });
      remove();
      a.dispose();
    }).not.toThrow();
  });
});

describe('música adaptativa: capas por fase y estado (función pura)', () => {
  it('todas las ganancias están en [0, 1] para cualquier fase', () => {
    for (const phase of PHASES) {
      const m = musicMixFor({ phase });
      for (const l of MUSIC_LAYERS) {
        expect(m[l]).toBeGreaterThanOrEqual(0);
        expect(m[l]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('menú y hangar son tranquilos; la revisión añade tensión', () => {
    const design = musicMixFor({ phase: 'design' });
    expect(design.tension).toBe(0);
    expect(design.drive).toBe(0);
    expect(musicMixFor({ phase: 'menu' }).tension).toBe(0);
    expect(musicMixFor({ phase: 'review' }).tension).toBeGreaterThan(design.tension);
  });

  it('el lanzamiento es intenso y sigue la secuencia', () => {
    const count = musicMixFor({ phase: 'launch', launchPhase: 'countdown' });
    const ascent = musicMixFor({ phase: 'launch', launchPhase: 'ascent' });
    expect(ascent.drive).toBe(1);
    expect(ascent.drive).toBeGreaterThan(count.drive);
    expect(musicMixFor({ phase: 'launch', launchPhase: 'failure' }).tension).toBe(1);
    expect(musicMixFor({ phase: 'launch', launchPhase: 'success' }).resolve).toBeGreaterThan(0.4);
  });

  it('la operación nominal tiene pulso de telemetría y sin tensión', () => {
    const m = musicMixFor({ phase: 'operation', status: 'nominal', batteryPct: 90, inEclipse: false });
    expect(m.pulse).toBeGreaterThan(0.3);
    expect(m.tension).toBe(0);
  });

  it('batería baja o estado degradado añaden la capa de tensión; el fallo la lleva al máximo', () => {
    const nominal = musicMixFor({ phase: 'operation', status: 'nominal', batteryPct: 80 });
    const lowBattery = musicMixFor({ phase: 'operation', status: 'nominal', batteryPct: LOW_BATTERY_PCT - 1 });
    const degraded = musicMixFor({ phase: 'operation', status: 'degraded', batteryPct: 80 });
    const both = musicMixFor({ phase: 'operation', status: 'degraded', batteryPct: 5 });
    const failed = musicMixFor({ phase: 'operation', status: 'failed', batteryPct: 0 });
    expect(lowBattery.tension).toBeGreaterThan(nominal.tension);
    expect(degraded.tension).toBeGreaterThan(nominal.tension);
    expect(both.tension).toBeGreaterThan(degraded.tension);
    expect(failed.tension).toBe(1);
    // justo en el umbral aún no hay tensión
    expect(musicMixFor({ phase: 'operation', status: 'nominal', batteryPct: LOW_BATTERY_PCT }).tension).toBe(0);
  });

  it('el eclipse atenúa el pulso de telemetría', () => {
    const sun = musicMixFor({ phase: 'operation', status: 'nominal', batteryPct: 80, inEclipse: false });
    const ecl = musicMixFor({ phase: 'operation', status: 'nominal', batteryPct: 80, inEclipse: true });
    expect(ecl.pulse).toBeLessThan(sun.pulse);
  });

  it('el informe es resolutivo si hubo éxito y apagado si no', () => {
    expect(musicMixFor({ phase: 'report', success: true }).resolve).toBe(1);
    expect(musicMixFor({ phase: 'report', success: false }).resolve).toBe(0);
  });
});

describe('efectos: tabla de avisos', () => {
  it('cada efecto con subtítulo tiene su clave en ui (es y en)', () => {
    const esK = flatten(es);
    const enK = flatten(en);
    for (const id of SFX_IDS) {
      const key = SFX_META[id].captionKey;
      if (!key) continue;
      expect(esK[key], `es ${key}`).toBeTruthy();
      expect(enK[key], `en ${key}`).toBeTruthy();
      expect(esK[key]).toMatch(/^\[.+\]$/);
    }
  });

  it('todo aviso sonoro importante tiene equivalente visual (flash)', () => {
    for (const id of ['batteryAlarm', 'contact', 'radioStatic', 'explosion', 'success'] as const) {
      expect(SFX_META[id].flash, id).not.toBeNull();
      expect(SFX_META[id].captionKey, id).not.toBeNull();
    }
  });

  it('eventos del motor → sonido', () => {
    expect(sfxForSimEvent('battery-low')).toBe('batteryAlarm');
    expect(sfxForSimEvent('contact-start')).toBe('contact');
    expect(sfxForSimEvent('solar-storm')).toBe('radioStatic');
    expect(sfxForSimEvent('component-failure')).toBe('radioStatic');
    expect(sfxForSimEvent('eclipse-enter')).toBeNull();
    expect(sfxForLaunchPhase('ascent')).toBe('liftoff');
    expect(sfxForLaunchPhase('separation')).toBe('separation');
    expect(sfxForLaunchPhase('countdown')).toBeNull();
    expect(countdownTickAt(5)).toBe(true);
    expect(countdownTickAt(0)).toBe(false);
    expect(countdownTickAt(8)).toBe(false);
  });
});

describe('ajustes de audio persistidos', () => {
  it('tiene valores por defecto razonables', () => {
    const s = useSettings.getState();
    expect(s.muteAll).toBe(false);
    for (const v of [s.volMusic, s.volSfx, s.volAlerts]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(typeof s.soundCaptions).toBe('boolean');
  });
});

// ── Vista del instrumento ────────────────────────────────────────────────────

const ev = (type: string, key?: string, params?: Record<string, unknown>) => ({ type, message: key ? { key, params } : undefined });

describe('vista del instrumento: estado (función pura)', () => {
  const base = { payloadCount: 1, inEclipse: false, status: 'nominal' as const, events: [] };

  it('nominal con luz y apuntado bueno', () => {
    const s = instrumentState(base);
    expect(s.condition).toBe('nominal');
    expect(s.dark || s.degraded || s.lost).toBe(false);
    expect(s.blur).toBe(0);
  });

  it('eclipse = imagen oscura', () => {
    const s = instrumentState({ ...base, inEclipse: true });
    expect(s.condition).toBe('eclipse');
    expect(s.dark).toBe(true);
  });

  it('reaction-wheel-failure = apuntado degradado (desenfoque y temblor)', () => {
    const s = instrumentState({ ...base, events: [ev('reaction-wheel-failure', 'event.reactionWheelFailure')] });
    expect(s.condition).toBe('degraded');
    expect(s.degraded).toBe(true);
    expect(s.blur).toBeGreaterThan(0);
    expect(s.shake).toBeGreaterThan(0);
  });

  it('el fallo de ADCS también degrada el apuntado', () => {
    const s = instrumentState({ ...base, events: [ev('component-failure', 'event.componentFailure.adcs')] });
    expect(s.degraded).toBe(true);
  });

  it('component-failure del último instrumento = perdido', () => {
    const s = instrumentState({ ...base, events: [ev('component-failure', 'event.componentFailure.payload', { remaining: 0 })] });
    expect(s.condition).toBe('lost');
    expect(s.lost).toBe(true);
    expect(s.lostReason).toBe('payload');
  });

  it('si queda otro instrumento no está perdido; si fallan todos, sí', () => {
    const one = instrumentState({ ...base, payloadCount: 2, events: [ev('component-failure', 'event.componentFailure.payload', { remaining: 1 })] });
    expect(one.lost).toBe(false);
    expect(one.failedPayloads).toBe(1);
    const all = instrumentState({
      ...base, payloadCount: 2,
      events: [ev('component-failure', 'event.componentFailure.payload'), ev('component-failure', 'event.componentFailure.payload')],
    });
    expect(all.lost).toBe(true);
  });

  it('otros fallos de componentes no afectan al visor', () => {
    const s = instrumentState({ ...base, events: [ev('component-failure', 'event.componentFailure.comms')] });
    expect(s.condition).toBe('nominal');
  });

  it('misión fallida = sin señal; lo perdido manda sobre eclipse y degradado', () => {
    const failed = instrumentState({ ...base, status: 'failed' });
    expect(failed.lost).toBe(true);
    expect(failed.lostReason).toBe('mission');
    const lostInEclipse = instrumentState({
      ...base, inEclipse: true, events: [ev('reaction-wheel-failure'), ev('component-failure', 'event.componentFailure.payload', { remaining: 0 })],
    });
    expect(lostInEclipse.condition).toBe('lost');
    expect(lostInEclipse.dark).toBe(false);
  });

  it('eclipse y degradado a la vez: oscuro, sigue marcado como degradado', () => {
    const s = instrumentState({ ...base, inEclipse: true, events: [ev('reaction-wheel-failure')] });
    expect(s.condition).toBe('eclipse');
    expect(s.dark).toBe(true);
    expect(s.degraded).toBe(true);
  });

  it('sin instrumentos no hay imagen', () => {
    expect(instrumentState({ ...base, payloadCount: 0 }).condition).toBe('noInstrument');
  });

  it('acepta eventos reales del motor', () => {
    const e: SimEvent = { type: 'reaction-wheel-failure', tSeconds: 10, message: { key: 'event.reactionWheelFailure' } };
    expect(instrumentState({ ...base, events: [e] }).degraded).toBe(true);
  });
});

describe('vista del instrumento: apuntado resultante y rover', () => {
  const base = { payloadCount: 1, inEclipse: false, status: 'nominal' as const, events: [] };
  it('un fallo de ADCS solo desenfoca si el apuntado resultante supera el requerido', () => {
    const good = instrumentState({ ...base, requiredPointingDeg: 0.5, events: [ev('component-failure', 'event.componentFailure.adcs', { accuracyDeg: 0.1 })] });
    expect(good.degraded).toBe(false);
    const bad = instrumentState({ ...base, requiredPointingDeg: 0.5, events: [ev('component-failure', 'event.componentFailure.adcs', { accuracyDeg: 5 })] });
    expect(bad.degraded).toBe(true);
  });
  it('la rueda de reacción usa backupDeg; sin dato cae al comportamiento previo', () => {
    expect(instrumentState({ ...base, requiredPointingDeg: 1, events: [ev('reaction-wheel-failure', 'event.reactionWheelFailure', { backupDeg: 0.8 })] }).degraded).toBe(false);
    expect(instrumentState({ ...base, requiredPointingDeg: 1, events: [ev('reaction-wheel-failure', 'event.reactionWheelFailure', { backupDeg: 3 })] }).degraded).toBe(true);
    expect(instrumentState({ ...base, requiredPointingDeg: 1, events: [ev('reaction-wheel-failure')] }).degraded).toBe(true);
  });
  it('un instrumento sin requisito de apuntado no se desenfoca si se conoce el apuntado', () => {
    expect(instrumentState({ ...base, events: [ev('reaction-wheel-failure', 'event.reactionWheelFailure', { backupDeg: 3 })] }).degraded).toBe(false);
  });
  it('el rover no cuenta como óptica: si fallan todas las ópticas hay sin señal aunque el rover siga', () => {
    expect(payloadCountOf(['payload-surface-rover'])).toBe(0);
    const optic = catalog.components.find((c) => c.subsystem === 'payload' && c.model !== ROVER_MODEL_FILE);
    if (optic) expect(payloadCountOf([optic.id, 'payload-surface-rover'])).toBe(1);
    const s = instrumentState({ ...base, events: [ev('component-failure', 'event.componentFailure.payload', { component: optic?.id ?? 'x', remaining: 1 })] });
    expect(s.lost).toBe(true);
  });
  it('el fallo del rover no afecta a la vista orbital', () => {
    const s = instrumentState({ ...base, payloadCount: 1, events: [ev('component-failure', 'event.componentFailure.payload', { component: 'payload-surface-rover', remaining: 1 })] });
    expect(s.lost).toBe(false);
  });
});

describe('vista del instrumento: objetivo e instrumento principal', () => {
  it('qué ve el instrumento según el tipo de misión', () => {
    expect(instrumentTarget('earth-observation')).toBe('earth');
    expect(instrumentTarget('telecom')).toBe('earth');
    expect(instrumentTarget('space-telescope')).toBe('stars');
    expect(instrumentTarget('lunar-exploration')).toBe('moon');
    expect(instrumentTarget('mars-exploration')).toBe('mars');
    expect(instrumentTarget(undefined)).toBe('earth');
  });

  it('el instrumento principal es un payload del diseño (el de mejor resolución si la hay)', () => {
    const payloads = catalog.components.filter((c) => c.subsystem === 'payload');
    expect(mainInstrument([])).toBeNull();
    expect(mainInstrument(catalog.components.filter((c) => c.subsystem !== 'payload').map((c) => c.id))).toBeNull();
    const main = mainInstrument(payloads.map((c) => c.id));
    expect(main?.subsystem).toBe('payload');
    const withRes = payloads.filter((c) => c.groundResolutionAt500KmM !== undefined && c.model !== ROVER_MODEL_FILE);
    if (withRes.length > 1) {
      const best = Math.min(...withRes.map((c) => c.groundResolutionAt500KmM!));
      expect(main?.groundResolutionAt500KmM).toBe(best);
    }
  });
});

describe('Aurora G9 / rover', () => {
  const rover = catalog.components.find((c) => c.model === ROVER_MODEL_FILE);

  it('el catálogo trae el rover como componente con el modelo del mecha', () => {
    expect(rover?.id).toBe('payload-surface-rover');
    expect(rover?.subsystem).toBe('payload');
  });

  it('se reconoce por su modelo y la vista de superficie solo existe en lunar/Marte', () => {
    expect(roverComponentIds(['structure-x', 'payload-surface-rover'])).toEqual(['payload-surface-rover']);
    expect(hasRover([])).toBe(false);
    expect(hasRover(['payload-surface-rover'])).toBe(true);
    expect(surfaceKind('lunar-exploration', ['payload-surface-rover'])).toBe('moon');
    expect(surfaceKind('mars-exploration', ['payload-surface-rover'])).toBe('mars');
    expect(surfaceKind('earth-observation', ['payload-surface-rover'])).toBeNull();
    expect(surfaceKind('lunar-exploration', [])).toBeNull();
  });

  it('con rover y otra óptica, el instrumento principal no es el rover', () => {
    const optic = catalog.components.find((c) => c.subsystem === 'payload' && c.model !== ROVER_MODEL_FILE);
    if (!optic) return;
    expect(mainInstrument(['payload-surface-rover', optic.id])?.id).toBe(optic.id);
  });
});

// ── Mascota en el lanzamiento y en el briefing ───────────────────────────────

describe('mascota: gravedad cero y consejo del briefing', () => {
  it('microgravedad desde la separación de etapas', () => {
    expect(isMicrogravity('countdown')).toBe(false);
    expect(isMicrogravity('ascent')).toBe(false);
    expect(isMicrogravity('separation')).toBe(true);
    expect(isMicrogravity('success')).toBe(true);
    expect(isMicrogravity('failure')).toBe(false);
  });

  it('el disparador del consejo es help:<tipo de misión> y se resuelve con el JSON de la mascota', () => {
    expect(missionHelpTrigger('lunar-exploration')).toBe('help:lunar-exploration');
    const mascot = mascotDef();
    expect(mascot).not.toBeNull();
    for (const type of ['earth-observation', 'telecom', 'space-telescope', 'lunar-exploration', 'mars-exploration'] as const) {
      expect(dialogueFor(missionHelpTrigger(type), mascot), type).not.toBeNull();
    }
  });

  it('la mascota tiene diálogo para el lanzamiento (phase:launch y event:launch-success)', () => {
    const mascot = mascotDef();
    expect(dialogueFor('phase:launch', mascot)).not.toBeNull();
    expect(dialogueFor('event:launch-success', mascot)).not.toBeNull();
  });
});

describe('estado de UI del instrumento', () => {
  it('alterna con I y se cierra la superficie al salir', () => {
    useUi.getState().setInstrument(false);
    useUi.getState().toggleInstrument();
    expect(useUi.getState().instrument).toBe(true);
    useUi.getState().setSurface(true);
    useUi.getState().setInstrument(false);
    expect(useUi.getState().instrument).toBe(false);
    expect(useUi.getState().surface).toBe(false);
  });
});
