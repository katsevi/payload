/**
 * Generación determinista del mapa de un sector: una estación de salida, columnas de destinos
 * (planetas, lunas, asteroides, nebulosas, naves abandonadas, estaciones) y un portal de salto.
 *
 * Compromiso central del mapa: las rutas cortas pasan por destinos peligrosos (más impactos y
 * averías) pero dejan más combustible; las seguras son más largas. El generador garantiza que
 * existe al menos una ruta que se puede completar a régimen económico.
 */
import { catalog, getNodeKind, getShip, getThrottle } from './catalog';
import { createRng, deriveSeed, type Rng } from './rng';
import type { Catalog, NodeKind, NodeKindDef, SectorMap, SectorNode, ShipDef } from './types';

const SECTOR_SALT = 0x5ec7;
const MAX_ATTEMPTS = 24;

export function nodeDistanceLy(a: SectorNode, b: SectorNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function getNode(sector: SectorMap, nodeId: string): SectorNode | undefined {
  return sector.nodes.find((n) => n.id === nodeId);
}

function nodeName(rng: Rng, syllables: string[], used: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const parts = rng.int(2, 3);
    let word = '';
    for (let i = 0; i < parts; i++) word += syllables[rng.int(0, syllables.length - 1)]!;
    const name = `${word.charAt(0).toUpperCase()}${word.slice(1)}${rng.chance(0.4) ? `-${rng.int(2, 9)}` : ''}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `X-${used.size + 1}`;
  used.add(fallback);
  return fallback;
}

function pickKind(rng: Rng, kinds: NodeKindDef[]): NodeKind {
  const total = kinds.reduce((s, k) => s + k.weight, 0);
  let roll = rng.next() * total;
  for (const k of kinds) {
    roll -= k.weight;
    if (roll < 0) return k.id;
  }
  return kinds[kinds.length - 1]!.id;
}

function rollCache(rng: Rng, def: NodeKindDef): SectorNode['cache'] {
  // Se consumen siempre las mismas tiradas, haya o no contenedor.
  const has = rng.chance(def.cache?.chance ?? 0);
  const fuel = def.cache ? rng.int(def.cache.fuel.min, def.cache.fuel.max) : rng.int(0, 0);
  const spares = def.cache ? rng.int(def.cache.spares.min, def.cache.spares.max) : rng.int(0, 0);
  return has && def.cache ? { fuel, spares } : null;
}

function link(a: SectorNode, b: SectorNode): void {
  if (!a.links.includes(b.id)) a.links.push(b.id);
  if (!b.links.includes(a.id)) b.links.push(a.id);
}

function buildSector(rng: Rng, index: number, cat: Catalog): SectorMap {
  const rules = cat.sector;
  const columns = Math.min(rules.maxColumns, rules.columns + Math.floor((index - 1) / rules.columnsGrowthEverySectors));
  const weighted = cat.nodeKinds.filter((k) => k.weight > 0);
  const used = new Set<string>();
  const nodes: SectorNode[] = [];
  const byColumn: SectorNode[][] = [];
  const make = (kind: NodeKind, column: number, x: number, y: number): SectorNode => {
    const node: SectorNode = {
      id: `s${index}-n${nodes.length}`,
      name: nodeName(rng, rules.nameSyllables, used),
      kind,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      column,
      links: [],
      cache: rollCache(rng, getNodeKind(kind, cat)),
    };
    nodes.push(node);
    (byColumn[column] ??= []).push(node);
    return node;
  };

  let x = 0;
  const start = make('station', 0, 0, 0);
  const stationColumn = Math.ceil(columns / 2);
  for (let c = 1; c <= columns; c++) {
    x += rules.columnSpacingLy.min + rng.next() * (rules.columnSpacingLy.max - rules.columnSpacingLy.min);
    const count = rng.int(rules.nodesPerColumn.min, rules.nodesPerColumn.max);
    const forcedStation = c === stationColumn ? rng.int(0, count - 1) : -1;
    for (let i = 0; i < count; i++) {
      const lane = count === 1 ? 0 : (i / (count - 1) - 0.5) * 2; // -1 … 1
      const y = lane * rules.lateralSpreadLy + (rng.next() - 0.5) * rules.lateralSpreadLy * 0.35;
      const kind = pickKind(rng, weighted);
      make(i === forcedStation ? 'station' : kind, c, x + (rng.next() - 0.5) * 4, y);
    }
  }
  x += rules.columnSpacingLy.min + rng.next() * (rules.columnSpacingLy.max - rules.columnSpacingLy.min);
  const goal = make('gate', columns + 1, x, 0);

  // Enlaces entre columnas contiguas: todos los que estén a tiro y, como mínimo, el más cercano
  // en cada sentido (ningún nodo queda aislado).
  for (let c = 0; c <= columns; c++) {
    const from = byColumn[c]!;
    const to = byColumn[c + 1]!;
    for (const a of from) {
      let nearest = to[0]!;
      for (const b of to) {
        if (nodeDistanceLy(a, b) <= rules.maxLinkLy) link(a, b);
        if (nodeDistanceLy(a, b) < nodeDistanceLy(a, nearest)) nearest = b;
      }
      link(a, nearest);
    }
    for (const b of to) {
      if (b.links.some((idOther) => from.some((a) => a.id === idOther))) continue;
      let nearest = from[0]!;
      for (const a of from) if (nodeDistanceLy(a, b) < nodeDistanceLy(nearest, b)) nearest = a;
      link(nearest, b);
    }
  }

  return { index, hazardMult: 1 + rules.hazardGrowthPerSector * (index - 1), nodes, startId: start.id, goalId: goal.id };
}

/** Combustible de un salto a régimen económico con motores sanos. */
export function ecoFuelCost(distanceLy: number, ship: ShipDef): number {
  return distanceLy * ship.fuelPerLy * getThrottle(ship, 'eco').fuelMult;
}

/**
 * ¿Se puede llegar al portal avanzando siempre hacia delante a régimen económico, saliendo con el
 * depósito lleno (la estación inicial reposta) y contando contenedores y estaciones del camino?
 * `marginPct` reserva una parte del depósito para maniobras evasivas y motores dañados.
 */
export function isSectorSolvable(sector: SectorMap, ship: ShipDef, marginPct = 15): boolean {
  const reserve = (ship.fuelCapacity * marginPct) / 100;
  const best = new Map<string, number>([[sector.startId, ship.fuelCapacity]]);
  const ordered = [...sector.nodes].sort((a, b) => a.column - b.column);
  for (const node of ordered) {
    const fuel = best.get(node.id);
    if (fuel === undefined) continue;
    for (const nextId of node.links) {
      const next = getNode(sector, nextId);
      if (!next || next.column <= node.column) continue;
      const left = fuel - ecoFuelCost(nodeDistanceLy(node, next), ship);
      if (left < reserve) continue;
      const arriving = next.kind === 'station' ? ship.fuelCapacity : Math.min(ship.fuelCapacity, left + (next.cache?.fuel ?? 0));
      if (arriving > (best.get(next.id) ?? -1)) best.set(next.id, arriving);
    }
  }
  return best.has(sector.goalId);
}

/**
 * Sector `index` (1 = primero) de la partida con semilla `seed`. Determinista: misma semilla e
 * índice, mismo mapa. Reintenta con semillas derivadas hasta dar con un sector completable.
 */
export function generateSector(seed: number, index: number, cat: Catalog = catalog, shipId?: string): SectorMap {
  const ship = getShip(shipId, cat);
  let sector: SectorMap | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createRng(deriveSeed(deriveSeed(seed, SECTOR_SALT + index), attempt));
    sector = buildSector(rng, index, cat);
    if (isSectorSolvable(sector, ship)) return sector;
  }
  return sector!;
}
