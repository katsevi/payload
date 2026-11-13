import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CylinderGeometry, OctahedronGeometry, TorusGeometry, type Group, type Mesh, type Sprite } from 'three';
import type { PlacedTool } from '@payload/shared';
import { getRun } from '../game/runStore';
import { lodeFinisherIds } from '../game/surfaceRules';
import { Builder, once, Parts } from '../gfx/build';
import { Glow } from '../gfx/Glow';
import { mats } from '../gfx/materials';
import { beamMaterial } from '../gfx/surfaceShaders';
import { liveTerrain } from './SurfaceWorld';

/**
 * Herramientas de minería colocadas sobre las vetas (`surface.tools`), modeladas con `Builder` y animadas
 * según lo que dice el motor. Se lee de lejos y sin texto:
 * - trabajando: el haz (luz concentrada o láser) y la animación; el depósito se llena con `progress`;
 * - piezas listas: baliza verde que parpadea con un haz vertical alto y piezas apiladas encima (una por unidad);
 * - parada por tormenta (concentrador): los espejos se pliegan, sin haz, piloto ámbar intermitente;
 * - veta agotada: sin haz, todo quieto (solo la baliza si quedan piezas).
 * Un juego de piezas reutilizable por hueco (`MAX_TOOLS`); sin luces puntuales (halos y haces aditivos).
 */
const MAX_TOOLS = 12;
const MAX_PIPS = 6;
const PETALS = 6;
const HUB_Y = 1.75;
const ROCK_TOP = 0.6;
/** Las vetas miden ~1 m: la herramienta, algo mayor que la roca. */
const TOOL_SCALE = 1.3;
const SIDE_X = 1.05;

// ─── Concentrador solar ──────────────────────────────────────────────────────────────────────────

const buildConcentrator = once(() => {
  const m = mats();
  const b = new Builder();
  // Trípode que abraza la veta.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    b.pipe(m.steel, [Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95], [0, HUB_Y, 0], 0.035, 6);
    b.cyl(m.dark, [Math.cos(a) * 0.95, 0.03, Math.sin(a) * 0.95], 0.08, 0.1, 0.06, { seg: 8 });
  }
  b.cyl(m.machineDark, [0, HUB_Y, 0], 0.11, 0.11, 0.16, { seg: 12 });
  // Campana que recoge el vapor sobre el hielo y lo lleva a la trampa fría.
  b.torus(m.copper, [0, 0.95, 0], 0.32, 0.03, { rot: [Math.PI / 2, 0, 0], seg: 20 });
  b.pipe(m.copper, [0.3, 0.95, 0], [SIDE_X, 0.95, 0], 0.035, 8);
  // Trampa fría: bidón con serpentín y tapa.
  b.cyl(m.tank, [SIDE_X, 0.42, 0], 0.24, 0.24, 0.06, { seg: 16 });
  b.cyl(m.tank, [SIDE_X, 1.02, 0], 0.24, 0.24, 0.06, { seg: 16 });
  for (let k = 0; k < 4; k++) b.torus(m.copper, [SIDE_X, 0.55 + k * 0.13, 0], 0.25, 0.012, { rot: [Math.PI / 2, 0, 0], seg: 18, tubeSeg: 5 });
  b.pipe(m.steel, [SIDE_X - 0.18, 0, 0.12], [SIDE_X - 0.18, 0.4, 0.12], 0.025, 6);
  b.pipe(m.steel, [SIDE_X + 0.18, 0, -0.12], [SIDE_X + 0.18, 0.4, -0.12], 0.025, 6);
  return b.build();
});

// ─── Taladro láser ───────────────────────────────────────────────────────────────────────────────

const buildDrill = once(() => {
  const m = mats();
  const b = new Builder();
  for (const [x, z] of [[0.75, 0.75], [-0.75, 0.75], [0.75, -0.75], [-0.75, -0.75]] as const) {
    b.pipe(m.steel, [x, 0, z], [x * 0.3, 1.45, z * 0.3], 0.04, 6);
    b.cyl(m.dark, [x, 0.03, z], 0.08, 0.1, 0.06, { seg: 8 });
  }
  b.box(m.machineDark, [0, 1.48, 0], [0.62, 0.08, 0.62]);
  // Colector con separación magnética: columna abierta (se ve llenarse) entre dos bobinas verticales y
  // una tolva desde la veta.
  b.cyl(m.machine, [SIDE_X, 0.39, 0], 0.27, 0.27, 0.1, { seg: 16 });
  b.cyl(m.machine, [SIDE_X, 1.04, 0], 0.27, 0.27, 0.08, { seg: 16 });
  for (const [dx, dz] of [[0.22, 0.22], [-0.22, 0.22], [0.22, -0.22], [-0.22, -0.22]] as const) b.pipe(m.steel, [SIDE_X + dx, 0.4, dz], [SIDE_X + dx, 1.04, dz], 0.02, 6);
  b.torus(m.copper, [SIDE_X, 0.72, 0], 0.36, 0.04, { rot: [0, 0, 0], seg: 20 });
  b.torus(m.copper, [SIDE_X, 0.72, 0], 0.36, 0.04, { rot: [0, Math.PI / 2, 0], seg: 20 });
  for (const [x, z] of [[SIDE_X - 0.2, 0.2], [SIDE_X + 0.2, -0.2]] as const) b.pipe(m.dark, [x, 0, z], [x, 0.35, z], 0.03, 6);
  b.pipe(m.orange, [0.35, 0.5, 0], [SIDE_X - 0.25, 0.9, 0], 0.05, 8);
  return b.build();
});

const buildDrillHead = once(() => {
  const m = mats();
  const b = new Builder();
  b.box(m.orange, [0, 0, 0], [0.42, 0.24, 0.3]);
  b.cyl(m.dark, [0, -0.2, 0], 0.07, 0.05, 0.22, { seg: 10 });
  b.cyl(m.copper, [0, -0.33, 0], 0.045, 0.045, 0.05, { seg: 10 });
  return b.build();
});

/** Un pétalo (espejo) del concentrador: se articula en el eje del cubo. */
const buildPetal = once(() => {
  const m = mats();
  const b = new Builder();
  b.box(m.trim, [0, 0, 0.32], [0.3, 0.02, 0.56]);
  b.box(m.glass, [0, 0.012, 0.32], [0.27, 0.005, 0.52]);
  return b.build();
});

const pipGeometry = once(() => new CylinderGeometry(0.06, 0.06, 0.07, 6));

/** Haz cónico (radio arriba, abajo y alto 1; se escala). */
const beamGeometry = once(() => {
  const g = new CylinderGeometry(1, 1, 1, 16, 1, true);
  g.translate(0, -0.5, 0);
  return g;
});

function ToolSlot({ index }: { index: number }) {
  const root = useRef<Group>(null);
  const conc = useRef<Group>(null);
  const drill = useRef<Group>(null);
  const petals = useRef<(Group | null)[]>([]);
  const head = useRef<Group>(null);
  const sunBeam = useRef<Mesh>(null);
  const laser = useRef<Mesh>(null);
  const beacon = useRef<Mesh>(null);
  const fill = useRef<Mesh>(null);
  const pips = useRef<(Mesh | null)[]>([]);
  const spot = useRef<Sprite>(null);
  const plume = useRef<(Sprite | null)[]>([]);
  const led = useRef<Sprite>(null);
  const top = useRef<Sprite>(null);
  const open = useRef(0);
  const t = useRef(0);
  const res = useMemo(
    () => ({
      sun: beamMaterial('#ffe08a', 0.75),
      laser: beamMaterial('#ff5a2a', 1),
      beacon: beamMaterial('#5dffa0', 0.55),
      fillGeo: new CylinderGeometry(0.2, 0.2, 1, 14),
    }),
    [],
  );
  useEffect(
    () => () => {
      res.sun.material.dispose();
      res.laser.material.dispose();
      res.beacon.material.dispose();
      res.fillGeo.dispose();
    },
    [res],
  );

  useFrame((_, dt) => {
    t.current += dt;
    const g = root.current;
    if (!g) return;
    const tool: PlacedTool | undefined = getRun()?.state.surface?.tools[index];
    g.visible = !!tool;
    if (!tool) return;
    const groundY = liveTerrain.current?.heightAt(tool.x, tool.z) ?? 0;
    g.position.set(tool.x, groundY, tool.z);
    // El colector mira lejos de la veta vecina más cercana (en un filón, dos taladros a pocos pasos no se pisan).
    let nx = 0;
    let nz = 0;
    let nd = Infinity;
    for (const d of getRun()?.state.surface?.deposits ?? []) {
      if (d.id === tool.depositId) continue;
      const dd = Math.hypot(d.x - tool.x, d.z - tool.z);
      if (dd < nd) {
        nd = dd;
        nx = d.x;
        nz = d.z;
      }
    }
    if (nd < 6) g.rotation.y = Math.atan2(-(tool.z - nz), tool.x - nx);
    const solar = tool.toolId === 'solar-concentrator';
    if (conc.current) conc.current.visible = solar;
    if (drill.current) drill.current.visible = !solar;
    const working = tool.stopped === null;
    const storm = tool.stopped === 'storm';
    const ready = tool.ready;

    // Espejos: abiertos trabajando; plegados con tormenta o con la veta agotada.
    const wantOpen = working ? 1 : 0;
    open.current += (wantOpen - open.current) * Math.min(1, dt * 2.5);
    if (solar) {
      for (let k = 0; k < PETALS; k++) {
        const p = petals.current[k];
        // Plegado: colgando junto al mástil; abierto: un plato ancho que mira al cielo.
        if (p) p.rotation.x = 1.35 + (-0.3 - 1.35) * open.current;
      }
    } else if (head.current) {
      // El cabezal barre la roca mientras perfora.
      head.current.rotation.y = working ? Math.sin(t.current * 1.7) * 0.35 : head.current.rotation.y * 0.95;
      head.current.rotation.z = working ? Math.sin(t.current * 2.3) * 0.12 : 0;
    }

    // Haces: luz concentrada del sol o láser, solo trabajando.
    const flick = 0.75 + Math.sin(t.current * 37 + index) * 0.25;
    if (sunBeam.current) {
      sunBeam.current.visible = solar && open.current > 0.8;
      res.sun.u.uOpacity.value = 0.55 + 0.2 * Math.sin(t.current * 3);
    }
    if (laser.current) {
      laser.current.visible = !solar && working;
      res.laser.u.uOpacity.value = flick;
    }
    if (spot.current) {
      spot.current.visible = working && (solar ? open.current > 0.8 : true);
      spot.current.scale.setScalar((solar ? 0.55 : 0.8) * flick);
    }
    // Vapor (hielo que se sublima) o penacho de roca vaporizada que sube hacia la campana o el colector.
    for (let k = 0; k < plume.current.length; k++) {
      const s = plume.current[k];
      if (!s) continue;
      s.visible = working;
      if (!working) continue;
      const ph = (t.current * (solar ? 0.5 : 0.9) + k / plume.current.length) % 1;
      s.position.set(Math.sin(k * 2.1 + t.current) * 0.08 + (solar ? 0 : ph * (SIDE_X - 0.3)), ROCK_TOP + ph * (solar ? 0.5 : 0.25), Math.cos(k * 1.3) * 0.08);
      s.material.opacity = (1 - ph) * (solar ? 0.5 : 0.7);
      s.scale.setScalar(0.18 + ph * (solar ? 0.35 : 0.2));
    }
    // Depósito que se llena con la unidad en curso.
    if (fill.current) {
      const p = Math.max(0.02, tool.progress);
      fill.current.scale.set(1, p * 0.55, 1);
      fill.current.position.set(SIDE_X, 0.45 + (p * 0.55) / 2, 0);
    }
    // Piezas listas: una pieza visible por unidad (hasta MAX_PIPS) y baliza alta que parpadea.
    for (let k = 0; k < MAX_PIPS; k++) {
      const pip = pips.current[k];
      if (pip) pip.visible = k < ready;
    }
    const blink = 0.5 + 0.5 * Math.sin(t.current * 6);
    if (beacon.current) {
      beacon.current.visible = ready > 0;
      res.beacon.u.uOpacity.value = 0.25 + 0.45 * blink;
    }
    if (top.current) {
      top.current.visible = ready > 0;
      top.current.scale.setScalar(0.5 + 0.35 * blink);
    }
    // Piloto: fijo trabajando, ámbar intermitente parado por tormenta, apagado con la veta agotada.
    if (led.current) {
      led.current.visible = working || storm;
      led.current.material.color.set(storm ? '#ffb020' : '#7fd8ff');
      led.current.material.opacity = storm ? (Math.sin(t.current * 8) > 0 ? 0.9 : 0.1) : 0.6;
    }
  });

  return (
    <group ref={root} visible={false} scale={TOOL_SCALE}>
      <group ref={conc}>
        <Parts parts={buildConcentrator()} />
        {Array.from({ length: PETALS }, (_, k) => (
          <group key={k} position={[0, HUB_Y, 0]} rotation={[0, (k / PETALS) * Math.PI * 2, 0]}>
            <group ref={(el) => void (petals.current[k] = el)}>
              <Parts parts={buildPetal()} />
            </group>
          </group>
        ))}
        {/* Luz concentrada: del cubo de espejos al punto del hielo. */}
        <mesh ref={sunBeam} geometry={beamGeometry()} material={res.sun.material} position={[0, HUB_Y - 0.05, 0]} scale={[0.09, HUB_Y - ROCK_TOP, 0.09]} visible={false} />
      </group>
      <group ref={drill} visible={false}>
        <Parts parts={buildDrill()} />
        <group ref={head} position={[0, 1.33, 0]}>
          <Parts parts={buildDrillHead()} />
          <mesh ref={laser} geometry={beamGeometry()} material={res.laser.material} position={[0, -0.36, 0]} scale={[0.06, 1.33 - 0.36 - ROCK_TOP, 0.06]} visible={false} />
        </group>
      </group>
      {/* Depósito (trampa fría o colector) que se llena, piezas listas apiladas y baliza. */}
      <mesh ref={fill} geometry={res.fillGeo} material={mats().led} position={[SIDE_X, 0.46, 0]} />
      {Array.from({ length: MAX_PIPS }, (_, k) => (
        <mesh
          key={k}
          ref={(el) => void (pips.current[k] = el)}
          geometry={pipGeometry()}
          material={mats().guide}
          position={[SIDE_X + ((k % 3) - 1) * 0.14, 1.12 + Math.floor(k / 3) * 0.09, 0]}
          visible={false}
        />
      ))}
      <mesh ref={beacon} geometry={beamGeometry()} material={res.beacon.material} position={[SIDE_X, 9, 0]} scale={[0.06, 7.8, 0.06]} visible={false} />
      <Glow ref={top} color="#5dffa0" size={0.6} opacity={0.9} position={[SIDE_X, 1.4, 0]} />
      <Glow ref={led} color="#7fd8ff" size={0.22} opacity={0.6} position={[0, HUB_Y + 0.15, 0]} />
      <Glow ref={spot} color="#fff1c0" size={0.5} opacity={0.9} position={[0, ROCK_TOP, 0]} />
      {Array.from({ length: 4 }, (_, k) => (
        <Glow key={k} ref={(el) => void (plume.current[k] = el)} color="#e8f4ff" size={0.3} opacity={0.4} />
      ))}
    </group>
  );
}

/** Todas las herramientas colocadas en el mundo (huecos reutilizables). */
export function SurfaceTools() {
  return (
    <>
      {Array.from({ length: MAX_TOOLS }, (_, i) => (
        <ToolSlot key={i} index={i} />
      ))}
    </>
  );
}

// ─── Veta que completa un filón ──────────────────────────────────────────────────────────────────

const MAX_FINISHERS = 4;
const crownGeometry = once(() => new TorusGeometry(0.75, 0.05, 6, 28));
const shardGeometry = once(() => new OctahedronGeometry(0.14, 0));

/**
 * Señal sobre la veta que completaría un filón (bonus listo): una corona que gira con tres gemas en órbita y
 * un destello, distinta de la baliza de piezas listas (haz vertical). Se recalcula a 4 Hz con `lodeFinisherIds`.
 */
export function LodeFinishers() {
  const groups = useRef<(Group | null)[]>([]);
  const ids = useRef<number[]>([]);
  const clock = useRef(0);
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current += dt;
    clock.current -= dt;
    const s = getRun()?.state;
    const me = s?.crew.find((c) => c.alive);
    if (clock.current <= 0) {
      clock.current = 0.25;
      ids.current = s && me ? lodeFinisherIds(s, me) : [];
    }
    for (let i = 0; i < MAX_FINISHERS; i++) {
      const g = groups.current[i];
      if (!g) continue;
      const id = ids.current[i];
      const d = id === undefined ? undefined : s?.surface?.deposits.find((x) => x.id === id);
      g.visible = !!d;
      if (!d) continue;
      g.position.set(d.x, (liveTerrain.current?.heightAt(d.x, d.z) ?? 0) + 2.3 + Math.sin(t.current * 2) * 0.12, d.z);
      g.rotation.y = t.current * 1.4;
    }
  });
  return (
    <>
      {Array.from({ length: MAX_FINISHERS }, (_, i) => (
        <group key={i} ref={(el) => void (groups.current[i] = el)} visible={false}>
          <mesh geometry={crownGeometry()} material={mats().guide} rotation={[Math.PI / 2, 0, 0]} />
          {[0, 1, 2].map((k) => (
            <mesh key={k} geometry={shardGeometry()} material={mats().guide} position={[Math.cos((k / 3) * Math.PI * 2) * 0.75, 0.15, Math.sin((k / 3) * Math.PI * 2) * 0.75]} />
          ))}
          <Glow color="#9ffff0" size={1.6} opacity={0.7} />
        </group>
      ))}
    </>
  );
}
