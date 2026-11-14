/**
 * Nave montada en el hangar (pantalla de diseño, fase 4). PURO: de un diseño a una lista de bloques con forma,
 * posición y tamaño; la escena (`scenes/HangarScene.tsx`) solo los pinta. Ninguna cifra de juego: el tamaño
 * de cada bloque sale de la pieza del catálogo (masa, potencia solar, ranuras) con escalas de dibujo.
 *
 * Ejes: la nave apunta a +X (proa), +Y arriba, Z a los costados. La estructura es una viga central; cada
 * familia tiene su sitio (motor detrás, paneles a los lados, antena arriba, instrumentos en la proa…).
 */
import { catalog as defaultCatalog, getInstruments, getModules, type Catalog, type MissionDesign, type ModuleDef, type ModuleKind, type ScienceKind } from '@payload/shared';

export type BlockShape = 'spine' | 'bell' | 'panel' | 'cylinder' | 'box' | 'dish' | 'fin' | 'plate' | 'sensor' | 'core';

export interface HangarBlock {
  /** Único en el diseño (familia + índice), estable al añadir piezas detrás. */
  key: string;
  partId: string;
  family: ModuleKind | 'instrument';
  science?: ScienceKind;
  shape: BlockShape;
  position: [number, number, number];
  size: [number, number, number];
}

export interface HangarLayout {
  blocks: HangarBlock[];
  /** Largo de la viga (para encuadrar la cámara). */
  lengthM: number;
}

const BASE_LENGTH = 3;
const LENGTH_PER_SLOT = 0.28;

const cube = (kg: number, k: number, min: number, max: number): number => Math.max(min, Math.min(max, k * Math.cbrt(Math.max(0, kg))));

/** Bloques de la nave de un diseño. Las piezas desconocidas se ignoran. */
export function hangarLayout(design: MissionDesign, cat: Catalog = defaultCatalog): HangarLayout {
  const modules = design.moduleIds.map((id) => getModules(cat).find((m) => m.id === id)).filter((m): m is ModuleDef => !!m);
  const instruments = design.instrumentIds.map((id) => getInstruments(cat).find((i) => i.id === id)).filter((i) => !!i);
  const structure = modules.find((m) => m.kind === 'structure');
  const slots = structure?.slots ?? Math.max(6, modules.length + instruments.length);
  const L = BASE_LENGTH + slots * LENGTH_PER_SLOT;
  const half = L / 2;
  const blocks: HangarBlock[] = [];
  const counts: Partial<Record<ModuleKind, number>> = {};
  let extra = 0;
  const next = (kind: ModuleKind): number => {
    const n = counts[kind] ?? 0;
    counts[kind] = n + 1;
    return n;
  };
  // Posición a lo largo de la viga para la n-ésima pieza de una familia (de proa a popa, sin salirse).
  const along = (n: number, from: number, to: number, step: number): number => {
    const x = from - n * step;
    return Math.max(to, Math.min(from, x));
  };

  if (structure) blocks.push({ key: 'structure-0', partId: structure.id, family: 'structure', shape: 'spine', position: [0, 0, 0], size: [L, 0.55, 0.55] });

  for (const m of modules) {
    if (m.kind === 'structure') continue;
    const n = next(m.kind);
    const key = `${m.kind}-${n}`;
    const s = cube(m.massKg, 0.07, 0.25, 1.1);
    const add = (shape: BlockShape, position: [number, number, number], size: [number, number, number]) =>
      blocks.push({ key, partId: m.id, family: m.kind, shape, position, size });
    switch (m.kind) {
      case 'propulsion':
        add('bell', [-half - 0.45 - n * 0.9, 0, 0], [0.9, 0.55 + s * 0.3, 0.55 + s * 0.3]);
        break;
      case 'solar': {
        // Alas a izquierda y derecha, alternando; el tamaño crece con la potencia a 1 UA.
        const area = Math.sqrt(Math.max(1, m.solarKwAt1Au ?? 1));
        const side = n % 2 === 0 ? 1 : -1;
        const pair = Math.floor(n / 2);
        const w = Math.min(4, 0.35 * area);
        add('panel', [along(pair, half * 0.45, -half * 0.6, 1.35), 0, side * (0.45 + w / 2)], [1.1, 0.05, w]);
        break;
      }
      case 'nuclear':
        add('core', [-half + 0.2, 0.75 + n * 0.6, 0], [0.45 + s * 0.2, 0.45 + s * 0.2, 0.45 + s * 0.2]);
        break;
      case 'tank': {
        const side = n % 2 === 0 ? 1 : -1;
        add('cylinder', [along(Math.floor(n / 2), half * 0.2, -half + 0.5, 1.05), -0.45, side * 0.5], [0.95, 0.42, 0.42]);
        break;
      }
      case 'battery':
        add('box', [along(n, half * 0.5, -half, 0.5), 0.38, -0.32], [0.4, 0.22, 0.25]);
        break;
      case 'comms': {
        const big = cube(m.massKg, 0.09, 0.35, 1.1);
        add('dish', [half * 0.35 - n * 0.9, 0.55 + big * 0.3, 0.2], [big, big, big]);
        break;
      }
      case 'computer':
        add('box', [half - 0.35 - n * 0.4, 0.35, 0.2], [0.3, 0.2, 0.3]);
        break;
      case 'thermal': {
        const side = n % 2 === 0 ? 1 : -1;
        add('fin', [along(Math.floor(n / 2), -half * 0.1, -half + 0.4, 0.9), side * 0.75, 0], [0.8, 0.9, 0.04]);
        break;
      }
      case 'shielding':
        add('plate', [half + 0.12 + n * 0.14, 0, 0], [0.08, 0.9 + s * 0.3, 0.9 + s * 0.3]);
        break;
      default:
        // Soporte vital, taller, control de actitud y familias nuevas: módulos encima de la viga.
        add('box', [along(extra++, -half * 0.2, -half + 0.4, 0.6), 0.42, -0.35], [0.5, 0.3, 0.3]);
        break;
    }
  }

  instruments.forEach((inst, i) => {
    const row = Math.floor(i / 3);
    const col = (i % 3) - 1;
    blocks.push({
      key: `instrument-${i}`,
      partId: inst.id,
      family: 'instrument',
      science: inst.scienceKind,
      shape: 'sensor',
      position: [half - 0.25 - row * 0.45, -0.35, col * 0.3],
      size: [0.25, 0.25, 0.25],
    });
  });

  return { blocks, lengthM: L };
}
