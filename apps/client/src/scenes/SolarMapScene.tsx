/**
 * Mapa 3D del sistema solar (fase 4, partidas con diseño): Sol en el centro, órbitas, cuerpos procedurales, lunas
 * junto a su planeta, cinturón instanciado, el tramo actual con sus enlaces y los saltos posibles resaltados, y el
 * destino de la misión marcado. Escala comprimida en `game/solarScale.ts` (√UA). Se carga con `lazy` desde el
 * mapa (`ui/StarMap.tsx`); la estimación del salto y el botón siguen en el panel lateral, como en el mapa estelar.
 *
 * La escena lee el tránsito por frame con `getRun()` (marcador de la nave); lo demás cambia solo al cambiar de
 * nodo o de selección (props).
 */
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line, OrbitControls, Stars } from '@react-three/drei';
import { BoxGeometry, BufferGeometry, CanvasTexture, OctahedronGeometry, Color, Float32BufferAttribute, Object3D, SRGBColorSpace, Vector3, type Group, type InstancedMesh, type Mesh } from 'three';
import { catalog as defaultCatalog, getSolarSystem, type Catalog, type SectorMap, type SolarBodyDef } from '@payload/shared';
import { getRun } from '../game/runStore';
import { hashOf, rng } from '../game/noise';
import { beltRange, bodyDisplayRadius, bodyScenePos, boundsOf, orbitRadius, sectorScenePositions, sunDirectionFrom, sunOrbiters, type ScenePos } from '../game/solarScale';
import { LruCache } from '../game/lru';
import { bodyLook } from '../gfx/bodyLook';
import { once } from '../gfx/build';
import { Glow, ShaderClock } from '../gfx/Glow';
import { mats } from '../gfx/materials';
import { rockGeometry, rockMaterial } from '../gfx/rocks';
import { planetMaterial, ringMaterial } from '../gfx/spaceShaders';
import { nodeName } from '../ui/names';

const Y = 0;
const waypointStationGeo = once(() => new OctahedronGeometry(0.16, 0));
const waypointDerelictGeo = once(() => new BoxGeometry(0.26, 0.12, 0.18));
const ACCENT = '#38e1c0';
const GOLD = '#ffd25a';
/** Guía del objetivo (`signal` del sistema visual): el nodo al que lleva el paso actual. */
const SIGNAL = '#ff9a4a';

/**
 * Etiquetas como sprites con textura de lienzo (tamaño constante en pantalla, sin DOM): baratas y sin los
 * desmontajes de raíces de React que provoca `Html` de drei. Se cachean por texto y color.
 */
const LABEL_CACHE_MAX = 96;
const labelCache = new LruCache<string, { tex: CanvasTexture; aspect: number }>(LABEL_CACHE_MAX, (v) => v.tex.dispose());
function labelTexture(text: string, color: string): { tex: CanvasTexture; aspect: number } {
  const key = `${color}|${text}`;
  const hit = labelCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = '600 30px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 20;
  c.width = w;
  c.height = 44;
  ctx.font = font;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, 0, w, 44);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10, 23);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const out = { tex, aspect: w / 44 };
  labelCache.set(key, out);
  return out;
}

const LABEL_H = 0.034;

function Label({ text, color, position }: { text: string; color: string; position: [number, number, number] }) {
  const { tex, aspect } = useMemo(() => labelTexture(text, color), [text, color]);
  return (
    <sprite position={position} scale={[LABEL_H * aspect, LABEL_H, 1]} center={[0.5, -0.35]} renderOrder={10}>
      <spriteMaterial map={tex} sizeAttenuation={false} depthTest={false} depthWrite={false} transparent toneMapped={false} />
    </sprite>
  );
}

function circleGeometry(radius: number, seg = 160): BufferGeometry {
  const pts: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pts, 3));
  return g;
}

function Orbits({ cat }: { cat: Catalog }) {
  const geos = useMemo(() => sunOrbiters(cat).map((b) => ({ id: b.id, g: circleGeometry(orbitRadius(b.orbitAu ?? 0)), major: b.type === 'planet' })), [cat]);
  useEffect(() => () => geos.forEach((x) => x.g.dispose()), [geos]);
  return (
    <group>
      {geos.map(({ id, g, major }) => (
        <lineLoop key={id} geometry={g}>
          <lineBasicMaterial color={major ? '#35557f' : '#22385a'} transparent opacity={major ? 0.75 : 0.45} />
        </lineLoop>
      ))}
    </group>
  );
}

const BELT_ROCKS = 700;

function Belt({ cat }: { cat: Catalog }) {
  const range = useMemo(() => beltRange(cat), [cat]);
  const mesh = useRef<InstancedMesh>(null);
  useEffect(() => {
    const m = mesh.current;
    if (!m || !range) return;
    const r = rng(hashOf('belt'));
    const d = new Object3D();
    const col = new Color();
    for (let i = 0; i < BELT_ROCKS; i++) {
      const a = r() * Math.PI * 2;
      const rad = range.inner + (range.outer - range.inner) * (0.5 + (r() + r() - 1) * 0.5);
      d.position.set(Math.cos(a) * rad, (r() - 0.5) * 0.35, Math.sin(a) * rad);
      d.rotation.set(r() * 6, r() * 6, r() * 6);
      const s = 0.025 + r() * r() * 0.07;
      d.scale.set(s, s * (0.6 + r() * 0.5), s);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      const tone = 0.45 + r() * 0.35;
      m.setColorAt(i, col.setRGB(tone, tone * 0.95, tone * 0.88));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [range]);
  const spin = useRef<Group>(null);
  useFrame((_, dt) => {
    if (spin.current) spin.current.rotation.y += dt * 0.004;
  });
  if (!range) return null;
  return (
    <group ref={spin}>
      <instancedMesh ref={mesh} args={[rockGeometry(), rockMaterial(), BELT_ROCKS]} frustumCulled={false} dispose={null} />
    </group>
  );
}

/** Un cuerpo del catálogo en su sitio, con el aspecto que da `bodyLook` y la luz hacia el Sol. */
function BodyMesh({ body, at }: { body: SolarBodyDef; at: ScenePos }) {
  const look = useMemo(() => bodyLook(body), [body]);
  const radius = bodyDisplayRadius(body);
  // Luz desde el Sol (origen), no la dirección fija de la vista de la nave (`SUN_DIR`): globo y anillo.
  const sun = useMemo(() => {
    const d = sunDirectionFrom(at);
    return new Vector3(d.x, d.y, d.z);
  }, [at.x, at.z]);
  const globe = useMemo(() => {
    if (look.kind !== 'globe') return null;
    const m = planetMaterial(look.look);
    m.material.uniforms.uSun!.value = sun;
    return m.material;
  }, [look, sun]);
  const ring = useMemo(() => {
    if (look.kind !== 'globe' || !look.ring) return null;
    const r = ringMaterial(look.look.b.clone().lerp(new Color('#ffffff'), 0.3), look.look.seed, radius * 1.35, radius * 2.25, radius);
    r.uniforms.uSun!.value = sun;
    return r;
  }, [look, radius, sun]);
  useEffect(() => () => {
    globe?.dispose();
    ring?.dispose();
  }, [globe, ring]);
  const spin = useRef<Mesh>(null);
  useFrame((_, dt) => {
    if (spin.current) spin.current.rotation.y += dt * 0.05;
  });
  if (look.kind === 'sun') return null;
  if (look.kind === 'station') {
    return (
      <group position={[at.x, Y, at.z]}>
        <mesh ref={spin} material={mats().trim} dispose={null}>
          <octahedronGeometry args={[radius * 1.2, 0]} />
        </mesh>
        <Glow color={ACCENT} size={0.6} opacity={0.5} />
      </group>
    );
  }
  if (look.kind === 'rock') {
    return <mesh ref={spin} position={[at.x, Y, at.z]} scale={radius * 1.1} geometry={rockGeometry()} material={rockMaterial()} dispose={null} />;
  }
  return (
    <group position={[at.x, Y, at.z]}>
      <mesh ref={spin} material={globe ?? undefined}>
        <sphereGeometry args={[radius, 48, 32]} />
      </mesh>
      {ring && (
        <mesh material={ring} rotation={[Math.PI / 2 - 0.35, 0, 0]}>
          <ringGeometry args={[radius * 1.35, radius * 2.25, 96, 1]} />
        </mesh>
      )}
    </group>
  );
}

function Sun() {
  const mesh = useRef<Mesh>(null);
  useFrame((_, dt) => {
    if (mesh.current) mesh.current.rotation.y += dt * 0.02;
  });
  return (
    <group>
      <mesh ref={mesh}>
        <sphereGeometry args={[bodyDisplayRadius({ type: 'star', radiusKm: 0 }) * 0.55, 32, 24]} />
        <meshBasicMaterial color="#ffd27a" toneMapped={false} />
      </mesh>
      <Glow color="#ffb347" size={6} opacity={0.85} />
      <Glow color="#ff8a2a" size={14} opacity={0.25} />
      <pointLight intensity={2.2} distance={0} decay={0} color="#fff1d6" />
    </group>
  );
}

interface NodeView {
  id: string;
  at: ScenePos;
  name: string;
  kind: string;
  reachable: boolean;
  here: boolean;
  target: boolean;
  goal: boolean;
  /** Nodo al que lleva el paso actual del objetivo. */
  objective: boolean;
}

/** Marcador pulsante de un nodo (anillos) y área de clic. */
function NodeMarker({ v, selected, onSelect }: { v: NodeView; selected: boolean; onSelect: (id: string) => void }) {
  const ring = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const r = ring.current;
    if (!r) return;
    if (v.reachable) r.scale.setScalar(1 + Math.sin(clock.elapsedTime * 3) * 0.12);
    if (v.here) r.rotation.z += 0.01;
  });
  const color = v.here ? '#ffffff' : selected ? ACCENT : v.target ? GOLD : v.reachable ? ACCENT : '#4d6f9c';
  const showRing = v.here || v.reachable || selected || v.target;
  return (
    <group position={[v.at.x, Y, v.at.z]}>
      {showRing && (
        <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[selected ? 0.62 : 0.5, selected ? 0.72 : 0.56, 40]} />
          <meshBasicMaterial color={color} transparent opacity={v.reachable || selected || v.here ? 0.95 : 0.6} toneMapped={false} depthWrite={false} />
        </mesh>
      )}
      {v.target && <Glow color={GOLD} size={1.8} opacity={0.4} />}
      {/* Objetivo: anillo exterior cálido que gira despacio (forma, no solo color). */}
      {v.objective && <ObjectiveRing />}
      {/* Área de clic invisible: los cuerpos pequeños también se pueden elegir. */}
      <mesh
        visible={false}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(v.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
        }}
      >
        <sphereGeometry args={[0.6, 8, 6]} />
      </mesh>
      <Label text={`${v.target ? '★ ' : ''}${v.name}`} color={v.here ? '#ffffff' : v.target ? GOLD : v.reachable ? ACCENT : '#9fb4d0'} position={[0, 0.3, 0]} />
    </group>
  );
}

/** Anillo del objetivo: discontinuo (cuatro arcos) y girando, por fuera del anillo de selección. */
function ObjectiveRing() {
  const g = useRef<Group>(null);
  useFrame((_, dt) => {
    if (g.current) g.current.rotation.y += dt * 0.8;
  });
  return (
    <group ref={g}>
      {[0, 1, 2, 3].map((k) => (
        <mesh key={k} rotation={[-Math.PI / 2, 0, (k * Math.PI) / 2]}>
          <ringGeometry args={[0.86, 0.95, 16, 1, 0.15, Math.PI / 2 - 0.3]} />
          <meshBasicMaterial color={SIGNAL} transparent opacity={0.95} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Marcador de la nave en pleno salto: se mueve por frame leyendo el estado vivo (sin React). */
function ShipMarker({ pos }: { pos: Record<string, ScenePos> }) {
  const g = useRef<Group>(null);
  useFrame(() => {
    const group = g.current;
    const tr = getRun()?.state.transit;
    if (!group) return;
    if (!tr) {
      group.visible = false;
      return;
    }
    const a = pos[tr.fromId];
    const b = pos[tr.toId];
    if (!a || !b) {
      group.visible = false;
      return;
    }
    const k = Math.max(0, Math.min(1, tr.traveledLy / Math.max(1e-6, tr.distanceLy)));
    group.visible = true;
    group.position.set(a.x + (b.x - a.x) * k, Y + 0.25, a.z + (b.z - a.z) * k);
  });
  return (
    <group ref={g} visible={false}>
      <mesh>
        <octahedronGeometry args={[0.18, 0]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
      <Glow color={ACCENT} size={1.1} opacity={0.7} />
    </group>
  );
}

/** Encadra la cámara sobre el tramo actual al abrir el mapa o cambiar de tramo. */
function Framing({ center, radius }: { center: ScenePos; radius: number }) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void } | null;
  useEffect(() => {
    const d = Math.max(10, radius * 2);
    camera.position.set(center.x, d * 1.1, center.z + d * 0.55);
    camera.lookAt(center.x, 0, center.z);
    if (controls) {
      controls.target.set(center.x, 0, center.z);
      controls.update();
    }
  }, [camera, controls, center.x, center.z, radius]);
  return null;
}

function Labels({ cat, skip }: { cat: Catalog; skip: ReadonlySet<string> }) {
  // Nombres de los planetas que no son nodos del tramo (orientación).
  const planets = useMemo(() => getSolarSystem(cat).bodies.filter((b) => b.type === 'planet' && !skip.has(b.id)), [cat, skip]);
  return (
    <>
      {planets.map((b) => {
        const at = bodyScenePos(b, cat);
        return (
          <Label key={b.id} text={nodeName({ name: b.id, bodyId: b.id })} color="#6f86a6" position={[at.x, bodyDisplayRadius(b) + 0.2, at.z]} />
        );
      })}
    </>
  );
}

export interface SolarMapProps {
  sector: SectorMap;
  hereId: string;
  reachable: readonly string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Guía del objetivo: nodo al que lleva el paso actual (anillo cálido). */
  objectiveId?: string | null;
}

function Route({ sector, pos, hereId, reachable, selectedId }: { sector: SectorMap; pos: Record<string, ScenePos>; hereId: string; reachable: readonly string[]; selectedId: string | null }) {
  const dim = useMemo(() => {
    const pts: number[] = [];
    for (const a of sector.nodes)
      for (const id of a.links) {
        if (id <= a.id) continue;
        const p = pos[a.id];
        const q = pos[id];
        if (p && q) pts.push(p.x, Y, p.z, q.x, Y, q.z);
      }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pts, 3));
    return g;
  }, [sector, pos]);
  useEffect(() => () => dim.dispose(), [dim]);
  const here = pos[hereId];
  return (
    <group>
      <lineSegments geometry={dim}>
        <lineBasicMaterial color="#2a4a74" transparent opacity={0.7} />
      </lineSegments>
      {here &&
        reachable.map((id) => {
          const q = pos[id];
          if (!q) return null;
          const picked = id === selectedId;
          return <Line key={id} points={[[here.x, Y, here.z], [q.x, Y, q.z]]} color={ACCENT} lineWidth={picked ? 3.2 : 1.6} dashed={!picked} dashSize={0.35} gapSize={0.2} transparent opacity={picked ? 1 : 0.8} />;
        })}
    </group>
  );
}

export function SolarMapScene({ sector, hereId, reachable, selectedId, onSelect, objectiveId = null }: SolarMapProps) {
  // Al cerrar el mapa: cursor normal y texturas de las etiquetas liberadas.
  useEffect(
    () => () => {
      document.body.style.cursor = '';
      labelCache.clear();
    },
    [],
  );
  const catalog = getRun()?.catalog ?? defaultCatalog;
  const pos = useMemo(() => sectorScenePositions(sector, catalog), [sector, catalog]);
  const nodeBodies = useMemo(() => new Set(sector.nodes.flatMap((n) => (n.bodyId ? [n.bodyId] : []))), [sector]);
  const bodies = useMemo(() => getSolarSystem(catalog).bodies, [catalog]);
  const views: NodeView[] = useMemo(
    () =>
      sector.nodes.flatMap((n) => {
        const at = pos[n.id];
        if (!at) return [];
        return [{ id: n.id, at, name: nodeName(n), kind: n.kind, reachable: reachable.includes(n.id), here: n.id === hereId, target: !!n.missionTarget, goal: n.id === sector.goalId, objective: n.id === objectiveId }];
      }),
    [sector, pos, reachable, hereId, objectiveId],
  );
  // Encuadre: dónde está la nave, los saltos posibles, la llegada del tramo y el destino (el resto, con la rueda).
  const bounds = useMemo(() => {
    const focus = sector.nodes.filter((n) => n.id === hereId || reachable.includes(n.id) || n.missionTarget || n.id === sector.goalId).flatMap((n) => (pos[n.id] ? [pos[n.id]!] : []));
    return boundsOf(focus.length > 0 ? focus : Object.values(pos));
  }, [sector, pos, hereId, reachable]);
  const center = useMemo(() => ({ x: bounds.cx, z: bounds.cz }), [bounds]);
  // Puntos de paso (sin cuerpo): una roca, un pecio o una estación pequeña según su tipo.
  const waypoints = sector.nodes.filter((n) => !n.bodyId);
  return (
    <Canvas dpr={[1, 1.5]} camera={{ fov: 45, near: 0.05, far: 600, position: [0, 30, 25] }} onPointerMissed={() => (document.body.style.cursor = '')}>
      <color attach="background" args={['#01030a']} />
      <ShaderClock />
      <Stars radius={200} depth={40} count={2200} factor={3.2} saturation={0.25} fade speed={0.3} />
      <ambientLight intensity={0.25} />
      <Sun />
      <Orbits cat={catalog} />
      <Belt cat={catalog} />
      {bodies.map((b) => (b.type === 'star' ? null : <BodyMesh key={b.id} body={b} at={bodyScenePos(b, catalog)} />))}
      {waypoints.map((n) => {
        const at = pos[n.id];
        if (!at) return null;
        return n.kind === 'asteroid' ? (
          <mesh key={n.id} position={[at.x, Y, at.z]} scale={0.16} geometry={rockGeometry()} material={rockMaterial()} dispose={null} />
        ) : (
          <mesh key={n.id} position={[at.x, Y, at.z]} material={n.kind === 'station' ? mats().trim : mats().machineDark} geometry={n.kind === 'station' ? waypointStationGeo() : waypointDerelictGeo()} dispose={null} />
        );
      })}
      <Route sector={sector} pos={pos} hereId={hereId} reachable={reachable} selectedId={selectedId} />
      {views.map((v) => (
        <NodeMarker key={v.id} v={v} selected={v.id === selectedId} onSelect={onSelect} />
      ))}
      <Labels cat={catalog} skip={nodeBodies} />
      <ShipMarker pos={pos} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} minDistance={3} maxDistance={90} maxPolarAngle={Math.PI * 0.47} />
      <Framing center={center} radius={bounds.radius} />
    </Canvas>
  );
}
