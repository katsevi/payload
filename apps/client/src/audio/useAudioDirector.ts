import { useEffect } from 'react';
import type { PhaseName } from '../app/missionMachine';
import { reportTrigger } from '../mascot/mascotLogic';
import { useMascot } from '../mascot/mascotStore';
import { useDesign } from '../state/design';
import { useLaunch } from '../state/launch';
import { useSettings } from '../state/settings';
import { useSim } from '../state/sim';
import { audio } from './audioEngine';
import { cue, resetCueMemory } from './cues';
import { musicMixFor, type MusicContext } from './musicLogic';
import { countdownTickAt, sfxForLaunchPhase, sfxForSimEvent } from './soundLogic';

/** Contexto de música a partir de los stores (puro respecto al motor de audio). */
export function currentMusicContext(phase: PhaseName): MusicContext {
  const ctx: MusicContext = { phase };
  if (phase === 'launch') ctx.launchPhase = useLaunch.getState().phase;
  if (phase === 'operation') {
    const snap = useSim.getState().snapshot;
    if (snap) {
      ctx.status = snap.status;
      ctx.batteryPct = snap.batteryPct;
      ctx.inEclipse = snap.inEclipse;
    }
  }
  if (phase === 'report') {
    const r = useSim.getState().result;
    if (r) ctx.success = reportTrigger(r) === 'report:success';
  }
  return ctx;
}

/**
 * Conecta el audio con el juego (se monta una vez en App). Solo ESCUCHA los stores (settings, sim,
 * launch, design, mascota) y la fase; no duplica lógica de juego:
 *  - gesto del usuario → desbloquea el AudioContext;
 *  - ajustes → volúmenes; fase/estado → mezcla de música (`musicMixFor`);
 *  - eventos del motor → efectos y avisos (`sfxForSimEvent`); lanzamiento → cuenta atrás, rugido, separación;
 *  - clics de interfaz, montar/quitar pieza en el hangar y voz de la mascota.
 * Cada `cue()` deja además su flash y subtítulo de sonido, aunque no haya audio.
 */
export function useAudioDirector(phase: PhaseName): void {
  // Desbloqueo con el primer gesto + pausa en segundo plano
  useEffect(() => {
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    const unlock = () => {
      // Sin Web Audio no hay nada que desbloquear: se dejan de escuchar los gestos.
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

  // Voz de la mascota: un gorjeo cada vez que dice algo nuevo
  useEffect(
    () =>
      useMascot.subscribe((s, p) => {
        if (s.current && s.current.seq !== p.current?.seq) cue('mascotBlip');
      }),
    [],
  );

  // Música adaptativa por fase y estado
  useEffect(() => {
    const update = () => audio.setMusic(musicMixFor(currentMusicContext(phase)));
    update();
    const unsubs = [useSim.subscribe(update), useLaunch.subscribe(update)];
    return () => unsubs.forEach((u) => u());
  }, [phase]);

  // Hangar: montar / quitar pieza
  useEffect(() => {
    if (phase !== 'design') return;
    return useDesign.subscribe((s, p) => {
      if (s.componentIds.length > p.componentIds.length) cue('mount');
      else if (s.componentIds.length < p.componentIds.length) cue('unmount');
    });
  }, [phase]);

  // Lanzamiento: cuenta atrás, despegue, separación, anomalía
  useEffect(() => {
    if (phase !== 'launch') return;
    const unsub = useLaunch.subscribe((s, p) => {
      if (s.phase === 'countdown' && s.count !== p.count && countdownTickAt(s.count)) cue('countdownTick');
      if (s.phase !== p.phase && p.phase !== 'success' && p.phase !== 'failure') {
        // A partir del despegue manda la fase; separación y anomalía acaban con el rugido del motor.
        if (s.phase === 'separation') audio.stopLoop('roar', 2.5);
        if (s.phase === 'failure') audio.stopLoop('roar', 0.15);
        const id = sfxForLaunchPhase(s.phase);
        if (id) cue(id);
      }
    });
    return () => {
      unsub();
      audio.stopLoop('roar', 0.8);
    };
  }, [phase]);

  // Operación: eventos del motor → avisos
  useEffect(() => {
    if (phase !== 'operation') return;
    let lastId = useSim.getState().events.at(-1)?.id ?? -1;
    return useSim.subscribe((s, p) => {
      if (s.events === p.events) return;
      if (s.events.length < p.events.length) lastId = -1;
      for (const e of s.events) {
        if (e.id <= lastId) continue;
        lastId = e.id;
        const id = sfxForSimEvent(e.type);
        if (id) cue(id);
      }
    });
  }, [phase]);

  // Al volver al menú se limpian subtítulos y enfriamientos
  useEffect(() => {
    if (phase === 'menu') resetCueMemory();
  }, [phase]);
}
