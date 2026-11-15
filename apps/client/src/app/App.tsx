import { lazy, Suspense, useEffect, useState } from 'react';
import { SoundCaptions } from '../audio/SoundCaptions';
import { useAudioDirector } from '../audio/useAudioDirector';
import { useUiSounds } from '../audio/useUiSounds';
import { getMissions } from '@payload/shared';
import { reachStation, reachSurface } from '../game/debug';
import { loadDesign } from '../game/missionDesign';
import { getRun, useGame } from '../game/runStore';
import { sceneFor } from '../game/surfaceRules';
import { useCoop } from '../net/coopStore';
import { useUi } from '../state/ui';
import { CoopScreen, CrewBar } from '../ui/CoopScreen';
import { Hud } from '../ui/Hud';
import { PowerPanel } from '../ui/PowerPanel';
import { DesignScreen, MissionsScreen } from '../ui/MissionScreens';
import { CreditsScreen, EndScreen, HelpOverlay, MenuScreen, PauseScreen, SettingsPanel } from '../ui/Screens';
import { prefetchSolarMap, StarMap } from '../ui/StarMap';
import { StationTerminal } from '../ui/StationTerminal';
import { myCrew } from '../game/me';

// Escenas 3D con carga diferida: three/rapier no bloquean el primer pintado.
const ShipScene = lazy(() => import('../scenes/ShipScene').then((m) => ({ default: m.ShipScene })));
const MenuScene = lazy(() => import('../scenes/MenuScene').then((m) => ({ default: m.MenuScene })));
const HangarScene = lazy(() => import('../scenes/HangarScene').then((m) => ({ default: m.HangarScene })));
const loadSurface = () => import('../scenes/SurfaceScene').then((m) => ({ default: m.SurfaceScene }));
const SurfaceScene = lazy(loadSurface);

/** Solo desarrollo: lleva la partida a la superficie (`descent` = justo al empezar el descenso). */
function toSurface(stage: 'descent' | 'landed' | 'eva' = 'eva'): boolean {
  const run = getRun();
  if (!run) return false;
  const ok = reachSurface(run, stage);
  if (stage !== 'descent') useUi.getState().setDescentView(false);
  useGame.getState().tick(0);
  return ok;
}

/**
 * Solo desarrollo: atraca en la estación más cercana y abre su terminal. Con `loot` (por defecto) antes baja
 * al aterrizable más cercano a por carga vendible, para poder probar la venta.
 */
function toStation(loot = true): boolean {
  const run = getRun();
  if (!run) return false;
  const ok = reachStation(run, loot);
  useUi.getState().setDescentView(false);
  useGame.getState().tick(0);
  if (ok) useUi.getState().setOverlay('terminal');
  return ok;
}

/**
 * Raíz de la interfaz: menú o partida. La partida vive en `game/runStore` (el motor manda); aquí
 * solo se decide qué escena y qué paneles se pintan.
 */
/** Lo que tarda el fundido a negro en cubrir la pantalla antes de cambiar de escena (igual que en `.scene-veil`). */
const VEIL_IN_MS = 180;
/** Si la escena nueva no avisa (sin WebGL, error), el fundido se quita igualmente. */
const VEIL_MAX_MS = 6000;
/** Espera tras empezar la partida antes de preparar el mapa solar (la nave compila sus shaders primero). */
const SOLAR_PREFETCH_DELAY_MS = 2500;

/**
 * Cambio de escena dentro de la partida (nave ↔ descenso ↔ EVA) con fundido: primero se oscurece la pantalla y
 * después se monta la escena nueva, que lo quita al pintar (`revealScene`). Montar una escena bloquea el hilo
 * principal unos cientos de ms (contexto WebGL, física, mundo); bajo el fundido no se ve como un tirón. Fuera de
 * la partida el cambio es inmediato.
 */
function useSceneTransition(target: string, active: boolean): string {
  const [shown, setShown] = useState(target);
  useEffect(() => {
    if (shown === target) return;
    if (!active) {
      setShown(target);
      return;
    }
    useUi.getState().setSceneVeil(true);
    const id = setTimeout(() => setShown(target), VEIL_IN_MS);
    return () => clearTimeout(id);
  }, [target, shown, active]);
  const veil = useUi((s) => s.sceneVeil);
  useEffect(() => {
    if (!veil) return;
    const id = setTimeout(() => useUi.getState().setSceneVeil(false), VEIL_MAX_MS);
    return () => clearTimeout(id);
  }, [veil, shown]);
  return active ? shown : target;
}

export function App() {
  const screen = useGame((s) => s.screen);
  const runId = useGame((s) => s.runId);
  const phase = useGame((s) => s.hud?.phase);
  const overlay = useUi((s) => s.overlay);
  const crewAt = useGame((s) => myCrew(s.hud)?.location);
  const descentView = useUi((s) => s.descentView);
  // Cooperativo: la sala se pinta sobre el menú mientras se está en ella (o hay un error que enseñar).
  const coopOpen = useCoop((s) => s.lobby !== null || s.error !== null);
  const ended = phase === 'lost' || phase === 'won';
  const targetView = (() => {
    const scene = sceneFor(phase, crewAt, descentView);
    return scene === 'surface' ? (crewAt === 'eva' ? 'eva' : 'descent') : 'ship';
  })();
  const view = useSceneTransition(targetView, screen === 'game');
  const sceneVeil = useUi((s) => s.sceneVeil);
  useAudioDirector();
  useUiSounds();

  // Solo desarrollo: ?play=1[&seed=123] entra directo a la partida (capturas y depuración).
  // Fase 4: ?design=1[&mission=<id>] abre el hangar; ?play=1&seed=7&mission=<id> zarpa con el diseño de referencia
  // del fixture de esa misión (o el último guardado).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const q = new URLSearchParams(location.search);
    const w = window as unknown as { __payload?: object };
    w.__payload = { ...(w.__payload ?? {}), getRun, useGame, useUi, toSurface, toStation };
    if (useGame.getState().screen !== 'menu') return;
    const missionId = q.get('mission') ?? (q.get('design') ? (getMissions()[0]?.id ?? null) : null);
    const afterStart = () => {
      // ?surface=1 (fuera, en EVA) · ?surface=descent (minijuego del descenso) · ?surface=landed (a bordo, posada)
      const stage = q.get('surface');
      if (stage) toSurface(stage === 'descent' || stage === 'landed' ? stage : 'eva');
      // ?station=1 (con carga para vender) · ?station=bare (sin bajar a por carga): atracada y con el terminal abierto
      const station = q.get('station');
      if (station) toStation(station !== 'bare');
      // Fase 8: ?morale=30 empieza con la cordura de toda la tripulación en ese valor (para probar bandas y debuffs).
      const morale = q.get('morale');
      if (morale !== null) {
        const pct = Math.max(0, Math.min(100, Number(morale)));
        for (const m of getRun()?.state.crew ?? []) if (m.sanityPct !== undefined) m.sanityPct = pct;
      }
    };
    const seed = q.get('seed') ? Number(q.get('seed')) : undefined;
    if (q.get('play') && missionId) {
      void import('./devFixtures').then((m) => {
        useGame.getState().startRun(seed, m.referenceDesign(missionId) ?? loadDesign(missionId));
        afterStart();
      });
    } else if (q.get('play')) {
      useGame.getState().startRun(seed);
      afterStart();
    } else if (q.get('design') && missionId) {
      useGame.getState().openDesign(missionId);
    }
  }, []);

  // La escena de superficie se descarga en segundo plano en cuanto empieza la partida.
  useEffect(() => {
    if (screen === 'game') void loadSurface();
  }, [screen]);

  // Con misión, el mapa solar se prepara en segundo plano (escena y planetas horneados en workers) cuando la nave ya
  // ha arrancado: así no compite con su carga y al abrir el mapa está listo.
  const withMission = useGame((s) => !!s.hud?.missionDesign);
  useEffect(() => {
    if (screen !== 'game' || !withMission) return;
    const id = setTimeout(prefetchSolarMap, SOLAR_PREFETCH_DELAY_MS);
    return () => clearTimeout(id);
  }, [screen, withMission, runId]);

  // Al acabar el sector o la partida se suelta el ratón y se cierran los paneles.
  useEffect(() => {
    if (!ended) return;
    useUi.getState().setOverlay(null);
    if (document.pointerLockElement) document.exitPointerLock();
  }, [ended]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Suspense fallback={null}>
        {screen === 'menu' || screen === 'missions' ? (
          <MenuScene />
        ) : screen === 'design' ? (
          <HangarScene />
        ) : view !== 'ship' ? (
          <SurfaceScene key={`${runId}:${view}`} mode={view === 'eva' ? 'eva' : 'descent'} />
        ) : (
          <ShipScene key={runId} />
        )}
      </Suspense>
      {screen === 'game' && <div className={`scene-veil${sceneVeil ? ' is-on' : ''}`} aria-hidden="true" />}

      {screen === 'menu' && <MenuScreen />}
      {screen === 'missions' && <MissionsScreen />}
      {screen === 'design' && <DesignScreen />}
      {screen === 'menu' && (overlay === 'coop' || coopOpen) && <CoopScreen />}
      {screen === 'game' && <CrewBar />}
      {screen === 'game' && <Hud />}
      {screen === 'game' && ended && <EndScreen />}

      {overlay === 'map' && !ended && <StarMap />}
      {overlay === 'power' && !ended && <PowerPanel />}
      {overlay === 'terminal' && !ended && <StationTerminal />}
      {overlay === 'pause' && !ended && <PauseScreen />}
      {overlay === 'help' && <HelpOverlay />}
      {overlay === 'settings' && <SettingsPanel />}
      {overlay === 'credits' && <CreditsScreen />}
      <SoundCaptions />
    </div>
  );
}
