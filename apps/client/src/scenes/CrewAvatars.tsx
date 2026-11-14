/**
 * Cooperativo (fase 6): los compañeros y sus pings en la escena. Las poses llegan del servidor a 10 Hz
 * (`coopLive.poses`) y aquí se interpolan; no hay física ni colisión entre jugadores.
 */
import { createRef, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group, Sprite } from 'three';
import { COOP_LIMITS, type PoseArea, type RoleId } from '@payload/shared';
import { Glow } from '../gfx/Glow';
import { advanceGait, astronautPose } from '../game/astronautPose';
import { applyAstronautPose, ArticulatedAstronaut, newAstronautRig, type AstronautRig } from '../models/ArticulatedAstronaut';
import { getLocalCrewId } from '../game/me';
import { getRun } from '../game/runStore';
import { coopLive } from '../net/coopStore';
import { NO_ROLE_COLOR, ROLE_COLORS } from '../ui/CoopScreen';

const SLOTS = COOP_LIMITS.maxPlayers;
const PING_SLOTS = 6;
const PING_COLORS = { look: '#38e1c0', danger: '#ff4d5e', help: '#ffb347' } as const;
/** Fracción del camino hacia la pose recibida que se recorre por segundo (suaviza los 10 Hz). */
const FOLLOW_PER_S = 12;

/** Fase 5: el astronauta articulado en detalle bajo; mira a +Z, así que se gira para que su frente sea −Z (yaw 0). */
function Astronaut({ color, rig }: { color: string; rig: MutableRefObject<AstronautRig> }) {
  return (
    <group rotation={[0, Math.PI, 0]}>
      <ArticulatedAstronaut lod="low" accent={color} rig={rig} />
    </group>
  );
}

/** Avatares de los demás tripulantes que están en esta zona (`ship` o `surface`) y sus pings. */
export function CrewAvatars({ area }: { area: PoseArea }) {
  const groups = useRef<(Group | null)[]>([]);
  const pings = useRef<(Sprite | null)[]>([]);
  const seen = useRef<boolean[]>([]);
  // Fase 5: una articulación y una zancada por hueco (la pose sale de cuánto se mueve el avatar interpolado).
  const rigs = useMemo(() => Array.from({ length: SLOTS }, () => {
    const r = createRef<AstronautRig>() as MutableRefObject<AstronautRig>;
    r.current = newAstronautRig();
    return r;
  }), []);
  const gaits = useRef<number[]>(Array.from({ length: SLOTS }, () => 0));
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
      const ox = g.position.x;
      const oy = g.position.y;
      const oz = g.position.z;
      g.position.x += (pose.x - g.position.x) * k;
      g.position.y += (pose.y - g.position.y) * k;
      g.position.z += (pose.z - g.position.z) * k;
      if (delta > 0) {
        const speed = Math.min(12, Math.hypot(g.position.x - ox, g.position.z - oz) / delta);
        const vy = (g.position.y - oy) / delta;
        // Sin saber si pisa suelo: en la nave siempre; fuera, si apenas sube o baja.
        const grounded = area === 'ship' || Math.abs(vy) < 0.6;
        gaits.current[i] = advanceGait(gaits.current[i] ?? 0, grounded ? speed : 0, delta);
        applyAstronautPose(rigs[i]!.current, astronautPose({ gait: gaits.current[i]!, speedMps: grounded ? speed : 0, grounded, thrusting: !grounded && vy > 0, verticalMps: vy, timeS: performance.now() / 1000 }));
      }
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
          <Astronaut color={color} rig={rigs[i]!} />
        </group>
      ))}
      {Array.from({ length: PING_SLOTS }, (_, i) => (
        <Glow key={i} ref={(s) => void (pings.current[i] = s)} size={0.9} opacity={0} />
      ))}
    </>
  );
}
