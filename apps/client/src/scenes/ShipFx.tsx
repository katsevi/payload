import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Flame, Navigation, Wind, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Color, Vector3, type Group, type MeshBasicMaterial, type PointLight, type Sprite } from 'three';
import type { IncidentKind, SystemId } from '@payload/shared';
import { HULL, STATIONS, STATION_IDS, zoneAt, type StationId, type Zone } from '../game/layout';
import { getRun } from '../game/runStore';
import { Builder, Parts, once } from '../gfx/build';
import { arcMaterial, billboardGeometry, emberMaterial, flameMaterial, jetMaterial, seedGeometry, smokeMaterial, sparkMaterial } from '../gfx/fxShaders';
import { Glow } from '../gfx/Glow';
import { mats } from '../gfx/materials';
import { playerState } from '../player/playerState';

const ZONES: { id: Zone; z: number }[] = [
  { id: 'bridge', z: -9 },
  { id: 'mid', z: -0.5 },
  { id: 'engine', z: 8.5 },
];
const CALM = new Color('#d4e6ff');
const ALARM = new Color('#ff3b46');
const GUIDE = new Color('#38e1c0');
const ZONE_LIGHT = 42;
const ENV_INTENSITY = 0.55;
/** Dos luminarias por zona, a lo largo del pasillo. */
const FIXTURE_X = [-1.15, 1.15] as const;
const FIXTURE_LEN = 5.2;

const buildFixtures = once(() => {
  const m = mats();
  const b = new Builder();
  for (const zone of ZONES) {
    for (const x of FIXTURE_X) {
      b.box(m.dark, [x, HULL.height - 0.035, zone.z], [0.34, 0.07, FIXTURE_LEN + 0.16]);
      for (const end of [-1, 1]) b.box(m.steel, [x, HULL.height - 0.075, zone.z + end * (FIXTURE_LEN / 2 + 0.05)], [0.34, 0.03, 0.06]);
    }
  }
  return b.build();
});

/**
 * Luz de techo por zona: blanca en calma, roja y pulsante si hay una avería en la zona; tenue en un
 * apagón (que además apaga los reflejos del entorno y deja las guías en mínimos).
 */
export function ZoneLights() {
  const lights = useRef<(PointLight | null)[]>([]);
  const lamps = useRef<(MeshBasicMaterial | null)[]>([]);
  const halos = useRef<(Sprite | null)[]>([]);
  const dim = useRef(1);
  useFrame((state, dt) => {
    const run = getRun();
    if (!run) return;
    const s = run.state;
    const blackout = s.ship.powerSupplyKw <= 0;
    const warning = s.warnings.some((w) => !w.evaded);
    dim.current += ((blackout ? 0.22 : 1) - dim.current) * Math.min(1, dt * 4);
    state.scene.environmentIntensity = ENV_INTENSITY * dim.current;
    mats().guide.color.copy(GUIDE).multiplyScalar(dim.current);
    for (let i = 0; i < ZONES.length; i++) {
      const light = lights.current[i];
      const zone = ZONES[i]!;
      if (!light) continue;
      const alarm = s.incidents.some((inc) => zoneAt(STATIONS[inc.systemId].z) === zone.id) || (warning && zone.id === 'bridge');
      light.color.lerp(alarm || blackout ? ALARM : CALM, Math.min(1, dt * 5));
      const pulse = alarm ? 0.65 + Math.sin(state.clock.elapsedTime * 7) * 0.35 : 1;
      const target = (blackout ? 7 : ZONE_LIGHT) * pulse;
      light.intensity += (target - light.intensity) * Math.min(1, dt * 8);
      const level = Math.min(1, light.intensity / ZONE_LIGHT);
      for (let k = 0; k < FIXTURE_X.length; k++) {
        const n = i * FIXTURE_X.length + k;
        lamps.current[n]?.color.copy(light.color).multiplyScalar(0.25 + 0.75 * level);
        const halo = halos.current[n];
        if (!halo) continue;
        halo.material.color.copy(light.color);
        halo.material.opacity = 0.16 * level;
      }
    }
  });
  return (
    <>
      <ambientLight intensity={0.22} />
      <hemisphereLight args={['#b9cdf0', '#1c2638', 0.45]} />
      <Parts parts={buildFixtures()} />
      {ZONES.map((zone, i) => (
        <group key={zone.id} position={[0, HULL.height, zone.z]}>
          <pointLight ref={(l) => void (lights.current[i] = l)} position={[0, -0.75, 0]} distance={21} decay={1.25} intensity={ZONE_LIGHT} />
          {FIXTURE_X.map((x, k) => (
            <group key={x} position={[x, -0.075, 0]}>
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <planeGeometry args={[0.24, FIXTURE_LEN]} />
                <meshBasicMaterial ref={(m) => void (lamps.current[i * FIXTURE_X.length + k] = m)} color="#d4e6ff" toneMapped={false} />
              </mesh>
              <Glow ref={(sp) => void (halos.current[i * FIXTURE_X.length + k] = sp)} size={3.2} opacity={0.16} position={[0, -0.1, 0]} />
            </group>
          ))}
        </group>
      ))}
    </>
  );
}

const FX_SLOTS = 6;
/** Distancia (m) desde el centro del puesto hacia su punto de uso a la que aparece la avería. */
const FX_FORWARD: Record<SystemId, number> = { reactor: 1.15, engines: 0.75, lifeSupport: 0.5, shields: 0.72, nav: 0.3 };
/** Cada tipo de avería tiene su sitio a lo ancho del sistema para que no se tapen. */
const FX_SIDE: Record<IncidentKind, number> = { fire: 0, short: 0.7, leak: -0.7 };
const FLAMES: { x: number; z: number; w: number; h: number }[] = [
  { x: 0, z: 0, w: 1.0, h: 1.9 },
  { x: -0.34, z: 0.1, w: 0.7, h: 1.25 },
  { x: 0.33, z: -0.08, w: 0.75, h: 1.4 },
  { x: 0.05, z: 0.2, w: 0.55, h: 0.9 },
];
const ARCS: { x: number; y: number; z: number; w: number; h: number }[] = [
  { x: 0, y: 0.75, z: 0, w: 0.9, h: 1.0 },
  { x: 0.18, y: 1.1, z: 0.12, w: 0.6, h: 0.75 },
];

/** Fuego, chispas y escapes de gas sobre el sistema afectado (un grupo reutilizable por avería). */
export function IncidentFx() {
  const slots = useRef<(Group | null)[]>([]);
  const lights = useRef<(PointLight | null)[]>([]);
  const halos = useRef<(Sprite | null)[]>([]);
  const indices = useMemo(() => Array.from({ length: FX_SLOTS }, (_, i) => i), []);
  const seeds = useMemo(() => ({ embers: seedGeometry(26, 5), smoke: seedGeometry(9, 11), sparks: seedGeometry(34, 23), jet: seedGeometry(30, 37) }), []);
  useFrame((state) => {
    const incidents = getRun()?.state.incidents ?? [];
    const t = state.clock.elapsedTime;
    for (let i = 0; i < FX_SLOTS; i++) {
      const group = slots.current[i];
      const light = lights.current[i];
      const halo = halos.current[i];
      if (!group || !light || !halo) continue;
      const inc = incidents[i];
      if (!inc) {
        group.visible = false;
        light.intensity = 0;
        continue;
      }
      const st = STATIONS[inc.systemId];
      const forward = FX_FORWARD[inc.systemId];
      const side = FX_SIDE[inc.kind];
      const sin = Math.sin(st.yaw);
      const cos = Math.cos(st.yaw);
      group.visible = true;
      group.position.set(st.x + sin * forward + cos * side, 0, st.z + cos * forward - sin * side);
      group.rotation.y = st.yaw;
      const [fire, sparks, leak] = group.children as [Group, Group, Group];
      fire.visible = inc.kind === 'fire';
      sparks.visible = inc.kind === 'short';
      leak.visible = inc.kind === 'leak';
      const flicker = 0.7 + Math.sin(t * 23 + i * 5) * 0.2 + Math.sin(t * 41 + i) * 0.1;
      if (inc.kind === 'fire') {
        light.color.set('#ff7a1f');
        light.intensity = 34 * flicker;
        halo.material.color.set('#ff6a1a');
        halo.material.opacity = 0.42 * flicker;
        halo.scale.setScalar(3.4);
      } else if (inc.kind === 'short') {
        const on = Math.sin(t * 37 + i * 3) > 0.25;
        light.color.set('#7fc4ff');
        light.intensity = on ? 24 : 0;
        halo.material.color.set('#7fc4ff');
        halo.material.opacity = on ? 0.5 : 0.05;
        halo.scale.setScalar(1.8);
      } else {
        light.color.set('#dff3ff');
        light.intensity = 6;
        halo.material.color.set('#dff3ff');
        halo.material.opacity = 0.12;
        halo.scale.setScalar(1.6);
      }
    }
  });
  return (
    <>
      {indices.map((i) => (
        <group key={i} ref={(g) => void (slots.current[i] = g)} visible={false}>
          <group>
            {FLAMES.map((f, k) => (
              <mesh key={k} position={[f.x, 0.25, f.z + i * 0.013]} scale={[f.w, f.h, 1]} geometry={billboardGeometry()} material={flameMaterial()} frustumCulled={false} dispose={null} />
            ))}
            <points geometry={seeds.embers} material={emberMaterial()} frustumCulled={false} dispose={null} />
            <points geometry={seeds.smoke} material={smokeMaterial()} frustumCulled={false} dispose={null} />
          </group>
          <group>
            {ARCS.map((a, k) => (
              <mesh key={k} position={[a.x, a.y, a.z + i * 0.017]} scale={[a.w, a.h, 1]} geometry={billboardGeometry()} material={arcMaterial()} frustumCulled={false} dispose={null} />
            ))}
            <points geometry={seeds.sparks} material={sparkMaterial()} frustumCulled={false} dispose={null} />
          </group>
          <group>
            <points geometry={seeds.jet} material={jetMaterial()} frustumCulled={false} dispose={null} />
          </group>
          <pointLight ref={(l) => void (lights.current[i] = l)} position={[0, 1.4, 0.2]} distance={9} decay={1.6} intensity={0} />
          <Glow ref={(sp) => void (halos.current[i] = sp)} size={3} opacity={0} position={[0, 1.25, 0.1]} />
        </group>
      ))}
    </>
  );
}

interface Marker {
  key: string;
  station: StationId;
  kind: IncidentKind | 'evade' | 'label';
  y: number;
}

const LABEL_RANGE_M = 6.5;

function markerPosition(m: Marker): [number, number, number] {
  const st = STATIONS[m.station];
  return [st.x * 0.6 + st.useX * 0.4, m.y, st.z * 0.6 + st.useZ * 0.4];
}

const MARKER_STYLE: Record<Marker['kind'], string> = {
  fire: 'border-bad text-bad',
  leak: 'border-bad text-bad',
  short: 'border-warn text-warn',
  evade: 'border-warn text-warn',
  label: 'border-line text-slate-200',
};

/**
 * Carteles en el mundo: el nombre de los puestos cercanos y, visibles a través de los mamparos,
 * dónde hay una avería o adónde hay que correr para esquivar un impacto.
 */
export function Markers() {
  const { t } = useTranslation();
  const [markers, setMarkers] = useState<Marker[]>([]);
  const shown = useRef(new Map<string, Marker>());
  const signature = useRef('');
  const clock = useRef(0);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const scratch = useMemo(() => ({ dir: new Vector3(), to: new Vector3() }), []);
  useFrame(({ camera }, dt) => {
    // Un cartel detrás de la cámara se proyectaría reflejado en pantalla: se oculta.
    camera.getWorldDirection(scratch.dir);
    for (const [key, el] of nodes.current) {
      const m = shown.current.get(key);
      if (!m) continue;
      const [x, y, z] = markerPosition(m);
      const front = scratch.to.set(x, y, z).sub(camera.position).dot(scratch.dir) > 0.2;
      el.style.visibility = front ? 'visible' : 'hidden';
    }
    clock.current += dt;
    if (clock.current < 0.15) return;
    clock.current = 0;
    const s = getRun()?.state;
    if (!s) return;
    const next: Marker[] = [];
    const busy = new Set<StationId>();
    for (const inc of s.incidents) {
      const stack = next.filter((m) => m.station === inc.systemId).length;
      next.push({ key: `i${inc.id}`, station: inc.systemId, kind: inc.kind, y: 2.5 + stack * 0.42 });
      busy.add(inc.systemId);
    }
    if (s.warnings.some((w) => !w.evaded)) {
      next.push({ key: 'evade', station: 'helm', kind: 'evade', y: 2.5 });
      busy.add('helm');
    }
    for (const id of STATION_IDS) {
      if (busy.has(id)) continue;
      const st = STATIONS[id];
      if (Math.hypot(st.useX - playerState.pos.x, st.useZ - playerState.pos.z) <= LABEL_RANGE_M) next.push({ key: `l-${id}`, station: id, kind: 'label', y: 2.35 });
    }
    const sig = next.map((m) => `${m.key}:${m.y}`).join('|');
    if (sig !== signature.current) {
      signature.current = sig;
      shown.current = new Map(next.map((m) => [m.key, m]));
      setMarkers(next);
    }
  });
  const name = (id: StationId): string => (id === 'helm' || id === 'map' || id === 'power' || id === 'airlock' ? t(`station.${id}`) : t(`systemName.${id}`, { ns: 'sim' }));
  return (
    <>
      {markers.map((m) => {
        return (
          <Html key={m.key} position={markerPosition(m)} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
            <div
              ref={(el) => {
                if (el) nodes.current.set(m.key, el);
                else nodes.current.delete(m.key);
              }}
              style={{ visibility: 'hidden' }}
              className={`num flex items-center gap-1 whitespace-nowrap rounded border bg-panel/85 px-2 py-0.5 text-xs ${MARKER_STYLE[m.kind]} ${m.kind === 'label' ? 'opacity-80' : 'animate-pulse font-bold'}`}>
              {m.kind === 'fire' && <Flame size={14} />}
              {m.kind === 'short' && <Zap size={14} />}
              {m.kind === 'leak' && <Wind size={14} />}
              {m.kind === 'evade' && <Navigation size={14} />}
              {m.kind === 'label' ? name(m.station) : m.kind === 'evade' ? t('marker.evade') : `${t(`incident.${m.kind}`, { ns: 'sim' })} · ${name(m.station)}`}
            </div>
          </Html>
        );
      })}
    </>
  );
}
