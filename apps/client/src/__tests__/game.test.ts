import { beforeEach, describe, expect, it } from 'vitest';
import { catalog, getNode, SYSTEM_IDS, type RunState } from '@payload/shared';
import { dangerLevel, musicMixFor, MUSIC_LAYERS } from '../audio/musicLogic';
import { resetCueMemory, useCues } from '../audio/cues';
import { SFX_IDS, SFX_META, sfxForRunEvent, stepSfxFor } from '../audio/soundLogic';
import { chargedAction, EVADE_HOLD_S, holdAction, incidentAt, interactionAt, nextThrottle, promptFor, startsDodge } from '../game/interaction';
import { BULKHEADS_Z, HULL, STATIONS, STATION_IDS, USE_RADIUS, distanceToStation, nearestStation, runSecondsBetween, zoneAt } from '../game/layout';
import { getRun, useGame } from '../game/runStore';
import { useUi } from '../state/ui';
import { systemDrawKw, systemStatus } from '../ui/PowerPanel';

function freshRun(seed = 7): RunState {
  useGame.getState().startRun(seed);
  return getRun()!.state;
}

/** Avanza la partida como lo hace la escena: un `tick` por frame. */
function play(seconds: number, frame = 1 / 30): void {
  for (let t = 0; t < seconds; t += frame) useGame.getState().tick(frame);
}

beforeEach(() => {
  useGame.getState().toMenu();
  resetCueMemory();
});

describe('distribución de la nave', () => {
  it('todos los puestos están dentro del casco y se pueden usar sin atravesar mamparos', () => {
    for (const id of STATION_IDS) {
      const s = STATIONS[id];
      for (const [x, z] of [[s.x, s.z], [s.useX, s.useZ]] as const) {
        expect(Math.abs(x), id).toBeLessThan(HULL.halfWidth);
        expect(z, id).toBeGreaterThan(HULL.minZ);
        expect(z, id).toBeLessThan(HULL.maxZ);
      }
      expect(zoneAt(s.z), id).toBe(zoneAt(s.useZ));
      for (const bz of BULKHEADS_Z) expect(Math.abs(s.useZ - bz), id).toBeGreaterThan(0.8);
      expect(nearestStation(s.useX, s.useZ), id).toBe(id);
    }
  });

  it('cada zona tiene sus puestos: puente, cubierta media y sala de máquinas', () => {
    const zone = (id: (typeof STATION_IDS)[number]) => zoneAt(STATIONS[id].z);
    expect(['helm', 'map', 'nav'].map((id) => zone(id as 'helm'))).toEqual(['bridge', 'bridge', 'bridge']);
    expect([zone('lifeSupport'), zone('shields')]).toEqual(['mid', 'mid']);
    expect([zone('power'), zone('reactor'), zone('engines')]).toEqual(['engine', 'engine', 'engine']);
  });

  it('lejos de todo no hay puesto; en el centro de la cubierta tampoco', () => {
    expect(nearestStation(0, 1.5)).toBeNull();
    expect(distanceToStation('reactor', 0, 1.5)).toBeGreaterThan(USE_RADIUS);
  });

  it('el timón y el reactor quedan lejos: una sola persona no llega a todo (base del cooperativo)', () => {
    const helmToReactor = runSecondsBetween('helm', 'reactor');
    expect(helmToReactor).toBeGreaterThan(3);
    expect(helmToReactor).toBeLessThan(6);
    expect(runSecondsBetween('reactor', 'helm')).toBeCloseTo(helmToReactor, 5);
    // El aviso de impacto a crucero da menos margen que ir y volver.
    const ship = catalog.ships[0]!;
    const warnS = catalog.hazards.impact.warnLeadLy / ship.cruiseSpeedLyPerS;
    expect(warnS).toBeGreaterThan(helmToReactor + EVADE_HOLD_S);
    expect(warnS).toBeLessThan(helmToReactor * 2 + catalog.hazards.incidents.fire.repairS);
  });
});

describe('interacciones', () => {
  it('en la mesa del mapa y el panel de energía se abre su panel; en el timón se cambia el régimen', () => {
    const s = freshRun();
    expect(interactionAt('map', s)).toEqual({ kind: 'map' });
    expect(interactionAt('power', s)).toEqual({ kind: 'power' });
    expect(interactionAt('helm', s)).toEqual({ kind: 'helm', canEvade: false });
    expect(interactionAt(null, s)).toBeNull();
    expect(promptFor(interactionAt('helm', s), s)).toMatchObject({ key: 'prompt.helm', blocked: true, altKey: 'prompt.throttle', altParams: { throttle: 'cruise' } });
    expect(nextThrottle('eco')).toBe('cruise');
    expect(nextThrottle('burn')).toBe('eco');
  });

  it('un sistema sano no ofrece nada; dañado pide repuesto; con avería, arreglarla va primero', () => {
    const s = freshRun();
    expect(interactionAt('engines', s)).toBeNull();
    const damaged: RunState = { ...s, ship: { ...s.ship, systems: { ...s.ship.systems, engines: { ...s.ship.systems.engines, healthPct: 40 } } } };
    expect(interactionAt('engines', damaged)).toEqual({ kind: 'repair', systemId: 'engines', blocked: false });
    expect(holdAction(interactionAt('engines', damaged), 0.1)).toEqual({ type: 'repair-system', systemId: 'engines', seconds: 0.1 });
    const noSpares: RunState = { ...damaged, ship: { ...damaged.ship, spares: 0 } };
    expect(interactionAt('engines', noSpares)).toMatchObject({ kind: 'repair', blocked: true });
    expect(holdAction(interactionAt('engines', noSpares), 0.1)).toBeNull();
    expect(promptFor(interactionAt('engines', noSpares), noSpares)).toMatchObject({ key: 'prompt.repairNoSpares', blocked: true });

    const burning: RunState = {
      ...damaged,
      incidents: [
        { id: 1, kind: 'short', systemId: 'engines', ageS: 0, progress: 0 },
        { id: 2, kind: 'fire', systemId: 'engines', ageS: 0, progress: 0.5 },
        { id: 3, kind: 'leak', systemId: 'nav', ageS: 0, progress: 0 },
      ],
    };
    expect(incidentAt(burning, 'engines')?.kind).toBe('fire');
    expect(holdAction(interactionAt('engines', burning), 0.05)).toEqual({ type: 'work-incident', incidentId: 2, seconds: 0.05 });
    expect(promptFor(interactionAt('engines', burning), burning)).toMatchObject({ key: 'prompt.fix.fire', hold: true, progress: 0.5, params: { system: 'engines' } });
    expect(incidentAt(burning, 'shields')).toBeNull();
  });

  it('con un impacto a la vista el timón ofrece la maniobra evasiva', () => {
    const s = freshRun();
    const warned: RunState = { ...s, phase: 'transit', warnings: [{ hazardId: 1, etaS: 5, evaded: false }] };
    expect(interactionAt('helm', warned)).toEqual({ kind: 'helm', canEvade: true });
    // Por defecto, pulsar E toma los mandos (minijuego de esquiva); con interacciones simples, mantener E.
    expect(promptFor(interactionAt('helm', warned), warned, 0.4)).toMatchObject({ key: 'prompt.evadeDodge', hold: false });
    expect(startsDodge(interactionAt('helm', warned), false)).toBe(true);
    expect(chargedAction(interactionAt('helm', warned), false)).toBeNull();
    expect(promptFor(interactionAt('helm', warned), warned, 0.4, true)).toMatchObject({ key: 'prompt.evade', hold: true, progress: 0.4 });
    expect(startsDodge(interactionAt('helm', warned), true)).toBe(false);
    expect(chargedAction(interactionAt('helm', warned), true)?.action).toEqual({ type: 'evade' });
    const done: RunState = { ...warned, warnings: [{ hazardId: 1, etaS: 5, evaded: true }] };
    expect(interactionAt('helm', done)).toEqual({ kind: 'helm', canEvade: false });
  });

  it('con la partida terminada no se puede usar nada', () => {
    const s = freshRun();
    expect(interactionAt('map', { ...s, phase: 'lost' })).toBeNull();
    expect(interactionAt('helm', { ...s, phase: 'won' })).toBeNull();
  });
});

describe('partida en el cliente (runStore)', () => {
  it('startRun crea la partida, publica la copia para la interfaz y toMenu la cierra', () => {
    expect(useGame.getState().screen).toBe('menu');
    expect(getRun()).toBeNull();
    const id = useGame.getState().runId;
    const s = freshRun(11);
    expect(useGame.getState()).toMatchObject({ screen: 'game', runId: id + 1, newBest: false });
    expect(useGame.getState().hud).toEqual(s);
    expect(useGame.getState().hud).not.toBe(s);
    useGame.getState().toMenu();
    expect(useGame.getState()).toMatchObject({ screen: 'menu', hud: null });
    expect(getRun()).toBeNull();
  });

  it('un salto completo: la interfaz sigue al motor y los eventos se convierten en avisos y sonido', () => {
    const s = freshRun(11);
    const toId = getNode(s.sector, s.locationId)!.links[0]!;
    expect(useGame.getState().act({ type: 'jump', toId }).ok).toBe(true);
    expect(useGame.getState().hud?.phase).toBe('transit');
    expect(useCues.getState().captions.some((c) => c.key === 'sound.jump')).toBe(true);
    for (let i = 0; i < 400 && getRun()!.state.phase === 'transit'; i++) {
      // Tripulación perfecta: todo lo que surge se arregla al momento.
      for (const inc of [...getRun()!.state.incidents]) for (let k = 0; k < 60; k++) useGame.getState().act({ type: 'work-incident', incidentId: inc.id, seconds: 0.5 }, true);
      if (getRun()!.state.warnings.some((w) => !w.evaded)) useGame.getState().act({ type: 'evade' }, true);
      play(0.5);
    }
    play(0.2);
    const hud = useGame.getState().hud!;
    expect(hud.phase === 'docked' || hud.phase === 'won').toBe(true);
    expect(hud.locationId).toBe(toId);
    expect(hud.stats.jumps).toBe(1);
    expect(useGame.getState().toasts.some((t) => t.message.key === 'event.arrived')).toBe(true);
  });

  it('una acción rechazada deja un aviso con el motivo (salvo las mantenidas por frame)', () => {
    freshRun(3);
    expect(useGame.getState().act({ type: 'evade' }).ok).toBe(false);
    expect(useGame.getState().toasts.at(-1)?.message.key).toBe('reject.notInTransit');
    const count = useGame.getState().toasts.length;
    useGame.getState().act({ type: 'repair-system', systemId: 'nav', seconds: 0.1 }, true);
    expect(useGame.getState().toasts).toHaveLength(count);
  });

  it('en pausa (o con ajustes abiertos) el tiempo no corre; con el mapa o el panel de energía sí', () => {
    freshRun(3);
    useUi.getState().setOverlay('pause');
    play(2);
    expect(getRun()!.state.stats.timeS).toBe(0);
    useUi.getState().setOverlay('settings');
    play(2);
    expect(getRun()!.state.stats.timeS).toBe(0);
    useUi.getState().setOverlay('map');
    play(2);
    expect(getRun()!.state.stats.timeS).toBeGreaterThan(1.8);
    useUi.getState().setOverlay(null);
  });

  it('perder la partida actualiza la mejor marca y permite empezar otra desde cero', () => {
    freshRun(5);
    useGame.getState().act({ type: 'toggle-system', systemId: 'lifeSupport', enabled: false });
    play(100 / catalog.ships[0]!.crewO2UsePctPerS + 5, 0.25);
    expect(useGame.getState().hud).toMatchObject({ phase: 'lost', lossReason: 'oxygen' });
    expect(useCues.getState().flash?.tone).toBe('bad');
    const first = getRun();
    useGame.getState().startRun(6);
    expect(getRun()).not.toBe(first);
    expect(useGame.getState().hud).toMatchObject({ phase: 'docked', score: 0 });
    expect(useGame.getState().hud!.ship.oxygenPct).toBe(100);
  });
});

describe('panel de energía', () => {
  it('estado y consumo de cada sistema', () => {
    const s = freshRun();
    for (const id of SYSTEM_IDS) expect(systemStatus(s, id)).toBe('online');
    const sys = s.ship.systems;
    const broken: RunState = {
      ...s,
      ship: {
        ...s.ship,
        throttle: 'burn',
        systems: {
          ...sys,
          nav: { ...sys.nav, enabled: false, online: false },
          shields: { ...sys.shields, shorted: true, online: false },
          engines: { ...sys.engines, healthPct: 0, online: false },
          lifeSupport: { ...sys.lifeSupport, online: false },
        },
      },
    };
    expect(systemStatus(broken, 'nav')).toBe('off');
    expect(systemStatus(broken, 'shields')).toBe('shorted');
    expect(systemStatus(broken, 'engines')).toBe('broken');
    expect(systemStatus(broken, 'lifeSupport')).toBe('noPower');
    expect(systemDrawKw(broken, 'engines')).toBeGreaterThan(systemDrawKw(s, 'engines'));
    expect(systemDrawKw(s, 'shields')).toBe(catalog.ships[0]!.systemDrawKw.shields);
  });
});

describe('audio', () => {
  it('cada efecto tiene bus y los que avisan de peligro destellan', () => {
    for (const id of SFX_IDS) expect(['sfx', 'alerts', 'voice']).toContain(SFX_META[id].bus);
    expect(SFX_META.alarm.flash).toBe('bad');
    expect(SFX_META.impact.flash).toBe('bad');
  });

  it('los eventos del motor suenan según su gravedad', () => {
    expect(sfxForRunEvent({ type: 'incident', incidentKind: 'fire' })).toBe('alarm');
    expect(sfxForRunEvent({ type: 'incident', incidentKind: 'short' })).toBe('sparks');
    expect(sfxForRunEvent({ type: 'impact-warning' })).toBe('warnTick');
    expect(sfxForRunEvent({ type: 'impact-hit' })).toBe('impact');
    expect(sfxForRunEvent({ type: 'incident-fixed', incidentKind: 'leak' })).toBe('fixed');
    expect(sfxForRunEvent({ type: 'sector-cleared' })).toBe('success');
    expect(sfxForRunEvent({ type: 'new-sector' })).toBeNull();
    // Fase 5: ciencia y datos.
    expect(sfxForRunEvent({ type: 'mission-complete' })).toBe('success');
    expect(sfxForRunEvent({ type: 'objective-met' })).toBe('success');
    expect(sfxForRunEvent({ type: 'storage-full' })).toBe('storageFull');
    expect(sfxForRunEvent({ type: 'contact-start' })).toBe('contact');
    expect(sfxForRunEvent({ type: 'observation-done' })).toBe('observation');
    expect(sfxForRunEvent({ type: 'overheat' })).toBe('overheat');
    expect(sfxForRunEvent({ type: 'battery-empty' })).toBe('powerDown');
    expect(sfxForRunEvent({ type: 'blackout' })).toBe('powerDown');
  });

  it('la música sube de tensión con el peligro y resuelve al superar el sector', () => {
    const calm = musicMixFor({ screen: 'game', phase: 'transit', danger: 0 });
    const hot = musicMixFor({ screen: 'game', phase: 'transit', danger: 1 });
    expect(hot.tension).toBeGreaterThan(calm.tension);
    expect(hot.pulse).toBeGreaterThan(calm.pulse);
    expect(calm.drive).toBeGreaterThan(0);
    expect(musicMixFor({ screen: 'game', phase: 'won' }).scene).toBe('won');
    expect(musicMixFor({ screen: 'menu' }).tension).toBe(0);
    for (const m of [calm, hot]) for (const l of MUSIC_LAYERS) expect(m[l]).toBeGreaterThanOrEqual(0);
    expect(dangerLevel({ incidents: 0, warnings: 0, overloaded: false, hullPct: 100, oxygenPct: 100 })).toBe(0);
    expect(dangerLevel({ incidents: 3, warnings: 1, overloaded: true, hullPct: 10, oxygenPct: 10 })).toBe(1);
    expect(dangerLevel({ incidents: 1, warnings: 0, overloaded: false, hullPct: 100, oxygenPct: 100 })).toBeGreaterThan(0);
  });
});

describe('audio: pasos e interacciones nuevas', () => {
  it('los pasos dependen del lugar y del suelo del mundo', () => {
    expect(stepSfxFor(false)).toBe('stepShip');
    expect(stepSfxFor(true, 'ice-core')).toBe('stepIce');
    expect(stepSfxFor(true, 'dust-moon')).toBe('stepDust');
    expect(stepSfxFor(true, 'fractured-world')).toBe('stepRock');
    expect(stepSfxFor(true, undefined)).toBe('stepRock');
  });

  it('pasos, foco y clic no llevan subtítulo ni flash y se espacian', () => {
    for (const id of ['click', 'hover', 'stepShip', 'stepDust', 'stepRock', 'stepIce', 'footLand'] as const) {
      expect(SFX_META[id].captionKey, id).toBeNull();
      expect(SFX_META[id].flash, id).toBeNull();
    }
    expect(SFX_META.hover.minGapMs).toBeGreaterThanOrEqual(150);
    for (const id of ['stepShip', 'stepDust', 'stepRock', 'stepIce'] as const) expect(SFX_META[id].minGapMs).toBeGreaterThanOrEqual(150);
  });

  it('los avisos de ciencia y energía tienen sonido propio y destello', () => {
    for (const id of ['overheat', 'powerDown', 'storageFull', 'contact', 'observation', 'earthCall', 'go', 'noGo', 'launch', 'ping', 'creak'] as const) {
      expect(SFX_META[id].captionKey, id).not.toBeNull();
    }
    for (const id of ['overheat', 'powerDown', 'storageFull'] as const) expect(SFX_META[id].bus).toBe('alerts');
  });
});
