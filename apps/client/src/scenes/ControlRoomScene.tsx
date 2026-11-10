import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Html, Stars } from '@react-three/drei';
import { useTranslation } from 'react-i18next';
import { lt } from '../i18n';
import { MascotAvatar } from '../mascot/MascotAvatar';
import { mascotDef } from '../mascot/mascotLogic';
import { AstronautModel, ConsoleModel } from '../models/Models';
import { useRoom } from '../net/roomStore';
import { useSettings } from '../state/settings';
import { CONSOLE_SLOTS, placeAvatars, playerLabel, primaryRole, roleColor } from '../room/roomUiLogic';
import { AvatarLabel } from './RoomAvatars';

function Consoles() {
  const { t } = useTranslation();
  return (
    <>
      {CONSOLE_SLOTS.map((s) => (
        <group key={s.role} position={s.position} rotation={[0, s.yaw, 0]}>
          <ConsoleModel
            fallback={
              <mesh position={[0, 0.5, 0]}>
                <boxGeometry args={[2, 1, 0.9]} />
                <meshStandardMaterial color="#2a3442" metalness={0.4} roughness={0.5} />
              </mesh>
            }
          />
          <mesh position={[0, 0.02, 0.55]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.55, 0.7, 24]} />
            <meshBasicMaterial color={roleColor(s.role)} />
          </mesh>
          <Html zIndexRange={[9, 0]} position={[0, 2, 0]} center distanceFactor={11} style={{ pointerEvents: 'none' }}>
            <div className="num whitespace-nowrap rounded border bg-[#0b1220]/85 px-2 py-0.5 text-xs uppercase" style={{ borderColor: roleColor(s.role), color: roleColor(s.role) }}>
              {t(`room.role.${s.role}`)}
            </div>
          </Html>
        </group>
      ))}
    </>
  );
}

function Crew() {
  const { t } = useTranslation();
  const myId = useRoom((s) => s.myId);
  const key = useRoom((s) => (s.view ? s.view.players.map((p) => `${p.id}|${p.name}|${p.roles.join('+')}|${p.connected ? 1 : 0}`).join(';') : ''));
  const crew = useMemo(() => {
    const players = (useRoom.getState().view?.players ?? []).filter((p) => p.connected);
    const spots = placeAvatars(players);
    return spots.map((sp) => {
      const i = players.findIndex((p) => p.id === sp.playerId);
      const p = players[i]!;
      const label = playerLabel(p, i, (n) => t('room.playerN', { n })) + (p.id === myId ? ` (${t('room.you')})` : '');
      return { ...sp, label, role: primaryRole(p.roles) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, myId, t]);
  return (
    <>
      {crew.map((c) => (
        <group key={c.playerId} position={c.position} rotation={[0, c.yaw, 0]}>
          <AstronautModel height={1.8} />
          <group rotation={[0, -c.yaw, 0]}>
            <AvatarLabel name={c.label} role={c.role} />
          </group>
        </group>
      ))}
    </>
  );
}

/** La mascota única de la sala, flotando entre las consolas (avatar 2D de la mascota por datos). */
function RoomMascot() {
  const enabled = useSettings((s) => s.mascot);
  const mascot = mascotDef();
  if (!enabled || !mascot) return null;
  return (
    <Html zIndexRange={[9, 0]} position={[0, 2.6, -1.5]} center distanceFactor={9} style={{ pointerEvents: 'none' }}>
      <MascotAvatar mascot={mascot} expression="happy" size={72} label={lt(mascot.name)} />
    </Html>
  );
}

/**
 * Sala de control compartida (lobby, briefing y pre-lanzamiento en sala): cuatro consolas, una por rol,
 * y el avatar de cada jugador junto a la de su rol. Low-poly, sin sombras; no se monta en modo accesible 2D.
 */
export function ControlRoomScene() {
  return (
    <Canvas style={{ isolation: 'isolate' }} dpr={[1, 1.5]} camera={{ fov: 50, near: 0.1, far: 400, position: [0, 3.6, 10.5] }} onCreated={({ camera }) => camera.lookAt(0, 1.1, -1)}>
      <color attach="background" args={['#050914']} />
      <ambientLight intensity={0.9} />
      <hemisphereLight args={['#bcd2ff', '#1b2433', 0.7]} />
      <directionalLight position={[4, 8, 6]} intensity={1.4} />
      <Stars radius={120} depth={40} count={1500} factor={3} fade />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[9, 48]} />
        <meshStandardMaterial color="#1a2433" roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[8.6, 9, 64]} />
        <meshBasicMaterial color="#38e1c0" />
      </mesh>
      <Consoles />
      <Crew />
      <RoomMascot />
    </Canvas>
  );
}
