import { lazy, Suspense, useEffect } from 'react';
import { SoundCaptions } from '../audio/SoundCaptions';
import { useAudioDirector } from '../audio/useAudioDirector';
import { getMissions } from '@payload/shared';
import { reachStation, reachSurface } from '../game/debug';
import { loadDesign } from '../game/missionDesign';
import { getRun, useGame } from '../game/runStore';
import { sceneFor } from '../game/surfaceRules';
import { useUi } from '../state/ui';
import { Hud } from '../ui/Hud';
import { PowerPanel } from '../ui/PowerPanel';
import { DesignScreen, MissionsScreen } from '../ui/MissionScreens';
import { CreditsScreen, EndScreen, HelpOverlay, MenuScreen, PauseScreen, SettingsPanel } from '../ui/Screens';
import { StarMap } from '../ui/StarMap';
import { StationTerminal } from '../ui/StationTerminal';

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
export function App() {
  const screen = useGame((s) => s.screen);
  const runId = useGame((s) => s.runId);
  const phase = useGame((s) => s.hud?.phase);
  const overlay = useUi((s) => s.overlay);
  const crewAt = useGame((s) => s.hud?.crew[0]?.location);
  const descentView = useUi((s) => s.descentView);
  const ended = phase === 'lost' || phase === 'won';
  const scene = sceneFor(phase, crewAt, descentView);
  const surfaceMode = crewAt === 'eva' ? 'eva' : 'descent';
  useAudioDirector();

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
        ) : scene === 'surface' ? (
          <SurfaceScene key={`${runId}:${surfaceMode}`} mode={surfaceMode} />
        ) : (
          <ShipScene key={runId} />
        )}
      </Suspense>

      {screen === 'menu' && <MenuScreen />}
      {screen === 'missions' && <MissionsScreen />}
      {screen === 'design' && <DesignScreen />}
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
