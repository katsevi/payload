import { useEffect } from 'react';
import { effectiveShipOf } from '../game/effective';
import { getRun, useGame } from '../game/runStore';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { isRemote } from '../game/runStore';
import { audio } from './audioEngine';
import { cue, resetCueMemory } from './cues';
import { dangerLevel, musicMixFor, type MusicContext } from './musicLogic';
import { myCrew } from '../game/me';

/** Contexto de música a partir del estado de la partida (puro respecto al motor de audio). */
export function currentMusicContext(): MusicContext {
  const { screen, hud } = useGame.getState();
  if (screen !== 'game' || !hud) return { screen: 'menu' };
  const ship = effectiveShipOf(hud, getRun()?.catalog);
  const me = myCrew(hud);
  const outside = me?.location === 'eva';
  const storm = hud.surface ? (hud.surface.storm.active ? 1 : hud.surface.storm.warned ? 0.4 : 0) : 0;
  return {
    screen: 'game',
    phase: hud.phase,
    outside,
    danger: dangerLevel({
      suitO2Pct: outside ? me?.suitO2Pct : undefined,
      storm: outside ? storm : 0,
      incidents: hud.incidents.length,
      warnings: hud.warnings.filter((w) => !w.evaded).length,
      overloaded: hud.ship.overloaded,
      hullPct: (hud.ship.hull / ship.hullMax) * 100,
      oxygenPct: hud.ship.oxygenPct,
    }),
  };
}

/**
 * Conecta el audio con el juego (se monta una vez en App). Solo ESCUCHA los stores:
 *  - gesto del usuario → desbloquea el AudioContext; ajustes → volúmenes;
 *  - estado de la partida → mezcla de música (`musicMixFor`); clics de interfaz.
 * Los efectos de los eventos del motor los dispara `runStore` con `cue()` (suena + flash + subtítulo).
 */
export function useAudioDirector(): void {
  // Desbloqueo con el primer gesto + pausa en segundo plano
  useEffect(() => {
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    const unlock = () => {
      if (audio.unlock() || !audio.isAvailable()) for (const e of events) window.removeEventListener(e, unlock, true);
    };
    if (audio.isAvailable()) for (const e of events) window.addEventListener(e, unlock, true);
    const vis = () => audio.setBackground(document.hidden);
    document.addEventListener('visibilitychange', vis);
    return () => {
      for (const e of events) window.removeEventListener(e, unlock, true);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  // Ajustes → volúmenes
  useEffect(() => {
    const apply = (s: ReturnType<typeof useSettings.getState>) =>
      audio.setVolumes({ muteAll: s.muteAll, music: s.volMusic, sfx: s.volSfx, alerts: s.volAlerts });
    apply(useSettings.getState());
    return useSettings.subscribe(apply);
  }, []);

  // Clic de interfaz (botones, enlaces, selectores y casillas)
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('button, a, select, [role="button"], input[type="checkbox"]');
      if (el && !el.hasAttribute('disabled')) cue('click');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // Música adaptativa por estado de la partida; al volver al menú se limpian subtítulos y enfriamientos
  useEffect(() => {
    const update = () => audio.setMusic(musicMixFor(currentMusicContext()));
    update();
    return useGame.subscribe((s, p) => {
      if (s.hud !== p.hud || s.screen !== p.screen) update();
      if (s.screen !== 'game' && p.screen === 'game') resetCueMemory();
    });
  }, []);

  // Pausa: los bucles (motor del salto, propulsores, viento) bajan casi a nada mientras el juego está parado
  useEffect(() => {
    const PAUSING = new Set(['pause', 'settings', 'credits']);
    const apply = () => {
      const { screen } = useGame.getState();
      const overlay = useUi.getState().overlay;
      audio.setPaused(screen === 'game' && !isRemote() && overlay !== null && PAUSING.has(overlay));
    };
    apply();
    const a = useUi.subscribe(apply);
    const b = useGame.subscribe((s, p) => {
      if (s.screen !== p.screen) apply();
    });
    return () => {
      a();
      b();
    };
  }, []);
}
