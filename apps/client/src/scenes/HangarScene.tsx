/**
 * Hangar de la pantalla de diseño (fase 4): la sonda se monta pieza a pieza sobre una plataforma giratoria en
 * una nave de integración. La disposición sale de `game/hangarLayout.ts` (puro) y cada pieza se modela en
 * `gfx/probeModels.ts`. Al añadir una pieza, la grúa la baja, se desliza hasta su sitio, se suelda (destello y
 * chispas) y despliega alas, radiadores o antenas; al quitarla, la grúa la sube y desaparece. La pieza señalada
 * en la paleta (`useHangar.hover`) se ve en holograma donde iría. Sin assets nuevos ni `setState` por frame.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EdgesGeometry, Group, Vector3, type BufferGeometry, type ShaderMaterial, type Sprite } from 'three';
import type { MissionDesign } from '@payload/shared';
import { hangarLayout, type HangarBlock, type HangarLayout } from '../game/hangarLayout';
import { addPart } from '../game/missionDesign';
import { useGame } from '../game/runStore';
import { Parts, once } from '../gfx/build';
import { seedGeometry } from '../gfx/fxShaders';
import { Glow, ShaderClock } from '../gfx/Glow';
import { frameEdgeMaterial, frameGhostMaterial, ghostEdgeMaterial, ghostMaterial, weldSparkMaterial } from '../gfx/hangarShaders';
import { benchParts, dollyParts, probeModel, trussParts } from '../gfx/probeModels';
import { useHangar } from '../state/hangar';
import { claimCrane, Crane, craneBusy, HangarHall, HangarReflections, PAD_TOP, TurntableTop } from './HangarEnv';

/** Duraciones (s) del montaje. */
const ARRIVE_S = 1.5;
const DEPLOY_S = 0.7;
const LEAVE_S = 1.1;
/** Separación entre piezas al montar de golpe un diseño entero (al abrir el hangar). */
const STAGGER_S = 0.32;
/** Altura desde la que baja la grúa y holgura bajo la nave. */
const DROP_M = 3.6;
const CLEARANCE_M = 0.55;
const SPIN = 0.13;

const idOf = (b: HangarBlock) => `${b.key}:${b.partId}`;

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Desde dónde llega cada pieza (dirección horizontal en el sistema de la nave; 0 = baja en vertical). */
function approachOf(b: HangarBlock): [number, number] {
  switch (b.shape) {
    case 'bus':
    case 'dish':
    case 'whip':
    case 'pod':
    case 'emitter':
      return [0, 0];
    case 'engine':
    case 'ion':
      return [-1, 0];
    case 'whipple':
    case 'instrument':
      return [1, 0];
    default:
      return [0, b.position[2] < -0.02 ? -1 : 1];
  }
}

/** Qué eje se despliega tras soldar (escala del grupo en su marco) y desde cuánto. */
function deployOf(b: HangarBlock): { axis: 'x' | 'y' | 'z' | 'all'; from: number } | null {
  if (b.shape === 'wing') return { axis: 'z', from: 0.14 };
  if (b.shape === 'radiator') return { axis: 'y', from: 0.2 };
  if (b.shape === 'dish') return { axis: 'all', from: 0.35 };
  if (b.shape === 'whip') return { axis: 'y', from: 0.3 };
  return null;
}

// ─── Soldaduras ──────────────────────────────────────────────────────────────────────────────────────────────

const WELD_SLOTS = 6;
const welds = { next: 0, queue: [] as { x: number; y: number; z: number }[] };
/** Pide un destello de soldadura en un punto del sistema de la nave (lo pinta `Welds`). */
function weldAt(p: readonly number[]): void {
  welds.queue.push({ x: p[0] ?? 0, y: p[1] ?? 0, z: p[2] ?? 0 });
}

function Welds() {
  const slots = useMemo(() => Array.from({ length: WELD_SLOTS }, (_, i) => ({ material: weldSparkMaterial(), geometry: seedGeometry(48, 71 + i * 13), t0: -99 })), []);
  const groups = useRef<(Group | null)[]>([]);
  const flashes = useRef<(Sprite | null)[]>([]);
  const embers = useRef<(Sprite | null)[]>([]);
  useEffect(() => () => slots.forEach((s) => (s.material.dispose(), s.geometry.dispose())), [slots]);
  useFrame((state) => {
    const now = state.clock.elapsedTime;
    while (welds.queue.length) {
      const w = welds.queue.shift()!;
      const i = welds.next++ % WELD_SLOTS;
      slots[i]!.t0 = now;
      groups.current[i]?.position.set(w.x, w.y, w.z);
    }
    slots.forEach((s, i) => {
      const age = now - s.t0;
      const g = groups.current[i];
      if (!g) return;
      g.visible = age < 1.2;
      if (!g.visible) return;
      (s.material.uniforms.uAge as { value: number }).value = age;
      // Arco intermitente al principio, luego un rescoldo naranja que se apaga.
      const arc = age < 0.45 ? (Math.sin(age * 90) > -0.2 ? 1 : 0.35) * (1 - age / 0.45) : 0;
      const f = flashes.current[i];
      if (f) {
        f.material.opacity = arc * 0.95;
        f.scale.setScalar(0.5 + arc * 0.7);
      }
      const e = embers.current[i];
      if (e) e.material.opacity = Math.max(0, 0.7 * (1 - age / 1.2));
    });
  });
  return (
    <>
      {slots.map((s, i) => (
        <group key={i} ref={(g) => void (groups.current[i] = g)} visible={false}>
          <Glow ref={(g) => void (flashes.current[i] = g)} color="#cfe6ff" size={1} opacity={0} />
          <Glow ref={(g) => void (embers.current[i] = g)} color="#ff8a2a" size={0.28} opacity={0} />
          <points geometry={s.geometry as BufferGeometry} material={s.material as ShaderMaterial} frustumCulled={false} />
        </group>
      ))}
    </>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────────────────────────────────────────

interface Live {
  id: string;
  block: HangarBlock;
  leaving: boolean;
  delay: number;
  gen: number;
}

const tmpWorld = new Vector3();

/** Una pieza montada: llega, se suelda, despliega y sigue su sitio si el diseño cambia; o se retira. */
const Piece = memo(function Piece({ live, onGone }: { live: Live; onGone: (id: string, gen: number) => void }) {
  const ref = useRef<Group>(null);
  const model = useMemo(() => probeModel(live.block), [live.block]);
  const st = useRef({ t0: Number.NaN, tLeave: Number.NaN, welded: false, gone: false, cur: new Vector3(...live.block.anchor) });
  const block = live.block;
  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    const s = st.current;
    const now = state.clock.elapsedTime;
    if (Number.isNaN(s.t0)) s.t0 = now + live.delay;
    const [ax, ay, az] = block.anchor;
    const [ox, oz] = approachOf(block);
    const reach = 1 + Math.max(...block.size) * 0.6;
    const lift = Math.max(...block.size) * 0.55 + 0.25;
    const deploy = deployOf(block);
    let scale = 1;
    if (!live.leaving) {
      const t = (now - s.t0) / ARRIVE_S;
      if (t < 0) {
        g.visible = false;
        return;
      }
      g.visible = true;
      if (t < 1) {
        let px = ax;
        let py = ay;
        let pz = az;
        if (ox === 0 && oz === 0) {
          py += DROP_M * (1 - easeOut(t));
        } else if (t < 0.6) {
          px += ox * reach;
          pz += oz * reach;
          py += DROP_M * (1 - easeOut(t / 0.6));
        } else {
          const u = 1 - easeInOut((t - 0.6) / 0.4);
          px += ox * reach * u;
          pz += oz * reach * u;
        }
        // Balanceo leve mientras cuelga de la grúa.
        px += Math.sin(now * 3.1 + block.seed) * 0.04 * (1 - t);
        g.position.set(px, py, pz);
        s.cur.set(px, py, pz);
        if (deploy) scale = deploy.from;
        g.getWorldPosition(tmpWorld);
        claimCrane(now, s.t0, tmpWorld.x, tmpWorld.y + lift, tmpWorld.z);
      } else {
        if (!s.welded) {
          s.welded = true;
          weldAt(block.anchor);
        }
        // Si el diseño cambia (otra estructura, más alas…), la pieza se desliza a su nuevo sitio.
        const k = 1 - Math.exp(-Math.min(dt, 0.1) * 5);
        s.cur.x += (ax - s.cur.x) * k;
        s.cur.y += (ay - s.cur.y) * k;
        s.cur.z += (az - s.cur.z) * k;
        g.position.copy(s.cur);
        if (deploy) scale = deploy.from + (1 - deploy.from) * easeInOut(clamp01(((t - 1) * ARRIVE_S) / DEPLOY_S));
      }
    } else {
      if (Number.isNaN(s.tLeave)) s.tLeave = now;
      const t = (now - s.tLeave) / LEAVE_S;
      g.visible = true;
      const up = DROP_M * easeInOut(clamp01(t));
      g.position.set(s.cur.x + ox * reach * clamp01(t * 2) * 0.6, s.cur.y + up, s.cur.z + oz * reach * clamp01(t * 2) * 0.6);
      scale = 1 - clamp01((t - 0.55) / 0.45);
      if (deploy) scale *= deploy.from + (1 - deploy.from) * (1 - clamp01(t * 3));
      g.getWorldPosition(tmpWorld);
      claimCrane(now, s.tLeave, tmpWorld.x, tmpWorld.y + lift, tmpWorld.z);
      if (t >= 1 && !s.gone) {
        s.gone = true;
        g.visible = false;
        onGone(live.id, live.gen);
      }
    }
    const sc = Math.max(0.001, scale);
    if (!deploy || deploy.axis === 'all' || live.leaving) g.scale.setScalar(live.leaving || deploy?.axis === 'all' ? sc : 1);
    if (deploy && !live.leaving && deploy.axis !== 'all') g.scale.set(deploy.axis === 'x' ? sc : 1, deploy.axis === 'y' ? sc : 1, deploy.axis === 'z' ? sc : 1);
  });
  return (
    <group ref={ref} rotation-x={block.roll} visible={false}>
      <Parts parts={model.parts} />
      {model.glows.map((gl, i) => (
        <Glow key={i} position={gl.position} color={gl.color} size={gl.size} opacity={gl.opacity} />
      ))}
    </group>
  );
});

// ─── Holograma ───────────────────────────────────────────────────────────────────────────────────────────────

const edgeCache = new WeakMap<BufferGeometry, EdgesGeometry>();
const edgesOf = (g: BufferGeometry): EdgesGeometry => {
  let e = edgeCache.get(g);
  if (!e) {
    e = new EdgesGeometry(g, 28);
    edgeCache.set(g, e);
  }
  return e;
};

/** Pieza en holograma (la señalada en la paleta, o el bastidor vacío). */
function GhostPiece({ block, faint = false }: { block: HangarBlock; faint?: boolean }) {
  const model = useMemo(() => probeModel(block), [block]);
  const mat = faint ? frameGhostMaterial() : ghostMaterial();
  return (
    <group position={block.anchor} rotation-x={block.roll}>
      {model.parts.map((p, i) => (
        <group key={i}>
          <mesh geometry={p.geometry} material={mat} dispose={null} />
          <lineSegments geometry={edgesOf(p.geometry)} material={faint ? frameEdgeMaterial() : ghostEdgeMaterial()} dispose={null} />
        </group>
      ))}
    </group>
  );
}

/** Bastidor vacío: el bus que espera la estructura, en holograma tenue. */
function emptyFrame(layout: HangarLayout): HangarBlock {
  const { lengthM: L, radiusM: R } = layout.bus;
  return { key: 'frame', partId: '', family: 'structure', shape: 'bus', look: 'octagon', position: [0, 0, 0], size: [L, 2 * R, 2 * R], roll: 0, anchor: [0, 0, 0], order: 0, tier: 0, seed: 1 };
}

// ─── Conjunto: plataforma, nave, soportes y cámara ───────────────────────────────────────────────────────────

const camPos = new Vector3();
const camLook = new Vector3();
const camTarget = new Vector3();
const CAM_DIR = new Vector3(0.7, 0.3, 0.62).normalize();

function Assembly({ design }: { design: MissionDesign | null }) {
  const hover = useHangar((h) => h.hover);
  const layout = useMemo(() => (design ? hangarLayout(design) : null), [design]);
  const ghosts = useMemo(() => {
    if (!design || !hover || !layout) return [];
    const now = new Set(layout.blocks.map(idOf));
    return hangarLayout(addPart(design, hover)).blocks.filter((b) => !now.has(idOf(b)));
  }, [design, hover, layout]);

  // Piezas vivas: las del diseño más las que se están retirando.
  const [lives, setLives] = useState<Live[]>([]);
  const firstBuild = useRef(true);
  useEffect(() => {
    if (!layout) return;
    const first = firstBuild.current;
    firstBuild.current = false;
    const rankOf = new Map([...layout.blocks].sort((a, b) => a.order - b.order).map((b, i) => [idOf(b), i]));
    setLives((prev) => {
      const prevById = new Map(prev.map((l) => [l.id, l]));
      const ids = new Set<string>();
      const next: Live[] = [];
      let fresh = 0;
      for (const b of layout.blocks) {
        const id = idOf(b);
        ids.add(id);
        const old = prevById.get(id);
        if (old && !old.leaving) next.push(old.block === b ? old : { ...old, block: b });
        else next.push({ id, block: b, leaving: false, delay: first ? (rankOf.get(id) ?? 0) * STAGGER_S + 0.4 : fresh++ * STAGGER_S, gen: (old?.gen ?? 0) + 1 });
      }
      for (const l of prev) if (!ids.has(l.id)) next.push(l.leaving ? l : { ...l, leaving: true, gen: l.gen + 1 });
      return next;
    });
  }, [layout]);
  const onGone = useCallback((id: string, gen: number) => setLives((prev) => prev.filter((l) => !(l.id === id && l.gen === gen && l.leaving))), []);

  // Encuadre: la nave queda centrada sobre la plataforma y por encima de ella.
  const frame = useMemo(() => {
    if (!layout) return { cx: 0, cz: 0, y: 1.5, floorY: -1.5, radius: 2.5, midY: 0 };
    const { min, max } = layout.bounds;
    const y = PAD_TOP + CLEARANCE_M - min[1];
    // Las alas se extienden en Z, que la cámara ve en escorzo: cuentan menos para el encuadre.
    const radius = Math.hypot(max[0] - min[0], max[1] - min[1], (max[2] - min[2]) * 0.6) / 2;
    return { cx: (min[0] + max[0]) / 2, cz: (min[2] + max[2]) / 2, y, floorY: PAD_TOP - y, radius, midY: (min[1] + max[1]) / 2 };
  }, [layout]);

  const turn = useRef<Group>(null);
  const ship = useRef<Group>(null);
  const spin = useRef(SPIN);
  const shipPos = useRef<Vector3 | null>(null);
  const camera = useThree((s) => s.camera);
  useFrame((state, dt) => {
    const now = state.clock.elapsedTime;
    const d = Math.min(dt, 0.1);
    // La plataforma se detiene mientras la grúa monta o retira una pieza.
    spin.current += ((craneBusy(now) ? 0 : SPIN) - spin.current) * (1 - Math.exp(-d * 2.5));
    if (turn.current) turn.current.rotation.y += spin.current * d;
    if (ship.current) {
      if (!shipPos.current) shipPos.current = new Vector3(-frame.cx, frame.y, -frame.cz);
      const k = 1 - Math.exp(-d * 3);
      const p = shipPos.current;
      p.x += (-frame.cx - p.x) * k;
      p.y += (frame.y - p.y) * k;
      p.z += (-frame.cz - p.z) * k;
      ship.current.position.copy(p);
    }
    // Cámara: distancia según el tamaño de la nave, con un vaivén muy lento.
    const dist = Math.min(30, Math.max(7.5, frame.radius * 2.5 + 2.5));
    const centerY = frame.y + frame.midY;
    camTarget.set(0, centerY + 0.35, 0);
    camPos.copy(CAM_DIR).multiplyScalar(dist).add(camTarget);
    camPos.x += Math.sin(now * 0.07) * dist * 0.06;
    camPos.y = Math.max(camPos.y, centerY + 1.2);
    const kc = 1 - Math.exp(-d * 1.8);
    camera.position.lerp(camPos, kc);
    camLook.lerp(camTarget, kc);
    camera.lookAt(camLook);
  });

  const bench = layout ? benchParts(layout) : null;
  const truss = layout ? trussParts(layout) : null;
  const dolly = layout ? dollyParts(layout, frame.floorY) : null;
  const ghostBus = ghosts.some((g) => g.shape === 'bus');
  return (
    <group ref={turn}>
      <TurntableTop />
      <group ref={ship}>
        {dolly && <Parts parts={dolly} />}
        {truss && <Parts parts={truss} />}
        {bench && <Parts parts={bench} />}
        {layout && !layout.bus.present && !ghostBus && <GhostPiece block={emptyFrame(layout)} faint />}
        {lives.map((l) => (
          <Piece key={`${l.id}#${l.gen}`} live={l} onGone={onGone} />
        ))}
        {ghosts.map((b) => (
          <GhostPiece key={`ghost-${idOf(b)}`} block={b} />
        ))}
        <Welds />
      </group>
    </group>
  );
}

const initialCamera = once(() => ({ fov: 36, near: 0.1, far: 400, position: [11, 6, 11] as [number, number, number] }));

export function HangarScene() {
  const design = useGame((g) => g.draft);
  return (
    <Canvas dpr={[1, 1.5]} camera={initialCamera()} onCreated={({ camera }) => camera.lookAt(0, 2, 0)}>
      <color attach="background" args={['#04070d']} />
      <fog attach="fog" args={['#04070d', 26, 75]} />
      <ShaderClock />
      <HangarReflections />
      <ambientLight intensity={0.22} />
      <hemisphereLight args={['#a9b9d9', '#151b26', 0.55]} />
      <directionalLight position={[7, 14, 8]} intensity={2.3} color="#fff4e2" />
      <directionalLight position={[-8, 6, -7]} intensity={0.7} color="#7fb0ff" />
      <directionalLight position={[2, 4, -12]} intensity={0.45} color="#38e1c0" />
      <HangarHall />
      <Crane />
      <Assembly design={design} />
    </Canvas>
  );
}
