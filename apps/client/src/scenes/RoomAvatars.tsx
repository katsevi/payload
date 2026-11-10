import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useTranslation } from 'react-i18next';
import type { AvatarPose } from '@payload/shared';
import { AstronautModel } from '../models/Models';
import { useRoom } from '../net/roomStore';
import { lerpPose, pingFade, pingWorldPosition, playerLabel, poseSmoothing, primaryRole, roleColor } from '../room/roomUiLogic';
import { CONSOLE_POS, SHELF_Z, SHELVES, SHIP_POS, type BoxItem } from './hangarLayout';
import type { Group, Mesh, MeshBasicMaterial } from 'three';

/** Etiqueta con nombre y color del rol (DOM: pocas, no por frame). */
export function AvatarLabel({ name, role, y = 2.2 }: { name: string; role: Parameters<typeof roleColor>[0]; y?: number }) {
  const { t } = useTranslation();
  const c = roleColor(role);
  return (
    <Html zIndexRange={[9, 0]} position={[0, y, 0]} center distanceFactor={9} style={{ pointerEvents: 'none' }}>
      <div className="num whitespace-nowrap rounded border bg-[#0b1220]/85 px-2 py-0.5 text-xs" style={{ borderColor: c, color: c }}>
        {name}
        {role && <span className="ml-1 text-[10px] uppercase opacity-80">{t(`room.role.${role}`)}</span>}
      </div>
    </Html>
  );
}

function RemoteAvatar({ id, name, role }: { id: string; name: string; role: ReturnType<typeof primaryRole> }) {
  const group = useRef<Group>(null);
  const cur = useRef<AvatarPose | null>(null);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const p = useRoom.getState().view?.players.find((x) => x.id === id);
    const target = p?.connected ? p.pose : null;
    if (!target) {
      g.visible = false;
      cur.current = null;
      return;
    }
    if (!cur.current) cur.current = { ...target };
    else lerpPose(cur.current, target, poseSmoothing(dt));
    g.visible = true;
    g.position.set(cur.current.x, cur.current.y, cur.current.z);
    g.rotation.y = cur.current.yaw;
  });
  return (
    <group ref={group} visible={false}>
      <AstronautModel height={1.8} />
      {/* La etiqueta no debe girar con el avatar: se contra-rota no hace falta, `Html` mira a la cámara. */}
      <AvatarLabel name={name} role={role} />
    </group>
  );
}

/** Los OTROS jugadores de la sala en el hangar, en su pose (interpolada en `useFrame`, sin re-render). */
export function RemoteAvatars() {
  const { t } = useTranslation();
  const myId = useRoom((s) => s.myId);
  const key = useRoom((s) => (s.view ? s.view.players.map((p) => `${p.id}|${p.name}|${p.roles.join('+')}`).join(';') : ''));
  const list = useMemo(() => {
    const players = useRoom.getState().view?.players ?? [];
    return players
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.id !== myId)
      .map(({ p, i }) => ({ id: p.id, name: playerLabel(p, i, (n) => t('room.playerN', { n })), role: primaryRole(p.roles) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, myId, t]);
  return (
    <>
      {list.map((a) => (
        <RemoteAvatar key={a.id} id={a.id} name={a.name} role={a.role} />
      ))}
    </>
  );
}

const POOL = 6;
/** Marcadores de ping activos (pool fijo; posición y color se actualizan en `useFrame`). */
export function PingMarkers({ boxes }: { boxes: BoxItem[] }) {
  const slots = useRef<(Group | null)[]>([]);
  const mats = useRef<(MeshBasicMaterial | null)[]>([]);
  const ids = useRef<number[]>(Array(POOL).fill(-1));
  const base = useRef<[number, number, number][]>(Array.from({ length: POOL }, () => [0, 0, 0] as [number, number, number]));
  const layout = useMemo(() => ({ boxes, shelves: SHELVES, shelfZ: SHELF_Z, ship: SHIP_POS, console: CONSOLE_POS }), [boxes]);
  useFrame(({ clock }) => {
    const now = performance.now();
    const pings = useRoom.getState().pings;
    let n = 0;
    for (let i = pings.length - 1; i >= 0 && n < POOL; i--) {
      const p = pings[i]!;
      if (p.expiresAtMs <= now) continue;
      const g = slots.current[n];
      const m = mats.current[n];
      if (g && m) {
        if (ids.current[n] !== p.id) {
          ids.current[n] = p.id;
          base.current[n] = pingWorldPosition(p.target, layout);
          m.color.set(roleColor(p.role));
        }
        const b = base.current[n]!;
        g.visible = true;
        g.position.set(b[0], b[1] + Math.sin(clock.elapsedTime * 4) * 0.08, b[2]);
        m.opacity = pingFade(p, now);
      }
      n++;
    }
    for (; n < POOL; n++) {
      const g = slots.current[n];
      if (g) g.visible = false;
      ids.current[n] = -1;
    }
  });
  return (
    <>
      {Array.from({ length: POOL }, (_, i) => (
        <group key={i} ref={(g) => { slots.current[i] = g; }} visible={false}>
          <mesh rotation={[Math.PI, 0, 0]} position={[0, 0.3, 0]}>
            <coneGeometry args={[0.18, 0.5, 12]} />
            <meshBasicMaterial ref={(m) => { mats.current[i] = m; }} transparent depthTest={false} />
          </mesh>
          <PingRing />
        </group>
      ))}
    </>
  );
}

function PingRing() {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (m) m.scale.setScalar(1 + ((clock.elapsedTime * 1.5) % 1) * 1.2);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
      <ringGeometry args={[0.28, 0.34, 24]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.5} depthTest={false} />
    </mesh>
  );
}
