import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { CuboidCollider, CylinderCollider, Physics, RigidBody } from '@react-three/rapier';
import { Vector3, type Mesh, type MeshStandardMaterial } from 'three';
import { catalog, componentsForScenario, type ComponentDef } from '@payload/shared';
import { useTranslation } from 'react-i18next';
import { lt } from '../i18n';
import { ConsoleModel, WalkerExhibit } from '../models/Models';
import { PlayerController } from '../player/PlayerController';
import { lookDir, playerState } from '../player/playerState';
import { useDesign } from '../state/design';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import {
  CONSOLE_POS, CONSOLE_REACH, PLAYER_START, ROOM, SHELVES, SHELF_Z, SHIP_POS, SHIP_REACH,
  SUBSYSTEM_COLOR, layoutBoxes, type BoxItem,
} from './hangarLayout';
import { Ship } from './Ship';
import { HangarAudio } from '../audio/HangarAudio';
import { hasRover } from '../instrument/instrumentLogic';

const H = ROOM.half;

function Room() {
  const shadows = useSettings((s) => s.shadows);
  return (
    <>
      <ambientLight intensity={0.7} />
      <hemisphereLight args={['#ffffff', '#8a97a8', 0.8]} />
      <directionalLight
        position={[6, 14, 8]}
        intensity={1.6}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-camera-far={40}
      />
      {/* Paneles de luz de techo (sala limpia) */}
      {[-8, 0, 8].flatMap((x) =>
        [-8, 0, 8].map((z) => (
          <mesh key={`${x}${z}`} position={[x, ROOM.height - 0.05, z]} rotation={[Math.PI / 2, 0, 0]}>
            <planeGeometry args={[4, 1.2]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        )),
      )}

      {/* Suelo */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[H, 0.5, H]} position={[0, -0.5, 0]} />
      </RigidBody>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[H * 2, H * 2]} />
        <meshStandardMaterial color="#dfe4ea" roughness={0.35} />
      </mesh>
      {/* Zona de integración marcada en el suelo */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <ringGeometry args={[3.6, 3.8, 64]} />
        <meshBasicMaterial color="#e0b020" />
      </mesh>

      {/* Paredes y techo */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[H, ROOM.height / 2, 0.5]} position={[0, ROOM.height / 2, -H - 0.5]} />
        <CuboidCollider args={[H, ROOM.height / 2, 0.5]} position={[0, ROOM.height / 2, H + 0.5]} />
        <CuboidCollider args={[0.5, ROOM.height / 2, H]} position={[-H - 0.5, ROOM.height / 2, 0]} />
        <CuboidCollider args={[0.5, ROOM.height / 2, H]} position={[H + 0.5, ROOM.height / 2, 0]} />
      </RigidBody>
      {[
        { p: [0, ROOM.height / 2, -H], r: [0, 0, 0] },
        { p: [0, ROOM.height / 2, H], r: [0, Math.PI, 0] },
        { p: [-H, ROOM.height / 2, 0], r: [0, Math.PI / 2, 0] },
        { p: [H, ROOM.height / 2, 0], r: [0, -Math.PI / 2, 0] },
      ].map((w, i) => (
        <mesh key={i} position={w.p as [number, number, number]} rotation={w.r as [number, number, number]} receiveShadow>
          <planeGeometry args={[H * 2, ROOM.height]} />
          <meshStandardMaterial color="#c9d3de" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, ROOM.height, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[H * 2, H * 2]} />
        <meshStandardMaterial color="#e9edf2" />
      </mesh>
      {/* Franja de color en la pared norte */}
      <mesh position={[0, 3.6, -H + 0.02]}>
        <planeGeometry args={[H * 2, 0.15]} />
        <meshBasicMaterial color="#38e1c0" />
      </mesh>
    </>
  );
}

function Shelves({ boxes }: { boxes: BoxItem[] }) {
  const { t } = useTranslation();
  return (
    <>
      {SHELVES.map((s) => (
        <group key={s.subsystem} position={[s.x, 0, SHELF_Z]}>
          <RigidBody type="fixed" colliders={false}>
            <CuboidCollider args={[1.35, 1.2, 0.4]} position={[0, 1.2, 0]} />
          </RigidBody>
          {/* Montantes y baldas */}
          {[-1.3, 1.3].map((x) => (
            <mesh key={x} position={[x, 1.2, 0]} castShadow>
              <boxGeometry args={[0.06, 2.4, 0.8]} />
              <meshStandardMaterial color="#51606f" metalness={0.6} roughness={0.5} />
            </mesh>
          ))}
          {[0.25, 0.95, 1.65, 2.35].map((y) => (
            <mesh key={y} position={[0, y, 0]} castShadow receiveShadow>
              <boxGeometry args={[2.66, 0.05, 0.8]} />
              <meshStandardMaterial color="#6d7c8c" metalness={0.5} roughness={0.5} />
            </mesh>
          ))}
          <Html position={[0, 2.85, 0.4]} center distanceFactor={9} style={{ pointerEvents: 'none' }}>
            <div className="num whitespace-nowrap rounded border border-[#1f3a5f] bg-[#0b1220]/85 px-2 py-0.5 text-xs text-[#38e1c0]">
              {t(`subsystem.${s.subsystem}`)}
            </div>
          </Html>
        </group>
      ))}
      {boxes.map((b) => (
        <mesh key={b.id} position={b.pos} castShadow>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshStandardMaterial color={SUBSYSTEM_COLOR[b.subsystem]} roughness={0.5} metalness={0.2} />
        </mesh>
      ))}
    </>
  );
}

function MissionConsole() {
  const { t } = useTranslation();
  return (
    <group position={CONSOLE_POS} rotation={[0, -Math.PI / 2, 0]}>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[1.1, 0.55, 0.45]} position={[0, 0.55, 0]} />
      </RigidBody>
      <ConsoleModel
        fallback={
          <>
            <mesh position={[0, 0.5, 0]} castShadow>
              <boxGeometry args={[2.2, 1, 0.9]} />
              <meshStandardMaterial color="#2a3442" metalness={0.4} roughness={0.5} />
            </mesh>
            <mesh position={[0, 1.2, -0.15]} rotation={[-0.25, 0, 0]}>
              <boxGeometry args={[2, 0.9, 0.06]} />
              <meshStandardMaterial color="#04101c" emissive="#0a4a46" emissiveIntensity={1.2} />
            </mesh>
          </>
        }
      />
      <Html position={[0, 1.95, 0]} center distanceFactor={9} style={{ pointerEvents: 'none' }}>
        <div className="num whitespace-nowrap rounded border border-[#1f3a5f] bg-[#0b1220]/85 px-2 py-0.5 text-xs text-[#38e1c0]">
          {t('hangar.console')}
        </div>
      </Html>
    </group>
  );
}

function Pedestal() {
  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[0.45, 1.5]} position={[SHIP_POS[0], 0.45, SHIP_POS[2]]} />
      </RigidBody>
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.5, 1.7, 0.9, 32]} />
        <meshStandardMaterial color="#4a5663" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.91, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.2, 1.35, 48]} />
        <meshBasicMaterial color="#38e1c0" />
      </mesh>
    </>
  );
}

/** Caja que el jugador lleva en las manos (delante del cuerpo). */
function HeldBox() {
  const ref = useRef<Mesh>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const held = useDesign.getState().heldId;
    const def = held ? catalog.components.find((c) => c.id === held) : undefined;
    m.visible = !!def;
    if (!def) return;
    const { pos, yaw } = playerState;
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    m.position.set(pos.x - sy * 0.65 + cy * 0.25, pos.y + 1.2, pos.z - cy * 0.65 - sy * 0.25);
    m.rotation.y = yaw;
    (m.material as MeshStandardMaterial).color.set(SUBSYSTEM_COLOR[def.subsystem]);
  });
  return (
    <mesh ref={ref} visible={false}>
      <boxGeometry args={[0.3, 0.3, 0.3]} />
      <meshStandardMaterial />
    </mesh>
  );
}

/** Apuntado, aviso contextual y acciones de E / Q. */
function Interaction({ boxes }: { boxes: BoxItem[] }) {
  const highlight = useRef<Mesh>(null);
  const aimed = useRef<BoxItem | null>(null);
  const near = useRef<'ship' | 'console' | null>(null);
  const tmp = useMemo(() => ({ head: new Vector3(), v: new Vector3(), dir: new Vector3(), }), []);

  useFrame(() => {
    const { head, v, dir } = tmp;
    const { pos } = playerState;
    head.set(pos.x, pos.y + 1.6, pos.z);
    lookDir(dir);
    let best: BoxItem | null = null;
    let bestCos = 0.965;
    for (const box of boxes) {
      v.set(box.pos[0], box.pos[1], box.pos[2]).sub(head);
      const d = v.length();
      if (d > 3.4 || d < 0.01) continue;
      const cos = v.divideScalar(d).dot(dir);
      if (cos > bestCos) {
        bestCos = cos;
        best = box;
      }
    }
    aimed.current = best;
    const dShip = Math.hypot(pos.x - SHIP_POS[0], pos.z - SHIP_POS[2]);
    const dCon = Math.hypot(pos.x - CONSOLE_POS[0], pos.z - CONSOLE_POS[2]);
    near.current = best ? null : dCon < CONSOLE_REACH ? 'console' : dShip < SHIP_REACH ? 'ship' : null;

    const hl = highlight.current;
    if (hl) {
      hl.visible = !!best;
      if (best) hl.position.set(...best.pos);
    }
    const design = useDesign.getState();
    const held = design.heldId;
    const ui = useUi.getState();
    if (best) {
      const def = catalog.components.find((c) => c.id === best.id);
      ui.setPrompt({ key: held ? 'prompt.swap' : 'prompt.pick', name: def ? lt(def.name) : best.id });
    } else if (near.current === 'console') ui.setPrompt({ key: 'prompt.console' });
    else if (near.current === 'ship') ui.setPrompt({ key: held ? 'prompt.mount' : design.componentIds.length ? 'prompt.unmount' : 'prompt.shipEmpty' });
    else ui.setPrompt(held ? { key: 'prompt.returnItem' } : null);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || useUi.getState().overlay !== null || useUi.getState().inputBlocked) return;
      const d = useDesign.getState();
      if (e.code === 'KeyQ') {
        d.hold(null);
      } else if (e.code === 'KeyE') {
        if (aimed.current) d.hold(aimed.current.id);
        else if (near.current === 'console') useUi.getState().setOverlay('console');
        else if (near.current === 'ship') {
          if (d.heldId) {
            d.add(d.heldId);
            d.hold(null);
          } else d.popLast();
        } else if (d.heldId) d.hold(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      useUi.getState().setPrompt(null);
    };
  }, []);

  return (
    <mesh ref={highlight} visible={false}>
      <boxGeometry args={[0.58, 0.58, 0.58]} />
      <meshBasicMaterial color="#ffffff" wireframe />
    </mesh>
  );
}

function ShipView() {
  const ids = useDesign((s) => s.componentIds);
  return <Ship componentIds={ids} />;
}

/** El rover Aurora G9 (componente con `model` del mecha) aparece junto a la nave cuando está en el diseño. */
function MountedRover() {
  const ids = useDesign((s) => s.componentIds);
  if (!hasRover(ids)) return null;
  return <WalkerExhibit position={[SHIP_POS[0] + 2.6, 0, SHIP_POS[2] + 1.9]} rotation={[0, -0.7, 0]} size={1.9} delayMs={300} />;
}

export function HangarScene() {
  const shadows = useSettings((s) => s.shadows);
  const scenarioId = useDesign((s) => s.scenarioId);
  const comps: ComponentDef[] = useMemo(() => {
    try {
      return componentsForScenario(scenarioId, catalog);
    } catch {
      return [];
    }
  }, [scenarioId]);
  const boxes = useMemo(() => layoutBoxes(comps), [comps]);

  return (
    <Canvas shadows={shadows} dpr={[1, 1.75]} camera={{ fov: 75, near: 0.05, far: 80, position: [0, 1.6, 9] }}>
      <color attach="background" args={['#aab4c0']} />
      <Physics gravity={[0, 0, 0]}>
        <Room />
        <Pedestal />
        <Shelves boxes={boxes} />
        <MissionConsole />
        <ShipView />
        <WalkerExhibit position={[-9.5, 0, 9]} rotation={[0, 0.8, 0]} size={4.5} />
        <MountedRover />
        <HangarAudio />
        <HeldBox />
        <Interaction boxes={boxes} />
        <PlayerController start={PLAYER_START} />
      </Physics>
    </Canvas>
  );
}
