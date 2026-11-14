/**
 * Sistema solar como mapa (fase 4, ADR 0016). Funciones puras.
 *
 * - Cuerpos reales y estaciones ficticias en `catalog/sistema-solar.json`, agrupados en ZONAS ordenadas de
 *   dentro a fuera (Tierra, Marte, cinturón, Júpiter, Saturno).
 * - Cada sector de la partida es un TRAMO entre dos zonas: sale de la estación de la zona de partida,
 *   pasa por los cuerpos de esa zona (primeras columnas) y por puntos de paso generados, con una estación a
 *   mitad de camino, y llega al punto de llegada de la zona siguiente (`gate`). La ruta va de la Tierra
 *   hasta la zona del destino de la misión y vuelve (ida y vuelta); si el destino está en la zona de
 *   salida (la Luna), cada tramo es una vuelta por ella.
 * - Produce la MISMA estructura (`SectorMap`) que `generateSector`, así que la partida no cambia; la
 *   longitud del tramo sale de la diferencia de distancias al Sol: base + k·√ΔUA (acotada).
 * - La potencia de los paneles baja con 1/d²; la nuclear (RTG, fisión) no.
 */
import { catalog as defaultCatalog, getNodeKind } from './catalog';
import { isSectorSolvable, linkColumns, nodeName, pickKind, rollCache } from './galaxy';
import { createRng, deriveSeed, type Rng } from './rng';
import type { Catalog, NodeKind, SectorMap, SectorNode, ShipDef, SolarBodyDef, SolarRouteRules, SolarSystemDef, SolarZoneDef } from './types';

const SOLAR_SALT = 0x5017;
const MAX_ATTEMPTS = 24;
/** Distancia mínima al Sol en las fórmulas (evita dividir por 0). */
const MIN_AU = 0.1;

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function getSolarSystem(cat: Catalog = defaultCatalog): SolarSystemDef {
  if (!cat.solarSystem) throw new Error('El catálogo no tiene sistema solar (usa parseCatalog)');
  return cat.solarSystem;
}

export function findBody(bodyId: string, cat: Catalog = defaultCatalog): SolarBodyDef | undefined {
  return cat.solarSystem?.bodies.find((b) => b.id === bodyId);
}

export function getBody(bodyId: string, cat: Catalog = defaultCatalog): SolarBodyDef {
  const b = findBody(bodyId, cat);
  if (!b) throw new Error(`Cuerpo desconocido: ${bodyId}`);
  return b;
}

export function getZone(zoneId: string, cat: Catalog = defaultCatalog): SolarZoneDef {
  const z = getSolarSystem(cat).zones.find((x) => x.id === zoneId);
  if (!z) throw new Error(`Zona desconocida: ${zoneId}`);
  return z;
}

/** Distancia media al Sol (UA) de un cuerpo: su semieje o el de su planeta. El Sol, 0. */
export function bodySunDistanceAu(body: SolarBodyDef, cat: Catalog = defaultCatalog): number {
  if (body.orbitAu !== undefined) return body.orbitAu;
  const parent = body.parentId ? findBody(body.parentId, cat) : undefined;
  return parent ? bodySunDistanceAu(parent, cat) : 0;
}

/** Fracción de la potencia solar a 1 UA que llega a `sunDistanceAu`: 1/d². */
export function solarPowerFactor(sunDistanceAu: number): number {
  const d = Math.max(MIN_AU, sunDistanceAu);
  return 1 / (d * d);
}

/** Potencia de los paneles de la nave a esa distancia (kW, con el sistema sano). */
export function solarKw(ship: ShipDef, sunDistanceAu = 1): number {
  return (ship.solarKwAt1Au ?? 0) * solarPowerFactor(sunDistanceAu);
}

/** Potencia total de la nave sana a esa distancia: nuclear (`reactorOutputKw`) + paneles. */
export function shipPowerKw(ship: ShipDef, sunDistanceAu = 1): number {
  return ship.reactorOutputKw + solarKw(ship, sunDistanceAu);
}

/** Longitud de un tramo entre dos distancias al Sol (unidades del mapa): base + k·√ΔUA, acotada. */
export function legUnits(fromAu: number, toAu: number, route: SolarRouteRules): number {
  const raw = route.legBaseUnits + route.legUnitsPerSqrtAu * Math.sqrt(Math.abs(toAu - fromAu));
  return Math.min(route.legMaxUnits, Math.max(route.legMinUnits, raw));
}

/** Índice de zona en el paso `step` de la ruta de ida y vuelta (0 = la de salida). */
export function routeZoneIndex(step: number, zoneCount: number): number {
  if (zoneCount <= 1) return 0;
  const period = 2 * (zoneCount - 1);
  const p = ((Math.trunc(step) % period) + period) % period;
  return p < zoneCount ? p : period - p;
}

/**
 * Zonas de la ruta de una misión: de la Tierra a la zona del destino (incluida). Sin destino (o desconocido),
 * todas. Con el destino en la zona de salida (la Luna), solo esa: cada tramo es una vuelta por ella.
 */
export function routeZones(destinationId: string | null, cat: Catalog = defaultCatalog): SolarZoneDef[] {
  const zones = getSolarSystem(cat).zones;
  const body = destinationId ? findBody(destinationId, cat) : undefined;
  const last = body?.zoneId ? zones.findIndex((z) => z.id === body.zoneId) : -1;
  return last < 0 ? zones : zones.slice(0, last + 1);
}

/** Zonas de salida y llegada del sector `index` (1 = primero): ida y vuelta entre la Tierra y la zona del destino. */
export function sectorZones(index: number, cat: Catalog = defaultCatalog, destinationId: string | null = null): { from: SolarZoneDef; to: SolarZoneDef } {
  const zones = routeZones(destinationId, cat);
  return { from: zones[routeZoneIndex(index - 1, zones.length)]!, to: zones[routeZoneIndex(index, zones.length)]! };
}

/**
 * Primer sector cuyas primeras columnas muestran los cuerpos de la zona `zoneId` (el que sale de ella) en la
 * ruta hacia `destinationId`. Para la zona del destino es el primero de vuelta (o el 1 si es la Tierra).
 */
export function sectorForZone(zoneId: string, cat: Catalog = defaultCatalog, destinationId: string | null = null): number {
  const zones = routeZones(destinationId, cat);
  const i = zones.findIndex((z) => z.id === zoneId);
  return Math.max(0, i) + 1;
}

/** Punto de la ruta más alejado del Sol (peor caso de los paneles y del enlace). */
export interface RouteWorstPoint {
  /** Distancia al Sol (UA). */
  au: number;
  /** Cuerpo o estación donde está (nombre en `catalog.<bodyId>`). */
  bodyId: string;
}

/**
 * El punto más alejado del Sol que puede generar la ruta hacia `destinationId`: estaciones de cada zona,
 * llegadas (a la distancia de la zona) y todos los cuerpos de las zonas de la ruta. Los puntos de paso se
 * interpolan entre zonas, así que nunca lo superan. Con empate, el primero en orden de catálogo.
 */
export function routeWorstSunDistance(destinationId: string | null, cat: Catalog = defaultCatalog): RouteWorstPoint {
  let worst: RouteWorstPoint = { au: -Infinity, bodyId: '' };
  const consider = (au: number, bodyId: string) => {
    if (au > worst.au + 1e-12) worst = { au, bodyId };
  };
  for (const zone of routeZones(destinationId, cat)) {
    const hub = findBody(zone.hubId, cat);
    consider(zone.sunDistanceAu, zone.hubId);
    if (hub) consider(bodySunDistanceAu(hub, cat), hub.id);
    for (const b of zoneBodies(zone, cat)) consider(bodySunDistanceAu(b, cat), b.id);
  }
  return worst.au > 0 ? { au: round3(worst.au), bodyId: worst.bodyId } : { au: 1, bodyId: '' };
}

/** Cuerpos de una zona que aparecen como nodos (sin la estación de salida), en orden de catálogo. */
export function zoneBodies(zone: SolarZoneDef, cat: Catalog = defaultCatalog): SolarBodyDef[] {
  return getSolarSystem(cat).bodies.filter((b) => b.zoneId === zone.id && b.nodeKind && b.id !== zone.hubId);
}

function buildSolarSector(rng: Rng, index: number, cat: Catalog, destinationId: string | null): SectorMap {
  const sys = getSolarSystem(cat);
  const rules = cat.sector;
  const route = sys.route;
  const { from, to } = sectorZones(index, cat, destinationId);
  const length = legUnits(from.sunDistanceAu, to.sunDistanceAu, route);
  const columns = Math.min(rules.maxColumns, Math.max(2, Math.round(length / route.columnSpacingUnits) - 1));
  const spacing = length / (columns + 1);
  const waypointDefs = route.waypointKinds.map((k) => getNodeKind(k, cat)).filter((k) => k.weight > 0);
  const used = new Set<string>();
  const nodes: SectorNode[] = [];
  const byColumn: SectorNode[][] = [];
  const lerpAu = (t: number) => round3(from.sunDistanceAu + (to.sunDistanceAu - from.sunDistanceAu) * t);

  const make = (kind: NodeKind, column: number, x: number, y: number, name: string, extra: Partial<SectorNode>): SectorNode => {
    const node: SectorNode = {
      id: `s${index}-n${nodes.length}`,
      name,
      kind,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      column,
      links: [],
      cache: rollCache(rng, getNodeKind(kind, cat)),
      ...extra,
    };
    if (node.bodyId && node.bodyId === destinationId) node.missionTarget = true;
    nodes.push(node);
    (byColumn[column] ??= []).push(node);
    return node;
  };
  const bodyNode = (body: SolarBodyDef, column: number, x: number, y: number): SectorNode =>
    make(body.nodeKind!, column, x, y, body.name.es, { bodyId: body.id, sunDistanceAu: round3(bodySunDistanceAu(body, cat)) });

  const hub = sys.bodies.find((b) => b.id === from.hubId)!;
  const start = bodyNode(hub, 0, 0, 0);

  // Cuerpos de la zona de salida en las primeras columnas (como mucho la mitad); el resto, puntos de paso.
  const locals = zoneBodies(from, cat);
  const localColumns = locals.length === 0 ? 0 : Math.min(Math.ceil(columns / 2), Math.max(1, Math.ceil(locals.length / 3)));
  const stationColumn = Math.ceil(columns / 2);
  let nextLocal = 0;
  for (let c = 1; c <= columns; c++) {
    const x = c * spacing + (rng.next() - 0.5) * 4;
    const take = c <= localColumns ? Math.ceil((locals.length - nextLocal) / (localColumns - c + 1)) : 0;
    const extra = take > 0 ? 0 : rng.int(rules.nodesPerColumn.min, rules.nodesPerColumn.max);
    const count = take + extra;
    const placed: SectorNode[] = [];
    for (let i = 0; i < count; i++) {
      const lane = count === 1 ? 0 : (i / (count - 1) - 0.5) * 2; // -1 … 1
      const y = lane * rules.lateralSpreadLy + (rng.next() - 0.5) * rules.lateralSpreadLy * 0.35;
      const jitter = (rng.next() - 0.5) * 4;
      if (i < take) placed.push(bodyNode(locals[nextLocal++]!, c, x + jitter, y));
      else {
        const kind = pickKind(rng, waypointDefs);
        placed.push(make(kind, c, x + jitter, y, nodeName(rng, rules.nameSyllables, used), { sunDistanceAu: lerpAu(c / (columns + 1)) }));
      }
    }
    // Estación a mitad de tramo (como en los sectores abstractos): si no hay, un punto de paso pasa a serlo.
    if (c === stationColumn && !placed.some((n) => n.kind === 'station')) {
      const waypoint = placed.find((n) => !n.bodyId);
      if (waypoint) {
        waypoint.kind = 'station';
        waypoint.cache = null;
      } else {
        const y = (placed.length % 2 ? 1 : -1) * rules.lateralSpreadLy * 0.6;
        make('station', c, x, y, nodeName(rng, rules.nameSyllables, used), { sunDistanceAu: lerpAu(c / (columns + 1)) });
      }
    }
  }
  const arrival = sys.bodies.find((b) => b.id === to.hubId)!;
  const goal = make('gate', columns + 1, length, 0, arrival.name.es, { bodyId: arrival.id, sunDistanceAu: round3(to.sunDistanceAu) });
  goal.cache = null;
  linkColumns(byColumn, rules.maxLinkLy);
  return {
    index,
    hazardMult: 1 + rules.hazardGrowthPerSector * (index - 1),
    nodes,
    startId: start.id,
    goalId: goal.id,
    zoneFromId: from.id,
    zoneToId: to.id,
  };
}

/**
 * Sector `index` (1 = primero) del mapa del sistema solar para la nave `ship`. Determinista: misma semilla,
 * índice, nave y destino, mismo mapa. Reintenta con semillas derivadas hasta dar con uno completable con esa
 * nave (`isSectorSolvable`); si ninguno lo es (nave sin alcance), devuelve el último.
 */
export function generateSolarSector(seed: number, index: number, ship: ShipDef, cat: Catalog = defaultCatalog, destinationId: string | null = null): SectorMap {
  let sector: SectorMap | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createRng(deriveSeed(deriveSeed(Math.trunc(seed) >>> 0, SOLAR_SALT + index), attempt));
    sector = buildSolarSector(rng, index, cat, destinationId);
    if (isSectorSolvable(sector, ship)) return sector;
  }
  return sector!;
}

/** Posición en el plano de la eclíptica (UA, Sol en el origen) para dibujar. */
export interface SolarPositionAu {
  x: number;
  y: number;
}

/**
 * Posición de un cuerpo `days` días después del instante 0 (órbitas circulares; solo para dibujar). Las lunas
 * y estaciones se separan de su planeta `moonDisplayAuPerMkm` UA por millón de km (exagerado para que se vean).
 */
export function bodyPositionAu(body: SolarBodyDef, cat: Catalog = defaultCatalog, days = 0): SolarPositionAu {
  const angle = (deg: number, period: number) => ((deg + (period > 0 ? (360 * days) / period : 0)) * Math.PI) / 180;
  if (body.type === 'star') return { x: 0, y: 0 };
  const parent = body.parentId ? findBody(body.parentId, cat) : undefined;
  if (parent && body.orbitAu === undefined) {
    const p = bodyPositionAu(parent, cat, days);
    const r = ((body.orbitKm ?? 0) / 1e6) * getSolarSystem(cat).route.moonDisplayAuPerMkm;
    const a = angle(body.phaseDeg, body.periodDays);
    return { x: p.x + r * Math.cos(a), y: p.y + r * Math.sin(a) };
  }
  const r = body.orbitAu ?? 0;
  const a = angle(body.phaseDeg, body.periodDays);
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

/**
 * Posición para dibujar cada nodo de un sector del sistema solar (UA). Los cuerpos van en su órbita; los
 * puntos de paso, entre la salida y la llegada según su columna, desplazados a un lado según su `y`.
 * Vacío si el sector no es del sistema solar.
 */
export function solarNodePositionsAu(sector: SectorMap, cat: Catalog = defaultCatalog, days = 0): Record<string, SolarPositionAu> {
  const out: Record<string, SolarPositionAu> = {};
  const start = sector.nodes.find((n) => n.id === sector.startId);
  const goal = sector.nodes.find((n) => n.id === sector.goalId);
  if (!start?.bodyId || !goal?.bodyId) return out;
  const a = bodyPositionAu(getBody(start.bodyId, cat), cat, days);
  const b = bodyPositionAu(getBody(goal.bodyId, cat), cat, days);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const lateralAuPerUnit = len / Math.max(1, goal.x) / 2;
  for (const n of sector.nodes) {
    if (n.bodyId) out[n.id] = bodyPositionAu(getBody(n.bodyId, cat), cat, days);
    else {
      const t = goal.x > 0 ? n.x / goal.x : 0;
      out[n.id] = { x: a.x + (b.x - a.x) * t + nx * n.y * lateralAuPerUnit, y: a.y + (b.y - a.y) * t + ny * n.y * lateralAuPerUnit };
    }
  }
  return out;
}
