import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BoxGeometry,
  ConeGeometry,
  DoubleSide,
  EdgesGeometry,
  IcosahedronGeometry,
  LineBasicMaterial,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  type Group,
  type InstancedMesh,
  type LineSegments,
  type Mesh,
  type Sprite,
} from 'three';
import { ARENA_HALF_Y, rockDepth, SHIP_RADIUS } from '../game/dodge';
import { FLAME_RADIUS_M, WIDE_AIM_MULT } from '../game/repairGames';
import { STATIONS } from '../game/layout';
import { getRun } from '../game/runStore';
import { Glow } from '../gfx/Glow';
import { minigame } from '../state/minigame';
import { useSettings } from '../state/settings';

/** Holograma de pilotaje sobre la consola del timón, de cara a quien pilota (que mira a −Z). */
const HOLO = { x: STATIONS.helm.x, y: 1.72, z: STATIONS.helm.useZ - 0.95 } as const;
/** Metros por unidad del plano de pilotaje y fondo del volumen (de donde llegan las rocas). */
const SCALE = 0.5;
const DEPTH_M = 1.0;
const MAX_ROCKS = 64;
const MAX_RINGS = 24;

/**
 * Esquiva en el timón: un volumen holográfico en el que las rocas llegan desde el fondo hacia la nave
 * (el plano delantero). Cada roca que se acerca proyecta un anillo en el plano: dónde golpeará. Se lee
 * por forma (rocas facetadas, nave en flecha, anillos) y no solo por color. Con un aviso de impacto y
 * sin pilotar, el holograma late con unas rocas a la deriva: «el aviso se resuelve aquí».
 */
export function DodgeHolo() {
  const group = useRef<Group>(null);
  const rocks = useRef<InstancedMesh>(null);
  const rings = useRef<InstancedMesh>(null);
  const ship = useRef<Mesh>(null);
  const timer = useRef<Mesh>(null);
  const frame = useRef<LineSegments>(null);
  const t = useRef(0);
  const res = useMemo(() => {
    const box = new BoxGeometry(2 * SCALE, 2 * ARENA_HALF_Y * SCALE, DEPTH_M);
    box.translate(0, 0, -DEPTH_M / 2);
    const cone = new ConeGeometry(SHIP_RADIUS * SCALE * 1.1, SHIP_RADIUS * SCALE * 2.6, 4);
    cone.rotateX(-Math.PI / 2);
    const bar = new PlaneGeometry(2 * SCALE, 0.025);
    bar.translate(SCALE, 0, 0); // crece desde la izquierda
    const holo = { transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false } as const;
    return {
      edges: new EdgesGeometry(box),
      rock: new IcosahedronGeometry(1, 0),
      ring: new RingGeometry(0.86, 1, 28),
      cone,
      bar,
      frameMat: new LineBasicMaterial({ color: '#5fe8ff', opacity: 0.6, ...holo }),
      rockMat: new MeshBasicMaterial({ color: '#ffb35c', wireframe: true, opacity: 0.95, ...holo }),
      ringMat: new MeshBasicMaterial({ color: '#ffd9a0', opacity: 0.35, side: DoubleSide, ...holo }),
      shipMat: new MeshBasicMaterial({ color: '#9ff6ff', opacity: 0.95, ...holo }),
      barMat: new MeshBasicMaterial({ color: '#5fe8ff', opacity: 0.7, ...holo }),
      dummy: new Object3D(),
    };
  }, []);
  useEffect(
    () => () => {
      for (const v of Object.values(res)) if (v && typeof (v as { dispose?: () => void }).dispose === 'function') (v as { dispose: () => void }).dispose();
    },
    [res],
  );

  useFrame((_, dt) => {
    t.current += dt;
    const g = group.current;
    const rk = rocks.current;
    const rg = rings.current;
    if (!g || !rk || !rg) return;
    const s = getRun()?.state;
    const d = minigame.dodge;
    const warn = !!s && s.warnings.some((w) => !w.evaded) && !useSettings.getState().simpleDodge;
    g.visible = !!d || warn;
    if (!g.visible) return;
    const { dummy } = res;
    const flash = minigame.dodgeFlash;
    res.frameMat.color.set(flash > 0.6 ? '#ff6b5c' : '#5fe8ff');
    res.frameMat.opacity = d ? 0.55 + flash * 0.4 : 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(t.current * 6));
    let n = 0;
    let m = 0;
    if (d) {
      for (const rock of d.rocks) {
        const depth = rockDepth(d, rock);
        if (depth < 0 || depth > 1) continue;
        if (n >= MAX_ROCKS) break;
        dummy.position.set(rock.x * SCALE, rock.y * SCALE, -depth * DEPTH_M);
        dummy.rotation.set(t.current * rock.spin, t.current * rock.spin * 0.7, 0);
        dummy.scale.setScalar(rock.r * SCALE);
        dummy.updateMatrix();
        rk.setMatrixAt(n++, dummy.matrix);
        // Sombra en el plano de la nave: dónde llegará (y con qué tamaño de contacto).
        if (depth < 0.65 && m < MAX_RINGS) {
          dummy.position.set(rock.x * SCALE, rock.y * SCALE, 0.002);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar((rock.r + SHIP_RADIUS) * SCALE * (1 + depth * 0.25));
          dummy.updateMatrix();
          rg.setMatrixAt(m++, dummy.matrix);
        }
      }
      ship.current?.position.set(d.x * SCALE, d.y * SCALE, 0);
      // Golpe: la nave se sacude y se encoge (forma, no solo color).
      ship.current?.scale.setScalar(1 - flash * 0.35);
      ship.current?.rotation.set(0, 0, Math.sin(t.current * 40) * flash * 0.8);
      timer.current?.scale.set(Math.max(0.001, 1 - d.t / d.durationS), 1, 1);
    } else {
      // Reclamo: tres rocas a la deriva hacia la nave quieta.
      for (let i = 0; i < 3; i++) {
        const depth = 1 - ((t.current * 0.45 + i / 3) % 1);
        dummy.position.set(Math.sin(i * 2.1 + t.current * 0.3) * 0.6 * SCALE, Math.cos(i * 1.7) * 0.3 * SCALE, -depth * DEPTH_M);
        dummy.rotation.set(t.current, t.current * 0.6, 0);
        dummy.scale.setScalar(0.16 * SCALE);
        dummy.updateMatrix();
        rk.setMatrixAt(n++, dummy.matrix);
      }
      ship.current?.position.set(0, 0, 0);
      ship.current?.scale.setScalar(1);
      ship.current?.rotation.set(0, 0, 0);
      timer.current?.scale.set(0.001, 1, 1);
    }
    rk.count = n;
    rg.count = m;
    rk.instanceMatrix.needsUpdate = true;
    rg.instanceMatrix.needsUpdate = true;
  });

  return (
    <group ref={group} position={[HOLO.x, HOLO.y, HOLO.z]} visible={false}>
      <lineSegments ref={frame} geometry={res.edges} material={res.frameMat} />
      <instancedMesh ref={rocks} args={[res.rock, res.rockMat, MAX_ROCKS]} frustumCulled={false} />
      <instancedMesh ref={rings} args={[res.ring, res.ringMat, MAX_RINGS]} frustumCulled={false} />
      <mesh ref={ship} geometry={res.cone} material={res.shipMat} />
      <mesh ref={timer} geometry={res.bar} material={res.barMat} position={[-SCALE, -ARENA_HALF_Y * SCALE - 0.05, 0]} />
    </group>
  );
}

/**
 * Llama del extintor: se mueve delante del puesto con fuego; a ella se apunta con el centro de la vista.
 * Rociando, una nube blanca sale hacia la llama; acertando, la llama se encoge.
 */
export function FlameTarget() {
  const ring = useRef<Mesh>(null);
  const ringRes = useMemo(
    () => ({ geo: new RingGeometry(FLAME_RADIUS_M * 0.8, FLAME_RADIUS_M, 32), mat: new MeshBasicMaterial({ color: '#1a0c00', transparent: true, opacity: 0.85, depthTest: false, side: DoubleSide, toneMapped: false }) }),
    [],
  );
  useEffect(
    () => () => {
      ringRes.geo.dispose();
      ringRes.mat.dispose();
    },
    [ringRes],
  );
  const flame = useRef<Sprite>(null);
  const core = useRef<Sprite>(null);
  const spray = useRef<Sprite>(null);
  const t = useRef(0);
  useFrame(({ camera }, dt) => {
    t.current += dt;
    const r = minigame.repair;
    const settings = useSettings.getState();
    const on = r.kind === 'fire' && !settings.simpleRepairs;
    // Anillo oscuro sobre el fuego: el foco al que se apunta (se distingue por forma sobre las llamas).
    if (ring.current) {
      ring.current.visible = on;
      if (on) {
        ring.current.position.set(r.flame.x, r.flame.y, r.flame.z);
        ring.current.lookAt(camera.position);
        ring.current.scale.setScalar((r.spraying && r.onTarget ? 0.8 : 1) * (settings.wideAim ? WIDE_AIM_MULT : 1));
      }
    }
    if (flame.current) flame.current.visible = on;
    if (core.current) core.current.visible = on;
    if (spray.current) spray.current.visible = on;
    if (!on) return;
    const k = r.spraying && r.onTarget ? 0.7 : 1;
    const flick = 1 + Math.sin(t.current * 23) * 0.08;
    flame.current?.position.set(r.flame.x, r.flame.y, r.flame.z);
    flame.current?.scale.setScalar(0.75 * k * flick);
    core.current?.position.set(r.flame.x, r.flame.y - 0.05, r.flame.z);
    core.current?.scale.setScalar(0.32 * k * flick);
    if (spray.current) {
      // Nube del extintor sobre la llama solo cuando se acierta (la señal del acierto es la nube, no un color).
      spray.current.visible = r.spraying && r.onTarget;
      spray.current.position.set(r.flame.x, r.flame.y, r.flame.z);
      spray.current.scale.setScalar(0.7 + Math.sin(t.current * 17) * 0.1);
    }
  });
  return (
    <>
      <mesh ref={ring} geometry={ringRes.geo} material={ringRes.mat} renderOrder={20} visible={false} />
      <Glow ref={flame} color="#ff7a2a" size={0.75} opacity={0.85} />
      <Glow ref={core} color="#ffe2a0" size={0.32} opacity={0.9} />
      <Glow ref={spray} color="#e8f4ff" size={0.6} opacity={0.5} />
    </>
  );
}
