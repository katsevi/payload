/**
 * Hangar (fase 4): la nave montada sale del diseño y del catálogo (lógica pura de `game/hangarLayout.ts`).
 * Toda pieza queda sujeta a la estructura, nada sale del volumen esperado, las alas son simétricas, las
 * piezas no se cruzan y las variantes salen de los datos (nunca de ids fijos).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalog, emptyDesign, getInstruments, getMissions, getModules, type Catalog, type MissionDesign, type ModuleDef } from '@payload/shared';
import { blockBox, bodyBox, hangarLayout, instrumentLook, isActiveShield, isIonEngine, OCTA, type HangarBlock, type HangarLayout, type V3 } from '../game/hangarLayout';

const FIXTURES_DIR = join(__dirname, '../../../../packages/shared/src/__tests__/fixtures/missions');
const designs: MissionDesign[] = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => (JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8')) as { valid: { design: MissionDesign }[] }).valid.map((v) => v.design));
const missionId = getMissions(catalog)[0]!.id;
const mods = getModules(catalog);
const firstOf = (kind: ModuleDef['kind']) => mods.filter((m) => m.kind === kind);
const heaviestFrame = [...firstOf('structure')].sort((a, b) => (b.slots ?? 0) - (a.slots ?? 0))[0]!;

/** Un diseño cargado: la estructura más grande, un módulo de cada familia y cuatro instrumentos. */
function busyDesign(): MissionDesign {
  const d = emptyDesign(missionId);
  const one = (kind: ModuleDef['kind']) => firstOf(kind).map((m) => m.id);
  const moduleIds = [heaviestFrame.id, firstOf('propulsion')[0]!.id];
  for (const k of ['solar', 'solar', 'nuclear', 'battery', 'comms', 'computer', 'attitude', 'thermal', 'thermal', 'tank', 'tank', 'shielding', 'lifeSupport', 'workshop', 'habitat'] as const) {
    const list = one(k);
    if (list.length) moduleIds.push(list[moduleIds.filter((id) => list.includes(id)).length % list.length]!);
  }
  return { ...d, moduleIds, instrumentIds: getInstruments(catalog).filter((i) => !i.cubesat).slice(0, 4).map((i) => i.id) };
}

const samples = (): { name: string; layout: HangarLayout }[] => [
  ...designs.map((d, i) => ({ name: `${d.missionId}#${i}`, layout: hangarLayout(d) })),
  { name: 'busy', layout: hangarLayout(busyDesign()) },
];

const inside = (p: V3, min: V3, max: V3, eps = 1e-6) => p.every((v, i) => v >= min[i]! - eps && v <= max[i]! + eps);
const overlap = (a: { min: V3; max: V3 }, b: { min: V3; max: V3 }, tol: number) => [0, 1, 2].every((i) => a.min[i]! < b.max[i]! - tol && b.min[i]! < a.max[i]! - tol);

describe('hangar: nave montada', () => {
  it('toda pieza se sujeta a la estructura: su anclaje cae en el bus, la cercha o el banco, y queda a un brazo de su cuerpo', () => {
    for (const { name, layout } of samples()) {
      const { lengthM: L, radiusM: R } = layout.bus;
      const rc = R * OCTA;
      const supports: { min: V3; max: V3 }[] = [{ min: [layout.aftX - 0.01, -rc - 0.01, -rc - 0.01], max: [L / 2 + 0.01, rc + 0.01, rc + 0.01] }];
      if (layout.truss) supports.push({ min: [layout.truss.x1, -layout.truss.half, -layout.truss.half], max: [layout.truss.x0, layout.truss.half, layout.truss.half] });
      if (layout.bench) supports.push({ min: [layout.bench.x0, layout.bench.y - 0.04, -layout.bench.width / 2], max: [layout.bench.x1, layout.bench.y + 0.04, layout.bench.width / 2] });
      for (const b of layout.blocks) {
        const onSupport = supports.some((s) => inside(b.anchor, s.min, s.max, 0.02)) || (b.shape === 'engine' || b.shape === 'ion');
        expect(onSupport, `${name} ${b.key} ancla ${b.anchor.map((v) => v.toFixed(2))}`).toBe(true);
        const box = bodyBox(b);
        const gap = Math.hypot(...[0, 1, 2].map((i) => Math.max(box.min[i]! - b.anchor[i]!, 0, b.anchor[i]! - box.max[i]!)));
        expect(gap, `${name} ${b.key} a ${gap.toFixed(2)} m de su anclaje`).toBeLessThanOrEqual(2.3);
      }
      // El motor va justo al final de la popa (cercha o adaptador).
      const engine = layout.blocks.find((b) => b.shape === 'engine' || b.shape === 'ion');
      if (engine) expect(engine.anchor[0]).toBeCloseTo(layout.truss ? layout.truss.x1 : layout.aftX, 6);
    }
  });

  it('nada fuera del volumen esperado: todo dentro de la caja de la nave y la nave cabe en el hangar', () => {
    for (const { name, layout } of samples()) {
      for (const b of layout.blocks) {
        const box = blockBox(b);
        expect(inside(box.min, layout.bounds.min, layout.bounds.max) && inside(box.max, layout.bounds.min, layout.bounds.max), `${name} ${b.key}`).toBe(true);
        for (const v of [...b.position, ...b.size, ...b.anchor, b.roll]) expect(Number.isFinite(v)).toBe(true);
        for (const v of b.size) expect(v).toBeGreaterThan(0);
      }
      expect(layout.radiusM, name).toBeLessThan(9);
      expect(layout.lengthM, name).toBeGreaterThan(layout.bus.lengthM);
    }
  });

  it('las piezas no se cruzan entre sí (salvo el bus y los anillos que lo rodean)', () => {
    for (const { name, layout } of samples()) {
      const solid = layout.blocks.filter((b) => b.shape !== 'bus' && b.shape !== 'emitter');
      for (let i = 0; i < solid.length; i++)
        for (let j = i + 1; j < solid.length; j++) {
          const a = solid[i]!;
          const b = solid[j]!;
          expect(overlap(bodyBox(a), bodyBox(b), 0.02), `${name}: ${a.key} y ${b.key}`).toBe(false);
        }
    }
  });

  it('alas solares por parejas simétricas a babor y estribor', () => {
    const solar = firstOf('solar');
    for (const count of [2, 3, 4, 6]) {
      const d = { ...emptyDesign(missionId), moduleIds: [heaviestFrame.id, ...Array.from({ length: count }, (_, i) => solar[i % solar.length]!.id)] };
      const wings = hangarLayout(d).blocks.filter((b) => b.shape === 'wing');
      expect(wings.length).toBe(count);
      const port = wings.filter((w) => w.position[2] < 0);
      const star = wings.filter((w) => w.position[2] > 0);
      expect(Math.abs(port.length - star.length)).toBeLessThanOrEqual(1);
      // Cada ala de un lado tiene su gemela en el otro: misma X, misma envergadura, Z opuesta.
      for (const w of port) expect(star.some((s) => Math.abs(s.position[0] - w.position[0]) < 1e-9 && Math.abs(s.position[2] + w.position[2]) < 1e-9 && Math.abs(s.size[2] - w.size[2]) < 1e-9), `${count}`).toBe(true);
      // Las parejas se reparten centradas en el bus.
      const xs = [...new Set(wings.map((w) => w.position[0].toFixed(6)))].map(Number);
      expect(Math.abs(xs.reduce((s, x) => s + x, 0))).toBeLessThan(1e-9);
    }
  });

  it('las estructuras se distinguen por tamaño (más ranuras, bus más largo y más ancho)', () => {
    const frames = [...firstOf('structure')].sort((a, b) => (a.slots ?? 0) - (b.slots ?? 0));
    let last = { lengthM: 0, radiusM: 0 };
    for (const f of frames) {
      const bus = hangarLayout({ ...emptyDesign(missionId), moduleIds: [f.id] }).bus;
      expect(bus.present).toBe(true);
      expect(bus.lengthM).toBeGreaterThan(last.lengthM);
      expect(bus.radiusM).toBeGreaterThan(last.radiusM);
      last = bus;
    }
  });

  it('las variantes salen de los datos de la pieza, no de su id', () => {
    for (const m of mods) {
      const b = hangarLayout({ ...emptyDesign(missionId), moduleIds: [heaviestFrame.id, m.id] }).blocks.find((x) => x.partId === m.id && x.family !== 'structure');
      if (!b) continue;
      if (m.kind === 'propulsion') expect(b.shape).toBe(isIonEngine(m) ? 'ion' : 'engine');
      if (m.kind === 'shielding') expect(b.shape).toBe(isActiveShield(m) ? 'emitter' : 'whipple');
    }
    // Un módulo de una familia sin sitio propio (p. ej. una nueva) va como caja de aviónica pegada al bus.
    const fake: Catalog = { ...catalog, modules: [...mods, { ...firstOf('battery')[0]!, id: 'new-kind-box', kind: 'workshop' }] };
    const b = hangarLayout({ ...emptyDesign(missionId), moduleIds: [heaviestFrame.id, 'new-kind-box'] }, fake).blocks.find((x) => x.partId === 'new-kind-box')!;
    expect(b.shape).toBe('avionics');
    // Cada instrumento tiene una forma conocida; un tipo de ciencia nuevo cae en el detector genérico.
    const insts = getInstruments(catalog);
    for (const i of insts) expect(['camera', 'spectrometer', 'radar', 'boom', 'arm', 'analyzer', 'detector', 'cup']).toContain(instrumentLook(i, insts));
    expect(instrumentLook({ ...insts[0]!, scienceKind: 'plasma-waves' as never }, insts)).toBe('detector');
  });

  it('sin estructura sigue habiendo bastidor (medidas del bus) y las piezas se sujetan a él', () => {
    const d = { ...emptyDesign(missionId), moduleIds: [firstOf('battery')[0]!.id] };
    const l = hangarLayout(d);
    expect(l.bus.present).toBe(false);
    expect(l.bus.lengthM).toBeGreaterThan(0);
    expect(l.blocks.map((b: HangarBlock) => b.shape)).toEqual(['avionics']);
  });
});
