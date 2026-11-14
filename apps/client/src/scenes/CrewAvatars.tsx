/**
 * Cooperativo (fase 6): los compañeros y sus pings en la escena. Las poses llegan del servidor a 10 Hz
 * (`coopLive.poses`) y aquí se interpolan; no hay física ni colisión entre jugadores.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group, Sprite } from 'three';
import { COOP_LIMITS, type PoseArea, type RoleId } from '@payload/shared';
import { Glow } from '../gfx/Glow';
import { getLocalCrewId } from '../game/me';
import { getRun } from '../game/runStore';
import { coopLive } from '../net/coopStore';
import { NO_ROLE_COLOR, ROLE_COLORS } from '../ui/CoopScreen';

const SLOTS = COOP_LIMITS.maxPlayers;
const PING_SLOTS = 6;
const PING_COLORS = { look: '#38e1c0', danger: '#ff4d5e', help: '#ffb347' } as const;
/** Fracción del camino hacia la pose recibida que se recorre por segundo (suaviza los 10 Hz). */
const FOLLOW_PER_S = 12;

function Astronaut({ color }: { color: string }) {
  return (
    <>
      <mesh position={[0, 0.75, 0]}>
        <capsuleGeometry args={[0.26, 0.75, 4, 10]} />
        <meshStandardMaterial color="#cfd6e0" roughness={0.7} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1.55, 0]}>
        <sphereGeometry args={[0.24, 14, 10]} />
        <meshStandardMaterial color="#e8edf3" roughness={0.4} metalness={0.2} />
      </mesh>
      {/* Visera: mira hacia −Z local (el frente del jugador con yaw 0). */}
      <mesh position={[0, 1.57, -0.15]}>
        <sphereGeometry args={[0.17, 12, 8]} />
        <meshStandardMaterial color="#10161f" roughness={0.15} metalness={0.8} />
      </mesh>
      {/* Mochila y banda con el color del rol. */}
      <mesh position={[0, 0.95, 0.27]}>
        <boxGeometry args={[0.36, 0.5, 0.2]} />
        <meshStandardMaterial color={color} roughness={0.6} emissive={color} emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, 1.28, 0]}>
        <torusGeometry args={[0.25, 0.035, 6, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} toneMapped={false} />
      </mesh>
    </>
  );
}

/** Avatares de los demás tripulantes que están en esta zona (`ship` o `surface`) y sus pings. */
export function CrewAvatars({ area }: { area: PoseArea }) {
  const groups = useRef<(Group | null)[]>([]);
  const pings = useRef<(Sprite | null)[]>([]);
  const seen = useRef<boolean[]>([]);
  // El rol no cambia durante la partida: se lee una vez al montar la escena.
  const colors = useMemo(() => {
    const crew = getRun()?.state.crew ?? [];
    return Array.from({ length: SLOTS }, (_, i) => {
      const role: RoleId | undefined = crew[i]?.role;
      return role ? ROLE_COLORS[role] : NO_ROLE_COLOR;
    });
  }, []);

  useFrame((_, delta) => {
    const crew = getRun()?.state.crew;
    const mine = getLocalCrewId();
    const k = Math.min(1, delta * FOLLOW_PER_S);
    for (let i = 0; i < SLOTS; i++) {
      const g = groups.current[i];
      if (!g) continue;
      const crewId = i + 1;
      const pose = coopLive.poses[crewId];
      const member = crew?.[i];
      const show = !!pose && pose.area === area && crewId !== mine && !!member?.alive;
      g.visible = show;
      if (!show || !pose) {
        seen.current[i] = false;
        continue;
      }
      if (!seen.current[i]) {
        // Recién aparecido: sin deslizarse desde el origen.
        g.position.set(pose.x, pose.y, pose.z);
        g.rotation.y = pose.yaw;
        seen.current[i] = true;
        continue;
      }
      g.position.x += (pose.x - g.position.x) * k;
      g.position.y += (pose.y - g.position.y) * k;
      g.position.z += (pose.z - g.position.z) * k;
      // Giro por el camino corto.
      const d = Math.atan2(Math.sin(pose.yaw - g.rotation.y), Math.cos(pose.yaw - g.rotation.y));
      g.rotation.y += d * k;
    }

    const now = performance.now();
    const ttlMs = COOP_LIMITS.pingTtlS * 1000;
    const live = coopLive.pings;
    for (let i = 0; i < PING_SLOTS; i++) {
      const sprite = pings.current[i];
      if (!sprite) continue;
      const ping = live[live.length - 1 - i];
      const age = ping ? now - ping.atMs : ttlMs;
      const show = !!ping && ping.area === area && age < ttlMs;
      sprite.visible = show;
      if (!show || !ping) continue;
      const pulse = 1 + 0.35 * Math.sin(now / 140);
      sprite.position.set(ping.x, ping.y + 1.9, ping.z);
      sprite.scale.setScalar(0.9 * pulse);
      sprite.material.color.set(PING_COLORS[ping.kind]);
      sprite.material.opacity = 0.9 * (1 - age / ttlMs);
    }
  });

  return (
    <>
      {colors.map((color, i) => (
        <group key={i} ref={(g) => void (groups.current[i] = g)} visible={false}>
          <Astronaut color={color} />
        </group>
      ))}
      {Array.from({ length: PING_SLOTS }, (_, i) => (
        <Glow key={i} ref={(s) => void (pings.current[i] = s)} size={0.9} opacity={0} />
      ))}
    </>
  );
}
